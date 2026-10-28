// Bonsai's model file, read for the hub's Bonsai tab (27 Oct 2026): where Ollama keeps it, what its header says (the
// build facts and every part's name, shape and kind) and a patch of its real weights. Bonsai 2 9B is stored as Q2_0
// (ggml type 42, found in its own file that day): blocks of 64 weights, each block a 2-byte scale (fp16) then 16 bytes
// of 2-bit codes, four a byte, low bits first; the codes take three values (0, 1, 2), its ternary weights. The hub's
// Weights tab reads the older Bonsai's PQ2_0 (type 142); this reads only what the tab shows, never the whole 3 GB.
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TYPE_NAMES = { 0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 8: 'Q8_0', 10: 'Q2_K', 11: 'Q3_K', 12: 'Q4_K', 13: 'Q5_K', 14: 'Q6_K', 30: 'BF16', 42: 'Q2_0', 142: 'PQ2_0' };
export const Q2_0 = 42;
const Q2_BLOCK = 64, Q2_BYTES = 18;

// Where Ollama keeps a model's weights: its manifest names the layer, the blob holds it.
function ollamaModelsDir(env = process.env) { return env.OLLAMA_MODELS || join(homedir(), '.ollama', 'models'); }
export function ollamaBlobOf(name, { dir = ollamaModelsDir() } = {}) {
  const [base, tag = 'latest'] = String(name).split(':');
  const host = base.includes('/') ? base : `library/${base}`;
  const manifest = join(dir, 'manifests', 'registry.ollama.ai', host, tag);
  if (!existsSync(manifest)) return null;
  try {
    const m = JSON.parse(readFileSync(manifest, 'utf8'));
    const layer = (m.layers ?? []).find((l) => String(l.mediaType).endsWith('.model'));
    const file = layer && join(dir, 'blobs', layer.digest.replace(':', '-'));
    return file && existsSync(file) ? file : null;
  } catch { return null; }
}

// A buffered reader over the file: the header has the tokenizer's whole vocabulary in it (some MB), read in windows.
class Reader {
  constructor(path) { this.fd = openSync(path, 'r'); this.pos = 0; this.buf = Buffer.alloc(0); this.at = 0; }
  need(n) {
    if (this.pos >= this.at && this.pos + n <= this.at + this.buf.length) return;
    const size = Math.max(n, 4 << 20);
    const b = Buffer.alloc(size);
    const got = readSync(this.fd, b, 0, size, this.pos);
    this.buf = b.subarray(0, got); this.at = this.pos;
    if (got < n) throw new Error('the model file ended early');
  }
  take(n) { this.need(n); const o = this.pos - this.at; this.pos += n; return this.buf.subarray(o, o + n); }
  u32() { return this.take(4).readUInt32LE(0); }
  u64() { return Number(this.take(8).readBigUInt64LE(0)); }
  str() { return this.take(this.u64()).toString('utf8'); }
  close() { closeSync(this.fd); }
}
const SCALAR = { 0: [1, 'readUInt8'], 1: [1, 'readInt8'], 2: [2, 'readUInt16LE'], 3: [2, 'readInt16LE'], 4: [4, 'readUInt32LE'], 5: [4, 'readInt32LE'], 6: [4, 'readFloatLE'], 7: [1, 'readUInt8'], 10: [8, 'readBigUInt64LE'], 11: [8, 'readBigInt64LE'], 12: [8, 'readDoubleLE'] };
function value(r, t) {
  if (t === 8) return r.str();
  if (t === 9) {
    const at = r.u32(), n = r.u64();
    // Long lists (the tokenizer's) are skipped: only their length is kept.
    if (at === 8) { for (let i = 0; i < n; i++) r.str(); return { list: n }; }
    if (at === 9) { for (let i = 0; i < n; i++) value(r, 9); return { list: n }; }
    r.take(SCALAR[at][0] * n);
    return { list: n };
  }
  const [n, fn] = SCALAR[t];
  const v = r.take(n)[fn](0);
  return typeof v === 'bigint' ? Number(v) : t === 7 ? Boolean(v) : v;
}

const cache = new Map();
// The header: { version, kv, tensors: [{ name, dims, type, typeName, offset }], dataStart }. Kept per file and its time.
export function readGguf(path) {
  const key = `${path}:${statSync(path).mtimeMs}`;
  if (cache.has(key)) return cache.get(key);
  const r = new Reader(path);
  try {
    if (r.take(4).toString('latin1') !== 'GGUF') throw new Error('not a GGUF file');
    const version = r.u32(), nt = r.u64(), nkv = r.u64();
    const kv = {};
    for (let i = 0; i < nkv; i++) { const k = r.str(); const t = r.u32(); kv[k] = value(r, t); }
    const tensors = [];
    for (let i = 0; i < nt; i++) {
      const name = r.str(); const nd = r.u32(); const dims = []; for (let d = 0; d < nd; d++) dims.push(r.u64());
      const type = r.u32(); const offset = r.u64();
      tensors.push({ name, dims, type, typeName: TYPE_NAMES[type] ?? `type ${type}`, offset });
    }
    const align = Number(kv['general.alignment'] ?? 32);
    const out = { version, kv, tensors, dataStart: Math.ceil(r.pos / align) * align };
    cache.clear(); cache.set(key, out);
    return out;
  } finally { r.close(); }
}

// The build facts the page shows, from the header (any architecture: its own prefix).
export function modelFacts(g) {
  const arch = g.kv['general.architecture'] ?? '';
  const k = (n) => g.kv[`${arch}.${n}`];
  const layers = Number(k('block_count') ?? 0);
  const every = Number(k('full_attention_interval') ?? 0);
  const byType = {};
  for (const t of g.tensors) byType[t.typeName] = (byType[t.typeName] ?? 0) + 1;
  return {
    // Its weights counted from the parts' shapes when the header does not say (Bonsai's does not).
    arch, params: Number(g.kv['general.parameter_count'] ?? 0) || g.tensors.reduce((n, t) => n + t.dims.reduce((a, d) => a * d, 1), 0), layers, width: Number(k('embedding_length') ?? 0),
    ffn: Number(k('feed_forward_length') ?? 0), heads: Number(k('attention.head_count') ?? 0), kvHeads: Number(k('attention.head_count_kv') ?? 0),
    headSize: Number(k('attention.key_length') ?? 0), ctx: Number(k('context_length') ?? 0), fullEvery: every,
    full: every ? Array.from({ length: layers }, (_, i) => i).filter((i) => (i + 1) % every === 0) : [],
    vocab: g.kv['tokenizer.ggml.tokens']?.list ?? null, tensors: g.tensors.length, byType,
  };
}

// The parts of one layer: [{ part, shape, kind }].
export function layerParts(g, n) {
  const pre = `blk.${n}.`;
  return g.tensors.filter((t) => t.name.startsWith(pre)).map((t) => ({ part: t.name.slice(pre.length), shape: t.dims.join(' × '), kind: t.typeName }));
}

// A patch of real weights from a Q2_0 part: `rows` neurons (rows of the matrix) from `row`, their first `cols`
// weights, as strings of codes 0/1/2, and each row's first block scale. Throws for a part not stored as Q2_0.
export function q2Patch(path, g, name, { row = 0, rows = 48, cols = 256 } = {}) {
  const t = g.tensors.find((x) => x.name === name);
  if (!t) throw new Error(`no part called ${name}`);
  if (t.type !== Q2_0) throw new Error(`${name} is stored as ${t.typeName}, not Q2_0`);
  const ne0 = t.dims[0], ne1 = t.dims[1] ?? 1;
  const rowBytes = (ne0 / Q2_BLOCK) * Q2_BYTES;
  const take = Math.min(cols, ne0), blocks = Math.ceil(take / Q2_BLOCK);
  const fd = openSync(path, 'r');
  try {
    const out = [], scales = [];
    for (let y = row; y < Math.min(ne1, row + rows); y++) {
      const b = Buffer.alloc(blocks * Q2_BYTES);
      readSync(fd, b, 0, b.length, g.dataStart + t.offset + y * rowBytes);
      let codes = '';
      for (let k = 0; k < blocks; k++) {
        if (k === 0) scales.push(Number(b.readUInt16LE(0) ? halfToFloat(b.readUInt16LE(0)) : 0));
        for (let i = 0; i < 16; i++) { const byte = b[k * Q2_BYTES + 2 + i]; for (const s of [0, 2, 4, 6]) codes += String((byte >> s) & 3); }
      }
      out.push(codes.slice(0, take));
    }
    return { name, dims: t.dims, rows: out, scales };
  } finally { closeSync(fd); }
}
export function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
