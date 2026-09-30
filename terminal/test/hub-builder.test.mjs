// The hub's Test builder tab (src/app/builder.html, the routes in src/app/builder-hub.mjs): the tab
// is in the hub and stands alone, its routes make, change and try tests of your own in the arena's
// folder, and only this hub's own page may call them. What the routes do, in full:
// models/test/builder.test.mjs.
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

// A throwaway home, set before the hub (and the models part) load.
const HOME = mkdtempSync(join(tmpdir(), 'agentic-hub-builder-'));
process.env.AGENTIC_HOME = HOME;
process.env.AGENTIC_BATTLE_PORT = String(20000 + Math.floor(Math.random() * 20000));
const { startWeightsServer } = await import('../src/app/weights.mjs');
const { builderRoute } = await import('../src/app/builder-hub.mjs');
const REPO = join(import.meta.dir, '..', '..');
const COMPONENTS = JSON.parse(readFileSync(join(REPO, 'models', 'evals', 'bench', 'design', 'components.json'), 'utf8'));
const CARD = COMPONENTS.find((c) => c.id === 'data-card').prompt, PLAYER = COMPONENTS.find((c) => c.id === 'media-player').prompt;
const LIST = `Prompt 1 — Data metric card\n${CARD}\n\n\nPrompt 7 — Mini media player\n${PLAYER}\n`;
// The arena folder the routes are given here (the hub's own is its home's).
const ARENA = join(mkdtempSync(join(tmpdir(), 'agentic-hub-builder-arena-')), 'battle');
let hub = null, H = '';
beforeAll(() => { hub = startWeightsServer({ path: null, docsDir: null, port: 0, cwd: HOME }); H = hub.url.replace(/\/$/, ''); });
afterAll(() => { try { hub?.stop(); } catch {} });
const post = (path, body, headers = {}) => fetch(`${H}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('the hub has a Test builder tab, after the Arena, that serves one page with nothing loaded from outside', async () => {
  const page0 = await (await fetch(`${H}/`)).text();
  expect(page0).toContain('<button data-tab="arena">Arena</button>\n  <button data-tab="builder">Test builder</button>\n  <button data-tab="memory">Memory</button>');
  expect(page0).toContain("t === 'builder'"); // opened straight from ?tab=builder, like the other built-in tabs
  const r = await fetch(`${H}/builder`);
  expect([r.status, r.headers.get('content-type')]).toEqual([200, 'text/html; charset=utf-8']);
  const page = await r.text();
  expect(page).toContain('<meta charset="utf-8">');
  expect(page).toContain('<title>Agentic Coder test builder</title>');
  expect(page).not.toMatch(/(?:src|href)="https?:/);
  expect(page).not.toMatch(/url\(\s*['"]?https?:/);
  // The page's parts: your tests by level, the paste box, the trash, the editor's buttons.
  for (const word of ['My tests', 'Paste a list', '+ New test', 'Export', 'Trash', 'Try the checks', 'Duplicate', 'Save and run ▶', 'Design folder', 'Time limit', 'By eye']) expect(page).toContain(word);
  // A button that cannot act is solid grey, with no "…" on it.
  expect(page).not.toMatch(/>[^<]*…<\/button>/);
  expect((await (await fetch(`${H}/help`)).text())).toContain("['Test builder',");
});

test('+ New in the Arena opens the Test builder, and ▶ Run in the builder opens the Arena with that test picked', async () => {
  const hubPage = await (await fetch(`${H}/`)).text();
  expect(hubPage).toContain("if (e.data?.agentic === 'new-test') { newAsk = true; open('builder'); }");
  expect(hubPage).toContain("if (e.data?.agentic === 'run-test' && typeof e.data.test === 'string')");
  expect(hubPage).toContain("show(n ? '/builder?new=1' : '/builder'");
  expect(hubPage).toContain('frame.contentWindow?.builderDirty?.()'); // it asks before leaving a test with changes not saved
  // The Arena's page is at its runner's address, not the hub's: its message is taken because it is the page in the frame.
  expect(hubPage).toContain('if (e.origin !== location.origin && e.source !== frame.contentWindow) return;');
  expect(hubPage).toContain("open('arena'); }"); // ▶ Run: the Arena, with the test picked (nothing starts by itself)
  const arena = readFileSync(join(REPO, 'models', 'evals', 'battle', 'arena.html'), 'utf8');
  expect(arena).toContain("parent.postMessage({ agentic: 'new-test' }, HUB)");
  expect(arena).toContain("if (id === 'mytest')"); // Save and run: that test of yours, by its number
  expect(arena).toContain("'mine-hard': 'mine-hard'"); // ▶ Run on a level: that level's tests, as a set
  const builder = await (await fetch(`${H}/builder`)).text();
  expect(builder).toContain("const ask = { agentic: 'run-test', test,");
  expect(builder).toContain('runIn(`mine-${el.dataset.v}`)');
  expect(builder).toContain("runIn('mytest', r.n)");
});

test('the routes through the hub: empty at first, a pasted list becomes tests, a level, a save, the checks for some words', async () => {
  const d0 = await (await fetch(`${H}/builder.json`)).json();
  expect(d0).toMatchObject({ tests: [], trash: [], battleMinutes: 10, levels: { easy: { points: 1, minutes: 5 }, medium: { points: 2, minutes: 10 }, hard: { points: 3, minutes: 20 } } });
  expect(Object.keys(d0.checks)).toEqual(expect.arrayContaining(['page-made', 'count', 'drawn', 'layout', 'tests', 'page-has']));
  expect((await (await post('/builder/read', { text: LIST })).json()).found.map((p) => [p.n, p.title, p.kind, p.fit])).toEqual([[1, 'Data metric card', 'page', 6], [7, 'Mini media player', 'page', 6]]);
  expect(await (await fetch(`${H}/builder.json`)).json()).toMatchObject({ tests: [] }); // reading a list saves nothing
  const pasted = await (await post('/builder/paste', { text: LIST })).json();
  expect([pasted.ok, pasted.added.length, pasted.skipped, pasted.data.tests.map((t) => [t.title, t.level])]).toEqual([true, 2, 0, [['Data metric card', null], ['Mini media player', null]]]);
  // They are files in the hub's own home, nowhere else.
  expect(readdirSync(join(HOME, 'battle', 'tests')).sort()).toEqual([...pasted.added].sort());
  expect(existsSync(join(homedir(), '.agentic-coder', 'battle', 'tests', pasted.added[0]))).toBe(false);
  const lv = await (await post('/builder/level', { id: pasted.added[1], level: 'hard' })).json();
  expect(lv.data.tests[1]).toMatchObject({ level: 'hard', points: 3, limit: 20 });
  expect(lv.data.tests[1].checks.map((c) => `${c.type}${c.value ? `:${c.value}` : ''}`)).toEqual(['page-made', 'scripts-valid', 'offline', 'layout', 'drawn', 'count:button>=3']);
  const saved = await (await post('/builder/save', { id: pasted.added[0], title: 'Data card', level: 'medium', kind: 'page', prompt: CARD, checks: [{ type: 'page-made', value: '' }, { type: 'layout', value: '' }], minutes: 15, design: false })).json();
  expect([saved.ok, saved.id, saved.n]).toEqual([true, pasted.added[0], 1]);
  expect(saved.data.tests[0]).toMatchObject({ title: 'Data card', level: 'medium', limit: 15, minutes: 15, design: false, points: 2, auto: false });
  expect(saved.data.points.of).toBe(5);
  // What Save refuses, in words the page shows.
  const bad = await post('/builder/save', { title: 'x', kind: 'page', prompt: 'Build an HTML page.', checks: [{ type: 'page-made' }] });
  expect([bad.status, (await bad.json()).error]).toEqual([400, 'pick a level first (Easy, Medium or Hard)']);
  const sug = await (await post('/builder/suggest', { prompt: `${CARD} Show play, skip, and like buttons too.`, kind: 'page' })).json();
  expect(sug.checks.map((c) => c.label)).toContain('The page has at least 3 buttons');
  expect(sug.eye).toContain('a title');
  // Duplicate, delete, bring back, export.
  const dup = await (await post('/builder/duplicate', { id: pasted.added[0] })).json();
  expect(dup.data.tests.map((t) => t.title)).toEqual(['Data card', 'Mini media player', 'Data card (copy)']);
  const del = await (await post('/builder/delete', { id: dup.id })).json();
  expect([del.data.tests.length, del.data.trash.map((t) => t.title)]).toEqual([2, ['Data card (copy)']]);
  const back = await (await post('/builder/restore', { name: del.data.trash[0].name })).json();
  expect([back.id, back.data.tests.length, back.data.trash]).toEqual([dup.id, 3, []]);
  const ex = await fetch(`${H}/builder/export`);
  expect(ex.headers.get('content-disposition')).toBe('attachment; filename="my-tests.json"');
  const file = await ex.json();
  expect([file.what, file.tests.length]).toEqual(['my-tests', 3]);
  expect((await (await post('/builder/import', { data: file })).json())).toMatchObject({ ok: true, added: [], skipped: 3 });
  expect((await post('/builder/nope', {})).status).toBe(404);
});

test('only this hub\'s own page may call them: no other site, nothing that is not JSON', async () => {
  for (const headers of [{ origin: 'http://evil.example' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { origin: H.replace('127.0.0.1', 'localhost') }]) {
    const r = await post('/builder/paste', { text: 'Prompt 9 — Planted\nBuild an HTML page.' }, headers);
    expect([r.status, (await r.json()).error]).toEqual([403, 'Open the Test builder tab from this local hub.']);
  }
  expect((await fetch(`${H}/builder.json`, { headers: { origin: 'http://evil.example' } })).status).toBe(403);
  expect((await fetch(`${H}/builder/export`, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
  // A plain form post (what another site's page can send without asking) is not JSON: refused.
  const form = await fetch(`${H}/builder/paste`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ text: 'Prompt 9 — Planted\nBuild an HTML page.' }) });
  expect([form.status, (await form.json()).error]).toEqual([415, 'Send JSON.']);
  expect((await fetch(`${H}/builder/paste`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' })).status).toBe(400);
  expect((await (await fetch(`${H}/builder.json`)).json()).tests.some((t) => t.title === 'Planted')).toBe(false);
  // The hub's own page (the same origin) may.
  expect((await post('/builder/read', { text: '' }, { origin: H, 'sec-fetch-site': 'same-origin' })).status).toBe(200);
});

test('Try the checks: the route runs the page checks on the page handed over, with the layout check it is given, and says which hold', async () => {
  const req = (path, body) => new Request(`http://127.0.0.1:9/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const call = async (path, body, check) => { const r = await builderRoute(req(path, body), new URL(`http://127.0.0.1:9/${path}`), { home: ARENA, check }); return [r.status, await r.json()]; };
  const [, pasted] = await call('builder/paste', { text: LIST });
  const id = pasted.added[0];
  const checks = [{ type: 'page-made', value: '' }, { type: 'scripts-valid', value: '' }, { type: 'layout', value: '' }, { type: 'count', value: 'button>=2' }, { type: 'tests', value: '' }];
  const seen = [];
  const check = async (file) => { seen.push(file); return { problems: ['Text is too faint to read at 1440×900: "↑ 12.5%" is #10b981 on #ffffff (2.5:1; needs 4.5:1).'] }; };
  // No page yet, and none handed over.
  expect(await call('builder/try', { id, checks, prompt: CARD }, check)).toEqual([200, { page: null, results: [], pass: null }]);
  const [status, r] = await call('builder/try', { id, checks, prompt: CARD, page: { name: 'data-card.html', html: '<!doctype html><meta charset="utf-8"><div>42 <b>+12%</b></div><button>Open</button>' } }, check);
  expect([status, r.page.name, r.page.given, r.pass, seen.length]).toEqual([200, 'data-card.html', true, false, 1]);
  expect(r.results.map((x) => [x.label, x.pass])).toEqual([['A page was made', true], ['Its scripts are valid', false], ['The layout is clean', false], ['The page has at least 2 buttons', false], ['The tests pass', null]]);
  expect(r.results[2]).toMatchObject({ why: expect.stringContaining('1 problem: Text is too faint'), problems: [expect.stringContaining('2.5:1; needs 4.5:1')] });
  expect(r.results[3].why).toBe('it has 1');
  // Nothing of the try is left in the arena's folder.
  expect(readdirSync(ARENA).sort()).toEqual(['tests']);
  // The route is closed to the wrong address too (a rebinding name).
  const other = await builderRoute(new Request('http://hub.example:9/builder.json'), new URL('http://hub.example:9/builder.json'), { home: ARENA });
  expect(other.status).toBe(403);
});
