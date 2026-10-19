// The app ends when its terminal goes away (cli.jsx: SIGHUP, or stdin's end): its window closed, the host
// that held its pseudo-terminal ended, a harness done with it. Until 10 Oct 2026 nothing bounded its
// closing, so an app whose terminal had gone could stay on for ever.
import { test, expect } from 'bun:test';
import { rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup } from './app-setup.mjs';
import { isAlive } from './test-tmp.mjs';

const until = async (ok, ms) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50)); return ok(); };

test('SIGHUP: the app ends by itself within the grace, and its run ends with it', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([]);
  let pid = null;
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_HANGUP_GRACE_MS: '1500' }, args: ['--url', fake.url, '--no-flows'], timeoutMs: T, steps: [
    { wait: '? for shortcuts' },
    // The pid is the shell's that exec'd the app (pty.mjs), so it is the app's own.
    { fn: ({ pid: appPid }) => { pid = appPid(); expect(pid).toBeGreaterThan(0); expect(isAlive(pid)).toBe(true); process.kill(pid, 'SIGHUP'); } },
    { fn: async () => { expect(await until(() => !isAlive(pid), 6000)).toBe(true); } },
  ] });
  // The run ended because the app ended (script(1) exits with it), not because the harness had to stop it.
  expect(r.code).not.toBe('timeout');
  expect(isAlive(pid)).toBe(false);
  await fake.close();
  rmSync(base, { recursive: true, force: true });
}, T);

// 18 Oct 2026: a test run cut off at the 2-minute limit (its test processes killed, so pty.mjs's own clean-up never
// ran) left its apps running in their terminals, with their stand-in model servers. pty.mjs's watch ends them.
test('the test process killed outright: its app in the pseudo-terminal ends anyway', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([]);
  const pidFile = join(base, 'app.pid');
  const script = join(base, 'drive.mjs');
  writeFileSync(script, `const { runInPty } = await import(${JSON.stringify(join(import.meta.dir, 'pty.mjs'))});
const { writeFileSync } = await import('node:fs');
const s = JSON.parse(process.env.DRIVE);
await runInPty({ cwd: s.cwd, env: s.env, args: ['--url', s.url, '--no-flows'], timeoutMs: 120_000, steps: [
  { wait: '? for shortcuts' },
  { fn: ({ pid }) => { writeFileSync(s.pidFile, String(pid())); return new Promise(() => {}); } },
] });
`);
  const driver = spawn(process.execPath, [script], { env: { ...process.env, DRIVE: JSON.stringify({ cwd, env: { ...env, AGENTIC_HANGUP_GRACE_MS: '1500' }, url: fake.url, pidFile }) }, stdio: 'ignore' });
  let pid = 0;
  try {
    expect(await until(() => existsSync(pidFile) && (pid = Number(readFileSync(pidFile, 'utf8'))) > 0, T)).toBe(true);
    expect(isAlive(pid)).toBe(true);
    driver.kill('SIGKILL'); // as a run cut off: no finally, no afterAll
    expect(await until(() => !isAlive(pid), 10_000)).toBe(true);
  } finally {
    driver.kill('SIGKILL');
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await fake.close();
    rmSync(base, { recursive: true, force: true });
  }
}, T);
