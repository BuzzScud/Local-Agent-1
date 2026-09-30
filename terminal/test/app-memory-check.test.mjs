// End-to-end, the real app in a pseudo-terminal (see app.test.mjs), 28 Sep 2026:
// the start with another copy of the model already loaded (it says who has it
// and waits, or esc starts anyway), and a copy kept loaded at another size than
// the one you picked (restarted at yours, with that size checked in /stats).
import { test, expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { setup, quit } from './app-setup.mjs';
import { ENGINE } from '../../models/index.mjs';

const MODEL_FILE = 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf';
const COLS = 200; // the waiting line is long; kept on one line to match it

// A test home with the stand-in engine and model file (as in app-start.test.mjs).
function withStandIns() {
  const s = setup();
  const home = join(s.base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', MODEL_FILE), 'stand-in');
  return { ...s, home };
}

// Another copy of the model loaded outside the app: a program called
// llama-server holding the same file, for `secs` seconds.
function otherCopy(base, home, secs) {
  const dir = join(base, 'other');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'llama-server'), `#!/bin/sh\nsleep ${secs}\n`);
  chmodSync(join(dir, 'llama-server'), 0o755);
  return spawn(join(dir, 'llama-server'), ['-m', join(home, 'models', MODEL_FILE), '--port', '17999'], { stdio: 'ignore', detached: true });
}
const stop = (p) => { try { process.kill(-p.pid, 'SIGKILL'); } catch {} };

test('another copy already loaded: the start says who has it and waits, then starts by itself once it is gone', async () => {
  const { cwd, env, base, home } = withStandIns();
  const other = otherCopy(base, home, 8);
  try {
    const r = await runInPty({ cwd, env, cols: COLS, args: ['--no-flows'], timeoutMs: 90_000, steps: [
      { wait: 'esc starts anyway', ms: 30_000 }, { sleep: 200 }, { snapshot: 'waiting' },
      { wait: ' · effort ', ms: 45_000 }, ...quit,
    ] });
    expect(r.snapshots.waiting).toMatch(/Gemma 4 12B QAT · waiting( for memory)? · \d+s/); // the start page's model line
    expect(r.snapshots.waiting).toMatch(/another program \(port 17999, [\d.]+ GB\) has Gemma 4 12B QAT loaded, and two copies do not fit\. It starts by itself when that is done · esc starts anyway/);
    expect(r.text).not.toContain('Starting anyway');
  } finally { stop(other); }
}, 120_000);

test('esc starts anyway beside the other copy, and says so', async () => {
  const { cwd, env, base, home } = withStandIns();
  const other = otherCopy(base, home, 60);
  try {
    const r = await runInPty({ cwd, env, cols: COLS, args: ['--no-flows'], timeoutMs: 90_000, steps: [
      { wait: 'esc starts anyway', ms: 30_000 }, { key: 'esc' },
      { wait: 'Starting anyway', ms: 10_000 }, { wait: ' · effort ', ms: 45_000 }, ...quit,
    ] });
    expect(r.text).toMatch(/Starting anyway: another program \(port 17999, [\d.]+ GB\) still has Gemma 4 12B QAT loaded, so both may be slow\./);
  } finally { stop(other); }
}, 120_000);

test('a copy kept loaded at another size restarts at the size you picked, and /stats shows that size checked', async () => {
  const { cwd, env, base, home } = withStandIns();
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ limits: { context: 65536 } }));
  // An earlier window kept the model loaded at 256k; no window is on it now.
  const old = spawn('sleep', ['60'], { stdio: 'ignore' });
  const oldExit = new Promise((r) => old.on('exit', (code, sig) => r(sig)));
  const gone = spawn('true');
  await new Promise((r) => gone.on('exit', r));
  mkdirSync(join(home, 'servers'), { recursive: true });
  writeFileSync(join(home, 'servers', '17600.json'), JSON.stringify({ pid: old.pid, owner: gone.pid, port: 17600, ctx: 262144, slots: 2, draft: false, model: MODEL_FILE, started: new Date().toISOString(), linger: 1800 }));
  const argsFile = join(base, 'fake-args.jsonl');
  try {
    const r = await runInPty({ cwd, env: { ...env, FAKE_LLAMA_ARGS: argsFile }, cols: COLS, args: ['--no-flows'], timeoutMs: 90_000, steps: [
      { wait: ' · effort ', ms: 45_000 }, { sleep: 300 }, { type: '/stats' }, { key: 'enter' },
      { wait: 'Context 64k', ms: 15_000 }, { sleep: 200 }, { snapshot: 'stats' }, ...quit,
    ] });
    expect(await oldExit).toBe('SIGTERM');
    const started = JSON.parse(readFileSync(argsFile, 'utf8').trim().split('\n')[0]);
    expect(started[started.indexOf('-c') + 1]).toBe('65536');
    expect(r.snapshots.stats).toMatch(/Context 64k(: needs [\d.]+ GB, [\d.]+ GB free\.| needs [\d.]+ GB and [\d.]+ GB is free: the Mac may slow down\.)/);
    expect(r.text).not.toContain('was already loaded at 256k');
  } finally { try { old.kill('SIGKILL'); } catch {} }
}, 120_000);

// 29 Sep: every /effort restart warned "the Mac may slow down", counted right
// after the old server stopped, before macOS had handed its memory back. Now
// what it held counts as free, as the panel counts it: going down from 64k to
// 32k can never be short, whatever this Mac has free.
test('an /effort restart counts the memory the old server gives back: 64k → 32k never warns, and /stats shows it checked', async () => {
  const { cwd, env, home } = withStandIns();
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ limits: { context: 65536 } }));
  const r = await runInPty({ cwd, env, cols: COLS, args: ['--no-flows'], timeoutMs: 120_000, steps: [
    { wait: '? for shortcuts', ms: 45_000 }, { wait: ' · effort ', ms: 60_000 },
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' },
    // past Embedder, Retriever and Reranker to Context, then 64k → 32k
    { key: 'down' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'left' }, { sleep: 80 },
    { key: 'enter' }, { wait: 'Restarting Gemma' },
    { wait: 'restarted: context 32k', ms: 45_000 }, { sleep: 300 },
    { type: '/stats' }, { key: 'enter' }, { wait: 'Context 32k', ms: 15_000 }, { sleep: 200 }, { snapshot: 'stats' },
    ...quit,
  ] });
  const after = r.text.slice(r.text.indexOf('Restarting Gemma'));
  expect(after).toContain('restarted: context 32k');
  expect(after).not.toContain('may slow down');
  expect(r.snapshots.stats).toMatch(/Context 32k: needs [\d.]+ GB, [\d.]+ GB free\./);
}, 150_000);
