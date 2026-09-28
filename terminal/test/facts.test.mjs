// The memory's store (src/agent/facts.mjs): one file per fact, the index, the
// retired folder, the log and undo, trust, and keeping itself clean.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryDirs, dirFor, parseFact, formatFact, readFacts, applyChanges, undoLast, restoreFact, markUsed, changeTrust, pinFact, tidy, openMemory, memoryNotes, looksSecret, namesMissingFile, readLog, FIRST_FACTS, RETIRE_AT } from '../src/agent/facts.mjs';

const place = () => {
  const home = mkdtempSync(join(tmpdir(), 'bonsai-facts-'));
  const repo = join(home, 'work', 'repo');
  mkdirSync(join(repo, '.git', 'info'), { recursive: true });
  mkdirSync(join(repo, 'src'), { recursive: true });
  return { home, repo, ...memoryDirs(join(repo, 'src'), home) };
};
const names = (dir, sub) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).sort() : []);

test('where the memory lives: the project\'s at the repo\'s top, yours in the home folder; the home folder has no project', () => {
  const { home, repo, you, project } = place();
  expect(you).toBe(join(home, '.bonsai', 'memory'));
  expect(project).toBe(join(repo, '.bonsai', 'memory'));
  expect(memoryDirs(home, home)).toEqual({ you, project: null });
  expect(dirFor({ you, project }, 'you')).toBe(you);
  expect(dirFor({ you, project }, 'worked')).toBe(project);
  expect(dirFor({ you, project: null }, 'project')).toBe(you);
});

test('a fact is a plain file: written, read back the same, and still read after you edit it by hand', () => {
  const f = { kind: 'recipe', text: 'Add a page about Bonsai.', saved: '2026-09-26', from: 'the task "make a results page"', used: 3, last: '2026-09-28', trust: 4, passed: 4, failed: 0, always: false, pinned: true, steps: ['build it', 'save it in the DOCS folder', 'run bun run docs'] };
  const text = formatFact(f);
  expect(text).toBe('kind: recipe\nsaved: 2026-09-26\nfrom: the task "make a results page"\nused: 3 times, last 2026-09-28\ntrust: 4 (4 passed, 0 failed)\npinned: yes\n\nAdd a page about Bonsai.\n1. build it\n2. save it in the DOCS folder\n3. run bun run docs\n');
  expect(parseFact(text, 'x')).toEqual({ id: 'x', ...f });
  // no header at all: the whole file is the fact
  expect(parseFact('Run the tests with `bun run test`.\n', 'y')).toMatchObject({ kind: 'project', text: 'Run the tests with `bun run test`.', trust: 0, used: 0 });
  expect(parseFact('kind: nonsense\ntrust: lots\n\nStill a fact.\n', 'z')).toMatchObject({ kind: 'project', trust: 0, text: 'Still a fact.' });
});

test('saving: facts added once, a secret refused, the index rebuilt, the folder kept out of git', () => {
  const { repo, project } = place();
  const r = applyChanges(project, { add: [
    { kind: 'project', text: 'Run the tests with `bun run test`.', from: 'the task "add a flag"' },
    { kind: 'worked', text: 'Worked: lowering the legend\'s z-index in legend.js.' },
    { kind: 'project', text: 'run the TESTS with bun run test' }, // the same fact again
    { kind: 'project', text: 'The api key is sk-abcdefghijklmnopqrstuvwxyz123456' },
    { kind: 'project', text: 'password: hunter2hunter2' },
    { kind: 'project', text: 'ok' },
  ] }, { today: '2026-09-26' });
  expect(r.added.map((f) => f.id)).toEqual(['run-the-tests-with-bun-run', 'worked-lowering-the-legend-index-in']);
  expect(r.refused.map((x) => x.why)).toEqual(['saved already', 'looks like a key or a password', 'looks like a key or a password', 'too short to mean anything']);
  expect(names(project, 'facts')).toEqual(['run-the-tests-with-bun-run.md', 'worked-lowering-the-legend-index-in.md']);
  const index = readFileSync(join(project, 'index.md'), 'utf8');
  expect(index).toContain('- Run the tests with `bun run test`.');
  expect(index).toContain('- Worked: lowering the legend\'s z-index in legend.js.');
  expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain('.bonsai/');
  for (const s of ['token = abcdef123456', 'ghp_abcdefghijklmnop', '-----BEGIN RSA PRIVATE KEY-----', '0123456789abcdef0123456789abcdef01234567']) expect([s, looksSecret(s)]).toEqual([s, true]);
  for (const s of ['The token count is shown in /stats', 'Commit and push only when the user says so.', 'The password field is in login.jsx']) expect([s, looksSecret(s)]).toEqual([s, false]);
});

test('a newer fact takes an older one\'s place; the older one is kept in retired/ with the reason', () => {
  const { project } = place();
  const [old] = applyChanges(project, { add: [{ kind: 'project', text: 'The tests run with npm test.' }] }, { today: '2026-09-20' }).added;
  markUsed(project, [old.id], '2026-09-21');
  const r = applyChanges(project, { replace: [{ id: old.id, by: { kind: 'project', text: 'The tests run with bun run test.' } }] }, { today: '2026-09-26' });
  expect(r.replaced).toHaveLength(1);
  expect(readFacts(project).map((f) => [f.text, f.used])).toEqual([['The tests run with bun run test.', 1]]); // the use count came along
  const gone = readFacts(project, { retired: true });
  expect(gone.map((f) => f.text)).toEqual(['The tests run with npm test.']);
  expect(gone[0].retired).toContain('replaced by: The tests run with bun run test.');
});

test('undo takes back the last save, whole: what it added goes, what it retired or replaced comes back', () => {
  const { project } = place();
  const first = applyChanges(project, { add: [{ text: 'Pages about Bonsai go in the DOCS folder.' }, { text: 'The tests run with npm test.' }] }, { batch: 'one' }).added;
  applyChanges(project, { add: [{ text: 'The night run starts with start.sh in the night folder.' }], replace: [{ id: first[1].id, by: { text: 'The tests run with bun run test.' } }], retire: [{ id: first[0].id, reason: 'no longer true' }] }, { batch: 'two' });
  expect(readFacts(project).map((f) => f.text).sort()).toEqual(['The night run starts with start.sh in the night folder.', 'The tests run with bun run test.']);
  const u = undoLast(project);
  expect(u.of).toBe('two');
  expect(u.did.map((d) => d.what).sort()).toEqual(['brought back', 'brought back', 'removed', 'removed']);
  expect(readFacts(project).map((f) => f.text).sort()).toEqual(['Pages about Bonsai go in the DOCS folder.', 'The tests run with npm test.']);
  expect(readFacts(project, { retired: true }).map((f) => f.retired).every((r) => r.includes('undone'))).toBe(true);
  // the next undo takes back the save before it; then there is nothing left
  expect(undoLast(project).of).toBe('one');
  expect(readFacts(project)).toEqual([]);
  expect(undoLast(project)).toBe(null);
  expect(readLog(project).filter((l) => l.what === 'undo').map((l) => l.of)).toEqual(['two', 'one']);
});

test('trust: up when the task passed, down when it failed or you corrected Bonsai; too low retires, unless pinned or always', () => {
  const { project } = place();
  const [a, b, c] = applyChanges(project, { add: [{ text: 'The legend is drawn in legend.js, under the chart.' }, { text: 'Raise the z-index of the symbol menu to fix it.' }, { text: 'Pinned by the user: deploys go through ssh.' }] }).added;
  pinFact(project, c.id);
  changeTrust(project, [a.id], +1, 'the task passed its check');
  changeTrust(project, [a.id], +1, 'the task passed its check');
  changeTrust(project, [b.id, c.id], -2, 'you corrected Bonsai');
  let r = changeTrust(project, [b.id, c.id], -1, 'the task failed its check');
  expect(r.retired.map((f) => f.id)).toEqual([b.id]); // -3 = RETIRE_AT; the pinned one stays
  expect(RETIRE_AT).toBe(-3);
  expect(readFacts(project).map((f) => [f.id, f.trust, f.passed, f.failed])).toEqual([[c.id, -3, 0, 2], [a.id, 2, 2, 0]].sort((x, y) => x[0].localeCompare(y[0])));
  expect(readFacts(project, { retired: true })[0].retired).toContain('trust fell to -3: the task failed its check');
  // the most trusted first in the index
  expect(readFileSync(join(project, 'index.md'), 'utf8').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2, 14))).toEqual(['Pinned by th', 'The legend i']);
  // brought back by hand, it starts again at 0
  expect(restoreFact(project, b.id).text).toBe('Raise the z-index of the symbol menu to fix it.');
  expect(readFacts(project).find((f) => f.id === b.id).trust).toBe(0);
});

test('keeping clean: repeats merge, a fact about a file that is gone and one unused for 30 days retire', () => {
  const { repo, project } = place();
  writeFileSync(join(repo, 'src', 'export.mjs'), 'export const x = 1;\n');
  applyChanges(project, { add: [
    { text: 'The flags are read in export.mjs.' },
    { text: 'The legend is drawn in legend.js.' },
    { text: 'The bug rules are in terminal/rules/bug-fixing.md.' },
    { text: 'Old and never used: the build takes two minutes.' },
    { text: 'Fresh: the build takes ten seconds.' },
  ] }, { today: '2026-08-01' });
  markUsed(project, ['fresh-the-build-takes-ten-seconds', 'the-flags-are-read-in-export'], '2026-09-25');
  // the same fact written twice by hand
  writeFileSync(join(project, 'facts', 'again.md'), 'kind: project\nused: 2 times, last 2026-09-24\n\nFresh: the build takes ten seconds.\n');
  const t = tidy(project, { today: '2026-09-26', root: repo });
  expect(t.merged.map((m) => [m.kept.id, m.gone.id])).toEqual([['again', 'fresh-the-build-takes-ten-seconds']]); // the one used more stays
  expect(t.retired.map((r) => r.why).sort()).toEqual(['not used in 56 days', 'the file it names is gone', 'the file it names is gone']);
  expect(readFacts(project).map((f) => [f.id, f.used])).toEqual([['again', 3], ['the-flags-are-read-in-export', 1]]);
  expect(namesMissingFile({ kind: 'you', text: 'Likes pages as index.html' }, repo)).toBe(false); // about the user, not a file here
  expect(namesMissingFile({ kind: 'project', text: 'No file named here.' }, repo)).toBe(false);
  // and it can all be undone
  expect(undoLast(project).did.filter((d) => d.what === 'brought back')).toHaveLength(4);
});

test('first use: your two rules are saved once, and an older notes file is carried over line by line', () => {
  const { home, repo, you, project } = place();
  mkdirSync(join(repo, '.bonsai'), { recursive: true });
  writeFileSync(join(repo, '.bonsai', 'notes.md'), '# Bonsai memory\nKept by Bonsai.\n\n- Tests run with bun run test\n- Deploys go through ssh orbit\n');
  const o = openMemory(join(repo, 'src'), { home, today: '2026-09-26' });
  expect(o.first.map((f) => f.text)).toEqual(FIRST_FACTS.map((f) => f.text));
  expect(o.notes.map((f) => f.text)).toEqual(['Tests run with bun run test', 'Deploys go through ssh orbit']);
  expect(readFacts(you).every((f) => f.always && f.kind === 'you')).toBe(true);
  expect(readFileSync(join(repo, '.bonsai', 'notes.md'), 'utf8')).toContain('- Tests run with bun run test'); // the notes file is left as it was
  // a rule the user removed does not come back at the next start
  applyChanges(you, { retire: [{ id: readFacts(you)[0].id, reason: 'removed by the user' }] });
  const again = openMemory(join(repo, 'src'), { home, today: '2026-09-27' });
  expect([again.first, again.notes]).toEqual([[], []]);
  expect(readFacts(you)).toHaveLength(1);
  expect(readFacts(project)).toHaveLength(2);
});

test('what is read at every start: the rules in full, then one short line per fact, inside its limit', () => {
  const { home, repo, project } = place();
  expect(memoryNotes(join(repo, 'src'), { home })).toEqual({ text: '', files: [], facts: 0 });
  openMemory(join(repo, 'src'), { home });
  applyChanges(project, { add: [{ kind: 'failed', text: 'Raising the z-index of #sym-menu did not bring the symbol list above the legend, and the long tail of this line is cut off in the index.' }, ...Array.from({ length: 60 }, (_, i) => ({ text: `Fact number ${i + 1} about this project, long enough to count.` }))] });
  changeTrust(project, [readFacts(project).find((f) => f.kind === 'failed').id], +1, 'the task passed its check'); // the most trusted comes first
  const n = memoryNotes(join(repo, 'src'), { home });
  expect(n.text.split('\n').slice(0, 3).sort()).toEqual(['- Before you change anything, say in one plain, simple sentence what you are going to do.', '- When you are stuck, ask the user what to do instead of guessing or stopping.', 'Always']);
  expect(n.text).toContain('What you know about this project (~/work/repo/.bonsai/memory)');
  expect(n.text).toContain('- failed: Raising the z-index of #sym-menu did not bring the symbol list above the legend,…');
  expect(n.text).toMatch(/- \(and \d+ more\)/);
  expect(n.text.length).toBeLessThan(1900);
  expect(n.facts).toBe(63);
  expect(n.text).not.toContain('What you know about the user'); // only the two rules, already shown in full
});
