// The agent loop: send the conversation to the model, stream what comes
// back, run the tool it asks for (asking you first when needed), feed the
// result back, and repeat until it answers without a tool.
import { EventEmitter } from 'node:events';
import { endpointOf } from '../../../models/index.mjs';
import { searchKey, PROVIDER_NAMES } from '../tools/web.mjs';
import { readInstructions, replaceInstructionBlock, focusedInstructions } from './instructions.mjs';
import { streamChat } from './client.mjs';
import { toolSchemas, parseArgs, sentArgs, needsText, display, prepare, execute, resolvePath, didYouMean, syntaxError, WHOLE_MAX, needsSight, EXPLORE_TOOLS } from './tools.mjs';
import { existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { outlineText } from '../tools/outline.mjs';
import { repoMap } from '../tools/repomap.mjs';
import { rankFiles } from './rank.mjs';
import { decide, isReadOnly, offerFor, protectedBy } from './permissions.mjs';
import { testCommand, systemPrompt, projectNotes, gitSummary, isHomeFolder, notesRoom } from './prompt.mjs';
import { sortBug, kindText } from './rules.mjs';
import { lookSecs, LOOK_NOTE, LOOK_BACKS, lookBackNote } from './look.mjs';
import { pickSkill, skillNote, readSkills, skillsList, toolUseText } from './prompt-files.mjs';
import { sortMath, mathNotes, mathIndex } from './expertise.mjs';
import { isDesignRequest, pickCards, designNotes, designSettings, mixTurn } from './design.mjs';
import { pickPieces, studioNotes, buildStyles, buildNote, isBuilt } from './studio.mjs';
import { layoutCheck, layoutNote, pagesToCheck, findChrome, needsServer } from '../flows/layoutcheck.mjs';
import { findProjects, projectsNamed } from './projects.mjs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { runFlows, runKind, isSmallTalk, routeByRules, isCodeProject } from '../flows/index.mjs';
import { wayOf, hooksOn, wayPrompt } from './way.mjs';
import { clarify } from '../flows/clarify.mjs';
import { isFollowUp, sortLine } from '../flows/words.mjs';
import { checkInText } from '../flows/fix.mjs';
import { Scratch } from '../flows/scratch.mjs';
import { lostNames } from '../flows/blocks.mjs';
import { partsFor, wholeSmallProject } from '../flows/explain.mjs';
import { upFrontFor } from './room.mjs';
import { readResults } from '../flows/results.mjs';
import { runCommand } from '../tools/run.mjs';
import { complete, tallies, llmCalls, oldThinking } from '../flows/llm.mjs';
import { isMemoryRequest } from './memory.mjs';
import { changedLines } from '../tools/edit.mjs';
import { changeTrust } from './facts.mjs';
import { recall, recallNotes, usedFacts } from './recall.mjs';
import { recallClaude, claudeText, notesDir } from './claude-notes.mjs';
import { saveLessons, knownAlready, practiceWork, applySave, saveLine } from './lessons.mjs';
import { helpersOn, CODENAMES, shareOut, chars, CEILING, SHARES, fixLike, talksAboutChanges, createdNames, testReport, gitChanges, whoUses } from './helpers.mjs';
import { CodeIndex, sameAsIndexed, partKey, CUT, MARGIN } from '../tools/codeindex.mjs';
import { choose, howChosen } from './search.mjs';
import { IMAGE_TOKENS } from './images.mjs';

const MAX_STEPS = 40;
// When the model decides (way.mjs): the calls of one reply that run, in order.
export const MAX_CALLS = 8;
// Its own tools on Model (tools.mjs MODEL_TOOL_DEFS), run by the agent itself.
const MODEL_TOOLS = new Set(['Map', 'CodeSearch', 'Rename', 'TestFirst', 'Remember']);
const CODE_SEARCH_CHARS = 6000; // what one CodeSearch brings back, at most (~1,700 tokens)
// A request's time for thinking (30 Sep 2026): past half of it, it thinks only briefly, so it
// finishes instead of running out of time (practice task 28 at High ran out of its 30 minutes on
// 29 Sep, while Low passed it in under 3). The chat keeps the template's thinking switch and is
// capped at STEP_DOWN_CAP tokens a reply: Gemma's template puts the switch at the very top of the
// prompt, so turning it off would read the whole conversation again. The focused paths' own calls
// stop thinking. AGENTIC_THINK_BUDGET: seconds (0: never); the practice runs pass their limit.
export const THINK_BUDGET_SECS = 900;
export const STEP_DOWN_CAP = 64;
const budgetFromEnv = () => { const v = Number(process.env.AGENTIC_THINK_BUDGET ?? process.env.BONSAI_THINK_BUDGET); return Number.isFinite(v) && v >= 0 ? v : THINK_BUDGET_SECS; };
const TRIM_AT = 0.78; // share of the context that starts a trim
const TRIM_TO = 0.45; // …and where it stops
const FULL = 0.85; // past this share (with the reply room counted) trimming was not enough: summarize
// Room kept free for one reply: thinking (up to the server's reasoning budget)
// plus the answer. At 16k, a trim at 78% left too little, and a High reply
// ran into the end of the memory (chart bug, 25 Sep). The thinking part is the
// model's own budget, so raising it in model.mjs leaves the answer its 2,048.
const replyRoom = (thinking, budget = 2048) => (thinking ? 2048 + budget : 2048);
const NOTES_ROOM = 700; // tokens for its notes when memory fills (about 200 words, with room to spare)
// Its own thinking goes back with each step: the model's chat template shows
// every earlier step's thinking, and without it each step looked as if it had
// thought nothing, so it worked the cause out again (or lost it). The newest
// KEEP_THOUGHTS steps keep all of it; older ones keep only their key lines
// once memory runs short.
const KEEP_THOUGHTS = 3;
// A question that names files gets them read in one go (see prefetch).
const PREFETCH_MAX_LINES = 1000;
// Characters a question's named files may fill: /effort's Up-front reading, a share of the context (room.mjs: 45,000 at 32k).
const MAP_MIN_FILES = 4; // fewer code files than this: no project map, the model just reads them
// Any other request in a project: the files it is most likely about
// (rank.mjs), read before the first step. The budget follows the memory:
// ~2,950 tokens at 16k (about 20 s of reading), ~5,900 at 32k, at most 8,000.
const RANK_SHARE = 0.18;
const RANK_MAX_TOKENS = 8000;
const TESTS_FIRST_MS = 60_000; // the tests helper's run before the first step
// Asking about code even when the request was not sorted (plan mode, a folder that is not a project).
const EXPLAIN = /\b(explain|describe|walk me through|summari[sz]e|what does|how does|what is in|tell me about)\b/i;
// A message that says the last turn went wrong.
const CORRECTS = /^(no[,.! ]|nope\b|wrong\b|that('?s| is| was) (not|wrong)|this is (not|wrong)|not what i\b|that('?s| is) not what\b|you (broke|missed|forgot|did ?n[o']t|should ?n[o']t have|were not supposed)|undo (that|this|it)\b|revert (that|this|it)\b|put it back\b|why did you\b|i (did ?n[o']t|never) (ask|say|want))/i;

// Files a request names ("explain src/app/App.jsx", "what does export.mjs do?"):
// existing files inside the project, at most three. A name that is not there
// is matched to a look-alike, unless lookAlike is false or the request asks
// to make that file (skip: names from helpers.mjs createdNames).
export function filesNamed(cwd, text, { lookAlike = true, skip = null } = {}) {
  const out = [];
  for (const m of text.matchAll(/(?:^|[\s`'"(])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z]\w{0,5})(?=$|[\s`'",:;!?)]|\.(?:\s|$))/g)) {
    let rel = m[1];
    let p = resolvePath(cwd, rel);
    if (!existsSync(p.abs)) {
      if (!lookAlike || skip?.has(basename(rel).toLowerCase())) continue;
      const alt = didYouMean(cwd, rel);
      if (alt.length !== 1) continue;
      rel = alt[0];
      p = resolvePath(cwd, rel);
    }
    if (!p.inside || !statSync(p.abs).isFile() || out.some((f) => f.abs === p.abs)) continue;
    out.push({ rel: p.rel, abs: p.abs });
    if (out.length === 3) break;
  }
  return out;
}
const tokensOf = (s) => Math.ceil((s?.length ?? 0) / 3.6);

// A reply that keeps repeating a short piece ("// // // //") is a known
// failure of low-bit models; catch it while it streams.
export function isLooping(text) {
  const tail = text.slice(-240);
  if (tail.length < 120) return false;
  for (let unit = 1; unit <= 12; unit++) {
    const piece = tail.slice(-unit);
    if (!piece.trim()) continue;
    let reps = 0;
    for (let i = tail.length - unit; i >= 0 && tail.slice(i, i + unit) === piece; i -= unit) reps++;
    if (reps * unit >= 100 && reps >= 10) return true;
  }
  return false;
}

// A reply that asks the user something: a question anywhere (outside code)
// or a request for input ("Give me a little detail and I'll dig in"). Such a
// reply ends the turn and waits: no "go ahead", no follow-up checks.
// Agentic Coder's own notes go into the conversation where the user's words go, so
// each one says it is automatic: once, a note ("the story is cut off") was
// taken as the user's report and the model spent 20 minutes on it.
export const AUTO = '[Automatic note from Agentic Coder, not from the user]';
const CUT_MARK = '[… cut here by Agentic Coder for this check; the rest is in the file]';
const auto = (text) => `${AUTO} ${text}`;

// A question put to the user: a sentence ending in "?" that speaks to them
// ("Are you seeing it in TextEdit?", "Should I…?"), or a request for input.
// "Why does it fail? Let me read the test." is thinking aloud, not this.
export function asksTheUserDirectly(text) {
  const prose = String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  if (prose.split(/(?<=[.!?])\s+/).some((q) => /\?\s*["'”’)*_]*$/.test(q.trim()) && /\b(you|your|yours|should I|shall I|do I|would I)\b/i.test(q))) return true;
  return /\b(give me|point me|tell me|let me know|could you|would you|can you|do you want|would you like|want me to|which (?:one|file|folder|project) do you|what would you like|up to you|your call)\b/i.test(prose);
}

export function asksTheUser(text) {
  const prose = String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  if (/\?(\s|$|["'”’)*_])/.test(prose)) return true;
  return /\b(give me|point me|tell me|let me know|could you|would you|can you|do you want|would you like|want me to|shall I|which (?:one|file|folder|project) do you|what would you like|up to you|your call)\b/i.test(prose);
}

// A reply whose last sentence says what it is about to do ("Let me fix the
// median function in stats.mjs.") instead of doing it.
export function announcesNextStep(text) {
  const last = text.trim().split(/(?<=[.!?:])\s+(?=[A-Z])/).pop() ?? '';
  // An offer that waits for the user ("tell me and I'll dig in", "If you want,
  // I can…", "Let me know…") or a question is not a step it is about to take.
  if (/\?\s*$|\b(if you|tell me|let me know|would you like|do you want|want me to|shall I)\b/i.test(last)) return false;
  return /\b(I will|I'll|I am going to|I'm going to|Let me|Let's|I need to|I should|First,? I|Next,? I|Now,? I)\b/i.test(last);
}

// An answer saying the work was already there ("The --json flag is already in
// place"), which is false when this turn created the file.
export function claimsAlreadyThere(text) {
  return /\b(?:already|was already|were already)\s+(?:in place|there|exists?|present|implemented|supported|set up|done|works?|working|has|had|in the (?:file|project|code))\b|\b(?:is|are|was|were)\s+already\b/i.test(text ?? '');
}

// A request for work (make, add, fix…) and an answer that says it was done:
// with no file changed in the message, the answer is not true (Qwen, 29 Sep:
// asked again for the weather page, it answered "Done" and wrote nothing).
export function asksForWork(text) {
  // "why is the build slow", "how do I add a flag": a question, not work.
  if (/^\W*(why|what|how|where|when|which|who|explain|is|are|does|do)\b/i.test(text ?? '')) return false;
  return /\b(add|fix|change|make|implement|create|build|rename|remove|delete|update|refactor|write|save|put|move|replace|edit|restyle|redesign|improve|convert|generate)\b/i.test(text ?? '');
}
export function claimsDone(text) {
  const t = String(text ?? '').replace(/```[\s\S]*?```/g, ' ');
  if (/\b(nothing (?:was |has been |is )?(?:changed|written|edited|done)|no (?:files?|changes?|edits?) (?:was |were |have been |has been )?(?:changed|made|written|needed)|(?:did|do|have|has|could|can)(?: not|n'?t)|cannot|unable|not (?:done|changed|made|finished|written))\b/i.test(t)) return false;
  return /\b(done|finished|completed?|created|updated|added|fixed|implemented|saved|wrote|written|changed|built|made|applied|removed|replaced|renamed|moved)\b/i.test(t);
}

// Sentences where it names a cause or a fix ("The .hud creates a stacking
// context…", "So the problem: .hud has z-index:4."): they survive trims and
// summaries word for word, and one that names a fix before anything changed
// gets a "make the change now" note (see actNow).
const CAUSE = /\b(?:root cause|the cause|caused by|so the (?:problem|issue|bug)|the (?:real |actual |whole )?(?:problem|issue|bug|reason) (?:is|was|here)\b|that(?:'s| is) (?:why|the (?:bug|problem|cause))|which is why|this is why|that explains|explains (?:why|the)|stacking context|(?:is|are|gets?) (?:covered|hidden|overridden|shadowed) by)/i;
const FIX = /\b(?:the fix(?: is|:| would be| should be| here)|so the fix|to fix (?:this|it)[,:]|fix it by|the (?:simplest|smallest|one-line|real|right) (?:fix|change)|the solution is|(?:I|we) (?:need|have|should|must) to (?:change|raise|increase|lower|set|move|add|remove|replace|swap)|(?:raising|increasing|lowering|changing|setting) \S+(?: \S+){0,6} (?:to|from) \S+(?: \S+){0,3} (?:fixes|would fix|should fix|solves))/i;
const HEDGE = /^(?:wait|hmm|maybe|perhaps|if\b|unless|or\b|let me|let's|actually,? let me|i wonder)/i;
export function keyLines(text, max = 4) {
  const prose = String(text ?? '').replace(/```[\s\S]*?```/g, ' ');
  const out = [];
  for (const s of prose.split(/(?<=[.!?])\s+|\n+/)) {
    const t = s.trim().replace(/^[-*•]\s+/, '');
    if (t.length < 25 || t.length > 400 || HEDGE.test(t) || !(CAUSE.test(t) || FIX.test(t))) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(-max);
}
export const namesAFix = (line) => FIX.test(line) || /^so the (?:problem|issue|bug)|^the (?:root )?cause|^that(?:'s| is) the (?:bug|problem|cause)/i.test(line);

// What the model is told when its call was cut off at the reply limit: the
// arguments end mid-string, so running the call can only fail. Usually it is
// a Write with a whole file in it (a finance dashboard cost two 6-8 minute
// tries at the same too-big Write on 26 Sep).
export function cutCallNote(name, path) {
  const file = path || 'the file';
  if (name === 'Write' || name === 'Edit') {
    return `Your ${name} call ran out of room before the end, so nothing was written: the whole content does not fit in one reply. Build ${file} in parts instead. First Write ${file} with only a short skeleton: its opening, empty sections marked with comments, and its closing. Then add one section at a time with Edit, each part well under 100 lines. Start with the skeleton now.`;
  }
  return `Your ${name} call ran out of room before the end and was not run. Do it again in smaller pieces.`;
}

// A tool call written as text instead of a real call: <tool_call>{...}</tool_call>
export function toolCallInText(text) {
  // The 27B's own format: <tool_call><function=Name><parameter=key>value</parameter>…</function></tool_call>
  const x = /<tool_call>\s*<function=([^>\s]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/.exec(text);
  if (x) {
    const args = {};
    for (const p of x[2].matchAll(/<parameter=([^>\s]+)>\n?([\s\S]*?)\n?<\/parameter>/g)) args[p[1]] = paramValue(p[2]);
    return { name: x[1], args: JSON.stringify(args), before: text.slice(0, x.index).trim() };
  }
  // JSON inside the tags, as other Qwen-style models write it.
  const m = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/.exec(text);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]);
    if (typeof j.name !== 'string') return null;
    return { name: j.name, args: typeof j.arguments === 'string' ? j.arguments : JSON.stringify(j.arguments ?? {}), before: text.slice(0, m.index).trim() };
  } catch { return null; }
}

// A parameter value is text unless it is clearly JSON (a number, true/false,
// null, an object or a list).
function paramValue(v) {
  if (/^\s*(-?\d+(\.\d+)?|true|false|null|\{[\s\S]*\}|\[[\s\S]*\])\s*$/.test(v)) {
    try { return JSON.parse(v); } catch {}
  }
  return v;
}

// The chat template needs each call's arguments as a JSON object; a call the
// model garbled would make every later request fail, so keep "{}" instead.
export function safeArgs(args) {
  try {
    const j = JSON.parse(args || '{}');
    return j && typeof j === 'object' && !Array.isArray(j) ? JSON.stringify(j) : '{}';
  } catch { return '{}'; }
}

// Check-ins while exploring: every this many looks, or seconds, without a change.
// 6 looks (was 8, 28 Sep): a task that has read six things and changed
// nothing is usually lost, and a word from you costs less than more steps.
export const CHECK_INS = { steps: 6, secs: 300 };
const LOOKS = new Set(['Read', 'Search', 'List', 'Glob', 'Grep', 'Bash']);

// A helper's steps at most (its own limit, under the conversation's).
const HELPER_STEPS = 30;
// A helper's instructions: the conversation's (the project, its rules), then what a helper is.
export function helperPrompt(system, kind) {
  return `${system}\n\n# You are a helper\nThe main agent handed you one task. You see only this task, not its conversation, and you cannot ask the user anything. Work it out with your tools, then end with a short report for the main agent: ${kind === 'explore' ? 'what you found, with file:line or the page it came from. You only read: do not change anything; say what should change instead.' : 'what you changed (files and lines) and what you checked, or what stopped you.'}`;
}

// The web addresses (http or https) a request names, each once.
export const webAddresses = (text) => [...new Set(String(text ?? '').match(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi) ?? [])].map((u) => u.replace(/[.,;:!?]+$/, ''));

// One line saying what an edit will do, for the plan question.
export function planLine(name, args, prepared) {
  const cut = (x) => { const l = String(x ?? '').trim().split('\n'); const f = l[0].trim().slice(0, 100); return l.length > 1 || l[0].length > 100 ? `${f}…` : f; };
  if (name === 'Write') return `${prepared.created ? 'create' : 'rewrite'} ${prepared.rel ?? args.path}`;
  return `in ${prepared.rel ?? args.path}, change "${cut(args.old_text)}" to "${cut(args.new_text)}"`;
}

export class Agent extends EventEmitter {
  // whenFull: what happens when the conversation fills the model's memory.
  // 'notes' (the default): it writes down where it is and carries on from
  // its notes. 'trim': old tool output is emptied first (the way before
  // 2026-09-27; AGENTIC_WHEN_FULL=trim).
  // memory: what Agentic Coder remembers from one day to the next (facts.mjs).
  // rewarm: puts the saved reading of the instructions back in the model's
  // memory (the app and `coding -p` pass it), so a conversation that starts
  // over from its notes does not read the instructions again.
  constructor({ url, model, cwd, system, thinking = true, effort, ctx = 32768, mode = 'ask', ask, waitForServer, verify = true, flows = true, maxTries = 8, testTimeoutMs = 120_000, checkIns = CHECK_INS, confirmPlan = true, slots, trimAt = TRIM_AT, fullAt = FULL, maxSteps = MAX_STEPS, bash = null, whenFull = (process.env.AGENTIC_WHEN_FULL ?? process.env.BONSAI_WHEN_FULL) === 'trim' ? 'trim' : 'notes', rewarm, memory = null, ranker = null, helpers = null, embedder = null, indexDir, search = null, reranker = null, permissions = null, rewind = null, design, thinkBudgetSecs = budgetFromEnv(), way = 'app', hooks = null, web = null, subagents = true }) {
    super();
    // Who decides (way.mjs): 'app' as before, or 'model'; and the app's checks switched on as
    // hooks for when the model decides (on App they all run, as they always have).
    this.way = wayOf(way);
    this.hooks = hooksOn(hooks ?? []);
    // /web: { search: 'off' | 'brave' | 'tavily', fetch, claude } (null: no web tools, as in a practice run).
    this.web = web;
    // The Agent tool (helpers): "subagents": false in settings.json leaves it out.
    this.subagents = subagents !== false;
    Object.assign(this, { url, model, cwd, thinking, effort: effort ?? model?.thinkingEffort, ctx, mode, ask, waitForServer, verify, flows, maxTries, testTimeoutMs, checkIns, confirmPlan, trimAt, fullAt, maxSteps, bash, whenFull, rewarm, permissions, thinkBudgetSecs });
    // The small model that ranks files by meaning (rank.mjs): the memory's,
    // or one given on its own (the practice bench runs without the memory).
    this.ranker = ranker;
    // The memory (facts.mjs, recall.mjs): { embedder, home }. Without it
    // nothing is brought back and nothing is learned (tests, practice runs).
    this.memory = memory || null;
    // The context helpers (helpers.mjs): none unless given; the app and
    // `coding -p` pass them (/helpers, AGENTIC_HELPERS). Given, they also
    // switch Read first (prefetchRanked): 1 the files a request names, 3 the
    // files closest by meaning. Not given (tests, other callers), Read first
    // works as it always has.
    this.helpersGiven = helpers != null;
    this.helpers = helpers == null ? new Set() : helpersOn(helpers);
    // The small model that compares meanings: the memory's, shared with the
    // file ranking and the code search.
    this.embedder = embedder ?? memory?.embedder ?? ranker ?? null;
    this.codeIndex = null;
    this.indexDir = indexDir; // where the code search keeps its index (tests: a throwaway folder)
    // /effort's Search rows (search.mjs): Retriever 'meaning' or 'hybrid', and
    // the reranker when it is on (models/runtime/rerank.mjs). Neither given,
    // every search chooses by meaning alone, as it always has.
    this.search = { retriever: 'meaning', ...(search ?? {}) };
    this.reranker = reranker;
    // /rewind (app/rewind.mjs): copies of the project around each message and command.
    this.rewind = rewind;
    // The design examples and the layout check (design.mjs): settings.json's
    // "design" as saved; AGENTIC_DESIGN, AGENTIC_DESIGN_SETS and AGENTIC_LAYOUT win over it.
    this.designSaved = design ?? {};
    this.lessons = []; // what happened in each turn, for the next save (lessons.mjs)
    // When Agentic Coder started the server itself it has two slots: the
    // conversation stays in 0, side requests (sorting, tries) use 1.
    this.slots = slots ?? null;
    // How this project runs its tests; used to check a change before calling it done.
    this.testCmd = verify ? testCommand(cwd) : null;
    this.messages = [{ role: 'system', content: wayPrompt(system, this.way) }];
    this.workingInstructions = readInstructions().sections;
    this.promptStampUsed = this.promptStamp();
    this.allowedPrefixes = new Set();
    this.readFiles = new Set(); // files read (or written) in this conversation
    this.todos = null;
    this.ctxUsed = tokensOf(this.messages[0].content) + 1200; // system + tool definitions, until the server reports
    this.busy = false;
    this.stats = { tps: null, pps: null, outTokens: 0, requests: 0 };
  }

  // The prompt of this way: the model's own tool lines when it decides (way.mjs wayPrompt).
  setSystem(system) { this.messages[0] = { role: 'system', content: wayPrompt(system, this.way) }; }
  // The tools the model is offered: the app's eight, and its own five when it decides.
  tools() {
    const all = toolSchemas(this.way, this.webTools(), { agents: this.agentsOn() });
    return this.toolFilter ? all.filter((t) => this.toolFilter.has(t.function.name)) : all;
  }
  // The Agent tool (a helper, tools.mjs AGENT_TOOL_DEF): when the model decides, and on the
  // Claude API; never inside a helper; "subagents": false in settings.json leaves it out.
  agentsOn() { return !this.isHelper && this.subagents !== false && (this.way === 'model' || endpointOf(this.url)?.kind === 'claude'); }
  // The web tools on offer (/web): WebSearch with a search service, WebFetch with reading pages.
  // On the Claude API both are Anthropic's own (claude.mjs), unless /web's Claude row is off.
  webTools() {
    const w = this.web;
    if (!w) return null;
    if (endpointOf(this.url)?.kind === 'claude') return w.claude === false ? null : { search: 'claude', fetch: true };
    return { search: w.search && w.search !== 'off' ? w.search : null, fetch: w.fetch !== false };
  }
  // Whether one of the app's checks runs (way.mjs HOOKS): always on App, when switched on on Model.
  hook(id) { return this.way !== 'model' || this.hooks.has(id); }
  // /effort's Who decides row: the next message goes the new way. The prompt and the tools
  // change with it, so the next reply reads the instructions again (the app warms them up).
  setWay(way, hooks) {
    const next = wayOf(way);
    if (hooks !== undefined) this.hooks = hooksOn(hooks ?? []);
    if (next === this.way) return false;
    const before = tokensOf(this.messages[0].content);
    this.way = next;
    this.messages[0] = { role: 'system', content: wayPrompt(this.messages[0].content, next) };
    this.ctxUsed += tokensOf(this.messages[0].content) - before;
    this.emit('way', next);
    return true;
  }
  // /effort's Rules room and Up-front reading: 0 = auto, a share of the context (room.mjs).
  // /effort's Look first (look.mjs): 'auto' follows Effort, 'off', or a number of seconds. The app
  // and coding -p set it from /effort (auto by default); a bare Agent (tests, the practice runs) does not look first.
  look = 'off';
  get lookSecsNow() { return lookSecs(this.look, { thinking: this.thinking, effort: this.effort }); }
  rulesRoom = 0;
  upFront = 0;
  get notesRoomNow() { return this.rulesRoom || notesRoom(this.ctx); }
  get upFrontNow() { return this.upFront || upFrontFor(this.ctx); }
  // The rules or the context changed what the room comes to: the rules are read again once, before the next message.
  syncRules() {
    if (this.notesRoomUsed === undefined || this.notesRoomUsed === this.notesRoomNow) return;
    this.refreshNotes();
  }
  // The rules changed (/rules): the next message reads them. The instructions
  // are read again once, as after a move to another folder.
  refreshNotes() {
    const before = tokensOf(this.messages[0].content);
    this.notesRoomUsed = this.notesRoomNow;
    this.promptStampUsed = this.promptStamp();
    this.setSystem(systemPrompt({ cwd: this.cwd, notes: projectNotes(this.cwd, this.notesRoomUsed).text, git: gitSummary(this.cwd), instructions: this.workingInstructions }));
    this.ctxUsed += tokensOf(this.messages[0].content) - before;
  }
  // The prompt files as they are now: the rules files (AGENTS.md or CLAUDE.md, whole, without
  // the memory), TOOLS.md's Tool use lines and SKILLS.md's list (prompt-files.mjs). A change to
  // any of them, saved in the hub or anywhere else, is read before the next message.
  promptStamp() {
    try { return `${projectNotes(this.cwd, Infinity, { memory: false }).text}\u0000${toolUseText()}\u0000${skillsList(readSkills())}`; } catch { return null; }
  }
  promptFilesChanged() {
    const now = this.promptStamp();
    if (now === null || now === this.promptStampUsed) return false;
    this.promptStampUsed = now;
    return true;
  }
  // Work in another folder from now on: its tests, its AGENTS.md, and the fence
  // around commands, which is always the folder Agentic Coder works in.
  moveTo(dir) {
    const before = tokensOf(this.messages[0].content);
    this.cwd = dir;
    this.rewind?.moved(dir);
    this.testCmd = this.verify ? testCommand(dir) : null;
    this.notesRoomUsed = this.notesRoomNow;
    this.setSystem(systemPrompt({ cwd: dir, notes: projectNotes(dir, this.notesRoomUsed).text, git: gitSummary(dir), instructions: this.workingInstructions }));
    this.ctxUsed += tokensOf(this.messages[0].content) - before;
    this.promptStampUsed = this.promptStamp();
    this.readFiles = new Set();
    this.mapGiven = false;
    this.lastRoute = null;
    this.codeIndex = null;
    this.emit('cwd', { cwd: dir });
  }

  // What Read first reads before the first step: the files a request names,
  // and the files closest to it (rank.mjs). /helpers switches each.
  get readFirst() {
    if (!this.helpersGiven) return { named: true, ranked: true };
    return { named: this.helpers.has('named'), ranked: this.helpers.has('rag') };
  }

  // The code search for this folder (tools/codeindex.mjs, the rag helper),
  // built in the background from the first request on; none in the home folder.
  codeSearch() {
    if (!this.helpers.has('rag') || !this.embedder || isHomeFolder(this.cwd)) return null;
    // It waits while the model answers (a step here, or a focused path's call).
    if (this.codeIndex?.cwd !== this.cwd) this.codeIndex = new CodeIndex(this.cwd, this.embedder, { ...(this.indexDir ? { dir: this.indexDir } : {}), paused: () => this.answering > 0 || llmCalls.now > 0 });
    return this.codeIndex;
  }

  // The parts closest to the request, once the index is built; a build (or a
  // refresh of the files changed since) goes on in the background meanwhile.
  async findCode(text, signal) {
    const index = this.codeSearch();
    if (!index) return null;
    index.build(); // with everything already worked out, it is ready at once
    if (!index.ready) return { waiting: true, done: index.done, total: index.total, off: index.state === 'off' };
    const found = await index.search(text, { signal });
    // The index goes with what it found: /effort's Embedder Off, saved while
    // this request runs, drops this.codeIndex, not this search's own.
    return found && { ...found, index };
  }

  // Outside a project, a request naming one ("the chart bug in MAIN2026") asks
  // once whether to work there. Each project is offered once a session.
  async offerProject(text, signal) {
    const home = homedir();
    // Only from the home folder or its Desktop, Documents and Downloads.
    if (!isHomeFolder(this.cwd)) return null;
    this.projects ??= findProjects(home);
    this.offered ??= new Set();
    const found = projectsNamed(text, this.projects, this.cwd).filter((d) => !this.offered.has(d));
    if (!found.length || found.length > 4) return null;
    for (const d of found) this.offered.add(d);
    const tilde = (p) => (p === home ? '~' : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);
    const one = found.length === 1;
    const question = `${one ? `Work in ${tilde(found[0])}?` : 'Work in which project?'} Agentic Coder then uses its tests and its AGENTS.md, and its commands can only change files there, until /clear.`;
    // Staying is the first choice, so enter keeps you where you started: a
    // pasted command that named the app's own repo once moved it there, and the
    // next request's page could not reach the Desktop (28 Sep).
    const options = [`No, stay in ${tilde(this.cwd)}`, ...found.map((d) => (one ? `Yes, work in ${basename(d)}` : tilde(d)))];
    const id = `project_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', args: { question, options }, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    const said = (answer.text ?? answer.feedback ?? '').trim();
    if (answer.choice === 'no' && !said) return { stop: 'declined' };
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: said } });
    const pick = one ? (/^(yes|y|ok|okay|sure|yep|go)\b/i.test(said) ? found[0] : null) : found.find((d) => said === tilde(d) || said === d);
    if (!pick) return null;
    this.moveTo(pick);
    // /rewind copies the new folder before anything in it changes.
    try { await this.rewind?.whenMoved(); } catch {}
    this.emit('note', { text: `Working in ${tilde(pick)} now: its tests and AGENTS.md, and commands can only change files there.`, tone: 'dim' });
    return { moved: pick };
  }

  // The design studio's build of a page this turn changed: the text for the
  // model, or null (studio off, not a studio turn and never built, or a plain-CSS
  // page). A stock colour it used is said in the same reply.
  async buildStudio(prepared) {
    const design = designSettings(this.designSaved);
    let html = '';
    try { html = readFileSync(prepared.abs, 'utf8'); } catch { return null; }
    if (!isBuilt(html) && !(design.studio && this.turn?.studio)) return null;
    let r;
    try { r = await buildStyles(html); } catch (e) {
      this.emit('note', { text: `Could not build the styles into ${prepared.rel}: ${e.message}.`, tone: 'warn' });
      return null;
    }
    if (r.skipped) return null;
    try { writeFileSync(prepared.abs, r.html); } catch (e) { this.emit('note', { text: `Could not save the built styles into ${prepared.rel}: ${e.code ?? e.message}.`, tone: 'warn' }); return null; }
    this.emit('note', { text: `Built the styles into ${prepared.rel} (${r.classes} classes, ${(r.bytes / 1024).toFixed(1)} KB, ${(r.ms / 1000).toFixed(1)} s)${r.cdn ? ', in place of the Tailwind link' : ''}${r.stock.length ? `; not in your theme: ${r.stock.join(', ')}` : ''}.`, tone: r.stock.length ? 'warn' : 'dim' });
    return buildNote(prepared.rel, r);
  }

  // The layout check of the pages this message changed (flows/layoutcheck.mjs):
  // the text for the model when something is broken, else null. `again`: the
  // look after its fix, which only tells you what is left.
  // `quiet`: no notes (the look at the end of the turn, see stillBroken).
  async checkLayout(again = false, { quiet = false } = {}) {
    if (!designSettings(this.designSaved).check || !this.turn?.startTexts?.size) return null;
    const pages = pagesToCheck(this.cwd, [...this.turn.startTexts.keys()]);
    if (!pages.length) return null;
    const chrome = findChrome();
    if (!chrome) {
      if (!this.layoutTold) { this.layoutTold = true; this.emit('note', { text: 'Layout check skipped: no headless Chrome on this Mac (Chrome, or Playwright\'s own).', tone: 'dim' }); }
      return null;
    }
    const notes = [];
    const left = [];
    for (const rel of pages) {
      const abs = resolvePath(this.cwd, rel).abs;
      let html = '';
      try { html = readFileSync(abs, 'utf8'); } catch { continue; }
      const server = needsServer(html);
      if (server) { this.emit('note', { text: `Layout check skipped for ${rel}: ${server}.`, tone: 'dim' }); continue; }
      const r = await layoutCheck(abs, { chrome });
      if (r.skipped) { this.emit('note', { text: `Layout check skipped for ${rel}: ${r.skipped}.`, tone: 'dim' }); continue; }
      const n = r.problems.length;
      // `check` is the same result for the screen, which draws it as a step with each problem named.
      const check = { page: rel, problems: r.problems, secs: r.secs, again };
      if (quiet) { if (n) left.push({ page: rel, problems: r.problems }); continue; }
      if (!n) this.emit('note', { text: `Layout check, ${rel}: nothing broken at 1440 px, on a phone or in dark mode (${r.secs.toFixed(1)} s).`, tone: 'dim', check });
      else this.emit('note', { text: `Layout check, ${rel}: ${n} problem${n === 1 ? '' : 's'}${again ? ' left' : ''} (${r.secs.toFixed(1)} s)${again ? `: ${r.problems.slice(0, 3).join(' ')}` : ', sent back to fix.'}`, tone: 'warn', check });
      if (n) { notes.push(layoutNote(rel, r.problems)); left.push({ page: rel, problems: r.problems }); }
    }
    // After its fix: what is still broken, and how many edits the turn had then.
    if (this.turn && again) { this.turn.layoutLeft = left.length ? left : null; this.turn.editsAtLook = this.turn.edits ?? 0; }
    if (quiet) return null;
    if (this.turn) this.turn.layout = { pages, problems: notes.length, again };
    return notes.length ? notes.join('\n\n') : null;
  }

  // This turn's request with what goes along with it (see send()): the steps
  // for its kind of bug, the user's own math notes when the topic came up, and
  // the design examples with a request to make or restyle a page.
  withTurnNotes(messages) {
    const t = this.turn;
    const extras = [t?.bug, t?.skill, t?.look, t?.math, t?.design, t?.carried, t?.web].filter(Boolean);
    if (!extras.length) return messages;
    return messages.map((m) => (extras.some((x) => m === x.request) ? { ...m, content: `${m.content}${extras.filter((x) => m === x.request).map((x) => `\n\n(${x.steps ?? x.notes})`).join('')}` } : m));
  }
  setMode(mode) { this.mode = mode; this.emit('mode', mode); }
  // What you saved with /permissions for the folder Agentic Coder works in now:
  // { allow, never, protect }. `permissions` is a function of the folder (the app
  // and `coding -p` give one), so a move to another project switches the lists;
  // read at every call, so a rule saved in another window counts at once.
  savedRules() { return (typeof this.permissions === 'function' ? this.permissions(this.cwd) : this.permissions) ?? null; }
  reset(system) { this.messages = [{ role: 'system', content: system ?? this.messages[0].content }]; this.todos = null; this.readFiles = new Set(); this.mapGiven = false; this.keptWrite = null; this.ctxUsed = tokensOf(this.messages[0].content) + 1200; }
  // A new conversation (/clear) starts in the folder Agentic Coder was started
  // in: a yes to "Work in <project>?" lasts for its conversation only, and each
  // project can be offered again. True when it moved back.
  startOver(home) {
    this.reset();
    this.offered = null;
    if (!home || home === this.cwd) return false;
    this.moveTo(home);
    return true;
  }

  get maxResultChars() { return Math.max(4000, Math.floor(this.ctx * 0.15 * 3.6)); }

  // Past half this request's time for thinking (THINK_BUDGET_SECS): true, and the first time a
  // note says so. Never with thinking off, a budget of 0, or AGENTIC_THINK=old.
  steppedDown() {
    if (!this.thinking || !(this.thinkBudgetSecs > 0) || !this.requestStarted || oldThinking()) return false;
    if (Date.now() - this.requestStarted < this.thinkBudgetSecs * 500) return false;
    if (this.steppedAt == null) {
      this.steppedAt = Date.now();
      this.emit('note', { text: `Half of the ${Math.round(this.thinkBudgetSecs / 60)} minutes for this request are gone, so it thinks only briefly from here and finishes in time.`, tone: 'dim' });
    }
    return true;
  }

  // What the focused paths (src/flows) need from the agent.
  flowContext(signal) {
    const agent = this;
    let seq = 0;
    const tool = (label, arg, view, error) => {
      if (!error && (label === 'Update' || label === 'Write' || label === 'Create') && arg) this.happened?.files.add(String(arg));
      // A test run a path made: if this message goes on step by step, the
      // tests helper hands its result over instead of running them again.
      if (label === 'Bash' && view?.kind === 'bash' && this.happened) this.happened.testRun = { cmd: String(arg), out: (view.lines ?? []).join('\n'), code: view.code, secs: (view.ms ?? 0) / 1000 };
      this.emit('tool', { id: `flow_${++seq}`, name: label, label, arg, view, error });
    };
    return {
      // The facts brought back for this request (recall.mjs), for the paths' own prompts.
      instructions: focusedInstructions(this.messages[0].content),
      memory: this.happened?.notes ?? '',
      // The helpers on (helpers.mjs), for the paths that use one.
      helpers: this.helpers,
      url: this.url, model: this.model, slot: this.slots?.side, sideSlots: this.slots?.sides ?? (this.slots?.side !== undefined ? [this.slots.side] : []), cwd: this.cwd, testCmd: this.testCmd ?? testCommand(this.cwd), testTimeoutMs: this.testTimeoutMs, signal, maxTries: this.maxTries,
      // Code and tests are written at the chat's thinking level (Off by default), read at each
      // call: past half the request's time it is off (steppedDown).
      get thinking() { return agent.thinking && !agent.steppedDown(); },
      effort: this.effort,
      // The memory's small model, which also ranks files by meaning (rank.mjs).
      embedder: this.ranker ?? this.memory?.embedder ?? null,
      emit: (name, ev) => {
        if (name === 'route') { this.lastRoute = ev; this.sorted(ev.kind, { shortcut: true }); }
        if (name === 'tries-done') this.happened?.tries.push({ label: ev.label, marks: (ev.marks ?? []).join(''), summary: ev.summary, failed: Boolean(ev.failed) });
        this.emit(name, ev);
      },
      ask: (req) => this.ask(req),
      confirm: (plan) => (this.confirmPlan ? this.confirm(plan, signal) : { ok: true }),
      mode: () => this.mode,
      setMode: (m) => this.setMode(m),
      // A protected file always asks (permissions.mjs), even on auto-accept.
      protectedBy: (rel) => { const at = resolvePath(this.cwd, rel); return protectedBy([rel, at.realRel], this.savedRules()?.protect); },
      tool,
      note: (text, tone = 'dim') => this.emit('note', { text, tone }),
      // What a path found before handing over to the step-by-step way: a check
      // to run after the change, and a note that goes with the request.
      carry: (found) => { this.carried = found; },
      plan: (steps) => {
        const items = steps.map((text) => ({ text, status: 'pending' }));
        tool('Plan', '', { kind: 'todos', items: items.map((i) => ({ ...i })) });
        return {
          step: (i) => { items.forEach((it, k) => { it.status = k < i ? 'done' : k === i ? 'in_progress' : 'pending'; }); this.emit('flow-step', { index: i, count: items.length, text: items[i].text }); },
          done: () => { items.forEach((it) => { it.status = 'done'; }); this.emit('flow-step', null); },
        };
      },
      runReal: async (cmd) => {
        const r = await runCommand(cmd, { cwd: this.cwd, maxLines: 80, signal });
        const res = readResults(r.lines.join('\n'), r.code);
        tool('Bash', cmd, { kind: 'bash', code: r.code, lines: r.lines, ms: r.ms }, !res.ok);
        return res;
      },
      // One short sentence on what a change does, for the summary.
      describe: async (rel, before, after) => {
        try {
          // Only the lines that really differ: a change in two places is not a rewrite.
          const d = changedLines(before, after).map((l) => `${l.type}${l.text}`).join('\n').slice(0, 3000);
          const r = await complete({ url: this.url, model: this.model, slot: this.slots?.side, signal, temperature: 0.2, maxTokens: 70, system: 'You describe code changes in one short plain sentence.', user: `The change to ${rel}:\n${d}\n\nIn one short sentence, what does this change do?` });
          const one = r.text.trim().split('\n')[0].replace(/^["']|["']$/g, '');
          return one ? `${one.replace(/\.?$/, '.')} ` : '';
        } catch { return ''; }
      },
    };
  }

  // One user message → as many model turns and tools as it takes. Around the
  // work itself, the memory: a message that corrects Agentic Coder counts against
  // the facts the last turn used, and when the turn ends what happened is
  // written down, for the facts' trust and for the next save.
  // shown: the message as you typed it (what /rewind lists and puts back).
  // images: pictures you attached ([{ path, mime, data, w, h }]), carried beside the text (images.mjs).
  async send(text, { signal, shown, images } = {}) {
    this.corrected(text);
    this.turn = null;
    const happened = { at: new Date().toISOString(), request: String(text), recalled: [], notes: '', files: new Set(), tries: [], warnings: [], did: [] };
    this.happened = happened;
    this.requestStarted = Date.now(); // its time for thinking starts now (steppedDown)
    this.steppedAt = null;
    const warn = (ev) => { if (ev?.tone === 'warn' || ev?.tone === 'error') this.happened?.warnings.push(String(ev.text).slice(0, 200)); };
    this.on('note', warn);
    // The folder as it is before this message, for /rewind.
    let point = null;
    if (this.rewind) {
      const slow = setTimeout(() => this.emit('note', { text: 'Saving a copy of this folder first, for /rewind (only the first message waits for it)…', tone: 'dim' }), 1500);
      try { point = await this.rewind.begin({ cwd: this.cwd, text: shown ?? String(text), at: happened.at }); } catch { point = null; } finally { clearTimeout(slow); }
    }
    let reason;
    try { reason = await this.work(text, { signal, images }); } finally {
      this.off('note', warn);
      if (point) { try { await this.rewind.finish(point, { files: happened.files, message: happened.message }); } catch { /* this message cannot be rewound */ } }
    }
    this.settle(reason);
    return reason;
  }

  // /rewind: the conversation goes back to before messages[at] (a message
  // of yours). What the model knew from after it goes with it.
  cutBefore(at) {
    if (!(at > 0 && at < this.messages.length)) return false;
    this.messages.length = at;
    this.turn = null;
    this.todos = null;
    this.keptWrite = null;
    this.readFiles = new Set();
    this.mapGiven = this.messages.some((m) => m.role === 'tool' && String(m.content).startsWith('Code files in the project'));
    this.ctxUsed = this.messages.reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : '') + tokensOf(m.reasoning_content ?? ''), 0) + 1300;
    return true;
  }

  async work(text, { signal, images } = {}) {
    // A hub save applies between tasks; in-flight requests keep their snapshot.
    const instructions = readInstructions();
    this.workingInstructions = instructions.sections;
    const before = this.messages[0].content;
    const after = replaceInstructionBlock(before, instructions.sections);
    if (after !== before) {
      this.setSystem(after);
      this.ctxUsed += tokensOf(after) - tokensOf(before);
      this.emit('note', { text: 'Updated working instructions loaded.', tone: 'dim' });
    }
    // A save of AGENTS.md, TOOLS.md or SKILLS.md (the hub's Prompt files) applies between tasks too.
    if (this.promptFilesChanged()) {
      this.refreshNotes();
      this.emit('note', { text: 'Updated prompt files loaded (AGENTS.md, TOOLS.md, SKILLS.md).', tone: 'dim' });
    }
    this.busy = true;
    const started = Date.now();
    const turnStart = this.messages.length;
    this.messages.push({ role: 'user', content: text, ...(images?.length ? { images } : {}) });
    if (images?.length) this.ctxUsed += images.length * IMAGE_TOKENS;
    if (this.happened) this.happened.message = this.messages.at(-1);
    this.emit('turn-start', { started });
    // The model decides (way.mjs): no word rules pick a path for it, not even for a greeting or
    // "update memory" (it answers, or saves with Remember). Only the loop below runs.
    const decides = this.way === 'model';
    if (!decides && isSmallTalk(text)) { this.happened.small = true; return this.chat(text, started, signal); }
    // "update memory" / "remember that …": saved straight to the memory file, never a question about where.
    if (!decides && isMemoryRequest(text)) { this.happened.small = true; return this.updateMemory(text, started, signal); }
    this.lastRoute = null;
    this.lastHelpers = []; // what the helpers bring to this request (/helpers shows it)
    this.sortShown = this.mode === 'plan' || decides; // a plan is never sorted, nor a request the model decides: no line
    const stopNow = (reason) => {
      this.busy = false;
      this.emit('flow-step', null);
      if (reason === 'interrupted') this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
      this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000 });
      return reason;
    };
    // Started outside a project (the home folder, say): a request that names
    // one goes into it once you say yes (src/agent/projects.mjs).
    const into = await this.offerProject(text, signal);
    if (into?.stop) return stopNow(into.stop);
    // A short line that continues the last turn ("can you add it to my
    // desktop?", "why") is clear with the conversation in view and means
    // little without it: no question first and no focused path, which both
    // read the line alone. It goes on step by step.
    const follow = !decides && isFollowUp(text, this.messages.slice(0, turnStart).some((m) => m.role === 'assistant'));
    if (follow) this.sorted('follow-up');
    // The saved facts that fit the request come along with it. They are
    // written into the request itself, so the conversation read so far stays
    // as it was (a note that came and went would make the model read the
    // last turn again).
    this.claudeCame = false;
    try { await this.remember(text, turnStart, signal); } catch (e) { if (signal?.aborted || e.name === 'AbortError') return stopNow('interrupted'); }
    // An unclear request gets one question first (src/flows/clarify.mjs); the
    // answer joins the conversation and travels with the request. (The model that
    // decides asks with its own Ask tool, when it wants to.)
    if (!decides && !follow && this.flows && this.mode !== 'plan' && !images?.length) {
      try {
        const c = await clarify(this.flowContext(signal), text);
        if (c?.stop) return stopNow(c.stop);
        if (c) {
          this.messages.push({ role: 'assistant', content: c.question });
          this.messages.push({ role: 'user', content: c.answer });
          // The answer is the real request: it goes first, so the paths sort on it.
          text = `${c.answer}\n\n(This answers the question "${c.question}" about the request: ${text})`;
        }
      } catch (e) {
        if (signal?.aborted || e.name === 'AbortError') return stopNow('interrupted');
        this.emit('note', { text: `Could not check the request first (${e.message}); starting anyway.`, tone: 'dim' });
      }
    }
    // A skill from SKILLS.md whose words the request uses (prompt-files.mjs): its steps go with
    // the request, and the work goes step by step with them, not down a focused path. The model
    // that decides gets only the list, and opens a skill itself (Read SKILLS/<name>).
    let skill = null;
    if (!decides && !follow) { try { skill = pickSkill(text); } catch {} }
    // First the focused paths (rename / fix / change); the loop handles the rest.
    // (The model that decides calls them itself: Rename and TestFirst.)
    this.carried = null;
    if (!decides && !follow && this.flows && this.mode !== 'plan' && !images?.length && !skill) {
      // Every focused call's tokens, for the done line (the loop counts its own).
      const counted = { steps: 0, tokens: 0, thinkTokens: 0 };
      const tally = ({ tokens, thought }) => { counted.steps++; counted.tokens += tokens + thought; counted.thinkTokens += thought; this.stats.outTokens += tokens + thought; };
      tallies.add(tally);
      try {
        const r = await runFlows(this.flowContext(signal), text);
        if (r) {
          this.emit('flow-step', null);
          this.messages.push({ role: 'assistant', content: r.summary });
          this.emit('assistant', { text: r.summary, reasoning: '', secs: 0, thinkSecs: 0, tokens: 0, final: true });
          this.busy = false;
          this.happened.flow = { done: r.done, summary: String(r.summary ?? '').slice(0, 300) };
          const reason = signal?.aborted ? 'interrupted' : r.declined ? 'declined' : 'done';
          if (reason === 'interrupted') this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
          tallies.delete(tally);
          this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000, flow: true, done: r.done, steps: counted.steps, reads: 0, thinkTokens: counted.thinkTokens, tokens: counted.tokens });
          return reason;
        }
        tallies.delete(tally);
      } catch (e) {
        tallies.delete(tally);
        this.emit('flow-step', null);
        if (signal?.aborted || e.name === 'AbortError') {
          this.busy = false;
          this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
          this.emit('turn-end', { reason: 'interrupted', secs: (Date.now() - started) / 1000 });
          return 'interrupted';
        }
        this.emit('note', { text: `The focused path failed (${e.message}); working step by step instead.`, tone: 'warn' });
      }
    }
    const kind = follow || decides ? undefined : this.lastRoute?.kind ?? routeByRules(text)?.kind;
    this.sorted(kind, skill ? { skill: skill.name } : undefined); // no focused path ran (or none exists here): step by step
    // A bug brings the steps for its kind (terminal/rules/bug-fixing.md). They
    // go with this turn's requests to the model, not into the conversation.
    const bug = kind === 'fix' ? sortBug(text) : null;
    // The user's own math notes (src/agent/expertise.mjs) come only when asked
    // for with /math, as Claude Code reads nothing beyond the project unasked.
    // Matching them to every request by its words sent ordinary requests
    // there: "pages" and "top" in a notes.html request picked "Pages at the
    // top of MATH" and the model went looking through the folder (2026-09-26).
    let math = null;
    if (this.mathForce) {
      try {
        math = sortMath(text, { min: 1 });
        if (!math) { const index = mathIndex(); math = index?.areas?.length ? { browse: true, index } : null; }
      } catch {}
    }
    this.mathForce = false;
    const request = this.messages.at(-1);
    let reason = 'done';
    let repeatKey = null;
    let repeats = 0;
    let errorsInRow = 0;
    let nudges = 0;
    let checks = 0;
    let cuts = 0; // replies cut off at the reply limit mid-tool-call
    let toolsUsed = 0; // tool calls run for this message: a nudge is only for work already under way
    this.turn = { changed: false, testedAfterChange: false, created: [], asked: [], diffs: '', looked: [], since: Date.now(), planOk: false,
      // The request's words steer which lines of a long file a Read shows first.
      request: typeof request?.content === 'string' ? request.content : '',
      // The request (and a question and answer before it): kept word for word when the conversation is summarized.
      opening: this.messages.slice(turnStart).filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.tool_calls)),
      fixing: kind === 'fix', question: kind === 'question', findings: [], nudged: 0, looksAtNudge: 0, reads: new Map() };
    // Look first (look.mjs): a minimum of looking before the answer, on every task that goes step
    // by step here; not a follow-up (it continues a turn that already looked), not in the home
    // folder (a general question there needs no files), not for a helper (it is part of the looking).
    const lookFloor = !follow && !this.isHelper && !isHomeFolder(this.cwd) ? this.lookSecsNow : 0;
    let lookBacks = 0;
    if (lookFloor && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.look = { request, notes: LOOK_NOTE };
      this.emit('note', { text: `Looking first: at least ${lookFloor} s of searching and reading before it answers (/effort Look first).`, tone: 'dim' });
    }
    if (bug && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.bug = { request, steps: kindText(bug), kind: bug };
      // A check the request names scores the change instead of the whole suite
      // (the bug steps, step 7); for a kind the suite cannot see, with no
      // check named, the suite is not run at all — it would only mislead.
      this.turn.check = checkInText(text);
    }
    if (skill && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.skill = { request, notes: skillNote(skill), name: skill.name };
      this.ctxUsed += tokensOf(this.turn.skill.notes);
      this.emit('note', { text: `Skill: ${skill.name} (SKILLS.md; its words here: ${skill.matched.join(', ')}; ≈${tokensOf(this.turn.skill.notes).toLocaleString('en-US')} tokens).`, tone: 'dim', skill: skill.name });
    }
    // A check the fix path made and what the browser found (flows/pagecheck.mjs).
    if (this.carried && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.carried = { request, notes: this.carried.note };
      this.turn.check = this.carried.check;
      this.carried = null;
    }
    // A web address in the request, with WebFetch on: a line saying it is a page to read, not a
    // file here. Qwen looked for "http://…/notes" in the project with Search, List and Read, and ran
    // curl, twice in seven (the Web check, 30 Sep 2026).
    const urls = webAddresses(text);
    if (urls.length && this.webTools()?.fetch && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.web = { request, notes: `${urls.length === 1 ? 'The request names a web page' : 'The request names web pages'} (${urls.slice(0, 3).join(', ')}): read ${urls.length === 1 ? 'it' : 'them'} with WebFetch. ${urls.length === 1 ? 'It is' : 'They are'} not a file in the project.` };
    }
    if (math && request?.role === 'user' && typeof request.content === 'string') {
      try {
        this.turn.math = { request, notes: mathNotes(math, text) };
        this.emit('note', { text: math.browse ? 'Using the math notes (~/Desktop/MATH).' : `Using the math notes: ${math.area.name} (~/Desktop/MATH).`, tone: 'dim' });
      } catch {}
    }
    // The design examples (src/agent/design.mjs): with a request to make or
    // restyle a page, screen or widget, or any request sent with /design; never
    // with a question, a bug fix or a rename.
    const design = designSettings(this.designSaved);
    const forced = this.designForce;
    this.designForce = false;
    if ((forced || (design.auto && !['question', 'fix', 'rename'].includes(kind) && isDesignRequest(text))) && request?.role === 'user' && typeof request.content === 'string') {
      try {
        // The design studio's pieces (studio.mjs) that fit take the example
        // card's place; the rules card still comes. No piece fits: the cards as before.
        const studio = design.studio ? studioNotes(pickPieces(text)) : null;
        // mix: opus and fable take turns, one page request each.
        const style = !studio && design.style === 'mix' ? mixTurn() : design.style;
        const pick = pickCards(text, { sets: design.sets, style });
        const cards = designNotes(studio ? { ...pick, examples: [], more: [], look: null } : pick);
        const notes = cards || studio ? { text: [cards?.text, studio?.text].filter(Boolean).join('\n\n'), names: [...(cards?.cards ?? []).map((c) => c.file.replace(/\.md$/i, '')), ...(studio?.pieces ?? []).map((p) => `studio/${p.file.replace(/^components\//, '').replace(/\.html?$/i, '')}`)] } : null;
        if (notes) {
          this.turn.design = { request, notes: notes.text, cards: notes.names };
          if (studio) this.turn.studio = { pieces: studio.pieces.map((p) => p.file) };
          this.ctxUsed += tokensOf(notes.text);
          // `design` names the cards for the screen (it folds them into the line under your message).
          this.emit('note', { text: `Design ${studio ? 'studio' : 'examples'}${!studio && design.style === 'mix' ? ` (mix: ${style}'s turn)` : !studio && design.style !== 'auto' ? ` (${style})` : ''}: ${notes.names.join(' + ')} (≈${tokensOf(notes.text).toLocaleString('en-US')} tokens).`, tone: 'dim', design: notes.names });
        } else if (forced) this.emit('note', { text: 'No design examples found (the "design examples" folder is missing or has no cards in the sets that are on).', tone: 'warn' });
      } catch {}
    }
    // A question about code: what it is about is read now, in one go, instead
    // of letting the model find, list and read it a piece at a time.
    // The model that decides looks for itself (Map, CodeSearch, List, Search, Read).
    if (!decides) {
      this.prefetchMap();
      if (kind === 'question' || (!kind && EXPLAIN.test(text))) await this.prefetch(text);
      else if (!follow && kind !== 'rename') await this.prefetchRanked(text, signal);
      // What the other helpers bring (helpers.mjs): the failing tests and the
      // changes, the closest parts of long files by meaning, where names are used.
      try { await this.bringHelpers(text, kind, signal); } catch (e) {
        if (signal?.aborted || e.name === 'AbortError') return stopNow('interrupted');
        this.emit('note', { text: `The helpers could not bring what they found (${e.message}); starting without it.`, tone: 'dim' });
      }
    }
    let verified = false;
    let doneUnchanged = false; // sent back once for saying done with nothing changed
    let lostChecked = false;
    let layoutSent = false;
    let layoutDone = false;
    let correctedAlready = false;
    let blankRetry = false;
    try {
      for (let step = 0; step < this.maxSteps; step++) {
        if (signal?.aborted) { reason = 'interrupted'; break; }
        await this.fitContext(signal);
        const turn = await this.generate(signal);
        // Counted for the done line: each reply is a step; its thinking share
        // of the tokens is estimated from the characters it wrote.
        if (!turn.aborted) {
          this.turn.steps = (this.turn.steps ?? 0) + 1;
          this.turn.tokens = (this.turn.tokens ?? 0) + (turn.tokens ?? 0);
          const all = turn.reasoning.length + turn.text.length + turn.calls.reduce((n, c) => n + (c.args?.length ?? 0), 0);
          this.turn.thinkTokens = (this.turn.thinkTokens ?? 0) + (all ? Math.round((turn.tokens ?? 0) * turn.reasoning.length / all) : 0);
        }
        if (turn.aborted) {
          // Keep what it had written so far on screen (not in the conversation).
          if (turn.reasoning || turn.text) this.emit('assistant', { text: turn.text, reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: false, partial: true });
          reason = 'interrupted';
          break;
        }
        if (turn.looping) {
          this.messages.push({ role: 'assistant', content: turn.text.slice(0, 200) });
          this.messages.push({ role: 'user', content: auto('Your last reply started repeating itself. Try again, briefly.') });
          this.emit('note', { text: 'The model started repeating itself; asked it to try again.', tone: 'warn' });
          continue;
        }
        let calls = turn.calls;
        let text = turn.text;
        if (!calls.length) {
          // A call written as text, or (thinking mode) written inside the thinking.
          const inText = toolCallInText(turn.text) ?? (!turn.text.trim() ? toolCallInText(turn.reasoning) : null);
          if (inText) { calls = [{ id: `call_${Date.now()}`, name: inText.name, args: inText.args }]; text = turn.text.trim() ? inText.before : ''; }
        }
        // Only the first call runs, so only the first is kept in the history
        // (otherwise the model waits for results that never come). When the model
        // decides, every call of the reply runs, in order (at most MAX_CALLS).
        calls = calls.slice(0, decides ? MAX_CALLS : 1);
        // A call cut off by the reply limit (finish 'length'): running it can
        // only give "not valid JSON", and the old error told the model to send
        // the same too-big call again. Instead: build the file in parts.
        const cutCall = turn.finish === 'length' && (calls[0] ?? (/<tool_call>/.test(text) ? { name: /<function=([^>\s]+)>/.exec(text)?.[1] ?? 'the last', args: text } : null));
        if (cutCall) {
          cuts++;
          if (cuts >= 3) {
            reason = 'stuck';
            this.emit('note', { text: 'Three replies in a row were cut off mid-call, so it stopped. Ask for the file in smaller pieces.', tone: 'warn' });
            break;
          }
          const p = /"path"\s*:\s*"([^"]+)"|<parameter=path>\s*\n?([^\n<]+)/.exec(cutCall.args ?? '');
          const thought = turn.reasoning.split('<tool_call>')[0].trim();
          this.messages.push({ role: 'assistant', content: text.split('<tool_call>')[0], ...(thought ? { reasoning_content: thought } : {}) });
          this.messages.push({ role: 'user', content: auto(cutCallNote(cutCall.name, p?.[1] ?? p?.[2]?.trim())) });
          this.emit('note', { text: `The ${cutCall.name} call ran out of room mid-way; asked it to build the file in parts.`, tone: 'warn' });
          continue;
        }
        // A reply that puts a question to you ends the turn, even with a tool
        // call in it: the call is dropped and Agentic Coder waits for your answer.
        if (calls.length && text.trim() && asksTheUserDirectly(text)) calls = [];
        const assistant = { role: 'assistant', content: text };
        const thought = turn.reasoning.split('<tool_call>')[0].trim();
        if (thought) assistant.reasoning_content = thought;
        if (calls.length) assistant.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: safeArgs(c.args) } }));
        this.messages.push(assistant);
        const lines = keyLines(`${thought}\n${text}`);
        for (const l of lines) if (!this.turn.findings.includes(l)) this.turn.findings.push(l);
        this.turn.findings = this.turn.findings.slice(-6);
        this.emit('assistant', { text, reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: !calls.length });
        if (!calls.length) {
          // A reply that asks you something ends the turn: it waits for you.
          if (asksTheUser(text)) break;
          // Small models often announce the next step mid-task ("Now I will
          // update main().") and stop. Tell them to go ahead, at most twice per
          // message, and only once work is under way (a tool already ran).
          if (nudges < 2 && toolsUsed > 0 && this.hook('next-step') && announcesNextStep(text)) {
            nudges++;
            this.messages.push({ role: 'user', content: auto('You said what you will do next but did not do it. If you meant to, do it now with the tools; if you are waiting for the user, stop.') });
            continue;
          }
          // Look first: an answer before the minimum, with nothing changed yet, goes back to look
          // further, with what it has looked at so far (at most LOOK_BACKS times a message).
          const lookedFor = (Date.now() - started) / 1000;
          if (lookFloor && lookedFor < lookFloor && lookBacks < LOOK_BACKS && !this.turn.changed && turn.finish !== 'length') {
            lookBacks++;
            this.emit('note', { text: `Answered after ${Math.round(lookedFor)} s of the ${lookFloor} s minimum (/effort Look first); asked it to look further first.`, tone: 'dim' });
            this.messages.push({ role: 'user', content: auto(lookBackNote(this.lookedSince(turnStart))) });
            continue;
          }
          // It says the work is done, but nothing changed in this message: no
          // Edit, no Write, and no command that could have written instead.
          // Sent back once; if it still claims it with nothing changed, a note
          // under the answer says so.
          const t = this.turn;
          if (!t.changed && !t.question && !t.carried && !t.ranCommand && this.hook('said-done') && asksForWork(t.request) && claimsDone(text)) {
            if (!doneUnchanged) {
              doneUnchanged = true;
              this.emit('note', { text: 'It says the work is done, but no file changed; asked it to look again.', tone: 'warn' });
              this.messages.push({ role: 'user', content: auto('You said the work is done, but no file was changed in this message. If the request needs a change, make it now with the tools. If it was really done before this message, say which file has it and that nothing changed now, in one or two sentences.') });
              continue;
            }
            this.emit('note', { text: 'Nothing was changed for this request: no file was written or edited.', tone: 'warn' });
          }
          // It created a file this turn, then says the work was already there.
          if (this.turn.created.length && this.hook('already') && claimsAlreadyThere(text)) {
            const files = this.turn.created.join(', ');
            if (!correctedAlready) {
              correctedAlready = true;
              this.messages.push({ role: 'user', content: auto(`You created ${files} in this turn; it did not exist before. Answer again in 1-3 sentences: say that you created it, what it does, and how you checked it. Do not say it was already there.`) });
              continue;
            }
            this.emit('note', { text: `Note: ${files} did not exist before; Agentic Coder created it just now.`, tone: 'warn' });
          }
          // A blank answer (seen once after "hello"): ask for one, once.
          if (!text.trim() && turn.finish !== 'length' && !blankRetry && this.hook('empty')) {
            blankRetry = true;
            this.emit('note', { text: 'The model gave an empty answer; asked it to reply.', tone: 'dim' });
            this.messages.push({ role: 'user', content: auto('Reply to the user now, in one to three sentences.') });
            continue;
          }
          // With the hook off, the empty answer stands, and the screen says why it is blank.
          if (!text.trim() && turn.finish !== 'length' && !blankRetry && !this.hook('empty')) this.emit('note', { text: 'The model ended with an empty answer (the Empty reply hook would send it back: /hooks on empty).', tone: 'dim' });
          if (!text.trim() && turn.finish === 'length') {
            // Cut off after a few words: the memory was full, not the thinking too long.
            if (turn.tokens < 200) {
              this.messages.pop();
              await this.compact(signal);
              continue;
            }
            this.messages.push({ role: 'user', content: auto('You ran out of room while thinking. Think less and take the next step.') });
            this.emit('note', { text: 'The model ran out of room while thinking; asked it to act.', tone: 'warn' });
            continue;
          }
          // It says it is done after changing files but never ran the tests:
          // run them (through the normal permission prompt); if they fail, send
          // it back to fix them. At most twice per message.
          const checkCmd = this.turn.check ?? (this.turn.bug?.kind && !this.turn.bug.kind.testsSeeIt ? null : this.testCmd);
          if (checkCmd && this.turn.changed && !this.turn.testedAfterChange && checks < 2 && this.hook('tests')) {
            checks++;
            const call = { id: `check_${Date.now()}`, name: 'Bash', args: JSON.stringify({ command: checkCmd, description: this.turn.check ? 'Run the check the request names' : 'Check the change with the project’s tests' }) };
            assistant.tool_calls = [{ id: call.id, type: 'function', function: { name: 'Bash', arguments: call.args } }];
            this.emit('note', { text: `Checking the change: ${checkCmd}`, tone: 'dim' });
            const out = await this.runTool(call, signal);
            this.messages.push({ role: 'tool', tool_call_id: call.id, content: out.text, ...(out.images?.length ? { images: out.images } : {}) });
            if (out.stop) { reason = out.stop; break; }
            if (out.error) {
              this.messages.push({ role: 'user', content: auto(`${this.turn.check ? 'The named check fails' : 'The tests fail'} (output above). Find what is wrong in your change, fix it with Edit, then run ${this.turn.check ? 'the check' : 'the tests'} again.`) });
              continue;
            }
          }
          // Nothing lost: it changed files and says it is done, but a function
          // the request never names is gone (practice task 14: perimeter()
          // replaced area() instead of going beside it). Once per message.
          if (this.turn.changed && !lostChecked && !signal?.aborted && this.hook('lost')) {
            lostChecked = true;
            const lost = this.lostSinceStart();
            if (lost) {
              this.emit('note', { text: `Removed without being asked: ${lost}.`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`Your changes removed ${lost}, and the request does not ask for that. Put it back with Edit and keep what you added, unless the request really needs it gone; then say why in one sentence.`) });
              continue;
            }
          }
          // A page it made or changed: opened in a browser and measured
          // (flows/layoutcheck.mjs). What is broken goes back once; after the
          // fix it looks again and says what is left.
          if (this.turn.changed && !layoutDone && !signal?.aborted && this.hook('layout')) {
            const found = await this.checkLayout(layoutSent);
            if (found && !layoutSent) {
              layoutSent = true;
              this.messages.push({ role: 'user', content: auto(found) });
              continue;
            }
            layoutDone = true;
          }
          // It changed files and says it is done: does the work cover every
          // part of the request? Once per message; a miss sends it back.
          if (this.turn.changed && this.verify && !verified && !signal?.aborted && this.hook('done')) {
            verified = true;
            const miss = await this.verifyDone(text, signal);
            if (miss) {
              this.emit('note', { text: `Not finished: ${miss}`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`A quick check (it can be wrong) thinks this may be missing: ${miss}. Look once. If it is actually fine, say so in one sentence and stop; otherwise fix it with the tools, run the tests if there are any, then report.`) });
              continue;
            }
          }
          break;
        }
        // One call at a time on App (the prompt asks for it; extra calls were dropped
        // above); when the model decides, each call of the reply in order, each with its
        // own result. A call that ends the turn (you said no, you stopped it) ends the
        // rest too: they get a result that says so, as the conversation needs one each.
        let out = null;
        let stopped = null;
        let landed = false;
        // Several helpers in one reply on the Claude API run side by side (each has its own
        // conversation there); on this Mac one after the other, on the server's side slot.
        const together = calls.length > 1 && calls.every((c) => c.name === 'Agent') && endpointOf(this.url)?.kind === 'claude' ? Promise.all(calls.map((c) => this.runTool(c, signal))) : null;
        for (const [ci, c] of calls.entries()) {
          if (stopped || signal?.aborted) {
            this.messages.push({ role: 'tool', tool_call_id: c.id, content: stopped ? 'Not run: a call before it in the same reply ended the turn.' : 'Interrupted.' });
            continue;
          }
          toolsUsed++;
          out = together ? (await together)[ci] : await this.runTool(c, signal);
          if (c.name === 'Read' && !out.error) this.turn.readsRun = (this.turn.readsRun ?? 0) + (out.readKeys?.length || 1);
          if (!out.error) { cuts = 0; landed = true; } // a step landed: cut-off replies are no longer "in a row"
          const result = { role: 'tool', tool_call_id: c.id, content: out.text, ...(out.images?.length ? { images: out.images } : {}) };
          this.messages.push(result);
          if (out.images?.length) this.ctxUsed += out.images.length * IMAGE_TOKENS;
          for (const r of out.readKeys ?? (out.readKey ? [out] : [])) this.turn.reads.set(r.readKey, { msg: result, mtime: r.mtime });
          if (out.stop) stopped = out.stop;
        }
        if (stopped) { reason = stopped; break; }
        if (signal?.aborted) { reason = 'interrupted'; break; }
        // The check-ins and the "make the change now" note look at the reply's last call.
        const call = calls.at(-1);
        const steer = this.hook('checkin') ? await this.checkIn(call, signal) : null;
        const checkedIn = Boolean(steer?.asked);
        if (steer?.stop) { reason = steer.stop; break; }
        if (steer?.text) this.messages.push({ role: 'user', content: steer.text });
        else {
          const go = this.hook('next-step') ? this.actNow(call, lines) : null;
          if (go) {
            this.messages.push({ role: 'user', content: auto(go) });
            this.emit('note', { text: 'It named the cause; asked it to make the change now.', tone: 'dim' });
          }
        }
        const key = calls.map((c) => `${c.name}:${c.args}`).join('\n');
        repeats = key === repeatKey ? repeats + 1 : 0;
        repeatKey = key;
        errorsInRow = landed ? 0 : errorsInRow + 1;
        if (repeats >= 3 || errorsInRow >= 5) {
          reason = 'stuck';
          this.emit('note', { text: repeats >= 3 ? 'It kept repeating the same step, so it stopped. Try rephrasing the task, or give it a hint.' : 'Five tool errors in a row, so it stopped. Try rephrasing the task, or give it a hint.', tone: 'warn' });
          break;
        }
        // Stuck, sooner: the same step twice, or three errors in a row, and it
        // asks you for a hint instead of going round again. "Keep going"
        // starts the counts over; with no one to answer (coding -p, the
        // practice bench) it carries on and the old limits above still stop it.
        if ((repeats === 1 || errorsInRow === 3) && this.checkIns && !checkedIn && this.hook('stuck')) {
          const s2 = await this.stuckAsk(repeats === 1 ? 'repeat' : 'errors', call, out, signal);
          if (s2?.stop) { reason = s2.stop; break; }
          if (s2?.text) this.messages.push({ role: 'user', content: s2.text });
          if (s2?.text || s2?.keepGoing) { repeats = 0; repeatKey = null; errorsInRow = 0; }
        }
        if (repeats === 2) this.messages.push({ role: 'user', content: auto('You already did exactly this step. Do something different, or finish.') });
        if (step === this.maxSteps - 1) { reason = 'limit'; this.emit('note', { text: `Stopped after ${this.maxSteps} steps (/effort moves this).`, tone: 'warn' }); }
      }
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') reason = 'interrupted';
      else { reason = 'error'; this.emit('note', { text: e.message, tone: 'error' }); }
    } finally {
      this.busy = false;
      this.turn?.scratch?.dispose();
    }
    if (reason === 'interrupted') {
      this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
    }
    const t = this.turn ?? {};
    await this.stillBroken(reason);
    this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000, steps: t.steps ?? 0, reads: (t.readsRun ?? 0) + (t.given ?? 0), readFirst: t.ranked?.files?.length ?? 0, thinkTokens: t.thinkTokens ?? 0, tokens: t.tokens ?? 0, stuckAsks: t.stuckAsks ?? 0 });
    return reason;
  }

  // The line under your request that says which path was picked, once a
  // message: "Sorted as: change · shortcut". Greetings and "update memory"
  // have none; their answer says it.
  sorted(kind, opts) {
    if (this.sortShown) return;
    this.sortShown = true;
    this.emit('sorted', { kind: kind ?? 'other', text: sortLine(kind, opts) });
  }

  // The facts that fit this request, found by meaning (or by words when the
  // small model is not here). They go into the request itself.
  // What came along is shown as one "Context" line (ctrl+o lists it): each
  // item with how close it was and what it costs the model to read.
  async remember(text, at, signal) {
    if (!this.memory || this.memory.recall === false) return;
    const t0 = Date.now();
    const r = await recall(this.cwd, text, { embedder: this.memory.embedder ?? null, home: this.memory.home, signal, retriever: this.search.retriever, reranker: this.reranker });
    if (r.note && !this.memory.told) { this.memory.told = true; this.emit('note', { text: r.note, tone: 'dim' }); }
    const request = this.messages[at];
    let added = 0;
    const goesAlong = (notes) => {
      if (request?.role === 'user' && typeof request.content === 'string') request.content = `${request.content}\n\n(${notes})`;
      this.ctxUsed += tokensOf(notes);
      added += tokensOf(notes);
    };
    const items = [];
    const one = (f) => f.text.replace(/\s+/g, ' ');
    if (r.facts.length) {
      const notes = recallNotes(r.facts);
      goesAlong(notes);
      Object.assign(this.happened, { recalled: r.facts.map((f) => ({ id: f.id, dir: f.dir, text: f.text })), notes });
      this.emit('memory', { facts: r.facts, how: r.how, ms: r.ms });
      for (const f of r.facts) items.push({ from: 'memory', text: one(f), close: f.close, tokens: tokensOf(recallNotes([f])) });
    }
    for (const f of r.skipped ?? []) items.push({ from: 'memory', text: one(f), close: f.close, skipped: 'an event, skipped' });
    const c = await this.rememberClaude(text, goesAlong, signal);
    for (const n of c?.notes ?? []) items.push({ from: 'Claude', text: n.name.replace(/-/g, ' '), close: n.close, tokens: tokensOf(n.part) });
    // Said on the line when /effort's Search rows changed how they were chosen.
    const chosen = [r.chosen, c?.chosen].find((x) => x && (x.order === 'hybrid' || x.reranked));
    if (items.length) this.emit('context', { items, tokens: added, ms: Date.now() - t0, how: r.how, ...(chosen ? { chosen: howChosen(chosen, r.how) } : {}) });
  }

  // Claude's notes (claude-notes.mjs): what Claude Code wrote down about the
  // user's work, read where it is. The one or two notes that fit the request
  // go along with it, as the saved facts do. They are never counted for or
  // against (no trust): Agentic Coder does not change them.
  async rememberClaude(text, goesAlong, signal) {
    const c = this.memory.claude;
    if (!c) return;
    const dir = c === true ? notesDir() : notesDir({ setting: c.dir ?? c });
    if (!dir) return;
    let r;
    try { r = await recallClaude(this.cwd, text, { embedder: this.memory.embedder ?? null, dir, store: c.store, kind: routeByRules(text)?.kind ?? null, signal, retriever: this.search.retriever, reranker: this.reranker }); } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; return; }
    if (!r.notes.length) return;
    goesAlong(claudeText(r.notes));
    if (this.happened) this.happened.claude = r.notes.map((n) => n.id);
    this.claudeCame = true; // for this message: a step that is turned away points back at the note (runTool)
    this.emit('memory', { claude: r.notes.map((n) => ({ id: n.id, name: n.name, type: n.type, close: n.close, chars: n.part.length })), how: r.how, ms: r.ms, of: r.of });
    return r;
  }

  // A message that corrects Agentic Coder ("no, that is wrong", "undo that") counts
  // against the facts the turn before it used, once.
  corrected(text) {
    const last = this.lessons.at(-1);
    if (!last || last.corrected || !CORRECTS.test(String(text).trim())) return;
    last.corrected = String(text).slice(0, 200);
    last.known = false; // a turn that had to be corrected taught something
    this.trust(last.used ?? last.recalled, -2, 'you corrected Agentic Coder');
  }

  // Of the facts that came with the request, the ones the turn really used:
  // what its steps touched and ran, and its answer (recall.mjs).
  usedThisTurn(h) {
    if (!h.recalled?.length) return [];
    // Only this message's answers: an earlier turn's words are not evidence.
    const from = h.message ? this.messages.indexOf(h.message) : -1;
    const answer = from < 0 ? '' : this.messages.slice(from + 1).filter((m) => m.role === 'assistant' && typeof m.content === 'string').map((m) => m.content).join('\n');
    try { return usedFacts(h.recalled, [...h.did, ...h.files, h.check?.cmd ?? '', String(answer).slice(0, 4000)].join('\n')); } catch { return []; }
  }

  trust(recalled, delta, reason) {
    if (!this.memory || !delta || !recalled?.length) return;
    try { for (const dir of new Set(recalled.map((f) => f.dir))) changeTrust(dir, recalled.filter((f) => f.dir === dir).map((f) => f.id), delta, reason); } catch { /* the memory never stops the work */ }
  }

  // The turn is over: what happened is written down. The facts it used gain
  // trust when the work passed its check, and lose it when the work failed,
  // when Agentic Coder got stuck, or when you stopped it.
  settle(reason) {
    const h = this.happened;
    this.happened = null;
    if (!h || h.small) return null;
    const t = this.turn;
    const checked = h.flow ? h.flow.done : t?.changed && t.testedAfterChange ? t.checkOk : undefined;
    const outcome = reason === 'interrupted' ? 'stopped' : ['stuck', 'limit', 'error'].includes(reason) ? 'stuck' : checked === false ? 'failed' : checked === true ? 'passed' : reason === 'declined' ? 'declined' : 'done';
    const lesson = {
      at: h.at, request: h.request.slice(0, 600), kind: this.way === 'model' ? null : this.lastRoute?.kind ?? routeByRules(h.request)?.kind ?? null, reason, outcome,
      files: [...h.files].slice(0, 12), check: h.check ?? null, tries: h.tries.slice(-6), findings: (t?.findings ?? []).slice(-4), asked: (t?.asked ?? []).slice(-3),
      warnings: h.warnings.slice(-4), summary: h.flow?.summary ?? null, recalled: h.recalled,
      used: this.usedThisTurn(h),
    };
    // A turn that went well on what the memory already holds teaches nothing
    // new: no save is started for it (the review at night still reads it).
    if (this.memory) { try { lesson.known = knownAlready(lesson, { cwd: this.cwd, home: this.memory.home }); } catch { /* then it is saved as usual */ } }
    // Work on the tests' own starter files is practice: never saved (lessons.mjs).
    if (practiceWork(lesson, this.cwd)) lesson.practice = true;
    this.lessons.push(lesson);
    this.lessons = this.lessons.slice(-20);
    const delta = { stopped: -2, stuck: -1, failed: -1, passed: +1 }[outcome] ?? 0;
    this.trust(lesson.used, delta, { stopped: 'you stopped Agentic Coder', stuck: 'Agentic Coder got stuck', failed: 'the task failed its check', passed: 'the task passed its check' }[outcome]);
    this.emit('settled', lesson);
    return lesson;
  }

  // In a project with several code files, the loop starts from the project
  // map (each file with its names) as if it had listed the project itself:
  // one read instead of a List → Read → List round at ~60 tokens a second.
  prefetchMap() {
    // No map of the home folder: it lists whatever code it meets first, and the
    // model took that as "your codebase" (src/agent/prompt.mjs, isHomeFolder).
    if (this.mapGiven || isHomeFolder(this.cwd)) return;
    this.mapGiven = true;
    let map;
    try { map = repoMap(this.cwd, { maxChars: 4500 }); } catch { return; }
    if (map.entries.length < MAP_MIN_FILES) return;
    const id = `map_${Date.now()}`;
    this.messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'List', arguments: JSON.stringify({ path: '.', pattern: '**/*' }) } }] });
    this.messages.push({ role: 'tool', tool_call_id: id, content: `Code files in the project (lines: top-level names):\n${map.text}` });
    this.emit('tool', { id, name: 'List', label: 'List', arg: 'the project map', view: { kind: 'list', count: map.entries.length, content: map.text }, given: true });
  }

  // "Explain this code" (flows/explain.mjs). Puts the code a question is
  // about into the conversation as if the model had read it: the files it
  // names (whole when they fit, otherwise their parts and the lines that
  // match the question), then the definitions of the names it uses.
  // One read put into the conversation as if the model had made it.
  giveRead(rel, args, body, view) {
    const id = `read_${Date.now()}_${this.messages.length}`;
    const result = { role: 'tool', tool_call_id: id, content: body };
    this.messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'Read', arguments: JSON.stringify(args) } }] });
    this.messages.push(result);
    // Asked for again, it is pointed back to (runTool), like any part already read.
    const abs = resolvePath(this.cwd, rel).abs;
    let mtime = null;
    try { mtime = statSync(abs).mtimeMs; } catch {}
    this.turn?.reads?.set(`${abs}|${args.offset ?? ''}|${args.limit ?? ''}|`, { msg: result, mtime });
    if (this.turn) this.turn.given = (this.turn.given ?? 0) + 1;
    this.emit('tool', { id, name: 'Read', label: 'Read', arg: rel, view, given: true });
  }

  // A file read in one go: whole when it fits, otherwise as the Read tool
  // gives a long file (its parts, and the lines that match the request).
  async readForPrefetch(f, text, room) {
    const full = readFileSync(f.abs, 'utf8');
    if (full.includes('\u0000')) return null;
    const lines = full.split('\n').length;
    if (lines <= PREFETCH_MAX_LINES && full.length <= room) {
      this.readFiles.add(f.abs);
      return { body: `${f.rel} (${lines} lines):\n${full}`, view: { kind: 'read', lines, total: lines, content: full } };
    }
    const r = await execute('Read', { path: f.rel }, {}, { cwd: this.cwd, request: text, maxResultChars: this.maxResultChars });
    if (r.error) return null;
    return { body: r.text, view: r.view };
  }

  // Any other request in a project (a page, a change done step by step, a
  // fix the focused path handed over): the files it names, then the ones it
  // is most likely about by meaning (rank.mjs), read before the first step
  // instead of found with List/Search/Read one reply at a time.
  async prefetchRanked(text, signal) {
    const on = this.readFirst;
    if (isHomeFolder(this.cwd) || (!on.named && !on.ranked)) return;
    let entries;
    try { entries = repoMap(this.cwd).entries; } catch { return; }
    if (entries.length < MAP_MIN_FILES) return;
    let budget = Math.min(RANK_MAX_TOKENS, Math.round(this.ctx * RANK_SHARE)) * 3.6;
    const want = [];
    if (on.named) for (const f of filesNamed(this.cwd, text, { skip: createdNames(text) })) want.push(f);
    let ranked = { files: [], how: 'none', ms: 0 };
    if (on.ranked) { try { ranked = await rankFiles(this.cwd, text, { embedder: this.ranker ?? this.memory?.embedder ?? null, entries, signal, retriever: this.search.retriever, reranker: this.reranker }); } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; } }
    for (const r of ranked.files) {
      const abs = resolvePath(this.cwd, r.rel).abs;
      if (!want.some((w) => w.abs === abs)) want.push({ rel: r.rel, abs, ranked: true });
    }
    const read = [];
    const byMeaning = [];
    for (const f of want) {
      if (this.readFiles.has(f.abs) || budget <= 400) continue;
      let got;
      try { got = await this.readForPrefetch(f, text, budget); } catch { continue; }
      if (!got || got.body.length > budget) continue;
      budget -= got.body.length;
      this.giveRead(f.rel, { path: f.rel }, got.body, got.view);
      (f.ranked ? byMeaning : read).push(f.rel);
      // For /helpers: which helper brought it, and its size.
      (this.lastHelpers ??= []).push({ from: f.ranked ? 'code' : 'file', text: f.rel, tokens: tokensOf(got.body) });
    }
    if (this.turn) this.turn.ranked = { how: ranked.how, ms: ranked.ms, files: [...read, ...byMeaning] };
    // Which helper read each: Scout the files named, Oracle the closest ones.
    const said = [read.length && `${CODENAMES.named}: ${read.join(', ')}`,
      byMeaning.length && `${CODENAMES.rag}${ranked.how === 'meaning' ? `, ${howChosen(ranked.chosen, 'meaning')}` : ranked.how === 'words' ? `, by the request’s words${ranked.chosen?.reranked ? ', reranked' : ''}` : ''}: ${byMeaning.join(', ')}`].filter(Boolean);
    if (said.length) this.emit('note', { text: `Read first · ${said.join(' · ')}`, tone: 'dim' });
  }

  async prefetch(text) {
    let budget = this.upFrontNow;
    const given = (rel, args, body, view) => {
      budget -= body.length;
      this.giveRead(rel, args, body, view);
    };
    const named = filesNamed(this.cwd, text);
    for (const f of named) {
      if (this.readFiles.has(f.abs) || budget <= 0) continue;
      let got;
      try { got = await this.readForPrefetch(f, text, budget); } catch { continue; }
      if (got) given(f.rel, { path: f.rel }, got.body, got.view);
    }
    // The names the question uses: the part of the file that defines each.
    if (isHomeFolder(this.cwd)) return;
    let parts = [];
    const skip = named.filter((f) => this.readFiles.has(f.abs)).map((f) => f.rel);
    // A question that names its files has said where to look: the rest of a
    // small project is not read on top.
    try { parts = named.length ? [] : wholeSmallProject(this.cwd, { skip }); if (!parts.length) parts = partsFor(this.cwd, text, { skip }); } catch {}
    for (const p of parts) {
      if (budget <= 0) break;
      const whole = p.from === 1 && p.to >= p.total;
      const head = whole ? `${p.rel} (${p.total} lines):` : `${p.rel} (lines ${p.from}-${p.to} of ${p.total}; pass offset to read more):`;
      given(p.rel, whole ? { path: p.rel } : { path: p.rel, offset: p.from, limit: p.to - p.from + 1 }, `${head}\n${p.text}`, { kind: 'read', lines: p.to - p.from + 1, total: p.total, content: p.text });
      this.readFiles.add(resolvePath(this.cwd, p.rel).abs);
    }
  }

  // What the context helpers bring before the first step, after Read first
  // (prefetchRanked: the named files and the closest files, whole): the
  // failing tests and the changes not yet committed, the closest functions
  // of the files not read whole, and where the names the request uses are
  // defined and used. Each goes in as a step the model took itself (a Bash,
  // a Read, a Search), within CEILING tokens, and one "Helpers" line lists
  // what came (ctrl+o: each with its fit and size).
  async bringHelpers(text, kind, signal) {
    const on = this.helpers;
    if (!on?.size) return;
    const t0 = Date.now();
    const home = isHomeFolder(this.cwd);
    const items = [];
    const skipped = [];
    let codeChosen = null; // how the code search chose, when not by meaning alone
    // The tests, on a fix-type request: the run a focused path made for this
    // message, or one now (in a throwaway copy, 60 s at most).
    if (on.has('tests') && !home && this.testCmd && fixLike(kind, text)) {
      const run = this.happened?.testRun?.cmd === this.testCmd ? this.happened.testRun : await this.runTestsFirst(signal);
      if (run) {
        const say = (maxChars) => `(Agentic Coder ran the tests before your first step; nothing has changed since.)\n${testReport(this.testCmd, run.out, run.code, { timedOut: run.timedOut, secs: run.secs, maxChars })}`;
        const res = readResults(run.out, run.code);
        const what = run.timedOut ? 'stopped after 60 s' : res.ok ? `all ${res.total ?? ''} pass`.replace('  ', ' ') : `${res.failed ?? 'some'} of ${res.total ?? '?'} fail`;
        const bash = (body) => ({ helper: 'tests', from: 'tests', text: `${this.testCmd} · ${what}`, name: 'Bash', args: { command: this.testCmd, description: 'Run the tests' }, body, chars: body.length, view: { kind: 'bash', code: run.code, lines: body.split('\n'), ms: Math.round((run.secs ?? 0) * 1000) } });
        items.push({ ...bash(say(chars(SHARES.tests))), small: bash(say(chars(SHARES.tests) / 3)) });
      }
    }
    if (on.has('tests') && !home && (fixLike(kind, text) || talksAboutChanges(text))) {
      const ch = gitChanges(this.cwd);
      if (ch?.text) {
        const body = `(The changes not yet committed, as git shows them.)\n${ch.text}`;
        items.push({ helper: 'tests', from: 'changes', text: `git diff · ${ch.files.length + ch.more} changed file${ch.files.length + ch.more === 1 ? '' : 's'}${ch.fresh ? `, ${ch.fresh} new` : ''}`, name: 'Bash', args: { command: 'git diff HEAD', description: 'See what changed since the last commit' }, body, chars: body.length, view: { kind: 'bash', code: 0, lines: body.split('\n'), ms: 0 } });
      }
    }
    // The closest functions by meaning (the code search): from the files
    // Read first did not give whole, so a long file's outline is followed by
    // the parts that matter, and a file its ranking missed can still come.
    if (on.has('rag') && !home) {
      let found = null;
      try { found = await this.findCode(text, signal); } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; }
      if (found?.parts?.length && found.parts[0].close >= CUT) {
        const best = found.parts[0].close;
        // How many parts come along is the meaning's rule; which ones, /effort's
        // Retriever and Reranker rows (search.mjs). On Meaning with no reranker
        // these are the closest parts, as always.
        const index = found.index;
        const n = found.parts.filter((x) => x.close >= Math.max(CUT, best - MARGIN)).slice(0, 8).length;
        const hybrid = this.search?.retriever === 'hybrid';
        const chosen = await choose({ query: text, byMeaning: found.parts, byWords: hybrid ? index.wordSearch(text) : null, n, key: partKey, text: (p) => index.textOf(p, this.reranker?.model?.chars), retriever: this.search?.retriever, reranker: this.reranker, signal });
        if (chosen.note && !this.rerankTold) { this.rerankTold = true; this.emit('note', { text: chosen.note, tone: 'dim' }); } // once a session
        if (chosen.order === 'hybrid' || chosen.reranked) codeChosen = howChosen(chosen);
        const byFile = new Map();
        for (const p of chosen.picked.map((x) => ({ ...x, close: x.close ?? found.closeOf?.get(partKey(x)) ?? 0 }))) {
          const abs = resolvePath(this.cwd, p.rel).abs;
          if (this.readFiles.has(abs) || !sameAsIndexed(this.cwd, p)) continue;
          if (!byFile.has(p.rel)) byFile.set(p.rel, []);
          byFile.get(p.rel).push(p);
        }
        for (const [rel, parts] of [...byFile].slice(0, 3)) {
          const abs = resolvePath(this.cwd, rel).abs;
          let all;
          try { all = readFileSync(abs, 'utf8').replace(/\n$/, '').split('\n'); } catch { continue; }
          // Parts next to each other are given as one piece.
          const ranges = [];
          for (const p of [...parts].sort((a, b) => a.line - b.line)) {
            const last = ranges.at(-1);
            if (last && p.line <= last.end + 3) { last.end = Math.max(last.end, p.end); last.names.push(p.name); last.close = Math.max(last.close, p.close); } else ranges.push({ line: p.line, end: p.end, names: [p.name], close: p.close });
          }
          for (const r of ranges) {
            const end = Math.min(r.end, all.length);
            const piece = all.slice(r.line - 1, end).join('\n');
            const body = `${rel} (lines ${r.line}-${end} of ${all.length}; pass offset to read more):\n${piece}`;
            items.push({ helper: 'rag', from: 'code', text: `${rel} · ${r.names.join(', ')}`, close: r.close, name: 'Read', args: { path: rel, offset: r.line, limit: end - r.line + 1 }, abs, body, chars: body.length, view: { kind: 'read', lines: end - r.line + 1, total: all.length, content: piece } });
          }
        }
      } else if (found?.waiting && !found.off && found.total) {
        skipped.push({ from: 'code', text: 'code search', skipped: `still indexing: ${found.done} of ${found.total} parts` });
      }
    }
    // Where the names the request uses are defined and used.
    if (on.has('lsp') && !home) {
      let map = null;
      try { map = repoMap(this.cwd); } catch {}
      const w = map?.entries?.length ? whoUses(this.cwd, text, map.entries) : null;
      if (w) items.push({ helper: 'lsp', from: 'uses', text: w.names.join(', '), name: 'Search', args: { pattern: w.names.join('|') }, body: w.text, chars: w.text.length, view: { kind: 'search', count: w.names.length, content: w.text } });
    }
    if (!items.length && !skipped.length) return;
    const take = shareOut(items);
    for (const it of items) if (!take.includes(it) && !take.includes(it.small)) skipped.push({ from: it.from, text: it.text, skipped: `over the ${CEILING.toLocaleString('en-US')}-token limit` });
    for (const it of take) this.pretend(it);
    const tokens = take.reduce((s, it) => s + tokensOf(it.body), 0);
    this.lastHelpers = [...(this.lastHelpers ?? []), ...take.map((it) => ({ from: it.from, text: it.text, tokens: tokensOf(it.body) }))];
    if (this.happened) this.happened.helpers = this.lastHelpers;
    this.emit('context', { title: 'Helpers', items: [...take.map((it) => ({ from: it.from, text: it.text, close: it.close ?? null, tokens: tokensOf(it.body) })), ...skipped], tokens, ms: Date.now() - t0, how: 'meaning', ...(codeChosen ? { chosen: `${CODENAMES.rag} ${codeChosen}` } : {}) });
  }

  // A step the model did not have to take: the call and its result go into
  // the conversation as if it had made them (as the project map does), and
  // onto the screen like any step. A Read counts as read: asked for again,
  // it is pointed back to, and the file may be edited.
  pretend({ name, args, body, view, abs }) {
    if (name === 'Read' && abs) {
      this.giveRead(args.path, args, body, view);
      this.readFiles.add(abs);
      this.ctxUsed += tokensOf(body) + 30;
      return;
    }
    const id = `${name.toLowerCase()}_${Date.now()}_${this.messages.length}`;
    const result = { role: 'tool', tool_call_id: id, content: body };
    this.messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    this.messages.push(result);
    this.ctxUsed += tokensOf(body) + 30;
    this.emit('tool', { id, name, ...display(name, args), view, given: true });
  }

  // The tests before the first step, in a throwaway copy of the project
  // (a test may write files), stopped after a minute.
  async runTestsFirst(signal) {
    this.emit('note', { text: `Running ${this.testCmd} first, to see what fails (a minute at most).`, tone: 'dim' });
    const scratch = new Scratch(this.cwd);
    try {
      const r = await scratch.run(this.testCmd, { signal, timeoutMs: TESTS_FIRST_MS });
      return { cmd: this.testCmd, out: r.out ?? '', code: r.code, timedOut: r.timedOut, secs: (r.ms ?? 0) / 1000 };
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') throw e;
      return null;
    } finally { scratch.dispose(); }
  }

  // A greeting or thanks: one short reply, no tools, no focused paths.
  async chat(said, started, signal) {
    let reason = 'done';
    try {
      await this.fitContext(signal);
      // Room to think first (at your effort level), then a short answer, then stop.
      const turn = await this.generate(signal, { textOnly: true, maxTokens: 900 });
      if (turn.aborted) {
        reason = 'interrupted';
        // Keep what it had written so far on screen, as the loop does.
        if (turn.reasoning || turn.text) this.emit('assistant', { text: turn.text, reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: false, partial: true });
      } else {
        // It should not call a tool here; if it writes one out anyway, or
        // nothing at all, keep a plain greeting instead.
        // (With tools off it once wrote "Hello!…" and then a Read call as text.)
        let text = turn.text.split('<tool_call>')[0].trim();
        if (turn.calls.length || toolCallInText(text) || !text) text = /\b(thanks|thank you|thx|ty)\b/i.test(said) ? 'You’re welcome.' : 'Hello! What would you like to work on?';
        this.messages.push({ role: 'assistant', content: text });
        this.emit('assistant', { text, reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: true });
      }
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') reason = 'interrupted';
      else { reason = 'error'; this.emit('note', { text: e.message, tone: 'error' }); }
    } finally {
      this.busy = false;
    }
    if (reason === 'interrupted') this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
    this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000 });
    return reason;
  }

  // "update memory" with the memory on: the same save that runs on its own
  // (lessons.mjs), now, with what you said to remember.
  async updateFacts(request, started, signal) {
    let reason = 'done';
    try {
      this.emit('flow-step', { index: 0, count: 1, text: 'Updating memory' });
      const out = await saveLessons({ url: this.url, model: this.model, slot: this.slots?.side, cwd: this.cwd, home: this.memory.home, lessons: this.lessons, messages: this.messages.slice(0, -1), signal, embedder: this.memory.embedder, why: 'update memory', request });
      const lines = [...out.added.map((f) => `- ${f.text}`), ...out.replaced.map((x) => `- ${x.fact.text} (in place of: ${x.old.text})`)];
      const text = lines.length || out.retired.length
        ? `Saved to memory:\n${lines.join('\n')}${out.retired.length ? `${lines.length ? '\n\n' : ''}Taken out of use:\n${out.retired.map((f) => `- ${f.text}`).join('\n')}` : ''}`
        : `Nothing new to remember from this conversation.${out.refused.length ? ` (${out.refused.map((x) => x.why).join('; ')})` : ''}`;
      this.emit('flow-step', null);
      this.messages.push({ role: 'assistant', content: text });
      this.emit('assistant', { text, reasoning: '', secs: out.secs, thinkSecs: 0, tokens: out.tokens, final: true });
      this.emit('note', { text: '/memory shows what is saved · /memory undo takes the last save back', tone: 'dim' });
    } catch (e) {
      this.emit('flow-step', null);
      if (signal?.aborted || e.name === 'AbortError') reason = 'interrupted';
      else { reason = 'error'; this.emit('note', { text: `Could not update the memory (${e.message}).`, tone: 'error' }); }
    } finally {
      this.busy = false;
    }
    if (reason === 'interrupted') this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
    this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000 });
    return reason;
  }

  // "update memory": the facts worth keeping from this conversation, saved
  // at once (updateFacts). With the memory off ("memory": false) nothing is
  // saved; before 30 Sep 2026 it went to a notes file of its own instead.
  async updateMemory(request, started, signal) {
    if (this.memory) return this.updateFacts(request, started, signal);
    const text = 'The memory is off here ("memory": false in settings.json), so nothing was saved. Take that line out to have Agentic Coder remember.';
    this.messages.push({ role: 'assistant', content: text });
    this.emit('assistant', { text, reasoning: '', secs: 0, thinkSecs: 0, tokens: 0, final: true });
    this.busy = false;
    this.emit('turn-end', { reason: 'done', secs: (Date.now() - started) / 1000 });
    return 'done';
  }

  // One model reply, streamed.
  async generate(signal, { retry = true, textOnly = false, maxTokens: cap } = {}) {
    const sampling = this.thinking ? this.model.thinkingSampling : this.model.sampling;
    const maxTokens = cap ?? replyRoom(this.thinking, this.model?.thinkingBudget); // fitContext keeps this much free
    // High effort is for working the problem out. Once this turn has changed a
    // file, the steps left (run the tests, report) think briefly instead.
    const effort = this.effort === 'high' && this.turn?.changed ? 'medium' : this.effort;
    const t0 = Date.now();
    let firstToken = null;
    let thinkEnd = null;
    const turn = { reasoning: '', text: '', calls: [], finish: null, tokens: 0 };
    const local = new AbortController();
    const onAbort = () => local.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    // Stopped already (during the warm-up, say): the listener above never fires then, so the
    // request would go out and run to its end. It is not sent.
    if (signal?.aborted) local.abort();
    this.emit('waiting');
    this.answering = (this.answering ?? 0) + 1;
    try {
      // Text only: the model may still start writing a call out as text, so the server stops there.
      const stream = streamChat({ url: this.url, messages: this.withTurnNotes(this.messages), tools: this.tools(), toolChoice: textOnly ? 'none' : 'auto', extra: textOnly ? { stop: ['<tool_call>'] } : undefined, thinking: this.thinking, effort, model: this.model, sampling, maxTokens, thinkCap: this.steppedDown() ? STEP_DOWN_CAP : undefined, slot: this.slots?.main, signal: local.signal, parallel: this.way === 'model' && !textOnly });
      for await (const ev of stream) {
        if (ev.type !== 'done' && firstToken === null) firstToken = Date.now();
        if (ev.type === 'reasoning') {
          turn.reasoning += ev.text;
          this.emit('reasoning', { text: ev.text, all: turn.reasoning });
          if (isLooping(turn.reasoning)) { turn.looping = true; local.abort(); break; }
        } else if (ev.type === 'text') {
          if (thinkEnd === null && turn.reasoning) thinkEnd = Date.now();
          turn.text += ev.text;
          this.emit('text', { text: ev.text, all: turn.text });
          if (isLooping(turn.text)) { turn.looping = true; local.abort(); break; }
        } else if (ev.type === 'tool') {
          if (thinkEnd === null && turn.reasoning) thinkEnd = Date.now();
          const c = (turn.calls[ev.index] ??= { id: ev.id, name: '', args: '' });
          if (ev.id) c.id = ev.id;
          if (ev.name) c.name += ev.name;
          c.args += ev.args;
          this.emit('tool-writing', { name: c.name, args: c.args, tokens: tokensOf(c.args) });
          if (isLooping(c.args)) { turn.looping = true; local.abort(); break; }
        } else if (ev.type === 'server') {
          // A web search or page done on the server's side (the Claude API): shown as a finished step.
          this.emit('tool', { id: ev.id, name: ev.name, ...display(ev.name, ev.args), view: ev.view, error: ev.error });
        } else if (ev.type === 'done') {
          turn.finish = ev.finish;
          if (ev.usage) this.ctxUsed = (ev.usage.prompt_tokens ?? 0) + (ev.usage.completion_tokens ?? 0);
          if (ev.timings) {
            this.stats.tps = ev.timings.predicted_per_second ?? this.stats.tps;
            if ((ev.timings.prompt_n ?? 0) > 50) this.stats.pps = ev.timings.prompt_per_second;
            turn.tokens = ev.timings.predicted_n ?? 0;
          }
        }
      }
    } catch (e) {
      if (turn.looping) { /* aborted on purpose */ }
      else if (signal?.aborted) {
        turn.secs = (Date.now() - t0) / 1000;
        turn.thinkSecs = turn.reasoning ? ((thinkEnd ?? Date.now()) - (firstToken ?? t0)) / 1000 : 0;
        return { ...turn, aborted: true };
      }
      else if (retry && /fetch failed|ECONNREFUSED|socket|terminated/i.test(`${e.message} ${e.cause?.message ?? ''}`) && this.waitForServer) {
        this.emit('note', { text: this.model?.remote ? 'The remote model stopped answering; connecting again…' : 'The model server stopped; restarting it and trying again…', tone: 'warn' });
        await this.waitForServer();
        return this.generate(signal, { retry: false, textOnly, maxTokens: cap });
      } else if (retry && /context|exceed/i.test(e.message)) {
        this.emit('note', { text: 'The conversation outgrew the model’s memory; summarizing it and trying again…', tone: 'warn' });
        await this.compact(signal);
        return this.generate(signal, { retry: false, textOnly, maxTokens: cap });
      } else throw e;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.answering--;
    }
    turn.calls = turn.calls.filter(Boolean).filter((c) => c.name);
    turn.tokens ||= tokensOf(turn.reasoning + turn.text + turn.calls.map((c) => c.args).join(''));
    this.stats.outTokens += turn.tokens;
    this.stats.requests++;
    turn.secs = (Date.now() - t0) / 1000;
    turn.thinkSecs = turn.reasoning ? ((thinkEnd ?? Date.now()) - (firstToken ?? t0)) / 1000 : 0;
    this.emit('stats', { ...this.stats, ctxUsed: this.ctxUsed, ctx: this.ctx });
    return turn;
  }

  // A Write with its content but no path: the content is kept, the call in the
  // conversation shrinks to one line, and the next Write that sends only a path
  // writes the kept content. On 28 Sep Gemma wrote a whole notes page this way
  // twice (2,157 and 3,085 tokens); each time it was told only 'Write needs
  // "path".', and the first draft filled its memory and was lost at the restart.
  keepWrite(call, parsed) {
    const sent = sentArgs('Write', call.args) ?? {};
    const content = typeof sent.content === 'string' && sent.content.length ? sent.content : null;
    const path = sent.path !== undefined && sent.path !== null && String(sent.path).trim() ? String(sent.path) : null;
    if (content && !path) {
      this.keptWrite = { content };
      const lines = content.split('\n').length;
      this.shrinkCall(call.id, JSON.stringify({ content: `[${lines} lines, kept by Agentic Coder]` }));
      const named = this.fileNamed();
      return {
        error: `${needsText('Write', 'path')} Your content (${lines} lines) is kept, so do not write it again: send Write with only "path"${named ? ` (the request names "${named}")` : ''}, and the kept content is written there.`,
        shown: `Write needs "path"; its ${lines} lines are kept until it names the file`,
      };
    }
    if (path && !content && this.keptWrite) return { args: { path, content: this.keptWrite.content }, fromKept: true };
    return parsed;
  }

  // Replace a call's arguments in the conversation (the model reads the shorter
  // version from then on) and take the saved tokens off the count.
  shrinkCall(id, args) {
    for (let i = this.messages.length - 1; i > 0; i--) {
      const c = this.messages[i].tool_calls?.find((t) => t.id === id);
      if (!c) continue;
      this.ctxUsed = Math.max(0, this.ctxUsed - Math.max(0, tokensOf(c.function.arguments) - tokensOf(args)));
      c.function.arguments = args;
      return;
    }
  }

  // The first file name the request itself names ("notes.html"), if any.
  fileNamed() {
    return /(?:^|[\s"'`(])([\w.-]+\.(?:html?|md|txt|csv|json|jsx?|mjs|cjs|tsx?|css|py|sh|rb|go|rs|java|swift|ya?ml|toml|xml|svg))\b/i.exec(this.turn?.request ?? '')?.[1] ?? null;
  }

  async runTool(call, signal) {
    let parsed = parseArgs(call.name, call.args, this.way);
    if (call.name === 'Write') parsed = this.keepWrite(call, parsed);
    const shown = display(call.name, parsed.args ?? {});
    const id = call.id;
    if (parsed.error) {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: parsed.shown ?? parsed.error }, error: true });
      return { text: parsed.error, error: true };
    }
    const args = parsed.args;
    // A helper refuses a tool it was not given (an explore helper does not change anything).
    if (this.toolFilter && !this.toolFilter.has(call.name)) {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: 'this helper only reads' }, error: true });
      return { text: `${call.name} is not one of this helper's tools: it only reads. Report what should change instead.`, error: true };
    }
    if (call.name === 'Agent') return this.runHelper(id, args, shown, signal);
    if (call.name === 'Ask') return this.askUser(id, args, shown, signal);
    // Read of a web address, with WebFetch on: read as the page it is (asked about as WebFetch is).
    if (call.name === 'Read' && typeof args.path === 'string' && /^https?:\/\//i.test(args.path.trim()) && this.webTools()?.fetch) return this.runTool({ id, name: 'WebFetch', args: JSON.stringify({ url: args.path.trim(), ...(args.find ? { find: args.find } : {}), ...(args.offset ? { offset: args.offset } : {}) }) }, signal);
    // The model's own tools when it decides (Map, CodeSearch, Rename, TestFirst, Remember),
    // and a Read of several files, one Read each, in one result.
    if (MODEL_TOOLS.has(call.name)) return this.runModelTool(call.name, args, shown, id, signal);
    if (call.name === 'Read' && Array.isArray(args.paths) && !args.path) return this.readMany(id, args.paths, signal);
    // A question changes nothing. (A practice question once tested an idea by
    // writing a scratch file inside the project, 2026-09-26.) Edit and Write
    // are turned away; a command that is not plain reading runs in a
    // throwaway copy of the project (below).
    if (this.turn?.question && (call.name === 'Edit' || call.name === 'Write')) {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: 'A question changes no files' }, error: true });
      return { text: 'This is a question, so no file is changed. Answer it from what you have read. If a change is needed, say which one, and the user can ask for it.', error: true };
    }
    // A picture, or a scanned PDF, the model reads by itself while it is not looking at pictures:
    // its vision is turned on first where it can be (visionOn: the window's reload, or coding -p's),
    // as when you attach one. Without it, Read says to ask you to attach it.
    if (call.name === 'Read' && !this.canSee && this.visionOn && needsSight(this.cwd, args)) { try { await this.visionOn(); } catch { /* Read says why it cannot see */ } }
    // checks: the lsp helper also checks JSX, TypeScript and a page's scripts before an edit lands.
    const env = { cwd: this.cwd, signal, maxResultChars: this.maxResultChars, bash: this.bash, canSee: Boolean(this.canSee), web: { search: this.web?.search, key: () => searchKey(this.web?.search) }, request: this.turn?.request ?? '', searches: this.turn?.searches ?? [], checks: this.helpers.has('lsp'), setTodos: (t) => { this.todos = t; this.emit('todos', t); } };
    let prepared;
    try { prepared = prepare(call.name, args, env); } catch (e) { prepared = { error: `${call.name} failed: ${e.code ?? e.message}` }; }
    if (prepared.error) {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: prepared.error }, error: true });
      return { text: prepared.error, error: true };
    }
    // Like Claude Code: an existing file must be read before it is edited, so
    // old_text is copied from what is really there.
    if (call.name === 'Edit' && prepared.abs && !this.readFiles.has(prepared.abs)) {
      const msg = `Read ${prepared.rel} first, then copy old_text from it exactly.`;
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: msg }, error: true });
      return { text: msg, error: true };
    }
    const at = args.path ? resolvePath(this.cwd, args.path) : null;
    const inside = at ? at.inside : true;
    const rules = this.savedRules();
    const d = decide(call.name, args, { mode: this.mode, allowedPrefixes: this.allowedPrefixes, inside, cwd: this.cwd, rules, rel: at?.realRel ? [at.rel, at.realRel] : at?.rel });
    if (d.decision === 'deny') {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: d.reason }, error: true });
      return { text: `Not allowed: ${d.reason}. ${this.claudeCame ? "If the note that came with the request answers it, answer from the note now; do not look for the files it names." : 'Do something else.'}`, error: true };
    }
    // Edits on auto-accept: the first one of a message is shown as a plan first.
    if (d.decision !== 'ask' && (call.name === 'Edit' || call.name === 'Write') && this.turn && !this.turn.planOk && this.confirmPlan && this.hook('plan')) {
      const plan = planLine(call.name, args, prepared);
      const r = await this.confirm(plan, signal);
      if (r.stop) return { text: 'Interrupted.', stop: r.stop };
      if (!r.ok) {
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'declined', feedback: r.feedback }, error: true });
        return { text: r.feedback ? `Not done: before this change the user wrote: ${r.feedback}\nDo that instead.` : 'The user said no to this change. Wait for their next message.', error: true, stop: r.feedback ? null : 'declined' };
      }
    }
    if (d.decision === 'ask') {
      this.emit('tool-ask', { id, name: call.name, ...shown });
      const answer = await this.ask({ id, name: call.name, args, prepared, ...shown, ...(d.once ? { once: true } : {}), ...(d.protectedBy ? { protectedBy: d.protectedBy } : {}), ...(d.rule ? { rule: d.rule } : {}), ...(call.name === 'WebSearch' ? { service: PROVIDER_NAMES[this.web?.search] } : {}) });
      if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      if (answer.choice === 'no') {
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'declined', feedback: answer.feedback }, error: true });
        return { text: `The user said no to this${answer.feedback ? ` and wrote: ${answer.feedback}` : '. Wait for their next message.'}`, error: true, stop: answer.feedback ? null : 'declined' };
      }
      if (answer.choice === 'always') {
        // A commit asks every time (d.once): a "yes" to it is never remembered.
        // What is remembered is the rule for the first part of the command nothing covers yet.
        if (call.name === 'Bash') { const o = d.once ? null : offerFor(args.command, { saved: rules?.allow, session: this.allowedPrefixes, protect: rules?.protect }); if (o) this.allowedPrefixes.add(o.rule); }
        // The web: that site (or searches) without asking, for the rest of this session.
        else if (d.rule) this.allowedPrefixes.add(d.rule);
        else if (!d.once) this.setMode('edits');
      }
      // You saw this change and said yes: that was the plan question.
      if ((call.name === 'Edit' || call.name === 'Write') && this.turn) this.turn.planOk = true;
    }
    // The same part of a file read again while the first read is still in the
    // conversation and the file has not changed: it points back instead of
    // adding the same text twice.
    let readKey = null;
    let mtime = null;
    if (call.name === 'Read' && this.turn?.reads) {
      const abs = resolvePath(this.cwd, args.path).abs;
      readKey = `${abs}|${args.offset ?? ''}|${args.limit ?? ''}|${args.find ?? ''}`;
      try { mtime = statSync(abs).mtimeMs; } catch {}
      const seen = this.turn.reads.get(readKey);
      // Asked a second time, it is pointed back; asked a third time, it gets
      // the text again: at Low the model once asked four times in 20 seconds,
      // was pointed back each time, and stopped as stuck.
      if (seen && seen.mtime === mtime && this.messages.includes(seen.msg) && !String(seen.msg.content).startsWith('[older output removed') && !seen.pointed) {
        seen.pointed = true;
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'same' } });
        return { text: `You already read this part of ${shown.arg ?? args.path} and it has not changed since; it is above. Use it, or read a different part${args.find ? '' : ' (pass find with a word or name to see the lines around it)'}.` };
      }
    }
    const t0 = Date.now();
    this.emit('tool-running', { id, name: call.name, ...shown });
    let out;
    const aside = call.name === 'Bash' && this.turn?.question && !isReadOnly(args.command);
    // /rewind: the text before the model's edit, and a copy around its commands.
    if ((call.name === 'Edit' || call.name === 'Write') && prepared.abs) this.rewind?.edited(prepared.abs, prepared.created ? null : prepared.before);
    try {
      out = aside ? await this.runAside(args.command, signal)
        : call.name === 'Bash' && this.rewind ? await this.rewind.around(() => execute(call.name, args, prepared, env))
        : await execute(call.name, args, prepared, env);
    } catch (e) { out = { text: `${call.name} failed: ${e.code ?? e.message}`, error: true, view: { kind: 'error', message: e.code ?? e.message } }; }
    // A command the fence stopped, in a message a note of Claude's came with: back to the note.
    if (this.claudeCame && out.error && /outside the project folder/.test(String(out.text))) out.text += ' If the note that came with the request answers it, answer from the note now.';
    if (readKey && !out.error) Object.assign(out, { readKey, mtime });
    // What this step did, for which facts the turn really used (usedFacts).
    if (this.happened && this.happened.did.length < 60) this.happened.did.push(`${call.name} ${args.path ?? args.command ?? args.pattern ?? ''}`.slice(0, 300));
    if (!out.error && call.name === 'Read') this.readFiles.add(resolvePath(this.cwd, args.path).abs);
    // This message's searches, newest first: a Read of a long file shows what they found in it.
    if (this.turn && !out.error && call.name === 'Search' && args.pattern) this.turn.searches = [args.pattern, ...(this.turn.searches ?? []).filter((p) => p !== args.pattern)].slice(0, 3);
    if (!out.error && (call.name === 'Edit' || call.name === 'Write') && prepared.abs) this.readFiles.add(prepared.abs);
    if (this.turn && !out.error && (call.name === 'Edit' || call.name === 'Write')) {
      this.turn.changed = true;
      this.turn.testedAfterChange = false;
      this.turn.edits = (this.turn.edits ?? 0) + 1;
      this.happened?.files.add(prepared.rel);
      // Each file as it was before this message's first change to it, for the
      // nothing-lost check at the end (lostSinceStart). A new file has none.
      this.turn.startTexts ??= new Map();
      if (!this.turn.startTexts.has(prepared.rel)) this.turn.startTexts.set(prepared.rel, prepared.created ? null : prepared.before);
      // What changed this turn, for the check at the end (verifyDone).
      const hunk = (out.view?.hunk ?? []).filter((l) => l.type !== ' ').map((l) => `${l.type}${l.text}`).join('\n');
      // Up to 6,000 characters a file, 16,000 in all; anything longer is
      // marked as cut here, so the check never takes the cut for the file's end
      // (a 1,500-character cut once made a finished story look "cut off at 'sti'").
      const piece = hunk.length > 6000 ? `${hunk.slice(0, 6000)}\n${CUT_MARK}` : hunk;
      if (this.turn.diffs.length < 16000) this.turn.diffs += `${prepared.rel}:\n${piece}\n`;
    }
    if (this.turn && !out.error && call.name === 'Write' && prepared.created && !this.turn.created.includes(prepared.rel)) this.turn.created.push(prepared.rel);
    // The design studio's build (studio.mjs): a page written from the studio's
    // pieces, or one built before, gets the CSS for its Tailwind classes built
    // into it, so it opens with a double-click and no internet.
    if (!out.error && (call.name === 'Edit' || call.name === 'Write') && prepared.abs && /\.html?$/i.test(prepared.abs)) {
      const note = await this.buildStudio(prepared);
      if (note) out.text += `\n${note}`;
    }
    // The lsp helper: a new file that does not parse is said in the same
    // reply, not found a few steps later by a test run or the browser.
    if (!out.error && call.name === 'Write' && prepared.abs && this.helpers.has('lsp')) {
      const broken = syntaxError(prepared.abs, prepared.after, { more: true });
      if (broken) {
        out.text += ` But it does not parse yet: ${broken}. Fix that with Edit before going on.`;
        this.emit('note', { text: `${prepared.rel} does not parse yet: ${broken}`, tone: 'warn' });
      }
    }
    // A Write that landed has used (or replaced) the kept content.
    if (!out.error && call.name === 'Write' && this.keptWrite) {
      if (parsed.fromKept) this.emit('note', { text: `Wrote the kept content to ${prepared.rel}; it was not written again.`, tone: 'dim' });
      this.keptWrite = null;
    }
    // A command may have written files the Edit and Write counts never see.
    if (this.turn && call.name === 'Bash') this.turn.ranCommand = true;
    if (this.turn && call.name === 'Bash' && this.turn.changed && (this.testCmd && args.command.includes(this.testCmd.split(' ').slice(-1)[0]) || this.turn.check && args.command.includes(this.turn.check.split(' ').slice(-1)[0]) || /\btest\b/.test(args.command))) { this.turn.testedAfterChange = true; this.turn.checkOk = !out.error; if (this.happened) this.happened.check = { cmd: String(args.command).slice(0, 120), ok: !out.error }; }
    this.emit('tool', { id, name: call.name, ...shown, view: out.view, error: out.error, secs: (Date.now() - t0) / 1000 });
    return out;
  }

  // Read with several paths (the model decides): each file read as its own Read, on screen
  // one by one; the model gets them in one result, in the order it named them.
  async readMany(id, paths, signal) {
    const parts = [];
    const readKeys = [];
    const images = [];
    let failed = 0;
    for (const [k, path] of paths.entries()) {
      if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      const out = await this.runTool({ id: `${id}_${k + 1}`, name: 'Read', args: JSON.stringify({ path }) }, signal);
      if (out.stop) return out;
      if (out.error) failed++;
      if (out.readKey) readKeys.push({ readKey: out.readKey, mtime: out.mtime });
      parts.push(out.text);
      images.push(...(out.images ?? []));
    }
    return { text: parts.join('\n\n'), error: failed === paths.length, readKeys, ...(images.length ? { images } : {}) };
  }

  // A helper (Agent): a second agent with a fresh conversation, the same model, folder, mode,
  // permissions and web, on the side slot when the server has one (the conversation's place
  // on the main slot stays), and no Agent of its own. Its steps show on one line as it goes;
  // only its report comes back. esc stops it with the rest.
  async runHelper(id, args, shown, signal) {
    const kind = args.kind === 'general' ? 'general' : 'explore';
    const t0 = Date.now();
    const slot = this.slots ? { main: this.slots.side ?? this.slots.main } : undefined;
    const helper = new Agent({
      url: this.url, model: this.model, cwd: this.cwd, system: helperPrompt(this.messages[0].content, kind), thinking: this.thinking, effort: this.effort, ctx: this.ctx,
      mode: this.mode, flows: false, verify: false, confirmPlan: false, checkIns: false, maxSteps: HELPER_STEPS, slots: slot, bash: this.bash,
      way: this.way, hooks: [...(this.hooks ?? [])], web: this.web, permissions: this.permissions, waitForServer: this.waitForServer,
      // Its questions to you come one at a time, as the conversation's do (several helpers may ask at once on the Claude API).
      ask: (req) => (this.askLine = (this.askLine ?? Promise.resolve()).then(() => this.ask({ ...req, helper: kind }), () => this.ask({ ...req, helper: kind }))),
    });
    Object.assign(helper, { isHelper: true, look: 'off', toolFilter: kind === 'explore' ? EXPLORE_TOOLS : null, canSee: this.canSee, visionOn: this.visionOn, allowedPrefixes: this.allowedPrefixes, setMode: () => {} });
    // Its edits and commands can be put back with /rewind as part of your message (no point of its own).
    if (this.rewind) helper.rewind = { begin: async () => null, edited: (...a) => this.rewind.edited(...a), around: (fn) => this.rewind.around(fn) };
    const steps = [];
    let report = '';
    const say = (last) => this.emit('tool-running', { id, name: 'Agent', label: shown.label, arg: `${shown.arg} · ${steps.length} step${steps.length === 1 ? '' : 's'}${last ? ` · ${last}` : ''}` });
    helper.on('tool', (ev) => { steps.push(`${ev.error ? '✗' : '⏺'} ${ev.label}(${String(ev.arg ?? '').slice(0, 80)})`); say(`${ev.label}(${String(ev.arg ?? '').slice(0, 50)})`); });
    helper.on('assistant', (ev) => { if (ev.final) report = String(ev.text ?? ''); });
    say('');
    let reason;
    try { reason = await helper.send(args.prompt, { signal }); } catch (e) { reason = 'error'; report ||= `It stopped: ${e.message}`; }
    const secs = (Date.now() - t0) / 1000;
    this.stats.requests += helper.stats.requests;
    const done = reason === 'done' || reason === 'answered';
    const body = report.trim() || '(it ended without a report)';
    const view = { kind: 'agent', steps: steps.length, secs, reason, content: `${steps.join('\n')}${steps.length ? '\n\n' : ''}${body}` };
    if (signal?.aborted) { this.emit('tool', { id, name: 'Agent', ...shown, view: { ...view, reason: 'interrupted' }, error: true }); return { text: 'Interrupted.', stop: 'interrupted' }; }
    // You said no to one of its changes (with nothing more to say): the turn ends there, as it does for the conversation's own.
    if (reason === 'declined') { this.emit('tool', { id, name: 'Agent', ...shown, view: { ...view, reason: 'you said no' }, error: true }); return { text: 'The user said no to a change the helper wanted to make. Wait for their next message.', error: true, stop: 'declined' }; }
    this.emit('tool', { id, name: 'Agent', ...shown, view, error: !done && !report.trim() });
    return { text: `The ${kind} helper's report (${steps.length} step${steps.length === 1 ? '' : 's'}, ${Math.round(secs)} s${done ? '' : `, it stopped: ${reason}`}):\n${body}`, error: !done && !report.trim() };
  }

  // The model's own tools (tools.mjs MODEL_TOOL_DEFS): what the app did for it before its
  // first step, now when it asks. Rename and TestFirst change files, so plan mode refuses them
  // (as it refuses Edit); each change they make still asks as your mode says.
  async runModelTool(name, args, shown, id, signal) {
    const seen = (view, error = false) => this.emit('tool', { id, name, ...shown, view, error });
    const d = decide(name, args, { mode: this.mode });
    if (d.decision === 'deny') { seen({ kind: 'denied', message: d.reason }, true); return { text: `Not allowed: ${d.reason}.`, error: true }; }
    if (this.happened && this.happened.did.length < 60) this.happened.did.push(`${name} ${args.query ?? args.task ?? args.fact ?? (args.from ? `${args.from} ${args.to}` : '')}`.slice(0, 300));
    if (name === 'Map') {
      if (isHomeFolder(this.cwd)) { seen({ kind: 'error', message: 'No map of the home folder' }, true); return { text: 'There is no map of the home folder: it would list whatever code it meets first. List a folder, or work in a project folder.', error: true }; }
      let map = null;
      try { map = repoMap(this.cwd, { maxChars: 4500 }); } catch {}
      if (!map?.entries?.length) { seen({ kind: 'list', count: 0, content: '' }); return { text: 'No code files here. List shows what the folder holds.' }; }
      this.mapGiven = true;
      seen({ kind: 'list', count: map.entries.length, content: map.text });
      return { text: `Code files in the project (lines: top-level names):\n${map.text}` };
    }
    if (name === 'CodeSearch') {
      const off = !this.helpers.has('rag') ? 'the code search helper (Oracle) is off in /helpers' : !this.embedder ? "the small model that compares meanings is off (/effort's Embedder)" : isHomeFolder(this.cwd) ? 'there is no code search of the home folder' : null;
      if (off) { seen({ kind: 'error', message: 'The code search is off' }, true); return { text: `The code search is off here: ${off}. Use Search with a word or name instead.`, error: true }; }
      let found = null;
      try { found = await this.findCode(args.query, signal); } catch (e) { if (signal?.aborted || e.name === 'AbortError') return { text: 'Interrupted.', stop: 'interrupted' }; }
      if (found?.waiting) { seen({ kind: 'search', count: 0, content: '' }); return { text: `The code search is still indexing${found.total ? ` (${found.done} of ${found.total} parts)` : ''}. Use Search with a word or name for now.` }; }
      const picked = (found?.parts ?? []).filter((p) => p.close >= CUT).slice(0, 8);
      if (!picked.length) { seen({ kind: 'search', count: 0, content: '' }); return { text: 'Nothing close to that in the code. Try other words, or Search for a name.' }; }
      let room = CODE_SEARCH_CHARS;
      const pieces = [];
      for (const p of picked) {
        let all;
        try { all = readFileSync(resolvePath(this.cwd, p.rel).abs, 'utf8').replace(/\n$/, '').split('\n'); } catch { continue; }
        const end = Math.min(p.end, all.length);
        const body = `${p.rel} (lines ${p.line}-${end} of ${all.length}) · ${p.name}:\n${all.slice(p.line - 1, end).join('\n')}`;
        if (body.length > room) { if (!pieces.length) pieces.push(`${body.slice(0, room)}\n… (cut; Read the file for the rest)`); break; }
        room -= body.length;
        pieces.push(body);
      }
      const list = picked.map((p) => `${p.rel}:${p.line} ${p.name}`).join('\n');
      seen({ kind: 'search', count: pieces.length, content: list });
      return { text: `The parts closest in meaning to "${args.query}", closest first:\n\n${pieces.join('\n\n')}` };
    }
    if (name === 'Remember') return this.rememberFact(args, seen);
    // Rename and TestFirst: the focused paths, run for the model (flows/index.mjs runKind).
    if (!isCodeProject(this.cwd)) { seen({ kind: 'error', message: 'Not a code project here' }, true); return { text: `${name} works in a project folder with code; here, do it yourself with Search, Read and Edit.`, error: true }; }
    seen({ kind: 'started' });
    const counted = { tokens: 0, thinkTokens: 0 };
    const tally = ({ tokens, thought }) => { counted.tokens += tokens + thought; counted.thinkTokens += thought; this.stats.outTokens += tokens + thought; };
    tallies.add(tally);
    const ctx = this.flowContext(signal);
    let said = '';
    const note = ctx.note;
    ctx.note = (text, tone) => { said = String(text); note(text, tone); };
    const filesBefore = this.happened?.files.size ?? 0;
    let out = null;
    this.carried = null;
    try {
      const kind = name === 'Rename' ? 'rename' : args.kind === 'fix' || args.kind === 'change' ? args.kind : /\b(fix|bug|broken|fails?|failing|crash(es)?|wrong|error)\b/i.test(args.task ?? '') ? 'fix' : 'change';
      out = await runKind(ctx, name === 'Rename' ? { kind, from: args.from, to: args.to } : { kind }, name === 'Rename' ? `rename ${args.from} to ${args.to}` : args.task);
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') return { text: 'Interrupted.', stop: 'interrupted' };
      said = `it failed (${e.message})`;
    } finally {
      tallies.delete(tally);
      this.emit('flow-step', null);
      if (this.turn) { this.turn.tokens = (this.turn.tokens ?? 0) + counted.tokens; this.turn.thinkTokens = (this.turn.thinkTokens ?? 0) + counted.thinkTokens; }
    }
    if ((this.happened?.files.size ?? 0) > filesBefore && this.turn) { this.turn.changed = true; this.turn.testedAfterChange = Boolean(out?.done); }
    // A check the fix path made for the change still to come (flows/pagecheck.mjs).
    const left = this.carried ? `\n${this.carried.note}` : '';
    if (this.carried?.check && this.turn) this.turn.check = this.carried.check;
    this.carried = null;
    if (out?.declined) return { text: out.summary, stop: 'declined' };
    if (out) {
      if (this.happened) this.happened.flow = { done: out.done, summary: String(out.summary ?? '').slice(0, 300) };
      return { text: `${out.summary}${out.done === false ? ' Its check did not pass: look at why before you report.' : ''}${left}` };
    }
    const why = said.replace(/;\s*working step by step instead\.?$/, '').replace(/\.$/, '') || 'it could not finish';
    return { text: `${name === 'Rename' ? 'Rename' : 'The test-first worker'} handed it back: ${why}. Carry on yourself with Read, Edit and the tests.${left}` };
  }

  // Remember (the model decides): one fact saved at once, and a line says what was saved.
  // Nothing is saved from the tests' own practice work, nor with saving off.
  rememberFact(args, seen) {
    const off = !this.memory ? 'the memory is off here ("memory": false in settings.json)'
      : this.memory.saveOff || (process.env.AGENTIC_MEMORY_SAVE ?? process.env.BONSAI_MEMORY_SAVE) === 'off' ? 'saving to memory is off here'
      : practiceWork({ request: this.happened?.request ?? '', files: [...(this.happened?.files ?? [])] }, this.cwd) ? 'this is practice work on a test’s own files, which teaches the memory nothing'
      : null;
    if (off) { seen({ kind: 'error', message: 'Not saved' }, true); return { text: `Not saved: ${off}. Carry on.` }; }
    let out;
    try { out = applySave({ cwd: this.cwd, home: this.memory.home, adds: [{ text: args.fact, kind: args.about === 'you' ? 'you' : 'project', from: 'saved by the model while it worked' }] }, { why: 'remember' }); } catch (e) { seen({ kind: 'error', message: e.message }, true); return { text: `Not saved: ${e.message}.`, error: true }; }
    if (!out.added.length) { const why = out.refused[0]?.why ?? 'it is already saved'; seen({ kind: 'error', message: `Not saved: ${why}` }, true); return { text: `Not saved: ${why}.` }; }
    seen({ kind: 'saved' });
    const line = saveLine(out);
    if (line) this.emit('note', { text: line, tone: 'dim' });
    return { text: 'Saved to the memory.' };
  }

  // A command in a question turn that may write: it runs in a throwaway copy
  // of the project (made once per message), so whatever it writes, your files
  // stay as they are.
  async runAside(command, signal) {
    this.turn.scratch ??= new Scratch(this.cwd);
    const r = await this.turn.scratch.run(command, { timeoutMs: 120_000, signal });
    const all = r.out.replace(/\n$/, '').split('\n');
    const lines = all.length > 80 ? [...all.slice(0, 40), `… ${all.length - 80} lines cut …`, ...all.slice(-40)] : all;
    const status = r.timedOut ? '\n(stopped after 2 minutes)' : r.code === 0 ? '' : `\n(exit code ${r.code})`;
    const text = `(This ran in a throwaway copy of the project: a question changes no files.)\n${(lines.join('\n') || '(no output)').slice(0, this.maxResultChars)}${status}`;
    return { text, error: r.code !== 0, view: { kind: 'bash', code: r.code, lines, ms: r.ms, timedOut: r.timedOut } };
  }

  // Problems the layout check still found after the model's fix get the last
  // word: its answer may say "fixed" (Qwen, 30 Sep: "meets the 4.5:1 contrast"
  // at 4.1:1; "fixed the horizontal scroll" at 401 px in a 390 px window), so
  // the turn ends with the check's own line. Changed again since that look:
  // looked at once more, quietly, so the line is never stale.
  async stillBroken(reason) {
    const t = this.turn;
    if (!t?.layoutLeft || reason === 'interrupted') return;
    if ((t.edits ?? 0) !== t.editsAtLook) { try { await this.checkLayout(true, { quiet: true }); } catch { return; } }
    for (const { page, problems } of t.layoutLeft ?? []) {
      this.emit('note', { text: `Still broken: ${problems[0].replace(/\.$/, '')}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}. The page check looked at ${page} again after the fix.`, tone: 'warn', stillBroken: { page, problems } });
    }
  }

  // The functions this message's changes took away that the request neither
  // names nor asks to remove (lostNames), as "area in shapes.mjs"; null when
  // none. A function moved to another changed file is not lost.
  lostSinceStart() {
    const starts = this.turn?.startTexts;
    if (!starts?.size) return null;
    const now = new Map([...starts.keys()].map((rel) => { try { return [rel, readFileSync(join(this.cwd, rel), 'utf8')]; } catch { return [rel, '']; } }));
    const out = [];
    for (const [rel, before] of starts) {
      const elsewhere = [...now].filter(([r]) => r !== rel).map(([, t]) => t);
      for (const n of lostNames(rel, before, now.get(rel), this.turn.request ?? '', { elsewhere })) out.push(`${n} in ${rel}`);
    }
    return out.length ? `${out.slice(0, 4).join(', ')}${out.length > 4 ? ` and ${out.length - 4} more` : ''}` : null;
  }

  // A forced-JSON check of the finished work against the request: null when
  // covered, otherwise what is missing (one short sentence). Best effort.
  async verifyDone(answer, signal) {
    const request = [...this.messages].reverse().find((m) => m.role === 'user' && !/^\[|^Not done yet|^Go ahead|^The tests fail|^You created|^Reply to the user|^You ran out/.test(m.content))?.content ?? '';
    if (!request.trim() || !this.turn.diffs.trim()) return null;
    try {
      const r = await complete({ url: this.url, model: this.model, slot: this.slots?.side, signal, temperature: 0, maxTokens: 220,
        system: 'You check whether a coding assistant did everything a request asked. Judge only from the request, the changes and its report.',
        user: `Request:\n${request.slice(0, 2000)}\n\nChanges made (diff lines, + added, - removed; a line ${CUT_MARK} means Agentic Coder shortened the change for this check, not that anything is missing):\n${this.turn.diffs.length > 16000 ? `${this.turn.diffs.slice(0, 16000)}\n${CUT_MARK}` : this.turn.diffs}\n\nIts report:\n${(answer ?? '').slice(0, 1000)}\n\nBreak the request into its distinct asks (parts, at most 6) and judge each one against the changes. A request with one ask has one part. A part is done only when it is done fully, the way the person asking would expect: a story, notes, a description or documentation that is only a sentence or two, a placeholder, a stub or a TODO counts as not done. Is every part of the request done? If something the request asks for is missing from the changes, say what in one short sentence.`,
        schema: { type: 'object', properties: { parts: { type: 'array', items: { type: 'object', properties: { part: { type: 'string' }, done: { type: 'boolean' } }, required: ['part', 'done'] }, maxItems: 6 }, done: { type: 'boolean' }, missing: { type: 'string' } }, required: ['parts', 'done', 'missing'] } });
      if (!r.json) return null;
      // Parts first: a request with several asks fails on the ones not done
      // (task 28's class: "the fallback missed a part").
      const undone = (r.json.parts ?? []).filter((p) => p && p.done === false && typeof p.part === 'string' && p.part.trim()).map((p) => p.part.trim());
      if (undone.length) return undone.join('; ').slice(0, 200);
      if (r.json.done || !r.json.missing?.trim()) return null;
      return r.json.missing.trim().slice(0, 200);
    } catch { return null; }
  }

  // What it looked at in this message (Read, Search, List, Map, CodeSearch), as the screen names them.
  lookedSince(at) {
    const out = [];
    for (const m of this.messages.slice(at)) {
      for (const c of m.tool_calls ?? []) {
        const name = c.function?.name;
        if (!['Read', 'Search', 'List', 'Map', 'CodeSearch'].includes(name)) continue;
        const shown = display(name, parseArgs(name, c.function?.arguments ?? '').args ?? {});
        out.push(`${shown.label}(${String(shown.arg ?? '').slice(0, 60)})`);
      }
    }
    return out;
  }

  // Fixing a bug, it named the cause or the fix, then went on looking: a note
  // says to make the change now (once; again only after 4 more looks with no
  // change). In the chart bug's High run the cause was in its thinking at
  // 8 minutes and it never changed a line.
  actNow(call, lines) {
    const t = this.turn;
    if (!t?.fixing || t.changed || !LOOKS.has(call.name)) return null;
    t.looks = (t.looks ?? 0) + 1;
    if (t.nudged >= 2 || t.looks < 3 || (t.nudged && t.looks - t.looksAtNudge < 4)) return null;
    const line = lines.filter(namesAFix).at(-1);
    if (!line) return null;
    t.nudged++;
    t.looksAtNudge = t.looks;
    return `You wrote: "${line}" If that is the cause, stop looking and make the smallest change that fixes it now (Read the exact lines first if they are not above). If one thing is still unclear, check only that.`;
  }

  // A check-in while it explores: after CHECK_INS.steps looks (Read, Search,
  // List, Bash) or CHECK_INS.secs seconds with no change made, it says what
  // it has looked at and asks where to look. The answer steers the next step.
  async checkIn(call, signal) {
    const t = this.turn;
    if (!t || !this.checkIns || t.changed || !LOOKS.has(call.name)) return null;
    const shown = display(call.name, parseArgs(call.name, call.args).args ?? {});
    t.looked.push(`${call.name} ${shown.arg ?? ''}`.trim());
    const secs = (Date.now() - t.since) / 1000;
    if (t.looked.length < this.checkIns.steps && secs < this.checkIns.secs) return null;
    const seen = [...new Set(t.looked)];
    const list = seen.slice(-8).join('; ');
    const question = `I have looked at ${seen.length} thing${seen.length === 1 ? '' : 's'} (${Math.round(secs / 60)} min) and not changed anything yet. Latest: ${list}. Am I on the right track? Tell me where to look, or say "keep going".`;
    t.looked = [];
    t.since = Date.now();
    const id = `checkin_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'checkin', args: { question, options: ['Keep going'] }, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    if (answer.choice === 'no' && !answer.feedback) return { stop: 'declined' }; // "Stop here"
    const text = (answer.text ?? answer.feedback ?? '').trim();
    if (!text) return null; // no answer: carry on
    t.asked.push(question);
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text } });
    if (/^(keep going|go on|continue|carry on|yes|ok|okay|y)\W*$/i.test(text)) return { asked: true };
    return { asked: true, text: `[Check-in] You asked whether you are on the right track. The user answered: ${text}\nFollow that.` };
  }

  // Stuck: the same step twice, or three tool errors in a row. One question
  // with what went wrong; a hint goes straight to the model.
  async stuckAsk(why, call, out, signal) {
    const t = this.turn;
    const shown = display(call.name, parseArgs(call.name, call.args).args ?? {});
    const step = `${call.name} ${shown.arg ?? ''}`.trim();
    const err = String(out?.text ?? '').split('\n').find((l) => l.trim())?.trim().slice(0, 160) ?? '';
    const question = why === 'repeat'
      ? `I ran the same step twice (${step}) and I'm not getting further. Give me a hint, say "keep going", or stop here.`
      : `Three steps in a row failed. The last one (${step}) said: ${err}. Give me a hint, say "keep going", or stop here.`;
    const id = `stuck_${Date.now()}`;
    if (t) t.stuckAsks = (t.stuckAsks ?? 0) + 1;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'stuck', args: { question, options: ['Keep going'] }, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    if (answer.choice === 'skip') return null; // no one to ask: carry on as before
    if (answer.choice === 'no' && !answer.feedback) return { stop: 'declined' }; // "Stop here"
    const text = (answer.text ?? answer.feedback ?? '').trim();
    if (!text) return null;
    t?.asked.push(question);
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text } });
    if (/^(keep going|go on|continue|carry on|yes|ok|okay|y)\W*$/i.test(text)) return { keepGoing: true };
    return { text: `[Stuck] You were going round in circles and asked the user for a hint. The user answered: ${text}\nFollow that.` };
  }

  // One yes-or-steer question before changing files; yes (or "ok", "go")
  // allows the rest of this message's changes.
  async confirm(plan, signal) {
    const question = `Before I change anything: ${plan}. Go ahead? Say yes, or tell me what to do instead.`;
    const id = `plan_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'plan', args: { question, options: ['Yes'] }, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    const text = (answer.text ?? '').trim();
    const yes = answer.choice === 'yes' || answer.choice === 'always' || /^(yes|y|ok|okay|go|go ahead|sure|do it|yep|👍)\W*$/i.test(text);
    if (yes) {
      if (this.turn) this.turn.planOk = true;
      this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: text || 'yes' } });
      return { ok: true };
    }
    if (answer.choice === 'no' && !answer.feedback && !text) return { ok: false, stop: 'declined' };
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: text || answer.feedback } });
    return { ok: false, feedback: text || answer.feedback };
  }

  // The model's Ask tool: the question goes through the same prompt as a
  // permission (or the answers hook when there is no screen).
  async askUser(id, args, shown, signal) {
    const options = Array.isArray(args.options) ? args.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 4) : [];
    this.emit('tool-ask', { id, name: 'Ask', ...shown });
    const answer = await this.ask({ id, name: 'Ask', args: { question: args.question, options }, prepared: {}, ...shown });
    if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
    if (answer.choice === 'no' || !answer.text?.trim()) {
      this.emit('tool', { id, name: 'Ask', ...shown, view: { kind: 'declined', feedback: answer.feedback }, error: true });
      return { text: `The user did not answer${answer.feedback ? ` and wrote: ${answer.feedback}` : '. Wait for their next message.'}`, error: true, stop: answer.feedback ? null : 'declined' };
    }
    const text = answer.text.trim();
    this.turn?.asked?.push(args.question);
    this.emit('tool', { id, name: 'Ask', ...shown, view: { kind: 'answer', question: args.question, text } });
    return { text: `The user answered: ${text}` };
  }

  // Keep the conversation inside the model's memory: first empty old tool
  // outputs, then (if still too big) replace the history with a summary.
  // Emptying an old output makes the model re-read everything after it, so
  // it happens rarely and deeply: past trimAt, the oldest outputs go until
  // the conversation is under TRIM_TO. (Trimming just enough once emptied the
  // file the model had just read, so it read it again, step after step.)
  async fitContext(signal) {
    const pending = this.messages.slice(-2).reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : ''), 0);
    // The next reply needs its room too: at 16k, trimming without counting it
    // let a High reply run into the end of the memory mid-thought.
    const room = replyRoom(this.thinking, this.model?.thinkingBudget);
    let est = this.ctxUsed + pending;
    if (est + room < this.ctx * this.trimAt) return;
    // Notes first. Emptying old output makes the model read again everything
    // after it (measured: 186 to 261 s each time, up to half of a long try).
    // Its notes are written in the conversation it already holds, so only
    // the notes themselves are read afterwards.
    if (this.whenFull === 'notes' && est + NOTES_ROOM < this.ctx * 0.97 && await this.notesInPlace(signal)) return;
    let freed = 0;
    // Old thinking first: every step before the newest KEEP_THOUGHTS keeps
    // only its cause/fix lines (keyLines); the rest served its step already.
    const thoughts = this.messages.filter((m) => m.role === 'assistant' && m.reasoning_content);
    for (const m of thoughts.slice(0, -KEEP_THOUGHTS)) {
      const kept = keyLines(m.reasoning_content, 3).join(' ');
      if (kept === m.reasoning_content) continue;
      freed += Math.max(0, tokensOf(m.reasoning_content) - tokensOf(kept));
      if (kept) m.reasoning_content = kept;
      else delete m.reasoning_content;
    }
    // Then old tool outputs, oldest first, down to TRIM_TO.
    const tools = this.messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i > 0);
    const keep = new Set(tools.slice(-2)); // the two newest outputs stay
    for (const i of tools) {
      if (est - freed < this.ctx * TRIM_TO) break;
      const m = this.messages[i];
      if (keep.has(i) || m.content.length <= 300) continue;
      freed += tokensOf(m.content);
      m.content = `[older output removed to save space: ${m.content.slice(0, 120).replace(/\n/g, ' ')}…]`;
    }
    est -= freed;
    this.ctxUsed = Math.max(0, this.ctxUsed - freed);
    if (freed) this.emit('note', { text: `Trimmed old tool output to save memory (about ${freed.toLocaleString()} tokens).`, tone: 'dim' });
    if (est + room >= this.ctx * this.fullAt) await this.compact(signal);
  }

  // Its notes, written by the model in the conversation it already holds
  // (nothing to read but the request for them), then the conversation starts
  // over from the request and the notes. False when no usable notes came.
  async notesInPlace(signal) {
    if (this.messages.length <= 3) return false;
    this.emit('note', { text: 'Memory is filling up: writing down where I am, then carrying on from my notes…', tone: 'dim' });
    const t0 = Date.now();
    const ask = auto(`Your memory is nearly full. Write your notes now, in plain words and under 200 words, with no tool call: what you have done so far, the files and line numbers that matter, any cause you have already worked out (word for word), and the single next step.`);
    // The newest tool output came after the model's last reply: it has not
    // read it yet. Reading it only to summarize it away costs a whole step
    // (70 s for 130 lines of a page, measured), so it is held back from the
    // notes and follows them, as it is.
    const held = this.heldBack();
    const asked = held ? [...this.messages.slice(0, -held.length), held[0], { ...held[1], content: '(This output is kept for you: it comes back, whole, right after your notes.)' }] : this.messages;
    let summary = '';
    try {
      const sampling = this.thinking ? this.model.thinkingSampling : this.model.sampling;
      for await (const ev of streamChat({ url: this.url, messages: [...this.withTurnNotes(asked), { role: 'user', content: ask }], tools: this.tools(), toolChoice: 'none', extra: { stop: ['<tool_call>'] }, thinking: this.thinking, effort: this.effort, model: this.model, sampling, maxTokens: NOTES_ROOM, slot: this.slots?.main, signal })) {
        if (ev.type === 'text') summary += ev.text;
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      return false;
    }
    summary = summary.split('<tool_call>')[0].trim();
    if (summary.length < 40) return false;
    const before = this.ctxUsed;
    if (!this.restartFrom(summary, held)) return false;
    // The instructions are read from their saved state, not again from the start.
    try { await this.rewarm?.(signal); } catch (e) { if (signal?.aborted) throw e; }
    this.emit('compacted', { summary, inPlace: true, secs: (Date.now() - t0) / 1000, freed: Math.max(0, before - this.ctxUsed) });
    return true;
  }

  // The newest tool call and its output, when the model has not read the
  // output yet: [the assistant's call, the tool's result], or null.
  heldBack() {
    const [call, result] = this.messages.slice(-2);
    if (result?.role !== 'tool' || call?.role !== 'assistant' || !call.tool_calls?.some((c) => c.id === result.tool_call_id)) return null;
    // A short output costs nothing to read; holding it back would only add a step.
    return tokensOf(String(result.content)) > 400 ? [call, result] : null;
  }

  // What it looked at and changed in this message, from Agentic Coder's own record:
  // a summary can forget a file, this list cannot.
  seenSoFar() {
    const t = this.turn;
    if (!t) return '';
    const tilde = (abs) => (abs.startsWith(`${this.cwd}/`) ? abs.slice(this.cwd.length + 1) : abs);
    const reads = new Map();
    for (const key of t.reads?.keys() ?? []) {
      const [abs, offset, limit, find] = key.split('|');
      const what = find ? `around "${find}"` : offset ? `lines ${offset}-${Number(offset) + Number(limit || 150) - 1}` : 'from the top';
      reads.set(tilde(abs), [...(reads.get(tilde(abs)) ?? []), what]);
    }
    const lines = [];
    if (reads.size) lines.push(`Files I have read: ${[...reads].slice(-12).map(([f, w]) => `${f} (${[...new Set(w)].slice(0, 4).join('; ')})`).join(', ')}.`);
    if (t.searches?.length) lines.push(`Searches I ran: ${t.searches.map((s) => `"${s}"`).join(', ')}.`);
    const changed = [...new Set((t.diffs.match(/^(\S[^\n]*):$/gm) ?? []).map((l) => l.slice(0, -1)))];
    if (changed.length) lines.push(`Files I have changed: ${changed.join(', ')}.`);
    if (this.keptWrite) lines.push(`Agentic Coder still keeps the content of my Write call that had no path (${this.keptWrite.content.split('\n').length} lines): I send Write with only "path" to save it, and do not write it again.`);
    return lines.length ? `\n\nFrom Agentic Coder's record of this message:\n${lines.map((l) => `- ${l}`).join('\n')}` : '';
  }

  // The conversation starts over from the request (word for word) and the
  // notes; `held` (heldBack) follows them.
  restartFrom(summary, held = null) {
    // The request stays word for word (the summary once became "the task" and
    // the model started the investigation over, in a folder it made up). The
    // notes are Agentic Coder's own, in its own mouth, not a message from the user.
    const capped = (s) => (s.length > 6000 ? `${s.slice(0, 6000)}\n${CUT_MARK}` : s);
    const opening = (this.turn?.opening ?? []).filter((m) => this.messages.includes(m)).map((m) => ({ role: m.role, content: capped(String(m.content)) }));
    if (!opening.some((m) => m.role === 'user')) {
      const req = [...this.messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string' && !m.content.startsWith('[') && !m.content.startsWith(AUTO));
      if (req) opening.push({ role: 'user', content: capped(req.content) });
      else return false; // nothing to anchor on: leave the conversation as it is
    }
    const facts = this.turn?.findings?.length ? `\n\nWhat I have already worked out (I keep these):\n${this.turn.findings.map((f) => `- ${f}`).join('\n')}` : '';
    // The notes that go with the request (the steps for its kind of bug, a
    // check the fix path made) follow the request into the new conversation.
    for (const x of [this.turn?.bug, this.turn?.skill, this.turn?.look, this.turn?.math, this.turn?.design, this.turn?.carried].filter(Boolean)) {
      const i = (this.turn?.opening ?? []).filter((m) => this.messages.includes(m)).indexOf(x.request);
      if (i >= 0) x.request = opening[i];
    }
    this.messages = [this.messages[0], ...opening,
      // "Nothing is saved anywhere else": after its notes the model once went
      // looking for them on disk (ls ~/.claude/sessions, chart bug, 27 Sep).
      { role: 'assistant', content: `My memory filled up, so I wrote down where I am. My notes (all of them are here; nothing is saved anywhere else):\n${summary.trim()}${facts}${this.seenSoFar()}` },
      { role: 'user', content: auto(held
        ? 'Those are your own notes, and they may be imperfect. Pick up from them. The output of your last step follows; read it, then take the next step with the tools. Do not start the investigation over and do not re-read what the notes already answer.'
        : 'Those are your own notes, and they may be imperfect. Pick up from them: take the single next step now with the tools. Do not start the investigation over and do not re-read what the notes already answer.') },
      ...(held ?? []),
    ];
    if (this.turn) this.turn.opening = opening;
    this.mapGiven = false;
    this.ctxUsed = this.messages.reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : '') + tokensOf(m.reasoning_content ?? ''), 0) + 1300;
    return true;
  }

  async compact(signal, { instructions } = {}) {
    if (this.messages.length <= 3) return;
    this.emit('note', { text: 'Summarizing the conversation to free memory…', tone: 'dim' });
    const history = this.messages.slice(1).map((m) => {
      if (m.role === 'tool') return `TOOL RESULT: ${String(m.content).slice(0, 600)}`;
      if (m.role === 'assistant') return `YOU: ${m.reasoning_content ? `(thought: ${keyLines(m.reasoning_content, 2).join(' ').slice(0, 400)}) ` : ''}${m.content}${m.tool_calls ? ` [called ${m.tool_calls.map((c) => `${c.function.name} ${c.function.arguments.slice(0, 200)}`).join('; ')}]` : ''}`;
      return `USER: ${m.content}`;
    }).join('\n').slice(-40000);
    const ask = [
      { role: 'system', content: 'You summarize a coding session so it can continue with less memory.' },
      { role: 'user', content: `${history}\n\nWrite a summary under 200 words: what has been done, the files and line numbers that matter, any cause already worked out (word for word), and the single next step.${instructions ? ` ${instructions}` : ''}` },
    ];
    let summary = '';
    for await (const ev of streamChat({ url: this.url, messages: ask, thinking: false, sampling: this.model.sampling, maxTokens: 600, slot: this.slots?.side, signal })) {
      if (ev.type === 'text') summary += ev.text;
    }
    if (this.restartFrom(summary)) this.emit('compacted', { summary: summary.trim() });
  }
}
