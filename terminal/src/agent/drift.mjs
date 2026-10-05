// Stays on task (/hooks, 4 Oct 2026, the owner's picks): on a model on another machine, every
// DRIFT_EVERY steps one short call asks whether the work still serves the request. Off task, the
// model gets one line that brings it back and the run goes on (at most DRIFT_NUDGES a message).
// The check sees the request, the plan, the steps in plain words and the model's own last words,
// never what a file, a command or a page said, so their text cannot steer it (as Auto's check,
// auto-check.mjs). Who checks: on an Ollama service its Side jobs helper (else the main model);
// on the owner's other Mac (coding serve) the main model on the server's second lane; nowhere else.
import { complete } from '../flows/llm.mjs';
import { stepSaid } from './questions.mjs';

export const DRIFT_EVERY = 10;
export const DRIFT_NUDGES = 2;
// A check that has not answered by then is skipped.
const CHECK_MS = 20_000;

export const DRIFT_SYSTEM = `You check whether a coding assistant is still working on what the user asked. You see the request, the assistant's plan, its last steps and its last words. Answer on or off.
on: the steps serve the request, even when they are reading, searching, running tests, or fixing something its own change broke.
off: it is working on something the request did not ask for and that does not serve it (other files or features, polishing what is done, redoing finished work, going round in circles without getting closer).
When unsure, answer on.
reason: one short plain sentence. For off, say what it was asked and what it is doing instead.`;

const SCHEMA = { type: 'object', properties: { verdict: { type: 'string', enum: ['on', 'off'] }, reason: { type: 'string' } }, required: ['verdict', 'reason'] };
const sentence = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '').slice(0, 200);

// The last `n` steps of a conversation in plain words ("changing export.mjs", "running npm test"),
// oldest first, and the model's own last words. Only the model's calls and text: no tool output.
export function recentSteps(messages, n = DRIFT_EVERY) {
  const steps = [];
  let said = '';
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    if (String(m.content ?? '').trim()) said = String(m.content).trim();
    for (const c of m.tool_calls ?? []) {
      let args = {};
      try { args = JSON.parse(c.function?.arguments || '{}'); } catch { /* a call cut short: its name is enough */ }
      steps.push(c.function?.name === 'TodoWrite' ? 'updating its plan' : stepSaid(c.function?.name, args));
    }
  }
  return { steps: steps.slice(-n), said: said.replace(/\s+/g, ' ').slice(0, 600) };
}

// { on, reason, ms } or { failed, reason, ms }. ask: the model call (complete(), or a stand-in in tests).
export async function driftCheck({ url, model, slot, use, request = '', plan = '', steps = [], said = '', signal, timeoutMs = CHECK_MS, ask = complete }) {
  const t0 = Date.now();
  // A timer of its own: AbortSignal.timeout never fires under bun test.
  const late = new AbortController();
  const timer = setTimeout(() => late.abort(), timeoutMs);
  const ms = () => Date.now() - t0;
  try {
    const r = await ask({
      what: 'the stays-on-task check', url, model, slot, use, temperature: 0, maxTokens: 160, thinking: false, schema: SCHEMA, system: DRIFT_SYSTEM,
      signal: signal ? AbortSignal.any([signal, late.signal]) : late.signal,
      user: `The user's request:\n${String(request).trim().slice(0, 2000) || '(none given)'}${plan ? `\n\nThe assistant's plan:\n${plan}` : ''}\n\nIts last steps, oldest first:\n${steps.map((s) => `- ${s}`).join('\n') || '(none)'}${said ? `\n\nIts last words: ${said}` : ''}`,
    });
    const v = r?.json?.verdict;
    if (v !== 'on' && v !== 'off') return { failed: true, reason: 'the check gave no clear answer', ms: ms() };
    return { on: v === 'on', reason: sentence(r.json.reason) || (v === 'on' ? 'it serves the request' : 'it has moved away from the request'), ms: ms() };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { failed: true, reason: late.signal.aborted ? 'the check took too long' : 'the check could not be made', ms: ms() };
  } finally { clearTimeout(timer); }
}

// What the model is told when it has moved off: the check's reason, and back to the request.
export const nudgeText = (reason) => `(A check of your last steps: ${sentence(reason)}. Go back to what the user asked; finish that first.)`;
