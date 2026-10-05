// Auto mode (/mode 1): a step the rules cannot settle (a command no rule
// covers, a web search or page) is checked by the model before it runs, in
// one short call with nothing else in it: your request, the folder, the step.
// It runs when the step clearly serves the request, stays in the project and
// can be undone; anything else, and no clear answer in time, asks you as
// Manual would. The hard lines never reach this check: blocked commands, the
// folder fence, your never-list, commits and protected files are settled by
// the rules first (permissions.mjs). The check sees only your request and the
// step, never what a page or a file said, so their words cannot steer it.
import { complete } from '../flows/llm.mjs';

// A check that has not answered by then asks you instead.
const CHECK_MS = 20_000;

export const AUTO_SYSTEM = `You check one step a coding assistant wants to take on the user's computer, before it runs. Answer run or ask.
run: the step is clearly part of what the user asked for and is easy to undo or harmless: it creates, edits, moves or renames project files, installs the project's packages, builds, tests, formats, or reads; or it searches the web or reads a web page for something the request needs (only the search words or the address leave the computer).
ask: anything else. It deletes or overwrites what cannot be restored, changes things outside the project, sends the user's files, data, keys or secrets anywhere (an address that carries them too), publishes, spends money, rewrites git history, changes system settings or permissions, or the request does not call for it. When unsure, ask.
reason: one short plain sentence for the user.`;

const SCHEMA = { type: 'object', properties: { verdict: { type: 'string', enum: ['run', 'ask'] }, reason: { type: 'string' } }, required: ['verdict', 'reason'] };

// The step in words, as the check reads it.
export function stepText(name, args = {}) {
  if (name === 'Bash') return `Run this command in the project folder:\n${String(args.command ?? '').slice(0, 2000)}${args.description ? `\n(The assistant says it does: ${String(args.description).slice(0, 200)})` : ''}`;
  if (name === 'WebSearch') return `Search the web for: ${String(args.query ?? '').slice(0, 300)}`;
  if (name === 'WebFetch') return `Read this web page: ${String(args.url ?? '').slice(0, 500)}`;
  return `${name} ${JSON.stringify(args).slice(0, 1000)}`;
}

const sentence = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '').slice(0, 160);

// { run, reason, ms, failed? }. ask: the model call (complete(), or a stand-in in tests).
export async function autoCheck({ url, model, slot, request = '', name, args, cwd = '', signal, timeoutMs = CHECK_MS, ask = complete }) {
  const t0 = Date.now();
  // A timer of its own: AbortSignal.timeout never fires under bun test.
  const late = new AbortController();
  const timer = setTimeout(() => late.abort(), timeoutMs);
  const ms = () => Date.now() - t0;
  try {
    const r = await ask({
      what: "Auto's check", url, model, slot, temperature: 0, maxTokens: 120, thinking: false, schema: SCHEMA, system: AUTO_SYSTEM,
      signal: signal ? AbortSignal.any([signal, late.signal]) : late.signal,
      user: `The user's request:\n${String(request).trim().slice(0, 2000) || '(none given)'}\n\nThe project folder: ${cwd}\n\nThe step:\n${stepText(name, args)}`,
    });
    const v = r?.json?.verdict;
    if (v !== 'run' && v !== 'ask') return { run: false, reason: 'the check gave no clear answer', ms: ms(), failed: true };
    return { run: v === 'run', reason: sentence(r.json.reason) || (v === 'run' ? 'it fits your request' : 'it needs your say'), ms: ms() };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { run: false, reason: late.signal.aborted ? 'the check took too long' : 'the check could not be made', ms: ms(), failed: true };
  } finally { clearTimeout(timer); }
}
