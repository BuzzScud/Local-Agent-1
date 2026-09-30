// Edited copy vs original (models/evals/tools/edited-check.mjs), with two stand-in servers: the six
// fixed questions and your words go to the original and to the copy, each line is printed as the
// Arena counts it, the copy losing a question fails the run, and the record line, the raw answers and
// the results page are written. Its own process and temp home (the manifests live in the models
// folder), its own docs folder and record: it never sees the real ones, and no model loads.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const repo = join(import.meta.dir, '..', '..');
const SCRIPT = join(repo, 'models', 'evals', 'tools', 'edited-check.mjs');
const COPY = 'gemma-4-12B-it-qat-UD-Q4_K_XL-edited.gguf';

// A GGUF with a word list and one tensor: all the check reads from the copy.
function gguf(kv, tensors) {
  const parts = []; const push = (b) => parts.push(Buffer.from(b));
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); push(b); }; const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); u64(b.length); push(b); };
  push(Buffer.from('GGUF')); u32(3); u64(tensors.length); u64(kv.length);
  for (const [k, type, v] of kv) { str(k); u32(type); if (type === 8) str(v); else if (type === 9) { u32(v.type); u64(v.items.length); for (const x of v.items) v.type === 8 ? str(x) : i32(x); } else u32(v); }
  let off = 0; const offs = []; for (const t of tensors) { offs.push(off); off = Math.ceil((off + t.data.length) / 32) * 32; }
  tensors.forEach((t, i) => { str(t.name); u32(t.dims.length); for (const d of t.dims) u64(d); u32(t.type); u64(offs[i]); });
  let head = Buffer.concat(parts); head = Buffer.concat([head, Buffer.alloc(Math.ceil(head.length / 32) * 32 - head.length)]);
  const data = Buffer.alloc(off); tensors.forEach((t, i) => t.data.copy(data, offs[i])); return Buffer.concat([head, data]);
}
function home({ edits }) {
  const h = mkdtempSync(join(tmpdir(), 'agentic-edited-check-')); const models = join(h, 'models'); mkdirSync(models, { recursive: true }); mkdirSync(join(h, 'docs', 'tests'), { recursive: true });
  writeFileSync(join(models, COPY), gguf([['general.architecture', 8, 'gemma4'], ['tokenizer.ggml.model', 8, 'llama'], ['tokenizer.ggml.tokens', 9, { type: 8, items: ['<pad>', '▁king', '▁queen', '<start_of_turn>'] }], ['tokenizer.ggml.token_type', 9, { type: 5, items: [3, 1, 1, 3] }]], [{ name: 'token_embd.weight', dims: [4, 4], type: 0, data: Buffer.alloc(64) }]));
  if (edits) writeFileSync(join(models, 'edited-gemma.json'), JSON.stringify({ base: 'gemma', file: COPY, saved: '2026-09-30T15:00:00.000Z', edits }));
  return h;
}
// A stand-in llama-server: `answer(question)` is what it says.
async function server(answer, tps) {
  const s = createServer((req, res) => { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { const q = JSON.parse(body).messages[0].content; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: answer(q) } }], timings: { predicted_per_second: tps } })); }); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r)); return { s, url: `http://127.0.0.1:${s.address().port}` };
}
const RIGHT = (q) => (/17 × 23/.test(q) ? '391' : /capital of Japan/.test(q) ? 'Tokyo' : /2, 4, 8, 16/.test(q) ? '32' : /console\.log/.test(q) ? '2-4-6' : /backwards/.test(q) ? 'thgiew' : /Tokyo a big city/.test(q) ? '**Japan**' : /Repeat this exactly/.test(q) ? q.split(': ').pop() : 'function parse() {}');
function run(h, extra) {
  return new Promise((resolve) => {
    const c = spawn('node', [SCRIPT, '--model', 'gemma', '--out', join(h, 'raw'), ...extra], { env: { ...process.env, AGENTIC_HOME: h, AGENTIC_DOCS: join(h, 'docs'), AGENTIC_TEST_RECORD: join(h, 'record.jsonl'), FORCE_COLOR: '' }, cwd: repo });
    let out = '', err = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; }); c.on('exit', (code) => resolve({ code, out, err }));
  });
}

test('the copy losing a fixed question fails the run; your words are asked and shown; record, raw answers and page are written', async () => {
  const h = home({ edits: [{ op: 'scale', tensor: 'token_embd.weight', row: 1, k: 0 }, { op: 'swap', tensor: 'token_embd.weight', a: 2, b: 3 }, { op: 'scale', tensor: 'blk.0.ffn_up.weight', row: 0, k: 2 }] });
  const a = await server(RIGHT, 40), b = await server((q) => (/capital of Japan/.test(q) ? 'Kyoto' : /nothing else: king$/.test(q) ? 'kin' : RIGHT(q)), 39.5);
  try {
    const r = await run(h, ['--url-original', a.url, '--url-edited', b.url]);
    expect([r.code, r.err]).toEqual([0, '']);
    const lines = r.out.split('\n'); const count = (re) => lines.filter((l) => re.test(l)).length;
    expect(count(/^PASS original · /)).toBe(8); // the six, and "king" and "queen" written back
    expect(count(/^ASKED original · “<start_of_turn>” \(row 3\)/)).toBe(1); // a special token: shown, not asked
    expect(count(/^FAIL edited · the capital of Japan → "Kyoto"/)).toBe(1);
    expect(count(/^FAIL edited · repeat “ king” \(row 1\) → "kin"/)).toBe(1);
    expect(count(/^PASS edited · repeat “ queen” \(row 2\)/)).toBe(1);
    expect(count(/^(PASS|FAIL|ASKED)\s/)).toBe(18); // what the Arena counts: 9 a side
    expect(r.out).toContain('the copy 5 of 6, the original 6 · FAILED');
    const s = JSON.parse(readFileSync(join(h, 'raw', 'summary.json'), 'utf8'));
    expect([s.original, s.edited, s.lost, s.words, s.wordsOriginal, s.wordsEdited, s.pass, s.stopped]).toEqual([6, 5, 1, 3, 2, 1, false, false]);
    const rec = readFileSync(join(h, 'record.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
    expect([rec.kind, rec.name, rec.model, rec.passed, rec.total, rec.result, rec.part]).toEqual(['other', 'Edited copy vs original', 'gemma', 5, 6, 'fail', false]);
    expect(rec.note).toContain('Writing 40.0 → 39.5 tokens a second');
    const pages = readdirSync(join(h, 'docs', 'tests')).filter((f) => f.startsWith('agentic-coder-edited-copy-check-gemma-'));
    expect(pages.length).toBe(1); expect(rec.page).toBe(`tests/${pages[0]}`);
    const html = readFileSync(join(h, 'docs', 'tests', pages[0]), 'utf8');
    for (const t of ['The copy lost 1 of the fixed questions', 'word table · “ king” off', 'word table · “ queen” ⇄ “&lt;start_of_turn&gt;”', 'ffn_up · layer 0 · row 0 ×2', '<meta charset="utf-8">', 'Kyoto']) expect(html).toContain(t);
  } finally { a.s.close(); b.s.close(); }
}, 30000);

test('the same answers pass; with no edited copy it says what to do and runs nothing', async () => {
  const h = home({ edits: [{ op: 'scale', tensor: 'blk.3.attn_q.weight', row: 7, k: 0.5 }] });
  const a = await server(RIGHT, 40), b = await server(RIGHT, 40);
  try {
    const r = await run(h, ['--url-original', a.url, '--url-edited', b.url, '--no-record']);
    expect(r.code).toBe(0); expect(r.out).toContain('the copy 6 of 6, the original 6 · PASSED'); expect(r.out).toContain('a look only');
    expect(existsSync(join(h, 'record.jsonl'))).toBe(false); expect(readdirSync(join(h, 'docs', 'tests'))).toEqual([]);
  } finally { a.s.close(); b.s.close(); }
  const none = await run(home({ edits: null }), []);
  expect(none.code).toBe(2); expect(none.err).toContain('Gemma 4 12B QAT has no edited copy on this Mac: make one on the Weights tab (Save the copy)');
}, 30000);
