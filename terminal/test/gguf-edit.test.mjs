// The weight-edit writer (src/app/gguf-edit.mjs) against a tiny model file
// on disk: row scaling, off, copy and swap land exactly where the Weights
// page's Core says the rows are; everything else in the file — and the
// original — stays byte-for-byte the same; bad edits are refused.
import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEdits, parseModel, readRow, toHalf, Core } from '../src/app/gguf-edit.mjs';
import { tinyModel, tinyBlockModel, BLOCKS } from './tiny-gguf.mjs';

const dir = mkdtempSync(join(tmpdir(), 'gguf-edit-'));
const SRC = join(dir, 'tiny.gguf');
writeFileSync(SRC, tinyModel());
const srcBytes = readFileSync(SRC);
const out = (n) => join(dir, n);

// Everything outside the named (tensor, row) spans must be untouched.
async function sameExcept(destPath, spans) {
  const model = await parseModel(SRC);
  const dest = readFileSync(destPath);
  const skip = spans.map(([name, row]) => { const t = model.tensors.find((x) => x.name === name); return [model.dataStart + t.off + row * t.rowBytes, t.rowBytes]; });
  for (let i = 0; i < srcBytes.length; i++) {
    if (skip.some(([a, n]) => i >= a && i < a + n)) continue;
    if (dest[i] !== srcBytes[i]) return `byte ${i} changed outside the edited rows`;
  }
  return '';
}

test('scale ×0.5: every block scale halves, every digit byte stays, nothing else moves', async () => {
  const dest = out('a.gguf');
  const r = await applyEdits({ src: SRC, dest, edits: [{ op: 'scale', tensor: 'blk.0.ffn_up.weight', row: 3, k: 0.5 }] });
  expect(r.rowsChanged).toBe(1);
  const before = await readRow(SRC, 'blk.0.ffn_up.weight', 3);
  const after = await readRow(dest, 'blk.0.ffn_up.weight', 3);
  after.scales.forEach((s, i) => expect(s).toBeCloseTo(before.scales[i] * 0.5, 7));
  for (let b = 0; b < before.bytes.length; b += 34) expect(after.bytes.subarray(b + 2, b + 34).equals(before.bytes.subarray(b + 2, b + 34))).toBe(true);
  expect(await sameExcept(dest, [['blk.0.ffn_up.weight', 3]])).toBe('');
  expect(readFileSync(SRC).equals(srcBytes)).toBe(true); // the original is only read
  expect(existsSync(`${dest}.new`)).toBe(false);
});

test('off (×0): all scales exactly zero; ×1 leaves the row byte-for-byte alone', async () => {
  const dest = out('b.gguf');
  await applyEdits({ src: SRC, dest, edits: [
    { op: 'scale', tensor: 'token_embd.weight', row: 2, k: 0 },
    { op: 'scale', tensor: 'token_embd.weight', row: 4, k: 1 },
  ] });
  const off = await readRow(dest, 'token_embd.weight', 2);
  off.scales.forEach((s) => expect(s).toBe(0));
  const same = await readRow(dest, 'token_embd.weight', 4);
  expect(same.bytes.equals((await readRow(SRC, 'token_embd.weight', 4)).bytes)).toBe(true);
  expect(await sameExcept(dest, [['token_embd.weight', 2]])).toBe('');
});

test('copy and swap move whole rows exactly', async () => {
  const dest = out('c.gguf');
  await applyEdits({ src: SRC, dest, edits: [
    { op: 'copy', tensor: 'token_embd.weight', from: 0, to: 5 },
    { op: 'swap', tensor: 'blk.0.ffn_up.weight', a: 1, b: 2 },
  ] });
  expect((await readRow(dest, 'token_embd.weight', 5)).bytes.equals((await readRow(SRC, 'token_embd.weight', 0)).bytes)).toBe(true);
  expect((await readRow(dest, 'blk.0.ffn_up.weight', 1)).bytes.equals((await readRow(SRC, 'blk.0.ffn_up.weight', 2)).bytes)).toBe(true);
  expect((await readRow(dest, 'blk.0.ffn_up.weight', 2)).bytes.equals((await readRow(SRC, 'blk.0.ffn_up.weight', 1)).bytes)).toBe(true);
  expect(await sameExcept(dest, [['token_embd.weight', 5], ['blk.0.ffn_up.weight', 1], ['blk.0.ffn_up.weight', 2]])).toBe('');
});

test('edits apply in order: a copy after a scale carries the scaled row', async () => {
  const dest = out('d.gguf');
  await applyEdits({ src: SRC, dest, edits: [
    { op: 'scale', tensor: 'token_embd.weight', row: 1, k: 2 },
    { op: 'copy', tensor: 'token_embd.weight', from: 1, to: 3 },
  ] });
  const one = await readRow(dest, 'token_embd.weight', 1);
  expect((await readRow(dest, 'token_embd.weight', 3)).bytes.equals(one.bytes)).toBe(true);
  const srcOne = await readRow(SRC, 'token_embd.weight', 1);
  one.scales.forEach((s, i) => expect(s).toBeCloseTo(srcOne.scales[i] * 2, 7)); // the copied row really is the ×2 row
});

test('refusals: the source itself, a registered model name, missing tensors, rows outside, one weight of a mixed row, a range backwards, wild factors', async () => {
  const scale = (over) => [{ op: 'scale', tensor: 'blk.0.ffn_up.weight', row: 0, k: 1, ...over }];
  await expect(applyEdits({ src: SRC, dest: SRC, edits: scale() })).rejects.toThrow('refusing to write the model being read');
  await expect(applyEdits({ src: SRC, dest: out('gemma-4-12B-it-qat-UD-Q4_K_XL.gguf'), edits: scale() })).rejects.toThrow('refusing to write over');
  await expect(applyEdits({ src: SRC, dest: out('x.gguf'), edits: scale({ tensor: 'nope' }) })).rejects.toThrow('no tensor named nope');
  await expect(applyEdits({ src: SRC, dest: out('x.gguf'), edits: scale({ row: 5 }) })).rejects.toThrow('rows 0–4');
  await expect(applyEdits({ src: SRC, dest: out('x.gguf'), edits: [{ op: 'set', tensor: 'blk.0.ffn_up.weight', row: 0, col: 3, value: 0.1 }] })).rejects.toThrow('its rows were mixed before storing'); // PQ2_0: one weight is spread over its row
  await expect(applyEdits({ src: SRC, dest: out('x.gguf'), edits: [{ op: 'col', tensor: 'blk.0.ffn_up.weight', col: 3, k: 2 }] })).rejects.toThrow('its rows were mixed before storing');
  await expect(applyEdits({ src: SRC, dest: out('x.gguf'), edits: [{ op: 'range', tensor: 'blk.0.ffn_up.weight', from: 3, to: 1, k: 2 }] })).rejects.toThrow('the first comes after the last');
  await expect(applyEdits({ src: SRC, dest: out('x.gguf'), edits: scale({ k: 40 }) })).rejects.toThrow('between 0 and 16');
  await expect(applyEdits({ src: SRC, dest: out('x.gguf'), edits: [] })).rejects.toThrow('no edits');
  expect(existsSync(out('x.gguf'))).toBe(false);
  expect(readdirSync(dir).filter((f) => f.endsWith('.new'))).toEqual([]); // no half-written copies left behind
});

test('fp16 encode: ×1 is the identity on real stored scales', () => {
  const { half } = (() => { const html = readFileSync(join(import.meta.dir, '..', 'src', 'app', 'weights.html'), 'utf8'); const mod = { exports: {} }; new Function('module', html.match(/<script id="core">([\s\S]*?)<\/script>/)[1])(mod); return mod.exports; })();
  for (const bits of [0x2400, 0x1c00, 0x2266, 0x1e83, 0x0001, 0x03ff, 0x7bff]) expect(toHalf(half(bits))).toBe(bits);
  expect(toHalf(0)).toBe(0);
});

// ---- the block types Gemma and Qwen use ----
const SRC2 = join(dir, 'blocks.gguf');
writeFileSync(SRC2, tinyBlockModel());
const src2Bytes = readFileSync(SRC2);

test('every block type: ×0.5 halves every weight of the row exactly and changes only its scales; off makes it all zeros; ×1 changes nothing', async () => {
  const model = await parseModel(SRC2);
  for (const [name, [, w, bytes, at]] of Object.entries(BLOCKS)) {
    const tensor = `blk.0.${name.toLowerCase()}.weight`; const dest = out(`half-${name}.gguf`);
    const r = await applyEdits({ src: SRC2, dest, edits: [{ op: 'scale', tensor, row: 3, k: 0.5 }, { op: 'scale', tensor, row: 1, k: 0 }, { op: 'scale', tensor, row: 4, k: 1 }] });
    expect(r.rowsChanged).toBe(3);
    const before = await readRow(SRC2, tensor, 3), after = await readRow(dest, tensor, 3);
    expect(before.weights.length).toBe(w * 2); expect(before.weights.some((x) => x !== 0)).toBe(true);
    expect(Array.from(after.weights)).toEqual(Array.from(before.weights, (x) => x * 0.5)); // the test scales halve exactly in fp16
    // only the scale (and floor) bytes of each block moved
    for (let i = 0; i < before.bytes.length; i++) { const inBlock = i % bytes; const isScale = at.some((a) => inBlock === a || inBlock === a + 1); if (!isScale) expect([name, i, after.bytes[i]]).toEqual([name, i, before.bytes[i]]); }
    expect(Math.max(...Array.from((await readRow(dest, tensor, 1)).weights, Math.abs))).toBe(0);
    expect((await readRow(dest, tensor, 4)).bytes.equals((await readRow(SRC2, tensor, 4)).bytes)).toBe(true);
    // nothing outside those rows changed, in this matrix or any other
    const t = model.tensors.find((x) => x.name === tensor); const d = readFileSync(dest); const lo = model.dataStart + t.off, rb = t.rowBytes;
    for (let i = 0; i < src2Bytes.length; i++) { const row = i >= lo && i < lo + rb * t.rows ? Math.floor((i - lo) / rb) : -1; if (row !== 1 && row !== 3 && d[i] !== src2Bytes[i]) throw new Error(`${name}: byte ${i} changed outside the edited rows`); }
  }
  expect(readFileSync(SRC2).equals(src2Bytes)).toBe(true); // the original is only read
});

test('every block type: copy and swap move whole rows exactly, and a row scaled first is copied scaled', async () => {
  for (const name of Object.keys(BLOCKS)) {
    const tensor = `blk.0.${name.toLowerCase()}.weight`; const dest = out(`move-${name}.gguf`);
    await applyEdits({ src: SRC2, dest, edits: [{ op: 'scale', tensor, row: 0, k: 2 }, { op: 'copy', tensor, from: 0, to: 2 }, { op: 'swap', tensor, a: 3, b: 4 }] });
    const zero = await readRow(dest, tensor, 0);
    expect(Array.from(zero.weights)).toEqual(Array.from((await readRow(SRC2, tensor, 0)).weights, (x) => x * 2));
    expect((await readRow(dest, tensor, 2)).bytes.equals(zero.bytes)).toBe(true);
    expect((await readRow(dest, tensor, 3)).bytes.equals((await readRow(SRC2, tensor, 4)).bytes)).toBe(true);
    expect((await readRow(dest, tensor, 4)).bytes.equals((await readRow(SRC2, tensor, 3)).bytes)).toBe(true);
    expect((await readRow(dest, tensor, 1)).bytes.equals((await readRow(SRC2, tensor, 1)).bytes)).toBe(true);
  }
});

test('a factor too big for a block type\'s fp16 scale is refused, and no copy is left', async () => {
  // 0x7800 is the largest power of two fp16 holds; ×16 cannot be stored
  const big = Buffer.from(src2Bytes); const model = await parseModel(SRC2); const t = model.tensors.find((x) => x.name === 'blk.0.q4_0.weight');
  big.writeUInt16LE(0x7800, model.dataStart + t.off); const SRC3 = join(dir, 'big.gguf'); writeFileSync(SRC3, big);
  await expect(applyEdits({ src: SRC3, dest: out('big-out.gguf'), edits: [{ op: 'scale', tensor: 'blk.0.q4_0.weight', row: 0, k: 16 }] })).rejects.toThrow('does not fit in fp16');
  expect(existsSync(out('big-out.gguf'))).toBe(false); expect(existsSync(out('big-out.gguf.new'))).toBe(false);
});

// ---- finer edits: one weight, a column, a range of rows; and the plain numbers (the small parts) ----
test('one weight moves to its nearest step, and only that weight changes; a column does it in every row; a range scales rows exactly', async () => {
  const model = await parseModel(SRC2);
  for (const [name, [, w, bytes]] of Object.entries(BLOCKS)) {
    const tensor = `blk.0.${name.toLowerCase()}.weight`; const dest = out(`fine-${name}.gguf`); const t = model.tensors.find((x) => x.name === tensor);
    const src = [0, 1, 2, 3, 4].map((r) => null); for (let r = 0; r < 5; r++) src[r] = await readRow(SRC2, tensor, r);
    // the value one step up from row 1's weight at column 5, in its own group: exactly reachable
    const blk = Uint8Array.from(src[1].bytes.subarray(0, bytes)); const d = Core.digitsOf(t.type, blk, 0); const g = Math.floor(5 / d.gsz); const q = d.q[5] < d.hi ? d.q[5] + 1 : d.q[5] - 1;
    const want = Math.fround(d.mul[g] * q) - Math.fround(d.sub[g]);
    await applyEdits({ src: SRC2, dest, edits: [{ op: 'set', tensor, row: 1, col: 5, value: want + d.mul[g] * 0.3 }, { op: 'col', tensor, col: w + 7, k: 0.5 }, { op: 'range', tensor, from: 3, to: 4, k: 2 }] });
    const got = []; for (let r = 0; r < 5; r++) got[r] = await readRow(dest, tensor, r);
    expect([name, got[1].weights[5]]).toEqual([name, Core.weightAt(t.type, (() => { const b = Uint8Array.from(blk); Core.putDigit(t.type, b, 0, 5, q); return b; })(), 0, 5)]);
    for (let c = 0; c < t.ne0; c++) if (c !== 5 && c !== w + 7) expect([name, 1, c, got[1].weights[c]]).toEqual([name, 1, c, src[1].weights[c]]); // everything else in the row, its block included
    for (const r of [0, 1, 2]) { // the column: each row's weight there is the nearest step to half of it
      const b = Uint8Array.from(src[r].bytes.subarray(bytes, 2 * bytes)); const aim = src[r].weights[w + 7] * 0.5; const r2 = Core.setInBlock(t.type, b, 0, 7, aim);
      expect([name, r, got[r].weights[w + 7]]).toEqual([name, r, r2 ? r2.value : src[r].weights[w + 7]]);
      if (r2) expect(Math.abs(got[r].weights[w + 7] - aim)).toBeLessThanOrEqual(Math.abs(src[r].weights[w + 7] - aim) + 1e-9); // nearer to the aim than before, or as near
    }
    for (const r of [3, 4]) { // the range, then the column on top: ×2 exactly, apart from the column's weight
      for (let c = 0; c < t.ne0; c++) if (c !== w + 7) expect([name, r, c, got[r].weights[c]]).toEqual([name, r, c, src[r].weights[c] * 2]);
    }
  }
});

test('the stored numbers: every value a type can hold goes in and reads back, and a group whose scale is 0 cannot take a weight', () => {
  for (const [name, [type, w, bytes]] of Object.entries(BLOCKS)) {
    const blk = new Uint8Array(bytes); for (let i = 0; i < bytes; i++) blk[i] = (i * 37 + 11) & 255; new DataView(blk.buffer).setUint16(BLOCKS[name][3][0], 0x2400, true); if (BLOCKS[name][3][1] !== undefined) new DataView(blk.buffer).setUint16(BLOCKS[name][3][1], 0x2400, true);
    const d0 = Core.digitsOf(type, blk, 0);
    for (const j of [0, 1, 15, 16, 31, w - 1]) for (let q = d0.lo; q <= d0.hi; q += Math.max(1, Math.floor((d0.hi - d0.lo) / 7))) {
      const before = Core.digitsOf(type, blk, 0).q.slice(); Core.putDigit(type, blk, 0, j, q); const after = Core.digitsOf(type, blk, 0).q;
      expect([name, j, after[j]]).toEqual([name, j, q]); for (let i = 0; i < w; i++) if (i !== j) expect([name, j, i, after[i]]).toEqual([name, j, i, before[i]]);
    }
    // beyond the range: the end of it
    // far beyond what it can hold: the end of its range on that side (a Q6_K group scale can be below zero)
    const d = Core.digitsOf(type, blk, 0), g = Math.floor(3 / d.gsz), up = (d.mul[g] ?? d.mul[0]) > 0;
    expect([name, Core.setInBlock(type, blk, 0, 3, 1e6).q, Core.setInBlock(type, blk, 0, 3, -1e6).q]).toEqual([name, up ? d.hi : d.lo, up ? d.lo : d.hi]);
  }
  // a Q6_K group with a scale of 0: nothing to move
  const q6 = new Uint8Array(210); new DataView(q6.buffer).setUint16(208, 0x2400, true); q6[192] = 0; // group 0's scale
  expect(Core.setInBlock(14, q6, 0, 3, 0.5)).toBeNull();
});

test('plain numbers (a layer\'s small parts): a value is set exactly, a vector is scaled exactly, F16 and BF16 keep their rounding', () => {
  const f32 = new Uint8Array(16); const dv = new DataView(f32.buffer); [0.25, -1.5, 3, 0.1].forEach((v, i) => dv.setFloat32(i * 4, v, true));
  const t = { type: 0, ne0: 4, rowBytes: 16, rows: 1 };
  expect(Core.editRow(t, f32, 0, 0, { op: 'set', row: 0, col: 1, value: 0.7 })).toBe(true);
  expect(Core.editRow(t, f32, 0, 0, { op: 'scale', row: 0, k: 0.5 })).toBe(true);
  expect(Core.editRow(t, f32, 0, 1, { op: 'scale', row: 0, k: 9 })).toBe(false); // another row: untouched
  expect([0, 1, 2, 3].map((i) => dv.getFloat32(i * 4, true))).toEqual([0.125, Math.fround(Math.fround(0.7) * 0.5), 1.5, Math.fround(Math.fround(0.1) * 0.5)]);
  const h = new Uint8Array(2); const hd = new DataView(h.buffer);
  expect(Core.setPlain(1, hd, 0, 0.1)).toBe(Core.half(Core.toHalf(0.1))); expect(Core.setPlain(30, hd, 0, 0.1)).toBe(Core.bf16(Core.toBf16(0.1)));
  expect(() => Core.setPlain(1, hd, 0, 1e6)).toThrow('does not fit in F16');
  for (const v of [1, -2.5, 0.333, 1e-3, 65504]) expect(Core.half(Core.toHalf(v))).toBe(v === 0.333 || v === 1e-3 ? Core.half(Core.toHalf(v)) : v);
});

test('the small parts of a model file are edited in the copy exactly: a normalisation vector scaled, one value set, a column of a plain matrix', async () => {
  const { gguf } = await import('./tiny-gguf.mjs');
  const vec = Buffer.alloc(8 * 4); for (let i = 0; i < 8; i++) vec.writeFloatLE(1 + i / 8, i * 4);
  const mat = Buffer.alloc(3 * 8 * 4); for (let i = 0; i < 24; i++) mat.writeFloatLE(i - 12, i * 4);
  const SRC4 = join(dir, 'plain.gguf'); writeFileSync(SRC4, gguf({ kv: [['general.architecture', 8, 'x']], tensors: [{ name: 'blk.0.attn_norm.weight', dims: [8], type: 0, data: vec }, { name: 'blk.0.ssm_alpha.weight', dims: [8, 3], type: 0, data: mat }] }));
  const dest = out('plain-out.gguf');
  await applyEdits({ src: SRC4, dest, edits: [{ op: 'scale', tensor: 'blk.0.attn_norm.weight', row: 0, k: 0.5 }, { op: 'set', tensor: 'blk.0.attn_norm.weight', row: 0, col: 2, value: -7.25 }, { op: 'col', tensor: 'blk.0.ssm_alpha.weight', col: 4, k: 2 }, { op: 'swap', tensor: 'blk.0.ssm_alpha.weight', a: 0, b: 2 }] });
  expect(Array.from((await readRow(dest, 'blk.0.attn_norm.weight', 0)).weights)).toEqual([0.5, 0.5625, -7.25, 0.6875, 0.75, 0.8125, 0.875, 0.9375]);
  expect(Array.from((await readRow(dest, 'blk.0.ssm_alpha.weight', 0)).weights)).toEqual([4, 5, 6, 7, 16, 9, 10, 11]); // row 2 (×2 at column 4), swapped in
  expect(Array.from((await readRow(dest, 'blk.0.ssm_alpha.weight', 1)).weights)).toEqual([-4, -3, -2, -1, 0, 1, 2, 3]);
  expect(Array.from((await readRow(dest, 'blk.0.ssm_alpha.weight', 2)).weights)).toEqual([-12, -11, -10, -9, -16, -7, -6, -5]);
  await expect(applyEdits({ src: SRC4, dest: out('p2.gguf'), edits: [{ op: 'col', tensor: 'blk.0.ssm_alpha.weight', col: 8, k: 2 }] })).rejects.toThrow('columns 0–7');
});

// The Weights page shows the waiting edits by running Core.editRows on the rows it has read; the saved
// copy must hold exactly those bytes, for every kind of edit mixed together, in every block type.
test('the page\'s picture of the edits (Core.editRows) is byte-for-byte the copy the writer makes', async () => {
  const model = await parseModel(SRC2);
  for (const [name, [, w]] of Object.entries(BLOCKS)) {
    const tensor = `blk.0.${name.toLowerCase()}.weight`; const t = model.tensors.find((x) => x.name === tensor); const dest = out(`same-${name}.gguf`);
    const edits = [{ op: 'scale', tensor, row: 1, k: 0.5 }, { op: 'set', tensor, row: 2, col: 3, value: 0.04 }, { op: 'col', tensor, col: w + 5, k: 2 }, { op: 'range', tensor, from: 0, to: 2, k: 1.5 },
      { op: 'copy', tensor, from: 1, to: 4 }, { op: 'swap', tensor, a: 0, b: 3 }, { op: 'set', tensor, row: 4, col: 7, value: -0.03 }, { op: 'col', tensor, col: 1, k: 0 }];
    await applyEdits({ src: SRC2, dest, edits });
    const rows = new Map(); for (let r = 0; r < t.rows; r++) rows.set(r, Uint8Array.from((await readRow(SRC2, tensor, r)).bytes));
    const got = Core.editRows(t, rows, edits);
    for (let r = 0; r < t.rows; r++) expect([name, r, Buffer.from(rows.get(r)).equals((await readRow(dest, tensor, r)).bytes)]).toEqual([name, r, true]);
    expect([...got.rows].sort()).toEqual([0, 1, 2, 3, 4]); expect([...got.cols].sort((a, b) => a - b)).toEqual([1, w + 5]);
  }
});
