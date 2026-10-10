// The run folder every test process works in, and the clean-up of what a run leaves (test-tmp.mjs).
import { test, expect } from 'bun:test';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RUN_BASE, RUN_PREFIX, cleanRun, isAlive, makeRunFolder, pidOf, processesIn, sweepRuns, sweepWords } from './test-tmp.mjs';

// A pid no process has (macOS pids stop at 99,998).
const DEAD = 4_000_000;
const until = async (ok, ms = 4000) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25)); return ok(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the preload gave this process a run folder: TMPDIR points at it, tmpdir() follows, the home is inside', () => {
  expect(process.env.TMPDIR.split('/').pop()).toMatch(new RegExp(`^${RUN_PREFIX}${process.pid}-`));
  // In /private/tmp, so the project paths the app tests show are shorter than in the Mac's own temp folder.
  expect(process.env.TMPDIR.startsWith(`${RUN_BASE}/`)).toBe(true);
  expect(existsSync(process.env.TMPDIR)).toBe(true);
  expect(tmpdir()).toBe(process.env.TMPDIR);
  expect(process.env.AGENTIC_TEST_HOME.startsWith(`${process.env.TMPDIR}/`)).toBe(true);
});

test('a run folder carries its pid in its name, and TMPDIR moves to it', () => {
  const base = mkdtempSync(join(tmpdir(), 'tt-'));
  const before = process.env.TMPDIR;
  try {
    const dir = makeRunFolder({ base, pid: 4242 });
    expect(process.env.TMPDIR).toBe(dir);
    expect(dir.startsWith(`${base}/${RUN_PREFIX}4242-`)).toBe(true);
    expect(pidOf(dir.split('/').pop())).toBe(4242);
    expect(pidOf('agentic-e2e-abc')).toBe(0);
    expect(pidOf(`${RUN_PREFIX}x-abc`)).toBe(0);
  } finally {
    process.env.TMPDIR = before; // the rest of this process keeps its own
    rmSync(base, { recursive: true, force: true });
  }
});

test('the programs of a run are found by their TMPDIR (inside it too) and their children, stopped even when they ignore a polite stop, and the folder goes', async () => {
  const base = mkdtempSync(join(tmpdir(), 'tt-'));
  const dir = join(base, `${RUN_PREFIX}${DEAD}-x`);
  mkdirSync(dir);
  const env = (TMPDIR) => ({ ...process.env, TMPDIR });
  // One that ignores SIGTERM (as an app busy with its quit work might) and starts a child of its own
  // (an Apple program, whose environment ps does not show); one started deeper inside the folder; and
  // one whose TMPDIR only begins the same way: not this run's.
  const stubborn = spawn('bun', ['-e', 'process.on("SIGTERM", () => {}); require("node:child_process").spawn("sleep", ["60"], { stdio: "ignore" }); setInterval(() => {}, 1000)'], { env: env(dir), stdio: 'ignore' });
  const inner = spawn('bun', ['-e', 'setInterval(() => {}, 1000)'], { env: env(join(dir, 'deeper')), stdio: 'ignore' });
  const other = spawn('bun', ['-e', 'setInterval(() => {}, 1000)'], { env: env(`${dir}-not-this-run`), stdio: 'ignore' });
  const childOf = (ppid) => execFileSync('ps', ['-o', 'pid=,ppid=', '-u', String(process.getuid())], { encoding: 'utf8' }).split('\n').map((l) => l.trim().split(/\s+/).map(Number)).find(([, p]) => p === ppid)?.[0] ?? null;
  let grandchild = null;
  try {
    expect(await until(() => (grandchild = childOf(stubborn.pid)) !== null)).toBe(true);
    const found = processesIn(dir);
    expect(found).toContain(stubborn.pid);
    expect(found).toContain(grandchild);
    expect(found).toContain(inner.pid);
    expect(found).not.toContain(other.pid);
    expect(found).not.toContain(process.pid);
    const { stopped } = await cleanRun(dir, { graceMs: 200 });
    expect(stopped).toBe(3);
    expect(await until(() => [stubborn.pid, grandchild, inner.pid].every((p) => !isAlive(p)))).toBe(true);
    expect(isAlive(other.pid)).toBe(true);
    expect(existsSync(dir)).toBe(false);
  } finally {
    for (const p of [stubborn.pid, grandchild, inner.pid, other.pid]) { if (p) { try { process.kill(p, 'SIGKILL'); } catch {} } }
    rmSync(base, { recursive: true, force: true });
  }
}, 15_000);

test('the sweep cleans the run folders of processes that are gone and keeps a live one and other folders', async () => {
  const base = mkdtempSync(join(tmpdir(), 'tt-'));
  const dead = join(base, `${RUN_PREFIX}${DEAD}-a`);
  const live = join(base, `${RUN_PREFIX}${process.pid}-b`);
  for (const d of [dead, live, join(base, 'agentic-e2e-c')]) mkdirSync(d);
  try {
    const r = await sweepRuns({ base });
    expect(r).toEqual({ folders: 1, stopped: 0, kept: 1 });
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(join(base, 'agentic-e2e-c'))).toBe(true);
    expect(sweepWords(r)).toBe('Cleaned up after an earlier test run: 1 folder.\n');
    expect(sweepWords({ folders: 3, stopped: 12 })).toBe('Cleaned up after an earlier test run: 3 folders, 12 programs stopped.\n');
    expect(sweepWords({ folders: 2, stopped: 1 })).toBe('Cleaned up after an earlier test run: 2 folders, 1 program stopped.\n');
    expect(sweepWords({ folders: 0, stopped: 0 })).toBe('');
    expect(await sweepRuns({ base: join(base, 'not-there') })).toEqual({ folders: 0, stopped: 0, kept: 0 });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('--sweep from the command line, as run-suite.mjs runs it: a line when something was cleaned, nothing otherwise', () => {
  const base = mkdtempSync(join(tmpdir(), 'tt-'));
  try {
    mkdirSync(join(base, `${RUN_PREFIX}${DEAD}-a`));
    const run = () => execFileSync('bun', [join(import.meta.dir, 'test-tmp.mjs'), '--sweep', '--base', base], { encoding: 'utf8' });
    expect(run()).toBe('Cleaned up after an earlier test run: 1 folder.\n');
    expect(run()).toBe('');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
