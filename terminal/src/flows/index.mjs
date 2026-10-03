// Sorting a request into a type and running the path built for it:
//   rename  → the built-in rename (no model)
//   fix     → tries against the failing tests
//   change  → test first, then tries
//   question / other → the step-by-step tool loop
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { complete, decide } from './llm.mjs';
import { planRename, applyRename, leftAloneNote } from './rename.mjs';
import { fixFlow } from './fix.mjs';
import { changeFlow } from './change.mjs';
import { planFiles, multiFlow, MAX_FILES } from './multi.mjs';
import { projectFiles } from './localize.mjs';
import { isMoreTalk, isCommand, isPageRequest, wantsDesktop } from './words.mjs';

const ID = '[`\'"]?([A-Za-z_$][\\w$]*)[`\'"]?';
// A whole request that is one file operation: "delete trades.json",
// "rename export.mjs to exporter.mjs", "move old/ into archive", "remove the logs folder".
const PATHISH = '["\'`]?(?:[\\w.~-]+\\/)*[\\w~-][\\w.~-]*(?:\\.\\w{1,6}|\\/)["\'`]?';
const FILE_OP = new RegExp(`^\\W*(?:please\\s+)?(?:delete|remove|rm|trash|move|mv|rename|copy|cp|duplicate)\\s+(?:the\\s+)?(?:(?:file|folder|directory)\\s+)?(?:${PATHISH}|[\\w.-]+\\s+(?:file|folder|directory|dir))(?:\\s+(?:to|into|as|in|inside)\\s+(?:the\\s+)?\\S+(?:\\s+(?:file|folder|directory))?)?\\s*[.!]?\\s*$`, 'i');
const CODE_FILE = /\b[\w-]+\.(m?[jt]sx?|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h)\b/i;
const CODE_WORDS = /\b(function|method|class|helper|bug|crash(es)?|flag|field|option|parameter|argument|variable|property|endpoint|generator|parser|stdout|stderr|exception)\b/i;

// Greetings and thanks: answered in a sentence, with no tools (a "hello" once
// read the project and asked to run the tests). Also a greeting with a
// general offer of work and nothing to do yet ("hello, can you help me with
// something?", "hi, I need some help"): once answered, Agentic Coder waits.
const GREETING = String.raw`(?:hi|hello|hey|yo|hiya|howdy|good (?:morning|afternoon|evening))`;
const HELP = String.raw`(?:(?:can|could|would|will) you (?:please )?(?:help|assist)(?: me)?(?: out)?(?: with (?:something|a (?:quick )?(?:thing|question|task)|some(?:thing| stuff)))?(?: please)?|i (?:need|could use|want) (?:some |a little |your )?help(?: with something)?|how are you(?: doing)?(?: today)?|are you there|what'?s up|i have a (?:quick )?question)`;
const SMALL_TALK = new RegExp(String.raw`^(?:(?:hi|hello|hey|yo|hiya|howdy|thanks|thank you|thx|ty|ok|okay|cool|great|nice|good (?:morning|afternoon|evening)|who are you|what can you do)\b[\s!.?,]*(?:agentic coder|coder|coding|bonsai|there)?[\s!.?]*|(?:${GREETING}[\s!.,]*(?:agentic coder|coder|coding|bonsai|there)?[\s!.,]*)?${HELP}[\s!.?]*)$`, 'i');
export function isSmallTalk(text) {
  return SMALL_TALK.test(text.trim()) || isMoreTalk(text);
}

// The two rules after the word rules only fill what those leave open, so a
// request the word rules already sort keeps its path: a page or file with no
// code named is no change for the test-first path, and a plain command with no
// rule of its own goes step by step instead of to the model for sorting.
export function routeByRules(text) {
  const whole = text.trim();
  if (KEEPS_ALL.test(whole)) {
    // Only the code is kept ("don't touch the code") and the rest asks for work on a text file by name
    // (a README, a .md): the code is protected, that file is not, so the work stands.
    const rest = whole.replace(KEEPS_CODE, (all, start) => (start?.match(/^[.!?]/)?.[0] ?? '')).trim();
    if (rest && rest !== whole && !KEEPS_ALL.test(rest) && WORK_ON_TEXT.test(rest)) { const r = sortWords(rest); if (r && r.kind !== 'question') return r; }
    return { kind: 'question' };
  }
  const { rest, onIt } = setAside(whole);
  const r = sortWords(rest);
  if (rest === whole) return r;
  if (!rest) return { kind: 'question' }; // only a limit, nothing asked for
  if (r && r.kind !== 'question') return r;
  return { kind: onIt || r ? 'question' : 'change' };
}

function sortWords(t) {
  const r = byWords(t);
  if (r?.kind === 'change' && isPageRequest(t)) return { kind: 'other' };
  if (!r && isCommand(t)) return { kind: 'other' };
  return r;
}

// What a request protects decides whether it may change files, not its verbs (3 Oct 2026; before, a
// sentence opening with one of 22 verbs switched "don't change" off, so "Use simple words. Don't change
// anything." was a change and "Tighten … without changing their results" a question).
// Everything kept ("don't change anything", "no changes", "change nothing", "read only"): a question,
// always. One named thing kept ("don't touch the tests", "without changing their results", "no changes
// to the output format"): a limit, set aside so the rest is sorted on its own (the model still gets the
// whole request); a limit on one thing means the rest may change, so a rest the words leave open is a
// change. "Don't change it" with nothing else asking for work stays a question.
const DONT = String.raw`(?:don['’]?t|do not)\s+(?:change|edit|touch|modify|alter)`;
const WITHOUT = String.raw`without\s+(?:changing|editing|touching|modifying|altering)`;
const ALL = String.raw`(?:anything|any\s+(?:files?|code)|the\s+(?:code|files)|files|code)`;
const SAID = String.raw`(?=\s*(?:$|[.!?;:,)\n]|(?:and|just|then|instead|please|yet|for now|at all)\b))`; // nothing named after it
const KEEPS_ALL = new RegExp([
  String.raw`\b${DONT}\s+${ALL}${SAID}`,
  String.raw`\b${WITHOUT}\s+${ALL}${SAID}`,
  String.raw`\b(?:change|edit|touch|modify|alter)\s+nothing${SAID}`,
  String.raw`\bno\s+(?:code\s+)?changes?${SAID}`,
  String.raw`(?:^|[.!?;:,(\n]\s*|\b(?:is|be|stay|stays|keep it|just)\s+)read[- ]only${SAID}`,
].join('|'), 'i');
// The clause that keeps only the code, and a text file named in what is left.
const KEEPS_CODE = new RegExp(String.raw`(^|[.!?]\s+|\n\s*)?[\s,;:]*\b(?:${DONT}|${WITHOUT})\s+(?:any\s+code|the\s+code|code)${SAID}(?:\s*,?\s*(?:just|and|then|but)\b)?[.!?]*`, 'gi');
const TEXT_FILE = String.raw`(?:\b(?:README|CHANGELOG|LICENSE|CONTRIBUTING|NOTES)\b|[\w./-]+\.(?:md|markdown|txt|rst)\b|\bdocs?\/[\w./-]+)`;
// A sentence that opens with something to do to that file ("Rewrite the README intro", "just update
// CHANGELOG.md"). The word rules sort every request about a text file the same way, a question about
// it too ("Explain the README"), so the doing word is asked for here; without one it stays a question.
const WORK_ON_TEXT = new RegExp(String.raw`(?:^|[.!?]\s+|\n\s*|[,;]\s*|\b(?:just|then|and|please)\s+)(?:rewrite|update|fix|add|write|edit|change|correct|improve|shorten|expand|reword|rename|remove|delete|create|make|append|tidy|clean\s+up|polish|draft|translate|format)\b[^.!?\n]*?${TEXT_FILE}`, 'i');
// A limit runs to the end of its clause; a sentence that is only a limit goes whole.
const LIMIT = new RegExp(String.raw`(^|[.!?]\s+|\n\s*)?((?:[\s,;:]*(?:\b(?:but|and|so|while)\s+)?)\b(?:${DONT}|${WITHOUT}|(?:change|edit|touch|modify|alter)\s+nothing|(?<=^|[.!?;:,(\n]\s*|\b(?:and|but|with)\s+)no\s+(?:code\s+)?changes?\s+(?:to|in|on|of|for))\b([^.!?;,\n]*))([.!?]*)`, 'gi');
function setAside(t) {
  let onIt = false;
  const rest = t.replace(LIMIT, (all, start, clause, what, end) => {
    if (/^\s*(?:it|them|this|that|these|those)\s*(?:at all|yet|please)?\s*$/i.test(what)) onIt = true;
    return start !== undefined ? (start.match(/^[.!?]/)?.[0] ?? '') : end;
  });
  if (rest === t) return { rest: t, onIt };
  return { rest: rest.replace(/^[\s,;:]+/, '').replace(/([.!?])\s*,\s*/g, '$1 ').replace(/\s*,\s*([.!?]|$)/g, '$1').replace(/([.!?])[\s.!?]*$/, '$1').trim(), onIt };
}

function byWords(t) {
  const rn = new RegExp(`\\brename\\s+(?:the\\s+)?(?:function|method|variable|var|class|const(?:ant)?|symbol|field|property|type|name)?\\s*${ID}\\s+(?:to|as|into|→|->)\\s+${ID}`, 'i').exec(t);
  if (rn) return { kind: 'rename', from: rn[1], to: rn[2] };
  // Greetings and thanks go straight to the conversation: asking the model to
  // sort them cost a request, and with a big model a re-read of its instructions.
  if (isSmallTalk(t)) return { kind: 'question', chat: true };
  // "Just explain" is a question whatever else it says. (What a request protects: routeByRules.)
  if (/\bjust (explain|tell|describe|show)\b/i.test(t)) return { kind: 'question' };
  // Deleting, moving, renaming or copying a file is a file operation, not a
  // code change: it goes step by step, where the command asks you first.
  // ("delete trades.json" once became code that deleted the file on every run.)
  if (FILE_OP.test(t) && !/^\W*\w+\s+console\.\w+/i.test(t)) return { kind: 'other' };
  // A file to make on the Desktop is a file, not a change to the project's code, even with a
  // question mark: "create the helper agent file for me and add it to my desktop when you are
  // done?" was a question, so each Write was turned away (3 Oct 2026). "What is on my desktop?"
  // makes nothing and stays a question.
  if (wantsDesktop(t) && /\b(add|make|create|write|build|put|save|copy|move|export|generate|place|download|drop)\b/i.test(t)) return { kind: 'other' };
  // Writing (a story, notes, a letter, a text or Markdown file) and creating a
  // new file are not code changes: no test can define "done", so work step by
  // step. Asking for code (a function, a field, a bug) keeps a request on the
  // code paths even when it mentions a writing word. A named Markdown or text
  // file is what gets written ("a NOTES.md about the API in server.mjs"), but
  // requirements.txt next to a code file is a dependency change.
  const code = CODE_FILE.test(t) || CODE_WORDS.test(t);
  const doc = /\.(md|markdown|txt|csv|docx?|pdf|rtf)\b|\b(txt|text file|markdown|readme|change ?log|release notes|licen[cs]e)\b/i.test(t);
  if (doc && !CODE_WORDS.test(t) && !(CODE_FILE.test(t) && /\brequirements[\w-]*\.txt\b/i.test(t))) return { kind: 'other' };
  if (!code && /\b(story|stories|poem|essay|letter|e-?mail|blog|article|notes?|summary|recipe|journal|diary)\b/i.test(t) && !/\btests?\b/i.test(t)) return { kind: 'other' }; // "notes about the API" is writing; "a notes field" is code
  if (/\b(create|make|add|write)\s+(?:(?:a|an|the)\s+)?(?:new\s+)?(?:\w+\s+)?file\b|\bname it\b|\bcall it\s+["'\u201c]|\bcall it\s+[\w.-]+\s*[.!]?\s*$/i.test(t)) return { kind: 'other' };
  const asks = /\b(add|fix|change|make|implement|create|rename|remove|delete|update|refactor|write)\b/i.test(t);
  // "Can you …?" asks for something to be done, whatever the verb ("can you
  // use clouds and sun for the icons?" was once sorted as a question, so the
  // edits it needed were turned away, 2026-09-28). "Can you explain …?" and
  // the like still only want an answer.
  const pleaseDo = /\b(can|could|would|will) you\b/i.test(t) && !/\b(can|could|would|will) you\s+(?:please\s+|just\s+)?(explain|tell|describe|show me|summari[sz]e|clarify|walk me|help)\b/i.test(t);
  // A request that opens with what to do is one, whatever mark it ends with ("make me a page
  // about the data?").
  const opensWithDo = /^\W*(?:(?:ok(?:ay)?|now|so|and|then|also|please)[,\s]+)*(?:add|fix|change|make|implement|create|rename|remove|delete|update|refactor|write|build|put|save|generate)\b/i.test(t);
  if (/\?\s*$/.test(t) && !pleaseDo && !opensWithDo) return { kind: 'question' };
  // A question on the first line with pasted output under it ("Here is a log,
  // what went wrong?" + the log) is still a question, whatever the log says.
  const first = t.split('\n')[0];
  if (first !== t && /\?\s*$/.test(first) && !pleaseDo && !/\b(fix|change|add|update|make|solve|repair)\b/i.test(first)) return { kind: 'question' };
  if (/^(?:(?:just|please|can you|could you|hey|hi|ok)[,\s]+)?(what|which|where|why|how|who|when|explain|describe|show me|list|tell me|does|is|are|summari[sz]e)\b/i.test(t) && !asks) return { kind: 'question' };
  if (/\b(fix|failing|fails|broken|bug|crash(es)?|doesn'?t work|does not work|wrong result)\b/i.test(t)) return { kind: 'fix' };
  if (/\b(add|implement|create|make|change|update|support|remove|delete|refactor|write|rename)\b/i.test(t)) return { kind: 'change' };
  if (pleaseDo) return { kind: 'other' }; // done step by step, where a file can change
  return null;
}

export async function route(ctx, text) {
  const byRules = routeByRules(text);
  if (byRules) return byRules;
  return modelSort(ctx, text);
}

// What the model is told each kind means: the paths at the top of this file.
// The words once said only "other", and the model sorted a page to write, a
// file to delete or a command to run as a code change: right on 59 of the 82
// lines of the sorting check (Qwen) and 70 (Gemma); with these meanings 80 and
// 81 (29 Sep 2026, models/evals/tools/sort-check.mjs). A page or component
// inside the project's code is a change; a page that stands on its own is other
// (Gemma still sorts "build a login page component in src/pages/Login.jsx" as other).
export const KINDS = ['question', 'rename', 'fix', 'change', 'other'];
// The meanings come before the request, so the server reads them once and keeps
// them (only the request is new at each sort).
const KIND_MEANINGS = `Kinds: question (only wants an answer; nothing is changed), rename (rename one name in the code everywhere, not a file), fix (code in the project is broken and should be repaired), change (add to or change the project's code: a function, a flag, an option, a component or page inside the code), other (anything else: write a document, notes, a story or a self-contained web page; create a new file the request names; move, delete or rename files; run a command).`;
export const SORT_SYSTEM = `You sort a request to a coding assistant into one kind.\n\n${KIND_MEANINGS}`;
export const sortQuestion = (text) => `Request: ${text}`;

// The model sorts what the word rules leave: in one pass, from the chance of
// each kind (decide() in llm.mjs, about half the time of a written answer), or
// in a written answer when the server cannot give the chances. `via` says which.
// A rename also needs its two names: they are asked for on their own, and
// without both it is worked on as a change.
export async function modelSort(ctx, text) {
  const ask = { instructions: ctx.instructions, url: ctx.url, model: ctx.model, slot: ctx.slot, signal: ctx.signal };
  const d = await decide({ ...ask, system: SORT_SYSTEM, user: sortQuestion(text), options: KINDS, lead: '{"kind": "' });
  let out;
  if (d) out = { kind: d.pick, via: 'odds', sure: d.conf };
  else {
    const r = await complete({ ...ask, system: SORT_SYSTEM, user: sortQuestion(text), temperature: 0, maxTokens: 80,
      schema: { type: 'object', properties: { kind: { type: 'string', enum: KINDS }, from: { type: 'string' }, to: { type: 'string' } }, required: ['kind'] } });
    out = { kind: r.json?.kind ?? 'other', from: r.json?.from, to: r.json?.to, via: 'written' };
  }
  if (out.kind !== 'rename' || (out.from && out.to)) return out;
  // The kind alone came back without the names (a sorted rename left them out
  // on all 6 rename lines of the 29 Sep sorting check, and was worked on as a change).
  const n = await complete({ ...ask, temperature: 0, maxTokens: 60,
    system: 'You read a request to rename something in code and give the name it has now and the new name.',
    user: `Request: ${text}\n\nThe name it has now (from) and the new name (to), each exactly as the request writes it.`,
    schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } });
  const from = n.json?.from?.trim(), to = n.json?.to?.trim();
  return from && to && from !== to ? { ...out, from, to } : { kind: 'change', via: out.via };
}

export async function renameFlow(ctx, from, to) {
  const plan = planRename(ctx.cwd, from, to);
  const left = leftAloneNote(plan);
  if (!plan.files.length) return { handled: false, why: `${from} is not used in the project's code${left ? ` (${left.replace(/\.$/, '').replace(/^Left alone: /, 'only ')})` : ''}` };
  const p = ctx.plan([`Find every use of ${from}`, `Rename them to ${to}`, ...(ctx.testCmd ? ['Run the tests'] : [])]);
  p.step(0);
  ctx.tool('Search', from, { kind: 'search', count: plan.total, content: plan.files.map((f) => `${f.rel}: ${f.count}`).join('\n') });
  p.step(1);
  // A rename that reaches a protected file (.env, .git/…, yours from /permissions) asks even on auto-accept.
  const guard = plan.files.map((f) => ctx.protectedBy?.(f.rel)).find(Boolean) ?? null;
  if (ctx.mode() !== 'edits' || guard) {
    const answer = await ctx.ask({ id: `rename_${Date.now()}`, name: 'Rename', args: { from, to }, prepared: { files: plan.files.map((f) => ({ rel: f.rel, hunk: f.hunk, count: f.count })), total: plan.total }, label: 'Rename', arg: `${from} → ${to}`, ...(guard ? { once: true, protectedBy: guard } : {}) });
    if (answer.choice === 'no') { ctx.tool('Rename', `${from} → ${to}`, { kind: 'declined', feedback: answer.feedback }, true); return { handled: true, done: false, declined: true, summary: 'You said no to the rename; nothing was changed.' }; }
    if (answer.choice === 'always' && !guard) ctx.setMode('edits');
  }
  applyRename(plan);
  for (const f of plan.files) {
    const adds = f.hunk.filter((l) => l.type === '+').length;
    ctx.tool('Update', f.rel, { kind: 'diff', path: f.rel, hunk: f.hunk.filter((l) => !l.gap), additions: adds, removals: adds, lines: f.after.split('\n').length });
  }
  let final = null;
  if (ctx.testCmd) { p.step(2); final = await ctx.runReal(ctx.testCmd); }
  p.done();
  return { handled: true, done: final ? final.ok : true, summary: `Renamed ${from} to ${to}: ${plan.total} use${plan.total === 1 ? '' : 's'} in ${plan.files.length} file${plan.files.length === 1 ? '' : 's'}${final ? (final.ok ? `; all ${final.total ?? ''} tests pass`.replace('  ', ' ') : '; but the tests fail, see above') : ''}.${left ? ` ${left}` : ''}` };
}

// Folders with a project file, or code at the top: the focused paths make a
// scratch copy of the whole folder and look for code to test, so a Desktop or
// a home folder works step by step instead.
const MARKERS = ['package.json', 'pyproject.toml', 'setup.py', 'requirements.txt', 'go.mod', 'Cargo.toml', 'Gemfile', 'pom.xml', 'build.gradle', 'composer.json', 'deno.json', 'Makefile', 'CMakeLists.txt', '.git'];
export function isCodeProject(cwd) {
  if (cwd === homedir() || [join(homedir(), 'Desktop'), join(homedir(), 'Documents'), join(homedir(), 'Downloads')].includes(cwd)) return false;
  let names;
  try { names = readdirSync(cwd); } catch { return false; }
  if (names.some((n) => MARKERS.includes(n))) return true;
  return names.some((n) => /\.(m?[jt]sx?|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h)$/.test(n));
}

// Runs the right path for a request. Returns null when the tool loop should handle it.
export async function runFlows(ctx, text) {
  if (!isCodeProject(ctx.cwd)) return null;
  const r = await route(ctx, text);
  ctx.emit('route', r);
  return runKind(ctx, r, text);
}

// The path for a kind already known ({ kind, from, to }): the sorting's pick, or the model's own
// when it calls Rename or TestFirst (the model decides, agent/way.mjs). null: no path finished it,
// the step-by-step way goes on (a note says why).
export async function runKind(ctx, r, text) {
  if (r.kind === 'rename') {
    const out = await renameFlow(ctx, r.from, r.to);
    if (out.handled) return out;
    ctx.note(`${out.why}; working step by step instead.`, 'dim');
    return null;
  }
  if (r.kind === 'fix') {
    const out = await fixFlow(ctx, text);
    if (out.handled) return out;
    // A kind the tests cannot see (a layout bug, say) goes step by step, never test-first.
    if (out.next === 'change' || (!ctx.testCmd && !out.stepByStep)) {
      ctx.note(ctx.testCmd ? 'The tests pass today, so first a test that shows the problem.' : 'This project has no tests, so first a small check that shows the problem.', 'dim');
      return changeOrMulti(ctx, text);
    }
    ctx.note(`${out.why}; working step by step instead.`, 'dim');
    return null;
  }
  if (r.kind === 'change') return changeOrMulti(ctx, text);
  return null;
}

// A change: the files it touches are planned first (named in the request,
// or the model's pick from the project map). Two or more → the multi-file
// path; one → the change path, which is told the file.
async function changeOrMulti(ctx, text) {
  let targets = [];
  try { targets = await planFiles(ctx, text, projectFiles(ctx.cwd)); } catch (e) { if (ctx.signal?.aborted) throw e; }
  if (targets.length > MAX_FILES) { ctx.note('This task spans more files than the focused workflow can cover; working step by step.', 'dim'); return null; }
  if (targets.length >= 2) {
    const m = await multiFlow(ctx, text, targets);
    if (m.handled) return m;
    // Tries that failed against the test would fail the same way in one file: straight to step by step.
    ctx.note(`${m.why}; working step by step instead.`, 'dim');
    return null;
  }
  const out = await changeFlow(ctx, text, { hint: targets[0] });
  if (out.handled) return out;
  ctx.note(`${out.why}; working step by step instead.`, 'dim');
  return null;
}
