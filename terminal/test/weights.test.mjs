// The hub server (src/app/weights.mjs): the hub and weights pages, the
// model's bytes by range, and the DOCS folder's pages read live.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWeightsServer, listDocs, findDocsDir, HUB_PORT } from '../src/app/weights.mjs';
import { findPrivateDir } from '../src/app/docs-dir.mjs';

function standIn() {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-weights-'));
  const path = join(dir, 'stand-in.gguf');
  const bytes = new Uint8Array(1000); for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
  writeFileSync(path, bytes);
  return { dir, path };
}

test('the pages, the model facts and exact byte ranges come back; bad ranges are refused', async () => {
  const { path } = standIn();
  const s = startWeightsServer({ path, docsDir: null });
  try {
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const hub = await (await fetch(s.url)).text(); for (const t of ['<title>Agentic Coder Hub</title>', 'data-tab="harness"', 'data-tab="structure"', 'data-tab="arena"', 'data-tab="docs"', "fetch('/docs.json')"]) expect(hub).toContain(t);
    const page = await fetch(s.url + 'weights'); expect(page.headers.get('content-type')).toContain('text/html'); const html = await page.text();
    for (const t of ['<title>Agentic Coder Weights</title>', '<meta charset="utf-8">', "fetch('/model.json')", 'id="core"']) expect(html).toContain(t);
    expect(await (await fetch(s.url + 'model.json')).json()).toEqual({ name: 'stand-in.gguf', size: 1000 });
    const r = await fetch(s.url + 'model', { headers: { Range: 'bytes=250-259' } });
    expect(r.status).toBe(206); expect(r.headers.get('content-range')).toBe('bytes 250-259/1000');
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([250, 251, 252, 253, 254, 255, 0, 1, 2, 3]);
    const tail = await fetch(s.url + 'model', { headers: { Range: 'bytes=990-5000' } }); // clipped to the end
    expect(tail.status).toBe(206); expect((await tail.arrayBuffer()).byteLength).toBe(10);
    expect((await fetch(s.url + 'model')).status).toBe(416); // whole-file reads are not offered
    expect((await fetch(s.url + 'model', { headers: { Range: 'bytes=2000-2100' } })).status).toBe(416);
    expect((await fetch(s.url + 'nope')).status).toBe(404);
    // the tab icon every page asks for: a 48 × 48 PNG of the bot, not a 404 the browser logs as an error
    const icon = await fetch(s.url + 'favicon.ico');
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toBe('image/png');
    const bytes = Buffer.from(await icon.arrayBuffer());
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([48, 48]);
    // no DOCS folder: the list says so, a page is 404
    expect((await (await fetch(s.url + 'docs.json')).json()).missing).toBe(true);
    expect((await fetch(s.url + 'docs/anything.html')).status).toBe(404);
  } finally { s.stop(); }
});

test('the DOCS folder: groups from its subfolders, every page newest first with its title, the newest harness and structure pinned (never an older version), files served live, nothing outside the folder', async () => {
  const { path, dir } = standIn();
  const docs = join(dir, 'agentic-coder DOCS'); mkdirSync(docs);
  for (const g of ['diagrams', 'tests', 'older versions', 'other']) mkdirSync(join(docs, g));
  const t0 = Date.now() - 100000;
  const put = (name, text, age) => { writeFileSync(join(docs, name), text); const t = new Date(t0 - age * 1000); require('node:fs').utimesSync(join(docs, name), t, t); };
  put('older versions/agentic-coder-structure-v1.html', '<!doctype html><title>Structure v1</title><p>old', 30);
  put('diagrams/agentic-coder-structure-v2.html', '<!doctype html><title>Structure v2</title><p>new', 10);
  put('diagrams/agentic-coder-harness-flow-v2.html', '<!doctype html><html><head><meta charset="utf-8"><title>The harness</title></head><body>flow</body></html>', 20);
  put('older versions/agentic-coder-harness-flow.html', '<!doctype html><title>Harness v1</title>', 2); // newer by date, but an older version never pins
  put('tests/agentic-coder-report.html', '<!doctype html><title>A report</title>', 5);
  put('other/notes.pdf', '%PDF-1.4 stand-in', 40);
  put('agentic-coder-loose.html', '<!doctype html><title>Not filed yet</title>', 8);
  put('.DS_Store', 'x', 1); put('README.txt', 'not a page', 1);
  mkdirSync(join(docs, 'memory-about-you')); put('memory-about-you/index.md', '# the memory, not a page', 1);
  writeFileSync(join(dir, 'secret.html'), '<title>outside</title>');
  const l = listDocs(docs);
  expect(l.groups).toEqual(['unsorted', 'diagrams', 'tests', 'other', 'older versions']);
  expect(l.pages.map((p) => p.file)).toEqual(['older versions/agentic-coder-harness-flow.html', 'tests/agentic-coder-report.html', 'agentic-coder-loose.html', 'diagrams/agentic-coder-structure-v2.html', 'diagrams/agentic-coder-harness-flow-v2.html', 'older versions/agentic-coder-structure-v1.html', 'other/notes.pdf']);
  expect(l.pages[2]).toMatchObject({ group: 'unsorted', name: 'agentic-coder-loose.html', title: 'Not filed yet' });
  expect(l.pages[4]).toMatchObject({ group: 'diagrams', title: 'The harness', kind: 'page' }); expect(l.pages[6]).toMatchObject({ group: 'other', title: '', kind: 'PDF' });
  expect(l.pinned.harness.file).toBe('diagrams/agentic-coder-harness-flow-v2.html'); expect(l.pinned.structure.file).toBe('diagrams/agentic-coder-structure-v2.html');
  const s = startWeightsServer({ path, docsDir: docs });
  try {
    expect((await (await fetch(s.url + 'docs.json')).json()).pages.length).toBe(7);
    const p = await fetch(s.url + 'docs/diagrams/agentic-coder-harness-flow-v2.html'); expect(p.status).toBe(200); expect(p.headers.get('content-type')).toContain('text/html'); expect(await p.text()).toContain('flow');
    expect((await fetch(s.url + 'docs/agentic-coder-loose.html')).status).toBe(200);
    expect((await fetch(s.url + 'docs/other/notes.pdf')).headers.get('content-type')).toBe('application/pdf');
    for (const bad of ['docs/memory-about-you/index.md', 'docs/../secret.html', 'docs/%2E%2E/secret.html', 'docs/diagrams/../../secret.html', 'docs/README.txt', 'docs/missing.html', 'docs/diagrams', 'docs/diagrams/', 'docs/a/b/c.html']) expect((await fetch(s.url + bad)).status).toBe(404);
    // a page saved after the start shows on the next list, in its group
    put('tests/agentic-coder-new.html', '<title>Brand new</title>', 0);
    expect((await (await fetch(s.url + 'docs.json')).json()).pages[0]).toMatchObject({ title: 'Brand new', group: 'tests' });
  } finally { s.stop(); }
});

test('the hub keeps its usual address when it is free, and a second hub on the same address falls back to another free one', async () => {
  const { path } = standIn();
  const a = startWeightsServer({ path, docsDir: null, port: 0 });
  const b = startWeightsServer({ path, docsDir: null, port: a.port }); // taken
  try {
    expect(b.port).not.toBe(a.port);
    for (const s of [a, b]) expect((await fetch(s.url + 'model.json')).status).toBe(200);
  } finally { a.stop(); b.stop(); }
});

test('a test never takes the real hub\'s port 8757; a normal start does, and AGENTIC_HUB_PORT=0 means any free port', () => {
  expect(HUB_PORT).toBe(0); // test-env.mjs, before every test file
  const s = startWeightsServer({ path: null, docsDir: null });
  try { expect(s.port).not.toBe(8757); } finally { s.stop(); }
  const portWith = (v) => {
    const env = { ...process.env }; delete env.AGENTIC_HUB_PORT; if (v !== undefined) env.AGENTIC_HUB_PORT = v;
    const r = Bun.spawnSync([process.execPath, '-e', `const { HUB_PORT } = await import(${JSON.stringify(join(import.meta.dir, '..', 'src', 'app', 'weights.mjs'))}); console.log(HUB_PORT);`], { env });
    return Number(r.stdout.toString().trim());
  };
  expect([portWith(undefined), portWith('0'), portWith('9001'), portWith('nope'), portWith('')]).toEqual([8757, 0, 9001, 8757, 8757]);
});

// The editing endpoints write a manifest and a copy under AGENTIC_HOME, so
// they run in their own process with their own temp home (as warmup.test does).
test('edits: save builds the copy + manifest and tells the app; a bad edit changes nothing; revert removes both', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-edits-'));
  const script = `
    import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
    import { join } from 'node:path';
    const { tinyModel } = await import(${JSON.stringify(join(import.meta.dir, 'tiny-gguf.mjs'))});
    const { MODELS_DIR, MODELS, DEFAULT_MODEL, modelPath, readEdited } = await import(${JSON.stringify(join(import.meta.dir, '..', '..', 'models', 'index.mjs'))});
    const { startWeightsServer } = await import(${JSON.stringify(join(import.meta.dir, '..', 'src', 'app', 'weights.mjs'))});
    mkdirSync(MODELS_DIR, { recursive: true });
    const path = modelPath(MODELS[DEFAULT_MODEL]); // the endpoints edit the model the hub serves
    writeFileSync(path, tinyModel());
    const told = [];
    const s = startWeightsServer({ path, docsDir: null, port: 0, onEdits: (e) => told.push(e.kind) });
    const out = {};
    out.empty = await (await fetch(s.url + 'edits.json')).json();
    const save = await fetch(s.url + 'edits/save', { method: 'POST', body: JSON.stringify({ edits: [{ op: 'scale', tensor: 'blk.0.ffn_up.weight', row: 3, k: 0.5 }] }) });
    out.save = await save.json(); out.saveStatus = save.status;
    out.manifest = readEdited();
    out.copyThere = existsSync(join(MODELS_DIR, out.manifest.file));
    const bad = await fetch(s.url + 'edits/save', { method: 'POST', body: JSON.stringify({ edits: [{ op: 'scale', tensor: 'nope', row: 0, k: 2 }] }) });
    out.bad = await bad.json(); out.badStatus = bad.status;
    out.manifestAfterBad = readEdited(); // still the good save
    const revert = await fetch(s.url + 'edits/revert', { method: 'POST' });
    out.revertStatus = revert.status;
    out.after = { manifest: readEdited(), copyThere: existsSync(join(MODELS_DIR, out.manifest.file)), originalIntact: readFileSync(path).length > 0 };
    out.told = told;
    s.stop();
    console.log(JSON.stringify(out));
  `;
  const r = require('node:child_process').spawnSync('bun', ['-e', script], { env: { ...process.env, AGENTIC_HOME: home }, encoding: 'utf8', timeout: 30000 });
  const out = JSON.parse(r.stdout.trim().split('\n').pop() || (() => { throw new Error(r.stderr); })());
  expect(out.empty).toEqual({ saved: null, all: {} });
  expect(out.saveStatus).toBe(200);
  expect(out.save.ok).toBe(true);
  expect(out.save.rowsChanged).toBe(1);
  expect(out.manifest.edits).toHaveLength(1);
  expect(out.manifest.file).toContain('-edited.gguf');
  expect(out.copyThere).toBe(true);
  expect(out.badStatus).toBe(400);
  expect(out.bad.error).toContain('no tensor named nope');
  expect(out.manifestAfterBad.saved).toBe(out.manifest.saved);
  expect(out.revertStatus).toBe(200);
  expect(out.after).toEqual({ manifest: null, copyThere: false, originalIntact: true });
  expect(out.told).toEqual(['save', 'revert']);
});

test('the test record: the page is built in (the Arena shows it), and /tests.json is the record read live, newest first', async () => {
  const { dir, path } = standIn();
  const was = process.env.AGENTIC_TEST_RECORD;
  process.env.AGENTIC_TEST_RECORD = join(dir, 'tests', 'record.jsonl');
  const s = startWeightsServer({ path, docsDir: null, port: 0 });
  try {
    const page = await fetch(s.url + 'tests'); expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text(); for (const t of ['<title>Agentic Coder test record</title>', '<meta charset="utf-8">', "fetch('/tests.json'", '<!--DATA-->', 'id="models"', 'Not model-specific']) expect(html).toContain(t);
    expect((await (await fetch(s.url + 'tests.json')).json()).rows).toEqual([]); // nothing recorded yet
    const { recordTest } = await import('../../models/index.mjs');
    recordTest({ kind: 'tasks', name: 'The 28 practice tasks', at: '2026-09-25T21:09:27.000Z', code: 'abc1234', passed: 28, total: 28, secs: 1974 }, { snapshot: false, quiet: true });
    recordTest({ kind: 'bug', name: 'The chart bug', at: '2026-09-26T22:57:43.000Z', code: 'def5678', effort: 'high', passed: 0, total: 1, secs: 1500, page: 'tests/a page.html' }, { snapshot: false, quiet: true });
    const d = await (await fetch(s.url + 'tests.json')).json();
    expect(d.rows.map((r) => [r.kind, r.result, r.passed, r.total])).toEqual([['bug', 'fail', 0, 1], ['tasks', 'pass', 28, 28]]);
    expect(d.rows[0].page).toBe('tests/a page.html');
    expect(d.kinds.tasks[0]).toBe('Practice tasks');
  } finally { s.stop(); if (was == null) delete process.env.AGENTIC_TEST_RECORD; else process.env.AGENTIC_TEST_RECORD = was; }
});

test('the Arena tab: /arena starts the runner when it is not up and sends the tab to its page with the hub\'s address; ?new=1 opens its New test window; the hub lists the tab', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-battle-hub-'));
  const port = 21000 + Math.floor(Math.random() * 20000);
  const script = `
    const { startWeightsServer } = await import(${JSON.stringify(join(import.meta.dir, '..', 'src', 'app', 'weights.mjs'))});
    const s = startWeightsServer({ path: null, docsDir: null, port: 0 });
    const out = {};
    const r = await fetch(s.url + 'arena', { redirect: 'manual' });
    out.hubAt = s.url.slice(0, -1);
    out.status = r.status; out.location = r.headers.get('location');
    out.page = await (await fetch(out.location)).text();
    out.again = (await fetch(s.url + 'battle', { redirect: 'manual' })).status; // already up: no second runner (and its old name still works)
    out.fresh = (await fetch(s.url + 'arena?new=1', { redirect: 'manual' })).headers.get('location'); // the New test window
    out.hub = await (await fetch(s.url)).text();
    s.stop();
    console.log(JSON.stringify(out));
  `;
  const env = { ...process.env, AGENTIC_HOME: home, AGENTIC_BATTLE_PORT: String(port), AGENTIC_BATTLE_FAKE: '1', AGENTIC_NO_OPEN: '1' };
  const r = require('node:child_process').spawnSync('bun', ['-e', script], { env, encoding: 'utf8', timeout: 30000 });
  const pid = Number(require('node:fs').readFileSync(join(home, 'battle', 'runner.pid'), 'utf8'));
  try { process.kill(pid, 'SIGTERM'); } catch {}
  const out = JSON.parse(r.stdout.trim().split('\n').pop() || (() => { throw new Error(r.stderr); })());
  expect(out.status).toBe(302);
  expect(out.location).toBe(`http://127.0.0.1:${port}/?hub=${encodeURIComponent(out.hubAt)}`);
  expect(out.page).toContain('<title>Arena</title>');
  expect(out.again).toBe(302);
  expect(out.hub).toContain('<button data-tab="arena">Arena</button>');
  expect(out.fresh).toBe(`http://127.0.0.1:${port}/?hub=${encodeURIComponent(out.hubAt)}&new=1`);
  expect(out.hub).toContain("return show(`/arena${a ? `?${a}` : ''}`");
});

test('the DOCS folder is the repo\'s docs/, from a worktree the main folder\'s, and the design cards are in its private/', () => {
  const was = { docs: process.env.AGENTIC_DOCS, repo: process.env.AGENTIC_REPO };
  try {
    delete process.env.AGENTIC_DOCS;
    const repo = mkdtempSync(join(tmpdir(), 'agentic-docsdir-'));
    process.env.AGENTIC_REPO = repo;
    mkdirSync(join(repo, 'cli docs')); // the old name is not looked for any more
    expect(findDocsDir()).not.toBe(join(repo, 'cli docs'));
    mkdirSync(join(repo, 'docs'));
    expect(findDocsDir()).toBe(join(repo, 'docs'));
    expect(findPrivateDir()).toBe(null); // a fresh clone has no private/
    mkdirSync(join(repo, 'docs', 'private'));
    expect(findPrivateDir()).toBe(join(repo, 'docs', 'private'));
    // a worktree of it: its .git is a file naming <main>/.git/worktrees/<name>
    mkdirSync(join(repo, '.git', 'worktrees', 'w'), { recursive: true });
    const tree = mkdtempSync(join(tmpdir(), 'agentic-docsdir-tree-'));
    mkdirSync(join(tree, 'docs'));
    writeFileSync(join(tree, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'w')}\n`);
    process.env.AGENTIC_REPO = tree;
    expect(findDocsDir()).toBe(join(repo, 'docs'));
  } finally { for (const [k, v] of [['AGENTIC_DOCS', was.docs], ['AGENTIC_REPO', was.repo]]) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
});

test('the /docs pages: the index and the tools are no pages, private/ keeps its memory to itself, and a page moved to older versions still opens from its old link', async () => {
  const docs = mkdtempSync(join(tmpdir(), 'agentic-docs-served-'));
  const put = (f, text) => { mkdirSync(join(docs, f, '..'), { recursive: true }); writeFileSync(join(docs, f), text); };
  put('README.md', '# index'); put('tools/sync-docs.mjs', '// tool'); put('tests/new-run.html', '<title>New run</title>');
  put('older versions/old-run.html', '<title>Old run</title>'); put('private/memory-about-you/index.md', '# private'); put('private/mine.html', '<title>Mine</title>');
  const s = startWeightsServer({ path: null, docsDir: docs, port: 0, cwd: docs });
  try {
    const base = s.url.replace(/\/$/, '');
    const list = await (await fetch(`${base}/docs.json`)).json();
    expect(list.pages.map((p) => p.file).sort()).toEqual(['older versions/old-run.html', 'private/mine.html', 'tests/new-run.html']);
    expect(await (await fetch(`${base}/docs/tests/old-run.html`)).text()).toContain('Old run'); // its test-record link, from before the move
    expect((await fetch(`${base}/docs/tests/nowhere.html`)).status).toBe(404);
    expect((await fetch(`${base}/docs/private/memory-about-you/index.md`)).status).toBe(404);
    expect((await fetch(`${base}/docs/tools/sync-docs.mjs`)).status).toBe(404);
  } finally { s.stop(); }
});

// Every model in /model is served under its own name, with the Harness tab's tags, and each
// keeps its own edited copy. In its own process with its own temp home (the copies are written there).
test('every model: /models.json lists each with its tags, /model/<id> gives that file\'s bytes, and each model has its own edited copy', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-models-'));
  const script = `
    import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
    import { join } from 'node:path';
    const { tinyModel, tinyBlockModel } = await import(${JSON.stringify(join(import.meta.dir, 'tiny-gguf.mjs'))});
    const { MODELS_DIR, MODELS, modelPath, readEdited, readEditedAll, editedModels, modelById } = await import(${JSON.stringify(join(import.meta.dir, '..', '..', 'models', 'index.mjs'))});
    const { startWeightsServer } = await import(${JSON.stringify(join(import.meta.dir, '..', 'src', 'app', 'weights.mjs'))});
    const { saveSettings } = await import(${JSON.stringify(join(import.meta.dir, '..', 'src', 'app', 'store.mjs'))});
    mkdirSync(MODELS_DIR, { recursive: true });
    const out = {}; const told = [];
    const s = startWeightsServer({ path: modelPath(MODELS.k2), docsDir: null, port: 0, cwd: ${JSON.stringify(home)}, onEdits: (e) => told.push([e.kind, e.saved?.base ?? e.base]) });
    const get = async (p, init) => { const r = await fetch(s.url + p, init); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };
    out.none = (await get('models.json')).body;
    writeFileSync(modelPath(MODELS.k2), tinyModel()); // only the second model's file arrives
    saveSettings({ model: 'k2-edited' }); // what /model saves when its edited copy is picked
    out.one = (await get('models.json')).body;
    writeFileSync(modelPath(MODELS.qwen), tinyBlockModel());
    out.both = (await get('models.json')).body;
    out.bytes = [await get('model/qwen', { headers: { Range: 'bytes=0-3' } }), await get('model/k2', { headers: { Range: 'bytes=0-3' } }), await get('model/qwen'), await get('model/nope', { headers: { Range: 'bytes=0-3' } })].map((r) => [r.status, r.status === 206 ? r.body : '']);
    const post = (p, body) => get(p, { method: 'POST', body: JSON.stringify(body) });
    out.saveQ = await post('edits/save', { model: 'qwen', edits: [{ op: 'scale', tensor: 'blk.0.q5_k.weight', row: 2, k: 0.5 }] });
    out.saveK = await post('edits/save', { model: 'k2', edits: [{ op: 'scale', tensor: 'blk.0.ffn_up.weight', row: 1, k: 2 }, { op: 'swap', tensor: 'token_embd.weight', a: 0, b: 1 }] });
    out.wrongModel = await post('edits/save', { model: 'k2', edits: [{ op: 'scale', tensor: 'blk.0.q5_k.weight', row: 2, k: 0.5 }] }); // Qwen's matrix, asked of K2 Horizon
    out.noSuch = await post('edits/save', { model: 'llama', edits: [] });
    out.all = readEditedAll(); out.files = readdirSync(MODELS_DIR).sort();
    out.listed = editedModels().map((m) => [m.id, m.name, m.edited.base, m.edited.edits.length]);
    out.byId = [modelById('qwen-edited')?.file, modelById('k2-edited')?.file, modelById('nope-edited')];
    out.json = (await get('edits.json')).body;
    out.tagged = (await get('models.json')).body.models.map((m) => [m.id, m.edited?.edits.length ?? 0]);
    out.revert = (await post('edits/revert', { model: 'qwen' })).status;
    out.after = { all: Object.keys(readEditedAll()), files: readdirSync(MODELS_DIR).sort(), k2CopyIntact: readFileSync(join(MODELS_DIR, out.all.k2.file)).length > 0 };
    out.told = told; s.stop();
    console.log(JSON.stringify(out));
  `;
  const r = require('node:child_process').spawnSync('bun', ['-e', script], { env: { ...process.env, AGENTIC_HOME: home }, encoding: 'utf8', timeout: 30000 });
  const out = JSON.parse(r.stdout.trim().split('\n').pop() || (() => { throw new Error(r.stderr); })());
  const K2 = 'K2-Horizon-7B-Q5_K_M', Q = 'Qwen3.5-9B-MTP-UD-Q5_K_XL';
  // no file yet: both are listed (Qwen and K2 Horizon since Gemma and Bonsai left on 9 Oct 2026), both "not on this Mac", and the default is the one in use
  expect(out.none.inUse).toBe('qwen');
  expect(out.none.models.map((m) => [m.id, m.name, m.missing, m.size, m.tags])).toEqual([['qwen', 'Qwen3.5 9B', true, 0, ['default', 'in use now', 'not on this Mac']], ['k2', 'K2 Horizon 7B', true, 0, ['not on this Mac']]]);
  // the model /model saved last is the one in use, its edited copy counted as the model itself
  expect(out.one.inUse).toBe('k2');
  expect(out.one.models.map((m) => [m.id, m.missing, m.tags])).toEqual([['qwen', true, ['default', 'not on this Mac']], ['k2', false, ['in use now']]]);
  expect(out.both.models.map((m) => [m.id, m.missing, m.size > 0, m.by.length > 0, m.file])).toEqual([['qwen', false, true, true, `${Q}.gguf`], ['k2', false, true, true, `${K2}.gguf`]]);
  expect(out.bytes).toEqual([[206, 'GGUF'], [206, 'GGUF'], [416, ''], [404, '']]);
  // each model's copy is its own file with its own manifest, built from that model's original
  expect([out.saveQ.status, out.saveQ.body.saved.base, out.saveQ.body.saved.file, out.saveQ.body.rowsChanged]).toEqual([200, 'qwen', `${Q}-edited.gguf`, 1]);
  expect([out.saveK.status, out.saveK.body.saved.base, out.saveK.body.saved.file, out.saveK.body.rowsChanged]).toEqual([200, 'k2', `${K2}-edited.gguf`, 3]);
  expect([out.wrongModel.status, out.wrongModel.body.error]).toEqual([400, 'no tensor named blk.0.q5_k.weight']);
  expect([out.noSuch.status, out.noSuch.body.error]).toEqual([404, 'no model called llama in /model']);
  expect(Object.keys(out.all)).toEqual(['qwen', 'k2']); expect(out.all.k2.edits).toHaveLength(2); expect(out.all.qwen.edits).toHaveLength(1);
  expect(out.files).toEqual([`${Q}-edited.gguf`, `${Q}.gguf`, 'edited-k2.json', 'edited-qwen.json', `${K2}-edited.gguf`, `${K2}.gguf`].sort());
  expect(out.listed).toEqual([['qwen-edited', 'Qwen3.5 9B · edited', 'qwen', 1], ['k2-edited', 'K2 Horizon 7B · edited', 'k2', 2]]);
  expect(out.byId).toEqual([`${Q}-edited.gguf`, `${K2}-edited.gguf`, null]);
  expect(out.json.saved.base).toBe('qwen'); expect(Object.keys(out.json.all)).toEqual(['qwen', 'k2']); // saved: the default model's copy
  expect(out.tagged).toEqual([['qwen', 1], ['k2', 2]]);
  // removing one model's copy leaves the other's
  expect(out.revert).toBe(200);
  expect(out.after).toEqual({ all: ['k2'], files: [`${Q}.gguf`, 'edited-k2.json', `${K2}-edited.gguf`, `${K2}.gguf`].sort(), k2CopyIntact: true });
  expect(out.told).toEqual([['save', 'qwen'], ['save', 'k2'], ['revert', 'qwen']]);
});
