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
  const base = mkdtempSync(join(tmpdir(), 'bonsai-memhub-'));
  const repo = join(base, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  const src = (p) => JSON.stringify(join(import.meta.dir, '..', p));
  const script = `
    const { startWeightsServer } = await import(${src('src/app/weights.mjs')});
    const { memoryDirs, applyChanges, readFacts, openMemory, changeTrust } = await import(${src('src/agent/facts.mjs')});
    const repo = ${JSON.stringify(repo)};
    const dirs = memoryDirs(repo);
    openMemory(repo);
    const [a, b] = applyChanges(dirs.project, { add: [{ kind: 'project', text: 'Run the tests with bun run test.' }, { kind: 'recipe', text: 'Add a page about Bonsai.', steps: ['build it', 'save it in DOCS'] }] }, { batch: 'earlier' }).added;
    changeTrust(dirs.project, [a.id], +1, 'the task passed its check');
    const s = startWeightsServer({ path: null, docsDir: null, port: 0, cwd: repo });
    const get = async (p) => (await fetch(s.url.replace(/\\/$/, '') + p)).json();
    const post = async (p, body, headers = {}) => { const r = await fetch(s.url.replace(/\\/$/, '') + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
    const out = {};
    ${body}
    s.stop();
    console.log(JSON.stringify(out));
  `;
  const r = spawnSync('bun', ['-e', script], { encoding: 'utf8', env: { ...process.env, BONSAI_HOME: join(base, 'home'), BONSAI_MEMORY: join(base, 'about-you') }, timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('the page and what it reads: both memories, with trust, steps and where each fact came from', () => {
  const o = inChild(`
    out.data = await get('/memory.json');
    out.page = await (await fetch(s.url.replace(/\\/$/, '') + '/memory')).text();
    out.hub = await (await fetch(s.url)).text();
  `);
  expect(o.page).toContain('<title>Bonsai memory</title>');
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
