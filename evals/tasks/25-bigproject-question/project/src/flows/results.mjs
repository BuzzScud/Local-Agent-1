// Reads test-runner output: how many passed and failed, and which failed.
// Knows node:test, Jest, Vitest, Mocha, pytest and unittest; otherwise the exit code decides.
export function readResults(out, code) {
  let passed = null;
  let failed = null;
  let m;
  if ((m = /ℹ pass (\d+)/.exec(out))) { passed = +m[1]; failed = +(/ℹ fail (\d+)/.exec(out)?.[1] ?? 0); }
  else if ((m = /Tests:\s+(?:(\d+) failed, )?(?:\d+ skipped, )?(\d+) passed/.exec(out))) { failed = +(m[1] ?? 0); passed = +m[2]; }
  else if ((m = /Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed/.exec(out))) { failed = +(m[1] ?? 0); passed = +m[2]; }
  else if ((m = /(\d+) passing/.exec(out))) { passed = +m[1]; failed = +(/(\d+) failing/.exec(out)?.[1] ?? 0); }
  else if ((m = /=+ (?:(\d+) failed, )?(\d+) passed/.exec(out)) || (m = /=+ (\d+) failed/.exec(out))) { failed = +(m[1] ?? 0); passed = +(m[2] ?? 0); }
  else if ((m = /Ran (\d+) tests?/.exec(out))) { const f = /FAILED \((?:failures=(\d+))?(?:, )?(?:errors=(\d+))?/.exec(out); failed = f ? +(f[1] ?? 0) + +(f[2] ?? 0) : 0; passed = +m[1] - failed; }
  const failing = [...out.matchAll(/^\s*(?:✖|✗|×|FAIL|FAILED)\s+(.+?)(?:\s+\([\d.]+m?s\))?$/gm)].map((x) => x[1].trim()).filter((x) => !/^failing tests:?$/i.test(x) && !x.startsWith("("));
  const ok = code === 0 && (failed === null || failed === 0);
  return { ok, passed, failed, total: passed === null ? null : passed + failed, failing: [...new Set(failing)].slice(0, 10) };
}

// The useful part of a failing run for the model: the failures, not the noise.
export function failureDigest(out, maxLines = 60) {
  const lines = out.split('\n');
  const start = lines.findIndex((l) => /failing tests:|FAILURES|✖|FAIL|Error/.test(l));
  const from = start > 0 ? Math.max(0, start - 3) : 0;
  return lines.slice(from, from + maxLines).join('\n');
}

// The assertion lines of each failing test ("3 !== 2.5"), for the next try.
export function assertionDetail(out, maxLines = 24) {
  const lines = out.split('\n');
  const keep = [];
  for (let i = 0; i < lines.length && keep.length < maxLines; i++) {
    if (/^\s*(✖|FAIL|FAILED|E\s{2,}|AssertionError|Expected|Received|actual|expected|\+ |- |\d+ !== |>\s)/.test(lines[i]) && !/failing tests:/.test(lines[i])) keep.push(lines[i].trimEnd());
  }
  return [...new Set(keep)].join('\n');
}
