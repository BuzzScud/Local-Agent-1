// Questions about the user's own work, asked twice on the real model: as
// Agentic Coder is without a memory, and with the memory on and Claude's notes
// looked in. Each question has one fact its answer must hold (from the note
// that answers it). Asked from an empty folder, inside the fence, so the
// only way to the fact is the note. The set names the user's own notes and
// work, so it is kept on the Mac (in the results folder), not in the repo.
//   node models/evals/bench/memory/claude-questions.mjs [--only 1,3] [--limit 180] [--no-record] [--set file]
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, DEFAULT_MODEL, ModelServer, Embedder, embedderReady, recordTest, codeLabel, modelFolder } from '../../../index.mjs';
import { runHeadless, openMemory, CLAUDE_RULES, notesDir } from '../../../../terminal/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const results = [join(modelFolder(MODELS[DEFAULT_MODEL]), 'results'), join(homedir(), 'Desktop', 'agentic-coder', 'models', 'bonsai-2-27b', 'results')].find((d) => existsSync(join(d, 'claude-notes-2026-09-28')));
const setFile = opt('set', results ? join(results, 'claude-notes-2026-09-28', 'claude-questions-set.json') : null);
if (!setFile || !existsSync(setFile)) { console.error('The questions are not on this Mac (results/claude-notes-2026-09-28/claude-questions-set.json), or name a file with --set.'); process.exit(2); }
if (!notesDir()) { console.error("Claude's notes were not found on this Mac."); process.exit(2); }
const only = opt('only', null)?.split(',').map(Number);
const limit = Number(opt('limit', 180)) * 1000;
const set = JSON.parse(readFileSync(setFile, 'utf8')).questions.filter((q, i) => !only || only.includes(i + 1));

const model = MODELS[DEFAULT_MODEL];
const server = new ModelServer(model);
const started = await server.start({ ctx: 32768, share: false });
const slots = started.slots > 1 ? { main: 0, side: 1 } : undefined;
const embedder = embedderReady() ? new Embedder() : null;
console.log(`model server up: ctx ${started.ctx}; the notes are found by ${embedder ? 'meaning' : 'their words'}`);
// The memory of the second way: a throwaway one that holds the fifteen lines, as the app's does.
const home = mkdtempSync(join(tmpdir(), 'bonsai-claude-questions-'));
const rows = [];
const t0 = Date.now();
try {
  for (const [i, q] of set.entries()) {
    // --with-only: the second way alone (the first does not change with the notes' wording).
    for (const way of args.includes('--with-only') ? ['with'] : ['without', 'with']) {
      const cwd = join(mkdtempSync(join(tmpdir(), 'bonsai-claude-q-')), 'desk');
      mkdirSync(cwd, { recursive: true });
      writeFileSync(join(cwd, 'README.md'), '# A folder to ask questions from\n');
      if (way === 'with') openMemory(cwd, { home, rules: CLAUDE_RULES });
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), limit);
      const notes = [];
      const did = [];
      let run;
      try {
        run = await runHeadless({ prompt: q.q, cwd, url: server.url, model, thinking: false, ctx: started.ctx, autoApprove: true, answers: () => 'I do not know. Answer from what you have.', signal: ac.signal, slots, warm: !!slots,
          memory: way === 'with' ? { home, save: false, embedder, claude: true } : false,
          onEvent: (type, ev) => { if (type === 'memory' && ev.claude) notes.push(...ev.claude.map((n) => n.id)); if (type === 'tool') did.push(`${ev.label}(${String(ev.arg ?? '').slice(0, 80)})${ev.error ? ' ✗' : ''}`); } });
      } catch (e) { run = { reason: `crash: ${e.message}`, finalText: '', secs: limit / 1000, steps: 0 }; }
      clearTimeout(timer);
      const answer = run.finalText ?? '';
      // The fact must be in the answer, and the answer must not be a guess.
      const right = new RegExp(q.need, 'i').test(answer) && !(q.not && new RegExp(q.not, 'i').test(answer.slice(0, 400)));
      rows.push({ n: i + 1, q: q.q, way, right, secs: Math.round(run.secs), steps: run.steps, reason: ac.signal.aborted ? 'time limit' : run.reason, notes, did, answer: answer.slice(0, 4000) });
      console.log(`${right ? 'RIGHT' : 'wrong'}  ${way.padEnd(7)}  ${String(Math.round(run.secs)).padStart(4)}s  ${String(run.steps).padStart(2)} steps  ${q.q.slice(0, 60)}${notes.length ? `   [${notes.join(', ')}]` : ''}`);
      console.log(`       ${answer.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
  }
} finally {
  await server.stop();
  await embedder?.stop({ keep: false }).catch(() => {});
}
const sum = (way) => { const r = rows.filter((x) => x.way === way); return { right: r.filter((x) => x.right).length, of: r.length, secs: r.reduce((s, x) => s + x.secs, 0), steps: r.reduce((s, x) => s + x.steps, 0) }; };
const a = sum('without'), b = sum('with');
console.log(`\nwithout a memory: ${a.right} of ${a.of} right, ${a.secs} s, ${a.steps} steps\nwith Claude's notes: ${b.right} of ${b.of} right, ${b.secs} s, ${b.steps} steps`);
const out = join(dirname(setFile), opt('out', 'questions.json'));
writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), code: codeLabel(root), without: a, with: b, rows }, null, 1));
if (!args.includes('--no-record')) recordTest({ kind: 'other', name: `Questions about your own work, with Claude's notes (${b.right} of ${b.of}) and without (${a.right} of ${a.of})`, code: codeLabel(root), effort: 'low', ctx: started.ctx, passed: b.right, total: b.of, secs: Math.round((Date.now() - t0) / 1000), note: `without a memory ${a.right} of ${a.of} in ${a.secs} s; with the notes ${b.right} of ${b.of} in ${b.secs} s`, raw: out.replace(`${homedir()}/Desktop/bonsai-code/`, '') });
process.exit(0);
