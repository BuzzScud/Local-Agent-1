// The scripted demo session. The model's words below are written by hand
// (no model is downloaded yet); record.mjs runs every tool call for real on a
// copy of demo-project/ and times each step with the speed estimates below.

export const MODEL = 'Bonsai 2 27B';
export const CONTEXT_WINDOW = 65_536;
export const RAM_GB = 10.3; // measured 2026-09-24: 7.21 GB file + 3.07 GB working memory at 32k

// Bonsai 2 27B on the Apple M4, measured 2026-09-24 in a real job.
export const DECODE_TPS = 10.4;
export const PREFILL_TPS = 61;
export const SYSTEM_TOKENS = 1_050; // our short system prompt + 7 tool definitions, pre-warmed at launch

export const DISPLAY_CWD = '~/Desktop/bonsai-code/demo-project';

export const TASK = 'add a --json flag to export.mjs that prints the rows as JSON, and add a test for it';

const TEST_OLD = `test('main reads the trades file', () => {
  assert.match(main(['trades.json']), /^symbol,side,qty,price\\n/);
});
`;

export const steps = [
  { kind: 'user', text: TASK, typing: 2.5 },
  { kind: 'prefill', tokens: 38, verb: 'Reading' },
  {
    kind: 'think', verb: 'Pruning', todo: 0,
    text: "The user wants a --json flag on export.mjs that prints the rows as JSON instead of CSV, plus a test. I haven't seen the file yet, so first I'll read export.mjs to see how main() parses its arguments and where the output is built.",
  },
  { kind: 'tool', tool: 'Read', verb: 'Pruning', todo: 0, args: { path: 'export.mjs' } },
  {
    kind: 'think', verb: 'Shaping', todo: 0,
    text: "main() takes argv, picks the first argument that doesn't start with -- as the file, parses the JSON and returns toCsv(rows). The flag check fits right there: if argv includes '--json', return JSON.stringify(rows, null, 2) instead of the CSV. The file argument keeps working because find() already skips anything that starts with --, and returning a string leaves the console.log at the bottom unchanged. For the test, export.test.mjs already calls main(['trades.json']), so I can call main(['trades.json', '--json']), parse the result and check the three trades. Then run node --test to be sure the two old tests still pass.",
  },
  {
    kind: 'todos', verb: 'Shaping',
    items: [
      { text: 'Read export.mjs', done: true },
      { text: 'Add the --json flag to main()', done: false },
      { text: 'Add a test for --json', done: false },
      { text: 'Run the tests', done: false },
    ],
  },
  { kind: 'text', verb: 'Shaping', todo: 1, text: "I'll add the check inside main(), so running it without the flag still prints CSV." },
  {
    kind: 'tool', tool: 'Update', verb: 'Grafting', todo: 1,
    args: { path: 'export.mjs', old: '  return toCsv(rows);\n', new: "  if (argv.includes('--json')) return JSON.stringify(rows, null, 2);\n  return toCsv(rows);\n" },
    permission: { choice: 0, wait: 3.0 },
  },
  {
    kind: 'think', verb: 'Rooting', todo: 2,
    text: "The flag is in. Now the test: parse main(['trades.json', '--json']) and check there are three rows and the first is the NQ buy, so the JSON path is covered without touching the CSV test.",
  },
  {
    kind: 'tool', tool: 'Update', verb: 'Grafting', todo: 2,
    args: {
      path: 'export.test.mjs',
      old: TEST_OLD,
      new: `${TEST_OLD}
test('--json prints the rows as JSON', () => {
  const out = JSON.parse(main(['trades.json', '--json']));
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { symbol: 'NQ', side: 'buy', qty: 1, price: 24812.5 });
});
`,
    },
    permission: { choice: 1, wait: 3.5 },
  },
  { kind: 'tool', tool: 'Bash', verb: 'Watering', todo: 3, args: { command: 'node --test' }, permission: { choice: 0, wait: 2.5 } },
  {
    kind: 'todos', verb: 'Watering',
    items: [
      { text: 'Read export.mjs', done: true },
      { text: 'Add the --json flag to main()', done: true },
      { text: 'Add a test for --json', done: true },
      { text: 'Run the tests', done: true },
    ],
  },
  {
    kind: 'final', verb: 'Watering',
    text: 'Done. `node export.mjs --json` now prints the trades as JSON; without the flag it still prints CSV. I added a test for the flag, and all 3 tests pass.',
  },
];
