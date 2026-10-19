// The stand-ins a test starts as programs end by themselves once that test's process is gone (end-with-run.mjs).
import { test, expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { endWithRun, runPid } from './end-with-run.mjs';
import { isAlive } from './test-tmp.mjs';

const until = async (ok, ms) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50)); return ok(); };

test('the test a program belongs to: the innermost run folder in TMPDIR, the working folder or its path', () => {
  expect(runPid({ env: { TMPDIR: '/private/tmp/agentic-run-111-abc/agentic-run-222-def' }, cwd: '/', argv: ['bun'] })).toBe(222);
  expect(runPid({ env: {}, cwd: '/private/tmp/agentic-run-333-x/agentic-e2e-y/demo-project', argv: ['bun'] })).toBe(333);
  expect(runPid({ env: {}, cwd: '/', argv: ['node', '/private/tmp/agentic-run-444-z/home/engine/t/llama-server', '--port', '1'] })).toBe(444);
  expect(runPid({ env: { TMPDIR: '/var/folders/x/T/' }, cwd: '/Users/me/project', argv: ['bun', 'fake-mcp.mjs'] })).toBe(0);
  expect(endWithRun({ pid: 0 })).toBe(null); // not in a test run (the Arena's checks): it runs as before
});

// 18 Oct 2026: five stand-in MCP servers (deaf ones end only on a signal) ran on for up to five hours after their runs.
test('a deaf stand-in MCP server and a stand-in model server end once their test process is gone', async () => {
  const testProc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const runEnv = { ...process.env, TMPDIR: `/private/tmp/agentic-run-${testProc.pid}-stand/` };
  const mcp = spawn(process.execPath, [join(import.meta.dir, 'fake-mcp.mjs')], { env: { ...runEnv, FAKE_MCP: JSON.stringify({ start: 'deaf' }) }, stdio: ['pipe', 'ignore', 'ignore'] });
  const llama = spawn(join(import.meta.dir, 'fake-llama-server.mjs'), ['--port', '0'], { env: runEnv, stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 2500));
    expect([isAlive(mcp.pid), isAlive(llama.pid)]).toEqual([true, true]); // while the test runs, they stay
    testProc.kill('SIGKILL');
    expect(await until(() => !isAlive(mcp.pid) && !isAlive(llama.pid), 8000)).toBe(true);
  } finally {
    for (const p of [testProc, mcp, llama]) p.kill('SIGKILL');
  }
}, 20_000);
