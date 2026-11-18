// The model download of `coding setup` (models/runtime/setup.mjs download, 18 Nov 2026): written through a
// pipeline (an error is a plain reason, never a crash), stopped when nothing comes for a while, carried on from
// the .part a cut left (a Range request), started again when the server sends the whole file. A stand-in server
// on a free port of this Mac plays the download site.
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { download } from '../runtime/setup.mjs';

const DATA = randomBytes(200_000);
const ranges = [];
let server = null;
let base = '';
beforeAll(() => {
  server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const range = req.headers.get('range');
      if (url.pathname === '/file') {
        ranges.push(range);
        const m = /^bytes=(\d+)-$/.exec(range ?? '');
        if (m && Number(m[1]) >= DATA.length) return new Response(null, { status: 416 });
        if (m) return new Response(DATA.subarray(Number(m[1])), { status: 206, headers: { 'content-length': String(DATA.length - Number(m[1])) } });
        return new Response(DATA, { headers: { 'content-length': String(DATA.length) } });
      }
      // a server that takes no notice of a range: the whole file each time
      if (url.pathname === '/whole') return new Response(DATA, { headers: { 'content-length': String(DATA.length) } });
      // the first 1,000 bytes, then nothing more, for ever
      if (url.pathname === '/stall') return new Response(new ReadableStream({ start(c) { c.enqueue(DATA.subarray(0, 1000)); } }), { headers: { 'content-length': String(DATA.length) } });
      return new Response('no', { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server?.stop(true));

const dir = () => mkdtempSync(join(tmpdir(), 'agentic-download-'));
const quiet = () => {};

test('a download is written whole, with no .part left', async () => {
  const file = join(dir(), 'model.gguf');
  await download(`${base}/file`, file, quiet);
  expect(readFileSync(file).equals(DATA)).toBe(true);
  expect(existsSync(`${file}.part`)).toBe(false);
});

test('a .part a cut left is carried on with a Range request; a server that sends the whole file starts it again', async () => {
  const file = join(dir(), 'model.gguf');
  writeFileSync(`${file}.part`, DATA.subarray(0, 50_000));
  const said = [];
  ranges.length = 0;
  await download(`${base}/file`, file, (t) => said.push(t));
  expect(ranges).toEqual(['bytes=50000-']);
  expect(said.some((t) => t.includes('carrying on from'))).toBe(true);
  expect(readFileSync(file).equals(DATA)).toBe(true);
  const again = join(dir(), 'model.gguf');
  writeFileSync(`${again}.part`, randomBytes(50_000)); // not the file's start: the server's whole file replaces it
  await download(`${base}/whole`, again, quiet);
  expect(readFileSync(again).equals(DATA)).toBe(true);
});

test('nothing for a while ends the download with a plain reason and keeps the .part; the next run carries on from it', async () => {
  const file = join(dir(), 'model.gguf');
  let e = null;
  try { await download(`${base}/stall`, file, quiet, { idleMs: 1000 }); } catch (x) { e = x; }
  expect(e?.message).toMatch(/^the download stopped: nothing came for 1 s from 127\.0\.0\.1:\d+\. Run coding setup again to carry on from 0\.00 GB$/);
  expect(statSync(`${file}.part`).size).toBe(1000);
  ranges.length = 0;
  await download(`${base}/file`, file, quiet);
  expect(ranges).toEqual(['bytes=1000-']);
  expect(readFileSync(file).equals(DATA)).toBe(true);
}, 15_000);

test('a file that cannot be written is a plain error, not a crash; a .part already whole is not asked for again', async () => {
  const file = join(dir(), 'model.gguf');
  mkdirSync(`${file}.part`); // what the write meets is not a file
  await expect(download(`${base}/file`, file, quiet)).rejects.toThrow(/^the download stopped \(EISDIR\)\. Run coding setup again/);
  const whole = join(dir(), 'model.gguf');
  writeFileSync(`${whole}.part`, DATA);
  await download(`${base}/file`, whole, quiet, { bytes: DATA.length, fetchFn: () => { throw new Error('asked again'); } });
  expect(readFileSync(whole).equals(DATA)).toBe(true);
});
