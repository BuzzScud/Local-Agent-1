// Asking before starting. A vague request ("api", "fix the bug" when nothing
// fails, "make it faster") used to send the model wandering for minutes; now
// it asks you one question first, and the answer travels with the request.
//   - "fix the bug / the test / it" with passing tests (or no tests): a fixed
//     question, no model needed. With failing tests the fix path is the answer.
//   - one to four words that name no file or code: the model decides whether
//     the files make it clear; if not, it writes one question and two or three
//     answers to pick from. A short request the rules already sort ("rename
//     test to check", "explain the tests") is not asked about.
//   - any other fix that names no file, no check and no failing tests
//     ("the dropdown is hidden behind the legend"): where you see it, so
//     the search starts in the right place.
// Later questions, mid-task, come from the model's own Ask tool.
import { walk } from '../tools/fs.mjs';
import { complete } from './llm.mjs';
import { Scratch } from './scratch.mjs';
import { readResults } from './results.mjs';
import { isSmallTalk, isCodeProject, routeByRules } from './index.mjs';
import { PLAIN, CODE_ISH } from './words.mjs';
import { changedFiles } from '../agent/helpers.mjs';

const VAGUE_FIX = /^\W*(?:please\s+|can you\s+|could you\s+)?(?:fix|repair|debug|solve)\s+(?:the\s+|this\s+|that\s+|my\s+)?(?:bug|bugs|test|tests|issue|error|problem|code|it|this|that)?\s*[.!?]*\s*$/i;

export const FIX_QUESTION = 'The tests pass today. What is wrong, or what should a test check?';
export const FIX_QUESTION_NO_TESTS = 'What is wrong? Tell me what you see and what you expect instead.';
export const WHERE_QUESTION = 'Where do you see it: which screen, page or file? And what should happen instead?';
// A request that already points somewhere: failing tests, a check to run, a file.
const POINTS = /\b(?:tests?|checks?|specs?)\b[^.!?]{0,40}?\b(?:fail|fails|failing|failed|break|breaks|broke|red)\b|\bfailing (?:tests?|checks?)\b|`[^`]+`|\berror:|\bat\s+\S+:\d+/i;

// null (clear enough), 'fix' (a bare "fix it") or 'model' (let the model judge).
export function needsClarifying(text) {
  const t = text.trim();
  if (!t || isSmallTalk(t) || PLAIN.test(t)) return null;
  if (VAGUE_FIX.test(t)) return 'fix';
  const words = t.split(/\s+/);
  if (words.length > 4 || /\?\s*$/.test(t) || CODE_ISH.test(t)) return null;
  // The rules already know what it is ("rename test to check", "explain the
  // tests", "update the readme"): it starts, with no call to the model first.
  // A lone word is still checked.
  if (words.length >= 2 && ['rename', 'question', 'other'].includes(routeByRules(t)?.kind)) return null;
  return 'model';
}

async function testsFail(ctx) {
  if (!ctx.testCmd || !isCodeProject(ctx.cwd)) return false;
  const scratch = new Scratch(ctx.cwd);
  try {
    const r = await scratch.run(ctx.testCmd, { signal: ctx.signal, timeoutMs: 60_000 });
    if (r.timedOut) return false; // cut off: not known to fail
    return !readResults(r.out, r.code).ok;
  } catch { return false; } finally { scratch.dispose(); }
}

export function fileList(cwd, max = 60) {
  const out = [];
  for (const f of walk(cwd)) { if (!f.dir) out.push(f.path); if (out.length >= max) break; }
  return out;
}

// Up to three answers to pick from, as the model wrote them: short, different
// from each other, none of them the question again.
export function cleanOptions(list, question = '') {
  const out = [];
  for (const o of Array.isArray(list) ? list : []) {
    const t = String(o ?? '').replace(/\s+/g, ' ').trim().replace(/^(?:\d+[.)]|[-*•])\s*/, '').slice(0, 80);
    if (!t || t.toLowerCase() === question.trim().toLowerCase()) continue;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    out.push(t);
    if (out.length === 3) break;
  }
  return out.length >= 2 ? out : [];
}

// The question to ask for this request ({ question, options }), or null. The
// set questions have no answers to offer; the model's question comes with two
// or three (measured on the 27B, 2026-09-27: asked for "different kinds of
// work" the lists were usable on 8 of 8 short requests, 8.8 s against 6.4 s
// for the question alone; asked only for "answers", 5 of 8 lists were the
// same work on three files).
export async function questionFor(ctx, text) {
  const kind = needsClarifying(text);
  if (!kind) return wantsWhere(text) ? { question: WHERE_QUESTION, options: [] } : null;
  // With the tests helper (agent/helpers.mjs), the files changed since the
  // last commit: "fix the bug" is often about the work in progress.
  const changed = ctx.helpers?.has?.('tests') ? changedFiles(ctx.cwd) : [];
  if (kind === 'fix') {
    if (await testsFail(ctx)) return null; // failing tests say what is wrong
    return { question: `${ctx.testCmd ? FIX_QUESTION : FIX_QUESTION_NO_TESTS}${changed.length ? ` (Changed since the last commit: ${changed.join(', ')}.)` : ''}`, options: [] };
  }
  const files = fileList(ctx.cwd);
  const r = await complete({ instructions: ctx.instructions, url: ctx.url, model: ctx.model, slot: ctx.slot, signal: ctx.signal, temperature: 0, maxTokens: 200,
    system: 'You decide whether a request to a coding assistant is clear enough to start on, given the project files. The assistant can read, search and change files; it asks only what the files cannot tell it.',
    user: `Request: "${text.trim()}"\n\nProject files:\n${files.join('\n') || '(empty folder)'}${changed.length ? `\n\nChanged since the last commit: ${changed.join(', ')}` : ''}\n\nIf it is clear what to do, answer clear: true. If not (a lone word, no idea what should change or how), answer clear: false with ONE short question for the user and 2 or 3 short answers they might pick. Each answer is a different kind of work (explain something, fix something, add something, remove something), never the same work on three different files. Each answer is under 10 words and says what would be done. Name a file only when it is clearly the one meant; do not offer work on test files or data files unless the request is about them.`,
    schema: { type: 'object', properties: { clear: { type: 'boolean' }, question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, maxItems: 3 } }, required: ['clear', 'question', 'options'] } });
  if (!r.json || r.json.clear || !r.json.question?.trim()) return null;
  const question = r.json.question.trim().slice(0, 300);
  return { question, options: cleanOptions(r.json.options, question) };
}

// A fix described only by what it looks like: nothing in it says where to look.
export function wantsWhere(text) {
  const t = text.trim();
  return routeByRules(t)?.kind === 'fix' && !CODE_ISH.test(t) && !POINTS.test(t);
}

// Asks (through the usual prompt) and returns { question, answer }, or
// { stop: 'declined' } when you close the question, or null when nothing needs asking.
export async function clarify(ctx, text) {
  const q = await questionFor(ctx, text);
  if (!q) return null;
  const { question, options } = q;
  const answer = await ctx.ask({ id: `ask_${Date.now()}`, name: 'Ask', args: options.length ? { question, options } : { question }, prepared: {}, label: 'Ask', arg: question });
  if (ctx.signal?.aborted) return { stop: 'interrupted' };
  if (answer.choice === 'no' || !answer.text?.trim()) {
    ctx.tool('Ask', question, { kind: 'declined', feedback: answer.feedback }, true);
    return { stop: 'declined' };
  }
  ctx.tool('Ask', question, { kind: 'answer', question, text: answer.text.trim() });
  return { question, answer: answer.text.trim() };
}
