// The hub server (src/app/weights.mjs): the hub and weights pages, the
// model's bytes by range, and the DOCS folder's pages read live.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWeightsServer, listDocs } from '../src/app/weights.mjs';

function standIn() {
  const dir = mkdtempSync(join(tmpdir(), 'bonsai-weights-'));
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
    const hub = await (await fetch(s.url)).text(); for (const t of ['<title>Bonsai Hub</title>', 'data-tab="harness"', 'data-tab="structure"', 'data-tab="docs"', "fetch('/docs.json')"]) expect(hub).toContain(t);
    const page = await fetch(s.url + 'weights'); expect(page.headers.get('content-type')).toContain('text/html'); const html = await page.text();
    for (const t of ['<title>Bonsai Weights</title>', '<meta charset="utf-8">', "fetch('/model.json')", 'id="core"']) expect(html).toContain(t);
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
  const docs = join(dir, 'bonsai-code DOCS'); mkdirSync(docs);
  for (const g of ['diagrams', 'tests', 'older versions', 'other']) mkdirSync(join(docs, g));
  const t0 = Date.now() - 100000;
  const put = (name, text, age) => { writeFileSync(join(docs, name), text); const t = new Date(t0 - age * 1000); require('node:fs').utimesSync(join(docs, name), t, t); };
  put('older versions/bonsai-code-structure-v1.html', '<!doctype html><title>Structure v1</title><p>old', 30);
  put('diagrams/bonsai-code-structure-v2.html', '<!doctype html><title>Structure v2</title><p>new', 10);
  put('diagrams/bonsai-harness-flow-v2.html', '<!doctype html><html><head><meta charset="utf-8"><title>The harness</title></head><body>flow</body></html>', 20);
  put('older versions/bonsai-harness-flow.html', '<!doctype html><title>Harness v1</title>', 2); // newer by date, but an older version never pins
  put('tests/bonsai-report.html', '<!doctype html><title>A report</title>', 5);
  put('other/notes.pdf', '%PDF-1.4 stand-in', 40);
  put('bonsai-loose.html', '<!doctype html><title>Not filed yet</title>', 8);
  put('.DS_Store', 'x', 1); put('README.txt', 'not a page', 1);
  writeFileSync(join(dir, 'secret.html'), '<title>outside</title>');
  const l = listDocs(docs);
  expect(l.groups).toEqual(['unsorted', 'diagrams', 'tests', 'other', 'older versions']);
  expect(l.pages.map((p) => p.file)).toEqual(['older versions/bonsai-harness-flow.html', 'tests/bonsai-report.html', 'bonsai-loose.html', 'diagrams/bonsai-code-structure-v2.html', 'diagrams/bonsai-harness-flow-v2.html', 'older versions/bonsai-code-structure-v1.html', 'other/notes.pdf']);
  expect(l.pages[2]).toMatchObject({ group: 'unsorted', name: 'bonsai-loose.html', title: 'Not filed yet' });
  expect(l.pages[4]).toMatchObject({ group: 'diagrams', title: 'The harness', kind: 'page' }); expect(l.pages[6]).toMatchObject({ group: 'other', title: '', kind: 'PDF' });
  expect(l.pinned.harness.file).toBe('diagrams/bonsai-harness-flow-v2.html'); expect(l.pinned.structure.file).toBe('diagrams/bonsai-code-structure-v2.html');
  const s = startWeightsServer({ path, docsDir: docs });
  try {
    expect((await (await fetch(s.url + 'docs.json')).json()).pages.length).toBe(7);
    const p = await fetch(s.url + 'docs/diagrams/bonsai-harness-flow-v2.html'); expect(p.status).toBe(200); expect(p.headers.get('content-type')).toContain('text/html'); expect(await p.text()).toContain('flow');
    expect((await fetch(s.url + 'docs/bonsai-loose.html')).status).toBe(200);
    expect((await fetch(s.url + 'docs/other/notes.pdf')).headers.get('content-type')).toBe('application/pdf');
    for (const bad of ['docs/../secret.html', 'docs/%2E%2E/secret.html', 'docs/diagrams/../../secret.html', 'docs/README.txt', 'docs/missing.html', 'docs/diagrams', 'docs/diagrams/', 'docs/a/b/c.html']) expect((await fetch(s.url + bad)).status).toBe(404);
    // a page saved after the start shows on the next list, in its group
    put('tests/bonsai-new.html', '<title>Brand new</title>', 0);
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
