// Second look (/hooks, on: the owner's pick of 4 Oct 2026, "On, after real work"): when a message ran
// commands, wrote files or fetched pages, one short call checks the final answer against what the app
// saw happen, and sends it back once when it does not hold. The run that asked for it: Qwen3.6 tested
// formulas behind a login it never mentioned, computed two of its own expected values wrong, called a
// calculator error "a string", and answered "All 24 formulas passed" after a run that said 22 of 24.
// The check sees the request, the plan, the model's own calls (its commands and the files it wrote, cut
// short) and the facts the app recorded (check runs with their exit codes and counts, errors, walls,
// files seen only as outlines), never what a page, a file or a command printed, so their text cannot
// steer it (as drift.mjs and auto-check.mjs). Who checks: as for Stays on task (agent.mjs lookWho).

import { complete } from '../flows/llm.mjs';

// A check that has not answered by then is skipped: the answer stands.
const CHECK_MS = 30_000;
export const LOOK_STEPS = 30;

export const LOOK_SYSTEM = `You check a coding assistant's final answer against what the app saw it do. You see the user's request, the assistant's steps (its own calls, cut short), the facts the app recorded (runs of checks with their exit codes and counts, errors, pages or files that blocked it, files it saw only the outline of) and the answer.
wrong: the answer claims something the facts contradict (all passed when a run failed; it works when a step errored; it found or read what it only saw an outline of); or it leaves out a failure, an error or a block the user needs to know; or it says it did a part of the request the steps show it did not do; or it calls made-up numbers real data.
ok: otherwise. Do not judge style, length or wording. When unsure, answer ok.
problems: at most 3, each one short plain sentence saying what the answer must fix.`;

const SCHEMA = { type: 'object', properties: { verdict: { type: 'string', enum: ['ok', 'wrong'] }, problems: { type: 'array', items: { type: 'string' }, maxItems: 3 } }, required: ['verdict', 'problems'] };
const short = (t, n) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// The model's own calls of this message, oldest first, cut short: a command's text (up to 400
// characters, so a script's numbers show), a written file's path and start, a fetch's address.
export function ownSteps(messages, n = LOOK_STEPS) {
  const steps = [];
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const c of m.tool_calls ?? []) {
      let a = {};
      try { a = JSON.parse(c.function?.arguments || '{}'); } catch { /* a call cut short: its name is enough */ }
      const name = c.function?.name ?? '?';
      const what = name === 'Bash' ? short(a.command, 400) : name === 'Write' ? `${a.path ?? ''}: ${short(a.content, 200)}` : name === 'Edit' ? `${a.path ?? ''}` : name === 'WebFetch' ? a.url : name === 'TodoWrite' ? 'its plan' : short(a.path ?? a.pattern ?? a.query ?? a.question ?? '', 160);
      steps.push(`${name} ${what}`.trim());
    }
  }
  return steps.slice(-n);
}

// The facts the app recorded this message, as lines. turn: agent.turn.
export function lookFacts(turn, { home = '' } = {}) {
  const t = turn ?? {};
  const tilde = (p) => (home && String(p).startsWith(`${home}/`) ? `~${String(p).slice(home.length)}` : String(p));
  const out = [];
  for (const c of (t.checks ?? []).slice(-6)) out.push(`A run of checks: ${c.cmd} → ${c.failed ? 'FAILED' : 'passed'}${c.counts ? ` ("${c.counts}")` : ''}, exit code ${c.code}.`);
  for (const w of t.walls ?? []) out.push(`Blocked: ${w.why}.${t.askedUser ? ' It asked the user.' : ' It did not ask the user.'}`);
  for (const e of (t.errors ?? []).slice(-6)) out.push(`An error: ${e}`);
  if (t.outlined?.size) out.push(`Seen only as an outline (none of its text): ${[...t.outlined].slice(0, 5).map(tilde).join(', ')}.`);
  if (t.created?.length) out.push(`Files it created: ${t.created.slice(0, 8).join(', ')}.`);
  if (!t.changed && !t.wroteByCommand) out.push('No file was changed.');
  return out;
}

// { ok, problems, ms } or { failed, reason, ms }. ask: the model call (complete(), or a stand-in in tests).
export async function secondLook({ url, model, slot, use, request = '', plan = '', steps = [], facts = [], answer = '', signal, timeoutMs = CHECK_MS, ask = complete }) {
  const t0 = Date.now();
  // A timer of its own: AbortSignal.timeout never fires under bun test.
  const late = new AbortController();
  const timer = setTimeout(() => late.abort(), timeoutMs);
  const ms = () => Date.now() - t0;
  try {
    const r = await ask({
      url, model, slot, use, temperature: 0, maxTokens: 260, thinking: false, schema: SCHEMA, system: LOOK_SYSTEM,
      signal: signal ? AbortSignal.any([signal, late.signal]) : late.signal,
      user: `The user's request:\n${String(request).trim().slice(0, 2000) || '(none given)'}${plan ? `\n\nThe assistant's plan:\n${plan}` : ''}\n\nIts steps, oldest first:\n${steps.map((s) => `- ${s}`).join('\n') || '(none)'}\n\nWhat the app recorded:\n${facts.map((f) => `- ${f}`).join('\n') || '- nothing failed or blocked'}\n\nIts answer:\n${String(answer).trim().slice(0, 2500)}`,
    });
    const v = r?.json?.verdict;
    if (v !== 'ok' && v !== 'wrong') return { failed: true, reason: 'the check gave no clear answer', ms: ms() };
    const problems = (Array.isArray(r.json.problems) ? r.json.problems : []).map((p) => short(p, 220)).filter(Boolean).slice(0, 3);
    if (v === 'wrong' && !problems.length) return { failed: true, reason: 'the check found something but did not say what', ms: ms() };
    return { ok: v === 'ok', problems, ms: ms() };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { failed: true, reason: late.signal.aborted ? 'the check took too long' : 'the check could not be made', ms: ms() };
  } finally { clearTimeout(timer); }
}

// What the model is told when the answer does not hold.
export const lookText = (problems) => `A second look at your answer against what happened in this message (it can be wrong):\n${problems.map((p) => `- ${p}`).join('\n')}\nAnswer again: fix what is real and keep what is right. If work is missing, do it first.`;

// Off by AGENTIC_SECOND_LOOK=off (the tests' stand-in services count every call).
export const lookOn = (env = process.env) => !/^(off|0|no|false)$/i.test(String(env.AGENTIC_SECOND_LOOK ?? ''));
