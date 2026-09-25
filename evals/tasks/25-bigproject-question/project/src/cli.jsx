#!/usr/bin/env bun
// bonsai — a Claude Code-style coding agent that runs a local Bonsai model.
import React from 'react';
import { render } from 'ink';
import { App } from './app/App.jsx';
import { MODELS, DEFAULT_MODEL } from './server/models.mjs';
import { ModelServer } from './server/server.mjs';
import { chooseContext } from './server/memory.mjs';
import { runHeadless } from './headless.mjs';
import { loadSettings } from './app/store.mjs';
import { setup } from './setup.mjs';

export const VERSION = '0.1.0';

const HELP = `bonsai ${VERSION} — a coding agent in your terminal, running Bonsai 2 27B on this Mac

Usage
  bonsai                    start in the current folder
  bonsai "fix the tests"    start and send a first prompt
  bonsai -p "question"      answer once and exit (changes are refused unless --yes)
  bonsai -c                 continue the last conversation in this folder
  bonsai setup              download the model and runtime (if missing) and check them

Options
  --layout classic|live     screen layout (ctrl+l switches while running)
  --think / --no-think      let the model think briefly ("medium") before it acts; off by default
  --ctx 16k|32k|64k         memory size (default: 32k, or 16k when memory is short)
  --mode ask|edits|plan     start in this permission mode
  --yes                     with -p: allow edits and commands without asking
  --url http://host:port    use a llama-server that is already running
  --no-flows                always work step by step (skip the focused fix/change/rename paths)
  -v, --version             print the version
  -h, --help                this help
`;

function parse(argv) {
  const o = { cwd: process.cwd(), modelId: DEFAULT_MODEL };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '-p' || a === '--print') { o.print = true; if (argv[i + 1] && !argv[i + 1].startsWith('-')) rest.push(val()); }
    else if (a === '-c' || a === '--continue') o.continueLast = true;
    else if (a === '--resume') o.resumeId = val();
    else if (a === '--layout') o.layout = val() === 'live' ? 'live' : 'classic';
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

if (process.argv[2] === 'setup') {
  try { await setup(); process.exit(0); } catch (e) { process.stderr.write(`\nbonsai setup: ${e.message}\n`); process.exit(1); }
}

const opts = parse(process.argv.slice(2));
if (opts.help) { process.stdout.write(HELP); process.exit(0); }
if (opts.version) { process.stdout.write(`${VERSION}\n`); process.exit(0); }

if (opts.print) {
  if (!opts.prompt) { process.stderr.write('bonsai -p needs a prompt\n'); process.exit(2); }
  const model = MODELS[opts.modelId];
  const settings = loadSettings();
  let server = null;
  let url = opts.url;
  let ctx = opts.ctx;
  let slots;
  if (!url) {
    ctx ??= chooseContext(model).ctx;
    server = new ModelServer(model);
    const st = await server.start({ ctx });
    if (st.slots > 1) slots = { main: 0, side: 1 };
    url = server.url;
  }
  const stop = () => server?.stop();
  process.on('SIGINT', async () => { await stop(); process.exit(130); });
  try {
    const r = await runHeadless({
      prompt: opts.prompt, cwd: opts.cwd, url, model, ctx: ctx ?? 32768,
      thinking: opts.thinking ?? settings.thinking ?? model.thinkingDefault ?? true, effort: settings.effort, autoApprove: !!opts.yes, flows: opts.flows, slots, warm: !!slots,
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
  // Chat style: push what is on screen up, so the prompt box starts on the
  // last lines of the window and the conversation grows upward above it.
  // Terminal's own scrolling and copying keep working.
  if (process.stdout.isTTY) process.stdout.write('\n'.repeat(process.stdout.rows || 24));
  const instance = render(<App opts={opts} />, { exitOnCtrlC: false, patchConsole: true, maxFps: 30 });
  const bye = () => { try { instance.unmount(); } catch {} };
  process.on('SIGTERM', bye);
  process.on('SIGHUP', bye);
  await instance.waitUntilExit();
  process.stdout.write('\x1b[2m  Saved. Continue this conversation with: bonsai -c\x1b[0m\n');
  process.exit(0);
}
