// One focused model call: a short system prompt, one user message, no tools.
// Optionally forced into a JSON shape (the server constrains the output).
// thinking: think first, at the chat's level (Medium/High); used for writing
// code and tests. Sorting and choosing (JSON answers) never think.
import { streamChat } from '../agent/client.mjs';
import { replyTiming } from '../agent/timing.mjs';
import { thinkingKwargs, endpointOf, authHeaders } from '../../../models/index.mjs';

// Whoever wants a count of every focused call's tokens (the agent, while a
// focused path runs, for the "done" line and the practice bench).
export const tallies = new Set();
// Every call the focused paths and checks make, for a practice run's count
// of the model's own calls (headless.mjs), and how many are answering now
// (the code search waits for them, tools/codeindex.mjs).
export const llmCalls = { n: 0, now: 0 };
// Whoever wants each call's time (headless.mjs, for a run's timeline: agent/timing.mjs). what: what the
// call was for, from its caller ("listing the cases", "second look").
export const timers = new Set();

// Writing tests and drafting (the work before the tries) think at most this
// much; the tries keep the model's whole cap. On practice task 28 at High
// every one of those calls thought to the 4,096 cap (about 4 min each), and
// the run used its 30 minutes before its first try (low-vs-high-2026-09-29).
export const SETUP_THINK_CAP = 2048;

// Think when it pays (30 Sep 2026): at High, the first round of tests and drafts
// is written without thinking, and a try after a miss thinks, with the miss in
// front of it (tries.mjs). In the 24 practice tasks of 30 Sep, thinking at High,
// writing tests and drafts took 55-65% of the time and over half of what was
// written was thinking. AGENTIC_THINK=old: every try thinks and nothing steps
// down, as before (the Thinking old vs new test, models/evals/tools/think-ab.mjs).
export const oldThinking = () => (process.env.AGENTIC_THINK === 'old');

// thinkCap: a smaller thinking cap for this one call (the server's
// --reasoning-budget stays the model's thinkingBudget).
export async function complete({ url, model, slot, system, user, instructions = '', temperature, maxTokens = 1500, schema, signal, onToken, thinking = false, effort, thinkCap, use, what }) {
  system = withInstructions(system, instructions);
  llmCalls.n++;
  llmCalls.now++;
  try { return await ask({ url, model, slot, system, user, temperature, maxTokens, schema, signal, onToken, thinking, effort, thinkCap, use, what }); } finally { llmCalls.now--; }
}

const withInstructions = (system, instructions) => (instructions ? `${instructions}\n\nCurrent subtask (follow its output format):\n${system}` : system);

// A pick among a few fixed words in one pass, with nothing written: the
// chance the model gives each of `options` as the next word after `lead` (the
// start of the answer it would write, '{"kind": "'), read from the server's
// token probabilities. Sorting a request this way took about half the time of
// complete() with a schema and picked the same kind on 81 to 84 of 85 lines
// (Qwen 1.4 → 0.6 s, Gemma 2.0 → 0.9 s, 29 Sep 2026). Its confidence did NOT
// tell right picks from wrong ones, so nothing is decided on it.
// Returns { pick, share, conf, mass }, or null when the server cannot give the
// chances (no /apply-template, /tokenize or probabilities) or the options hold
// under half of them (the model meant to write something else): the caller
// then asks with complete().
const noOdds = new Set(); // servers that could not: not asked again
export async function decide({ url, model, slot, system, user, instructions = '', options, lead = '', signal }) {
  // An OpenAI-compatible remote (/remote) has no template, tokens or chances to ask for.
  if (noOdds.has(url) || (endpointOf(url) && endpointOf(url).kind !== 'llama')) return null;
  const post = async (path, body) => {
    const res = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders(url) }, body: JSON.stringify(body), signal });
    return res.ok ? res.json() : null;
  };
  llmCalls.n++;
  llmCalls.now++;
  try {
    const messages = [{ role: 'system', content: withInstructions(system, instructions) }, { role: 'user', content: user }];
    const prompt = (await post('/apply-template', { messages, chat_template_kwargs: thinkingKwargs(model, false) }))?.prompt;
    if (typeof prompt !== 'string') { noOdds.add(url); return null; }
    // Each option written out after the lead, as the model's own tokens. The
    // prompt ends where they first differ, so each option is one token to read,
    // whatever the tokenizer does with the quote in front of it.
    const toks = await Promise.all(options.map((o) => post('/tokenize', { content: prompt + lead + o, add_special: false, parse_special: true }).then((r) => r?.tokens)));
    if (!toks.every((t) => Array.isArray(t) && t.length)) { noOdds.add(url); return null; }
    let n = 0;
    while (toks.every((t) => t[n] !== undefined && t[n] === toks[0][n])) n++;
    const first = toks.map((t) => t[n]);
    if (first.some((id) => id === undefined) || new Set(first).size !== options.length) return null;
    const r = await post('/completion', { prompt: toks[0].slice(0, n), n_predict: 1, n_probs: 100, temperature: 0, cache_prompt: true, post_sampling_probs: false, ...(slot !== undefined ? { id_slot: slot } : {}) });
    const top = r?.completion_probabilities?.[0]?.top_logprobs;
    if (!Array.isArray(top)) { noOdds.add(url); return null; }
    const p = options.map((o, i) => Math.exp(top.find((t) => t.id === first[i])?.logprob ?? -Infinity));
    const mass = p.reduce((a, b) => a + b, 0);
    if (!(mass >= 0.5)) return null;
    const share = Object.fromEntries(options.map((o, i) => [o, p[i] / mass]));
    const pick = options.reduce((a, b) => (share[b] > share[a] ? b : a));
    for (const t of tallies) { try { t({ tokens: 1, thought: 0 }); } catch { /* a count never stops the work */ } }
    return { pick, share, conf: share[pick], mass };
  } catch (e) {
    if (signal?.aborted || e.name === 'AbortError') throw e;
    return null; // a server that cannot be asked this way is asked the old way
  } finally { llmCalls.now--; }
}

async function ask({ url, model, slot, system, user, temperature, maxTokens, schema, signal, onToken, thinking, effort, thinkCap, use, what }) {
  const t0 = Date.now();
  let timings = null;
  let firstToken = null;
  const think = Boolean(thinking) && !schema;
  const base = think ? model.thinkingSampling ?? model.sampling : model.sampling;
  const sampling = { ...base, ...(temperature !== undefined ? { temperature } : {}) };
  const extra = schema ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', schema } } } : undefined;
  let text = '';
  let tokens = 0;
  let thought = 0;
  const full = model.thinkingBudget ?? 2048;
  const budget = think ? Math.min(full, thinkCap ?? full) : 0;
  for await (const ev of streamChat({ url, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], thinking: think, effort, model, sampling, maxTokens: maxTokens + budget, thinkCap: think && budget < full ? budget : undefined, slot, signal, extra, use })) {
    if (ev.type === 'text') { text += ev.text; tokens++; onToken?.(tokens + thought); }
    if (ev.type === 'reasoning') { thought++; onToken?.(tokens + thought); }
    if ((ev.type === 'text' || ev.type === 'reasoning') && firstToken === null) firstToken = Date.now();
    if (ev.type === 'done') timings = ev.timings;
  }
  if (timers.size) {
    const entry = replyTiming({ kind: 'call', what: what ?? 'a side call', start: t0, firstToken, timings, out: timings?.predicted_n ?? tokens + thought, think: thought });
    for (const t of timers) { try { t(entry); } catch { /* a timer never stops the work */ } }
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
