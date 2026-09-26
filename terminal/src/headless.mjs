// Runs one prompt start to finish without the terminal UI: used by the
// practice-task runner and by `bonsai -p "…"`.
import { Agent } from './agent/agent.mjs';
import { systemPrompt, projectNotes, gitSummary, SESSION_MARK } from './agent/prompt.mjs';
import { toolSchemas } from './agent/tools.mjs';
import { warmUp } from '../../models/index.mjs';

export async function runHeadless({ prompt, cwd, url, model, thinking, effort, ctx, autoApprove = false, approve, answers, signal, onEvent = () => {}, flows = true, slots, warm = false }) {
  const system = systemPrompt({ cwd, notes: projectNotes(cwd).text, git: gitSummary(cwd) });
  const agent = new Agent({
    url, model, cwd, system, thinking, effort, ctx, mode: autoApprove ? 'edits' : 'ask', flows: flows !== false, slots,
    // approve(req) → false says no to one request even when auto-approving.
    // answers(question, req) → the reply to one of Bonsai's questions (null = no answer);
    // set answers.steers = true to also answer its plans (req.kind 'plan') and check-ins ('checkin').
    ask: async (req) => {
      if (req.name === 'Ask') {
        // A plan to confirm or a check-in goes to answers only when it steers
        // (answers.steers = true); otherwise the plan is approved and the
        // check-in carries on, as when no one is watching.
        const steering = req.kind === 'plan' || req.kind === 'checkin';
        if (steering && !answers?.steers) return autoApprove ? { choice: 'answer', text: req.kind === 'plan' ? 'yes' : 'keep going' } : { choice: 'no' };
        const text = answers ? await answers(req.args.question, req) : null;
        if (text != null) return { choice: 'answer', text: String(text) };
        return autoApprove ? { choice: 'answer', text: 'I do not know. If the files do not tell you, stop and tell me what you found; do not invent anything.' } : { choice: 'no' };
      }
      return { choice: autoApprove && (!approve || approve(req)) ? 'yes' : 'no' };
    },
  });
  // bonsai -p started the server itself: restore (or read) the instructions first.
  if (warm && slots) await warmUp({ sessionMark: SESSION_MARK, url, model, system, tools: toolSchemas(), thinking, effort: agent.effort, slot: slots.main, signal }).catch(() => {});
  const log = [];
  let finalText = '';
  for (const type of ['assistant', 'tool', 'note', 'todos', 'compacted', 'tries-done', 'route']) {
    agent.on(type, (ev) => {
      log.push({ type, ...ev, at: Date.now() });
      if (type === 'assistant' && ev.final) finalText = ev.text;
      onEvent(type, ev);
    });
  }
  const t0 = Date.now();
  const reason = await agent.send(prompt, { signal });
  return {
    reason, finalText, log, messages: agent.messages, secs: (Date.now() - t0) / 1000,
    steps: log.filter((e) => e.type === 'tool').length,
    asked: log.filter((e) => e.type === 'tool' && e.label === 'Ask').map((e) => ({ question: String(e.arg), answer: e.view?.text ?? null })),
    toolErrors: log.filter((e) => e.type === 'tool' && e.error).length,
    outTokens: agent.stats.outTokens, tps: agent.stats.tps, ctxUsed: agent.ctxUsed,
  };
}
