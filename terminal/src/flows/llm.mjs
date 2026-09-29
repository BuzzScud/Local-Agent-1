// One focused model call: a short system prompt, one user message, no tools.
// Optionally forced into a JSON shape (the server constrains the output).
// thinking: think first, at the chat's level (Medium/High); used for writing
// code and tests. Sorting and choosing (JSON answers) never think.
import { streamChat } from '../agent/client.mjs';

// Whoever wants a count of every focused call's tokens (the agent, while a
// focused path runs, for the "done" line and the practice bench).
export const tallies = new Set();
// Every call the focused paths and checks make, for a practice run's count
// of the model's own calls (headless.mjs), and how many are answering now
// (the code search waits for them, tools/codeindex.mjs).
export const llmCalls = { n: 0, now: 0 };

// Writing tests and drafting (the work before the tries) think at most this
// much; the tries keep the model's whole cap. On practice task 28 at High
// every one of those calls thought to the 4,096 cap (about 4 min each), and
// the run used its 30 minutes before its first try (low-vs-high-2026-09-29).
export const SETUP_THINK_CAP = 2048;

// thinkCap: a smaller thinking cap for this one call (the server's
// --reasoning-budget stays the model's thinkingBudget).
export async function complete({ url, model, slot, system, user, instructions = '', temperature, maxTokens = 1500, schema, signal, onToken, thinking = false, effort, thinkCap }) {
  if (instructions) system = `${instructions}\n\nCurrent subtask (follow its output format):\n${system}`;
  llmCalls.n++;
  llmCalls.now++;
  try { return await ask({ url, model, slot, system, user, temperature, maxTokens, schema, signal, onToken, thinking, effort, thinkCap }); } finally { llmCalls.now--; }
}

async function ask({ url, model, slot, system, user, temperature, maxTokens, schema, signal, onToken, thinking, effort, thinkCap }) {
  const t0 = Date.now();
  const think = Boolean(thinking) && !schema;
  const base = think ? model.thinkingSampling ?? model.sampling : model.sampling;
  const sampling = { ...base, ...(temperature !== undefined ? { temperature } : {}) };
  const extra = schema ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', schema } } } : undefined;
  let text = '';
  let tokens = 0;
  let thought = 0;
  const full = model.thinkingBudget ?? 2048;
  const budget = think ? Math.min(full, thinkCap ?? full) : 0;
  for await (const ev of streamChat({ url, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], thinking: think, effort, model, sampling, maxTokens: maxTokens + budget, thinkCap: think && budget < full ? budget : undefined, slot, signal, extra })) {
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
