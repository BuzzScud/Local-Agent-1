// One focused model call: a short system prompt, one user message, no tools.
// Optionally forced into a JSON shape (the server constrains the output).
// thinking: think first, at the chat's level (Medium/High); used for writing
// code and tests. Sorting and choosing (JSON answers) never think.
import { streamChat } from '../agent/client.mjs';

// Whoever wants a count of every focused call's tokens (the agent, while a
// focused path runs, for the "done" line and the practice bench).
export const tallies = new Set();

export async function complete({ url, model, slot, system, user, temperature, maxTokens = 1500, schema, signal, onToken, thinking = false, effort }) {
  const t0 = Date.now();
  const think = Boolean(thinking) && !schema;
  const base = think ? model.thinkingSampling ?? model.sampling : model.sampling;
  const sampling = { ...base, ...(temperature !== undefined ? { temperature } : {}) };
  const extra = schema ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', schema } } } : undefined;
  let text = '';
  let tokens = 0;
  let thought = 0;
  const budget = think ? model.thinkingBudget ?? 2048 : 0;
  for await (const ev of streamChat({ url, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], thinking: think, effort, model, sampling, maxTokens: maxTokens + budget, slot, signal, extra })) {
    if (ev.type === 'text') { text += ev.text; tokens++; onToken?.(tokens + thought); }
    if (ev.type === 'reasoning') { thought++; onToken?.(tokens + thought); }
  }
  let json = null;
  if (schema) { try { json = JSON.parse(text); } catch { json = null; } }
  for (const t of tallies) { try { t({ tokens, thought }); } catch { /* a count never stops the work */ } }
  return { text, json, tokens, thought, secs: (Date.now() - t0) / 1000 };
}

// The first fenced code block (or the whole reply when it has no fence).
export function extractCode(text) {
  const m = /```[\w.+-]*[ \t]*\n([\s\S]*?)```/.exec(text);
  if (m) return m[1];
  const open = /```[\w.+-]*[ \t]*\n([\s\S]*)$/.exec(text); // cut off before the closing fence
  if (open) return open[1];
  return text.trim() ? text : null;
}

export const fence = (rel, text) => `${rel}:\n\`\`\`${langOf(rel)}\n${text.replace(/\n?$/, '\n')}\`\`\``;
export function langOf(rel) {
  const ext = rel.split('.').pop();
  return { mjs: 'js', cjs: 'js', js: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', json: 'json', md: 'markdown', sh: 'bash' }[ext] ?? '';
}
