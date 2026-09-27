import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const R = new URL('../../../', import.meta.url).pathname.replace(/\/$/, ''); // the repo
const { runHeadless } = await import(`${R}/terminal/index.mjs`);
const { MODELS, DEFAULT_MODEL } = await import(`${R}/models/registry.mjs`);
const only = process.argv[2]?.split(',');
for (const task of readdirSync(`${R}/models/evals/bench/tasks`).sort().filter((t) => !only || only.some((o) => t.startsWith(o)))) {
  const dir = mkdtempSync(join(tmpdir(), `flows-${task}-`));
  const work = join(dir, 'project');
  cpSync(`${R}/models/evals/bench/tasks/${task}/project`, work, { recursive: true });
  writeFileSync(join(dir, 'started'), '');
  spawnSync('sleep', ['1']);
  const prompt = readFileSync(`${R}/models/evals/bench/tasks/${task}/task.txt`, 'utf8').trim();
  const t0 = Date.now();
  const tries = [];
  const r = await runHeadless({ prompt, cwd: work, url: 'http://127.0.0.1:17650', model: MODELS[DEFAULT_MODEL], thinking: false, ctx: 16384, autoApprove: true, slots: { main: 0, side: 1 }, warm: true,
    onEvent: (type, ev) => { if (type === 'tool') process.stdout.write(`   ${ev.error ? '✗' : '·'} ${ev.label}(${String(ev.arg).slice(0, 40)})\n`); if (type === 'note') process.stdout.write(`   ! ${ev.text}\n`); } });
  writeFileSync(join(dir, 'answer.txt'), r.finalText ?? '');
  const check = spawnSync('/bin/zsh', [`${R}/models/evals/bench/tasks/${task}/check.sh`], { cwd: work, encoding: 'utf8' });
  console.log(`${check.status === 0 ? 'PASS' : 'FAIL'} ${task.padEnd(16)} ${Math.round((Date.now() - t0) / 1000)}s  ${check.status === 0 ? '' : (check.stdout + check.stderr).trim().split('\n').pop()}  | ${r.finalText.slice(0, 140)}`);
  rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
