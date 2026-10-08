// The hub's Memory tab (src/app/memory-hub.mjs, memory.html): what it
// reads, the changes it can make, and who may make them.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// In its own process with its own home: the memory's folders are read from
// the environment when the store loads.
function inChild(body) {
  const base = mkdtempSync(join(tmpdir(), 'agentic-memhub-'));
  const repo = join(base, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  const src = (p) => JSON.stringify(join(import.meta.dir, '..', p));
  const script = `
    const { startWeightsServer } = await import(${src('src/app/weights.mjs')});
    const { memoryDirs, applyChanges, readFacts, openMemory, changeTrust } = await import(${src('src/agent/facts.mjs')});
    const repo = ${JSON.stringify(repo)};
    const dirs = memoryDirs(repo);
    openMemory(repo);
    const [a, b] = applyChanges(dirs.project, { add: [{ kind: 'project', text: 'Run the tests with bun run test.' }, { kind: 'recipe', text: 'Add a page about Agentic Coder.', steps: ['build it', 'save it in DOCS'] }] }, { batch: 'earlier' }).added;
    changeTrust(dirs.project, [a.id], +1, 'the task passed its check');
    const s = startWeightsServer({ path: null, docsDir: null, port: 0, cwd: repo });
    const get = async (p) => (await fetch(s.url.replace(/\\/$/, '') + p)).json();
    const post = async (p, body, headers = {}) => { const r = await fetch(s.url.replace(/\\/$/, '') + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
    const out = {};
    ${body}
    s.stop();
    console.log(JSON.stringify(out));
  `;
  const r = spawnSync('bun', ['-e', script], { encoding: 'utf8', env: { ...process.env, AGENTIC_HOME: join(base, 'home'), AGENTIC_MEMORY: join(base, 'about-you') }, timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('the page and what it reads: both memories, with trust, steps and where each fact came from', () => {
  const o = inChild(`
    out.data = await get('/memory.json');
    out.page = await (await fetch(s.url.replace(/\\/$/, '') + '/memory')).text();
    out.hub = await (await fetch(s.url)).text();
  `);
  expect(o.page).toContain('<title>Agentic Coder memory</title>');
  expect(o.hub).toContain('<button data-tab="memory">Memory</button>');
  expect(o.data.parts.map((p) => [p.where, p.facts.length, p.retired.length])).toEqual([['you', 2, 0], ['project', 2, 0]]);
  expect(o.data.parts[0].facts.every((f) => f.always)).toBe(true);
  const [recipe, tests] = o.data.parts[1].facts;
  expect(tests).toMatchObject({ kind: 'project', text: 'Run the tests with bun run test.', trust: 1, passed: 1, failed: 0 });
  expect(recipe).toMatchObject({ kind: 'recipe', steps: ['build it', 'save it in DOCS'] });
  expect(tests.dir).toBeUndefined(); // the page gets no folder paths inside a fact
  expect(o.data.retireAt).toBe(-3);
  expect(o.data.log.some((l) => l.what === 'trust' && l.where === 'project')).toBe(true);
});

test('by hand: edit, pin, take out, bring back, and take the last save back; each one is in the log', () => {
  const o = inChild(`
    out.edit = await post('/memory/edit', { where: 'project', id: a.id, text: 'Run the tests with bun run test, never a bare bun test.' });
    out.secret = await post('/memory/edit', { where: 'project', id: a.id, text: 'The api key is sk-abcdefghijklmnopqrstuvwxyz123456' });
    out.short = await post('/memory/edit', { where: 'project', id: a.id, text: 'ok' });
    out.pin = await post('/memory/pin', { where: 'project', id: a.id, pinned: true });
    out.retire = await post('/memory/retire', { where: 'project', id: b.id });
    out.after = (await get('/memory.json')).parts[1];
    out.restore = await post('/memory/restore', { where: 'project', id: b.id });
    out.undo = await post('/memory/undo', {});
    out.end = (await get('/memory.json')).parts[1];
    out.missing = await post('/memory/pin', { where: 'project', id: 'no-such-fact' });
    out.nowhere = await post('/memory/pin', { where: 'elsewhere', id: a.id });
    out.path = await post('/memory/retire', { where: 'project', id: '../../etc/passwd' });
  `);
  expect([o.edit.status, o.secret.status, o.secret.error, o.short.error]).toEqual([200, 400, 'looks like a key or a password', 'too short to mean anything']);
  expect(o.after.facts.map((f) => [f.text, f.pinned])).toEqual([['Run the tests with bun run test, never a bare bun test.', true]]);
  expect(o.after.retired.map((f) => f.retired.replace(/^\S+ · /, ''))).toEqual(['taken out of use by you']);
  expect(o.restore.status).toBe(200);
  // the last change was bringing the recipe back: undo takes that back
  expect(o.undo).toMatchObject({ status: 200, undone: 1 });
  expect(o.end.facts.map((f) => f.kind)).toEqual(['project']);
  expect([o.missing.status, o.nowhere.status, o.nowhere.error, o.path.status]).toEqual([404, 400, 'which fact?', 400]);
});

test('only the hub page may change the memory: a request sent by another site is refused, and reading stays possible', () => {
  const o = inChild(`
    out.other = await post('/memory/retire', { where: 'project', id: a.id }, { origin: 'https://example.com' });
    out.own = await post('/memory/pin', { where: 'project', id: a.id }, { origin: new URL(s.url).origin });
    out.get = (await fetch(s.url.replace(/\\/$/, '') + '/memory/retire')).status;
    out.left = readFacts(dirs.project).length;
  `);
  expect([o.other.status, o.other.error]).toEqual([403, 'only the hub page may change the memory']);
  expect(o.own.status).toBe(200);
  expect(o.get).toBe(404);
  expect(o.left).toBe(2);
});

test('written by you (8 Oct 2026): a rule and a fact from scratch, a fact made a rule and back again; each is in the log', () => {
  const o = inChild(`
    out.rule = await post('/memory/add', { where: 'you', text: 'Always run the tests before you say a change is done.', always: true });
    out.fact = await post('/memory/add', { where: 'project', text: 'The desk server runs on port 8811.', kind: 'mistake' });
    out.youKind = await post('/memory/add', { where: 'project', text: 'Release notes live in docs/reports.', kind: 'you' });
    out.again = await post('/memory/add', { where: 'project', text: 'The desk server runs on port 8811.' });
    out.short = await post('/memory/add', { where: 'you', text: 'ok' });
    out.secret = await post('/memory/add', { where: 'project', text: 'The api key is sk-abcdefghijklmnopqrstuvwxyz123456' });
    out.nowhere = await post('/memory/add', { where: 'elsewhere', text: 'Somewhere that is not a memory at all.' });
    out.made = await post('/memory/always', { where: 'project', id: out.fact.added, always: true });
    out.asRule = (await get('/memory.json')).parts[1].facts.find((f) => f.id === out.fact.added);
    out.back = await post('/memory/always', { where: 'project', id: out.fact.added, always: false });
    out.missing = await post('/memory/always', { where: 'project', id: 'no-such-fact', always: true });
    out.end = await get('/memory.json');
    out.page = await (await fetch(s.url.replace(/\\/$/, '') + '/memory')).text();
  `);
  expect([o.rule.status, o.fact.status, o.youKind.status]).toEqual([200, 200, 200]);
  const you = o.end.parts[0].facts.find((f) => f.id === o.rule.added);
  expect(you).toMatchObject({ kind: 'you', always: true, text: 'Always run the tests before you say a change is done.', from: 'written by you in the hub' });
  const proj = o.end.parts[1].facts;
  expect(proj.find((f) => f.id === o.fact.added)).toMatchObject({ kind: 'mistake', always: false, trust: 0 });
  // "about you" is not a kind a project fact can have: it is a note there
  expect(proj.find((f) => f.id === o.youKind.added).kind).toBe('project');
  expect([o.again.status, o.again.error]).toEqual([400, 'saved already']);
  expect([o.short.status, o.short.error]).toEqual([400, 'too short to mean anything']);
  expect([o.secret.status, o.secret.error]).toEqual([400, 'looks like a key or a password']);
  expect([o.nowhere.status, o.nowhere.error]).toEqual([400, 'which memory?']);
  expect(o.made.status).toBe(200);
  expect(o.asRule.always).toBe(true);
  expect(o.back.status).toBe(200);
  expect(o.missing.status).toBe(404);
  const log = o.end.log.filter((l) => [o.rule.added, o.fact.added].includes(l.id)).map((l) => `${l.where} ${l.what}${l.why ? ` ${l.why}` : ''}`);
  expect(log).toEqual(expect.arrayContaining(['you add by hand', 'project add by hand', 'project always', 'project sometimes']));
  // the page has the way in, and the words for the new lines of the log
  expect(o.page).toContain('+ New memory');
  expect(o.page).toContain("always: 'made a rule'");
});
