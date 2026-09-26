// Writing weight edits into a COPY of the model file (never the original).
// This is the save-and-restart route's writer: it clones the model (free on
// APFS), changes whole rows in the copy, checks every changed byte, and only
// then puts the copy in place. The file format is decoded by the same Core
// the Weights tab uses (the <script id="core"> in weights.html), so the
// writer and the viewer can never disagree about where a byte lives.
//
// What an edit can be — all exact, all PQ2_0-row-local (see the plan report):
//   { op: 'scale', tensor, row, k }   turn one row up (k>1), down (k<1) or off (k=0):
//                                     each 128-weight block stores an fp16 scale;
//                                     multiplying the scales scales the row exactly.
//   { op: 'copy',  tensor, from, to } make row `to` an exact copy of row `from`.
//   { op: 'swap',  tensor, a, b }     exchange two rows.
// Edits apply in the order given: a copy after a scale copies the scaled row.
import { closeSync, copyFileSync, existsSync, openSync, readSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import html from './weights.html' with { type: 'text' };
import { MODELS, modelPath } from '../../../models/index.mjs';

// The page's Core, run outside the page (the same trick as its tests).
const Core = (() => { const mod = { exports: {} }; new Function('module', html.match(/<script id="core">([\s\S]*?)<\/script>/)[1])(mod); return mod.exports; })();
const BLOCK_BYTES = 34; // one PQ2_0 block: fp16 scale, then 32 bytes of 2-bit digits

// fp16 encode (round to nearest, ties to even) — Core.half is the decode.
const f32 = new Float32Array(1); const u32 = new Uint32Array(f32.buffer);
export function toHalf(v) {
  f32[0] = v; const x = u32[0];
  const sign = (x >>> 16) & 0x8000; const e = (x >>> 23) & 0xff; let m = x & 0x7fffff;
  if (e === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0); // Inf / NaN
  const exp = e - 127 + 15;
  if (exp >= 31) return sign | 0x7c00; // too big for fp16
  if (exp <= 0) { // small: a subnormal half, or zero
    if (exp < -10) return sign;
    m |= 0x800000;
    const shift = 14 - exp; const half = m >>> shift; const rest = m & ((1 << shift) - 1); const tie = 1 << (shift - 1);
    return sign | (half + (rest > tie || (rest === tie && (half & 1)) ? 1 : 0));
  }
  const mant = m >>> 13; const rest = m & 0x1fff;
  let out = sign | (exp << 10) | mant;
  if (rest > 0x1000 || (rest === 0x1000 && (mant & 1))) out++;
  return out;
}

// A "file" the way Core wants one, over a path on disk.
function fileOf(path) {
  const size = statSync(path).size;
  return { name: basename(path), size, slice: (a, b) => ({ arrayBuffer: async () => {
    const fd = openSync(path, 'r');
    try { const n = Math.min(b, size) - a; const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, a); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + n); }
    finally { closeSync(fd); }
  } }) };
}

// The parsed header of a model file on disk.
export async function parseModel(path) {
  return Core.parseHeader(fileOf(path));
}

// Where row `row` of tensor `t` lives in the file.
const rowAt = (model, t, row) => model.dataStart + t.off + row * t.rowBytes;

// One row's bytes, plus its block scales as numbers — for tests and checks.
export async function readRow(path, tensorName, row, model) {
  model = model ?? await parseModel(path);
  const t = model.tensors.find((x) => x.name === tensorName);
  if (!t) throw new Error(`no tensor named ${tensorName}`);
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(t.rowBytes);
    readSync(fd, buf, 0, t.rowBytes, rowAt(model, t, row));
    const scales = []; for (let b = 0; b < t.rowBytes; b += BLOCK_BYTES) scales.push(Core.half(buf.readUInt16LE(b)));
    return { bytes: buf, scales };
  } finally { closeSync(fd); }
}

// Says what is wrong with an edit list, or nothing when it is fine.
export function validateEdits(model, edits) {
  if (!Array.isArray(edits) || !edits.length) throw new Error('no edits to apply');
  for (const e of edits) {
    const t = model.tensors.find((x) => x.name === e.tensor);
    if (!t) throw new Error(`no tensor named ${e.tensor}`);
    if (t.typeName !== 'PQ2_0') throw new Error(`${e.tensor} is ${t.typeName}; only PQ2_0 rows can be edited`);
    const row = (r, what) => { if (!Number.isInteger(r) || r < 0 || r >= t.rows) throw new Error(`${e.tensor} has rows 0–${t.rows - 1}; ${what} ${r} is outside them`); };
    if (e.op === 'scale') {
      row(e.row, 'row');
      if (!Number.isFinite(e.k) || e.k < 0 || e.k > 16) throw new Error(`the factor must be between 0 and 16, not ${e.k}`);
    } else if (e.op === 'copy') { row(e.from, 'row'); row(e.to, 'row'); if (e.from === e.to) throw new Error('copy needs two different rows'); }
    else if (e.op === 'swap') { row(e.a, 'row'); row(e.b, 'row'); if (e.a === e.b) throw new Error('swap needs two different rows'); }
    else throw new Error(`unknown edit ${JSON.stringify(e.op)}`);
  }
}

// Multiplies every block scale in a row's bytes by k, in place. The digits
// (the other 32 bytes of each block) are never touched.
function scaleRowBytes(buf, k, where) {
  for (let b = 0; b < buf.length; b += BLOCK_BYTES) {
    const bits = toHalf(Core.half(buf.readUInt16LE(b)) * k);
    if ((bits & 0x7c00) === 0x7c00) throw new Error(`${where}: the new scale does not fit in fp16 (factor ${k} is too big here)`);
    buf.writeUInt16LE(k === 0 ? 0 : bits, b);
  }
}

// Writes `edits` into a copy of `src` at `dest`. The original is only read.
// The copy is built as `dest.new` (an APFS clone: instant, no space) and only
// renamed onto `dest` after every changed row read back exactly as written.
export async function applyEdits({ src, dest, edits }) {
  if (!existsSync(src)) throw new Error(`${src} is not here`);
  if (resolve(dest) === resolve(src)) throw new Error('refusing to write the model being read');
  for (const m of Object.values(MODELS)) {
    if (resolve(dest) === resolve(modelPath(m)) || basename(dest) === m.file) throw new Error(`refusing to write over ${m.name}'s own file — edits go in a copy with its own name`);
  }
  const model = await parseModel(src);
  validateEdits(model, edits);

  const tmp = `${dest}.new`;
  rmSync(tmp, { force: true });
  // A clone when the disk can (APFS: instant, no space); a plain copy elsewhere.
  if (spawnSync('cp', ['-c', src, tmp]).status !== 0) copyFileSync(src, tmp);

  const fd = openSync(tmp, 'r+');
  const written = new Map(); // position → the bytes that must be there
  try {
    const read = (t, row) => { const buf = Buffer.alloc(t.rowBytes); readSync(fd, buf, 0, t.rowBytes, rowAt(model, t, row)); return buf; };
    const write = (t, row, buf) => { writeSync(fd, buf, 0, buf.length, rowAt(model, t, row)); written.set(rowAt(model, t, row), buf); };
    for (const e of edits) {
      const t = model.tensors.find((x) => x.name === e.tensor);
      if (e.op === 'scale') { const buf = read(t, e.row); scaleRowBytes(buf, e.k, `${e.tensor} row ${e.row}`); write(t, e.row, buf); }
      else if (e.op === 'copy') write(t, e.to, read(t, e.from));
      else if (e.op === 'swap') { const a = read(t, e.a); const b = read(t, e.b); write(t, e.a, b); write(t, e.b, a); }
    }
    // Read every changed row back before the copy is allowed to exist.
    for (const [pos, want] of written) {
      const got = Buffer.alloc(want.length); readSync(fd, got, 0, want.length, pos);
      if (!got.equals(want)) throw new Error('a changed row read back differently than written — the copy was discarded');
    }
  } catch (e) { closeSync(fd); rmSync(tmp, { force: true }); throw e; }
  closeSync(fd);
  renameSync(tmp, dest);
  return { file: dest, edits: edits.length, rowsChanged: written.size, bytesChanged: [...written.values()].reduce((a, b) => a + b.length, 0) };
}
