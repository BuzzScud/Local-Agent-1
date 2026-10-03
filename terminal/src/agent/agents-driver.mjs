// /agents' driver on the real agent (agents-run.mjs says what a driver is): the model, the
// commands and the files of the window's project. A step of work is a message to the agent
// (agent.send: its tools, its permissions, a /rewind point each); a question that only needs an
// answer (the interview, the plan, a review) is one focused call with no tools (flows/llm.mjs).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { complete } from '../flows/llm.mjs';
import { reviewChange, findingsOf } from './helper-models.mjs';
import { runCommand } from '../tools/run.mjs';
import { testCommand } from './prompt.mjs';

const SKIP = new Set(['node_modules', '.git', '.agentic', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', 'target', 'coverage']);
// The project's files, two folders deep, for the prompts that plan.
export function projectFiles(cwd, max = 60) {
  const out = [];
  const walk = (dir, rel, depth) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= max) return;
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      if (SKIP.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (depth < 2) walk(join(dir, e.name), r, depth + 1); else out.push(`${r}/`); } else out.push(r);
    }
  };
  walk(cwd, '', 0);
  return out;
}

const modelName = (agent) => agent.model?.remote?.model ?? agent.model?.name ?? 'the model';
export function agentDriver(agent, { home = null } = {}) {
  const cwd = () => agent.cwd;
  let saving = null;
  const call = async ({ system, user, maxTokens, signal }) => {
    const r = await complete({ url: agent.url, model: agent.model, slot: agent.slots?.side, system, user, maxTokens, signal, temperature: 0.2 });
    return r.text;
  };
  return {
    get model() { return modelName(agent); },
    get reviewer() { return agent.helperUse?.('review')?.model ?? null; },
    get testCmd() { return agent.testCmd ?? testCommand(cwd()); },
    complete: call,
    // A step goes to the model's own loop: not sorted into the focused paths, and not asked about
    // as a plan first (the run has its plan, and your yes to it); both come back after the step.
    // The run runs the tests itself (a failing test is the point of RED), so the agent's own
    // "tests after a change" waits too.
    // kind: a change (the test, the code, a fix) or a question (Verify: it runs, it changes nothing).
    async send(text, { shown, signal, kind = 'change' } = {}) {
      const keep = { flows: agent.flows, confirmPlan: agent.confirmPlan, testCmd: agent.testCmd, kindFor: agent.kindFor };
      agent.flows = false; agent.confirmPlan = false; agent.testCmd = null; agent.kindFor = kind;
      // The files the step made or changed, from its steps as they are shown.
      const files = new Set();
      const onTool = (ev) => { if (!ev.error && /^(Update|Write|Create)$/.test(ev.label ?? '') && ev.arg) files.add(String(ev.arg)); };
      agent.on('tool', onTool);
      let reason;
      try { reason = await agent.send(text, { shown, signal }); } finally { agent.off('tool', onTool); Object.assign(agent, keep); }
      const last = [...(agent.messages ?? [])].reverse().find((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim());
      return { reason, files: [...files], diff: agent.turn?.diffs ?? '', text: last?.content ?? '' };
    },
    async exec(cmd, { signal } = {}) {
      const r = await runCommand(cmd, { cwd: cwd(), timeoutMs: agent.testTimeoutMs ?? 120_000, maxLines: 80, signal });
      return { code: r.timedOut ? 124 : r.code, out: r.lines.join('\n'), timedOut: r.timedOut, secs: r.ms / 1000 };
    },
    // The review model from /subagents; without one, the main model with a fresh context (a second
    // opinion is a reader that did not write the change).
    async review({ request, diff, signal }) {
      const use = agent.helperUse?.('review');
      if (use) { const r = await reviewChange({ url: agent.url, use, request, diff, signal }); return { ok: r.ok, findings: r.findings, model: use.model }; }
      const text = await call({
        system: 'You review work another assistant just did, with a fresh eye. Report only real problems: a bug, a part of the request not done, something broken or removed by mistake. If there is nothing real, answer exactly: LGTM',
        user: `${String(request).slice(0, 3000)}\n\nThe work (a diff or a plan):\n${String(diff).slice(-16_000) || '(none)'}\n\nList at most 3 real problems, one per line, each starting with "- ". Or answer LGTM.`,
        maxTokens: 500, signal,
      });
      return { ...findingsOf(text), model: modelName(agent) };
    },
    listFiles: () => projectFiles(cwd()),
    read(rel) { try { return readFileSync(join(cwd(), rel), 'utf8'); } catch { return null; } },
    write(rel, text) { const abs = join(cwd(), rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text); },
    // The run's state, so /agents resume can go on after a quit (at most once a second).
    save(state) {
      if (saving) return;
      saving = setTimeout(() => {
        saving = null;
        try { const f = runFile(cwd()); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify({ ...state, gate: null }, null, 1)); } catch { /* the run goes on without its file */ }
      }, 1000);
      saving.unref?.();
    },
    setGuard(fn) { agent.toolGuard = fn; },
    reviewInTurn(on) { agent.reviewInTurn = on; },
    home,
  };
}
export const runFile = (cwd) => join(cwd, '.agentic', 'agents', 'run.json');
// The last run in this folder, when it did not finish: /agents resume goes on from it.
export function savedRun(cwd) {
  try { const s = JSON.parse(readFileSync(runFile(cwd), 'utf8')); return s && !s.endedAt ? s : null; } catch { return null; }
}
