// What a loop's words say (loops.mjs, moved here on 13 Oct 2026 so each file can be read whole): /loop as typed
// (parseLoop), a task asked about first (unclearOf), a loop in a sentence (readSentence), a loop's own rules as the
// form types them (rulesOf, fieldsOf, limitWhy), what each run is told (loopNote), a fixing loop that is stuck
// (stuckWhy) and how a run ended, in a line for the board (summaryOf). No files and no processes: loops.mjs has those
// and gives every name here on to the files that import it.

export const KINDS = ['debug', 'test', 'web', 'task'];
const UNIT = { s: 1, m: 60, h: 3600, d: 86_400 };
// The shortest gap between two runs of a loop (a test sets AGENTIC_LOOP_MIN_SECS).
export const minSecs = (env = process.env) => Math.max(1, Number(env.AGENTIC_LOOP_MIN_SECS) || 60);
export const SELF_SECS = 600; // no time given: ten minutes, unless a run says NEXT RUN IN <n> MIN
export const RETRY_SECS = 15; // a debugging loop tries again this long after a miss
export const MAX_HOURS = 24;
export const MAX_USD = 5;
export const PRESET = {
  debug: 'Some tests in this folder fail. Find why and fix the code until every test passes.',
  test: 'Run the tests. Say which fail and why. This is only a question: change no file.',
};
export const guessKind = (message) => (/\b(fix|debug|bug|bugs|broken)\b/i.test(message) ? 'debug'
  : /https?:\/\/|\b(web|page|pages|site|sites|url|release|releases|browse|news|blog)\b|\b[a-z0-9-]+\.(com|org|net|io|sh|dev|ai|app|co)\b/i.test(message) ? 'web'
  : /\b(test|tests|check|lint|build)\b/i.test(message) ? 'test' : 'task');
const PRESET_NAME = { debug: 'Fix the failing tests', test: 'Run the tests' };
const nameOf = (message) => { const t = String(message).replace(/\s+/g, ' ').trim().split(/[.:!?](?:\s|$)/)[0]; return t.length > 28 ? `${t.slice(0, 27)}…` : t; };
export const everyWord = (secs) => (!secs ? '' : secs % 86_400 === 0 ? `${secs / 86_400}d` : secs % 3600 === 0 ? `${secs / 3600}h` : secs % 60 === 0 ? `${secs / 60}m` : `${secs}s`);

// A time as people write it: 10m, 10 min, 10 minutes, 1.5h, 2 hours, 30 seconds, every hour.
const UNIT_WORD = String.raw`(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)`;
const LEAD_TIME = new RegExp(String.raw`^(?:every\s+)?(?:(\d+(?:\.\d+)?)\s*${UNIT_WORD}|(?:an?\s+)?(second|minute|hour|day))\b[,:]?\s*`, 'i');
const TAIL_TIME = new RegExp(String.raw`[\s,]+every\s+(?:(\d+(?:\.\d+)?)\s*${UNIT_WORD}|(?:an?\s+)?(second|minute|hour|day))\s*[.!]?$`, 'i');
const secsOf = (m) => Math.round(Number(m[1] ?? 1) * UNIT[(m[2] ?? m[3])[0].toLowerCase()]);

// What follows /loop: [debug|test|web] [10m] [message] [every 10 minutes]. The time comes first or
// last ("every …"), in short or long words. A kind alone uses its ready-made message; a debugging
// loop with no time runs until its tests pass; any other loop with no time paces itself.
export function parseLoop(text, { min = minSecs() } = {}) {
  let rest = String(text ?? '').trim();
  let kind = null;
  let m = /^(debug|tests?|web)\b\s*/i.exec(rest);
  if (m) { kind = m[1].toLowerCase().replace(/^tests$/, 'test'); rest = rest.slice(m[0].length); }
  let every = null;
  m = LEAD_TIME.exec(rest) ?? TAIL_TIME.exec(rest);
  if (m) { every = secsOf(m); rest = `${rest.slice(0, m.index)}${rest.slice(m.index + m[0].length)}`; }
  let message = rest.trim();
  let name = null;
  if (!message) {
    if (kind && PRESET[kind]) { message = PRESET[kind]; name = PRESET_NAME[kind]; }
    else return { error: kind === 'web' ? 'A web loop needs to know what to look at: /loop web 30m read the Bun release page and tell me when there is a new version' : 'A loop needs a message: /loop 10m check the tests and say what fails' };
  }
  kind ??= guessKind(message);
  let note = '';
  if (every !== null && every < min) { note = ` (the shortest gap is ${everyWord(min)})`; every = min; }
  return { kind, every, until: kind === 'debug' && every === null, message, name: name ?? nameOf(message), note };
}

// A task the rules cannot read well, asked about before the loop starts (4 Oct 2026, the owner's
// pick after "/loop test5m" made a loop whose whole task was the word "test5m"): a kind and a time
// typed together, or a single word. No model is asked. Answers null, or { why, options } for the
// board's setup: use (the kind and time it looks like), keep (the words as they are), again.
const GLUED = /^(tests?|debug|fix|web)(\d+(?:\.\d+)?)(s|m|h|mins?|hrs?)$/i;
export function unclearOf(text) {
  const t = String(text ?? '').trim();
  if (isLoopCommand(t)) return null; // "/loop 2 every 7m" changes a loop that is there
  const g = GLUED.exec(t);
  if (g) {
    const kind = /^t/i.test(g[1]) ? 'test' : /^web$/i.test(g[1]) ? 'web' : 'debug';
    const secs = Math.round(Number(g[2]) * UNIT[g[3][0].toLowerCase()]);
    const what = { test: 'Run the tests', debug: 'Fix the failing tests', web: 'Read a web page' }[kind];
    return { why: `"${t}" looks like two things typed together: "${g[1]}" and "${g[2]}${g[3]}".`, options: [
      { act: 'use', kind, every: everyWord(secs), label: `${what}, every ${everyWord(secs)}`, note: { test: 'runs them and says what fails; changes no file', debug: 'fixes the code until every test passes', web: 'you say which page next' }[kind] },
      { act: 'keep', label: `Keep "${t}" as what each run does`, note: 'the model gets only this word' },
      { act: 'again', label: 'Type it again', note: '' },
    ] };
  }
  const p = parseLoop(t);
  if (p.error || PRESET[p.kind] === p.message || /\s/.test(p.message) || [...p.message].length >= 16 || /^https?:/i.test(p.message)) return null;
  return { why: `"${p.message}" is one word. Each run gets only these words, so say what it should do.`, options: [
    { act: 'again', label: 'Type it again', note: 'e.g. "run the tests and say what fails"' },
    { act: 'keep', label: `Keep "${p.message}" as what each run does`, note: 'the model gets only this word' },
  ] };
}

// /loop <a sentence> (9 Oct 2026, the owner: "can we make 1 command for it all? … easier to set up"):
// the words as people say them, read for how often and when it stops, the rest being what each run
// does. "run the tests every 10 min until 6pm", "check bun.sh/blog every hour, stop after 5 runs",
// "fix the failing tests until they pass". A phrase of time or count is taken out of the message; a
// goal ("until they pass") stays in it, and makes a fixing loop run until done. No model is asked.
// Answers { fields, found } (the setup's fields, rulesOf reads them; found: the phrases it took), or
// { error } when nothing is left to do.
const STOP_COUNT = String.raw`(?:(?:and\s+)?(?:stop|end)\s+)?after\s+(\d+)\s+(?:runs?|times|tries)|(\d+)\s+times`;
const STOP_TIME = String.raw`(?:(?:and\s+)?(?:stop|end)\s+(?:at\s+)?|until\s+|till\s+|(?:and\s+)?stop\s+at\s+)(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})`;
const STOP_FOR = String.raw`for\s+(?:the\s+next\s+)?(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h)\b|for\s+(?:an?\s+)(hour|minute)\b`;
const EVERY_ANY = new RegExp(String.raw`(?:^|[\s,])(?:every\s+(?:(\d+(?:\.\d+)?)\s*${UNIT_WORD}|(?:an?\s+)?(second|minute|hour|day))|(hourly|daily))\b`, 'i');
const UNTIL_DONE = /\buntil\s+(?:(?:they|it|all|every\s+test|the\s+tests?)\s+)*(?:all\s+)?(?:pass(?:es)?|is\s+(?:fixed|green|done)|are\s+(?:fixed|green)|(?:it'?s|its)\s+(?:fixed|done)|done|green|fixed)\b/i;
export function readSentence(text, { now = Date.now() } = {}) {
  let rest = String(text ?? '').trim().replace(/^\/loops?\b\s*/i, '');
  const found = [];
  const fields = { every: null, runs: 'no limit', stopAt: 'none' };
  const take = (re, fn) => { const m = new RegExp(re.source ?? re, 'i').exec(rest); if (!m) return; found.push(m[0].trim().replace(/^,\s*/, '')); fn(m); rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`; };
  // A kind and a time first, as /loop always read them ("test 5m", "debug", "web 30m …").
  const lead = /^(debug|tests?|web)\b\s*/i.exec(rest);
  let kind = null;
  if (lead) { kind = lead[1].toLowerCase().replace(/^tests$/, 'test'); rest = rest.slice(lead[0].length); }
  const lt = LEAD_TIME.exec(rest);
  if (lt) { found.push(lt[0].trim()); fields.every = everyWord(secsOf(lt)); rest = rest.slice(lt[0].length); }
  if (!fields.every) take(EVERY_ANY, (m) => { fields.every = m[4] ? (m[4].toLowerCase() === 'daily' ? '1d' : '1h') : everyWord(secsOf([m[0], m[1], m[2], m[3]])); });
  take(new RegExp(STOP_COUNT, 'i'), (m) => { fields.runs = m[1] ?? m[2]; });
  take(new RegExp(STOP_TIME, 'i'), (m) => { fields.stopAt = m[1].replace(/\s+/g, ''); });
  take(new RegExp(STOP_FOR, 'i'), (m) => { fields.stopAt = m[1] ? `${m[1]}${m[2][0].toLowerCase()}` : m[3].toLowerCase() === 'hour' ? '1h' : '1m'; });
  // What is left is what each run does, tidied of the commas and "and"s the phrases leave.
  let message = rest.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/(^|[,.]\s*)(and|then)\s*$/i, '').replace(/[\s,;:-]+$/, '').replace(/^[\s,;:-]+/, '').trim();
  if (!message && kind && PRESET[kind]) message = PRESET[kind];
  if (!message) return { error: kind === 'web' ? 'Say what to read: /loop read the Bun release page every hour' : 'Say what each run should do: /loop run the tests every 10 min' };
  kind ??= guessKind(message);
  const until = kind === 'debug' && (!fields.every || UNTIL_DONE.test(message));
  // A stop time that cannot be read is left to the setup, which says so.
  if (fields.stopAt !== 'none' && readStopAt(fields.stopAt, now).error) fields.stopAt = 'none';
  return { fields: { message, kind, every: until ? 'until done' : fields.every ?? 'own pace', runs: fields.runs, stopAt: fields.stopAt }, found };
}

// A gap as said aloud: 10 min, 90 s, hour, 2 hours, day.
export const spokenEvery = (secs) => (secs % 86_400 === 0 ? (secs === 86_400 ? 'day' : `${secs / 86_400} days`) : secs % 3600 === 0 ? (secs === 3600 ? 'hour' : `${secs / 3600} hours`) : secs % 60 === 0 ? `${secs / 60} min` : `${secs} s`);
// ---- a loop's own rules (4 Oct 2026, the owner's ask: "i want to be able to control it more") ----
// Set in the board's setup and form (^N makes a loop, ^O changes one) or with /loop <n> <rule>. Their picks: a
// loop can stop after a number of runs or at a time, have a spending cap of its own, and wait for
// your go before each run; it also has its own mode and the steps a run may take. Empty = no limit.
export const LOOP_MODES = ['ask', 'edits', 'auto', 'plan'];
export const STEPS_WORD = 'as /effort'; // no steps of its own: /effort's Steps per request
const KIND_WORD = { debug: 'Fix the tests', test: 'Run the tests', web: 'Read the web', task: 'Any task' };
export const kindWord = (k) => KIND_WORD[k] ?? KIND_WORD.task;
const MODE_NAME = { ask: 'Manual', edits: 'Accept edits', auto: 'Auto', plan: 'Plan', bypass: 'Bypass permissions' };
export const modeName = (m) => MODE_NAME[m] ?? MODE_NAME.ask;
const NONE = /^(|-|—|none|no|off|no limit|never)$/i;
export const hm = (t) => new Date(t).toTimeString().slice(0, 5);
export const money = (usd) => `$${Number(usd || 0).toFixed(2)}`;
// How often, as typed in the form: 10m, 90s, 2 hours, own pace, until done (a fixing loop only).
export function readEvery(text, { kind = 'task', min = minSecs() } = {}) {
  const t = String(text ?? '').trim().replace(/^every\s+/i, '');
  if (/^(until( it is)? done|until done|until the tests pass)$/i.test(t)) return kind === 'debug' ? { every: null, until: true, note: '' } : { error: 'Only a loop that fixes tests runs until done: give a time, or its own pace' };
  if (NONE.test(t) || /^(its )?own pace$/i.test(t)) return kind === 'debug' && !/pace/i.test(t) ? { every: null, until: true, note: '' } : { every: null, until: false, note: '' };
  const m = new RegExp(String.raw`^(\d+(?:\.\d+)?)\s*${UNIT_WORD}$`, 'i').exec(t);
  if (!m) return { error: 'How often: a time like 10m, 90s or 2h, or "own pace"' };
  const secs = secsOf(m);
  return secs < min ? { every: min, until: false, note: ` (the shortest gap is ${everyWord(min)})` } : { every: secs, until: false, note: '' };
}
// Stop at: a time of day (18:30, 6pm, 6:30 pm: the next time it comes round) or a while from now (2h).
export function readStopAt(text, now = Date.now()) {
  const t = String(text ?? '').trim();
  if (NONE.test(t)) return { stopAt: null };
  const lead = new RegExp(String.raw`^(?:in\s+)?(\d+(?:\.\d+)?)\s*${UNIT_WORD}$`, 'i').exec(t);
  if (lead) return { stopAt: now + secsOf(lead) * 1000 };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t);
  if (!m || (!m[2] && !m[3])) return { error: 'Stop at: a time like 18:30 or 6pm, or a while like 2h' };
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]) { if (h < 1 || h > 12) return { error: 'Stop at: an hour from 1 to 12 with am or pm' }; h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0); }
  if (h > 23 || min > 59) return { error: 'Stop at: a time like 18:30' };
  const at = new Date(now);
  at.setHours(h, min, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return { stopAt: at.getTime() };
}
export function readRuns(text) {
  const t = String(text ?? '').trim().replace(/\s*runs?$/i, '');
  if (NONE.test(t)) return { maxRuns: null };
  return /^\d+$/.test(t) && Number(t) >= 1 && Number(t) <= 1000 ? { maxRuns: Number(t) } : { error: 'Stop after: a number of runs, 1 to 1000, or "no limit"' };
}
export function readCap(text) {
  const t = String(text ?? '').trim();
  if (NONE.test(t)) return { usdCap: null };
  const m = /^\$?\s*(\d+(?:\.\d{1,2})?)$/.exec(t);
  return m && Number(m[1]) > 0 ? { usdCap: Number(m[1]) } : { error: 'Spending cap: dollars, like $1 or 0.50, or "none"' };
}
export function readSteps(text) {
  const t = String(text ?? '').trim().replace(/\s*steps?$/i, '');
  if (NONE.test(t) || /^(default|as \/?effort)$/i.test(t)) return { steps: null };
  return /^\d+$/.test(t) && Number(t) >= 5 && Number(t) <= 200 ? { steps: Number(t) } : { error: 'Steps a run: 5 to 200, or "as /effort"' };
}
// A loop's page check (rules/loops: "- Page check: {page}"), its blank answered: "index.html · who can use it"
// → { page, access }; nothing → null. Its run checks the page before it starts (cli.jsx, flows/layoutcheck.mjs).
export function readCheck(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const page = t.replace(/\s*·.*$/, '').trim();
  return page ? { page, access: /·\s*(who can use it|access)/i.test(t) } : null;
}
export const checkWords = (c) => (c ? `${c.page}${c.access ? ' · who can use it' : ''}` : '');
// The form's fields, as typed, made into a loop's rules. Answers { rules } or { error, field }.
export function rulesOf(f, { now = Date.now(), min = minSecs() } = {}) {
  const message = String(f.message ?? '').trim();
  if (!message) return { error: 'A loop needs a message: what should each run do?', field: 'message' };
  const kind = KINDS.includes(f.kind) ? f.kind : guessKind(message);
  const steps = [['every', readEvery(f.every, { kind, min })], ['runs', readRuns(f.runs)], ['stopAt', readStopAt(f.stopAt, now)], ['cap', readCap(f.cap)], ['steps', readSteps(f.steps)]];
  const bad = steps.find(([, r]) => r.error);
  if (bad) return { error: bad[1].error, field: bad[0] };
  const mode = LOOP_MODES.includes(f.mode) || f.mode === 'bypass' ? f.mode : 'ask';
  const [every, runs, stopAt, cap, st] = steps.map(([, r]) => r);
  // A loop loaded or saved by name keeps it (loop-files.mjs); else a name from its words.
  const name = String(f.name ?? '').trim().slice(0, 60) || (PRESET[kind] === message ? PRESET_NAME[kind] : nameOf(message));
  return { rules: { message, kind, name, every: every.every, until: every.until, maxRuns: runs.maxRuns, stopAt: stopAt.stopAt, usdCap: cap.usdCap, steps: st.steps, mode, askFirst: Boolean(f.askFirst), picture: f.picture ?? null, ...('check' in f ? { check: readCheck(f.check) } : {}) }, note: every.note };
}
// A loop's rules as the form shows them, to change them.
export function fieldsOf(l) {
  return { message: l.message, kind: l.kind, every: l.until ? 'until done' : l.every ? everyWord(l.every) : 'own pace', runs: l.maxRuns ? String(l.maxRuns) : 'no limit', stopAt: l.stopAt ? hm(l.stopAt) : 'none', cap: l.usdCap ? money(l.usdCap) : 'none', steps: l.steps ? String(l.steps) : STEPS_WORD, mode: l.mode ?? 'ask', askFirst: Boolean(l.askFirst), ...(l.check ? { check: checkWords(l.check) } : {}) };
}
// Why a loop has reached one of its limits, or null. Runs stopped to start over do not count.
export function limitWhy(l, now = Date.now()) {
  if (l.maxRuns && (l.counted ?? 0) >= l.maxRuns) return `ran its ${l.maxRuns} run${l.maxRuns === 1 ? '' : 's'}`;
  if (l.stopAt && now >= l.stopAt) return `reached its stop time, ${hm(l.stopAt)}`;
  if (l.usdCap && (l.spent ?? 0) >= l.usdCap) return `spent ${money(l.spent)} of its ${money(l.usdCap)}`;
  return null;
}
// The limits a loop has, a few words each, for the window's list (short: for a box on the board).
export function limitWords(l, { short = false } = {}) {
  const out = [];
  if (l.maxRuns) out.push(short ? `${l.counted ?? 0}/${l.maxRuns} runs` : `${l.counted ?? 0} of ${l.maxRuns} runs`);
  if (l.stopAt) out.push(short ? `till ${hm(l.stopAt)}` : `ends ${hm(l.stopAt)}`);
  const whole = (usd) => money(usd).replace(/\.00$/, '');
  if (l.usdCap) out.push(short ? `${whole(l.spent)}/${whole(l.usdCap)}` : `${money(l.spent)} of ${money(l.usdCap)}`);
  return out;
}
// The rewind copies of one loop's runs (rewind.mjs), kept apart from the window's own.
export const sessionOf = (pid, id) => `loop-${pid}-${id}`;

// The lines a run's message ends with: which run this is, a line for each earlier run (the last
// JOURNAL of them, the newest said in full), and the two words a run can end the loop or set its
// own pace with. Before 4 Oct 2026 only the last run was told, so a later run could try again what
// an earlier one had tried and seen fail.
const JOURNAL = 8;
export function loopNote(loop, n, { now = Date.now() } = {}) {
  const at = (t) => new Date(t).toTimeString().slice(0, 5);
  const parts = [`Run ${n} of a loop that ${loop.until ? 'runs until its job is done' : loop.every ? `runs every ${everyWord(loop.every)}` : 'paces itself'}; each run is a fresh conversation.`];
  const runs = loop.runs.slice(-JOURNAL);
  if (runs.length) {
    const earlier = runs[0].n - 1;
    const line = (r, max) => {
      const words = String((r.unconfirmed || (r.reason && r.reason !== 'done') ? r.summary : r.said || r.summary) || 'nothing said').replace(/\s+/g, ' ').trim();
      const fails = r.failing > 0 ? `, ${r.failing} test${r.failing === 1 ? '' : 's'} still failing` : '';
      return `- Run ${r.n} at ${at(r.startedAt)}${fails}: ${words.length > max ? `${words.slice(0, max - 1)}…` : words}`;
    };
    // A loop that checks or reads the same thing each run is meant to repeat itself; one that fixes or makes something is not.
    const anew = ['debug', 'task'].includes(loop.kind) ? '\nDo not try again what an earlier run tried and saw fail.' : '';
    parts.push(`What the earlier runs did${earlier > 0 ? ` (the last ${runs.length}; ${earlier} before them are not listed)` : ''}, oldest first:\n${runs.map((r, i) => line(r, i === runs.length - 1 ? 400 : 160)).join('\n')}${anew}\n`);
  }
  const last = loop.runs.at(-1);
  if (last?.unconfirmed) {
    const u = last.unconfirmed;
    parts.push(`Run ${last.n} said LOOP DONE, but ${u.timedOut ? `the app's own run of ${u.command} did not finish in time` : `when the app ran ${u.command} itself, ${u.failed ?? 'some'} test${u.failed === 1 ? '' : 's'} failed${u.failing?.length ? ` (${u.failing.slice(0, 5).join('; ')})` : ''}`}. The loop goes on until that command passes.`);
  }
  parts.push(`If the whole job is finished for good and no further run is needed, end your answer with the line: LOOP DONE${loop.kind === 'debug' && !loop.check ? ' (the app then runs the tests itself, and the loop ends only if they pass)' : ''}`);
  if (!loop.every && !loop.until) parts.push('You may set when the next run starts by ending with the line: NEXT RUN IN <minutes> MIN');
  return `(${parts.join(' ').replace(/\n /g, '\n')})`;
}
// A debugging loop that is not getting closer: its last two runs ended with tests failing, the
// second with as many as the first or more. Answers why in a line, or null. It then waits for
// you (Loops.finish) instead of trying the same thing again: a note, r or p sends it on.
export function stuckWhy(loop) {
  if (loop.kind !== 'debug') return null;
  const [b, a] = loop.runs.slice(-2);
  // A loop that fixes a page (its page check): by the problems the check still found after each run.
  if (loop.check) {
    const left = (r) => r?.page?.left;
    if (!a || !b || [a, b].some((r) => r.reason === 'interrupted') || !(left(a) > 0) || !(left(b) > 0) || left(a) < left(b)) return null;
    return `${left(a)} problem${left(a) === 1 ? '' : 's'} still on the page after runs ${b.n} and ${a.n}: it is not getting closer`;
  }
  if (!a || !b || [a, b].some((r) => r.reason === 'interrupted') || !(a.failing > 0) || !(b.failing > 0) || a.failing < b.failing) return null;
  const n = a.failing;
  return `${n} test${n === 1 ? '' : 's'} still fail${n === 1 ? 's' : ''} after runs ${b.n} and ${a.n}: it is not getting closer`;
}
// What a run's last words say about the loop: done for good, and when to run next.
export function readEnding(text) {
  const t = String(text ?? '');
  const next = /^\W*NEXT RUN IN (\d+(?:\.\d+)?)\s*MIN/im.exec(t);
  return { done: /^\W*LOOP DONE\W*$/im.test(t), nextSecs: next ? Math.min(3600, Math.max(60, Math.round(Number(next[1]) * 60))) : null, said: t.replace(/^\W*(LOOP DONE|NEXT RUN IN [\d.]+\s*MIN\w*)\W*$/gim, '').trim() };
}
// The page check's line on the board: checking, what it found, or why it could not look.
export function pageWords(ev) {
  const what = ev.when === 'after' ? 'After the run, the page check' : 'The page check';
  if (ev.when === 'start') return `Checking ${ev.page} in a hidden browser…`;
  if (ev.skipped) return `${what} of ${ev.page} could not run: ${ev.skipped}`;
  return `${what} of ${ev.page}: ${ev.count ? `${ev.count} problem${ev.count === 1 ? '' : 's'}` : 'nothing broken'} (${Number(ev.secs ?? 0).toFixed(1)} s)`;
}
// The app's own run of the tests after a LOOP DONE, in a line for the run's log on the board.
export function confirmWords(ev) {
  if (ev.when === 'start') return `It said LOOP DONE: checking with ${ev.command}…`;
  if (ev.skipped) return `It said LOOP DONE; nothing to check it with (${ev.skipped})`;
  if (ev.timedOut) return `${ev.command} did not finish in time: not done`;
  if (ev.ok) return `${ev.command} passes (${Number(ev.secs ?? 0)} s): done`;
  return `${ev.command}: ${ev.failed ?? 'some'} test${ev.failed === 1 ? '' : 's'} still fail: not done`;
}
// A run that said LOOP DONE while the app's run of the tests failed, in a line (its summary).
export function unconfirmedWords(u) {
  return u.timedOut ? `said done, but ${u.command} did not finish in time` : `said done, but ${u.failed ?? 'some'} test${u.failed === 1 ? '' : 's'} still fail (${u.command})`;
}
// One line about how a run ended, for the board.
export function summaryOf(said, reason) {
  const t = String(said ?? '').replace(/[*`#>]/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const line = t.find((l) => /[a-z]/i.test(l)) ?? '';
  const one = line.length > 90 ? `${line.slice(0, 89)}…` : line;
  if (reason === 'done') return one || 'done, nothing said';
  const why = { interrupted: 'stopped', declined: 'you said no', error: 'it failed', steps: 'out of steps', stuck: 'stuck' }[reason] ?? `stopped (${reason})`;
  return one ? `${why}: ${one}` : why;
}

// /loop <n> <what>: every 7m · runs 5 · stop 18:30 · cap $1 · mode auto · steps 20 · ask on|off · go · skip ·
// undo [run] · redo [keep] [note] · note <text> · message <text> · again · stop · pause · run.
// Answers { id, op, … } or { error }.
export const LOOP_HELP = '/loop <n> every 7m · runs 5 · stop 18:30 · cap $1 · mode auto · steps 20 · ask on · go · skip · undo · redo <note> · note <text> · message <text> · again · stop · pause · run';
// A number then one of these words is a loop's rule; a number then a time ("/loop 10 minutes …") is a new loop.
const VERBS = 'every|pace|runs|after|until|stop|end|ends|cap|spend|steps|mode|ask|message|edit|undo|redo|over|note';
export const isLoopCommand = (text) => new RegExp(String.raw`^\d+(\s+(${VERBS})\b.*|\s+(again|go|skip|pause|run)\s*)?$`, 'is').test(String(text ?? '').trim());
export function loopCommand(text, { now = Date.now(), min = minSecs() } = {}) {
  const m = /^(\d+)\s*(\S*)\s*(.*)$/s.exec(String(text ?? '').trim());
  if (!m) return { error: LOOP_HELP };
  const id = Number(m[1]);
  const verb = m[2].toLowerCase();
  const rest = m[3].trim();
  const rule = (r) => (r.error ? { error: r.error } : { id, op: 'rule', rules: r.rules, note: r.note ?? '' });
  if (verb === 'every' || verb === 'pace') {
    const e = readEvery(rest, { kind: /until/i.test(rest) ? 'debug' : 'task', min });
    return e.error ? e : rule({ rules: { every: e.every, until: e.until }, note: e.note });
  }
  if (verb === 'runs' || verb === 'after') { const r = readRuns(rest); return r.error ? r : rule({ rules: { maxRuns: r.maxRuns } }); }
  if (verb === 'until' && /^done$/i.test(rest)) return rule({ rules: { every: null, until: true } });
  if ((verb === 'stop' && rest) || verb === 'until' || verb === 'end' || verb === 'ends') { const r = readStopAt(rest.replace(/^at\s+/i, ''), now); return r.error ? r : rule({ rules: { stopAt: r.stopAt } }); }
  if (verb === 'cap' || verb === 'spend') { const r = readCap(rest); return r.error ? r : rule({ rules: { usdCap: r.usdCap } }); }
  if (verb === 'steps') { const r = readSteps(rest); return r.error ? r : rule({ rules: { steps: r.steps } }); }
  if (verb === 'mode') {
    const w = rest.toLowerCase().replace(/\s+/g, '-');
    const mode = { manual: 'ask', ask: 'ask', 'accept-edits': 'edits', accept: 'edits', edits: 'edits', auto: 'auto', plan: 'plan', bypass: 'bypass' }[w];
    return mode ? rule({ rules: { mode } }) : { error: 'Mode: manual, accept edits, auto or plan' };
  }
  if (verb === 'ask') return /^(on|off)$/i.test(rest) ? rule({ rules: { askFirst: /on/i.test(rest) } }) : { error: 'Ask first: /loop <n> ask on, or ask off' };
  if (verb === 'message' || verb === 'edit') {
    if (!rest) return { error: 'A loop needs a message' };
    return rule({ rules: { message: rest, name: nameOf(rest), kind: guessKind(rest) } });
  }
  if (verb === 'undo') { const n = /^(?:run\s*)?(\d+)$/i.exec(rest); return { id, op: 'undo', n: n ? Number(n[1]) : null }; }
  if (verb === 'redo' || verb === 'over') { const k = /^keep\b\s*/i.exec(rest); return { id, op: 'redo', keep: Boolean(k), text: k ? rest.slice(k[0].length) : rest }; }
  if (verb === 'note') return rest ? { id, op: 'note', text: rest } : { error: 'A note needs words: /loop <n> note <text>' };
  if (['again', 'go', 'skip', 'stop', 'pause', 'run'].includes(verb) && !rest) return { id, op: verb };
  return { error: LOOP_HELP };
}

// One line about a loop, for the window's own notes (/loop alone lists them).
export function describe(l, now = Date.now()) {
  const pace = l.until ? 'until its job is done' : l.every ? `every ${everyWord(l.every)}` : 'at its own pace';
  const left = Math.max(0, Math.round((l.nextAt - now) / 1000));
  const state = l.current?.needs ? 'needs you' : l.current ? `running (run ${l.current.n})` : l.stuck ? `needs you: ${l.stuck}` : l.ready ? `run ${l.ready.n} waits for your go` : l.state === 'redoing' ? 'starting over' : l.state === 'paused' ? 'paused' : l.state === 'off' ? `waits: ${l.offWhy ?? 'the model is off'}` : l.state === 'done' ? `ended: ${l.doneWhy}` : l.state === 'stopped' ? 'stopped' : l.queued ? 'next in line' : `next run in ${left < 90 ? `${left}s` : `${Math.round(left / 60)}m`}`;
  return [l.kind, pace, ...limitWords(l), state].join(' · ');
}
