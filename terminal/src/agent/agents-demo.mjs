// /agents demo: the real run engine (agents-run.mjs) on a pretend driver, so the tree can be seen
// and tried without a model, and so the app's tests can drive it. Nothing is written to the
// folder; the model, the commands and the second opinion answer from a small Kepler-solver story:
// a test that fails first, task 3 missing once (the second opinion says where), task 5's doubt
// review finding something to fix, and a suggestion or two in Review.
// AGENTIC_AGENTS_DEMO_MS sets how long one beat is (1000 by default; the tests make it short).
const TASKS = [
  { title: 'Parse the elements', check: 'rejects e ≥ 1', files: ['kepler.py'] },
  { title: 'Mean anomaly at t', check: 'M wraps to [0, 2π)', files: ['kepler.py'] },
  { title: 'Kepler solver', check: 'solves e = 0.9 within 1e−12', files: ['kepler.py'] },
  { title: 'True anomaly', check: 'ν matches the tan(ν/2) form at 8 points', files: ['kepler.py'] },
  { title: 'Position vector', check: 'r = a(1 − e·cos E)', files: ['orbit.py'] },
  { title: 'Energy is kept', check: 'v²/2 − μ/r the same at 1,000 times', files: ['tests/test_orbit.py'] },
  { title: 'Print the orbit', check: 'prints x, y, z to 12 digits', files: ['cli.py'] },
];
const SPEC = `## Goal
Where an orbit is at time t, from its elements.

## Inputs and outputs
a, e, i, Ω, ω, M0 and a time t in; x, y, z in km out.

## Acceptance checks
1. e ≥ 1 is rejected.
2. Kepler's equation is solved to |E − e·sin E − M| ≤ 1e−12 for 0 ≤ e < 1.
3. Energy v²/2 − μ/r stays the same at 1,000 times.

## Constraints
Standard library only.

## Out of scope
Hyperbolic orbits.`;

export function demoDriver({ beat = Number(process.env.AGENTIC_AGENTS_DEMO_MS) || 1000 } = {}) {
  const wait = (n, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, n * beat);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('stopped')); }, { once: true });
  });
  const files = new Map();
  let task = 0, runs = 0, missed = false, doubted = false;
  const taskOf = (text) => Number(/task (\d+)\//.exec(text)?.[1] ?? task);
  return {
    model: 'qwen3-coder-next',
    reviewer: 'qwen3.6 35b',
    testCmd: 'python3 -m pytest',
    async complete({ system, signal }) {
      await wait(1.5, signal);
      if (/Ask the 3 to 5 questions/.test(system)) return JSON.stringify({ questions: [
        { q: 'What does it take in?', options: ['a, e, i, Ω, ω, M0 and a time t', 'a position and a velocity'] },
        { q: 'How exact must E be?', options: ['|E − e·sin E − M| ≤ 1e−12', '1e−9 is enough'] },
        { q: 'What is it checked against?', options: ['reference cases and a slow bisection', 'reference cases only'] },
      ] });
      if (/Write SPEC\.md/.test(system)) return SPEC;
      if (/Break the spec/.test(system)) return JSON.stringify({ tasks: TASKS });
      if (/Stability/.test(system)) return JSON.stringify({ findings: [{ level: 'important', at: 'kepler.py:27', text: '1 − e·cos E nears 0 as e → 1', fix: 'cap the Newton step at ±1' }] });
      if (/Precision/.test(system)) return JSON.stringify({ findings: [{ level: 'suggestion', at: 'kepler.py:19', text: 'n·t loses digits when t is huge', fix: 'take t modulo the period first' }] });
      return JSON.stringify({ findings: [] });
    },
    async send(text, { signal } = {}) {
      task = taskOf(text);
      const red = /Write ONE new failing test/.test(text);
      await wait(red ? 2 : 2.5, signal);
      if (red) { runs = 0; return { reason: 'done', files: ['tests/test_kepler.py'], diff: `+def test_task_${task}():\n+    ...`, text: 'Wrote the failing test.' }; }
      if (/verify/.test(text)) return { reason: 'done', files: [], diff: '', text: /two ways|second, independent/.test(text) ? 'Newton and bisection agree to 2e−15 at 10,000 points.' : 'x = −6,045.0 km  y = −3,490.4 km  z = 2,500.1 km' };
      return { reason: 'done', files: [TASKS[task - 1]?.files?.[0] ?? 'kepler.py'], diff: `--- a/kepler.py\n+++ b/kepler.py\n+    # task ${task}`, text: 'Done.' };
    },
    async exec(cmd, { signal } = {}) {
      await wait(1, signal);
      if (!/pytest\s+\S/.test(cmd)) return { code: 0, out: '23 passed in 0.8s' };
      runs++;
      if (runs === 1) return { code: 1, out: `E   ImportError: cannot import name for task ${task}\n1 failed` };
      if (task === 3 && !missed) { missed = true; return { code: 1, out: 'E   ArithmeticError: |E − M − e·sin E| = 3e−9 after 50 steps\n1 failed' }; }
      return { code: 0, out: '6 passed' };
    },
    async review({ request, signal }) {
      await wait(1.5, signal);
      if (/Check this plan/.test(request)) return { ok: false, findings: ['the plan has no e = 0 case: add a circle'], model: 'qwen3.6 35b' };
      if (/fails like this/.test(request)) return { ok: false, findings: ['start Newton at E0 = π when e > 0.8'], model: 'qwen3.6 35b' };
      if (/Position vector/.test(request) && !doubted) { doubted = true; return { ok: false, findings: ['i = 0 leaves Ω undefined: add a test for it'], model: 'qwen3.6 35b' }; }
      return { ok: true, findings: [], note: 'it holds', model: 'qwen3.6 35b' };
    },
    listFiles: () => ['kepler.py', 'tests/'],
    read: (rel) => files.get(rel) ?? (rel === 'SPEC.md' ? SPEC : null),
    write: (rel, text) => { files.set(rel, text); },
    save: () => {},
    setGuard: () => {},
    reviewInTurn: () => {},
    demo: true,
  };
}
