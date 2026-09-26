// The weight-edit writer (src/app/gguf-edit.mjs) against a tiny model file
// on disk: row scaling, off, copy and swap land exactly where the Weights
// page's Core says the rows are; everything else in the file — and the
// original — stays byte-for-byte the same; bad edits are refused.
import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEdits, parseModel, readRow, toHalf } from '../src/app/gguf-edit.mjs';
import { tinyModel } from './tiny-gguf.mjs';

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

test('refusals: the source itself, a registered model name, missing tensors, rows outside, F32, wild factors', async () => {
  const scale = (over) => [{ op: 'scale', tensor: 'blk.0.ffn_up.weight', row: 0, k: 1, ...over }];
  await expect(applyEdits({ src: SRC, dest: SRC, edits: scale() })).rejects.toThrow('refusing to write the model being read');
  await expect(applyEdits({ src: SRC, dest: out('Ternary-Bonsai-2-27B-PQ2_0.gguf'), edits: scale() })).rejects.toThrow('refusing to write over');
  await expect(applyEdits({ src: SRC, dest: out('x.gguf'), edits: scale({ tensor: 'nope' }) })).rejects.toThrow('no tensor named nope');
  await expect(applyEdits({ src: SRC, dest: out('x.gguf'), edits: scale({ row: 5 }) })).rejects.toThrow('rows 0–4');
  await expect(applyEdits({ src: SRC, dest: out('x.gguf'), edits: scale({ tensor: 'blk.0.attn_norm.weight' }) })).rejects.toThrow('only PQ2_0');
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
