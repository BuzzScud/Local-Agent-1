// The rules file check (models/evals/tools/rules-file-check.mjs): how it grades an answer and the
// task, its rule, and its results page. The check itself needs the real model (▶ Run a test →
// Rules file old vs new).
import { test, expect } from 'bun:test';
import { QUESTIONS, gradeAnswer, gradeTask, testsRun, summarize } from '../evals/tools/rules-file-check.mjs';
import { rulesFilePage } from '../evals/tools/rules-file-page.mjs';

const Q = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));

test('ten questions, and a right answer holds the words each one names', () => {
  expect(QUESTIONS.length).toBe(10);
  expect(gradeAnswer(Q.page, 'Save it as one HTML file in `cli docs/tests/`.')).toBe(true);
  expect(gradeAnswer(Q.page, 'Put it in docs/tests/ as one self-contained file.')).toBe(true);
  expect(gradeAnswer(Q.page, 'Anywhere you like.')).toBe(false);
  expect(gradeAnswer(Q.one, 'Run `bun run test terminal/test/room.test.mjs`.')).toBe(true);
  expect(gradeAnswer(Q.one, 'bun test terminal/test/room.test.mjs')).toBe(true);
  expect(gradeAnswer(Q.one, 'Run `bun run test`.')).toBe(false);
  expect(gradeAnswer(Q.parts, 'No. The terminal imports only models/index.mjs; add the name there.')).toBe(true);
  expect(gradeAnswer(Q.parts, 'Yes, just import it.')).toBe(false);
  expect(gradeAnswer(Q.secret, 'No: the GitHub repo is public, nothing secret is committed.')).toBe(true);
  expect(gradeAnswer(Q.secret, 'Sure, go ahead.')).toBe(false);
  expect(gradeAnswer(Q.raw, 'In models/<model>/results/, and they are not in git.')).toBe(true);
  expect(gradeAnswer(Q.older, 'No, move it to `older versions/`; nothing is deleted.')).toBe(true);
  expect(gradeAnswer(Q.memory, null)).toBe(false);
});

test('the task passes only when the test is there and the file passes with one test more', () => {
  const file = "test('128k', () => { expect(rulesRoomFor(131072)).toBe(36_000); });";
  expect(gradeTask(file, ' 7 pass\n 0 fail', 0).ok).toBe(true);
  expect(gradeTask(file, ' 6 pass\n 1 fail', 1).ok).toBe(false);
  expect(gradeTask('nothing new', ' 6 pass\n 0 fail', 0)).toMatchObject({ ok: false, has: false });
});

test('the tests a run started: its own commands with "test" in them, and the app\'s check', () => {
  const log = [
    { type: 'tool', label: 'Read', arg: 'terminal/test/room.test.mjs' },
    { type: 'tool', label: 'Bash', arg: 'bun run test terminal/test/room.test.mjs' },
    { type: 'note', text: 'Checking the change: bun run test' },
    { type: 'tool', label: 'Bash', arg: 'ls' },
  ];
  expect(testsRun(log)).toEqual(['bun run test terminal/test/room.test.mjs', "bun run test (the app's check)"]);
});

const rowsOf = ({ newRight = 10, oldRight = 9, newTask = { ok: true, secs: 60 }, oldTask = { ok: true, secs: 90 } } = {}) => [
  ...QUESTIONS.flatMap((q, i) => [
    { id: `${q.id}-old`, kind: 'question', file: 'old', ok: i < oldRight, name: `old file · ${q.q}`, secs: 5, detail: 'x' },
    { id: `${q.id}-new`, kind: 'question', file: 'new', ok: i < newRight, name: `new file · ${q.q}`, secs: 4, detail: 'x' },
  ]),
  { id: 'task-old', kind: 'task', file: 'old', name: 'old file · the task', ...oldTask, tests: ['bun run test (the app\'s check)'], detail: 'x' },
  { id: 'task-new', kind: 'task', file: 'new', name: 'new file · the task', ...newTask, tests: ['bun run test terminal/test/room.test.mjs'], detail: 'x' },
];
const start = { old: { secs: 9.5, tokens: 3900 }, new: { secs: 5.1, tokens: 2600 } };

test('the rule: as many right answers, a faster start, the task passing in no more time', () => {
  expect(summarize(rowsOf(), { start }).pass).toBe(true);
  expect(summarize(rowsOf({ newRight: 8 }), { start }).pass).toBe(false);
  expect(summarize(rowsOf(), { start: { old: start.old, new: { secs: 9.6 } } }).pass).toBe(false);
  expect(summarize(rowsOf({ newTask: { ok: false, secs: 30 } }), { start }).pass).toBe(false);
  expect(summarize(rowsOf({ newTask: { ok: true, secs: 120 } }), { start }).pass).toBe(false);
  // The old file's task failing does not hold the new one to its time.
  expect(summarize(rowsOf({ newTask: { ok: true, secs: 120 }, oldTask: { ok: false, secs: 30 } }), { start }).pass).toBe(true);
  const cut = summarize(rowsOf().slice(0, 7), { start });
  expect(cut).toMatchObject({ pass: false, stopped: true });
});

test('the results page: the verdict with both files\' numbers, the tests each task ran, a model\'s words escaped', () => {
  const rows = rowsOf();
  rows[1].detail = 'right: “<b>bun run docs</b>”';
  const s = summarize(rows, { start, model: 'qwen', name: 'Qwen3.5 9B', ctx: 32768, code: 'abc1234', oldFrom: 'def5678^', chars: { old: 8019, new: 2688 } });
  const html = rulesFilePage({ summary: s, rows });
  expect(html).toContain('<meta charset="utf-8">');
  expect(html).toContain('<title>Rules file old vs new · Qwen3.5 9B</title>');
  expect(html).toContain('Yes: the short AGENTS.md did at least as well. 10 of 10 right answers (the old file: 9)');
  expect(html).toContain('Tests it ran with the new file: bun run test terminal/test/room.test.mjs');
  expect(html).toContain('8,019 characters, from git at def5678^');
  expect(html).toContain('&lt;b&gt;bun run docs&lt;/b&gt;');
  const no = rulesFilePage({ summary: summarize(rowsOf({ newRight: 7 }), { start, name: 'Qwen3.5 9B', ctx: 32768, code: 'abc1234' }), rows: rowsOf({ newRight: 7 }) });
  expect(no).toContain('No: fewer right answers with the new file (7 against 9).');
});
