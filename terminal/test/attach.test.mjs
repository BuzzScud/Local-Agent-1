// The tray over the prompt box (src/app/attach.mjs): a file dropped into the window (its path, as
// Terminal types it) becomes a chip at once and is copied; the tray's cards and its one line for a
// small window; a thumbnail's dots the right way up; Quick Look; what goes to the model. The real
// window: app-vision.test.mjs (a drop, ctrl+f, delete) and app-mouse.test.mjs (a click on a card).
import { test, expect } from 'bun:test';
import { needs } from './needs.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const media = await import('../src/tools/media.mjs');
const A = await import('../src/app/attach.mjs');
const { expandMentions } = await import('../src/app/app-common.mjs');

const dir = mkdtempSync(join(tmpdir(), 'agentic-attach-'));
const fresh = () => ({ n: 0, files: new Map(), info: new Map() });
const to = (id) => ({ cwd: dir, dir: join(dir, 'att'), id });

// A 40 × 20 BMP: the top half red, the bottom half blue, a green strip down the left.
function bmp(file) {
  const w = 40, h = 20, row = Math.ceil((w * 3) / 4) * 4;
  const b = Buffer.alloc(54 + row * h);
  b.write('BM'); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const top = h - 1 - y < h / 2; // a BMP's rows go from the bottom up
    const [r, g, bl] = x < 4 ? [0, 255, 0] : top ? [255, 0, 0] : [0, 0, 255];
    const o = 54 + y * row + x * 3; b[o] = bl; b[o + 1] = g; b[o + 2] = r;
  }
  writeFileSync(file, b);
}

test.skipIf(needs('pictures', media.mediaTool))('a dropped screenshot (its path escaped as Terminal types it) becomes [Image #1] at once and is copied, so the original can go before enter', () => {
  const shot = join(dir, 'Screenshot 2026-10-07 at 10.12.33 AM.png');
  media.textImage(shot, 'HELLO 42', { w: 1440, h: 900 });
  const pasted = fresh();
  const r = A.attachDropped(`what is wrong here ${shot.replace(/ /g, '\\ ')} `, { ...to('s1'), pasted });
  expect(r.text).toBe('what is wrong here [Image #1] ');
  expect(r.failed).toEqual([]);
  const it = r.added[0];
  expect([it.n, it.token, it.kind, it.name, it.from, it.srcW, it.srcH]).toEqual([1, '[Image #1]', 'image', 'Screenshot 2026-10-07 at 10.12.33 AM.png', shot, 1440, 900]);
  expect([it.thumb.w, it.thumb.h, it.thumb.px.length]).toEqual([16, 10, 160]); // 1440 × 900 into 20 × 10 dots
  expect(A.shortName(it.name)).toBe('Screenshot 10.12 AM');
  const copy = pasted.files.get(1);
  expect(copy).toBe(join(dir, 'att', 's1-1.png'));
  rmSync(shot);
  expect(existsSync(copy)).toBe(true);
  expect(pasted.info.get(1).bytes).toBe(readFileSync(copy).length);
});

test.skipIf(needs('pictures', media.mediaTool))('a dropped PDF is [PDF #n] with its first page as the thumbnail; among words a text file keeps its path (a drop of only paths: attach-files.test.mjs), and so do a missing one and a broken picture, which uses no number', () => {
  const pdf = join(dir, 'invoice.pdf');
  media.textPdf(pdf, ['Invoice 7731\nTotal due: 1,240 dollars', 'Page two']);
  const notes = join(dir, 'notes.txt'); writeFileSync(notes, 'just text');
  const broken = join(dir, 'broken.png'); writeFileSync(broken, 'not a picture at all');
  const gone = join(dir, 'gone.png');
  const pasted = fresh();
  const r = A.attachDropped(`compare '${pdf}' with ${notes} ${gone} ${broken}`, { ...to('s2'), pasted });
  expect(r.text).toBe(`compare [PDF #1] with ${notes} ${gone} ${broken}`);
  expect(r.added.map((a) => [a.token, a.kind, a.pages])).toEqual([['[PDF #1]', 'pdf', 2]]);
  expect(r.added[0].thumb.h).toBe(10); // a page is taller than wide
  expect(r.failed).toEqual([{ path: broken, error: expect.stringContaining('not a picture') }]);
  expect(pasted.n).toBe(1);
  expect(A.attachDropped('plain words, no path', { ...to('s2'), pasted }).text).toBe('plain words, no path');
});

test.skipIf(needs('pictures', media.mediaTool))('what goes to the model: a dropped picture as a picture and a dropped PDF as its text, each with where it came from; a pasted one without', () => {
  const shot = join(dir, 'chart.png');
  media.textImage(shot, 'CHART', { w: 800, h: 400 });
  const pdf = join(dir, 'terms.pdf');
  media.textPdf(pdf, ['Payment within 30 days']);
  const pasted = fresh();
  const r = A.attachDropped(`compare ${shot} with ${pdf}`, { ...to('s3'), pasted });
  pasted.files.set(3, pasted.files.get(1)); // a ctrl+v picture: no `from`
  const from = new Map([...pasted.info].filter(([, a]) => a.from).map(([n, a]) => [n, a.from]));
  const out = expandMentions(`${r.text} and [Image #3] and [Image #1] again`, dir, 10_000, pasted.files, from);
  expect(out.images.map((i) => [i.path, i.srcW])).toEqual([['[Image #1]', 800], ['[Image #3]', 800]]); // each once
  expect(out.text).toContain('Payment within 30 days');
  expect(out.text).toContain(`([Image #1] is ${shot}, dropped into the window.)`);
  expect(out.text).toContain(`([PDF #2] is ${pdf}, dropped into the window.)`);
  expect(out.text).not.toContain('[Image #3] is');
  expect(out.attached.map((a) => a.label)).toEqual(['picture, 800×400', 'PDF, 1 page', 'picture, 800×400']);
});

test.skipIf(needs('pictures', media.mediaTool))('a thumbnail is the right way up: the top dots are the picture’s top, the left its left', () => {
  const file = join(dir, 'halves.bmp');
  bmp(file);
  const t = media.thumbnail(file, A.THUMB);
  expect([t.w, t.h, t.srcW, t.srcH]).toEqual([20, 10, 40, 20]);
  const rows = A.thumbRows(t);
  expect(rows).toHaveLength(5);
  expect(rows[0][0]).toMatchObject({ fg: '00ff00', bg: '00ff00' }); // the green strip, top left
  expect(rows[0].at(-1)).toEqual({ text: '▀'.repeat(17), fg: 'ff0000', bg: 'ff0000' });
  expect(rows[4].at(-1)).toMatchObject({ fg: '0000ff', bg: '0000ff' });
  expect(rows.map((runs) => runs.reduce((n, r) => n + r.text.length, 0))).toEqual([20, 20, 20, 20, 20]);
});

test('a thumbnail’s cells: ▀ with the top dot as the letter and the bottom as the background, ▄ when only the bottom shows, a see-through cell blank; an odd last row', () => {
  const t = { w: 2, h: 3, px: ['ff0000', null, null, '00ff00', '0000ff', null] };
  expect(A.thumbRows(t)).toEqual([
    [{ text: '▀', fg: 'ff0000', bg: null }, { text: '▄', fg: '00ff00', bg: null }],
    [{ text: '▀', fg: '0000ff', bg: null }, { text: ' ', fg: null, bg: null }],
  ]);
  expect(A.thumbRows({ w: 3, h: 2, px: ['aaaaaa', 'aaaaaa', 'aaaaaa', 'bbbbbb', 'bbbbbb', 'cccccc'] })).toEqual([[{ text: '▀▀', fg: 'aaaaaa', bg: 'bbbbbb' }, { text: '▀', fg: 'aaaaaa', bg: 'cccccc' }]]);
});

const card = (n, extra = {}) => ({ n, token: `[Image #${n}]`, kind: 'image', name: 'Screenshot 2026-10-07 at 10.12.33 AM.png', srcW: 1440, srcH: 900, bytes: 412_000, thumb: { w: 16, h: 10, px: [] }, ...extra });

test('the tray: the chips in the box in their order, each once; one with no file is left out, and a deleted chip takes its card away', () => {
  const pasted = { n: 2, files: new Map([[1, '/a/1.png'], [2, '/a/2.pdf']]), info: new Map([[1, card(1)], [2, card(2, { kind: 'pdf', token: '[PDF #2]' })]]) };
  expect(A.trayItems('[PDF #2] then [Image #1] and [PDF #2] again, [Image #9]', pasted).map((i) => [i.n, i.token, i.file])).toEqual([[2, '[PDF #2]', '/a/2.pdf'], [1, '[Image #1]', '/a/1.png']]);
  expect(A.trayItems('only [Image #1]', pasted).map((i) => i.n)).toEqual([1]);
  expect(A.trayItems('no chips', pasted)).toEqual([]);
});

test('the tray’s cards: side by side with their thumbnail, where a click finds each; what does not fit is "+N more"; a small window gets one line', () => {
  const lines = A.cardLines(card(1));
  expect(lines).toEqual(['[Image #1]', 'Screenshot 10.12 AM', '1440×900 · 402 KB', 'ctrl+f: open full size']);
  expect(A.cardLines(card(1), { mouse: true })[3]).toBe('click · ctrl+f: open');
  expect(A.cardLines(card(2, { kind: 'pdf', token: '[PDF #2]', pages: 3, name: 'invoice.pdf' }))[2]).toBe('PDF · 3 pages · 402 KB');
  const one = A.trayLayout([card(1)], { width: 155, rows: 43 });
  expect(one).toEqual({ compact: false, height: 5, more: 0, cards: [{ n: 1, x: 2, w: 40, textW: 22, from: 3, to: 42 }] });
  const four = A.trayLayout([card(1), card(2), card(3), card(4)], { width: 155, rows: 43 });
  expect(four.cards.map((c) => [c.n, c.from, c.to])).toEqual([[1, 3, 42], [2, 46, 85], [3, 89, 128]]);
  expect(four.more).toBe(1);
  const small = A.trayLayout([card(1), card(2)], { width: 155, rows: 20 });
  expect([small.compact, small.height, small.cards.length]).toEqual([true, 1, 2]);
  expect(A.compactText(card(1))).toBe('▣ [Image #1] Screenshot 10.12 AM · 1440×900 · 402 KB');
  expect(A.trayLayout([], { width: 155, rows: 43 })).toBeNull();
  expect(A.trayLayout([card(1)], { width: 50, rows: 43 }).compact).toBe(true);
  expect(A.shortName('a-really-long-file-name-that-goes-on-and-on.png', 20)).toBe('a-really-long-f….png');
  expect(A.fmtBytes(900)).toBe('900 B');
  expect(A.fmtBytes(3 * 1024 * 1024)).toBe('3.0 MB');
});

test('Quick Look: the files go to it (a file the tests read in its place); nothing to open says so', () => {
  const log = join(dir, 'quicklook.txt');
  const was = process.env.AGENTIC_TEST_QUICKLOOK;
  process.env.AGENTIC_TEST_QUICKLOOK = log;
  try {
    expect(A.quickLook(['/a/1.png', '/a/2.pdf'])).toBe(true);
    expect(A.quickLook([])).toBe(false);
    expect(readFileSync(log, 'utf8')).toBe('/a/1.png\n/a/2.pdf\n');
  } finally { if (was === undefined) delete process.env.AGENTIC_TEST_QUICKLOOK; else process.env.AGENTIC_TEST_QUICKLOOK = was; }
});
