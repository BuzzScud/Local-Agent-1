// A stand-in a test starts as a program (fake-mcp.mjs, fake-llama-server.mjs) ends by itself once the test
// process that started it is gone (18 Oct 2026: five stand-in MCP servers ran on for up to five hours after
// their runs, and those of a run cut off at 2 minutes too). Which process: the run folder's pid
// (test-tmp.mjs: agentic-run-<pid>-…) in TMPDIR, the working folder or the program's path; the innermost
// one, for a run started inside a run. None (the Arena's checks): it runs as before.
const RUN = /\/agentic-run-(\d+)-/g;
export function runPid({ env = process.env, cwd = process.cwd(), argv = process.argv } = {}) {
  for (const place of [env.TMPDIR, cwd, ...argv.slice(1)]) {
    const pids = [...String(place ?? '').matchAll(RUN)].map((m) => Number(m[1]));
    if (pids.length) return pids.at(-1);
  }
  return 0;
}

// Looks every `every` ms whether that process is still there, and ends this one when it is not.
// A process another sandbox owns answers EPERM: it is there.
export function endWithRun({ every = 2000, pid = runPid(), exit = () => process.exit(0) } = {}) {
  if (!pid || pid === process.pid) return null;
  const timer = setInterval(() => { try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') { clearInterval(timer); exit(); } } }, every);
  timer.unref?.();
  return pid;
}
