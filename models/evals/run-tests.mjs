// The tests the hub's Tests tab can run (its ▶ Run a test tab, `/test` in Agentic Coder), one model
// at a time: what each is, the command it runs (from the repo's top), how the page counts its
// progress from the lines it prints, and how its line in the test record is found. The Battle
// arena's runner starts them (models/evals/battle/runner.mjs): it holds the memory the way a battle
// does, so an Agentic Coder window lets go of its model while a test runs, and a run keeps going
// when the window closes. A test that needs no model (the unit tests, the repo check) runs the same
// way, without the hold.
//   model   true: it runs on the model picked (gemma, qwen); false: it takes none
//   total   how many items a full run has (PASS/FAIL lines counted by `count`); null: no count
//   think   it can run with thinking on (the tab's Thinking switch, key T): at High, the one level
//           Gemma and Qwen have besides Low; off (Low) is the default, the way a battle runs
//   stop    the signal the Stop button sends first: each runner then saves what it has
//   record  its line in the test record: kind, a name pattern, and whether it is a full run (its
//           effort, low or high, tells a run with thinking from one without)
// run.mjs's words for thinking: on at High (Gemma and Qwen have no Medium), or off.
const thinkRun = (think) => (think ? ['--think', 'on', '--effort', 'high'] : ['--think', 'off']);

export const RUN_TESTS = [
  { id: 'practice28', name: 'Practice 28', what: 'the 28 practice tasks, each with its own check', model: true, think: true, total: 28, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/bench/run.mjs', args: (m, n, think) => ['--model', m, ...thinkRun(think), '--set', '28'],
    stop: 'SIGTERM', record: { kind: 'tasks', name: '^The 28 practice tasks', part: false } },
  { id: 'task', name: 'One practice task', what: 'one of the 28, as a quick check: pick its number', model: true, think: true, total: 1, count: '^(PASS|FAIL)\\s', pick: { min: 1, max: 28, default: 10 },
    script: 'models/evals/bench/run.mjs', args: (m, n, think) => ['--model', m, ...thinkRun(think), '--only', String(n)],
    stop: 'SIGTERM', record: { kind: 'tasks', name: '^The 1 picked practice tasks', part: true } },
  { id: 'requests', name: 'Real requests', what: '28 everyday requests in throwaway folders: where each goes, and that blocked commands stay blocked', model: true, think: true, total: 28, count: '^(OK|FAIL)\\s+#\\d+',
    script: 'models/evals/bench/words/real.mjs', args: (m, n, think) => ['--model', m, ...(think ? ['--think', 'on'] : [])],
    stop: 'SIGTERM', record: { kind: 'requests', name: '^The 28 real requests$', part: false } },
  { id: 'long', name: 'Long task', what: 'one long, read-heavy question: where the time goes and what it reads twice (stops by itself at 20 min)', model: true, think: true, total: null, minutes: 20,
    script: 'models/evals/tools/long-task.mjs', args: (m, n, think) => ['--model', m, '--effort', think ? 'high' : 'low', '--minutes', '20', '--record'],
    stop: 'SIGINT', record: { kind: 'other', name: '^Long task', part: false } },
  { id: 'work28', name: 'Work 28', what: 'the Battle set about your own work, on this model alone', model: true, think: true, total: 28, count: '^(PASS|FAIL|NONE)\\s',
    script: 'models/evals/battle/run-set.mjs', args: (m, n, think) => ['--model', m, '--set', 'work28', ...(think ? ['--think', 'on'] : [])],
    stop: 'SIGTERM', record: { kind: 'sets', name: '^The Work 28', part: false } },
  { id: 'new28', name: 'New 28', what: 'the Battle’s New 28 set, on this model alone', model: true, think: true, total: 28, count: '^(PASS|FAIL|NONE)\\s',
    script: 'models/evals/battle/run-set.mjs', args: (m, n, think) => ['--model', m, '--set', 'new28', ...(think ? ['--think', 'on'] : [])],
    stop: 'SIGTERM', record: { kind: 'sets', name: '^The New 28', part: false } },
  { id: 'unit', name: 'Unit tests', what: 'bun test over both parts, with the stand-in model (no real one loads)', model: false, total: null,
    script: 'models/evals/tools/run-suite.mjs', args: () => [],
    stop: 'SIGTERM', record: { kind: 'suite', name: '^Unit tests', part: false } },
  { id: 'check', name: 'Repo check', what: 'is anything in the repo that should not be: secrets, packages, where the code connects (the fast one: no model files, no unit tests)', model: false, total: null,
    script: 'models/evals/tools/check.mjs', args: () => ['--fast'],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Repo check', part: false } },
];

export const runTestById = (id) => RUN_TESTS.find((t) => t.id === id) ?? null;

// The words /test takes for a test: its id, or a name as you would say it ("practice 28", "work28",
// "unit tests"). null when nothing matches.
export function findRunTest(words) {
  const w = String(words ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!w) return null;
  const hit = (t) => [t.id, t.name, t.name.replace(/\s+tests?$/i, '')].map((x) => x.toLowerCase().replace(/[^a-z0-9]+/g, ''));
  return RUN_TESTS.find((t) => hit(t).includes(w)) ?? RUN_TESTS.find((t) => hit(t).some((x) => x.startsWith(w))) ?? null;
}

// The command a run starts: [script, ...args], checked. A test that takes a model needs one of
// `models` (the ids in the registry); one that takes none ignores it. `n` is the task number of
// "One practice task"; `think` turns thinking on where the test can take it (else it is off).
export function runCommand(id, { model = null, n = null, think = false, models = [] } = {}) {
  const t = runTestById(id);
  if (!t) throw new Error(`no test "${id}"`);
  if (t.model && !models.includes(model)) throw new Error(`pick a model to run ${t.name} on (${models.join(' or ')})`);
  let num = null;
  if (t.pick) {
    num = n == null || n === '' ? t.pick.default : Number(n);
    if (!Number.isInteger(num) || num < t.pick.min || num > t.pick.max) throw new Error(`${t.name}: a task number from ${t.pick.min} to ${t.pick.max}`);
  }
  const on = Boolean(t.think && think);
  return { test: t, n: num, think: on, argv: [t.script, ...t.args(t.model ? model : null, num, on)] };
}

// What the page needs to show them (no functions): the list, with each one's command as text,
// thinking off (`command`) and on (`commandThink`, for a test that can take it).
export function runCatalog(models = []) {
  const text = (t, think) => Object.fromEntries((t.model ? models : [null]).map((m) => [m ?? 'none', ['node', t.script, ...t.args(m, t.pick?.default, think)].join(' ')]));
  return RUN_TESTS.map((t) => ({
    id: t.id, name: t.name, what: t.what, model: t.model, think: Boolean(t.think), total: t.total, count: t.count ?? null, minutes: t.minutes ?? null, pick: t.pick ?? null, record: t.record,
    command: text(t, false), ...(t.think ? { commandThink: text(t, true) } : {}),
  }));
}

// Progress from the lines a run printed so far: { done, passed, total }.
export function countLines(t, lines) {
  if (!t.count) return { done: null, passed: null, total: t.total };
  const re = new RegExp(t.count);
  const hits = lines.filter((l) => re.test(l));
  return { done: hits.length, passed: hits.filter((l) => /^(PASS|OK)\b/.test(l)).length, total: t.total };
}
