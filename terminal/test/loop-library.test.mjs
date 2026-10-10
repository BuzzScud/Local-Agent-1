// Loops kept to load again (loop-files.mjs) and the board's Library (loops-library.mjs), without a model:
// the fifteen ready-made loops, a loop written and read back, kept for you or in a project, the Library's cards,
// loading one at the wizard's last step with its blanks, Save as, the one-page form, a project's loop
// asking once, and /loop <name>. The real window: app-loops.test.mjs.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'agentic-loop-library-'));
process.env.AGENTIC_HOME = join(root, 'home');
process.env.AGENTIC_LOOP_MIN_SECS = '60';
const L = await import('../src/app/loops.mjs');
const F = await import('../src/app/loop-files.mjs');
const D = await import('../src/app/loops-draw.mjs');
const B = await import('../src/app/loops-board.mjs');
const Lib = await import('../src/app/loops-library.mjs');

const text = (rows) => rows.map((r) => r.map(([t]) => t).join('')).join('\n');
// A window in a project of its own (tests, a git remote, one loop that came with it) and a home of its own.
let seq = 0;
function windowIn({ projectLoop = true } = {}) {
  const dir = join(root, `w${++seq}`);
  const home = join(dir, 'home');
  const project = join(dir, 'trades-export');
  mkdirSync(join(project, '.git'), { recursive: true });
  writeFileSync(join(project, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:someone/trades-export.git\n');
  writeFileSync(join(project, 'export.test.mjs'), '');
  if (projectLoop) {
    mkdirSync(F.projectDir(project), { recursive: true });
    writeFileSync(join(F.projectDir(project), 'check-the-export.md'), '# Check the export\nRuns the export and says when a total changed.\n\n- Kind: task\n- Every: 30m\n- Picture: RUN the export › COMPARE totals › TELL you\n\n## Each run\nRun node export.mjs and compare the totals with the last run. Change nothing.\n');
  }
  const clock = { t: Date.parse('2026-10-09T15:00:00') };
  const m = new L.Loops({ home, pid: process.pid, folder: project, name: 'trades-export', now: () => clock.t, status: () => ({ on: true, name: 'Stand-in', where: 'this Mac', limit: 1, mode: 'ask' }), start: () => ({ on() {}, send() {}, kill() {} }) });
  const sent = [];
  const ui = B.newUi();
  const bd = { get state() { return m.snapshot(); }, ui, send: (c) => { sent.push(c); const r = m.apply(c); B.showReply(ui, m.loops, r); return r; }, quit: () => sent.push('quit') };
  const press = (...ks) => ks.forEach((k) => B.handleKey(bd, k));
  // To a row of the wizard's last step by its name ('saveName', 'fill:0', 'mode' …).
  const toRow = (name) => { for (let i = 0; i < 12 && Lib.startRows(ui.setup)[ui.setup.rule] !== name; i++) press('down'); expect(Lib.startRows(ui.setup)[ui.setup.rule]).toBe(name); };
  const frame = (cols = 136, rows = 44) => { const f = D.drawBoard(m.snapshot(), ui, { cols, rows, now: clock.t, linesOf: () => [] }); for (const r of f) expect(D.rowWidth(r)).toBe(cols); expect(f).toHaveLength(rows); return text(f); };
  return { m, home, project, ui, bd, press, frame, sent, clock, toRow };
}

test('the fifteen ready-made loops: files that read back, each a loop the rules take, with three steps of its own', () => {
  const ready = F.libraryOf({ home: join(root, 'nobody') });
  expect(ready.map((l) => l.name)).toEqual(['Watch the tests', 'Fix until green', 'Build and lint guard', 'Flaky test hunter', 'Watch CI', 'Release watch', 'Dev server check', 'Log watcher', 'Work digest', 'Docs keeper', 'Layout watch', 'Polish until clean', 'Theme guard', 'Accessibility pass', 'Design review']);
  for (const l of ready) {
    expect(l.from).toBe('ready');
    expect(l.about.length).toBeGreaterThan(20);
    expect(['test', 'debug', 'web', 'task']).toContain(l.fields.kind);
    expect(l.picture).toHaveLength(3);
    // With its blanks answered, its rules read: how often, until when, its mode, its cap.
    const values = Object.fromEntries(l.fills.map((x) => [x.key, x.value || 'someone/repo']));
    const read = L.rulesOf({ ...l.fields, message: F.filledText(l.message, values), name: l.name, picture: l.picture });
    expect(read.error).toBeUndefined();
    expect(read.rules.name).toBe(l.name);
    // Written again, it reads back the same.
    expect(F.parseLoopFile(F.loopFileText(l), { id: l.id })).toEqual({ id: l.id, name: l.name, about: l.about, fields: l.fields, picture: l.picture, fills: l.fills, message: l.message });
  }
  // The blanks: Release watch asks for a page with its answer ready; Watch CI's repo is read from git when loaded.
  expect(ready.find((l) => l.name === 'Release watch').fills).toEqual([{ key: 'page', value: 'https://bun.sh/blog' }]);
  expect(ready.find((l) => l.name === 'Watch CI').fills).toEqual([{ key: 'repo', value: '' }]);
  expect(ready.find((l) => l.name === 'Fix until green').fields).toMatchObject({ kind: 'debug', every: 'until done', runs: '10', mode: 'edits', cap: '$1.00' });
  expect(ready.find((l) => l.name === 'Docs keeper').fields.askFirst).toBe(true);
  expect(F.fillsIn('Open {url} and {url}/health, then {page}')).toEqual(['url', 'page']);
  expect(F.filledText('Open {url}', { url: 'http://x' })).toBe('Open http://x');
  expect(F.filledText('Open {url}', {})).toBe('Open {url}');
  expect(F.pictureOf('CALL the API > COMPARE to last run > TELL you')).toEqual([['CALL', 'the API'], ['COMPARE', 'to last run'], ['TELL', 'you']]);
  expect(F.pictureOf('only two › parts')).toBe(null);
  // A name typed after /loop: case, spaces and punctuation aside.
  expect(F.findByName(ready, 'watch the tests')?.id).toBe('ready:watch-the-tests');
  expect(F.findByName(ready, 'Watch CI!')?.id).toBe('ready:watch-ci');
  expect(F.findByName(ready, 'run the tests every 10 min')).toBe(null);
});

test('a loop kept: for you or in a project, a name taken, a new name, removed only where loops are kept, a project\'s loop trusted by its very text', () => {
  const { home, project, m } = windowIn({ projectLoop: false });
  const l = { name: 'Nightly API check', about: 'Calls the API.', message: 'Call {url}/health. Change nothing.', fills: [{ key: 'url', value: 'http://localhost:8787' }], picture: [['CALL', 'the API'], ['COMPARE', 'to last run'], ['TELL', 'you']], fields: { kind: 'web', every: '15m', runs: 'no limit', stopAt: '2h', mode: 'ask', cap: 'none', steps: 'as /effort', askFirst: false } };
  const mine = F.saveLoop(l, { home });
  expect(mine.file).toBe(join(home, 'loop-library', 'nightly-api-check.md'));
  expect(readFileSync(mine.file, 'utf8')).toBe('# Nightly API check\nCalls the API.\n\n- Kind: web\n- Every: 15m\n- Until: 2h\n- Mode: ask\n- Picture: CALL the API › COMPARE to last run › TELL you\n- Asks: url = http://localhost:8787\n\n## Each run\nCall {url}/health. Change nothing.\n');
  expect(F.saveLoop(l, { home }).error).toMatch(/already a loop called “Nightly API check” of yours/);
  expect(F.saveLoop({ ...l, name: '' }, { home }).error).toMatch(/Give it a name/);
  // A new name with replace: the old file goes.
  const renamed = F.saveLoop({ ...l, name: 'API check' }, { home, replace: mine.file });
  expect(existsSync(mine.file)).toBe(false);
  expect(existsSync(renamed.file)).toBe(true);
  // In a project: kept in its .agentic/loops, and trusted, since you saved it.
  const there = F.saveLoop(l, { home, where: 'project', folder: project });
  expect(there.file).toBe(join(project, '.agentic', 'loops', 'nightly-api-check.md'));
  const lib = F.libraryOf({ home, folders: [{ path: project, shown: '~/trades-export' }] });
  expect(lib.filter((x) => x.from !== 'ready').map((x) => [x.from, x.name, x.trusted])).toEqual([['yours', 'API check', true], ['project', 'Nightly API check', true]]);
  // A project's file changed by someone else: no longer trusted, until a yes to it as it is now.
  writeFileSync(there.file, readFileSync(there.file, 'utf8').replace('Change nothing.', 'Delete the logs.'));
  expect(F.libraryOf({ home, folders: [{ path: project, shown: '~/trades-export' }] }).find((x) => x.from === 'project').trusted).toBe(false);
  F.trustLoop(home, there.file, readFileSync(there.file, 'utf8'));
  expect(F.libraryOf({ home, folders: [{ path: project, shown: '~/trades-export' }] }).find((x) => x.from === 'project').trusted).toBe(true);
  // Removing: only a file where loops are kept.
  expect(F.removeLoop('/etc/hosts', { home }).error).toMatch(/not a loop you kept/);
  expect(F.removeLoop(renamed.file, { home }).file).toBe(renamed.file);
  expect(existsSync(renamed.file)).toBe(false);
  m.close();
});

test('the Library: /loop with no loop opens it, cards in sections at every size, typing finds one, enter loads it at the last step with its blank, Save as keeps it and starts it', () => {
  const w = windowIn();
  const { ui, press, frame, sent, m, home } = w;
  expect(B.openFromChat(ui, '', m.snapshot())).toBe(true);
  expect(ui.view).toBe('shelf');
  let f = frame();
  expect(f).toMatch(/Running 0 {3}Library 16/); // the 15 ready-made (Loops 11–15 came 9 Oct 2026) and the project's one
  expect(f).toMatch(/Yours {2}kept for you, in every project[\s\S]*\+ New loop/);
  expect(f).toMatch(/Projects {2}kept in a project, shared through git[\s\S]*TASK {2}Check the export[\s\S]*trades-export · asks once/);
  expect(f).toMatch(/Ready-made {2}come with the app[\s\S]*TEST {2}Watch the tests[\s\S]*RUN › READ › TELL/);
  expect(f).toMatch(/A new loop {2}· {2}the wizard/);
  for (const [cols, rows] of [[96, 30], [124, 38], [200, 60]]) frame(cols, rows);
  // Typing finds one by its name or what it is about; enter loads it.
  press(...'release');
  f = frame();
  expect(f).toMatch(/find: release/);
  expect(f).toMatch(/WEB {2}Release watch/);
  expect(f).not.toMatch(/Watch the tests/);
  press('enter');
  expect(ui.view).toBe('setup');
  expect(D.stepOf(ui.setup)).toBe('start');
  expect(ui.setup).toMatchObject({ loaded: { name: 'Release watch', from: 'ready' }, fills: [{ key: 'page', value: 'https://bun.sh/blog' }], f: { kind: 'web', every: '1h' } });
  expect(ui.setup.text).toMatch(/^Read https:\/\/bun\.sh\/blog\. If there is a version/);
  f = frame();
  expect(f).toMatch(/Loaded {4}Release watch {2}ready-made/);
  expect(f).toMatch(/▸ \{page\} {5}https:\/\/bun\.sh\/blog/);
  expect(f).toMatch(/1 OPEN[\s\S]*2 FIND[\s\S]*3 TELL/);
  // Typing goes in the blank: the message follows it.
  press('^U', ...'https://example.com/news');
  expect(ui.setup.text).toMatch(/^Read https:\/\/example\.com\/news\./);
  // Save as: a name keeps it; the buttons say so; enter saves and starts it.
  w.toRow('saveName');
  press(...'News watch');
  f = frame();
  expect(f).toMatch(/▸ Name {10}News watch/);
  expect(f).toMatch(/ Save {6}Save and start /);
  press('enter');
  const add = sent.at(-1);
  expect(add).toMatchObject({ op: 'add', fields: { name: 'News watch', kind: 'web', every: '1h' }, save: { name: 'News watch', where: 'yours', message: expect.stringMatching(/^Read \{page\}\./), fills: [{ key: 'page', value: 'https://example.com/news' }] } });
  expect(m.loops[0]).toMatchObject({ name: 'News watch', kind: 'web', every: 3600 });
  expect(m.loops[0].message).toMatch(/^Read https:\/\/example\.com\/news\./);
  expect(ui.toast.text).toMatch(/Loop 1 started: .* · kept as “News watch” for you: \/loop loads it/);
  expect(readdirSync(join(home, 'loop-library'))).toEqual(['news-watch.md']);
  // Now in the Library, under Yours; tab is the Library from the cards, and back.
  expect(ui.view).toBe('main');
  press('tab');
  expect(ui.view).toBe('shelf');
  expect(frame()).toMatch(/Running 1 {3}Library 17[\s\S]*Yours[\s\S]*WEB {2}News watch/);
  press('tab');
  expect(ui.view).toBe('main');
  m.close();
});

test('a project\'s loop asks once, a {repo} is read from git, /loop <name> loads one, the form changes and renames one you kept, ^D removes it', () => {
  const w = windowIn();
  const { ui, press, frame, sent, m, home, project } = w;
  B.openFromChat(ui, '', m.snapshot());
  // The project's loop: the second card. Its last step says where it came from; Start is the yes to that file.
  press('right', 'enter');
  expect(ui.setup.loaded).toMatchObject({ name: 'Check the export', from: 'project', project: 'trades-export', trusted: false });
  expect(frame()).toMatch(/This loop came with trades-export: read what it is[\s\S]{0,200}told on the right\. Start runs it, and it won't ask[\s\S]{0,200}again/);
  press('enter');
  expect(sent.at(-1)).toMatchObject({ op: 'add', trust: join(project, '.agentic', 'loops', 'check-the-export.md'), fields: { name: 'Check the export', folder: project } });
  expect(Object.keys(JSON.parse(readFileSync(join(home, 'loop-library', 'trusted.json'), 'utf8')))).toEqual([join(project, '.agentic', 'loops', 'check-the-export.md')]);
  expect(m.libraryNow().find((x) => x.from === 'project').trusted).toBe(true);
  // /loop <name>: a ready-made one by its name, at the last step; {repo} from this folder's git remote.
  expect(B.openFromChat(ui, 'watch ci', m.snapshot())).toBe(true);
  expect(ui.setup).toMatchObject({ loaded: { name: 'Watch CI' }, fills: [{ key: 'repo', value: 'someone/trades-export' }] });
  expect(ui.setup.text).toMatch(/runs of someone\/trades-export on its main branch|run of someone\/trades-export on its main branch/);
  // ^S keeps it without starting it.
  w.toRow('saveName');
  press(...'CI of trades', '^S');
  expect(sent.at(-1)).toMatchObject({ op: 'save', save: { name: 'CI of trades', where: 'yours' } });
  expect(m.loops).toHaveLength(1); // not started
  expect(existsSync(join(home, 'loop-library', 'ci-of-trades.md'))).toBe(true);
  // ^E on it in the Library: every field on one page; a new name and pace, saved over the old file.
  B.openFromChat(ui, 'library', m.snapshot());
  expect(ui.view).toBe('shelf');
  press(...'CI of'); // the Library keeps its place; typing finds the one meant
  press('^E');
  expect(ui.view).toBe('editor');
  let f = frame();
  expect(f).toMatch(/Kept for you · every field/);
  expect(f).toMatch(/▸ Name {9}CI of trades/);
  expect(f).toMatch(/\{repo\}[\s\S]*Its steps {4}READ the CI run › CHECK each job › TELL/);
  expect(f).toMatch(/\^D Remove[\s\S]*enter Save[\s\S]*\^G Save and start/);
  press('backspace', 'backspace', 'backspace', 'backspace', 'backspace', 'backspace', ...'API');
  for (let i = 0; i < 5; i++) press('down'); // from the name: message, {repo}, its steps, where, how often
  expect(frame()).toMatch(/▸ How often/);
  press('right');
  press('enter');
  expect(sent.at(-1)).toMatchObject({ op: 'save', save: { name: 'CI of API', replace: join(home, 'loop-library', 'ci-of-trades.md') } });
  expect(readdirSync(join(home, 'loop-library')).filter((x) => x.endsWith('.md'))).toEqual(['ci-of-api.md']);
  expect(F.parseLoopFile(readFileSync(join(home, 'loop-library', 'ci-of-api.md'), 'utf8')).fields.every).not.toBe('5m');
  // ^D in the Library asks first; y removes its file.
  expect(ui.view).toBe('shelf');
  press('^D');
  expect(ui.view).toBe('confirm');
  expect(ui.confirm.text).toMatch(/Remove “CI of API”\? Its file is deleted\./);
  press('y');
  expect(sent.at(-1)).toMatchObject({ op: 'remove', file: join(home, 'loop-library', 'ci-of-api.md') });
  expect(readdirSync(join(home, 'loop-library')).filter((x) => x.endsWith('.md'))).toEqual([]);
  // A ready-made loop cannot be changed or removed: ^E and ^D do nothing on it.
  B.openFromChat(ui, 'library', m.snapshot());
  press(...'flaky');
  press('^E');
  expect(ui.view).toBe('shelf');
  m.close();
});
