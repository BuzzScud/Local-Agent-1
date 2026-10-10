// The app ends when its terminal goes away (cli.jsx: SIGHUP, or stdin's end): its window closed, the host
// that held its pseudo-terminal ended, a harness done with it. Until 10 Oct 2026 nothing bounded its
// closing, so an app whose terminal had gone could stay on for ever.
import { test, expect } from 'bun:test';
import { rmSync } from 'node:fs';
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
