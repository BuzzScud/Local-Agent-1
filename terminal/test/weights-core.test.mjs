// The weights page's file reader (the <script id="core"> in src/app/weights.html),
// run against a tiny model file built here: the header, the storage mix-up
// undone in both directions, the word list, and the honest colour range.
// The un-mixing is checked against a plain Hadamard multiply, not the fast one.
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(import.meta.dir, '..', 'src', 'app', 'weights.html'), 'utf8');
const mod = { exports: {} };
new Function('module', html.match(/<script id="core">([\s\S]*?)<\/script>/)[1])(mod);
const Core = mod.exports;

// ---- a tiny GGUF, the way the real one is laid out ----
const W = 1024; // one mix block wide
function gguf({ kv, tensors }) {
  const parts = []; const push = (b) => parts.push(Buffer.from(b));
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); push(b); };
  const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); u64(b.length); push(b); };
  push(Buffer.from('GGUF')); u32(3); u64(tensors.length); u64(kv.length);
  for (const [k, type, v, et] of kv) {
    str(k); u32(type);
    if (type === 8) str(v); else if (type === 4) u32(v);
    else if (type === 9) { u32(et); u64(v.length); for (const x of v) et === 8 ? str(x) : i32(x); }
  }
  let off = 0; const offs = [];
  for (const t of tensors) { offs.push(off); off = Math.ceil((off + t.data.length) / 32) * 32; }
  tensors.forEach((t, i) => { str(t.name); u32(t.dims.length); for (const d of t.dims) u64(d); u32(t.type); u64(offs[i]); });
  let head = Buffer.concat(parts); head = Buffer.concat([head, Buffer.alloc(Math.ceil(head.length / 32) * 32 - head.length)]);
  const data = Buffer.alloc(off); tensors.forEach((t, i) => t.data.copy(data, offs[i]));
  const all = Buffer.concat([head, data]);
  return { name: 'tiny.gguf', size: all.length, slice: (a, b) => ({ arrayBuffer: async () => all.buffer.slice(all.byteOffset + a, all.byteOffset + Math.min(b, all.length)) }) };
}
// PQ2_0 rows from digits (−1/0/+1) and one scale per 128: fp16 scale, then 4 digits a byte, high bits first
const SCALE = 0.015625, SCALE_BITS = 0x2400; // 2^-6, exact in fp16
function pq2(rows) {
  const out = Buffer.alloc(rows.length * (W / 128) * 34); let p = 0;
  for (const d of rows) for (let b = 0; b < W / 128; b++) { out.writeUInt16LE(SCALE_BITS, p); p += 2; for (let j = 0; j < 32; j++) { const k = b * 128 + j * 4; out[p++] = ((d[k] + 1) << 6) | ((d[k + 1] + 1) << 4) | ((d[k + 2] + 1) << 2) | (d[k + 3] + 1); } }
  return out;
}
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const digits = (n) => Array.from({ length: n }, () => Array.from({ length: W }, () => Math.floor(rnd() * 3) - 1));
const signs = Array.from({ length: W }, () => (rnd() < 0.5 ? -1 : 1));
const embRows = digits(4), gateRows = digits(3);
const norm = Buffer.alloc(W * 4); for (let i = 0; i < W; i++) norm.writeFloatLE(i / 1000, i * 4);
const file = gguf({
  kv: [
    ['general.architecture', 8, 'qwen35'], ['qwen35.block_count', 4, 1], ['qwen35.embedding_length', 4, W],
    ['prism.hadamard.block_size', 4, W], ['prism.hadamard.transform', 8, 'normalized-sylvester-walsh-hadamard'], ['prism.hadamard.axis', 8, 'input-last-dimension'],
    ['prism.hadamard.weight_names', 9, ['blk.0.ffn_gate.weight'], 8], ['prism.hadamard.inverse_weight_names', 9, ['token_embd.weight'], 8],
    ['prism.hadamard.sign_widths', 9, [W], 5], ['prism.hadamard.sign_values', 9, signs, 5],
    ['tokenizer.ggml.tokens', 9, ['Ġhello', 'hello', 'âĢľ', 'Ġworld'], 8], ['tokenizer.ggml.merges', 9, ['Ġ h', 'e l'], 8],
  ],
  tensors: [
    { name: 'token_embd.weight', dims: [W, 4], type: 142, data: pq2(embRows) },
    { name: 'blk.0.ffn_gate.weight', dims: [W, 3], type: 142, data: pq2(gateRows) },
    { name: 'blk.0.attn_norm.weight', dims: [W], type: 0, data: norm },
  ],
});
// the plain Hadamard: H[i][j] = (−1)^popcount(i & j) / √n
const pop = (x) => { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; };
function slowH(v) { const out = new Array(W).fill(0); for (let j = 0; j < W; j++) { let s = 0; for (let i = 0; i < W; i++) s += (pop(i & j) & 1 ? -1 : 1) * v[i]; out[j] = s / Math.sqrt(W); } return out; }

test('the header: tensors and rows, the word list, the mix-up recipe; a short first read grows until the header fits', async () => {
  const m = await Core.parseHeader(file, 64); // 64 bytes: forces the grow-and-retry path
  expect(m.tensors.map((t) => [t.name, t.rows, t.ne0, t.typeName])).toEqual([['token_embd.weight', 4, W, 'PQ2_0'], ['blk.0.ffn_gate.weight', 3, W, 'PQ2_0'], ['blk.0.attn_norm.weight', 1, W, 'F32']]);
  expect(m.tokens).toEqual(['Ġhello', 'hello', 'âĢľ', 'Ġworld']);
  expect(m.kv['tokenizer.ggml.tokens']).toBe('[4 tokens]');
  expect(m.kv['tokenizer.ggml.merges']).toBeUndefined();
  expect(m.kv['prism.hadamard.sign_values']).toBe(`[${W} values]`);
  expect(m.rot.block).toBe(W); expect([...m.rot.signs[W]]).toEqual(signs);
  const gate = Core.rotationOf(m, m.tensors[1]), emb = Core.rotationOf(m, m.tensors[0]);
  expect(gate.inverse).toBe(false); expect(emb.inverse).toBe(true);
  expect(Core.rotationOf(m, m.tensors[2])).toBeNull(); // stored as is
  const whole = await Core.parseHeader(file);
  expect(whole.dataStart).toBe(m.dataStart);
});

test('real weights: digit × scale with the mix undone, H then the signs for a matrix, the signs then H for the word table', async () => {
  const m = await Core.parseHeader(file);
  for (const [t, rows, inverse] of [[m.tensors[1], gateRows, false], [m.tensors[0], embRows, true]]) {
    const dec = Core.decodeRows(t, await Core.readRows(file, m, t, 0, rows.length), rows.length);
    expect(Array.from(dec.vals.slice(0, W))).toEqual(rows[0]); // the digits read back
    expect(dec.scales[0]).toBe(SCALE);
    for (let r = 0; r < rows.length; r++) {
      const stored = rows[r].map((d) => d * SCALE);
      const want = inverse ? slowH(stored.map((x, i) => x * signs[i])) : slowH(stored).map((x, i) => x * signs[i]);
      const got = Core.realRow(t, dec, r, Core.rotationOf(m, t), new Float64Array(W));
      let err = 0; for (let i = 0; i < W; i++) err = Math.max(err, Math.abs(got[i] - want[i]));
      expect(err).toBeLessThan(1e-9);
    }
  }
  // a plain-number tensor comes back as stored
  const n = m.tensors[2]; const dec = Core.decodeRows(n, await Core.readRows(file, m, n, 0, 1), 1);
  expect(Core.realRow(n, dec, 0, null, new Float32Array(W))[500]).toBeCloseTo(0.5, 6);
  // rotate and unrotate undo each other, both ways
  for (const inv of [false, true]) { const rot = { block: W, signs: Int8Array.from(signs), inverse: inv }; const w = Float64Array.from({ length: W }, () => rnd() - 0.5); const back = Core.unrotate(Core.rotate(Float64Array.from(w), rot), rot); for (let i = 0; i < W; i += 97) expect(back[i]).toBeCloseTo(w[i], 12); }
});

test('real-weight sizes over a sample: per row, per column, overall, and the overview cells', async () => {
  const m = await Core.parseHeader(file); const t = m.tensors[1];
  const s = Core.realStats(t, await Core.loadSample(file, m, t, 2048, 32), Core.rotationOf(m, t), { W: 16, H: 3 });
  expect(s.rows).toBe(3); expect(s.colRms).toHaveLength(W); expect(s.cells).toHaveLength(48);
  // the mix keeps each row's size (it only rotates), so the real RMS equals the stored RMS
  const storedRms = Math.sqrt(gateRows[0].reduce((a, d) => a + (d * SCALE) ** 2, 0) / W);
  expect(s.rowRms[0]).toBeCloseTo(storedRms, 9);
});

test('words: tokens decode from the GPT-2 byte form; a word is found with and without its space, exact first', () => {
  expect(Core.decodeToken('Ġhello')).toBe(' hello');
  expect(Core.decodeToken('âĢľ')).toBe('“');
  expect(Core.decodeToken('ĠÃ©t')).toBe(' ét');
  const ix = Core.tokenIndex(['Ġhello', 'hello', 'âĢľ', 'Ġworld', 'Ġhelloworld']);
  expect(Core.findTokens(ix, 'hello').map((r) => [r.id, r.exact])).toEqual([[0, true], [1, true], [4, false]]);
  expect(Core.findTokens(ix, 'World').map((r) => [r.id, r.exact])).toEqual([[3, true], [4, false]]); // exact via lower case, then the one that contains it
  expect(Core.findTokens(ix, '  ')).toEqual([]);
  expect(Core.cosine([1, 0], [1, 0])).toBe(1); expect(Core.cosine([1, 0], [0, 1])).toBe(0); expect(Core.cosine([1, 2], [-1, -2])).toBeCloseTo(-1, 12);
});

test('the colour range never stretches near-equal values across the whole scale', () => {
  expect(Core.colourDomain([0.326, 0.328, 0.327], 0.05)).toMatchObject({ narrow: true, min: 0.326, max: 0.328 });
  const d = Core.colourDomain([0.326, 0.328], 0.05); expect(d.hi - d.lo).toBeCloseTo(0.05, 12); expect((d.lo + d.hi) / 2).toBeCloseTo(0.327, 12);
  expect(Core.colourDomain([1, 2, null, NaN], 0.4)).toMatchObject({ lo: 1, hi: 2, narrow: false });
});
