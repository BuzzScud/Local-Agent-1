// Does the right one of Claude's notes come back? Through the memory's own
// code (terminal: recallClaude) with the real small model, on the real notes.
// The set names the user's own notes, so it is kept on the Mac (in the
// results folder), not in the repo:
//   30 requests that one note answers   right = a note it names comes back
//   20 requests that need no note       wrong = any note comes back
// The bar: 27 of 30 right, and at most 2 of 20 wrong.
//   node models/evals/bench/memory/claude-notes.mjs [--words] [--scores] [--no-record] [--set file]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Embedder, embedderReady, EMBEDDERS, DEFAULT_EMBEDDER, recordTest, codeLabel, modelFolder, MODELS, DEFAULT_MODEL } from '../../../index.mjs';
import { recallClaude, notesDir, notesCount, NOTES_CUT, NOTES_MARGIN } from '../../../../terminal/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const results = [join(modelFolder(MODELS[DEFAULT_MODEL]), 'results'), join(homedir(), 'Desktop', 'agentic-coder', 'models', 'bonsai-2-27b', 'results')].find((d) => existsSync(join(d, 'claude-notes-2026-09-28')));
const setFile = opt('set', results ? join(results, 'claude-notes-2026-09-28', 'claude-notes-set.json') : null);
if (!setFile || !existsSync(setFile)) { console.error('The set of requests is not on this Mac (results/claude-notes-2026-09-28/claude-notes-set.json), or name one with --set.'); process.exit(2); }
const set = JSON.parse(readFileSync(setFile, 'utf8'));
const dir = notesDir();
if (!dir) { console.error("Claude's notes were not found on this Mac (BONSAI_CLAUDE_NOTES names the folder)."); process.exit(2); }
const words = args.includes('--words');
const model = EMBEDDERS[DEFAULT_EMBEDDER];
if (!words && !embedderReady(model)) { console.error(`${model.name} is not on this Mac yet. Run: coding setup   (or --words to match by words)`); process.exit(2); }

const count = notesCount(dir);
console.log(`${count.all} notes in ${dir.replace(homedir(), '~')}: ${count.used} used, ${count.leftOut.length} left out (sign-ins, servers, secrets)`);
const embedder = words ? null : new Embedder(model);
const t0 = Date.now();
if (embedder) await embedder.start({ lingerSecs: 0 });
const loadSecs = (Date.now() - t0) / 1000;
const cwd = join(homedir(), 'Desktop', 'somewhere');
let right = 0, wrong = 0, ms = 0, first = 0;
const detail = [];
try {
  const t1 = Date.now();
  await recallClaude(cwd, 'warm up', { embedder, dir }); // the notes' numbers, worked out once
  first = (Date.now() - t1) / 1000;
  for (const r of set.test) {
    const got = await recallClaude(cwd, r.q, { embedder, dir, ...(args.includes('--scores') ? { top: 3 } : {}) });
    const ids = got.notes.map((n) => n.id);
    const ok = r.want.some((w) => ids.includes(w));
    right += ok; ms += got.ms;
    detail.push({ q: r.q, want: r.want, got: got.notes.map((n) => ({ id: n.id, close: n.close, chars: n.part.length })), right: ok, ms: got.ms });
    console.log(`  ${ok ? 'ok ' : 'NO '} ${r.q.slice(0, 58).padEnd(58)} → ${got.notes.map((n) => `${n.id} ${n.close}/${n.words}`).join(' · ') || '-'}`);
  }
  for (const q of set.none) {
    const got = await recallClaude(cwd, q, { embedder, dir });
    const bad = got.notes.length > 0;
    wrong += bad; ms += got.ms;
    detail.push({ q, want: [], got: got.notes.map((n) => ({ id: n.id, close: n.close })), wrong: bad, ms: got.ms });
    console.log(`  ${bad ? 'WRONG' : 'ok   '} ${q.slice(0, 56).padEnd(56)} → ${got.notes.map((n) => `${n.id} ${n.close}/${n.words}`).join(' · ') || '-'}`);
  }
} finally {
  await embedder?.stop({ keep: false });
}
const n = set.test.length + set.none.length;
const pass = right >= 27 && wrong <= 2;
const name = words ? 'by words' : model.name;
console.log(`\n${name}: ${right} of ${set.test.length} right, ${wrong} of ${set.none.length} wrong · ${(ms / n).toFixed(0)} ms a request${embedder ? ` · model loaded in ${loadSecs.toFixed(1)} s, the notes read the first time in ${first.toFixed(1)} s` : ''} · the bar is 27 right and at most 2 wrong · ${pass ? 'PASS' : 'FAIL'}`);
const out = join(dirname(setFile), `recall-${words ? 'words' : 'meaning'}.json`);
writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), how: name, cut: NOTES_CUT, margin: NOTES_MARGIN, notes: count.used, leftOut: count.leftOut.length, right, of: set.test.length, wrong, ofNone: set.none.length, msEach: ms / n, loadSecs, firstSecs: first, pass, detail }, null, 1));
if (!args.includes('--no-record')) recordTest({ kind: 'other', name: `Claude's notes: the right note comes back (${name})`, code: codeLabel(root), passed: right + (set.none.length - wrong), total: n, secs: Math.round((Date.now() - t0) / 1000), note: `${right} of ${set.test.length} right, ${wrong} of ${set.none.length} wrong, ${count.used} notes`, raw: out.replace(`${homedir()}/Desktop/bonsai-code/`, '') });
process.exit(pass ? 0 : 1);
