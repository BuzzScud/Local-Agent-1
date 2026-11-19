// The memory's store (src/agent/facts.mjs): one file per fact, the index, the
// retired folder, the log and undo, trust, and keeping itself clean.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryDirs, dirFor, parseFact, formatFact, readFacts, applyChanges, undoLast, restoreFact, markUsed, changeTrust, pinFact, tidy, openMemory, memoryNotes, looksSecret, namesMissingFile, fileNames, countDay, health, healthLine, readLog, FIRST_FACTS, RETIRE_AT, noteDay, workedDays, heldTidy, tidyHeld, keepHeld, readState } from '../src/agent/facts.mjs';

const place = () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-facts-'));
  const repo = join(home, 'work', 'repo');
  mkdirSync(join(repo, '.git', 'info'), { recursive: true });
  mkdirSync(join(repo, 'src'), { recursive: true });
  return { home, repo, ...memoryDirs(join(repo, 'src'), home) };
};
const names = (dir, sub) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).sort() : []);
// n days the memory was in use in a folder, one after another from the day given.
const workDays = (dir, from, n) => { for (let i = 0; i < n; i++) noteDay(dir, new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10)); };

test('where the memory lives: the project\'s at the repo\'s top, yours in the home folder; the home folder has no project', () => {
  const { home, repo, you, project } = place();
  expect(you).toBe(join(home, '.agentic', 'memory'));
  expect(project).toBe(join(repo, '.agentic', 'memory')); // a fresh project: .agentic/
  expect(memoryDirs(home, home)).toEqual({ you, project: null });
  expect(dirFor({ you, project }, 'you')).toBe(you);
  expect(dirFor({ you, project }, 'worked')).toBe(project);
  expect(dirFor({ you, project: null }, 'project')).toBe(you);
});

test('a fact is a plain file: written, read back the same, and still read after you edit it by hand', () => {
  const f = { kind: 'recipe', text: 'Add a page about Agentic Coder.', saved: '2026-09-26', from: 'the task "make a results page"', used: 3, last: '2026-09-28', trust: 4, passed: 4, failed: 0, always: false, pinned: true, steps: ['build it', 'save it in the DOCS folder', 'run bun run docs'] };
  const text = formatFact(f);
  expect(text).toBe('kind: recipe\nsaved: 2026-09-26\nfrom: the task "make a results page"\nused: 3 times, last 2026-09-28\ntrust: 4 (4 passed, 0 failed)\npinned: yes\n\nAdd a page about Agentic Coder.\n1. build it\n2. save it in the DOCS folder\n3. run bun run docs\n');
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
  expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain('.agentic/');
  expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')).not.toContain('.bonsai/'); // the old name, not written since 3 Oct
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
  const first = applyChanges(project, { add: [{ text: 'Pages about Agentic Coder go in the DOCS folder.' }, { text: 'The tests run with npm test.' }] }, { batch: 'one' }).added;
  applyChanges(project, { add: [{ text: 'The night run starts with start.sh in the night folder.' }], replace: [{ id: first[1].id, by: { text: 'The tests run with bun run test.' } }], retire: [{ id: first[0].id, reason: 'no longer true' }] }, { batch: 'two' });
  expect(readFacts(project).map((f) => f.text).sort()).toEqual(['The night run starts with start.sh in the night folder.', 'The tests run with bun run test.']);
  const u = undoLast(project);
  expect(u.of).toBe('two');
  expect(u.did.map((d) => d.what).sort()).toEqual(['brought back', 'brought back', 'removed', 'removed']);
  expect(readFacts(project).map((f) => f.text).sort()).toEqual(['Pages about Agentic Coder go in the DOCS folder.', 'The tests run with npm test.']);
  expect(readFacts(project, { retired: true }).map((f) => f.retired).every((r) => r.includes('undone'))).toBe(true);
  // the next undo takes back the save before it; then there is nothing left
  expect(undoLast(project).of).toBe('one');
  expect(readFacts(project)).toEqual([]);
  expect(undoLast(project)).toBe(null);
  expect(readLog(project).filter((l) => l.what === 'undo').map((l) => l.of)).toEqual(['two', 'one']);
});

test('trust: up when the task passed, down when it failed or you corrected Agentic Coder; too low retires, unless pinned or always', () => {
  const { project } = place();
  const [a, b, c] = applyChanges(project, { add: [{ text: 'The legend is drawn in legend.js, under the chart.' }, { text: 'Raise the z-index of the symbol menu to fix it.' }, { text: 'Pinned by the user: deploys go through ssh.' }] }).added;
  pinFact(project, c.id);
  changeTrust(project, [a.id], +1, 'the task passed its check');
  changeTrust(project, [a.id], +1, 'the task passed its check');
  changeTrust(project, [b.id, c.id], -2, 'you corrected Agentic Coder');
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
  workDays(project, '2026-08-02', 56); // worked here every day since
  markUsed(project, ['fresh-the-build-takes-ten-seconds', 'the-flags-are-read-in-export'], '2026-09-25');
  // the same fact written twice by hand
  writeFileSync(join(project, 'facts', 'again.md'), 'kind: project\nused: 2 times, last 2026-09-24\n\nFresh: the build takes ten seconds.\n');
  const t = tidy(project, { today: '2026-09-26', root: repo });
  expect(t.merged.map((m) => [m.kept.id, m.gone.id])).toEqual([['again', 'fresh-the-build-takes-ten-seconds']]); // the one used more stays
  expect(t.retired.map((r) => r.why).sort()).toEqual(['not used in 56 days of use', 'the file it names is gone', 'the file it names is gone']);
  expect(readFacts(project).map((f) => [f.id, f.used])).toEqual([['again', 3], ['the-flags-are-read-in-export', 1]]);
  expect(namesMissingFile({ kind: 'you', text: 'Likes pages as index.html' }, repo)).toBe(false); // about the user, not a file here
  expect(namesMissingFile({ kind: 'project', text: 'No file named here.' }, repo)).toBe(false);
  // and it can all be undone
  expect(undoLast(project).did.filter((d) => d.what === 'brought back')).toHaveLength(4);
});

test('dated news fades fast: 7 days after it was saved it retires, used or not; a lasting fact, a pinned one and a younger one stay', () => {
  const { repo, project } = place();
  applyChanges(project, { add: [
    { text: 'On 9 Oct 2026 main was pushed to GitHub at 83b8729.' },
    { text: 'As of 9 Oct 2026, ~/worktrees has 16 copies of the repo.' },
    { text: 'The 8 Oct "fewer errors" request is partly done.' },
    { text: 'Pinned: on 9 Oct 2026 the owner picked tidier code over speed.' },
    { text: 'For commit and push here, commit only own files by path.' },
  ] }, { today: '2026-10-09' });
  applyChanges(project, { add: [{ text: 'On 12 Oct 2026 the overhaul branch was merged.' }] }, { today: '2026-10-12' });
  pinFact(project, 'pinned-on-oct-2026-the-owner');
  markUsed(project, ['on-oct-2026-main-was-pushed'], '2026-10-16'); // used yesterday: news still goes
  const t = tidy(project, { today: '2026-10-16', root: repo });
  expect(t.retired.map((r) => r.why)).toEqual(['dated news, 7 days old', 'dated news, 7 days old', 'dated news, 7 days old']);
  expect(readFacts(project).map((f) => f.text).sort()).toEqual(['For commit and push here, commit only own files by path.', 'On 12 Oct 2026 the overhaul branch was merged.', 'Pinned: on 9 Oct 2026 the owner picked tidier code over speed.']);
  // a day short of 7: kept
  const p2 = place();
  applyChanges(p2.project, { add: [{ text: 'On 9 Oct 2026 main was pushed to GitHub at 83b8729.' }] }, { today: '2026-10-09' });
  expect(tidy(p2.project, { today: '2026-10-15', root: p2.repo }).retired).toEqual([]);
});

test('first use: your two rules are saved once, and an older notes file is carried over line by line', () => {
  const { home, repo, you, project } = place();
  mkdirSync(join(repo, '.agentic'), { recursive: true });
  writeFileSync(join(repo, '.agentic', 'notes.md'), '# Agentic Coder memory\nKept by Agentic Coder.\n\n- Tests run with bun run test\n- Deploys go through ssh orbit\n');
  const o = openMemory(join(repo, 'src'), { home, today: '2026-09-26' });
  expect(o.first.map((f) => f.text)).toEqual(FIRST_FACTS.map((f) => f.text));
  expect(o.notes.map((f) => f.text)).toEqual(['Tests run with bun run test', 'Deploys go through ssh orbit']);
  expect(readFacts(you).every((f) => f.always && f.kind === 'you')).toBe(true);
  expect(readFileSync(join(repo, '.agentic', 'notes.md'), 'utf8')).toContain('- Tests run with bun run test'); // the notes file is left as it was
  // a rule the user removed does not come back at the next start
  applyChanges(you, { retire: [{ id: readFacts(you)[0].id, reason: 'removed by the user' }] });
  const again = openMemory(join(repo, 'src'), { home, today: '2026-09-27' });
  expect([again.first, again.notes]).toEqual([[], []]);
  expect(readFacts(you)).toHaveLength(1);
  // the project's memory sits beside the notes file, in .agentic/memory
  const old = memoryDirs(join(repo, 'src'), home).project;
  expect(old).toBe(join(repo, '.agentic', 'memory'));
  expect(readFacts(old)).toHaveLength(2);
});

test('an event ("Created notes.html…") stays in the memory but never goes into the prompt', () => {
  const { home, repo, project } = place();
  openMemory(join(repo, 'src'), { home });
  applyChanges(project, { add: [{ text: 'Created a self-contained notes.html on the Desktop with local storage and modal functionality.' }] });
  let n = memoryNotes(join(repo, 'src'), { home });
  expect(readFacts(project)).toHaveLength(1);
  expect(n.text).not.toContain('notes.html');
  expect(n.text).not.toContain('What you know about this project'); // nothing left to list: no heading
  expect(n.text).not.toContain('These are short lines');
  applyChanges(project, { add: [{ text: 'The tests run with node --test from the repo top.' }] });
  n = memoryNotes(join(repo, 'src'), { home });
  expect(n.text).toContain('- The tests run with node --test from the repo top.');
  expect(n.text).not.toContain('notes.html');
});

test('what is read at every start: the rules in full, then one short line per fact, inside its limit', () => {
  const { home, repo, project } = place();
  expect(memoryNotes(join(repo, 'src'), { home })).toEqual({ text: '', files: [], facts: 0 });
  openMemory(join(repo, 'src'), { home });
  applyChanges(project, { add: [{ kind: 'failed', text: 'Raising the z-index of #sym-menu did not bring the symbol list above the legend, and the long tail of this line is cut off in the index.' }, ...Array.from({ length: 60 }, (_, i) => ({ text: `Fact number ${i + 1} about this project, long enough to count.` }))] });
  changeTrust(project, [readFacts(project).find((f) => f.kind === 'failed').id], +1, 'the task passed its check'); // the most trusted comes first
  const n = memoryNotes(join(repo, 'src'), { home });
  expect(n.text.split('\n').slice(0, 3).sort()).toEqual(['- Before you change anything, say in one plain, simple sentence what you are going to do.', '- When you are stuck, ask the user what to do instead of guessing or stopping.', 'Always']);
  expect(n.text).toContain('What you know about this project (~/work/repo/.agentic/memory)');
  expect(n.text).toContain('- failed: Raising the z-index of #sym-menu did not bring the symbol list above the legend,…');
  expect(n.text).toMatch(/- \(and \d+ more\)/);
  expect(n.text.length).toBeLessThan(1900);
  expect(n.facts).toBe(63);
  expect(n.text).not.toContain('What you know about the user'); // only the two rules, already shown in full
});

test('the project is looked through once for many facts, with the same answers as one look per fact', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-names-'));
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(root, 'src', 'deep', 'legend.js'), '');
  writeFileSync(join(root, 'node_modules', 'x', 'hidden.js'), '');
  const facts = ['Lowering the z-index in legend.js fixed it.', 'The fix is in nosuchfile.mjs.', 'The helper is in hidden.js.', 'Run the tests with bun.'].map((text) => ({ kind: 'worked', text }));
  const names = fileNames(root);
  expect(facts.map((f) => namesMissingFile(f, root, names))).toEqual(facts.map((f) => namesMissingFile(f, root)));
  expect(facts.map((f) => namesMissingFile(f, root, names))).toEqual([false, true, true, false]);
});

test('the health line: requests with a fact, saves offered and taken, what was taken out, from the last 7 days', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-health-'));
  const repo = join(home, 'repo'); mkdirSync(join(repo, '.git'), { recursive: true });
  const dirs = memoryDirs(repo, home);
  openMemory(repo, { home, today: '2026-09-30' }); // the first rules are not saves
  countDay(dirs, { requests: 1, found: 1 }, '2026-09-30');
  countDay(dirs, { requests: 1 }, '2026-09-30');
  countDay(dirs, { asked: 1, yes: 1 }, '2026-09-29');
  countDay(dirs, { asked: 1, no: 1 }, '2026-09-10'); // too old
  applyChanges(dirs.project, { add: [{ kind: 'project', text: 'Run the tests with bun run test.' }] }, { why: 'save' });
  const h = health(dirs, { today: '2026-09-30' });
  expect(h).toMatchObject({ requests: 2, found: 1, asked: 1, yes: 1, no: 0, saved: 1 });
  expect(healthLine(h)).toBe('facts came with 1 of 2 requests · 1 fact saved (1 of 1 offers taken) · 0 taken out · trust moved 0 times');
});

// The audit of 18 Nov 2026.
test('facts about you stay however long unused; non-English facts are their own; undo takes back the save, not the tidy after it', async () => {
  const { tidyDue, applySave } = await import('../src/agent/lessons.mjs');
  const { undoSave, filesIn, normText } = await import('../src/agent/facts.mjs');
  const { home, repo, you, project } = place();
  mkdirSync(you, { recursive: true });
  applyChanges(you, { add: [{ kind: 'you', text: 'Explain things simply, in three to five plain steps.' }] }, { today: '2026-08-01' });
  applyChanges(project, { add: [{ kind: 'project', text: 'Old and never used: the build takes two minutes.' }] }, { today: '2026-08-01' });
  workDays(you, '2026-08-02', 40);
  workDays(project, '2026-08-02', 40);
  tidyDue({ you, project }, '2026-11-18');
  expect(readFacts(you).map((f) => f.text)).toEqual(['Explain things simply, in three to five plain steps.']);
  expect(readFacts(project)).toHaveLength(0);
  // any language
  expect(normText('请用简单的话解释')).not.toBe('');
  expect(normText('请用简单的话解释')).not.toBe(normText('日本語で答えてください'));
  const a = applyChanges(you, { add: [{ kind: 'you', text: '请用简单的话解释每一步' }] }, { today: '2026-11-18' });
  const b = applyChanges(you, { add: [{ kind: 'you', text: '日本語で短く答えてください' }] }, { today: '2026-11-18' });
  expect([a.added.length, b.added.length]).toEqual([1, 1]);
  // Node.js is a thing, not a file
  expect(filesIn('The app runs on Node.js 22 and uses Chart.js for graphs; see src/app.js')).toEqual(['src/app.js']);
  // undo after a save that set off the tidy
  const cwd = join(repo, 'src');
  // A save in the same millisecond as the one about you above has the same time in its log, and either could be "the
  // last" (1 run in 5 failed on 19 Nov 2026): a save a moment later, as in use.
  await Bun.sleep(5);
  const out = applySave({ cwd, home, adds: [{ kind: 'project', text: 'The shop keeps its prices in cents, never floats.' }] }, { today: '2026-11-19' });
  expect(out.added).toHaveLength(1);
  const u = undoSave(memoryDirs(cwd, home));
  expect(u.of).toBe(out.added[0] && readLog(out.added[0].dir).find((l) => l.id === out.added[0].id)?.batch);
});

test('a request\'s facts follow Memory sent: none about you to a service that is not your own machine', async () => {
  const { recall } = await import('../src/agent/recall.mjs');
  const { home, repo, you, project } = place();
  mkdirSync(you, { recursive: true });
  applyChanges(you, { add: [{ kind: 'you', text: 'Show results pages with the verdict first, then the numbers of the run.' }] }, { today: '2026-11-18' });
  applyChanges(project, { add: [{ kind: 'project', text: 'The results pages of the shop are built by build-results.mjs from the run.' }] }, { today: '2026-11-18' });
  const ask = 'make the results pages of the run with the verdict first';
  const all = await recall(join(repo, 'src'), ask, { home, mark: false, top: 5 });
  expect(all.facts.some((f) => f.dir === you)).toBe(true);
  const proj = await recall(join(repo, 'src'), ask, { home, mark: false, top: 5, sent: 'project' });
  expect(proj.facts.some((f) => f.dir === you)).toBe(false);
  expect((await recall(join(repo, 'src'), ask, { home, mark: false, sent: 'none' })).facts).toEqual([]);
});

// 19 Nov 2026, the owner: a month away from this project, and the first save back retired 18 of its 22 facts.
test('unused counts the days the memory was in use, not the calendar: a month away retires nothing; a request notes its day', async () => {
  const { recall } = await import('../src/agent/recall.mjs');
  const { home, repo, project } = place();
  applyChanges(project, { add: [{ text: 'For commit and push here, commit only own files by path.' }, { text: 'The shop tests run with npm test from the top folder.' }] }, { today: '2025-01-01' });
  workDays(project, '2025-01-02', 5); // five days of work, then two months away
  expect(tidy(project, { today: '2025-03-10', root: repo }).retired).toEqual([]);
  // A request is a day of use (recall notes it, once a day).
  const r = await recall(join(repo, 'src'), 'how do the shop tests run', { home, today: '2025-03-11' });
  expect(r.facts.map((f) => f.text)).toEqual(['The shop tests run with npm test from the top folder.']);
  await recall(join(repo, 'src'), 'how do the shop tests run', { home, today: '2025-03-11' });
  expect(readState(project).days.filter((d) => d === '2025-03-11')).toHaveLength(1);
  expect(workedDays(project)).toContain('2025-03-11');
  // Thirty days of use without the fact: it goes, with the days of use as its reason; the one used on the 11th stays.
  workDays(project, '2025-03-12', 29);
  const t = tidy(project, { today: '2025-04-20', root: repo });
  expect(t.retired.map((x) => [x.fact.text, x.why])).toEqual([['For commit and push here, commit only own files by path.', 'not used in 35 days of use']]);
});

test('a big clear-out asks first: held, said after a save, at the start and in /memory; /memory keep keeps, /memory tidy takes out', async () => {
  const { tidyDue, saveLine, heldWords } = await import('../src/agent/lessons.mjs');
  const { memoryStatus, statusWords } = await import('../src/agent/memory-home.mjs');
  const six = Array.from({ length: 6 }, (_, i) => ({ text: `Standing rule number ${['one', 'two', 'three', 'four', 'five', 'six'][i]} for the shop.` }));
  // Six of six would go: held, nothing retired.
  const a = place();
  applyChanges(a.project, { add: six }, { today: '2025-01-01' });
  workDays(a.project, '2025-01-02', 40);
  const did = tidyDue({ you: a.you, project: a.project }, '2025-03-01');
  expect(did.map((d) => [d.retired.length, d.held.length])).toEqual([[0, 6]]);
  expect(readFacts(a.project)).toHaveLength(6);
  expect(heldTidy(a.project).map((p) => p.why)).toEqual(Array(6).fill('not used in 40 days of use'));
  expect(saveLine({ added: [], replaced: [], retired: [], tidied: did })).toBe(`Memory: ${heldWords(6)}`);
  expect(heldWords(6)).toBe('6 facts not used in a while: /memory tidy takes them out, /memory keep keeps them');
  const st = memoryStatus(join(a.repo, 'src'), a.home);
  expect(st.held).toBe(6);
  expect(statusWords(st)).toContain('· 6 to tidy or keep (/memory) ·');
  // /memory keep: all stay, their clock starts again, and the next day's tidy asks nothing.
  expect(keepHeld(a.project, '2025-03-01').kept).toHaveLength(6);
  expect(heldTidy(a.project)).toEqual([]);
  expect(readFacts(a.project).every((f) => f.last === '2025-03-01')).toBe(true);
  expect(tidyDue({ you: a.you, project: a.project }, '2025-03-02')).toEqual([]);
  // /memory tidy: the held six go in one batch, and can be brought back.
  const b = place();
  applyChanges(b.project, { add: six }, { today: '2025-01-01' });
  workDays(b.project, '2025-01-02', 40);
  tidyDue({ you: b.you, project: b.project }, '2025-03-01');
  expect(tidyHeld(b.project).retired).toHaveLength(6);
  expect(readFacts(b.project)).toEqual([]);
  expect(readFacts(b.project, { retired: true }).every((f) => f.retired.includes('not used in 40 days of use'))).toBe(true);
  expect(heldTidy(b.project)).toEqual([]);
  expect(undoLast(b.project).did.filter((d) => d.what === 'brought back')).toHaveLength(6);
  // A small tidy (3 at most) is done as before, and clears what was held.
  const c = place();
  applyChanges(c.project, { add: six }, { today: '2025-01-01' });
  workDays(c.project, '2025-01-02', 40);
  markUsed(c.project, readFacts(c.project).slice(0, 3).map((f) => f.id), '2025-02-28');
  const small = tidyDue({ you: c.you, project: c.project }, '2025-03-01');
  expect(small.map((d) => [d.retired.length, d.held.length])).toEqual([[3, 0]]);
  expect(readFacts(c.project)).toHaveLength(3);
});
