// The memory's review at night (src/app/review.mjs): when it may run, which
// conversations it reads, and what it leaves behind.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { whyNot, plistText, HOURS, IDLE_MINS } from '../src/app/review.mjs';

test('when it may run: at night, on power, the Mac idle, no window open and no test run', () => {
  const ok = { hour: 3, onPower: true, idleMins: 45, windows: 0, bench: false };
  expect(whyNot(ok)).toBe(null);
  expect(whyNot({ ...ok, hour: 14 })).toBe('it is not between 1 and 6 in the morning');
  expect(whyNot({ ...ok, hour: 6 })).toBe('it is not between 1 and 6 in the morning');
  expect(whyNot({ ...ok, onPower: false })).toBe('the Mac runs on its battery');
  expect(whyNot({ ...ok, idleMins: 4.4 })).toBe('the Mac was used 4 minutes ago');
  expect(whyNot({ ...ok, windows: 1 })).toBe('an Agentic Coder window is open');
  expect(whyNot({ ...ok, bench: true })).toBe('a test run has the model');
  // --now skips the clock, the power and the idle check, never the other two
  expect(whyNot({ hour: 14, onPower: false, idleMins: 0, windows: 0, bench: false }, { now: true })).toBe(null);
  expect(whyNot({ ...ok, windows: 2 }, { now: true })).toBe('an Agentic Coder window is open');
  expect([HOURS, IDLE_MINS]).toEqual([[1, 2, 3, 4, 5], 30]);
});

test('the scheduler\'s file: once an hour in those hours, the installed app, in the background', () => {
  const p = plistText('/Users/me/.agentic-coder/app/agentic-coder');
  expect(p).toContain('<string>/Users/me/.agentic-coder/app/agentic-coder</string><string>memory-review</string>');
  expect(p.match(/<key>Hour<\/key>/g)).toHaveLength(5);
  expect(p).toContain('<key>ProcessType</key><string>Background</string>');
  expect(p).not.toContain('KeepAlive'); // it is never restarted on its own
  expect(p).not.toContain('RunAtLoad');
});

// In its own process with its own home (the folders are read when the code loads).
function inChild(body, files = () => {}, { save = 'auto' } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'agentic-review-'));
  const repo = join(base, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(join(repo, 'legend.js'), 'export const z = 0;\n');
  mkdirSync(join(base, 'home', 'sessions', 'repo'), { recursive: true });
  files({ base, repo, sessions: join(base, 'home', 'sessions', 'repo') });
  const src = (p) => JSON.stringify(join(import.meta.dir, '..', p));
  const script = `
    const { review, sessionsToRead } = await import(${src('src/app/review.mjs')});
    const { startFakeServer } = await import(${src('test/fake-server.mjs')});
    const { memoryDirs, readFacts, applyChanges } = await import(${src('src/agent/facts.mjs')});
    const { MODELS, DEFAULT_MODEL } = await import(${src('../models/index.mjs')});
    const { AutoSave, pendingFor } = await import(${src('src/app/autosave.mjs')});
    const repo = ${JSON.stringify(repo)};
    const dirs = memoryDirs(repo);
    const model = MODELS[DEFAULT_MODEL];
    const night = { hour: 3, onPower: true, idleMins: 60, windows: 0, bench: false };
    const out = {};
    ${body}
    console.log(JSON.stringify(out));
    process.exit(0);
  `;
  const r = spawnSync('bun', ['-e', script], { encoding: 'utf8', env: { ...process.env, AGENTIC_HOME: join(base, 'home'), AGENTIC_MEMORY: join(base, 'about-you'), AGENTIC_MEMORY_SAVE: save }, timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return { ...JSON.parse(r.stdout.trim().split('\n').pop()), base };
}
const session = (repo, id, o = {}) => JSON.stringify({ id, cwd: repo, updated: `2026-09-26T2${id}:00:00.000Z`, title: `talk ${id}`, messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'always explain things simply' }, { role: 'assistant', content: 'I will.' }], lessons: [{ request: 'fix the legend', kind: 'fix', outcome: 'passed', reason: 'done', files: ['legend.js'], check: { cmd: 'node check.mjs', ok: true }, tries: [], findings: [], warnings: [], recalled: [], saved: true }], ...o });

test('it reads the day\'s conversations once, saves what they teach, and leaves a line for the next start', () => {
  const o = inChild(`
    const answer = { add: [{ kind: 'you', text: 'Explain things simply, in plain words.' }, { kind: 'worked', text: 'Worked: the legend showed after the fix in legend.js.', turn: 1 }], drop: [] };
    const fake = await startFakeServer([], { route: () => ({ text: JSON.stringify(answer) }) });
    out.toRead = sessionsToRead().map((s) => [s.title, s.lessons.length, s.lessons[0].saved]);
    out.first = await review({ url: fake.url, model, state: night, today: '2026-09-27' });
    out.asked = fake.requests.length;
    out.prompt = JSON.stringify(fake.requests[0]).includes('A conversation of today, read again');
    out.you = readFacts(dirs.you).map((f) => f.text);
    out.project = readFacts(dirs.project).map((f) => [f.kind, f.text]);
    out.second = await review({ url: fake.url, model, state: night, today: '2026-09-27' });
    out.askedAfter = fake.requests.length;
    out.day = await review({ url: fake.url, model, state: { ...night, hour: 15 } });
    await fake.close();
  `, ({ repo, sessions }) => { writeFileSync(join(sessions, 'a.json'), session(repo, 1)); writeFileSync(join(sessions, 'b.json'), session(repo, 2)); writeFileSync(join(sessions, 'gone.json'), session(join(repo, 'no-such-folder'), 3)); });
  expect(o.toRead).toEqual([['talk 1', 1, null], ['talk 2', 1, null]]); // a turn saved before is read again; a folder that is gone is skipped
  expect(o.first).toMatchObject({ ran: true, read: 2, added: 2, stopped: false });
  expect(o.prompt).toBe(true);
  expect(o.you).toEqual(['Explain things simply, in plain words.']);
  expect(o.project).toEqual([['worked', 'Worked: the legend showed after the fix in legend.js.']]); // borne out by the turn that passed
  expect(o.asked).toBe(2);
  // the second conversation said the same: refused as saved already, not saved twice
  expect([o.second, o.askedAfter]).toEqual([{ ran: true, read: 0, added: 0, tidied: 0 }, 2]);
  expect(o.day).toEqual({ ran: false, why: 'it is not between 1 and 6 in the morning' });
  const done = JSON.parse(readFileSync(join(o.base, 'home', 'memory-jobs', require('node:fs').readdirSync(join(o.base, 'home', 'memory-jobs'))[0]), 'utf8'));
  expect(done.line).toContain('Memory: reviewed last night, 2 saved');
});

test('an Agentic Coder window opens while it reads: it stops at once, and picks the rest up the next night', () => {
  const o = inChild(`
    const fake = await startFakeServer([], { route: () => ({ text: '{"add":[{"kind":"you","text":"Explain things simply, in plain words."}],"drop":[]}' }) });
    let calls = 0;
    out.first = await review({ url: fake.url, model, state: night, stillAlone: () => ++calls < 2 });
    out.left = sessionsToRead().map((s) => s.title);
    out.next = await review({ url: fake.url, model, state: night });
    await fake.close();
  `, ({ repo, sessions }) => { writeFileSync(join(sessions, 'a.json'), session(repo, 1)); writeFileSync(join(sessions, 'b.json'), session(repo, 2)); });
  expect(o.first).toMatchObject({ read: 1, stopped: true });
  expect(o.left).toEqual(['talk 2']);
  expect(o.next).toMatchObject({ read: 1, stopped: false });
});

test('asking first (the default): the review saves nothing, keeps what it would save, and the next start in that folder asks', () => {
  const o = inChild(`
    const answer = { add: [{ kind: 'you', text: 'Explain things simply, in plain words.' }], drop: [] };
    const fake = await startFakeServer([], { route: () => ({ text: JSON.stringify(answer) }) });
    out.first = await review({ url: fake.url, model, state: night, today: '2026-09-27' });
    await fake.close();
    out.savedNow = readFacts(dirs.you).length;
    out.kept = pendingFor(repo).map((p) => p.adds.map((a) => a.text));
    out.elsewhere = pendingFor('/somewhere/else').length;
    // The next start: a Skip is never offered again; a later start with a yes saves.
    const said = [];
    const asked = [];
    const skip = new AutoSave({ agent: { cwd: repo, memory: {}, lessons: [] }, ask: async (p) => { asked.push(p.title); return false; }, say: (t) => said.push(t) });
    out.skipped = await skip.askPending();
    out.afterSkip = [readFacts(dirs.you).length, pendingFor(repo).length];
    out.asked = asked;
    out.said = said;
  `, ({ repo, sessions }) => { writeFileSync(join(sessions, 'a.json'), session(repo, 1)); }, { save: 'ask' });
  expect(o.first).toMatchObject({ ran: true, read: 1, kept: 1 });
  expect(o.savedNow).toBe(0);
  expect(o.kept).toEqual([['Explain things simply, in plain words.']]);
  expect(o.elsewhere).toBe(0);
  expect(o.asked).toEqual(['Learned last time, read again when the window closed']);
  expect([o.skipped, o.afterSkip]).toEqual([0, [0, 0]]);
  expect(o.said).toEqual(['Not saved · it will not be offered again']);
});

test('the review at quit, asking first: kept for the next start, where Save writes it and a declined fact is refused from then on', () => {
  const o = inChild(`
    const { keepOrSave, jobsDir } = await import(${JSON.stringify(join(import.meta.dir, '..', 'src/app/autosave.mjs'))});
    const { proposeSave } = await import(${JSON.stringify(join(import.meta.dir, '..', 'src/agent/lessons.mjs'))});
    const { mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const answer = { add: [{ kind: 'you', text: 'Explain things simply, in plain words.' }, { kind: 'you', text: 'Say where a page was saved, with its full path.' }], drop: [] };
    const fake = await startFakeServer([], { route: () => ({ text: JSON.stringify(answer) }) });
    const lessons = [{ request: 'always explain things simply', kind: 'other', outcome: 'done', reason: 'done', files: [], tries: [], findings: [], warnings: [], recalled: [], saved: true }];
    mkdirSync(jobsDir(), { recursive: true });
    out.kept = await keepOrSave({ file: join(jobsDir(), 'quit-1.json'), job: { cwd: repo, review: true, ask: true, lessons, messages: [{ role: 'user', content: 'always explain things simply' }] }, url: fake.url, model });
    const yes = new AutoSave({ agent: { cwd: repo, memory: {}, lessons: [] }, ask: async () => true, say: () => {} });
    out.saved = await yes.askPending();
    out.you = readFacts(dirs.you).map((f) => f.text).sort();
    // The next quit reads the same turns: what is saved is not kept to ask again,
    // and a kept proposal saved meanwhile is dropped without a question.
    out.again = await keepOrSave({ file: join(jobsDir(), 'quit-2.json'), job: { cwd: repo, review: true, ask: true, lessons, messages: [] }, url: fake.url, model });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(jobsDir(), 'quit-3.pending'), JSON.stringify({ at: new Date().toISOString(), cwd: repo, home: null, adds: [{ kind: 'you', text: 'Explain things simply, in plain words.' }], drops: [] }));
    let asks = 0;
    const quiet = new AutoSave({ agent: { cwd: repo, memory: {}, lessons: [] }, ask: async () => { asks++; return true; }, say: () => {} });
    await quiet.askPending();
    out.askedAgain = [asks, pendingFor(repo).length];
    // Said no to one: the next proposal refuses it.
    const no = new AutoSave({ agent: { cwd: repo, memory: {}, lessons: [] }, ask: async () => false, say: () => {} });
    const { rememberDeclined } = await import(${JSON.stringify(join(import.meta.dir, '..', 'src/agent/lessons.mjs'))});
    rememberDeclined(dirs, ['Use tabs, not spaces, in every file.']);
    const again = { add: [{ kind: 'you', text: 'Use tabs, not spaces, in every file.' }], drop: [] };
    const fake2 = await startFakeServer([], { route: () => ({ text: JSON.stringify(again) }) });
    const p = await proposeSave({ url: fake2.url, model, cwd: repo, lessons, messages: [], review: true });
    out.refused = p.refused.map((r) => r.why);
    out.promptSaysNo = JSON.stringify(fake2.requests[0]).includes('The user said no to saving these');
    // Asked for in so many words, a skipped fact is saved all the same.
    const p2 = await proposeSave({ url: fake2.url, model, cwd: repo, lessons, messages: [], request: 'remember that I use tabs, not spaces, in every file' });
    out.asked = p2.adds.map((a) => a.text);
    await fake.close(); await fake2.close();
  `, ({ repo }) => {}, { save: 'ask' });
  expect(o.kept).toMatchObject({ kept: 2, added: [] });
  expect(o.saved).toBe(2);
  expect(o.you).toEqual(['Explain things simply, in plain words.', 'Say where a page was saved, with its full path.']);
  expect(o.refused).toEqual(['you said no to it before']);
  expect(o.again).toMatchObject({ kept: 0 });
  expect(o.again.refused.map((r) => r.why)).toEqual(['saved already', 'saved already']);
  expect(o.askedAgain).toEqual([0, 0]);
  expect(o.promptSaysNo).toBe(true);
  expect(o.asked).toEqual(['Use tabs, not spaces, in every file.']);
});
