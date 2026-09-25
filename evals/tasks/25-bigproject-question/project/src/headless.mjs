// Runs one prompt start to finish without the terminal UI: used by the
// practice-task runner and by `bonsai -p "…"`.
import { Agent } from './agent/agent.mjs';
import { systemPrompt, projectNotes, gitSummary } from './agent/prompt.mjs';
import { toolSchemas } from './agent/tools.mjs';
import { warmUp } from './server/warmup.mjs';

export async function runHeadless({ prompt, cwd, url, model, thinking, effort, ctx, autoApprove = false, approve, signal, onEvent = () => {}, flows = true, slots, warm = false }) {
  const system = systemPrompt({ cwd, notes: projectNotes(cwd).text, git: gitSummary(cwd) });
  const agent = new Agent({
    url, model, cwd, system, thinking, effort, ctx, mode: autoApprove ? 'edits' : 'ask', flows: flows !== false, slots,
    // approve(req) → false says no to one request even when auto-approving.
    ask: async (req) => ({ choice: autoApprove && (!approve || approve(req)) ? 'yes' : 'no' }),
  });
  // bonsai -p started the server itself: restore (or read) the instructions first.
  if (warm && slots) await warmUp({ url, model, system, tools: toolSchemas(), thinking, effort: agent.effort, slot: slots.main, signal }).catch(() => {});
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
    toolErrors: log.filter((e) => e.type === 'tool' && e.error).length,
    outTokens: agent.stats.outTokens, tps: agent.stats.tps, ctxUsed: agent.ctxUsed,
  };
}
