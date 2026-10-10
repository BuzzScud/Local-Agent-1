// One run of a loop (/loop, app/loops.mjs), from the run's side. The window that owns the loop
// starts `coding -p --loop-events` for each run; this is how the two talk:
//   the run writes one JSON line per thing that happens to its stdout:
//     { t: 'tool', label, arg, error, given, test, failed }   a step (test: it ran the tests; failed: they failed, when known)
//     { t: 'note', text }                             a line from the app
//     { t: 'text', text, final }                      what the model said
//     { t: 'ask', id, kind, name, text, options, always, sig }   it waits for an answer
//     { t: 'heard', text, after }                     a note you typed reached the model with that step's result
//     { t: 'page', when, page, count, skipped, secs }  the loop's page check: when 'start' (checking), 'before' or 'after' the run
//     { t: 'confirm', when, command, ok, failed, failing, timedOut, skipped, secs }   a fixing loop's run said LOOP DONE:
//                                                     the app's own run of the tests (when 'start', then 'after'; confirmDone)
//     { t: 'end', reason, final, secs, steps, tests, usd, point, until, files }   the run is over (tests: { ok, count? },
//                                                     count = how many fail; usd: what it cost on a paid service;
//                                                     point…until: its copies for undo, rewind.mjs; files: what it changed)
//   the window writes to its stdin:
//     { t: 'answer', id, choice: 'yes' | 'always' | 'no', text }   to an ask
//     { t: 'note', text }   a note typed to the loop: read with its next step's result, or as the next
//                           message when the turn ends first
//     { t: 'stop' }         end the run now
// Nothing else is printed on stdout, so a line that does not parse is not from here.

import { testCommand } from '../agent/prompt.mjs';
import { runCommand } from '../tools/run.mjs';
import { readResults } from '../flows/results.mjs';

// A run that ends its answer with the line LOOP DONE says the whole job is finished (loops.mjs readEnding).
export const saysDone = (text) => /^\W*LOOP DONE\W*$/im.test(String(text ?? ''));

// A fixing loop is done when its tests pass, not when its run says so (9 Oct 2026, the owner's pick: a run
// said it was finished with tests still failing). After a LOOP DONE the app runs the project's tests itself,
// in the same fence as the model's commands (Bypass opens it, tools.mjs Bash), and says what it found.
// No test command in the folder: nothing to check, and the run's word stands (skipped).
export async function confirmDone({ cwd, mode = 'ask', command = testCommand(cwd), run = runCommand, timeoutMs = Number(process.env.AGENTIC_LOOP_CONFIRM_MS) || 600_000, signal } = {}) {
  if (!command) return { skipped: 'no test command in this folder' };
  const r = await run(command, { cwd, timeoutMs, maxLines: 400, signal, ...(mode === 'bypass' ? { sandbox: { open: true } } : {}) });
  const secs = Math.round((r.ms ?? 0) / 1000);
  if (r.timedOut) return { command, ok: false, failed: null, failing: [], timedOut: true, secs };
  const res = readResults(r.whole ?? (r.lines ?? []).join('\n'), r.code ?? 1);
  return { command, ok: res.ok, failed: res.failed ?? (res.ok ? 0 : null), failing: res.failing, secs };
}

// A step that runs the project's tests (the board lights its TESTS step, and a miss turns the run red).
// The agent says which steps those are (ev.tests: permissions.mjs runsTests, the rule its own check
// uses); reading or searching a test file is not one.
export const isTestRun = (ev) => Boolean(ev?.tests);

// What an "always" covers for the loop's later runs: this exact command, every edit, this site.
export function signatureOf(req) {
  if (req.name === 'Bash') return `Bash:${String(req.args?.command ?? '').trim()}`;
  if (['Edit', 'Write', 'Rename', 'Update'].includes(req.name)) return 'Edit:*';
  if (req.name === 'WebFetch') return String(req.rule ?? `WebFetch:${req.args?.url ?? ''}`);
  if (req.name === 'WebSearch') return 'WebSearch';
  if (req.name === 'Screen') return `Screen:${String(req.args?.app ?? '').trim().toLowerCase()}`;
  return null; // a question, a test to confirm, a commit: asked every time
}

const one = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
// The question as the board shows it: what it wants to do, in a line.
export function askText(req) {
  if (req.name === 'Ask') return { kind: 'question', text: one(req.args?.question, 300), options: (req.args?.options ?? []).map((o) => one(o, 80)), always: null };
  if (req.name === 'Bash') return { kind: 'permission', text: `May it run: ${one(req.args?.command, 140)}`, always: req.once ? null : 'this command' };
  if (req.name === 'Write') return { kind: 'permission', text: `May it write ${one(req.args?.path, 100)}?`, always: req.once ? null : 'every edit' };
  if (req.name === 'Edit' || req.name === 'Update') return { kind: 'permission', text: `May it change ${one(req.args?.path, 100)}?`, always: req.once ? null : 'every edit' };
  if (req.name === 'Rename') return { kind: 'permission', text: `May it rename ${one(req.args?.from ?? req.args?.name, 60)}?`, always: req.once ? null : 'every edit' };
  if (req.name === 'WebFetch') { const site = String(req.rule ?? '').replace(/^WebFetch\((.*)\)$/, '$1') || one(req.args?.url, 80); return { kind: 'permission', text: `May it read ${site}?`, always: req.rule ? site : null }; }
  if (req.name === 'WebSearch') return { kind: 'permission', text: `May it search the web for “${one(req.args?.query, 80)}”?`, always: 'web searches' };
  if (req.name === 'Screen') return { kind: 'permission', text: `May it look at ${String(req.args?.app ?? '').trim() ? `${String(req.args.app).trim()}'s window` : 'the whole screen'}?`, always: 'this app' };
  if (req.name === 'Test') return { kind: 'permission', text: 'May it use the test it wrote to decide?', always: null };
  return { kind: 'permission', text: `May it use ${req.name}?`, always: null };
}

// mode: the window's mode when the loop was made. allow: what "always" already covers for this loop.
export function loopIO({ input = process.stdin, output = process.stdout, mode = 'ask', allow = [] } = {}) {
  const waiting = new Map();
  const notes = [];
  const allowed = new Set(allow);
  const ac = new AbortController();
  let seq = 0;
  let tests = null;
  let final = '';
  let lastNote = '';
  let lastStep = null; // the step a note typed meanwhile goes with (heard)
  const say = (o) => { try { output.write(`${JSON.stringify(o)}\n`); } catch { /* the window is gone */ } };
  const got = (m) => {
    if (m?.t === 'answer') { const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); } }
    else if (m?.t === 'note' && String(m.text ?? '').trim()) notes.push(String(m.text).trim());
    else if (m?.t === 'stop') ac.abort();
  };
  // Lines are read with 'readable' and read(), as every key in the app is (see pick.mjs).
  let carry = '';
  input.setEncoding?.('utf8');
  input.on('readable', () => {
    let chunk;
    while ((chunk = input.read()) !== null) {
      carry += chunk;
      for (let i = carry.indexOf('\n'); i >= 0; i = carry.indexOf('\n')) { const line = carry.slice(0, i); carry = carry.slice(i + 1); try { got(JSON.parse(line)); } catch { /* not ours */ } }
    }
  });
  // The window closed: its loops end with it, and so does this run.
  input.on('end', () => { for (const w of waiting.values()) w({ choice: 'no' }); waiting.clear(); ac.abort(); });
  const hands = mode !== 'ask'; // Accept edits, Auto, Bypass: nobody is asked to confirm a plan
  return {
    signal: ac.signal,
    event(type, ev) {
      if (type === 'tool') {
        const test = isTestRun(ev);
        // A result not known (piped into tail with the counts cut off) leaves the last one as it was.
        const known = test && ev.tests.failed !== null && ev.tests.failed !== undefined;
        if (known) tests = { ok: !ev.tests.failed, ...(Number.isFinite(ev.tests.count) ? { count: ev.tests.count } : {}) };
        say({ t: 'tool', label: ev.label, arg: one(ev.arg, 240), error: Boolean(ev.error), given: Boolean(ev.given), test, ...(known ? { failed: Boolean(ev.tests.failed) } : {}) });
        if (!ev.given) lastStep = `${ev.label}(${one(ev.arg, 60)})`;
      } else if (type === 'note') { lastNote = one(ev.text, 400); say({ t: 'note', text: lastNote }); }
      else if (type === 'steered') for (const text of ev.notes ?? []) say({ t: 'heard', text: one(text, 400), after: lastStep });
      else if (type === 'assistant' && String(ev.text ?? '').trim()) { if (ev.final) final = ev.text; say({ t: 'text', text: String(ev.text).trim().slice(0, 4000), final: Boolean(ev.final) }); }
    },
    // The answer to anything the run asks. A plan to confirm and a check-in go to the window only in
    // Manual mode; a "stuck" question is skipped, as in every run nobody watches.
    async ask(req) {
      if (req.name === 'Ask') {
        if (req.kind === 'stuck') return { choice: 'skip' };
        if ((req.kind === 'plan' || req.kind === 'checkin') && hands) return { choice: 'answer', text: req.kind === 'plan' ? 'yes' : 'keep going' };
      }
      const sig = signatureOf(req);
      if (sig && allowed.has(sig)) return { choice: 'yes' };
      if (ac.signal.aborted) return { choice: 'no' };
      const id = ++seq;
      const a = await new Promise((resolve) => { waiting.set(id, resolve); say({ t: 'ask', id, name: req.name, sig, ...askText(req) }); });
      if (req.name === 'Ask') return a.choice === 'no' ? { choice: 'no' } : { choice: 'answer', text: String(a.text ?? (a.choice === 'yes' || a.choice === 'always' ? 'yes' : '')).trim() || 'yes' };
      if (a.choice === 'always' && sig) allowed.add(sig);
      return { choice: a.choice === 'yes' || a.choice === 'always' ? 'yes' : 'no' };
    },
    // Notes typed while it worked: with its next step's result (agent.mjs steering), or, when the turn
    // ends first, the next message of the same conversation (more).
    steering() { return notes.splice(0); },
    more() { return notes.length ? notes.shift() : null; },
    // A run that did not finish and said nothing: the app's last line says why (the model gone, out of steps).
    // more: its cost and its copies for undo (cli.jsx).
    // The loop's page check (cli.jsx, flows/layoutcheck.mjs checkPage): what it found, for the board.
    page(when, r = {}) { say({ t: 'page', when, page: r.page ?? '', count: r.problems?.length ?? 0, ...(r.skipped ? { skipped: one(r.skipped, 200) } : {}), secs: r.secs ?? 0 }); },
    // The app's own run of the tests after a LOOP DONE (confirmDone): what it found is the run's test result.
    confirm(when, c = {}) {
      if (when === 'after' && !c.skipped) tests = { ok: Boolean(c.ok), ...(Number.isFinite(c.failed) ? { count: c.failed } : {}) };
      say({ t: 'confirm', when, ...(c.command ? { command: one(c.command, 120) } : {}), ...(when === 'after' ? { ok: Boolean(c.ok), failed: c.failed ?? null, failing: (c.failing ?? []).map((n) => one(n, 100)), timedOut: Boolean(c.timedOut), secs: c.secs ?? 0 } : {}), ...(c.skipped ? { skipped: one(c.skipped, 160) } : {}) });
    },
    end(r, more = {}) { say({ t: 'end', reason: r.reason, final: String(r.finalText || final || (r.reason === 'done' ? '' : lastNote)).trim().slice(0, 6000), secs: r.secs, steps: r.steps, tests, ...more }); },
    fail(message) { say({ t: 'end', reason: 'error', final: String(message), secs: 0, steps: 0, tests }); },
  };
}
