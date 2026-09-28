// The hub server (src/app/weights.mjs): the hub and weights pages, the
// model's bytes by range, and the DOCS folder's pages read live.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWeightsServer, listDocs, HUB_PORT } from '../src/app/weights.mjs';

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
    const hub = await (await fetch(s.url)).text(); for (const t of ['<title>Agentic Coder Hub</title>', 'data-tab="harness"', 'data-tab="structure"', 'data-tab="tests"', 'data-tab="docs"', "fetch('/docs.json')"]) expect(hub).toContain(t);
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
    for (const bad of ['docs/../secret.html', 'docs/%2E%2E/secret.html', 'docs/diagrams/../../secret.html', 'docs/README.txt', 'docs/missing.html', 'docs/diagrams', 'docs/diagrams/', 'docs/a/b/c.html']) expect((await fetch(s.url + bad)).status).toBe(404);
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
  expect(out.empty).toEqual({ saved: null });
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

test('the Tests tab: the page is built in, and /tests.json is the test record read live, newest first', async () => {
  const { dir, path } = standIn();
  const was = (process.env.AGENTIC_TEST_RECORD ?? process.env.BONSAI_TEST_RECORD);
  process.env.AGENTIC_TEST_RECORD = join(dir, 'tests', 'record.jsonl');
  const s = startWeightsServer({ path, docsDir: null, port: 0 });
  try {
    const page = await fetch(s.url + 'tests'); expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text(); for (const t of ['<title>Agentic Coder test record</title>', '<meta charset="utf-8">', "fetch('/tests.json'", '<!--DATA-->']) expect(html).toContain(t);
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
