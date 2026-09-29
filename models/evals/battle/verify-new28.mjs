// Checks the New 28 without a model: each test's checks must FAIL on its starter files and PASS
// once its known-good answer (its solution/ folder) is laid over them. It proves every test can be
// passed and that doing nothing fails it; how long a model takes is up to its first battle.
//   node models/evals/battle/verify-new28.mjs [--only n05,n12]
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { runChecks, snapshot } from './checks.mjs';
import { NEW28_DIR, readJson } from './store.mjs';

const only = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1].split(',') : null; })();
export function verify(id, from = NEW28_DIR) {
  const base = join(from, id);
  const meta = readJson(join(base, 'meta.json'), {});
  const prompt = readFileSync(join(base, 'task.txt'), 'utf8');
  const once = (withSolution) => {
    const dir = mkdtempSync(join(tmpdir(), 'battle-verify-'));
    const work = join(dir, 'project');
    cpSync(join(base, 'project'), work, { recursive: true });
    writeFileSync(join(dir, 'started'), '');
    const before = snapshot(work);
    let answer = '';
    if (withSolution) {
      const sol = join(base, 'solution');
      for (const f of readdirSync(sol, { recursive: true })) {
        const p = join(sol, f);
        if (f === 'answer.txt' || f === '.delete' || !existsSync(p) || readdirSync(dirname(p)).length === 0) continue;
        try { cpSync(p, join(work, f), { recursive: true }); } catch {}
      }
      if (existsSync(join(sol, '.delete'))) for (const f of readFileSync(join(sol, '.delete'), 'utf8').split('\n').filter(Boolean)) rmSync(join(work, f), { force: true });
      if (existsSync(join(sol, 'answer.txt'))) answer = readFileSync(join(sol, 'answer.txt'), 'utf8');
    }
    writeFileSync(join(dir, 'answer.txt'), answer);
    const env = meta.home ? { ...process.env, HOME: work } : process.env;
    const r = runChecks({ checks: meta.checks ?? [], script: join(base, 'check.sh'), work, before, answer, prompt, env });
    rmSync(dir, { recursive: true, force: true });
    return r;
  };
  const before = once(false), after = once(true);
  return { id, title: meta.title, kind: meta.kind, failsFirst: before.pass === false, passesAfter: after.pass === true, why: before.checks.find((c) => !c.pass)?.why ?? '', after: after.checks.filter((c) => !c.pass).map((c) => `${c.label}: ${c.why}`) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = readdirSync(NEW28_DIR).filter((id) => existsSync(join(NEW28_DIR, id, 'meta.json')) && (!only || only.some((o) => id.startsWith(o)))).sort();
  let bad = 0;
  for (const id of ids) {
    const r = verify(id);
    const ok = r.failsFirst && r.passesAfter;
    if (!ok) bad += 1;
    console.log(`${ok ? 'ok  ' : 'BAD '} ${id.padEnd(26)} starter: ${r.failsFirst ? `fails (${r.why.slice(0, 70)})` : 'PASSES (a test that nothing fails)'} · answer: ${r.passesAfter ? 'passes' : `FAILS ${r.after.join(' | ').slice(0, 160)}`}`);
  }
  console.log(`${ids.length - bad} of ${ids.length} tests: fail as given, pass with the known-good answer`);
  process.exit(bad ? 1 : 0);
}
