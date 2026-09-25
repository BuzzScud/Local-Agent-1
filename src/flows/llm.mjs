// One focused model call: a short system prompt, one user message, no tools.
// Optionally forced into a JSON shape (the server constrains the output).
import { streamChat } from '../agent/client.mjs';

export async function complete({ url, model, slot, system, user, temperature, maxTokens = 1500, schema, signal, onToken }) {
  const t0 = Date.now();
  const sampling = { ...model.sampling, ...(temperature !== undefined ? { temperature } : {}) };
  const extra = schema ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', schema } } } : undefined;
  let text = '';
  let tokens = 0;
  for await (const ev of streamChat({ url, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], thinking: false, sampling, maxTokens, slot, signal, extra })) {
    if (ev.type === 'text') { text += ev.text; tokens++; onToken?.(tokens); }
  }
  let json = null;
  if (schema) { try { json = JSON.parse(text); } catch { json = null; } }
  return { text, json, tokens, secs: (Date.now() - t0) / 1000 };
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
