// Sorting a request into a type and running the path built for it:
//   rename  → the built-in rename (no model)
//   fix     → tries against the failing tests
//   change  → test first, then tries
//   question / other → the step-by-step tool loop
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { complete } from './llm.mjs';
import { planRename, applyRename, leftAloneNote } from './rename.mjs';
import { fixFlow } from './fix.mjs';
import { changeFlow } from './change.mjs';
import { planFiles, multiFlow } from './multi.mjs';
import { projectFiles } from './localize.mjs';

const ID = '[`\'"]?([A-Za-z_$][\\w$]*)[`\'"]?';
// A whole request that is one file operation: "delete trades.json",
// "rename export.mjs to exporter.mjs", "move old/ into archive", "remove the logs folder".
const PATHISH = '["\'`]?(?:[\\w.~-]+\\/)*[\\w~-][\\w.~-]*(?:\\.\\w{1,6}|\\/)["\'`]?';
const FILE_OP = new RegExp(`^\\W*(?:please\\s+)?(?:delete|remove|rm|trash|move|mv|rename|copy|cp|duplicate)\\s+(?:the\\s+)?(?:(?:file|folder|directory)\\s+)?(?:${PATHISH}|[\\w.-]+\\s+(?:file|folder|directory|dir))(?:\\s+(?:to|into|as|in|inside)\\s+(?:the\\s+)?\\S+(?:\\s+(?:file|folder|directory))?)?\\s*[.!]?\\s*$`, 'i');
const CODE_FILE = /\b[\w-]+\.(m?[jt]sx?|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h)\b/i;
const CODE_WORDS = /\b(function|method|class|helper|bug|crash(es)?|flag|field|option|parameter|argument|variable|property|endpoint|generator|parser|stdout|stderr|exception)\b/i;

// Greetings and thanks: answered in a sentence, with no tools (a "hello" once
// read the project and asked to run the tests).
export function isSmallTalk(text) {
  return /^(hi|hello|hey|yo|hiya|howdy|thanks|thank you|thx|ty|ok|okay|cool|great|nice|good (morning|afternoon|evening)|who are you|what can you do)\b[\s!.?,]*(bonsai|there)?[\s!.?]*$/i.test(text.trim());
}

export function routeByRules(text) {
  const t = text.trim();
  const rn = new RegExp(`\\brename\\s+(?:the\\s+)?(?:function|method|variable|var|class|const(?:ant)?|symbol|field|property|type|name)?\\s*${ID}\\s+(?:to|as|into|→|->)\\s+${ID}`, 'i').exec(t);
  if (rn) return { kind: 'rename', from: rn[1], to: rn[2] };
  // Greetings and thanks go straight to the conversation: asking the model to
  // sort them cost a request, and with a big model a re-read of its instructions.
  if (isSmallTalk(t)) return { kind: 'question', chat: true };
  if (/\b(don'?t|do not|without|no)\s+(change|chang|edit|touch|modif)|\b(change|edit|touch|modify)\s+nothing\b|\bno (code )?changes?\b|\bjust (explain|tell|describe|show)\b/i.test(t)) return { kind: 'question' };
  // Deleting, moving, renaming or copying a file is a file operation, not a
  // code change: it goes step by step, where the command asks you first.
  // ("delete trades.json" once became code that deleted the file on every run.)
  if (FILE_OP.test(t) && !/^\W*\w+\s+console\.\w+/i.test(t)) return { kind: 'other' };
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
  if (/\?\s*$/.test(t) && !(/\b(can|could|would|will) you\b/i.test(t) && asks)) return { kind: 'question' };
  // A question on the first line with pasted output under it ("Here is a log,
  // what went wrong?" + the log) is still a question, whatever the log says.
  const first = t.split('\n')[0];
  if (first !== t && /\?\s*$/.test(first) && !/\b(fix|change|add|update|make|solve|repair)\b/i.test(first)) return { kind: 'question' };
  if (/^(?:(?:just|please|can you|could you|hey|hi|ok)[,\s]+)?(what|which|where|why|how|who|when|explain|describe|show me|list|tell me|does|is|are|summari[sz]e)\b/i.test(t) && !asks) return { kind: 'question' };
  if (/\b(fix|failing|fails|broken|bug|crash(es)?|doesn'?t work|does not work|wrong result)\b/i.test(t)) return { kind: 'fix' };
  if (/\b(add|implement|create|make|change|update|support|remove|delete|refactor|write|rename)\b/i.test(t)) return { kind: 'change' };
  return null;
}

export async function route(ctx, text) {
  const byRules = routeByRules(text);
  if (byRules) return byRules;
  const r = await complete({ url: ctx.url, model: ctx.model, slot: ctx.slot, signal: ctx.signal, temperature: 0, maxTokens: 80,
    system: 'You sort a request to a coding assistant into one kind.',
    user: `Request: ${text}\n\nKinds: question (only wants an answer), rename (rename one name everywhere), fix (something is broken), change (add or change code), other.`,
    schema: { type: 'object', properties: { kind: { type: 'string', enum: ['question', 'rename', 'fix', 'change', 'other'] }, from: { type: 'string' }, to: { type: 'string' } }, required: ['kind'] } });
  const k = r.json?.kind ?? 'other';
  if (k === 'rename' && !(r.json.from && r.json.to)) return { kind: 'change' };
  return { kind: k, from: r.json?.from, to: r.json?.to };
}

export async function renameFlow(ctx, from, to) {
  const plan = planRename(ctx.cwd, from, to);
  const left = leftAloneNote(plan);
  if (!plan.files.length) return { handled: false, why: `${from} is not used in the project's code${left ? ` (${left.replace(/\.$/, '').replace(/^Left alone: /, 'only ')})` : ''}` };
  const p = ctx.plan([`Find every use of ${from}`, `Rename them to ${to}`, ...(ctx.testCmd ? ['Run the tests'] : [])]);
  p.step(0);
  ctx.tool('Search', from, { kind: 'search', count: plan.total, content: plan.files.map((f) => `${f.rel}: ${f.count}`).join('\n') });
  p.step(1);
  if (ctx.mode() !== 'edits') {
    const answer = await ctx.ask({ id: `rename_${Date.now()}`, name: 'Rename', args: { from, to }, prepared: { files: plan.files.map((f) => ({ rel: f.rel, hunk: f.hunk, count: f.count })), total: plan.total }, label: 'Rename', arg: `${from} → ${to}` });
    if (answer.choice === 'no') { ctx.tool('Rename', `${from} → ${to}`, { kind: 'declined', feedback: answer.feedback }, true); return { handled: true, done: false, declined: true, summary: 'You said no to the rename; nothing was changed.' }; }
    if (answer.choice === 'always') ctx.setMode('edits');
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
  if (targets.length >= 2) {
    const m = await multiFlow(ctx, text, targets);
    if (m.handled) return m;
    // Tries that failed against the test would fail the same way in one file: straight to step by step.
    if (m.tried) { ctx.note(`${m.why}; working step by step instead.`, 'dim'); return null; }
    ctx.note(`${m.why}; trying the main file on its own.`, 'dim');
  }
  const out = await changeFlow(ctx, text, { hint: targets[0] });
  if (out.handled) return out;
  ctx.note(`${out.why}; working step by step instead.`, 'dim');
  return null;
}
