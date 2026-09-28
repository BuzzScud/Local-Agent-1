// Runs the scripted session's tool calls for real on a copy of demo-project/
// and writes session.json: every step with its start/end time (seconds,
// estimated real time on your Mac) and the real tool results.
import { cpSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from '../../src/tools/read.mjs';
import { planEdit, applyEdit } from '../../src/tools/edit.mjs';
import { runCommand } from '../../src/tools/run.mjs';
import * as S from './script.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = (s) => Math.max(1, Math.ceil(s.length / 3.6));

const work = mkdtempSync(join(tmpdir(), 'agentic-demo-'));
cpSync(join(here, '../../demo-project'), work, { recursive: true });

let t = 0;
let ctx = S.SYSTEM_TOKENS;
let out = 0; // tokens the model generated this turn
const recorded = [];

for (const step of S.steps) {
  const r = { ...step, t0: t };
  if (step.kind === 'user') {
    t += step.typing;
    ctx += tokens(step.text);
  } else if (step.kind === 'prefill') {
    t += step.tokens / S.PREFILL_TPS;
  } else if (step.kind === 'think' || step.kind === 'text' || step.kind === 'final') {
    r.tokens = tokens(step.text);
    t += r.tokens / S.DECODE_TPS;
    out += r.tokens; ctx += r.tokens;
  } else if (step.kind === 'todos') {
    r.tokens = tokens(JSON.stringify(step.items)) + 8;
    t += r.tokens / S.DECODE_TPS;
    out += r.tokens; ctx += r.tokens;
    r.tResult = t;
    t += 12 / S.PREFILL_TPS;
    ctx += 12;
  } else if (step.kind === 'tool') {
    r.tokens = tokens(JSON.stringify(step.args)) + 8;
    t += r.tokens / S.DECODE_TPS;
    out += r.tokens; ctx += r.tokens;
    r.tCall = t; // call fully written
    let resultText = '';
    if (step.tool === 'Read') {
      const res = readFile(join(work, step.args.path));
      r.result = { lineCount: res.lineCount };
      resultText = res.numbered;
    } else if (step.tool === 'Update') {
      const plan = planEdit(join(work, step.args.path), step.args.old, step.args.new);
      if (!plan.ok) throw new Error(plan.error);
      r.result = { hunk: plan.hunk, additions: plan.additions, removals: plan.removals };
      resultText = `Updated ${step.args.path}.`;
    }
    if (step.permission) {
      r.tAsk = t;
      t += step.permission.wait;
    }
    if (step.tool === 'Update') applyEdit(planEdit(join(work, step.args.path), step.args.old, step.args.new));
    if (step.tool === 'Bash') {
      const res = await runCommand(step.args.command, { cwd: work });
      r.result = { code: res.code, ms: res.ms, lines: res.lines };
      resultText = res.lines.join('\n');
      t += res.ms / 1000;
    }
    r.tResult = t;
    const rt = tokens(resultText);
    t += rt / S.PREFILL_TPS;
    ctx += rt;
  }
  r.t1 = t;
  r.ctx = ctx;
  r.out = out;
  recorded.push(r);
}

rmSync(work, { recursive: true, force: true });
const session = {
  model: S.MODEL, task: S.TASK, systemTokens: S.SYSTEM_TOKENS, cwd: S.DISPLAY_CWD, contextWindow: S.CONTEXT_WINDOW, ramGb: S.RAM_GB,
  decodeTps: S.DECODE_TPS, prefillTps: S.PREFILL_TPS, total: t, recordedAt: new Date().toISOString(),
  steps: recorded,
};
writeFileSync(join(here, 'session.json'), JSON.stringify(session, null, 2));
console.log(`recorded ${recorded.length} steps, ${t.toFixed(1)} s estimated, context ${ctx} tokens`);
for (const r of recorded) console.log(r.kind.padEnd(7), (r.tool ?? '').padEnd(6), r.t0.toFixed(1).padStart(6), '→', r.t1.toFixed(1).padStart(6), r.result ? JSON.stringify(r.result).slice(0, 90) : '');
