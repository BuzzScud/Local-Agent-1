// The rescue round: when every try passes its new test but stale EXISTING
// tests fail (task 28's class), the change flow may update those tests, each
// edit with your OK. Plus the done check judging a request part by part, and
// Read's outline showing the lines that match the request.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { testTitles, onlyOldTestsFail } from '../src/flows/rescue.mjs';
import { execute } from '../src/agent/tools.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];

test('testTitles finds JS and Python test names', () => {
  expect(testTitles("import { test } from 'node:test';\ntest('total doubles', () => {});\nit(`adds up`, () => {});")).toEqual(['total doubles', 'adds up']);
  expect(testTitles('class T(unittest.TestCase):\n  def test_total(self):\n    pass')).toEqual(['test_total']);
  expect(testTitles('')).toEqual([]);
});

test('onlyOldTestsFail: old-only failures qualify, new-test failures do not', () => {
  expect(onlyOldTestsFail(['total doubles'], ['total adds one'])).toBe(true);
  expect(onlyOldTestsFail(['total adds one'], ['total adds one'])).toBe(false);
  expect(onlyOldTestsFail(['suite > total adds one'], ['total adds one'])).toBe(false);
  expect(onlyOldTestsFail([], ['total adds one'])).toBe(false);
});

const fixture = () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'bonsai-rescue-')), 'project');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'price.mjs'), 'export const total = (n) => n * 2;\n');
  writeFileSync(join(cwd, 'price.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { total } from './price.mjs';\n\ntest('total doubles', () => { assert.strictEqual(total(2), 4); });\n");
  return cwd;
};

async function run(cwd, prompt, replies, { answer = 'yes' } = {}) {
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'ask', maxTries: 2,
    ask: async (req) => { events.push({ type: 'ask', name: req.name, req }); return { choice: typeof answer === 'function' ? answer(req) : answer }; } });
  for (const t of ['assistant', 'tool', 'note', 'tries-done', 'route']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reason = await agent.send(prompt);
  await fake.close();
  return { reason, events, agent, fake };
}

test('change: stale existing tests are updated in a rescue round, with your OK', async () => {
  const cwd = fixture();
  const newTest = "```js\nimport { test } from 'node:test';\nimport assert from 'node:assert';\nimport { total } from './price.mjs';\ntest('total adds one after doubling', () => { assert.strictEqual(total(2), 5); });\n```";
  const good = '```js\nexport const total = (n) => n * 2 + 1;\n```';
  const rescueBlocks = "### price.test.mjs\n<<<<<<< OLD\ntest('total doubles', () => { assert.strictEqual(total(2), 4); });\n=======\ntest('total doubles', () => { assert.strictEqual(total(2), 5); });\n>>>>>>> NEW";
  const replies = [
    { text: newTest }, { text: newTest },           // round one: two tests
    { text: good }, { text: good },                 // two drafts (right, but the old test fails)
    { text: newTest },                              // they disagree: one more test
    { text: good }, { text: good },                 // two more drafts
    { text: newTest }, { text: newTest },           // "simpler tests" round
    { text: good }, { text: good },                 // tries against the chosen test (maxTries 2)
    { text: rescueBlocks },                         // the rescue: update the stale expected value
    { text: 'Makes total double and add one.' },    // describe
  ];
  const { reason, events, fake } = await run(cwd, 'change total in price.mjs: it should double and then add 1', replies);
  expect(reason).toBe('done');
  expect(fake.remaining()).toBe(0);
  expect(events.filter((e) => e.type === 'ask').map((e) => e.name)).toEqual(['Test', 'Edit', 'Edit']);
  const rescued = events.find((e) => e.type === 'tries-done' && e.label === 'Updating existing tests');
  expect(rescued.marks).toEqual(['✓']);
  expect(readFileSync(join(cwd, 'price.mjs'), 'utf8')).toContain('n * 2 + 1');
  const tests = readFileSync(join(cwd, 'price.test.mjs'), 'utf8');
  expect(tests).toContain("test('total doubles', () => { assert.strictEqual(total(2), 5); });");
  expect(tests).toContain('total adds one after doubling');
  expect(tests).not.toContain(', 4);');
}, 90_000);

test('rescue: saying no to the updated test file changes nothing', async () => {
  const cwd = fixture();
  const newTest = "```js\nimport { test } from 'node:test';\nimport assert from 'node:assert';\nimport { total } from './price.mjs';\ntest('total adds one after doubling', () => { assert.strictEqual(total(2), 5); });\n```";
  const good = '```js\nexport const total = (n) => n * 2 + 1;\n```';
  const rescueBlocks = "### price.test.mjs\n<<<<<<< OLD\ntest('total doubles', () => { assert.strictEqual(total(2), 4); });\n=======\ntest('total doubles', () => { assert.strictEqual(total(2), 5); });\n>>>>>>> NEW";
  const replies = [
    { text: newTest }, { text: newTest }, { text: good }, { text: good },
    { text: newTest }, { text: good }, { text: good },
    { text: newTest }, { text: newTest },
    { text: good }, { text: good },
    { text: rescueBlocks },
  ];
  // The first edit (price.mjs) is declined, so nothing is written at all.
  const { reason } = await run(cwd, 'change total in price.mjs: it should double and then add 1', replies,
    { answer: (req) => (req.name === 'Edit' ? 'no' : 'yes') });
  expect(reason).toBe('declined');
  expect(readFileSync(join(cwd, 'price.mjs'), 'utf8')).toContain('n * 2;');
  expect(readFileSync(join(cwd, 'price.test.mjs'), 'utf8')).toContain(', 4);');
}, 90_000);

test('the done check judges the request part by part', async () => {
  const cwd = fixture();
  const fake = await startFakeServer([
    { text: '{"parts":[{"part":"add a --json flag","done":true},{"part":"update the README","done":false}],"done":true,"missing":""}' },
    { text: '{"parts":[{"part":"add a --json flag","done":true}],"done":true,"missing":""}' },
  ]);
  const agent = new Agent({ url: fake.url, model, cwd, system: 'test', thinking: false, ask: async () => ({ choice: 'yes' }) });
  agent.messages.push({ role: 'user', content: 'add a --json flag and update the README' });
  agent.turn = { diffs: '+ json flag added', changed: true };
  // An undone part is reported, even when the top-level "done" says true.
  expect(await agent.verifyDone('Added the flag.')).toBe('update the README');
  // Every part done: no complaint.
  expect(await agent.verifyDone('Added the flag.')).toBe(null);
  await fake.close();
});

test("Read's outline of a long file shows the lines that match the request", async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bonsai-readex-'));
  const lines = [];
  for (let i = 1; i <= 300; i++) lines.push(i === 207 ? 'const symMenu = { zIndex: 80 };' : `const filler${i} = ${i};`);
  writeFileSync(join(cwd, 'page.mjs'), lines.join('\n') + '\n');
  const withReq = await execute('Read', { path: 'page.mjs' }, {}, { cwd, request: 'the symMenu dropdown is hidden, fix its layering' });
  expect(withReq.text).toContain('Lines matching the request');
  expect(withReq.text).toContain('symMenu');
  expect(withReq.text).toContain('lines 205-209');
  const noReq = await execute('Read', { path: 'page.mjs' }, {}, { cwd, request: '' });
  expect(noReq.text).not.toContain('Lines matching the request');
  const noHit = await execute('Read', { path: 'page.mjs' }, {}, { cwd, request: 'nothing about that file at all' });
  expect(noHit.text).not.toContain('Lines matching the request');
});
