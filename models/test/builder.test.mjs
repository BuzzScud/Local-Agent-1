// The Test builder (models/evals/battle/builder.mjs, suggest.mjs, and the checks it adds): a pasted
// list becomes tests, a prompt's own words choose its checks, a level sets its points, its time and
// its starting checks, and a test's page checks can be tried on a page with no model. Everything in
// a throwaway arena folder. The hub's routes in front of it: terminal/test/hub-builder.test.mjs.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

// A throwaway home, set before the models part loads: it reads AGENTIC_HOME once, at its first
// import, so a test file that loaded it first with none set would point every later file in the
// same run at the real ~/.agentic-coder. Every call below names its own folder as well.
process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-builder-home-'));
const { parsePrompts, kindOf, partsOf, suggestChecks, startChecks } = await import('../evals/battle/suggest.mjs');
const { CHECKS, labelOf, countOf, runChecks, runChecksWith, snapshot } = await import('../evals/battle/checks.mjs');
const { LEVELS, LIMIT_SECS, limitSecsOf, pointsOf, saveTest, listTests, paths, battleHome } = await import('../evals/battle/store.mjs');
const { builderData, readList, suggestFor, saveOwn, pasteTests, setLevel, duplicateOwn, deleteOwn, listTrash, restoreOwn, exportOwn, importOwn, keepPage, lastPage, tryChecks, PAGE_CHECKS } = await import('../evals/battle/builder.mjs');

const REPO = join(import.meta.dir, '..', '..');
// Three of the user's own UI component requests (they ship with the repo, for the UI component battle).
const COMPONENTS = JSON.parse(readFileSync(join(REPO, 'models', 'evals', 'bench', 'design', 'components.json'), 'utf8'));
const [CARD, NOTE, PLAYER] = ['data-card', 'notification', 'media-player'].map((id) => COMPONENTS.find((c) => c.id === id).prompt);
const LIST = `Prompt 1 — Data metric card\n${CARD}\n\n\nPrompt 5 — Notification card\n${NOTE}\n\n\n\nPrompt 7 — Mini music or media player\n${PLAYER}\n`;
const fresh = () => mkdtempSync(join(tmpdir(), 'agentic-builder-'));
const keys = (list) => list.map((c) => `${c.type}${c.value ? `:${c.value}` : ''}`);

test('nothing here can reach the real arena folder: the home these tests loaded with is a throwaway one', () => {
  expect(battleHome().startsWith(join(homedir(), '.agentic-coder'))).toBe(false);
});

test('a pasted list: "Prompt N — Title" starts a test and the lines under it are its words; without such lines, each block is one', () => {
  expect(parsePrompts(LIST).map((p) => [p.n, p.title, p.prompt.slice(0, 12)])).toEqual([[1, 'Data metric card', 'Build a sing'], [5, 'Notification card', 'Write a self'], [7, 'Mini music or media player', 'Create a sel']]);
  expect(parsePrompts(LIST)[0].prompt).toBe(CARD); // the words, whole, with no blank lines kept around them
  expect(parsePrompts('Test 2: Rename it\r\nRename fetchBars to loadBars.\r\n\r\ntask #3) Ports\nWhich port does it listen on?').map((p) => [p.n, p.title, p.prompt])).toEqual([[2, 'Rename it', 'Rename fetchBars to loadBars.'], [3, 'Ports', 'Which port does it listen on?']]);
  expect(parsePrompts('Build a page with a clock on it.\n\nFix the failing test in price.mjs and run the tests.').map((p) => [p.n, p.title])).toEqual([[1, 'Build a page with a'], [2, 'Fix the failing test in']]);
  expect(parsePrompts('Prompt 1 — No words under it\n\n')).toEqual([]);
  expect(parsePrompts('')).toEqual([]);
  expect(readList(LIST).map((p) => [p.kind, p.fit, p.eye])).toEqual([['page', 6, 3], ['page', 5, 4], ['page', 6, 3]]);
});

test('the kind of test comes from the prompt: a page, a question, a piece of writing, else a code change', () => {
  expect([CARD, NOTE, PLAYER].map(kindOf)).toEqual(['page', 'page', 'page']);
  expect(kindOf('Which port does the server listen on?')).toBe('question');
  expect(kindOf('Write a README for this folder.')).toBe('writing');
  expect(kindOf('Fix the rounding bug in price.mjs and run the tests.')).toBe('code');
});

test('the checks come from the prompt\'s own words: what it asks for is ticked, what it makes optional is listed with the reason, the rest is by eye', () => {
  const card = suggestChecks(CARD);
  expect(card.checks.map((c) => [c.key, c.from])).toEqual([['page-made:', 'easy'], ['scripts-valid:', 'easy'], ['offline:', 'easy'], ['layout:', 'medium'], ['page-has:%', 'hard'], ['drawn:', 'hard']]);
  expect(card.eye).toEqual(['a title', 'one large primary number', 'a short label']);
  expect(card.checks.map((c) => c.label)).toEqual(['A page was made', 'Its scripts are valid', 'Nothing from the internet', 'The layout is clean', 'The page has: %', 'It draws the bar or line']);
  // "add light JavaScript only if a close button needs…": the scripts check would fail a page with none, so it is not ticked.
  const note = suggestChecks(NOTE);
  expect(note.checks.find((c) => c.type === 'scripts-valid')).toMatchObject({ from: null, why: expect.stringContaining('makes JavaScript optional') });
  expect(note.checks.find((c) => c.type === 'count')).toMatchObject({ value: 'button>=2', from: 'hard', label: 'The page has at least 2 buttons', why: 'the prompt names “two small actions such as Dismiss and View”' });
  // "play, skip, and like buttons" is three buttons, one part.
  expect(partsOf(PLAYER)).toEqual(['album art as a colored block or CSS shape', 'track title', 'artist name', 'a progress bar', 'play, skip, and like buttons']);
  expect(keys(suggestChecks(PLAYER).checks.filter((c) => c.from === 'hard'))).toEqual(['drawn', 'count:button>=3']);
  // Fonts from a CDN allowed: "nothing from the internet" is listed, not ticked.
  expect(suggestChecks('Create one HTML file for a profile card. Include an avatar circle, name, and a primary action button. No frameworks, fonts from CDNs only if needed.').checks.find((c) => c.type === 'offline')).toMatchObject({ from: null, why: 'not ticked: the prompt allows fonts from a CDN' });
  // Parts from every sentence that lists them, each once.
  expect(partsOf('Show a title, a number. Include a title, five features, and a sign-up button.')).toEqual(['a title', 'a number', 'five features', 'a sign-up button']);
  // The other kinds.
  expect(keys(suggestChecks('Fix the bug in price.mjs.').checks)).toEqual(['tests', 'only-named']);
  expect(suggestChecks('Which port?').checks.map((c) => [c.type, c.from])).toEqual([['no-change', 'easy'], ['answer-has', null]]);
  expect(suggestFor('Which port?', 'nonsense').kind).toBe('question');
  expect(suggestFor(CARD, 'code').kind).toBe('code'); // the kind you picked wins over the words
});

test('a level\'s starting checks: Easy the basics, Medium adds the layout check, Hard every part the prompt names', () => {
  expect(keys(startChecks(CARD, 'page', 'easy'))).toEqual(['page-made', 'scripts-valid', 'offline']);
  expect(keys(startChecks(CARD, 'page', 'medium'))).toEqual(['page-made', 'scripts-valid', 'offline', 'layout']);
  expect(keys(startChecks(CARD, 'page', 'hard'))).toEqual(['page-made', 'scripts-valid', 'offline', 'layout', 'page-has:%', 'drawn']);
  expect(keys(startChecks(CARD, 'page', null))).toEqual(keys(startChecks(CARD, 'page', 'easy'))); // not sorted yet: Easy's
  expect(keys(startChecks(NOTE, 'page', 'easy'))).toEqual(['page-made', 'offline']);
  for (const kind of ['code', 'question', 'writing']) expect(startChecks('Do the thing.', kind, 'easy').length).toBeGreaterThan(0); // a test always starts with a check
  // What a level is worth and how long a run of it may take; its own limit wins; no level: the arena's 10 minutes.
  expect(Object.entries(LEVELS).map(([k, v]) => [k, v.points, v.minutes])).toEqual([['easy', 1, 5], ['medium', 2, 10], ['hard', 3, 20]]);
  expect([limitSecsOf({ level: 'easy' }), limitSecsOf({ level: 'hard' }), limitSecsOf({ level: 'hard', minutes: 7 }), limitSecsOf({}), limitSecsOf({ minutes: 999 })]).toEqual([300, 1200, 420, LIMIT_SECS, LIMIT_SECS]);
  expect([pointsOf({ level: 'easy' }), pointsOf({ level: 'medium' }), pointsOf({ level: 'hard' }), pointsOf({})]).toEqual([1, 2, 3, 0]);
});

test('the new checks: a page was made, so many buttons or list items, the bar is drawn, and the layout check (measured by whoever hands it over)', async () => {
  expect([labelOf({ type: 'count', value: 'button>=3' }), labelOf({ type: 'count', value: 'li>=5' }), labelOf({ type: 'count', value: 'button>=1' }), labelOf({ type: 'file-has', value: 'TODO' }), labelOf({ type: 'layout' })]).toEqual(['The page has at least 3 buttons', 'The page has at least 5 list items', 'The page has a button', 'A file says: TODO', 'The layout is clean']);
  expect([countOf('button>=3'), countOf('div>=2'), countOf('')]).toEqual([{ what: 'button', n: 3 }, null, null]);
  for (const k of PAGE_CHECKS) expect(CHECKS[k]).toBeDefined();
  const work = fresh();
  const all = [{ type: 'page-made' }, { type: 'count', value: 'button>=2' }, { type: 'count', value: 'li>=3' }, { type: 'drawn' }, { type: 'layout' }];
  // No page yet: each says so.
  expect(runChecks({ checks: all, work, before: {} }).checks.map((c) => [c.pass, c.why])).toEqual(all.map(() => [false, 'it made no page']));
  const before = snapshot(work);
  writeFileSync(join(work, 'card.html'), '<!doctype html><meta charset="utf-8"><button>Play</button><div role="button">Skip</div><ul><li>a</li><li>b</li></ul><svg></svg>');
  // Without a browser handed over, the layout check is not silently passed: it fails as not measured.
  const plain = runChecks({ checks: all, work, before });
  expect(plain.checks.map((c) => c.pass)).toEqual([true, true, false, true, false]);
  expect([plain.checks[2].why, plain.checks[4].why, plain.pass]).toEqual(['it has 2', 'not measured: the layout check needs a browser', false]);
  // With one: what it found decides, and the problems come back whole.
  const seen = [];
  const clean = await runChecksWith({ checks: all, work, before }, { layoutCheck: async (f) => { seen.push(f); return { page: f, problems: [], secs: 1 }; } });
  expect([seen, clean.checks[4].pass]).toEqual([[join(work, 'card.html')], true]);
  const faint = await runChecksWith({ checks: all, work, before }, { layoutCheck: async () => ({ problems: ['Text is too faint to read at 1440×900.', 'The page scrolls sideways on a phone.'] }) });
  expect(faint.checks[4]).toEqual({ label: 'The layout is clean', pass: false, why: '2 problems: Text is too faint to read at 1440×900.', problems: ['Text is too faint to read at 1440×900.', 'The page scrolls sideways on a phone.'] });
  expect((await runChecksWith({ checks: all, work, before }, { layoutCheck: async () => ({ skipped: 'no headless Chrome on this machine' }) })).checks[4]).toMatchObject({ pass: false, why: 'not measured: no headless Chrome on this machine' });
  expect((await runChecksWith({ checks: all, work, before }, { layoutCheck: async () => { throw new Error('it crashed'); } })).checks[4].why).toBe('not measured: it crashed');
  // A test with no layout check never opens a browser.
  let opened = 0;
  await runChecksWith({ checks: [{ type: 'page-made' }], work, before }, { layoutCheck: async () => { opened += 1; return { problems: [] }; } });
  expect(opened).toBe(0);
  // A drawn bar by its name too; a button by its input.
  writeFileSync(join(work, 'bar.html'), '<div class="progress-track"></div><input type="submit" value="Go">');
  expect(runChecks({ checks: [{ type: 'drawn' }, { type: 'count', value: 'button>=1' }], work, before: snapshot(work), prompt: '' }).checks.map((c) => c.pass)).toEqual([false, false]); // nothing new since that snapshot
  expect(runChecks({ checks: [{ type: 'drawn' }, { type: 'count', value: 'button>=1' }, { type: 'count', value: 'nonsense' }], work: (() => { const w = fresh(); writeFileSync(join(w, 'bar.html'), '<div class="progress-track"></div><input type="submit" value="Go">'); return w; })(), before: {} }).checks.map((c) => [c.pass, c.why])).toEqual([[true, ''], [true, ''], [false, 'no count given (button>=3, li>=5)']]);
});

test('paste a list: each prompt is a test of yours, not sorted yet, with Easy\'s starting checks; the same list again adds nothing', () => {
  const home = fresh();
  expect(builderData(home)).toMatchObject({ tests: [], trash: [], points: { of: 0 }, battleMinutes: 10 });
  const r = pasteTests(LIST, home);
  expect([r.added.length, r.skipped]).toEqual([3, 0]);
  expect(pasteTests(LIST, home)).toEqual({ added: [], skipped: 3 });
  const d = builderData(home);
  expect(d.tests.map((t) => [t.n, t.title, t.level, t.kind, t.limit, t.points, t.design, t.auto])).toEqual([[1, 'Data metric card', null, 'page', 10, 0, true, true], [2, 'Notification card', null, 'page', 10, 0, true, true], [3, 'Mini music or media player', null, 'page', 10, 0, true, true]]);
  expect(keys(d.tests[0].checks)).toEqual(['page-made', 'scripts-valid', 'offline']);
  expect(d.tests[0].suggest.checks).toHaveLength(6);
  // They are the arena's own "My tests": the Battle tab and ▶ Run tests see them.
  expect(listTests(home).filter((t) => t.suite === 'mine').map((t) => [t.id.startsWith('m-'), t.home])).toEqual([[true, true], [true, true], [true, true]]);
  expect(readFileSync(join(paths(home).tests, r.added[0], 'task.txt'), 'utf8')).toBe(`${CARD}\n`);
});

test('the quick level: its points, its time and its starting checks follow; checks you ticked by hand stay yours', () => {
  const home = fresh();
  const [a, b] = pasteTests(LIST, home).added;
  setLevel(a, 'hard', home);
  let t = builderData(home).tests.find((x) => x.id === a);
  expect([t.level, t.points, t.limit, t.auto, keys(t.checks)]).toEqual(['hard', 3, 20, true, ['page-made', 'scripts-valid', 'offline', 'layout', 'page-has:%', 'drawn']]);
  setLevel(a, 'easy', home); // back down: the Hard ones go again
  t = builderData(home).tests.find((x) => x.id === a);
  expect([t.level, t.points, t.limit, keys(t.checks)]).toEqual(['easy', 1, 5, ['page-made', 'scripts-valid', 'offline']]);
  // Ticked by hand in the editor: the level changes, the checks do not.
  saveOwn({ id: b, title: 'Notification card', level: 'easy', kind: 'page', prompt: NOTE, checks: [{ type: 'page-made' }, { type: 'page-has', value: 'Dismiss' }] }, home);
  expect(builderData(home).tests.find((x) => x.id === b).auto).toBe(false);
  setLevel(b, 'hard', home);
  t = builderData(home).tests.find((x) => x.id === b);
  expect([t.level, t.points, keys(t.checks)]).toEqual(['hard', 3, ['page-made', 'page-has:Dismiss']]);
  expect(builderData(home).points.of).toBe(4); // 1 + 3, the one not sorted counts nothing
  expect(() => setLevel(a, 'extreme', home)).toThrow('no level extreme');
  expect(() => setLevel('p01-json-flag', 'easy', home)).toThrow('no such test of yours');
});

test('the editor\'s Save: it needs a level and a check; its own time limit, the design switch, starter files and the reply are kept', () => {
  const home = fresh();
  expect(() => saveOwn({ title: 'x', kind: 'page', prompt: 'Build an HTML page.', checks: [{ type: 'page-made' }] }, home)).toThrow('pick a level first (Easy, Medium or Hard)');
  expect(() => saveOwn({ title: 'x', level: 'easy', kind: 'page', prompt: 'Build an HTML page.', checks: [] }, home)).toThrow('tick at least one check');
  expect(() => saveOwn({ title: 'x', level: 'easy', kind: 'page', prompt: 'Build an HTML page.', checks: [{ type: 'made-up' }] }, home)).toThrow('tick at least one check'); // a check that does not exist is not one
  expect(() => saveOwn({ title: 'x', level: 'easy', kind: 'page', prompt: '  ', checks: [{ type: 'page-made' }] }, home)).toThrow('the test needs a prompt');
  expect(() => saveOwn({ id: 'm-not-there', title: 'x', level: 'easy', kind: 'page', prompt: 'p', checks: [{ type: 'page-made' }] }, home)).toThrow('no such test of yours');
  expect(() => saveOwn({ title: 'x', level: 'easy', kind: 'page', prompt: 'p', checks: [{ type: 'page-made' }], minutes: 90 }, home)).toThrow('the time limit is 1 to 60 minutes');
  const meta = saveOwn({ title: 'Fix the rounding', level: 'medium', kind: 'code', prompt: 'Fix the rounding bug in price.mjs. Run the tests.', checks: [{ type: 'tests', value: '' }, { type: 'only-named' }], minutes: 15, design: true, ask: 'Round half up.', files: [{ path: 'price.mjs', b64: Buffer.from('export const r = (x) => x;').toString('base64') }, { path: '../escape.txt', b64: 'eA==' }] }, home);
  expect(meta).toMatchObject({ suite: 'mine', n: 1, level: 'medium', minutes: 15, design: false, kind: 'code' }); // the design folder is for pages
  let t = builderData(home).tests[0];
  expect([t.limit, t.minutes, t.ask, t.files, t.auto]).toEqual([15, 15, 'Round half up.', ['price.mjs'], true]);
  expect(existsSync(join(paths(home).tests, '..', 'escape.txt'))).toBe(false); // a starter file never lands outside its test
  // An edit: the level's own time is not kept as "yours"; a file is taken out; a page test keeps its switch.
  saveOwn({ id: meta.id, title: 'Rounding page', level: 'hard', kind: 'page', prompt: 'Build an HTML page that shows rounding.', checks: [{ type: 'page-made' }], minutes: 20, design: false, removePaths: ['price.mjs'] }, home);
  t = builderData(home).tests[0];
  expect([t.title, t.level, t.limit, t.minutes, t.design, t.files, t.n]).toEqual(['Rounding page', 'hard', 20, null, false, [], 1]);
  expect(listTests(home)[0].home).toBe(true); // a page test runs with its folder as the home folder
});

test('duplicate, delete to the trash, bring back; export every test to one file and bring it in elsewhere', () => {
  const home = fresh();
  const meta = saveOwn({ title: 'Card', level: 'easy', kind: 'page', prompt: CARD, checks: [{ type: 'page-made' }], files: [{ path: 'notes/brief.txt', b64: Buffer.from('a brief').toString('base64') }] }, home);
  const copy = duplicateOwn(meta.id, home);
  expect([copy.title, copy.n, copy.level, copy.id === meta.id]).toEqual(['Card (copy)', 2, 'easy', false]);
  expect(readFileSync(join(paths(home).tests, copy.id, 'project', 'notes', 'brief.txt'), 'utf8')).toBe('a brief');
  setLevel(copy.id, 'hard', home); // the same words at another level: what Duplicate is for
  deleteOwn(copy.id, home);
  expect([builderData(home).tests.length, listTrash(home).map((t) => [t.title, t.level, t.id])]).toEqual([1, [['Card (copy)', 'hard', copy.id]]]);
  expect(() => deleteOwn(copy.id, home)).toThrow('no such test of yours');
  expect(restoreOwn(listTrash(home)[0].name, home)).toBe(copy.id);
  expect([builderData(home).tests.map((t) => t.title), listTrash(home)]).toEqual([['Card', 'Card (copy)'], []]);
  expect(() => restoreOwn('../tests', home)).toThrow('no such test in the trash');
  expect(() => restoreOwn('nope', home)).toThrow('no such test in the trash');
  // A number is never used twice, even after a delete.
  deleteOwn(copy.id, home);
  expect(saveOwn({ title: 'Third', level: 'easy', kind: 'page', prompt: 'Build an HTML page.', checks: [{ type: 'page-made' }] }, home).n).toBe(3);
  restoreOwn(listTrash(home)[0].name, home);
  // Export: what each test is, files and all. Import: into another Mac's folder; again adds nothing.
  const file = JSON.parse(JSON.stringify(exportOwn(home)));
  expect(file).toMatchObject({ app: 'agentic-coder', what: 'my-tests', version: 1 });
  expect(file.tests.map((t) => [t.title, t.level, t.files.map((f) => f.path)])).toEqual([['Card', 'easy', ['notes/brief.txt']], ['Card (copy)', 'hard', ['notes/brief.txt']], ['Third', 'easy', []]]);
  const other = fresh();
  expect(importOwn(file, other)).toMatchObject({ added: [expect.any(String), expect.any(String), expect.any(String)], skipped: 0 });
  expect(importOwn(file, other)).toEqual({ added: [], skipped: 3 });
  expect(builderData(other).tests.map((t) => [t.title, t.level, t.files, keys(t.checks)])).toEqual([['Card', 'easy', ['notes/brief.txt'], ['page-made']], ['Card (copy)', 'hard', ['notes/brief.txt'], ['page-made']], ['Third', 'easy', [], ['page-made']]]); // its one hand-picked check came along, not Hard's starting ones
  expect(() => importOwn({ tests: [] }, other)).toThrow('that is not a file the Test builder exported');
  expect(() => importOwn(null, other)).toThrow('that is not a file the Test builder exported');
  // A test in the file with no checks at all still starts with its level's.
  expect(importOwn({ what: 'my-tests', tests: [{ title: 'Bare', level: 'medium', prompt: NOTE }] }, other).added).toHaveLength(1);
  expect(keys(builderData(other).tests.at(-1).checks)).toEqual(['page-made', 'offline', 'layout']);
});

test('try the checks with no model: on a page you hand over, else on the last page a run of the test made; a check that reads no page waits for a real run', async () => {
  const home = fresh();
  const meta = saveOwn({ title: 'Card', level: 'hard', kind: 'page', prompt: CARD, checks: startChecks(CARD, 'page', 'hard') }, home);
  const checks = [...startChecks(CARD, 'page', 'hard'), { type: 'tests', value: '' }];
  const layoutCheck = async (f) => ({ problems: readFileSync(f, 'utf8').includes('faint') ? ['Text is too faint to read.'] : [] });
  // Nothing to try on yet.
  expect(await tryChecks({ id: meta.id, checks, prompt: CARD }, { layoutCheck }, home)).toEqual({ page: null, results: [], pass: null });
  expect(builderData(home).tests[0].page).toBeNull();
  // A page you chose: every page check runs on it, the project's tests do not.
  const good = '<!doctype html><meta charset="utf-8"><div class="card">Revenue 42 <b>+12%</b><svg></svg></div><script>document.title = "ok";</script>';
  let r = await tryChecks({ id: meta.id, checks, prompt: CARD, page: { name: '../../my card.html', html: good } }, { layoutCheck }, home);
  expect([r.page, r.pass]).toEqual([{ name: 'my-card.html', at: null, model: null, given: true }, true]);
  expect(r.results.map((x) => [x.key, x.pass])).toEqual([['page-made:', true], ['scripts-valid:', true], ['offline:', true], ['layout:', true], ['page-has:%', true], ['drawn:', true], ['tests:', null]]);
  expect(r.results.at(-1)).toMatchObject({ label: 'The tests pass', why: 'needs a real run: it does not read a page' });
  // A page that fails: which checks, and why, in full.
  r = await tryChecks({ id: meta.id, checks, prompt: CARD, page: { name: 'bad.html', html: '<p class="faint">Revenue 42</p><script src="https://cdn.example/x.js"></script>' } }, { layoutCheck }, home);
  expect(r.pass).toBe(false);
  expect(r.results.filter((x) => x.pass === false).map((x) => [x.label, x.why])).toEqual([['Its scripts are valid', 'the page has no script of its own'], ['Nothing from the internet', 'bad.html loads something from the internet'], ['The layout is clean', '1 problem: Text is too faint to read.'], ['The page has: %', 'no page has "%"'], ['It draws the bar or line', 'no svg, canvas, progress or bar element']]);
  expect(r.results.find((x) => x.key === 'layout:').problems).toEqual(['Text is too faint to read.']);
  // After a run: the page it made is kept per model, and the newest one is what a try uses.
  const made = join(fresh(), 'data-card.html'); writeFileSync(made, good);
  expect(keepPage(meta.id, 'qwen', made, home)).toBe(true);
  expect(lastPage(meta.id, home)).toMatchObject({ name: 'data-card.html', model: 'qwen' });
  expect(builderData(home).tests[0].page).toMatchObject({ name: 'data-card.html', model: 'qwen' });
  r = await tryChecks({ id: meta.id, checks, prompt: CARD }, { layoutCheck }, home);
  expect([r.page.name, r.page.model, r.page.given, r.pass]).toEqual(['data-card.html', 'qwen', false, true]);
  expect(readdirSync(paths(home).pages)).toHaveLength(1);
  expect(lastPage('m-never-ran', home)).toBeNull();
  // Nothing is left in the test's own folder, and nothing of the try stays behind.
  expect(readdirSync(join(paths(home).tests, meta.id)).sort()).toEqual(['meta.json', 'project', 'task.txt']);
});

test('a test made in the Battle tab still saves as before, and one made here keeps its level when it is edited there', () => {
  const home = fresh();
  // The arena's own New test: no level, 10 minutes, no design folder.
  const old = saveTest({ title: 'Port', kind: 'question', prompt: 'Which port?', checks: [{ type: 'answer-has', value: '8080' }] }, home);
  expect([old.level, old.design, old.minutes, old.n, limitSecsOf(old)]).toEqual([undefined, undefined, undefined, 1, 600]);
  const mine = saveOwn({ title: 'Card', level: 'hard', kind: 'page', prompt: CARD, checks: [{ type: 'page-made' }], minutes: 25 }, home);
  // The arena's edit (it sends no level): the level, the limit and the switch stay.
  const again = saveTest({ id: mine.id, title: 'Card, renamed', kind: 'page', prompt: CARD, checks: [{ type: 'page-made' }, { type: 'count', value: 'button>=1' }, { type: 'count', value: 'li>=5' }] }, home);
  expect([again.level, again.minutes, again.design, again.n, again.checks.length]).toEqual(['hard', 25, true, 2, 3]);
  expect(() => saveTest({ title: 'x', kind: 'page', prompt: 'p', checks: [{ type: 'page-made' }], level: 'extreme' }, home)).toThrow('no level extreme');
  // The sets that come with the repo get no number and no level.
  mkdirSync(join(paths(home).tests, 'n01-x', 'project'), { recursive: true });
  writeFileSync(join(paths(home).tests, 'n01-x', 'meta.json'), JSON.stringify({ id: 'n01-x', n: 1, suite: 'new28', title: 'A set test', kind: 'code', checks: [] }));
  writeFileSync(join(paths(home).tests, 'n01-x', 'task.txt'), 'Do it.\n');
  expect(builderData(home).tests.map((t) => t.title)).toEqual(['Port', 'Card, renamed']); // only yours
});
