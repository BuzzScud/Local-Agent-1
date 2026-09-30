#!/usr/bin/env bun
// coding — a Claude Code-style coding agent that runs a local Agentic Coder model.
import React from 'react';
import { render, renderToString } from 'ink';
import { App } from './app/App.jsx';
import { primeRows } from './app/screen.jsx';
import { TerminalWindow, MIN_COLS } from './app/window.mjs';
import { MODELS, DEFAULT_MODEL, macMemory, ModelServer, chooseContext, contextCheck, otherCopies, hasDraft, setup, stopIdleServers, scanServers, LINGER_SECS, modelPath, modelById, serve, SERVE_PORT, connectRemote, remoteRisk, remoteLabel, withVision, visionPath } from '../../models/index.mjs';
import { readLimits, modelWithLimits } from './app/limits.mjs';
import { runHeadless } from './headless.mjs';
import { createInterface } from 'node:readline';
import { pickOnTerminal } from './app/pick.mjs';
import { TrustPage, TRUST_OPTIONS } from './app/start.jsx';

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
    // --way app|model: who decides for this run (agent/way.mjs), over /effort's Who decides row.
    else if (a === '--way') o.way = String(val() ?? '').toLowerCase() === 'model' ? 'model' : 'app';
    // --local: this run uses the model on this Mac even when /remote is on.
    else if (a === '--local') o.local = true;
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
const HUB_TABS = { weights: 'weights', docs: 'harness', harness: 'harness', structure: 'structure', flow: 'flow', arena: 'arena', tests: 'arena&record=1', builder: 'builder', battle: 'arena', memory: 'memory', instructions: 'instructions', help: 'help' };
const OLD_HUB = ['weights', 'docs', 'arena', 'tests', 'battle', 'memory', 'instructions'];
if (process.argv[2] === 'hub' || OLD_HUB.includes(process.argv[2])) {
  const name = process.argv[2] === 'hub' ? (process.argv[3] ?? 'weights').toLowerCase() : process.argv[2];
  if (!HUB_TABS[name]) { process.stderr.write(`coding hub: no tab called ${name}. Tabs: ${Object.keys(HUB_TABS).join(', ')}.\n`); process.exit(1); }
  const { existsSync } = await import('node:fs');
  const path = modelPath(MODELS[DEFAULT_MODEL]);
  // The Weights tab shows every model in /model whose file is on this Mac.
  const here = Object.values(MODELS).filter((m) => existsSync(modelPath(m)));
  if (name === 'weights' && !here.length) { process.stderr.write(`coding hub: no model file is here yet (${path}). Run coding setup first, or open another tab (coding hub docs).\n`); process.exit(1); }
  const { startWeightsServer } = await import('./app/weights.mjs');
  const s = startWeightsServer({ path, cwd: process.cwd() });
  const url = `${s.url}?tab=${HUB_TABS[name]}`;
  process.stdout.write(`Agentic Coder hub: ${here.length ? `the weights of ${here.map((m) => m.name).join(' and ')}` : 'no model file yet'}, and the pages in ${s.docsDir ? s.docsDir.replace(process.env.HOME, '~') : 'no DOCS folder (not found)'} at ${url}\nThe page reads the files through this window. Press ctrl+c to close it.\n`);
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
  const stop = () => { remote?.stop(); return server?.stop(); };
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
      images, canSee, visionOn,
      prompt: opts.prompt, cwd: opts.cwd, url, model: runModel, ctx: ctx ?? 32768,
      thinking: opts.thinking ?? settings.thinking ?? model.thinkingDefault ?? true, effort: opts.effort ?? settings.effort, autoApprove: !!opts.yes, flows: opts.flows, slots, warm: !!slots, limits,
      // What you saved with /permissions: commands that run without asking, and the ones that never run.
      permissions: (dir) => rulesFor(dir),
      // The context helpers: as /helpers left them (AGENTIC_HELPERS wins).
      helpers: helpersFrom(settings),
      // Who decides (--way, else AGENTIC_WAY, else /effort's row in limits) and the hooks /hooks left on.
      way: opts.way, hooks: hooksFrom(settings),
      // The web as /web left it: a search service and reading pages (each asks, or --yes allows).
      web: webSettings(settings.web), subagents: settings.subagents !== false,
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
