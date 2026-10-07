// The Battle arena (models/evals/battle/): its checks, where it keeps tests, the three sets that come
// with it (New 28, Work 28, Practice 28: each test fails as given and passes with its known-good answer),
// a Practice 28 edit saved as a copy (18b), and what the app says while a battle holds the memory.
// The runner end to end (a battle, the blind vote, the line, stop, delete): models/test/arena.test.mjs.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Everything here lives in a throwaway home and on a port of its own.
const HOME = mkdtempSync(join(tmpdir(), 'agentic-battle-test-'));
const PORT = 20000 + Math.floor(Math.random() * 20000);
process.env.AGENTIC_HOME = HOME;
process.env.AGENTIC_BATTLE_PORT = String(PORT);
process.env.AGENTIC_TEST_RECORD = join(HOME, 'record.jsonl');
const { runChecks, snapshot, whyOf, scriptsParse } = await import('../evals/battle/checks.mjs');
const store = await import('../evals/battle/store.mjs');
const { verify, allTests } = await import('../evals/battle/verify-tests.mjs');

const folder = (files) => { const d = mkdtempSync(join(tmpdir(), 'battle-work-')); for (const [f, t] of Object.entries(files)) { mkdirSync(join(d, f, '..'), { recursive: true }); writeFileSync(join(d, f), t); } return d; };

test('each check: the tests, only the named files, a file says, the answer, no change, saved, page checks', () => {
  const work = folder({ 'package.json': '{"type":"module","scripts":{"test":"node --test"}}', 'a.mjs': 'export const a = 1;\n', 'b.mjs': 'export const b = 2;\n', 'a.test.mjs': "import { test } from 'node:test'; import assert from 'node:assert'; import { a } from './a.mjs'; test('a', () => assert.equal(a, 1));\n" });
  const before = snapshot(work);
  writeFileSync(join(work, 'a.mjs'), 'export const a = 1; // checked\n');
  writeFileSync(join(work, 'page.html'), '<meta charset="utf-8"><h1>Hi there</h1><script>let x = 1;</script>');
  const r = runChecks({ work, before, prompt: 'Change a.mjs', answer: 'It is in a.mjs, line 1.', checks: [
    { type: 'tests' }, { type: 'only-named' }, { type: 'file-has', value: '// checked' }, { type: 'answer-has', value: 'a.mjs, line 1' },
    { type: 'saved', value: 'page.html' }, { type: 'scripts-valid' }, { type: 'offline' }, { type: 'page-has', value: 'hi there' },
  ] });
  expect(r.checks.map((c) => [c.label.split(':')[0], c.pass])).toEqual([['The tests pass', true], ['Nothing else changed', true], ['A file says', true], ['The answer mentions', true], ['The file is saved', true], ['Its scripts are valid', true], ['Nothing from the internet', true], ['The page has', true]]);
  expect(r.pass).toBe(true);
  // Now wrong: b.mjs changed though the prompt never named it, a page from the internet, a broken script.
  writeFileSync(join(work, 'b.mjs'), 'export const b = 3;\n');
  writeFileSync(join(work, 'page.html'), '<script src="https://cdn.example.com/x.js"></script><script>let = ;</script>');
  const w = runChecks({ work, before, prompt: 'Change a.mjs', answer: 'nothing', checks: [{ type: 'only-named' }, { type: 'offline' }, { type: 'scripts-valid' }, { type: 'answer-has', value: 'a.mjs' }, { type: 'no-change' }] });
  expect(w.checks.map((c) => c.pass)).toEqual([false, false, false, false, false]);
  expect(w.checks[0].why).toBe('also changed: b.mjs');
  expect(w.checks[3].why).toBe('the answer lacks "a.mjs"');
  expect(w.pass).toBe(false);
});

test('no checks means your vote decides (pass is null); a check script counts too, with a readable reason', () => {
  const work = folder({ 'x.txt': 'x' });
  expect(runChecks({ work, before: snapshot(work) }).pass).toBeNull();
  const script = join(folder({}), 'check.sh');
  writeFileSync(script, "#!/bin/zsh\nnode -e \"throw new TypeError('retry is not a function')\"\n");
  const r = runChecks({ work, before: snapshot(work), script });
  expect(r.pass).toBe(false);
  expect(r.checks[0].why).toBe('TypeError: retry is not a function');
  expect(whyOf({ stdout: 'tests fail\n', stderr: 'Node.js v24.1.0\n', status: 1 })).toBe('tests fail');
  expect(scriptsParse('<script type="module">import x from "y"</script>').ok).toBe(true);
  expect(scriptsParse('<p>no script</p>').ok).toBe(false);
});

test('tests are kept as folders: the three sets are copied once (without their answers), yours are saved and edited, deleting moves to trash', () => {
  const home = mkdtempSync(join(tmpdir(), 'battle-store-'));
  expect(store.seedSuites(home)).toBe(84);
  expect(store.seedSuites(home)).toBe(0);
  const list = store.listTests(home);
  expect(list).toHaveLength(84);
  expect(list.map((t) => t.suite).filter((s, i, a) => a.indexOf(s) === i)).toEqual(['new28', 'work28', 'practice']);
  expect(list[0]).toMatchObject({ id: 'n01-date-one-day-early', suite: 'new28', n: 1, hasScript: true });
  expect(list[28]).toMatchObject({ id: 'w01-contract-roll', suite: 'work28', n: 1, hasScript: true });
  // A Practice 28 test is its practice task as it is, with the replies to its questions, without its answer.
  const p22 = list.find((t) => t.id === 'p22-vague-fix-the-bug');
  expect(p22).toMatchObject({ suite: 'practice', n: 22, kind: 'code', prompt: 'fix the bug', hasScript: true, task: '22-vague-fix-the-bug' });
  expect(p22.answers[0].reply).toContain('slugify');
  expect(readFileSync(join(home, 'tests', p22.id, 'check.sh'), 'utf8')).toBe(readFileSync(join(store.PRACTICE_DIR, '22-vague-fix-the-bug', 'check.sh'), 'utf8'));
  for (const id of ['n01-date-one-day-early', 'w01-contract-roll', 'p10-fix-off-by-one']) for (const d of ['solution', 'reference']) expect(existsSync(join(home, 'tests', id, d))).toBe(false);
  // Deleted, a test that came with the arena is not copied back.
  store.trashTest('n28-python-dataclass', home);
  store.trashTest('w28-whats-new-notes', home);
  expect(store.seedSuites(home)).toBe(0);
  expect(store.listTests(home)).toHaveLength(82);
  expect(readdirSync(join(home, 'trash')).some((f) => f.startsWith('n28-python-dataclass-'))).toBe(true);
  // Yours: saved with its files; a path from outside stays inside the test's folder.
  const m = store.saveTest({ title: 'Tax', kind: 'question', prompt: 'Which function computes tax?', checks: [{ type: 'answer-has', value: 'addTax' }], ask: 'billing.mjs', files: [{ path: 'src/billing.mjs', b64: Buffer.from('export const addTax = 1;').toString('base64') }, { path: '../../escape.txt', b64: 'eA==' }] }, home);
  expect(m).toMatchObject({ kind: 'question', suite: 'mine', title: 'Tax', answers: [{ match: '.', reply: 'billing.mjs' }] });
  const mine = store.listTests(home).at(-1);
  expect(mine.files).toEqual(['src/billing.mjs']);
  expect(existsSync(join(home, 'tests', 'escape.txt'))).toBe(false);
  expect(existsSync(join(home, 'escape.txt'))).toBe(false);
  // An edit keeps the id and the files unless told to remove them.
  // A test of yours needs a check, new or edited, so a run of it can pass or fail.
  expect(() => store.saveTest({ id: m.id, title: 'Tax 2', kind: 'question', prompt: 'Which function computes tax, and its rate?', checks: [] }, home)).toThrow('tick at least one check');
  expect(() => store.saveTest({ title: 'Loose', kind: 'code', prompt: 'Tidy it up' }, home)).toThrow('tick at least one check');
  store.saveTest({ id: m.id, title: 'Tax 2', kind: 'question', prompt: 'Which function computes tax, and its rate?', checks: [{ type: 'answer-has', value: 'rate' }] }, home);
  expect(store.listTests(home).at(-1)).toMatchObject({ id: m.id, title: 'Tax 2', files: ['src/billing.mjs'], checks: [{ type: 'answer-has', value: 'rate' }] });
  expect(() => store.saveTest({ kind: 'code', prompt: ' ' }, home)).toThrow('needs a prompt');
});

test('editing a New 28 test: its own check can be turned off, starter files taken out one by one, and the original put back', () => {
  const home = mkdtempSync(join(tmpdir(), 'battle-edit-'));
  store.seedSuites(home);
  const id = 'n01-date-one-day-early';
  store.saveTest({ id, title: 'Dates', kind: 'code', prompt: 'Fix formatDay, a new way', checks: [{ type: 'tests' }], removePaths: ['package.json', '../../escape'], useScript: false }, home);
  let t = store.listTests(home).find((x) => x.id === id);
  expect(t).toMatchObject({ title: 'Dates', prompt: 'Fix formatDay, a new way', noScript: true, suite: 'new28', n: 1, checks: [{ type: 'tests', value: '' }] });
  expect(t.files).toEqual(['dates.mjs', 'dates.test.mjs']);
  expect(t.edited).toBeTruthy();
  // Saved again without saying: its own check stays as it was.
  store.saveTest({ id, title: 'Dates', kind: 'code', prompt: 'Fix formatDay, a new way', checks: [] }, home);
  expect(store.listTests(home).find((x) => x.id === id).noScript).toBe(true);
  store.resetTest(id, home);
  t = store.listTests(home).find((x) => x.id === id);
  expect(t.title).toBe('Fix a date that shows one day early');
  expect(Boolean(t.noScript || t.edited)).toBe(false);
  expect(t.files).toEqual(['dates.mjs', 'dates.test.mjs', 'package.json']);
  expect(existsSync(join(home, 'tests', id, 'solution'))).toBe(false);
  expect(readdirSync(join(home, 'trash')).some((f) => f.startsWith(`${id}-edited-`))).toBe(true);
  expect(() => store.resetTest('m-mine-1234', home)).toThrow('only a test that came with the arena');
});

test('a Practice 28 test never changes: an edit is saved as a copy (18b, then 18c), the copy edits in place, a used letter is never given again', () => {
  const home = mkdtempSync(join(tmpdir(), 'battle-practice-'));
  store.seedSuites(home);
  const id = 'p18-writing-noncode-folder';
  const before = readFileSync(join(home, 'tests', id, 'task.txt'), 'utf8');
  const a = store.saveTest({ id, title: 'A story in TEST.txt', kind: 'writing', prompt: 'Write a short story of three sentences in TEST.txt.', checks: [], removePaths: ['ideas.md'] }, home);
  expect(a).toMatchObject({ id: 'p18b-writing-noncode-folder', copyOf: id, variant: 'b', n: 18, suite: 'practice', title: 'A story in TEST.txt' });
  expect(readFileSync(join(home, 'tests', id, 'task.txt'), 'utf8')).toBe(before);
  const list = store.listTests(home);
  const orig = list.find((t) => t.id === id), copy = list.find((t) => t.id === a.id);
  expect(orig.files).toContain('ideas.md');
  expect(copy.files).not.toContain('ideas.md');
  expect(copy.hasScript).toBe(true);
  // The copy sits right after its original.
  expect(list.indexOf(copy)).toBe(list.indexOf(orig) + 1);
  // Editing the copy changes the copy; editing the original again makes 18c.
  expect(store.saveTest({ id: a.id, title: 'A story', kind: 'writing', prompt: 'Changed again', checks: [] }, home)).toMatchObject({ id: a.id, copyOf: id, variant: 'b' });
  expect(store.saveTest({ id, title: 'Another', kind: 'writing', prompt: 'Another change', checks: [] }, home).id).toBe('p18c-writing-noncode-folder');
  // 18b deleted: the next copy is 18d, so an old result of 18b never shows on a new test.
  store.trashTest(a.id, home);
  expect(store.saveTest({ id, title: 'Third', kind: 'writing', prompt: 'A third change', checks: [] }, home).id).toBe('p18d-writing-noncode-folder');
  // A Practice 28 test can be put back (from its practice task); a copy has no original of its own.
  store.resetTest(id, home);
  expect(readFileSync(join(home, 'tests', id, 'task.txt'), 'utf8')).toBe(before);
  expect(() => store.resetTest('p18c-writing-noncode-folder', home)).toThrow('only a test that came with the arena');
});

test('what the app says while a battle holds the memory names no model (the vote is blind)', () => {
  const t = store.holdText({ state: 'running', title: 'Fix a bug', run: 2, of: 2, startedAt: Date.now() - 60_000 });
  expect(t).toBe('a battle is running (Fix a bug · run 2 of 2 · at most 9 min left of this run)');
  expect(store.holdText({ state: 'want', title: 'Fix a bug' })).toBe('a battle is about to start (Fix a bug)');
  const home = mkdtempSync(join(tmpdir(), 'battle-hold-'));
  store.writeHold({ pid: 999999, state: 'running', title: 'x' }, home);
  expect(store.readHold(home)).toBeNull(); // its runner is gone
  expect(existsSync(join(home, 'running.json'))).toBe(false);
});

// Each set: every test fails as given and passes with its known-good answer (no model).
for (const [suite, kindsWanted] of [['new28', { code: 16, question: 5, page: 5, writing: 2 }], ['work28', { code: 16, question: 5, page: 5, writing: 2 }], ['practice', { code: 21, question: 4, writing: 3 }]]) {
  // Each set holds Python tasks, checked with pytest (needs: terminal/test/needs.mjs, put on globalThis by the tests' preload).
  test.skipIf(globalThis.needs('pytest'))(`the ${suite === 'new28' ? 'New 28' : suite === 'work28' ? 'Work 28' : 'Practice 28'}: every one fails as given and passes with its known-good answer (no model)`, () => {
    const list = allTests().filter((t) => t.suite === suite);
    expect(list).toHaveLength(28);
    expect(list.map((t) => t.id.slice(0, 3))).toEqual(Array.from({ length: 28 }, (_, i) => `${suite[0]}${String(i + 1).padStart(2, '0')}`));
    const kinds = {};
    for (const t of list) {
      const r = verify(t.folder, t.from);
      expect([t.id, r.failsFirst, r.passesAfter, r.after]).toEqual([t.id, true, true, []]);
      const kind = suite === 'practice' ? store.practiceList().find((p) => p.id === t.id).kind : r.kind;
      kinds[kind] = (kinds[kind] ?? 0) + 1;
    }
    expect(kinds).toEqual(kindsWanted);
  }, 180_000);
}
