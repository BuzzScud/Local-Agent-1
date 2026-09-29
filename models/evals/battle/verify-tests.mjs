// Checks the tests that come with the arena without a model: each test's checks must FAIL on its
// starter files and PASS once its known-good answer is laid over them (solution/ for the New 28 and
// the Work 28; reference/ for the Practice 28, in models/evals/bench/tasks/). It proves every test
// can be passed and that doing nothing fails it; how long a model takes is up to its first battle.
//   node models/evals/battle/verify-tests.mjs [--suite new28|work28|practice] [--only n05,w12,p18]
// A known-good answer's answer.txt and asked.txt go beside the project, where a run writes the
// model's final answer and the questions it asked; its .delete lists files the answer removes.
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { runChecks, snapshot } from './checks.mjs';
import { NEW28_DIR, WORK28_DIR, PRACTICE_DIR, practiceList, readJson } from './store.mjs';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const BESIDE = new Set(['answer.txt', 'asked.txt', '.delete']);

// id: the test's folder in `from`. Returns whether it fails as given and passes with its answer.
export function verify(id, from = NEW28_DIR) {
  const base = join(from, id);
  const meta = readJson(join(base, 'meta.json'), {});
  const prompt = readFileSync(join(base, 'task.txt'), 'utf8');
  const sol = ['solution', 'reference'].map((d) => join(base, d)).find((d) => existsSync(d));
  const once = (withSolution) => {
    const dir = mkdtempSync(join(tmpdir(), 'battle-verify-'));
    const work = join(dir, 'project');
    cpSync(join(base, 'project'), work, { recursive: true });
    writeFileSync(join(dir, 'started'), '');
    const before = snapshot(work);
    const beside = { 'answer.txt': '', 'asked.txt': '' };
    if (withSolution && sol) {
      for (const f of readdirSync(sol, { recursive: true })) {
        const p = join(sol, f);
        if (BESIDE.has(f) || !existsSync(p) || readdirSync(dirname(p)).length === 0) continue;
        try { cpSync(p, join(work, f), { recursive: true }); } catch {}
      }
      if (existsSync(join(sol, '.delete'))) for (const f of readFileSync(join(sol, '.delete'), 'utf8').split('\n').filter(Boolean)) rmSync(join(work, f), { force: true });
      for (const f of Object.keys(beside)) if (existsSync(join(sol, f))) beside[f] = readFileSync(join(sol, f), 'utf8');
    }
    for (const [f, text] of Object.entries(beside)) writeFileSync(join(dir, f), text);
    const env = meta.home ? { ...process.env, HOME: work } : process.env;
    const r = runChecks({ checks: meta.checks ?? [], script: join(base, 'check.sh'), work, before, answer: beside['answer.txt'], prompt, env });
    rmSync(dir, { recursive: true, force: true });
    return r;
  };
  const before = once(false), after = sol ? once(true) : { pass: false, checks: [{ pass: false, label: 'Its known-good answer', why: 'there is none' }] };
  return { id, title: meta.title, kind: meta.kind, failsFirst: before.pass === false, passesAfter: after.pass === true, why: before.checks.find((c) => !c.pass)?.why ?? '', after: after.checks.filter((c) => !c.pass).map((c) => `${c.label}: ${c.why}`) };
}

// Every test of the three sets: [{ suite, id (as the arena names it), from, folder }].
export function allTests() {
  const folders = (dir) => (existsSync(dir) ? readdirSync(dir).filter((id) => existsSync(join(dir, id, 'meta.json'))).sort() : []);
  return [
    ...folders(NEW28_DIR).map((id) => ({ suite: 'new28', id, from: NEW28_DIR, folder: id })),
    ...folders(WORK28_DIR).map((id) => ({ suite: 'work28', id, from: WORK28_DIR, folder: id })),
    ...practiceList().map((p) => ({ suite: 'practice', id: p.id, from: PRACTICE_DIR, folder: p.task })),
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const suite = arg('suite'), only = arg('only')?.split(',');
  const list = allTests().filter((t) => (!suite || t.suite === suite) && (!only || only.some((o) => t.id.startsWith(o))));
  let bad = 0;
  for (const t of list) {
    const r = verify(t.folder, t.from);
    const ok = r.failsFirst && r.passesAfter;
    if (!ok) bad += 1;
    console.log(`${ok ? 'ok  ' : 'BAD '} ${t.id.padEnd(28)} starter: ${r.failsFirst ? `fails (${r.why.slice(0, 70)})` : 'PASSES (a test that nothing fails)'} · answer: ${r.passesAfter ? 'passes' : `FAILS ${r.after.join(' | ').slice(0, 160)}`}`);
  }
  console.log(`${list.length - bad} of ${list.length} tests: fail as given, pass with the known-good answer`);
  process.exit(bad ? 1 : 0);
}
