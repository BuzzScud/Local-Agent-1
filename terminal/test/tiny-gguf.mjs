// A tiny GGUF laid out like the real model, for tests (not a test itself).
// Used by gguf-edit.test.mjs and the edits-endpoint test in weights.test.mjs.
export const W = 256; // two PQ2_0 blocks per row

export function gguf({ kv, tensors }) {
  const parts = []; const push = (b) => parts.push(Buffer.from(b));
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); u64(b.length); push(b); };
  push(Buffer.from('GGUF')); u32(3); u64(tensors.length); u64(kv.length);
  for (const [k, type, v] of kv) { str(k); u32(type); if (type === 8) str(v); else u32(v); }
  let off = 0; const offs = [];
  for (const t of tensors) { offs.push(off); off = Math.ceil((off + t.data.length) / 32) * 32; }
  tensors.forEach((t, i) => { str(t.name); u32(t.dims.length); for (const d of t.dims) u64(d); u32(t.type); u64(offs[i]); });
  let head = Buffer.concat(parts); head = Buffer.concat([head, Buffer.alloc(Math.ceil(head.length / 32) * 32 - head.length)]);
  const data = Buffer.alloc(off); tensors.forEach((t, i) => t.data.copy(data, offs[i]));
  return Buffer.concat([head, data]);
}

// PQ2_0 rows: per 128 weights, an fp16 scale then 32 digit bytes.
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
export const SCALES = [0x2400, 0x1c00, 0x2266, 0x1e83]; // a few different fp16 scales
export function pq2(rows) {
  const out = Buffer.alloc(rows * (W / 128) * 34); let p = 0; let s = 0;
  for (let r = 0; r < rows; r++) for (let b = 0; b < W / 128; b++) {
    out.writeUInt16LE(SCALES[s++ % SCALES.length], p); p += 2;
    for (let j = 0; j < 32; j++) out[p++] = Math.floor(rnd() * 256);
  }
  return out;
}

// The standard three-tensor tiny model most tests want.
export function tinyModel() {
  return gguf({
    kv: [['general.architecture', 8, 'qwen35'], ['qwen35.embedding_length', 4, W]],
    tensors: [
      { name: 'token_embd.weight', dims: [W, 6], type: 142, data: pq2(6) },
      { name: 'blk.0.ffn_up.weight', dims: [W, 5], type: 142, data: pq2(5) },
      { name: 'blk.0.attn_norm.weight', dims: [W], type: 0, data: Buffer.alloc(W * 4) },
    ],
  });
}

// Rows of the block types Gemma and Qwen use: [weights in a block, bytes in a block,
// where its fp16 scale (and floor) sit]. Every other byte is a stored number, and any
// byte is a valid one, so they are random.
export const BLOCKS = { Q4_0: [2, 32, 18, [0]], Q8_0: [8, 32, 34, [0]], Q4_K: [12, 256, 144, [0, 2]], Q5_K: [13, 256, 176, [0, 2]], Q6_K: [14, 256, 210, [208]] };
export function blockRows(name, rows, perRow = 2) {
  const [, , bytes, at] = BLOCKS[name]; const out = Buffer.alloc(rows * perRow * bytes); let s = 0;
  for (let b = 0; b < rows * perRow; b++) { const p = b * bytes; for (let j = 0; j < bytes; j++) out[p + j] = Math.floor(rnd() * 256); for (const a of at) out.writeUInt16LE(SCALES[s++ % SCALES.length], p + a); }
  return out;
}
// One matrix of each of those types, 5 rows of 2 blocks, plus a plain-number vector.
export function tinyBlockModel() {
  return gguf({
    kv: [['general.architecture', 8, 'qwen35'], ['qwen35.embedding_length', 4, 64]],
    tensors: [...Object.entries(BLOCKS).map(([name, [type, w]]) => ({ name: `blk.0.${name.toLowerCase()}.weight`, dims: [w * 2, 5], type, data: blockRows(name, 5) })), { name: 'blk.0.attn_norm.weight', dims: [64], type: 0, data: Buffer.alloc(64 * 4) }],
  });
}
