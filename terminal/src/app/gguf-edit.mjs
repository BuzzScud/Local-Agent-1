// Writing weight edits into a COPY of the model file (never the original).
// This is the save-and-restart route's writer: it clones the model (free on
// APFS), changes whole rows in the copy, checks every changed byte, and only
// then puts the copy in place. The file format is decoded by the same Core
// the Weights tab uses (the <script id="core"> in weights.html), so the
// writer and the viewer can never disagree about where a byte lives.
//
// What an edit can be. Every step is the page's own (Core.editRow and what it uses), so the
// copy holds exactly what the Weights tab showed before Save. The types: every one kept in
// blocks with a scale (the old 27B's PQ2_0, Gemma's Q4_0, Qwen's Q4_K, Q5_K, Q6_K and Q8_0)
// and plain numbers (F32, F16, BF16: the small parts, such as a layer's normalisation vector).
//   { op: 'scale', tensor, row, k }       one row up (k>1), down (k<1) or off (k=0). In blocks: the
//                                         block scales (Q4_K and Q5_K a scale and a floor) are
//                                         multiplied, the stored numbers stay, so it is exact.
//   { op: 'range', tensor, from, to, k }  the same for rows from … to (both included).
//   { op: 'set', tensor, row, col, value } one weight. Plain numbers: exactly that value. In blocks:
//                                         the stored number whose value is nearest; the block's
//                                         scale and its other weights stay as they are.
//   { op: 'col', tensor, col, k }         one column times k: every row's weight there, each to its
//                                         nearest step in blocks (plain numbers: exactly).
//   { op: 'copy',  tensor, from, to }     make row `to` an exact copy of row `from`.
//   { op: 'swap',  tensor, a, b }         exchange two rows.
// One weight and a column are refused on PQ2_0: its rows were mixed before storing, so one
// real weight is spread over the whole row. Edits apply in the order given: a copy after a
// scale copies the scaled row.
import { closeSync, copyFileSync, existsSync, openSync, readSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import html from './weights.html' with { type: 'text' };
import { MODELS, modelPath } from '../../../models/index.mjs';
import { coreFrom } from './weights-core.mjs';

// The page's Core, run outside the page.
export const Core = coreFrom(html);
const blockBytes = (t) => Core.BLOCK[t.type][1];
// fp16 encode (round to nearest, ties to even): the page's own, Core.half is the decode.
export const toHalf = Core.toHalf;

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
    const scales = []; if (Core.SCALE_AT[t.type]) for (let b = 0; b < t.rowBytes; b += blockBytes(t)) scales.push(Core.half(buf.readUInt16LE(b + Core.SCALE_AT[t.type][0])));
    // the row as the numbers the model computes with
    const dec = Core.decodeRows(t, new Uint8Array(buf.buffer, buf.byteOffset, buf.length), 1);
    return { bytes: buf, scales, weights: Core.realRow(t, dec, 0, null, new Float32Array(t.ne0)) };
  } finally { closeSync(fd); }
}

// Says what is wrong with an edit list, or nothing when it is fine.
function validateEdits(model, edits) {
  if (!Array.isArray(edits) || !edits.length) throw new Error('no edits to apply');
  const kinds = [...Object.keys(Core.SCALE_AT), ...Object.keys(Core.PLAIN)].map((k) => Core.TYPES[k]).join(', ');
  for (const e of edits) {
    const t = model.tensors.find((x) => x.name === e.tensor);
    if (!t) throw new Error(`no tensor named ${e.tensor}`);
    if (!t.rowBytes || (!Core.canScale(t) && e.op !== 'copy' && e.op !== 'swap')) throw new Error(`${e.tensor} is ${t.typeName}, which cannot be edited: only ${kinds} can`);
    const row = (r, what) => { if (!Number.isInteger(r) || r < 0 || r >= t.rows) throw new Error(`${e.tensor} has rows 0–${t.rows - 1}; ${what} ${r} is outside them`); };
    const col = (c) => { if (!Number.isInteger(c) || c < 0 || c >= t.ne0) throw new Error(`${e.tensor} has columns 0–${t.ne0 - 1}; column ${c} is outside them`); };
    const factor = (k) => { if (!Number.isFinite(k) || k < 0 || k > 16) throw new Error(`the factor must be between 0 and 16, not ${k}`); };
    const one = () => { if (!Core.canSet(t)) throw new Error(`${e.tensor} is ${t.typeName}: its rows were mixed before storing, so one weight or a column cannot be changed on its own (scale the whole row)`); };
    if (e.op === 'scale') { row(e.row, 'row'); factor(e.k); }
    else if (e.op === 'range') { row(e.from, 'row'); row(e.to, 'row'); if (e.to < e.from) throw new Error(`rows ${e.from} to ${e.to}: the first comes after the last`); factor(e.k); }
    else if (e.op === 'set') { one(); row(e.row, 'row'); col(e.col); if (!Number.isFinite(e.value)) throw new Error(`the new value must be a number, not ${e.value}`); }
    else if (e.op === 'col') { one(); col(e.col); factor(e.k); }
    else if (e.op === 'copy') { row(e.from, 'row'); row(e.to, 'row'); if (e.from === e.to) throw new Error('copy needs two different rows'); }
    else if (e.op === 'swap') { row(e.a, 'row'); row(e.b, 'row'); if (e.a === e.b) throw new Error('swap needs two different rows'); }
    else throw new Error(`unknown edit ${JSON.stringify(e.op)}`);
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
  // What must be in the copy, row by row: the last whole-row write (later block writes patched into it),
  // or the blocks written in a row no whole-row write reached. Read back at the end.
  const written = new Map(); // tensor:row → { pos, full: Buffer | null, blocks: Map(position → Buffer) }
  try {
    const read = (t, row) => { const buf = Buffer.alloc(t.rowBytes); readSync(fd, buf, 0, t.rowBytes, rowAt(model, t, row)); return buf; };
    const write = (t, row, buf, at = 0) => {
      const pos = rowAt(model, t, row); writeSync(fd, buf, 0, buf.length, pos + at);
      const key = `${t.name}:${row}`; const w = written.get(key) ?? { pos, full: null, blocks: new Map() }; written.set(key, w);
      if (at === 0 && buf.length === t.rowBytes) { w.full = Buffer.from(buf); w.blocks.clear(); }
      else if (w.full) buf.copy(w.full, at); else w.blocks.set(pos + at, Buffer.from(buf));
    };
    // One edit on one row, with the row named when it cannot be done (a scale too big for fp16, a value too big for F16).
    const onRow = (t, e, r, buf) => { try { Core.editRow(t, buf, 0, r, e); } catch (err) { throw new Error(`${e.tensor} row ${r}: ${err.message}`); } };
    for (const e of edits) {
      const t = model.tensors.find((x) => x.name === e.tensor);
      if (e.op === 'scale' || e.op === 'set') { const buf = read(t, e.row); onRow(t, e, e.row, buf); write(t, e.row, buf); }
      else if (e.op === 'range') for (let r = e.from; r <= e.to; r++) { const buf = read(t, r); onRow(t, e, r, buf); write(t, r, buf); }
      else if (e.op === 'col') {
        // only the block (or the number) that holds the column, in every row: a column of the word table is 262,144 small writes, not 566 MB
        const B = Core.BLOCK[t.type], P = Core.PLAIN[t.type]; const at = B ? Math.floor(e.col / B[0]) * B[1] : e.col * P; const n = B ? B[1] : P;
        const part = { ...t, ne0: B ? B[0] : 1, rowBytes: n }; const partEdit = { ...e, col: B ? e.col % B[0] : 0 };
        for (let r = 0; r < t.rows; r++) { const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, rowAt(model, t, r) + at); onRow(part, partEdit, r, buf); write(t, r, buf, at); }
      }
      else if (e.op === 'copy') write(t, e.to, read(t, e.from));
      else if (e.op === 'swap') { const a = read(t, e.a); const b = read(t, e.b); write(t, e.a, b); write(t, e.b, a); }
    }
    // Read every changed row back before the copy is allowed to exist.
    for (const w of written.values()) for (const [pos, want] of [...(w.full ? [[w.pos, w.full]] : []), ...w.blocks]) {
      const got = Buffer.alloc(want.length); readSync(fd, got, 0, want.length, pos);
      if (!got.equals(want)) throw new Error('a changed row read back differently than written — the copy was discarded');
    }
  } catch (e) { closeSync(fd); rmSync(tmp, { force: true }); throw e; }
  closeSync(fd);
  renameSync(tmp, dest);
  return { file: dest, edits: edits.length, rowsChanged: written.size, bytesChanged: [...written.values()].reduce((a, w) => a + (w.full ? w.full.length : 0) + [...w.blocks.values()].reduce((x, b) => x + b.length, 0), 0) };
}
