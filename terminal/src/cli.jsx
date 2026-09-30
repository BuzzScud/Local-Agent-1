#!/usr/bin/env bun
// coding — a Claude Code-style coding agent that runs a local Agentic Coder model.
import React from 'react';
import { render } from 'ink';
import { App } from './app/App.jsx';
import { primeRows } from './app/screen.jsx';
import { TerminalWindow, MIN_COLS } from './app/window.mjs';
import { MODELS, DEFAULT_MODEL, macMemory, ModelServer, chooseContext, contextCheck, otherCopies, hasDraft, setup, stopIdleServers, scanServers, LINGER_SECS, modelPath, modelById } from '../../models/index.mjs';
import { readLimits, modelWithLimits } from './app/limits.mjs';
import { runHeadless } from './headless.mjs';
import { createInterface } from 'node:readline';
import { pickOnTerminal } from './app/pick.mjs';

// coding -p: a question from Agentic Coder is printed and answered on the same
// terminal. Its choices are a menu like the app's (arrows, enter, or the
// number), with "Type an answer" as the last row; esc skips the question.
// A question with no choices takes a typed line.
async function askOnTerminal(question, req) {
  const options = req?.args?.options ?? [];
  process.stderr.write(`\n? ${question}\n`);
  if (options.length) {
    const pick = await pickOnTerminal([...options, 'Type an answer'], { hint: 'Enter to confirm · Esc to skip' });
    if (pick === null) return null;
    if (pick < options.length) return options[pick];
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const line = await new Promise((resolve) => rl.question('> ', resolve));
  rl.close();
  return line.trim() || null;
}
import { loadSettings } from './app/store.mjs';
import { helpersFrom } from './app/helpers.mjs';
import { memoryOn } from './app/autosave.mjs';
import { claudeOn } from './agent/claude-notes.mjs';
import { openMemory } from './agent/facts.mjs';
import { isTrusted, saveTrust } from './app/trust.mjs';
import { rulesFor } from './app/perm-store.mjs';
import { modeWord } from './app/perms.mjs';

import { VERSION, cliHelpText } from './app/help.mjs';
export { VERSION };

// Claude Code's quick safety check: the first visit to a folder asks once
// whether you trust it, before anything there is read into the model or
// run. A yes covers the folder and everything inside it (app/trust.mjs).
async function ensureTrusted(cwd) {
  if (isTrusted(cwd)) return true;
  if (!process.stdin.isTTY) {
    process.stderr.write(`coding: ${cwd} is not a trusted folder yet. Start coding there once and say yes to the safety check.\n`);
    return false;
  }
  const b = (s) => `\x1b[1m${s}\x1b[0m`;
  process.stderr.write([
    '',
    `\x1b[33m${b('Quick safety check')}\x1b[0m`,
    '',
    'Agentic Coder is about to work in:',
    `  ${b(cwd)}`,
    '',
    'Is this a folder you created or one you trust? Agentic Coder reads its notes',
    '(AGENTS.md) into the model, and can read, edit and run things here once',
    'you allow them. A yes covers this folder and everything inside it, and',
    'is remembered.',
    '',
    '',
  ].join('\n'));
  // A menu like the ones inside the app: arrows move ❯, enter picks, 1 or 2 pick at once.
  const pick = await pickOnTerminal(['Yes, I trust this folder', 'No, exit']);
  if (pick === 0) { saveTrust(cwd); return true; }
  process.stderr.write('\x1b[2mNothing was read here. Start coding in a folder you trust.\x1b[0m\n');
  return false;
}

const HELP = cliHelpText({ version: VERSION, modelName: MODELS[DEFAULT_MODEL].name, lingerMins: LINGER_SECS / 60 });

function parse(argv) {
  const o = { cwd: process.cwd() };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '-p' || a === '--print') { o.print = true; if (argv[i + 1] && !argv[i + 1].startsWith('-')) rest.push(val()); }
    else if (a === '-c' || a === '--continue') o.continueLast = true;
    else if (a === '--resume') o.resumeId = val();
    else if (a === '--layout') val(); // one layout now (like Claude Code); still accepted so older scripts run
    else if (a === '--effort') { const v = String(val() ?? '').toLowerCase().replace(/^off$/, 'low').replace(/^xhigh$/, 'high'); o.thinking = v !== 'low'; if (v === 'medium' || v === 'high') o.effort = v; }
    else if (a === '--think') o.thinking = true;
    else if (a === '--no-think') o.thinking = false;
    else if (a === '--ctx') { const v = val(); o.ctx = /^\d+k$/i.test(v) ? Number.parseInt(v, 10) * 1024 : Number(v); }
    else if (a === '--mode') o.mode = val();
    else if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--url') o.url = val();
    // --slots 2: the server given with --url keeps two slots (llama-server -np 2), so
    // side jobs (sorting, the memory's save) get their own and leave the conversation's alone.
    else if (a === '--slots') o.slots = Number(val());
    else if (a === '--no-flows') o.flows = false;
    else rest.push(a);
  }
  if (rest.length) o.prompt = rest.join(' ');
  return o;
}

if (process.argv[2] === 'stop') {
  const r = stopIdleServers();
  const gb = (e) => `the model on port ${e.port}`;
  if (r.stopped.length) process.stdout.write(`Stopped ${r.stopped.map(gb).join(', ')}; its memory is free.\n`);
  if (r.inUse.length) process.stdout.write(`Still in use by an open Agentic Coder window: ${r.inUse.map(gb).join(', ')}. Quit that window first.\n`);
  if (!r.stopped.length && !r.inUse.length) process.stdout.write('No model is loaded.\n');
  process.exit(0);
}
// The save a closed window handed over (app/autosave.mjs). Nobody watches it.
if (process.argv[2] === 'memory-save') {
  const { runJob } = await import('./app/autosave.mjs');
  try { await runJob(process.argv[3]); process.exit(0); } catch { process.exit(1); }
}
// The memory's review at night (app/review.mjs), and its place in the Mac's scheduler.
if (process.argv[2] === 'memory-review') {
  const { review, install, uninstall, installed, look, whyNot, HOURS, IDLE_MINS } = await import('./app/review.mjs');
  const flag = (f) => process.argv.includes(f);
  try {
    if (flag('--install')) { process.stdout.write(`The review is scheduled: once an hour between ${HOURS[0]} and ${HOURS.at(-1) + 1} in the morning, when the Mac is on power and was not used for ${IDLE_MINS} minutes.\n${install()}\ncoding memory-review --uninstall removes it.\n`); process.exit(0); }
    if (flag('--uninstall')) { process.stdout.write(uninstall() ? 'The review is no longer scheduled.\n' : 'The review was not scheduled.\n'); process.exit(0); }
    if (flag('--status')) { const no = whyNot(look()); process.stdout.write(`${installed() ? 'Scheduled' : 'Not scheduled (coding memory-review --install)'}. Right now it would ${no ? `not run: ${no}` : 'run'}.\n`); process.exit(0); }
    const r = await review({ now: flag('--now') });
    if (process.stdout.isTTY) process.stdout.write(r.ran ? `Read ${r.read} conversation${r.read === 1 ? '' : 's'}: ${r.added} saved${r.stopped ? '; stopped, an Agentic Coder window opened' : ''}.\n` : `Not now: ${r.why}. (--now skips the clock, the power and the idle check.)\n`);
    process.exit(0);
  } catch (e) { process.stderr.write(`coding memory-review: ${e.message}\n`); process.exit(1); }
}
// coding hub [tab]: the hub in the browser, on one of its tabs (weights when
// none is named). The old one-word forms (coding docs, coding tests…) still work.
const HUB_TABS = { weights: 'weights', docs: 'harness', harness: 'harness', structure: 'structure', flow: 'flow', tests: 'tests', battle: 'battle', memory: 'memory', instructions: 'instructions', help: 'help' };
const OLD_HUB = ['weights', 'docs', 'tests', 'battle', 'memory', 'instructions'];
if (process.argv[2] === 'hub' || OLD_HUB.includes(process.argv[2])) {
  const name = process.argv[2] === 'hub' ? (process.argv[3] ?? 'weights').toLowerCase() : process.argv[2];
  if (!HUB_TABS[name]) { process.stderr.write(`coding hub: no tab called ${name}. Tabs: ${Object.keys(HUB_TABS).join(', ')}.\n`); process.exit(1); }
  const { existsSync } = await import('node:fs');
  const path = modelPath(MODELS[DEFAULT_MODEL]);
  if (name === 'weights' && !existsSync(path)) { process.stderr.write(`coding hub: the model file is not here yet (${path}). Run coding setup first, or open another tab (coding hub docs).\n`); process.exit(1); }
  const { startWeightsServer } = await import('./app/weights.mjs');
  const s = startWeightsServer({ path, cwd: process.cwd() });
  const url = `${s.url}?tab=${HUB_TABS[name]}`;
  process.stdout.write(`Agentic Coder hub: ${s.name} (${(s.size / 1e9).toFixed(2)} GB) and the pages in ${s.docsDir ? s.docsDir.replace(process.env.HOME, '~') : 'no DOCS folder (not found)'} at ${url}\nThe page reads the files through this window. Press ctrl+c to close it.\n`);
  if (!(process.env.AGENTIC_NO_OPEN ?? process.env.BONSAI_NO_OPEN)) Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' });
  process.on('SIGINT', () => { s.stop(); process.exit(0); });
  await new Promise(() => {});
}
// coding morning [today|yesterday|YYYY-MM-DD] [--plain]: the morning brief from
// any shell. It joins a loaded model (on its side slot) or starts one just for
// this and stops it after; --plain skips the model and writes plain words.
if (process.argv[2] === 'morning') {
  const { runMorning } = await import('./morning/index.mjs');
  const { complete } = await import('./flows/llm.mjs');
  const a = process.argv.slice(3);
  const day = a.find((x) => /^(today|yesterday|\d{4}-\d{2}-\d{2})$/.test(x)) ?? 'auto';
  const say = (t) => process.stderr.write(`${t}\n`);
  const model = modelById(loadSettings(process.cwd()).model) ?? MODELS[DEFAULT_MODEL];
  let server = null, url = null, slot;
  if (!a.includes('--plain')) {
    try {
      // Only one copy of the 27B fits the GPU (two made a Compute error on 26 Sep):
      // a copy another window is still loading is waited for and then shared, and
      // a copy running outside Agentic Coder's list means plain words, not a second copy.
      const loading = scanServers().find((e) => e.model === model.file);
      if (loading) {
        const t0 = Date.now();
        let said = false;
        while (Date.now() - t0 < 180_000) {
          try { if ((await fetch(`http://127.0.0.1:${loading.port}/health`)).ok) break; } catch {}
          if (!said) { say('· Waiting for the model another window is loading'); said = true; }
          await Bun.sleep(1000);
        }
      } else if (Bun.spawnSync(['pgrep', '-f', `llama-server.*${model.file}`]).stdout.toString().trim()) {
        throw new Error('another copy of the model is running outside Agentic Coder, and two do not fit');
      }
      server = new ModelServer(model);
      const st = await server.start({ ctx: chooseContext(model, { want: 16_384 }).ctx, helper: false });
      slot = st.shared && st.slots > 1 ? 1 : 0;
      url = server.url;
      say(st.shared ? '· Using the model already loaded' : '· Loaded the model for this brief');
    } catch (e) { say(`· The model could not start (${e.message}), so the words will be plain`); server = null; }
  }
  const stop = async () => { await server?.stop(); };
  process.on('SIGINT', async () => { await stop(); process.exit(130); });
  try {
    await runMorning({ day, complete: url ? complete : undefined, url, model, slot, onStep: (kind, text) => say(kind === 'done' ? text : `· ${text}`) });
    await stop();
    process.exit(0);
  } catch (e) {
    say(`coding morning: ${e.message}`);
    await stop();
    process.exit(1);
  }
}
if (process.argv[2] === 'setup') {
  try { await setup(); process.exit(0); } catch (e) { process.stderr.write(`\ncoding setup: ${e.message}\n`); process.exit(1); }
}

const opts = parse(process.argv.slice(2));
if (opts.help) { process.stdout.write(HELP); process.exit(0); }
if (opts.version) { process.stdout.write(`${VERSION}\n`); process.exit(0); }
// The model picked last time (kept by /model) — the edited copy included,
// when its file and manifest are still there.
opts.modelId = (modelById(opts.modelId) ?? modelById(loadSettings(opts.cwd).model) ?? MODELS[DEFAULT_MODEL]).id;

if (opts.print) {
  if (!opts.prompt) { process.stderr.write('coding -p needs a prompt\n'); process.exit(2); }
  if (!(await ensureTrusted(opts.cwd))) process.exit(2);
  const settings = loadSettings(opts.cwd);
  // The limits /effort saved: the context and thinking cap for the server, the rest for the agent.
  const limits = readLimits(settings, modelById(opts.modelId) ?? MODELS[DEFAULT_MODEL]);
  const model = modelWithLimits(modelById(opts.modelId) ?? MODELS[DEFAULT_MODEL], limits);
  let server = null;
  let url = opts.url;
  let ctx = opts.ctx ?? (limits.context || undefined);
  let slots = url && opts.slots > 1 ? { main: 0, side: 1 } : undefined;
  if (!url) {
    const thinkOn = opts.thinking ?? settings.thinking ?? model.thinkingDefault ?? true;
    const c = chooseContext(model, { effort: thinkOn ? opts.effort ?? settings.effort : undefined });
    ctx ??= c.ctx;
    // Another copy of the model loaded (a practice-test run, a speed test): a
    // script never waits, so it starts anyway and says so.
    for (const o of otherCopies(model)) process.stderr.write(`· ${o.who} (port ${o.port ?? '?'}, ${(o.bytes / 1e9).toFixed(1)} GB) still has ${model.name} loaded, so both may be slow\n`);
    // A context you picked is used as asked; said when it does not fit. A
    // copy already loaded is shared (server.start), so nothing loads to check.
    if (!opts.ctx && limits.context && !scanServers().some((e) => e.model === model.file)) {
      const chk = contextCheck(model, ctx, { draft: hasDraft(model) });
      if (!chk.fits) process.stderr.write(`· ${chk.note}\n`);
    }
    server = new ModelServer(model);
    const st = await server.start({ ctx, helper: ctx === c.ctx ? c.helper : undefined });
    if (st.slots > 1) slots = { main: 0, side: 1 };
    url = server.url;
  }
  const stop = () => server?.stop();
  process.on('SIGINT', async () => { await stop(); process.exit(130); });
  try {
    const r = await runHeadless({
      prompt: opts.prompt, cwd: opts.cwd, url, model, ctx: ctx ?? 32768,
      thinking: opts.thinking ?? settings.thinking ?? model.thinkingDefault ?? true, effort: opts.effort ?? settings.effort, autoApprove: !!opts.yes, flows: opts.flows, slots, warm: !!slots, limits,
      // What you saved with /permissions: commands that run without asking, and the ones that never run.
      permissions: (dir) => rulesFor(dir),
      // The context helpers: as /helpers left them (AGENTIC_HELPERS wins).
      helpers: helpersFrom(settings),
      // The design examples and the layout check: as /design left them (AGENTIC_DESIGN… wins).
      design: settings.design ?? {},
      // The memory: facts brought back, and what the run taught saved before it ends.
      memory: memoryOn(settings) ? { save: (process.env.AGENTIC_MEMORY_SAVE ?? process.env.BONSAI_MEMORY_SAVE) !== 'off', claude: claudeOn(settings) ? settings.claudeNotes ?? true : false } : false,
      // Agentic Coder's questions: asked on the terminal when there is one; otherwise unanswered.
      answers: process.stdin.isTTY ? askOnTerminal : null,
      onEvent: (type, ev) => { if (type === 'tool') process.stderr.write(`${ev.error ? '✗' : '⏺'} ${ev.label}(${ev.arg})\n`); if (type === 'note') process.stderr.write(`· ${ev.text}\n`); },
    });
    process.stdout.write(`${r.finalText.trim()}\n`);
    await stop();
    process.exit(r.reason === 'done' ? 0 : 1);
  } catch (e) {
    process.stderr.write(`coding: ${e.message}\n`);
    await stop();
    process.exit(1);
  }
} else {
  if (!process.stdin.isTTY) { process.stderr.write('coding needs a terminal. For scripts use: coding -p "…"\n'); process.exit(2); }
  // Step 1, before anything in the folder is read: the safety check.
  if (!(await ensureTrusted(opts.cwd))) process.exit(0);
  // What the start loaded, for the welcome box: the notes read into the
  // model, settings a folder file set, and the git state.
  try {
    const { projectNotes, gitSummary, notesRoom } = await import('./agent/prompt.mjs');
    const st = loadSettings(opts.cwd);
    if (memoryOn(st)) { try { openMemory(opts.cwd); } catch {} }
    const names = [...new Set(projectNotes(opts.cwd, notesRoom(), { memory: memoryOn(st) }).files.map((p) => (p.endsWith('/.bonsai/notes.md') ? '.bonsai/notes.md' : p.endsWith('/memory') ? 'memory' : p.split('/').pop())))];
    const git = gitSummary(opts.cwd);
    opts.loaded = [
      names.join(' + ') || 'no AGENTS.md',
      ...(st.fromFolder?.length ? [`folder settings (${st.fromFolder.filter((k) => k !== 'thinking').join(', ')})`] : []),
      ...(st.modeFrom && st.mode !== 'ask' ? [`${modeWord(st.mode)} (/permissions)`] : []),
      git === 'not a git repository' ? 'no git' : `git: ${git}`,
    ].join(' · ');
  } catch {}
  // A clear window, as `clear` leaves it (what was on screen moves up into
  // the scrollback): the welcome starts on the top line, the prompt box sits
  // on the last lines, with space in between.
  if (process.stdout.isTTY) process.stdout.write(`${'\n'.repeat(process.stdout.rows || 24)}\x1b[H`);
  // The Mac's memory as the window opens, printed beside the welcome box.
  // The Mac's memory for the footer's live line (App.jsx reads it again every 5 s).
  try { opts.macMem = macMemory(); } catch { opts.macMem = null; }
  // Measure the welcome before the first frame, so the space above the
  // prompt box is right from the start (App measures everything after it).
  try {
    const { homedir } = await import('node:os');
    const cwdShort = opts.cwd.startsWith(homedir()) ? `~${opts.cwd.slice(homedir().length)}` : opts.cwd;
    primeRows([{ key: 'welcome', type: 'welcome' }], { width: Math.max(MIN_COLS, process.stdout.columns || 100), modelName: (modelById(opts.modelId) ?? MODELS[DEFAULT_MODEL]).name, cwdShort, loaded: opts.loaded ?? '' });
  } catch {}
  const win = new TerminalWindow(process.stdout);
  // /update asks for a restart: set here, run once this window has closed.
  let restartArgs = null;
  const instance = render(<App opts={opts} win={win} onRestart={(a) => { restartArgs = a; }} />, { stdout: win, exitOnCtrlC: false, patchConsole: true, maxFps: 30 });
  const bye = () => { try { instance.unmount(); } catch {} };
  process.on('SIGTERM', bye);
  process.on('SIGHUP', bye);
  await instance.waitUntilExit();
  if (restartArgs) {
    // The launcher waiting on this app starts the new version (see update.mjs).
    const { leaveRestart, RESTART_CODE } = await import('./app/update.mjs');
    leaveRestart(restartArgs);
    process.stdout.write('\x1b[2m  ↻ Restarting on the update…\x1b[0m\n');
    process.exit(RESTART_CODE);
  }
  process.stdout.write('\x1b[2m  Saved. Continue this conversation with: coding -c\x1b[0m\n');
  process.exit(0);
}
