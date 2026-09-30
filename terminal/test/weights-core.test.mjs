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

// ---- the storage types Gemma and Qwen use: blocks built here by hand, from known numbers ----
// Scales that are exact in fp16 (powers of two), so every weight has one right answer.
const D = 0.015625, D_BITS = 0x2400, MN = 0.03125, MN_BITS = 0x2800; // 2^-6 and 2^-5
const ints = (n, lo, hi) => Array.from({ length: n }, () => lo + Math.floor(rnd() * (hi - lo + 1)));
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const q40 = (q) => Buffer.concat([u16(D_BITS), Buffer.from(Array.from({ length: 16 }, (_, j) => (q[j] + 8) | ((q[j + 16] + 8) << 4)))]);
const q80 = (q) => Buffer.concat([u16(D_BITS), Buffer.from(Int8Array.from(q).buffer)]);
// the 6-bit scales and floors of 8 groups, packed the way the file packs them
function packScales(sc, m) { const s = new Uint8Array(12); for (let j = 0; j < 4; j++) { s[j] = sc[j] | ((sc[j + 4] >> 4) << 6); s[j + 4] = m[j] | ((m[j + 4] >> 4) << 6); s[j + 8] = (sc[j + 4] & 0xF) | ((m[j + 4] & 0xF) << 4); } return Buffer.from(s); }
function qk(q, sc, m, five) {
  const qs = new Uint8Array(128), qh = new Uint8Array(32);
  for (let g = 0; g < 8; g++) for (let l = 0; l < 32; l++) { const v = q[g * 32 + l]; qs[(g >> 1) * 32 + l] |= (v & 0xF) << (g & 1 ? 4 : 0); if (v & 16) qh[l] |= 1 << g; }
  return Buffer.concat([u16(D_BITS), u16(MN_BITS), packScales(sc, m), ...(five ? [Buffer.from(qh)] : []), Buffer.from(qs)]);
}
function q6k(q, sc) {
  const ql = new Uint8Array(128), qh = new Uint8Array(64);
  for (let n = 0; n < 2; n++) for (let l = 0; l < 32; l++) { const v = [0, 32, 64, 96].map((o) => q[n * 128 + l + o] + 32); ql[n * 64 + l] = (v[0] & 0xF) | ((v[2] & 0xF) << 4); ql[n * 64 + l + 32] = (v[1] & 0xF) | ((v[3] & 0xF) << 4); qh[n * 32 + l] = (v[0] >> 4) | ((v[1] >> 4) << 2) | ((v[2] >> 4) << 4) | ((v[3] >> 4) << 6); }
  return Buffer.concat([Buffer.from(ql), Buffer.from(qh), Buffer.from(Int8Array.from(sc).buffer), u16(D_BITS)]);
}
const BLOCKS = {
  Q4_0: { type: 2, w: 32, bytes: 18, make: () => { const q = ints(32, -8, 7); return { buf: q40(q), q, want: q.map((x) => x * D), mul: [D], sub: [0], gsz: 32 }; } },
  Q8_0: { type: 8, w: 32, bytes: 34, make: () => { const q = ints(32, -127, 127); return { buf: q80(q), q, want: q.map((x) => x * D), mul: [D], sub: [0], gsz: 32 }; } },
  Q4_K: { type: 12, w: 256, bytes: 144, make: () => { const q = ints(256, 0, 15), sc = ints(8, 0, 63), m = ints(8, 0, 63); return { buf: qk(q, sc, m, false), q, want: q.map((x, i) => D * sc[i >> 5] * x - MN * m[i >> 5]), mul: sc.map((s) => D * s), sub: m.map((s) => MN * s), gsz: 32 }; } },
  Q5_K: { type: 13, w: 256, bytes: 176, make: () => { const q = ints(256, 0, 31), sc = ints(8, 0, 63), m = ints(8, 0, 63); return { buf: qk(q, sc, m, true), q, want: q.map((x, i) => D * sc[i >> 5] * x - MN * m[i >> 5]), mul: sc.map((s) => D * s), sub: m.map((s) => MN * s), gsz: 32 }; } },
  Q6_K: { type: 14, w: 256, bytes: 210, make: () => { const q = ints(256, -32, 31), sc = ints(16, -128, 127); return { buf: q6k(q, sc), q, want: q.map((x, i) => D * sc[i >> 4] * x), mul: sc.map((s) => D * s), sub: sc.map(() => 0), gsz: 16 }; } },
};

test('the five block types read back as the numbers they were built from: every weight, every stored number, every group scale', async () => {
  for (const [name, B] of Object.entries(BLOCKS)) {
    // 3 rows of 2 blocks each: a row is whole blocks, so a row's bytes are simply its blocks'
    const rows = Array.from({ length: 3 }, () => [B.make(), B.make()]);
    const f = gguf({ kv: [['general.architecture', 8, 'x']], tensors: [{ name: 'blk.0.ffn_gate.weight', dims: [B.w * 2, 3], type: B.type, data: Buffer.concat(rows.flat().map((b) => b.buf)) }] });
    const m = await Core.parseHeader(f); const t = m.tensors[0];
    expect([name, t.typeName, t.rowBytes, t.bytes]).toEqual([name, name, B.bytes * 2, B.bytes * 6]);
    expect(Core.bitsPerWeight(B.type)).toBe(B.bytes * 8 / B.w);
    const bytes = await Core.readRows(f, m, t, 0, 3); const dec = Core.decodeRows(t, bytes, 3);
    expect(dec.ternary).toBe(false); expect(dec.scales).toBeNull();
    expect(Array.from(dec.vals)).toEqual(rows.flat().flatMap((b) => b.want)); // exact: the scales are powers of two
    expect(Array.from(Core.realRow(t, dec, 1, null, new Float32Array(t.ne0)))).toEqual(rows[1].flatMap((b) => b.want));
    rows.flat().forEach((b, i) => { const d = Core.digitsOf(B.type, bytes, i * B.bytes); expect(Array.from(d.q)).toEqual(b.q); expect(d.gsz).toBe(b.gsz); expect(d.mul).toEqual(b.mul); expect(d.sub).toEqual(b.sub); expect(b.q.every((x) => x >= d.lo && x <= d.hi)).toBe(true); });
    // one row alone, from the middle of the tensor
    expect(Array.from(Core.decodeRows(t, await Core.readRows(f, m, t, 2, 1), 1).vals)).toEqual(rows[2].flatMap((b) => b.want));
  }
  // the old ternary type through the same stored-block reader
  const m = await Core.parseHeader(file); const t = m.tensors[1]; const d = Core.digitsOf(142, await Core.readRows(file, m, t, 0, 1), 34);
  expect(Array.from(d.q)).toEqual(gateRows[0].slice(128, 256)); expect([d.gsz, d.mul[0], d.lo, d.hi]).toEqual([128, SCALE, -1, 1]);
});

test('a type the page cannot read, and a row that is not whole blocks, say so instead of guessing', async () => {
  const f = gguf({ kv: [['general.architecture', 8, 'x']], tensors: [{ name: 'a', dims: [32, 2], type: 16, data: Buffer.alloc(64) }, { name: 'b', dims: [48, 2], type: 2, data: Buffer.alloc(54) }, { name: 'c', dims: [64, 2], type: 2, data: Buffer.alloc(72) }] });
  const m = await Core.parseHeader(f);
  expect(m.tensors.map((t) => [t.typeName, t.rowBytes])).toEqual([['type 16', null], ['Q4_0', null], ['Q4_0', 36]]);
  expect(Core.bitsPerWeight(16)).toBeNull(); expect(Core.bitsPerWeight(0)).toBe(32); expect(Core.bitsPerWeight(30)).toBe(16);
});

test('words in a file that writes tokens as text: ▁ is the space, and a word is found with its space first', () => {
  expect(Core.tokenText('▁king', 'gemma4')).toBe(' king'); expect(Core.tokenText('Ġking', 'gpt2')).toBe(' king'); expect(Core.tokenText('Ġking')).toBe(' king');
  expect(Core.tokenText('▁New▁York', 'llama')).toBe(' New York');
  const ix = Core.tokenIndex(['king', '▁king', 'King', 'aking', '▁King'], 'gemma4');
  expect(Core.findTokens(ix, 'king').map((r) => [r.text, r.exact])).toEqual([[' king', true], ['king', true], [' King', true], ['King', true], ['aking', false]]);
  // read the GPT-2 way, the same list misses the word's usual form (what the page did before it knew the file's kind)
  expect(Core.findTokens(Core.tokenIndex(['king', '▁king', 'King', 'aking', '▁King']), 'king').filter((r) => r.exact).map((r) => r.text)).toEqual(['king', 'King']);
});

// a bool array in the header (Gemma's which-layers-are-local list)
function ggufWith(kv, tensors) {
  const parts = []; const push = (b) => parts.push(Buffer.from(b));
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); u64(b.length); push(b); };
  push(Buffer.from('GGUF')); u32(3); u64(tensors.length); u64(kv.length);
  for (const [k, type, v] of kv) { str(k); u32(type); if (type === 8) str(v); else if (type === 4) u32(v); else { u32(7); u64(v.length); for (const x of v) push([x ? 1 : 0]); } }
  let off = 0; const offs = []; for (const t of tensors) { offs.push(off); off = Math.ceil((off + t.data.length) / 32) * 32; }
  tensors.forEach((t, i) => { str(t.name); u32(t.dims.length); for (const d of t.dims) u64(d); u32(t.type); u64(offs[i]); });
  let head = Buffer.concat(parts); head = Buffer.concat([head, Buffer.alloc(Math.ceil(head.length / 32) * 32 - head.length)]);
  const all = Buffer.concat([head, Buffer.alloc(off)]);
  return { name: 'tiny.gguf', size: all.length, slice: (a, b) => ({ arrayBuffer: async () => all.buffer.slice(all.byteOffset + a, all.byteOffset + Math.min(b, all.length)) }) };
}
const mat = (name, type = 2) => ({ name, dims: [32, 2], type, data: Buffer.alloc(type === 2 ? 36 : 68) });
const vecT = (name) => ({ name, dims: [32], type: 0, data: Buffer.alloc(128) });

test('the layout comes from the file: a Gemma-like file and a Qwen-like file each get their own kinds of matrix and of layer', async () => {
  const gemma = await Core.parseHeader(ggufWith(
    [['general.architecture', 8, 'gemma4'], ['gemma4.block_count', 4, 3], ['gemma4.attention.sliding_window', 4, 1024], ['gemma4.attention.sliding_window_pattern', 9, [true, true, false]]],
    [mat('token_embd.weight'), ...[0, 1, 2].flatMap((l) => [mat(`blk.${l}.ffn_down.weight`), mat(`blk.${l}.attn_q.weight`), ...(l < 2 ? [mat(`blk.${l}.attn_v.weight`)] : []), vecT(`blk.${l}.attn_norm.weight`)])]));
  const g = Core.layout(gemma);
  expect(g.kinds).toEqual(['attn_q', 'attn_v', 'ffn_down']); // the reading order, whatever order the file lists them in
  expect(g.layerKind).toEqual(['local', 'local', 'global']); expect([g.layers, g.own, g.window, g.tiedOutput]).toEqual([3, 3, 1024, true]);
  expect(g.shared.map((t) => t.name)).toEqual(['token_embd.weight']);
  expect(g.grid['attn_v:1'].name).toBe('blk.1.attn_v.weight'); expect(g.grid['attn_v:2']).toBeUndefined(); // the global layer has none
  expect(Object.keys(g.grid)).toHaveLength(8); // the small norm vectors are not matrices

  const qwen = await Core.parseHeader(ggufWith(
    [['general.architecture', 8, 'qwen35'], ['qwen35.block_count', 4, 5], ['qwen35.full_attention_interval', 4, 4]],
    [mat('token_embd.weight'), mat('output.weight'), ...[0, 1, 2].flatMap((l) => [mat(`blk.${l}.ffn_gate.weight`), mat(`blk.${l}.attn_qkv.weight`), mat(`blk.${l}.ssm_out.weight`, 8)]), mat('blk.3.attn_q.weight'), mat('blk.3.ffn_gate.weight'), mat('blk.4.attn_q.weight'), mat('blk.4.ffn_gate.weight'), mat('blk.4.nextn.eh_proj.weight', 8), vecT('blk.4.nextn.enorm.weight')]));
  const q = Core.layout(qwen);
  expect(q.kinds).toEqual(['attn_qkv', 'ssm_out', 'attn_q', 'ffn_gate']);
  expect(q.layerKind).toEqual(['linear', 'linear', 'linear', 'full', 'helper']); expect([q.layers, q.own, q.tiedOutput]).toEqual([5, 4, false]);
  expect(q.shared.map((t) => t.name)).toEqual(['token_embd.weight', 'output.weight', 'blk.4.nextn.eh_proj.weight']); // the helper's own input is not a kind of layer matrix
  // the old tiny file still lays out (one layer, one kind)
  const old = Core.layout(await Core.parseHeader(file)); expect([old.kinds, old.layers, old.layerKind]).toEqual([['ffn_gate'], 1, ['plain']]);
});
