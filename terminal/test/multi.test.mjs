// Changes across several files (src/flows/multi.mjs), edit blocks
// (src/flows/blocks.mjs), the planner, and the fix path's wider stage.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { parseBlocks, applyBlocks, guardChange } from '../src/flows/blocks.mjs';
import { planFiles } from '../src/flows/multi.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const TASKS = join(import.meta.dir, '..', '..', 'models', 'evals', 'bench', 'tasks');
const copyTask = (name) => { const d = join(mkdtempSync(join(tmpdir(), 'bonsai-multi-')), 'project'); cpSync(join(TASKS, name, 'project'), d, { recursive: true }); return d; };
const check = (name, cwd) => spawnSync('/bin/zsh', [join(TASKS, name, 'check.sh')], { cwd, encoding: 'utf8', timeout: 60_000 });

async function run(cwd, prompt, replies, { answer = 'yes' } = {}) {
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'ask', maxTries: 4,
    ask: async (req) => { events.push({ type: 'ask', name: req.name, req }); return { choice: typeof answer === 'function' ? answer(req) : answer }; } });
  for (const t of ['assistant', 'tool', 'note', 'tries-done', 'route']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reason = await agent.send(prompt);
  await fake.close();
  return { reason, events, agent, fake };
}

const BLOCKS = `### config.mjs
<<<<<<< OLD
export const DEFAULTS = { locale: 'en-US', decimals: 2 };
=======
export const DEFAULTS = { locale: 'en-US', decimals: 2, symbol: '$' };
>>>>>>> NEW

### format.mjs
<<<<<<< OLD
  return \`\${amount < 0 ? '-' : ''}$\${fixed}\`;
=======
  return \`\${amount < 0 ? '-' : ''}\${o.symbol}\${fixed}\`;
>>>>>>> NEW

### report.mjs
<<<<<<< OLD
  return ['Total in $', ...lines, \`Total: \${formatMoney(total, o)}\`].join('\\n');
=======
  return [\`Total in \${o.symbol}\`, ...lines, \`Total: \${formatMoney(total, o)}\`].join('\\n');
>>>>>>> NEW
`;
const SYMBOL_TEST = "```js\ntest('symbol option reaches the rows and the header', () => {\n  assert.equal(formatMoney(1234.5, { symbol: '€' }), '€1,234.50');\n  assert.equal(buildReport([{ name: 'a', amount: 1 }], { symbol: '€' }), 'Total in €\\na: €1.00\\nTotal: €1.00');\n});\n```";

test('edit blocks: parsed from a reply (fenced or not), applied with the Edit tool’s matching', () => {
  const blocks = parseBlocks('```\n' + BLOCKS + '```');
  expect(blocks.map((b) => b.path)).toEqual(['config.mjs', 'format.mjs', 'report.mjs']);
  expect(blocks[0].old).toBe("export const DEFAULTS = { locale: 'en-US', decimals: 2 };");
  const files = { 'config.mjs': "// c\nexport const DEFAULTS = { locale: 'en-US', decimals: 2 };\n", 'format.mjs': "x\n    return `${amount < 0 ? '-' : ''}$${fixed}`;\n", 'report.mjs': "  return ['Total in $', ...lines, `Total: ${formatMoney(total, o)}`].join('\\n');\n" };
  const r = applyBlocks(blocks, (rel) => files[rel] ?? null);
  expect(r.error).toBeUndefined();
  expect(r.files.get('config.mjs')).toContain("symbol: '$'");
  expect(r.files.get('format.mjs')).toContain('    return `${amount < 0 ? \'-\' : \'\'}${o.symbol}${fixed}`;'); // indentation kept
  // An OLD that is not in the file, a missing file, a bad path.
  expect(applyBlocks(parseBlocks('### config.mjs\n<<<<<<< OLD\nnot there\n=======\nx\n>>>>>>> NEW'), (rel) => files[rel] ?? null).error).toMatch(/config\.mjs/);
  expect(applyBlocks(parseBlocks('### nope.mjs\n<<<<<<< OLD\na\n=======\nb\n>>>>>>> NEW'), () => null).error).toMatch(/does not exist/);
  expect(applyBlocks(parseBlocks('### ../x.mjs\n<<<<<<< OLD\n=======\nb\n>>>>>>> NEW'), () => null).error).toMatch(/bad path/);
  // Empty OLD: appended to an existing file, or a new file.
  const add = applyBlocks(parseBlocks('### config.mjs\n<<<<<<< OLD\n=======\nexport const X = 1;\n>>>>>>> NEW\n### new.mjs\n<<<<<<< OLD\n=======\nexport const Y = 2;\n>>>>>>> NEW'), (rel) => files[rel] ?? null);
  expect(add.files.get('config.mjs')).toBe(`${files['config.mjs']}export const X = 1;\n`);
  expect(add.files.get('new.mjs')).toBe('export const Y = 2;\n');
  expect(applyBlocks([], () => null).error).toMatch(/no edit blocks/);
}, 30_000);

test('the planner: files named in the request need no model; otherwise the model picks from the map', async () => {
  const cwd = copyTask('19-multifile-symbol');
  const ctx = { cwd, url: 'http://127.0.0.1:1', model, signal: null };
  const files = ['config.mjs', 'format.mjs', 'report.mjs', 'report.test.mjs', 'package.json'];
  expect(await planFiles(ctx, 'use the symbol from config.mjs in format.mjs and report.mjs', files)).toEqual(['config.mjs', 'format.mjs', 'report.mjs']);
  const fake = await startFakeServer([{ text: '{"files": ["format.mjs", "config.mjs"]}' }]);
  expect(await planFiles({ ...ctx, url: fake.url }, 'add a symbol option and use it when formatting', files)).toEqual(['format.mjs', 'config.mjs']);
  const ask = fake.requests[0].messages[1].content;
  expect(ask).toContain('format.mjs (9 lines): formatMoney');
  expect(ask).toContain('mentions');
  expect(fake.requests[0].response_format.json_schema.schema.properties.files.items.enum).toEqual(expect.arrayContaining(['config.mjs', 'format.mjs', 'report.mjs']));
  expect(fake.requests[0].response_format.json_schema.schema.properties.files.items.enum).not.toContain('report.test.mjs');
  await fake.close();
}, 30_000);

test('multi-file change: one test, edit blocks over three files, your OK per file, the tests pass', async () => {
  const cwd = copyTask('19-multifile-symbol');
  const task = readFileSync(join(TASKS, '19-multifile-symbol', 'task.txt'), 'utf8').trim();
  // Two tests and two drafts that agree; then the summary sentence.
  const replies = [{ text: SYMBOL_TEST }, { text: SYMBOL_TEST }, { text: BLOCKS }, { text: '```\n' + BLOCKS + '```' }, { text: 'Adds a symbol option used by the formatter and the report.' }];
  const { reason, events, fake } = await run(cwd, task, replies);
  expect(reason).toBe('done');
  expect(events.find((e) => e.type === 'route').kind).toBe('change');
  expect(events.filter((e) => e.type === 'tool' && e.label === 'Read').map((e) => e.arg)).toEqual(['config.mjs', 'format.mjs', 'report.mjs']);
  expect(events.filter((e) => e.type === 'ask').map((e) => `${e.name}:${e.req.arg ?? e.req.args.path}`)).toEqual(['Test:report.test.mjs', 'Edit:config.mjs', 'Edit:format.mjs', 'Edit:report.mjs']);
  expect(events.filter((e) => e.type === 'tries-done').map((e) => `${e.label}: ${e.marks.join('')}`)).toEqual(['Writing tests: ✓✓', 'Drafting changes: ✓✓', 'Checked tests against drafts: ✓✓']);
  expect(fake.remaining()).toBe(0);
  const final = events.findLast((e) => e.type === 'assistant');
  expect(final.text).toBe('Adds a symbol option used by the formatter and the report. Changed config.mjs, format.mjs, report.mjs and added a test to report.test.mjs; all 3 tests pass.');
  const c = check('19-multifile-symbol', cwd);
  expect([c.status, c.stdout + c.stderr]).toEqual([0, '']);
}, 30_000);

test('multi-file change: a draft whose blocks do not match is dropped; saying no to the test stops everything', async () => {
  const cwd = copyTask('19-multifile-symbol');
  const task = readFileSync(join(TASKS, '19-multifile-symbol', 'task.txt'), 'utf8').trim();
  const bad = '### config.mjs\n<<<<<<< OLD\nthis line is not in the file\n=======\nx\n>>>>>>> NEW';
  const replies = [{ text: SYMBOL_TEST }, { text: SYMBOL_TEST }, { text: bad }, { text: BLOCKS }, { text: SYMBOL_TEST }, { text: BLOCKS }, { text: BLOCKS }];
  const { reason, events } = await run(cwd, task, replies, { answer: (req) => (req.name === 'Test' ? 'no' : 'yes') });
  expect(reason).toBe('declined');
  expect(events.find((e) => e.type === 'tries-done' && e.label === 'Drafting changes').marks).toEqual(['✗', '✓']);
  expect(readFileSync(join(cwd, 'config.mjs'), 'utf8')).not.toContain('symbol');
  expect(readFileSync(join(cwd, 'report.test.mjs'), 'utf8')).not.toContain('symbol option');
}, 30_000);

test('fix: when three function-only tries fail, edit blocks over the whole file fix a bug in two places', async () => {
  const cwd = copyTask('21-bigfile-two-places');
  const wrong = '```js\nexport function summary(values) {\n  return { n: values.length };\n}\n```';
  const both = `### stats.mjs
<<<<<<< OLD
  const mid = Math.floor(s.length / 2);
  return s[mid];
=======
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
>>>>>>> NEW

### stats.mjs
<<<<<<< OLD
    min: max,
    max: min,
=======
    min,
    max,
>>>>>>> NEW`;
  const replies = [{ text: '{"function": "summary"}' }, { text: wrong }, { text: wrong }, { text: wrong }, { text: both }, { text: 'Fixes median for even counts and the swapped min/max in summary.' }];
  const { reason, events, fake } = await run(cwd, 'The tests in this project fail. Find the bug and fix it (fix the code, not the tests).', replies);
  expect(reason).toBe('done');
  expect(events.filter((e) => e.type === 'tries-done').map((e) => `${e.label}: ${e.marks.join('')}`)).toEqual(['Trying fixes: ✗✗✗', 'Trying wider fixes: ✓']);
  expect(fake.remaining()).toBe(0);
  expect(events.findLast((e) => e.type === 'assistant').text).toContain('Fixed stats.mjs; all 4 tests pass.');
  const c = check('21-bigfile-two-places', cwd);
  expect([c.status, c.stdout + c.stderr]).toEqual([0, '']);
}, 30_000);

test('guardChange: a change that drops functions the task never mentions, or most of a file, is refused', () => {
  const before = 'export function a() {\n  return 1;\n}\nexport function b() {\n  return 2;\n}\nexport function c() {\n  return 3;\n}\n';
  expect(guardChange('x.mjs', before, before.replace('return 1', 'return 10'), 'fix a')).toBe(null);
  expect(guardChange('x.mjs', before, 'export function a() {\n  return 1;\n}\n', 'fix the bug')).toMatch(/removes b, c, which the task does not ask for/);
  expect(guardChange('x.mjs', before, 'export function a() {\n  return 1;\n}\n', 'remove the unused helpers')).toBe(null);
  const long = Array.from({ length: 100 }, (_, i) => `const v${i} = ${i};`).join('\n');
  expect(guardChange('data.txt', long, long.split('\n').slice(0, 40).join('\n'), 'tidy the values')).toMatch(/removes 60 more lines/);
  expect(guardChange('data.txt', long, `${long}\nconst w = 1;`, 'add w')).toBe(null);
  expect(guardChange('new.mjs', null, 'export const x = 1;', 'add x')).toBe(null);
}, 30_000);

test('multi-file change: a draft that adds a file on the side, or deletes a function, is refused', async () => {
  const cwd = copyTask('19-multifile-symbol');
  const task = readFileSync(join(TASKS, '19-multifile-symbol', 'task.txt'), 'utf8').trim();
  const stray = `${BLOCKS}\n### test.mjs\n<<<<<<< OLD\n=======\nconsole.log('hi');\n>>>>>>> NEW\n`;
  const deleting = BLOCKS.replace("<<<<<<< OLD\n  return \`\${amount < 0 ? '-' : ''}$\${fixed}\`;\n=======\n  return \`\${amount < 0 ? '-' : ''}\${o.symbol}\${fixed}\`;", "<<<<<<< OLD\nexport function formatMoney(amount, opts = {}) {\n=======\nexport function money(amount, opts = {}) {");
  const replies = [{ text: SYMBOL_TEST }, { text: SYMBOL_TEST }, { text: stray }, { text: deleting }, { text: SYMBOL_TEST }, { text: BLOCKS }, { text: BLOCKS }, { text: 'Adds a symbol option.' }];
  const { reason, events } = await run(cwd, task, replies);
  expect(reason).toBe('done');
  const drafts = events.filter((e) => e.type === 'tries-done' && e.label === 'Drafting changes').map((e) => e.marks.join(''));
  expect(drafts).toEqual(['✗✗', '✓✓']);
  expect(readFileSync(join(cwd, 'format.mjs'), 'utf8')).toContain('export function formatMoney');
  expect(existsSync(join(cwd, 'test.mjs'))).toBe(false);
}, 30_000);
