#!/usr/bin/env bun
// coding — a Claude Code-style coding agent that runs a local Agentic Coder model.
import React from 'react';
import { render, renderToString } from 'ink';
import { App } from './app/App.jsx';
import { primeRows } from './app/screen.jsx';
import { TerminalWindow, MIN_COLS, CLEAR } from './app/window.mjs';
import { MODELS, DEFAULT_MODEL, macMemory, ModelServer, chooseContext, contextCheck, otherCopies, hasDraft, setup, stopIdleServers, scanServers, LINGER_SECS, modelPath, modelById, serve, SERVE_PORT, connectRemote, remoteRisk, remoteLabel, withVision, visionPath, thinkingLevel } from '../../models/index.mjs';
import { readLimits, modelWithLimits, OWN_ROWS, ownOf } from './app/limits.mjs';
import { runHeadless } from './headless.mjs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { pickOnTerminal } from './app/pick.mjs';
import { TrustPage, TRUST_OPTIONS, FolderPage } from './app/start.jsx';
import { startFolders, folderOption, folderFacts } from './app/start-folder.mjs';

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
import { loadSettings, listSessions } from './app/store.mjs';
import { helpersFrom } from './app/helpers.mjs';
import { hooksFrom } from './agent/way.mjs';
import { memoryOn } from './app/autosave.mjs';
import { claudeOn } from './agent/claude-notes.mjs';
import { openMemory } from './agent/facts.mjs';
import { isTrusted, saveTrust } from './app/trust.mjs';
import { rulesFor } from './app/perm-store.mjs';
import { webSettings } from './app/web-form.mjs';
import { modeWord } from './app/perms.mjs';

import { VERSION, cliHelpText, setupModels } from './app/help.mjs';
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
  // The question in the start page's two columns (start.jsx): nothing here is read before a yes.
  const width = Math.max(MIN_COLS, process.stdout.columns || 100);
  const home = process.env.HOME ?? '';
  const shown = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  const model = (modelById(opts.modelId) ?? MODELS[DEFAULT_MODEL]).name;
  const page = (i) => `\n${renderToString(<TrustPage width={width} cwd={shown} model={model} selected={i} />, { columns: width })}\n\n`;
  // A menu like the ones inside the app: arrows move ❯, enter picks, 1 or 2 pick at once.
  const pick = await pickOnTerminal(TRUST_OPTIONS, { page });
  if (pick === 0) { saveTrust(cwd); return true; }
  process.stderr.write('\x1b[2mNothing was read here. Start coding in a folder you trust.\x1b[0m\n');
  return false;
}

// Typed in the home folder: which folder to work in, before the safety check (app/start-folder.mjs).
// The folder picked, or null (esc: nothing started). The window is cleared first, so the page starts
// on its top line, not under the "Last login" and prompt lines a new Terminal window opens with.
async function pickStartFolder(folders) {
  const width = Math.max(MIN_COLS, process.stdout.columns || 100);
  const model = (modelById(opts.modelId) ?? MODELS[DEFAULT_MODEL]).name;
  const options = folders.map(folderOption);
  const cards = folders.map((f) => folderFacts(f));
  const page = (i) => `${renderToString(<FolderPage width={width} folders={cards} model={model} selected={i} />, { columns: width })}\n\n`;
  if (process.stderr.isTTY) process.stderr.write(CLEAR);
  const pick = await pickOnTerminal(options, { page });
  return pick === null ? null : folders[pick].path;
}

const HELP = cliHelpText({ version: VERSION, modelName: MODELS[DEFAULT_MODEL].name, lingerMins: LINGER_SECS / 60, models: setupModels(MODELS, DEFAULT_MODEL) });

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
    else if (a === '--agents') o.agents = true;
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
    // --way app|model: who decides for this run (agent/way.mjs), over /effort's Who decides row.
    else if (a === '--way') o.way = String(val() ?? '').toLowerCase() === 'model' ? 'model' : 'app';
    // --local: this run uses the model on this Mac even when /remote is on.
    else if (a === '--local') o.local = true;
    // --start: the model loads as the window opens (otherwise it waits for /start; /autostart on keeps that).
    else if (a === '--start') o.load = true;
    // --folder <path>: work there, not where coding was typed (a restart after /update passes it).
    else if (a === '--folder') { o.folder = true; o.cwd = resolve(val() ?? '.'); }
    // --bg: start in the background, with no window (app/sessions.mjs); coding attach opens it.
    else if (a === '--bg') o.bg = true;
    // --loop-events: one run of a loop (/loop). Its window starts it, reads what happens as JSON lines and
    // answers its questions (app/loop-run.mjs); the message comes in AGENTIC_LOOP_SPEC.
    else if (a === '--loop-events') { o.loopEvents = true; o.print = true; }
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
// none is named). The old one-word forms (coding docs, coding tests…) still work. The Arena is
// the Tests tab and the Battle tab as one (30 Sep 2026): either name opens it, tests with the record up.
const HUB_TABS = { weights: 'weights', docs: 'harness', harness: 'harness', structure: 'structure', flow: 'flow', arena: 'arena', tests: 'arena&record=1', builder: 'builder', battle: 'arena', remote: 'remote', memory: 'memory', instructions: 'instructions', help: 'help' };
const OLD_HUB = ['weights', 'docs', 'arena', 'tests', 'battle', 'memory', 'instructions'];
if (process.argv[2] === 'hub' || OLD_HUB.includes(process.argv[2])) {
  const name = process.argv[2] === 'hub' ? (process.argv[3] ?? 'weights').toLowerCase() : process.argv[2];
  if (!HUB_TABS[name]) { process.stderr.write(`coding hub: no tab called ${name}. Tabs: ${Object.keys(HUB_TABS).join(', ')}.\n`); process.exit(1); }
  const { existsSync } = await import('node:fs');
  const path = modelPath(MODELS[DEFAULT_MODEL]);
  // The Weights tab shows every model in /model whose file is on this Mac.
  const here = Object.values(MODELS).filter((m) => m.format !== 'mlx' && existsSync(modelPath(m)));
  if (name === 'weights' && !here.length) { process.stderr.write(`coding hub: no model file is here yet (${path}). Run coding setup first, or open another tab (coding hub docs).\n`); process.exit(1); }
  const { startWeightsServer } = await import('./app/weights.mjs');
  const s = startWeightsServer({ path, cwd: process.cwd() });
  const url = `${s.url}?tab=${HUB_TABS[name]}`;
  process.stdout.write(`Agentic Coder hub: ${here.length ? `the weights of ${here.map((m) => m.name).join(' and ')}` : 'no model file yet'}, and the pages in ${s.docsDir ? s.docsDir.replace(process.env.HOME, '~') : 'no DOCS folder (not found)'} at ${url}\nThe page reads the files through this window. Press ctrl+c to close it.\n`);
  if (!process.env.AGENTIC_NO_OPEN) Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' });
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
// coding serve: this machine's model for another machine's /remote (models/runtime/serve.mjs).
// --port N (8080) · --local (this machine only, for an SSH tunnel) · --ctx 32k ·
// --model gemma|qwen · --https cert.pem key.pem · --new-key
if (process.argv[2] === 'serve') {
  const a = process.argv.slice(3);
  const at = (f) => a.indexOf(f);
  const val = (f) => (at(f) >= 0 ? a[at(f) + 1] : undefined);
  // How many values each switch takes; anything else is a word it does not know.
  const TAKES = { '--port': 1, '--ctx': 1, '--model': 1, '--https': 2, '--local': 0, '--new-key': 0 };
  const odd = [];
  for (let i = 0; i < a.length; i++) { if (a[i] in TAKES) i += TAKES[a[i]]; else if (a[i] !== '-h' && a[i] !== '--help') odd.push(a[i]); }
  if (odd.length || a.includes('-h') || a.includes('--help')) {
    process.stdout.write(`coding serve: this machine's model for /remote on another machine.\n  --port N          where it listens (${SERVE_PORT})\n  --local           this machine only: reach it with an SSH tunnel\n  --ctx 32k         the context (else what fits in memory)\n  --model ${Object.keys(MODELS).join('|')}\n  --https cert.pem key.pem   https with your certificate (tailscale cert makes one)\n  --new-key         make a new API key (the old one stops working)\n`);
    process.exit(odd.length ? 2 : 0);
  }
  const ctxText = val('--ctx');
  const ctx = ctxText ? (/^\d+k$/i.test(ctxText) ? Number.parseInt(ctxText, 10) * 1024 : Number(ctxText)) : null;
  const port = Number(val('--port') ?? SERVE_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { process.stderr.write('coding serve: --port takes a number from 1 to 65535\n'); process.exit(2); }
  let s = null;
  const stop = async () => { await s?.stop().catch(() => {}); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop);
  try {
    s = await serve({ modelId: val('--model') ?? modelById(loadSettings(process.cwd()).model)?.base ?? modelById(loadSettings(process.cwd()).model)?.id ?? DEFAULT_MODEL, port, local: a.includes('--local'), ctx, cert: val('--https'), certKey: at('--https') >= 0 ? a[at('--https') + 2] : undefined, newKey: a.includes('--new-key') });
    s.server.on('crash', ({ code, signal }) => { process.stderr.write(`coding serve: the model stopped (code ${code ?? signal}); see ~/.agentic-coder/logs/server.log\n`); process.exit(1); });
  } catch (e) { process.stderr.write(`coding serve: ${e.message}\n`); await s?.stop().catch(() => {}); process.exit(1); }
  await new Promise(() => {});
}
// coding session-host: the keeper of one background session (app/sessions.mjs). coding starts it, not you.
if (process.argv[2] === 'session-host') {
  const { runHost } = await import('./app/sessions.mjs');
  let spec = null;
  try { spec = JSON.parse(process.env.AGENTIC_HOST_SPEC ?? ''); } catch {}
  if (!spec?.name) { process.stderr.write('coding session-host is started by coding itself.\n'); process.exit(2); }
  const env = { ...process.env };
  delete env.AGENTIC_HOST_SPEC;
  try { process.exit((await runHost(spec, env)) ?? 0); } catch (e) { process.stderr.write(`coding session-host: ${e.message}\n`); process.exit(1); }
}
// The menu of sessions (coding attach, and a window sent to another Mac with /jumptomac).
const pickSession = async (rows, title, more = {}) => { process.stderr.write(`${title}\n`); return pickOnTerminal(rows, { hint: 'Enter to open · Esc to leave', ...more }); };
// coding sessions [mac]: what runs in the background here, or on another Mac (through its door).
// coding attach [name] · coding attach <mac> [name]: open one in this window; ctrl+b leaves it again.
if (process.argv[2] === 'sessions' || process.argv[2] === 'attach') {
  const { listBackground, describe, viewSession, localConnect, DETACH_LABEL } = await import('./app/sessions.mjs');
  const a = process.argv.slice(3);
  const at = a.indexOf('--port');
  const port = at >= 0 ? Number(a[at + 1]) : undefined;
  const [first, second] = a.filter((x, i) => at < 0 || (i !== at && i !== at + 1));
  const list = listBackground();
  const say = (t) => process.stdout.write(`${t}\n`);
  const pick = pickSession;
  const remote = async (host, name, listOnly) => {
    const { attachRemote, DOOR_PORT } = await import('./app/door.mjs');
    try { return await attachRemote({ host, name, port: port || DOOR_PORT, pick, listOnly }); } catch (e) {
      process.stderr.write(`${e.message}\n`);
      // coding attach <name>: a name that is no session here was taken for another Mac's. In case it was a
      // slip of a session's name, say what does run here.
      if (!listOnly) process.stderr.write(`${list.length ? `If you meant a session on this Mac, these run here: ${list.map((s) => s.name).join(', ')}.` : 'No session runs in the background on this Mac either.'} coding sessions lists them.\n`);
      return 1;
    }
  };
  if (process.argv[2] === 'sessions') {
    if (first) process.exit(await remote(first, null, true));
    if (!list.length) say(`Nothing runs in the background here. ${DETACH_LABEL} in a coding window sends it there; coding --bg starts one.`);
    for (const s of list) say(`  ${describe(s)}`);
    process.exit(0);
  }
  const here = first ? list.find((s) => s.name === first) : null;
  if (first && !here) process.exit(await remote(first, second, false));
  let target = here;
  if (!target) {
    if (!list.length) { say(`Nothing runs in the background here. ${DETACH_LABEL} in a coding window sends it there; coding --bg starts one. Another Mac's: coding attach <its name>`); process.exit(0); }
    const i = list.length === 1 ? 0 : await pick(list.map((s) => describe(s)), 'Background sessions on this Mac');
    if (i === null) process.exit(0);
    target = list[i];
  }
  const { viewJumping } = await import('./app/door.mjs');
  process.exit(await viewJumping({ connect: localConnect(target), name: target.name }, { pick }));
}
// coding loops [pid]: the loop board of a coding window (/loop makes the loops, /loops opens this in a window of its own).
if (process.argv[2] === 'loops') {
  const { runBoard } = await import('./app/loops-board.mjs');
  const pid = Number(process.argv[3]);
  process.exit(await runBoard({ pid: Number.isInteger(pid) && pid > 0 ? pid : null }));
}
// coding door [on|off|new-key]: let your other Macs open the sessions here, over Tailscale, with a key (app/door.mjs).
if (process.argv[2] === 'door') {
  const { doorCli, runDoor } = await import('./app/door.mjs');
  if (process.argv[3] === 'run') { await runDoor(); process.exit(0); }
  process.exit(await doorCli(process.argv.slice(3)));
}
// coding connect [address]: use a model on another machine, with no model downloaded here (terminal/src/app/connect-cli.mjs).
if (process.argv[2] === 'connect') {
  const { connectCli } = await import('./app/connect-cli.mjs');
  process.exit(await connectCli(process.argv.slice(3), { settings: loadSettings(process.cwd()) }));
}
// coding setup [--model <id>]: the default model, or the one named (its file and its engine).
if (process.argv[2] === 'setup') {
  const a = process.argv.slice(3);
  const at = a.indexOf('--model');
  const want = at >= 0 ? a[at + 1] : undefined;
  if (at >= 0 && !MODELS[want]) { process.stderr.write(`coding setup: no model "${want ?? ''}". The models: ${Object.keys(MODELS).join(', ')}\n`); process.exit(1); }
  // --accept-license: a model whose runtime has a license of its own (Bonsai 2 27B ConstantKV) is set up without asking.
  try { await setup({ ...(want ? { modelId: want } : {}), accept: a.includes('--accept-license') }); process.exit(0); } catch (e) { process.stderr.write(`\ncoding setup: ${e.message}\n`); process.exit(1); }
}

const opts = parse(process.argv.slice(2));
if (opts.help) { process.stdout.write(HELP); process.exit(0); }
if (opts.version) { process.stdout.write(`${VERSION}\n`); process.exit(0); }
// coding --bg: the app starts in a session with no window (app/sessions.mjs); a first
// prompt is worked on at once, so the model loads with it.
if (opts.bg) {
  if (opts.print) { process.stderr.write('coding: --bg starts a window-less session; -p answers once here. Use one.\n'); process.exit(2); }
  const { canHost, startHost, OLD_BUN } = await import('./app/sessions.mjs');
  if (!canHost()) { process.stderr.write(`coding --bg: ${OLD_BUN()}\n`); process.exit(1); }
  const args = process.argv.slice(2).filter((a) => a !== '--bg');
  if (opts.prompt && !opts.load) args.push('--start');
  try {
    const rec = await startHost({ folder: opts.cwd, args, cols: process.stdout.columns || 120, rows: process.stdout.rows || 40 });
    process.stdout.write(`Started in the background: ${rec.name}. Open it with: coding attach ${rec.name}\n`);
    process.exit(0);
  } catch (e) { process.stderr.write(`coding --bg: ${e.message}\n`); process.exit(1); }
}
// Commands run where the agent works, as if coding had been typed there.
if (opts.folder) { try { process.chdir(opts.cwd); } catch { process.stderr.write(`coding: no folder ${opts.cwd}\n`); process.exit(2); } }
// The model picked last time (kept by /model) — the edited copy included,
// when its file and manifest are still there.
opts.modelId = (modelById(opts.modelId) ?? modelById(loadSettings(opts.cwd).model) ?? MODELS[DEFAULT_MODEL]).id;

if (opts.print) {
  // A loop's run: its message and what "always" already covers come from the window that started it.
  let loop = null;
  if (opts.loopEvents) {
    const { loopIO } = await import('./app/loop-run.mjs');
    let spec = {};
    try { spec = JSON.parse(process.env.AGENTIC_LOOP_SPEC ?? '{}'); } catch { /* no message: said below */ }
    opts.prompt = spec.prompt;
    const { modeOf } = await import('./agent/permissions.mjs');
    const mode = modeOf(opts.mode) ?? 'ask';
    loop = { io: loopIO({ mode, allow: spec.allow ?? [] }), mode };
    // Plan mode only reads, as in the window.
    if (mode === 'plan' && opts.prompt) opts.prompt += '\n\n[Plan mode is on: only read and search. Do not change files or run commands that change anything. Reply with a short numbered plan, then stop.]';
    process.on('SIGTERM', () => process.exit(143));
  }
  if (!opts.prompt) { process.stderr.write('coding -p needs a prompt\n'); process.exit(2); }
  if (!(await ensureTrusted(opts.cwd))) process.exit(2);
  const settings = loadSettings(opts.cwd);
  // The limits /effort saved: the context and thinking cap for the server, the rest for the agent.
  let limits = readLimits(settings, modelById(opts.modelId) ?? MODELS[DEFAULT_MODEL]);
  const model = modelWithLimits(modelById(opts.modelId) ?? MODELS[DEFAULT_MODEL], limits);
  let server = null;
  let url = opts.url;
  let ctx = opts.ctx ?? (limits.context || undefined);
  let slots = url && opts.slots > 1 ? { main: 0, side: 1 } : undefined;
  // The remote /remote saved, when it is on (--local runs on this Mac instead).
  let remote = null;
  let runModel = model;
  // Pictures named in the prompt (a dragged path, or @shot.png): the model starts with its vision add-on.
  const { droppedFiles } = await import('./agent/images.mjs');
  const media = await import('./tools/media.mjs');
  const { existsSync } = await import('node:fs');
  const { resolve: resolvePath } = await import('node:path');
  const picPaths = [...new Set([...droppedFiles(opts.prompt, opts.cwd).filter((d) => d.kind === 'image').map((d) => d.path), ...[...opts.prompt.matchAll(/(^|\s)@(\S+)/g)].map((m) => resolvePath(opts.cwd, m[2])).filter((p) => media.isImage(p) && existsSync(p))])];
  const images = picPaths.map((p) => media.preparedImage(p));
  let canSee = false;
  if (!url && !opts.local && settings.remote?.use) {
    try { remote = await connectRemote(settings.remote); } catch (e) { process.stderr.write(`coding: the remote model at ${remoteLabel(settings.remote)} did not answer: ${e.message}. coding -p --local runs on this Mac.\n`); process.exit(1); }
    const risk = remoteRisk(settings.remote);
    process.stderr.write(`· On the remote model: ${remote.model.name}${risk ? ` · ⚠ ${risk}` : ''}\n`);
    url = remote.url;
    ctx = opts.ctx ?? remote.ctx;
    // Big-model mode (models/runtime/remote.mjs): the rows it moves start from the remote model, as in the app,
    // and so do the ones /model's menu kept for that model, with its Effort (unless --effort or --think says).
    const own = readLimits(settings, remote.model);
    limits = { ...limits, ...Object.fromEntries(OWN_ROWS.map((id) => [id, own[id]])) };
    // Else the model's default: thinking on, at its own level, unless it cannot think (remoteModel). The
    // shared Effort is this Mac's models'; --think, --no-think and --effort still win.
    const levels = remote.model.thinkingLevels ?? [];
    const lv = (levels.length > 1 ? levels.find((l) => l.id === ownOf(settings, remote.model.remote?.model)?.level) : null)
      ?? thinkingLevel(remote.model, remote.model.thinkingDefault ?? true, remote.model.thinkingEffort);
    if (opts.thinking === undefined) { opts.thinking = Boolean(lv.effort); if (lv.effort) opts.effort ??= lv.id; }
    runModel = modelWithLimits(remote.model, limits);
    canSee = Boolean(remote.vision);
    if (remote.slots > 1) slots = { main: 0, side: 1 };
  }
  // A llama.cpp server given with --url says whether it can look at pictures.
  if (url && !remote && images.length) { try { canSee = Boolean((await (await fetch(`${url.replace(/\/+$/, '')}/props`, { signal: AbortSignal.timeout(3000) })).json())?.modalities?.vision); } catch { canSee = false; } }
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
    const seeing = images.length && model.vision && existsSync(visionPath(model));
    if (images.length && !seeing) process.stderr.write(`· ${model.vision ? `${model.name}'s vision add-on is not here (coding setup gets it)` : `${model.name} cannot look at pictures`}: the prompt goes without them\n`);
    server = new ModelServer(seeing ? withVision(model) : model);
    const st = await server.start({ ctx, helper: ctx === c.ctx ? c.helper : undefined });
    canSee = Boolean(server.vision);
    if (st.slots > 1) slots = { main: 0, side: 1 };
    url = server.url;
  }
  // Your MCP servers (app/mcp-start.mjs), started now so their tools are there for the request.
  const { openMcp } = await import('./app/mcp-start.mjs');
  const mcp = openMcp(opts.cwd);
  if (mcp?.broken) process.stderr.write(`· MCP: ${mcp.broken}\n`);
  if (mcp?.project?.servers.length && mcp.project.answer !== 'yes') process.stderr.write(`· MCP: this project's own servers (.agentic/mcp.json) are not started: say yes to them in the app first\n`);
  mcp?.hub.on('state', ({ name, state, error }) => { if (state === 'failed' || state === 'signin') process.stderr.write(`· MCP: ${name} is not running: ${error}\n`); });
  const stop = async () => { remote?.stop(); await mcp?.hub.stopAll().catch(() => {}); return server?.stop(); };
  process.on('SIGINT', async () => { await stop(); process.exit(130); });
  try {
    // A picture (or a scanned PDF) the model reads by itself: the model reloads with its add-on, once.
    const visionOn = server && !server.vision && model.vision && existsSync(visionPath(model)) ? async (agent) => {
      process.stderr.write(`· turning on ${model.name}'s vision for a picture it reads\n`);
      await server.stop();
      server = new ModelServer(withVision(model));
      const st = await server.start({ ctx });
      agent.url = server.url;
      agent.canSee = Boolean(server.vision);
      if (st.slots > 1) agent.slots = { main: 0, side: 1 };
      return agent.canSee;
    } : null;
    const r = await runHeadless({
      images, canSee, visionOn, userHooks: true,
      prompt: opts.prompt, cwd: opts.cwd, url, model: runModel, ctx: ctx ?? 32768,
      thinking: opts.thinking ?? settings.thinking ?? model.thinkingDefault ?? true, effort: opts.effort ?? settings.effort, autoApprove: !!opts.yes, flows: opts.flows, slots, warm: !!slots, limits,
      // What you saved with /permissions: commands that run without asking, and the ones that never run.
      permissions: (dir) => rulesFor(dir),
      // The context helpers: as /helpers left them (AGENTIC_HELPERS wins).
      helpers: helpersFrom(settings),
      // Who decides (--way, else AGENTIC_WAY, else /effort's row in limits) and the hooks /hooks left on.
      way: opts.way, hooks: hooksFrom(settings),
      // /remote's Clean up at: where a remote model's memory is cleaned up (0: when nearly full).
      workRoom: Number(settings.remoteCleanAt) || 0,
      // --agents: the request goes through /agents' six stages (agents-run.mjs) instead of one message.
      agents: !!opts.agents,
      // The web as /web left it: a search service and reading pages (each asks, or --yes allows).
      web: webSettings(settings.web), subagents: settings.subagents !== false,
      // Your MCP servers (/mcp): each tool asks, or --yes allows. A project's own servers run only
      // if you said yes to them in the app before: nobody is here to be asked.
      mcp: mcp?.hub ?? null,
      // The design examples and the layout check: as /design left them (AGENTIC_DESIGN… wins).
      design: settings.design ?? {},
      // The memory: facts brought back, and what the run taught saved before it ends.
      memory: memoryOn(settings) ? { save: process.env.AGENTIC_MEMORY_SAVE !== 'off', claude: claudeOn(settings) ? settings.claudeNotes ?? true : false } : false,
      // Agentic Coder's questions: asked on the terminal when there is one; otherwise unanswered.
      answers: process.stdin.isTTY && !loop ? askOnTerminal : null,
      // A loop's run: its window's mode, its questions answered on the loop board, a note typed there sent
      // when the turn ends, and a half-fix kept when fewer tests fail (agent.mjs madeProgress).
      ...(loop ? { mode: loop.mode, askUser: loop.io.ask, more: loop.io.more, signal: loop.io.signal, keepProgress: true } : {}),
      // What the app read for it before its first step (the project map, the files a question names) ends " [app]".
      onEvent: loop ? loop.io.event : (type, ev) => { if (type === 'tool') process.stderr.write(`${ev.error ? '✗' : '⏺'} ${ev.label}(${ev.arg})${ev.given ? ' [app]' : ''}\n`); if (type === 'note') process.stderr.write(`· ${ev.text}\n`); },
    });
    if (loop) loop.io.end(r); else process.stdout.write(`${r.finalText.trim()}\n`);
    await stop();
    process.exit(r.reason === 'done' ? 0 : 1);
  } catch (e) {
    process.stderr.write(`coding: ${e.message}\n`);
    loop?.io.fail(e.message);
    await stop();
    process.exit(1);
  }
} else {
  if (!process.stdin.isTTY) { process.stderr.write('coding needs a terminal. For scripts use: coding -p "…"\n'); process.exit(2); }
  // The app runs in a background session and this window shows it (app/sessions.mjs), so
  // ctrl+b can leave it running. Not inside a session already, and not where this Bun cannot.
  if (!process.env.AGENTIC_IN_HOST && process.stdout.isTTY) {
    const { sessionsOn, hostThisWindow } = await import('./app/sessions.mjs');
    if (sessionsOn()) {
      // The window can jump to another Mac's sessions and come back (/jumptomac, door.mjs).
      const { viewJumping } = await import('./app/door.mjs');
      const code = await hostThisWindow({ folder: opts.cwd, args: process.argv.slice(2), view: (v) => viewJumping(v, { pick: pickSession }) });
      if (code !== null) process.exit(code);
    }
  }
  // Typed in the home folder: which folder to work in; the safety check is then about that one.
  const folders = startFolders(opts);
  if (folders) {
    const at = await pickStartFolder(folders);
    if (at === null) process.exit(0);
    opts.cwd = at;
    opts.picked = true;
    process.chdir(at);
    // In a background session, its list shows the folder picked.
    if (process.env.AGENTIC_IN_HOST) { const { noteFolder } = await import('./app/sessions.mjs'); noteFolder(process.env.AGENTIC_IN_HOST, at); }
  }
  // Step 1, before anything in the folder is read: the safety check.
  if (!(await ensureTrusted(opts.cwd))) process.exit(0);
  // What the start loaded, for the start page: the notes read into the model, settings a folder
  // file set, the git state, and the conversations had here (start.jsx).
  try {
    const { projectNotes, gitSummary, notesRoom } = await import('./agent/prompt.mjs');
    const st = loadSettings(opts.cwd);
    if (memoryOn(st)) { try { openMemory(opts.cwd); } catch {} }
    const names = [...new Set(projectNotes(opts.cwd, notesRoom(), { memory: memoryOn(st) }).files.map((p) => (p.endsWith('/memory') ? 'memory' : p.split('/').pop())))];
    const git = gitSummary(opts.cwd);
    // also: what this folder changes at the start (its own settings file, a start-up mode saved with /permissions).
    const also = [
      ...(st.fromFolder?.length ? [`folder settings (${st.fromFolder.filter((k) => k !== 'thinking').join(', ')})`] : []),
      ...(st.modeFrom && st.mode !== 'ask' ? [`starts in ${modeWord(st.mode)} (/permissions)`] : []),
    ];
    opts.start = { notes: names, git, also, recent: listSessions(opts.cwd) };
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
    const modelName = (modelById(opts.modelId) ?? MODELS[DEFAULT_MODEL]).name;
    primeRows([{ key: 'welcome', type: 'welcome' }], { width: Math.max(MIN_COLS, process.stdout.columns || 100), modelName, cwdShort, loaded: opts.loaded ?? '', start: { ...opts.start, model: modelName, cwd: cwdShort } });
  } catch {}
  const win = new TerminalWindow(process.stdout);
  // /update asks for a restart: set here, run once this window has closed.
  let restartArgs = null;
  // incrementalRendering (Ink writes only the lines that changed): tried on 3 Oct 2026 for /agents'
  // 58-row tree, it broke the full-window switch and a question's prompt in the app tests, so it is
  // off unless AGENTIC_INCREMENTAL=on; the tree moves at 8 frames a second without it.
  const incremental = (process.env.AGENTIC_INCREMENTAL ?? 'off') === 'on';
  const instance = render(<App opts={opts} win={win} onRestart={(a) => { restartArgs = a; }} />, { stdout: win, exitOnCtrlC: false, patchConsole: true, maxFps: 30, incrementalRendering: incremental });
  const bye = () => { try { instance.unmount(); } catch {} };
  process.on('SIGTERM', bye);
  process.on('SIGHUP', bye);
  await instance.waitUntilExit();
  if (restartArgs) {
    // The launcher waiting on this app starts the new version (see update.mjs).
    const { leaveRestart, RESTART_CODE } = await import('./app/update.mjs');
    // The launcher starts it where coding was typed: a folder picked or given comes along.
    leaveRestart(opts.picked || opts.folder ? ['--folder', opts.cwd, ...restartArgs] : restartArgs);
    process.stdout.write('\x1b[2m  ↻ Restarting on the update…\x1b[0m\n');
    process.exit(RESTART_CODE);
  }
  process.stdout.write('\x1b[2m  Saved. Continue this conversation with: coding -c\x1b[0m\n');
  process.exit(0);
}
