// Does the right saved fact come back? 20 facts and 30 requests, through the
// memory's own code (terminal: recall) with the real small model. A request
// is right when the fact it needs comes back (or nothing, when it needs
// nothing) and wrong when a fact that has nothing to do with it comes back.
// The bar: 27 right and at most 3 wrong of 30.
//   node models/evals/bench/memory/recall.mjs [--words] [--no-record]
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Embedder, embedderReady, EMBEDDERS, DEFAULT_EMBEDDER, recordTest, codeLabel } from '../../../index.mjs';
import { recall, memoryDirs, applyChanges, readFacts, filesIn } from '../../../../terminal/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const set = JSON.parse(readFileSync(join(here, 'recall-set.json'), 'utf8'));
const words = process.argv.includes('--words');
const model = EMBEDDERS[DEFAULT_EMBEDDER];
if (!words && !embedderReady(model)) { console.error(`${model.name} is not on this Mac yet. Run: coding setup   (or --words to match by words)`); process.exit(2); }

// A throwaway home and project holding the 20 facts; every file a fact
// names is there, so no fact is left out as "about a file that is gone".
const home = mkdtempSync(join(tmpdir(), 'bonsai-recall-bench-'));
const project = join(home, 'work', 'project');
mkdirSync(join(project, '.git'), { recursive: true });
const dirs = memoryDirs(project, home);
const idOf = new Map();
for (const f of set.facts) {
  for (const p of filesIn(f.text)) { mkdirSync(dirname(join(project, p)), { recursive: true }); writeFileSync(join(project, p), ''); }
  const dir = f.kind === 'you' ? dirs.you : dirs.project;
  const r = applyChanges(dir, { add: [{ kind: f.kind, text: f.text, from: 'the recall check' }] });
  if (!r.added.length) throw new Error(`could not save ${f.id}: ${r.refused[0]?.why}`);
  idOf.set(r.added[0].id, f.id);
}
if (readFacts(dirs.you).length + readFacts(dirs.project).length !== set.facts.length) throw new Error('not every fact was saved');

const embedder = words ? null : new Embedder(model);
const t0 = Date.now();
if (embedder) await embedder.start({ lingerSecs: 0 });
const loadSecs = (Date.now() - t0) / 1000;
let right = 0, wrong = 0, ms = 0;
const detail = [];
try {
  await recall(project, 'warm up', { embedder, home, mark: false }); // the facts' numbers, worked out once
  for (const r of set.test) {
    const got = await recall(project, r.q, { embedder, home, mark: false });
    const ids = got.facts.map((f) => idOf.get(f.id));
    const isRight = (!r.want.length && !ids.length) || r.want.some((w) => ids.includes(w));
    const isWrong = ids.some((g) => !r.want.includes(g) && !(r.ok ?? []).includes(g));
    right += isRight; wrong += isWrong; ms += got.ms;
    detail.push({ q: r.q, want: r.want, got: ids, how: got.how, right: isRight, wrong: isWrong, ms: got.ms });
    console.log(`  ${isRight ? 'ok ' : 'NO '}${isWrong ? 'WRONG ' : '      '}${r.q.slice(0, 56).padEnd(56)} want ${(r.want.join(',') || '-').padEnd(8)} got ${ids.join(',') || '-'}`);
  }
} finally {
  await embedder?.stop({ keep: false });
}
const n = set.test.length;
const pass = right >= 27 && wrong <= 3;
const name = words ? 'by words' : model.name;
console.log(`\n${name}: ${right} right and ${wrong} wrong of ${n} · ${(ms / n).toFixed(0)} ms a request${embedder ? ` · loaded in ${loadSecs.toFixed(1)} s` : ''} · the bar is 27 right and at most 3 wrong: ${pass ? 'reached' : 'not reached'}`);
const out = join(root, 'models', words ? 'bge-m3' : model.folder, 'results', `recall-${new Date().toISOString().slice(0, 10)}${words ? '-words' : ''}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), matcher: name, right, wrong, of: n, ms_per_request: ms / n, load_secs: loadSecs, detail }, null, 1));
if (!process.argv.includes('--no-record')) recordTest({ kind: 'other', name: `Memory: the right fact comes back (${name}, 20 facts, 30 requests)`, code: codeLabel(root), passed: right, total: n, secs: (Date.now() - t0) / 1000, result: pass ? 'pass' : 'fail', note: `${right} right, ${wrong} wrong; the bar is 27 right and at most 3 wrong; ${(ms / n).toFixed(0)} ms a request`, raw: out.slice(root.length + 1) });
process.exit(0);
