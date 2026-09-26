#!/usr/bin/env bun
// bonsai — a Claude Code-style coding agent that runs a local Bonsai model.
import React from 'react';
import { render } from 'ink';
import { App } from './app/App.jsx';
import { primeRows } from './app/screen.jsx';
import { TerminalWindow, MIN_COLS } from './app/window.mjs';
import { MODELS, DEFAULT_MODEL, ModelServer, chooseContext, setup, stopIdleServers, LINGER_SECS, modelPath, modelById } from '../../models/index.mjs';
import { runHeadless } from './headless.mjs';
import { createInterface } from 'node:readline';
import { pickOnTerminal } from './app/pick.mjs';

// bonsai -p: a question from Bonsai is printed and answered on the same
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
import { isTrusted, saveTrust } from './app/trust.mjs';

import { VERSION, cliHelpText } from './app/help.mjs';
export { VERSION };

// Claude Code's quick safety check: the first visit to a folder asks once
// whether you trust it, before anything there is read into the model or
// run. A yes covers the folder and everything inside it (app/trust.mjs).
async function ensureTrusted(cwd) {
  if (isTrusted(cwd)) return true;
  if (!process.stdin.isTTY) {
    process.stderr.write(`bonsai: ${cwd} is not a trusted folder yet. Start bonsai there once and say yes to the safety check.\n`);
    return false;
  }
  const b = (s) => `\x1b[1m${s}\x1b[0m`;
  process.stderr.write([
    '',
    `\x1b[33m${b('Quick safety check')}\x1b[0m`,
    '',
    'Bonsai is about to work in:',
    `  ${b(cwd)}`,
    '',
    'Is this a folder you created or one you trust? Bonsai reads its notes',
    '(AGENTS.md) into the model, and can read, edit and run things here once',
    'you allow them. A yes covers this folder and everything inside it, and',
    'is remembered.',
    '',
    '',
  ].join('\n'));
  // A menu like the ones inside the app: arrows move ❯, enter picks, 1 or 2 pick at once.
  const pick = await pickOnTerminal(['Yes, I trust this folder', 'No, exit']);
  if (pick === 0) { saveTrust(cwd); return true; }
  process.stderr.write('\x1b[2mNothing was read here. Start bonsai in a folder you trust.\x1b[0m\n');
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
  if (r.inUse.length) process.stdout.write(`Still in use by an open Bonsai window: ${r.inUse.map(gb).join(', ')}. Quit that window first.\n`);
  if (!r.stopped.length && !r.inUse.length) process.stdout.write('No model is loaded.\n');
  process.exit(0);
}
if (process.argv[2] === 'weights' || process.argv[2] === 'docs') {
  const { existsSync } = await import('node:fs');
  const path = modelPath(MODELS[DEFAULT_MODEL]);
  if (!existsSync(path)) { process.stderr.write(`bonsai weights: the model file is not here yet (${path}). Run bonsai setup first.\n`); process.exit(1); }
  const { startWeightsServer } = await import('./app/weights.mjs');
  const s = startWeightsServer({ path });
  const url = `${s.url}?tab=${process.argv[2] === 'docs' ? 'harness' : 'weights'}`;
  process.stdout.write(`Bonsai hub: ${s.name} (${(s.size / 1e9).toFixed(2)} GB) and the pages in ${s.docsDir ? s.docsDir.replace(process.env.HOME, '~') : 'no DOCS folder (not found)'} at ${url}\nThe page reads the files through this window. Press ctrl+c to close it.\n`);
  if (!process.env.BONSAI_NO_OPEN) Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' });
  process.on('SIGINT', () => { s.stop(); process.exit(0); });
  await new Promise(() => {});
}
if (process.argv[2] === 'setup') {
  try { await setup(); process.exit(0); } catch (e) { process.stderr.write(`\nbonsai setup: ${e.message}\n`); process.exit(1); }
}

const opts = parse(process.argv.slice(2));
if (opts.help) { process.stdout.write(HELP); process.exit(0); }
if (opts.version) { process.stdout.write(`${VERSION}\n`); process.exit(0); }
// The model picked last time (kept by /model) — the edited copy included,
// when its file and manifest are still there.
opts.modelId = (modelById(opts.modelId) ?? modelById(loadSettings(opts.cwd).model) ?? MODELS[DEFAULT_MODEL]).id;

if (opts.print) {
  if (!opts.prompt) { process.stderr.write('bonsai -p needs a prompt\n'); process.exit(2); }
  if (!(await ensureTrusted(opts.cwd))) process.exit(2);
  const model = modelById(opts.modelId) ?? MODELS[DEFAULT_MODEL];
  const settings = loadSettings(opts.cwd);
  let server = null;
  let url = opts.url;
  let ctx = opts.ctx;
  let slots;
  if (!url) {
    const thinkOn = opts.thinking ?? settings.thinking ?? model.thinkingDefault ?? true;
    const c = chooseContext(model, { effort: thinkOn ? opts.effort ?? settings.effort : undefined });
    ctx ??= c.ctx;
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
      thinking: opts.thinking ?? settings.thinking ?? model.thinkingDefault ?? true, effort: opts.effort ?? settings.effort, autoApprove: !!opts.yes, flows: opts.flows, slots, warm: !!slots,
      // Bonsai's questions: asked on the terminal when there is one; otherwise unanswered.
      answers: process.stdin.isTTY ? askOnTerminal : null,
      onEvent: (type, ev) => { if (type === 'tool') process.stderr.write(`${ev.error ? '✗' : '⏺'} ${ev.label}(${ev.arg})\n`); if (type === 'note') process.stderr.write(`· ${ev.text}\n`); },
    });
    process.stdout.write(`${r.finalText.trim()}\n`);
    await stop();
    process.exit(r.reason === 'done' ? 0 : 1);
  } catch (e) {
    process.stderr.write(`bonsai: ${e.message}\n`);
    await stop();
    process.exit(1);
  }
} else {
  if (!process.stdin.isTTY) { process.stderr.write('bonsai needs a terminal. For scripts use: bonsai -p "…"\n'); process.exit(2); }
  // Step 1, before anything in the folder is read: the safety check.
  if (!(await ensureTrusted(opts.cwd))) process.exit(0);
  // What the start loaded, for the welcome box: the notes read into the
  // model, settings a folder file set, and the git state.
  try {
    const { projectNotes, gitSummary } = await import('./agent/prompt.mjs');
    const names = [...new Set(projectNotes(opts.cwd).files.map((p) => (p.endsWith('/.bonsai/notes.md') ? '.bonsai/notes.md' : p.split('/').pop())))];
    const st = loadSettings(opts.cwd);
    const git = gitSummary(opts.cwd);
    opts.loaded = [
      names.join(' + ') || 'no AGENTS.md',
      ...(st.fromFolder?.length ? [`folder settings (${st.fromFolder.filter((k) => k !== 'thinking').join(', ')})`] : []),
      git === 'not a git repository' ? 'no git' : `git: ${git}`,
    ].join(' · ');
  } catch {}
  // A clear window, as `clear` leaves it (what was on screen moves up into
  // the scrollback): the welcome starts on the top line, the prompt box sits
  // on the last lines, with space in between.
  if (process.stdout.isTTY) process.stdout.write(`${'\n'.repeat(process.stdout.rows || 24)}\x1b[H`);
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
  process.stdout.write('\x1b[2m  Saved. Continue this conversation with: bonsai -c\x1b[0m\n');
  process.exit(0);
}
