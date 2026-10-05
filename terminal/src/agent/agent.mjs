// The agent loop: send the conversation to the model, stream what comes
// back, run the tool it asks for (asking you first when needed), feed the
// result back, and repeat until it answers without a tool.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { endpointOf } from '../../../models/index.mjs';
import { searchKey, PROVIDER_NAMES } from '../tools/web.mjs';
import { readInstructions, replaceInstructionBlock, focusedInstructions } from './instructions.mjs';
import { streamChat } from './client.mjs';
import { isBusy } from './busy.mjs';
import { askedQuestions, checkInQuestion, stuckQuestion, sameStepNote, sameResultSaid, planQuestion, lookSaid, stepSaid, errorSaid, planSaid, wantsQuestions, questionLines, ASK_NOTE, pageWrongQuestion } from './questions.mjs';
import { CASES_ASK, CASES_FIX, MAX_CASES, casesOf, casesFromList, gapCases, casesTold, addCase, isTestPath, untested, casesBack, REVIEW_MAX, REVIEW_CODE, REVIEW_SYSTEM, REVIEW_SCHEMA, reviewAsk, reviewWrong, reviewBack, signSample } from './cases.mjs';
import { toolSchemas, parseArgs, normalizeArgs, sentArgs, needsText, display, prepare, execute, resolvePath, didYouMean, syntaxError, WHOLE_MAX, needsSight, EXPLORE_TOOLS, toolNameOf, plainFetch, plainRead, desktopDefault, patchOps } from './tools.mjs';
import { existsSync, statSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { outlineText } from '../tools/outline.mjs';
import { repoMap } from '../tools/repomap.mjs';
import { rankFiles } from './rank.mjs';
import { decide, isReadOnly, testRunOf, offerFor, protectedBy, ownBy } from './permissions.mjs';
import { testCommand, systemPrompt, projectNotes, gitSummary, isHomeFolder, notesRoom, promptSetOf } from './prompt.mjs';
import { sortBug, kindText } from './rules.mjs';
import { lookSecs, LOOK_NOTE, LOOK_NOTE_DATA, LOOK_BACKS, lookBackNote } from './look.mjs';
import { folderKind, folderCard, namesInRequest, namesQuestion } from './folder.mjs';
import { filesMade, madeNote } from './made.mjs';
import { inScripts } from './scripts.mjs';
import { readPage, emptyOf, pageReadNote, pageReadLine, pageReadOn } from './page-read.mjs';
import { pickSkill, skillNote, readSkills, skillsList, skillPath, toolUseFor, rulesSetOf, readGuides, guidesList, guidePath, harnessOf, readHelperAgents } from './prompt-files.mjs';
import { sortMath, mathNotes, mathIndex } from './expertise.mjs';
import { isDesignRequest, pickCards, designNotes, designSettings, mixTurn } from './design.mjs';
import { pickPieces, studioNotes, buildStyles, buildNote, isBuilt } from './studio.mjs';
import { layoutCheck, layoutNote, pagesToCheck, findChrome, needsServer } from '../flows/layoutcheck.mjs';
import { findProjects, projectsNamed, foldersNamed } from './projects.mjs';
import { homedir } from 'node:os';
import { basename, join, dirname, relative, isAbsolute } from 'node:path';
import { runFlows, runKind, isSmallTalk, routeByRules, isCodeProject } from '../flows/index.mjs';
import { wayOf, hooksOn, wayPrompt, leanPrompt, LEAN_NOTE, OPT_IN_HOOKS } from './way.mjs';
import { SeenFiles, changedNote, changesText } from './seen.mjs';
import { toolInput, STOP_BACKS } from './user-hooks.mjs';
import { clarify } from '../flows/clarify.mjs';
import { isFollowUp, sortLine, wantsDesktop } from '../flows/words.mjs';
import { checkInText } from '../flows/fix.mjs';
import { Scratch } from '../flows/scratch.mjs';
import { lostNames } from '../flows/blocks.mjs';
import { partsFor, wholeSmallProject } from '../flows/explain.mjs';
import { upFrontFor, SERVICE_REPLY } from './room.mjs';
import { readResults, testsFailed } from '../flows/results.mjs';
import { runCommand } from '../tools/run.mjs';
import { Jobs, took } from '../tools/jobs.mjs';
import { complete, tallies, llmCalls, oldThinking } from '../flows/llm.mjs';
import { autoCheck } from './auto-check.mjs';
import { driftCheck, recentSteps, nudgeText, DRIFT_EVERY, DRIFT_NUDGES } from './drift.mjs';
import { secondLook, ownSteps, lookFacts, lookText, lookOn } from './second-look.mjs';
import { screenAccess } from '../tools/screen.mjs';
import { isMemoryRequest } from './memory.mjs';
import { changedLines } from '../tools/edit.mjs';
import { changeTrust, alwaysRules } from './facts.mjs';
import { recall, recallNotes, usedFacts } from './recall.mjs';
import { recallClaude, claudeText, notesDir, topicOf, chasedQuestion } from './claude-notes.mjs';
import { packDir, packView } from './claude-pack.mjs';
import { openPart, readLadder, partsOf, partFor, nearParts } from './ladder.mjs';
import { MAP_DIR, projectFiles } from '../tools/codemap.mjs';
import { saveLessons, knownAlready, practiceWork, applySave, saveLine } from './lessons.mjs';
import { helpersOn, CODENAMES, shareOut, chars, CEILING, SHARES, fixLike, talksAboutChanges, createdNames, testReport, gitChanges, whoUses } from './helpers.mjs';
import { CodeIndex, sameAsIndexed, partKey, CUT, MARGIN } from '../tools/codeindex.mjs';
import { choose, howChosen } from './search.mjs';
import { IMAGE_TOKENS } from './images.mjs';
import { useOf, describePictures, describedNote, reviewChange, checkPagePicture, screenshotPage, canQuickLook } from './helper-models.mjs';
import { openingRead, openingOn, memorySent, mapsRead } from './opening.mjs';
import { isMcpCall, MCP_TOOL, mcpPlan, mcpToolDefs, mcpBrief, requestNote, requestHits, callHint, unwrapArgs, gateCall, madeUpCall, mcpCallInText, findEntry, describeEntry, describeServer, argLines, checkArgs, argsPreview, resultParts, resultText, catalogStamp, mcpRule } from './mcp.mjs';
import { pictureFor } from '../tools/mcp.mjs';

const MAX_STEPS = 40;
// Its plan (TodoWrite) goes back with a step's result after this many steps without it, while steps
// are left: in a long message the list it wrote at the start is far up the conversation by then.
const PLAN_EVERY = 5;
// Your request comes back the same way every REQUEST_EVERY steps on a model whose memory is this big or
// bigger (a model on a service: 256k), where by then much of the conversation sits between it and the
// newest step. A smaller memory is cleaned up long before that, and starts again from the request.
const REQUEST_EVERY = 10;
const BIG_MEMORY = 65_536;
const newConversation = () => randomUUID().slice(0, 8);
// How many times what the layout check finds goes back to the model in one
// message: the first look, and once more when its fix left something (30 Sep:
// Qwen's one fix made the play button fainter, 3.9 → 3.7:1, and the turn ended).
const LAYOUT_ROUNDS = 2;
// When the model decides (way.mjs): the calls of one reply that run, in order.
export const MAX_CALLS = 8;
// A request about an MCP server's data answered with no MCP tool tried: sent back this many times, then replaced.
export const MCP_BACKS = 2;
// Its own tools on Model (tools.mjs MODEL_TOOL_DEFS), run by the agent itself.
const MODEL_TOOLS = new Set(['Map', 'CodeSearch', 'Rename', 'TestFirst', 'Remember']);
// The calls that change the project's files (the cases' ask comes with the first of them).
const CHANGES = new Set(['Edit', 'Write', 'apply_patch', 'TestFirst', 'Rename']);
const CASE_ITEM = { type: 'object', properties: { example: { type: 'string' }, expect: { type: 'string' } }, required: ['example', 'expect'] };
const CODE_SEARCH_CHARS = 6000; // what one CodeSearch brings back, at most (~1,700 tokens)
// A request's time for thinking (30 Sep 2026): past half of it, it thinks only briefly, so it
// finishes instead of running out of time (practice task 28 at High ran out of its 30 minutes on
// 29 Sep, while Low passed it in under 3). The chat keeps the template's thinking switch and is
// capped at STEP_DOWN_CAP tokens a reply: Gemma's template puts the switch at the very top of the
// prompt, so turning it off would read the whole conversation again. The focused paths' own calls
// stop thinking. AGENTIC_THINK_BUDGET: seconds (0: never); the practice runs pass their limit.
export const THINK_BUDGET_SECS = 900;
export const STEP_DOWN_CAP = 64;
const budgetFromEnv = () => { const v = Number(process.env.AGENTIC_THINK_BUDGET); return Number.isFinite(v) && v >= 0 ? v : THINK_BUDGET_SECS; };
const TRIM_AT = 0.78; // share of the context that starts a trim
const TRIM_TO = 0.45; // …and where it stops
const FULL = 0.85; // past this share (with the reply room counted) trimming was not enough: summarize
export const RESULT_MAX = 30_000; // the most characters one tool result keeps (Claude Code's own for a command)
// Room kept free for one reply: thinking (up to the server's reasoning budget)
// plus the answer. At 16k, a trim at 78% left too little, and a High reply
// ran into the end of the memory (chart bug, 25 Sep). The thinking part is the
// model's own budget, so raising it in model.mjs leaves the answer its 2,048.
const replyRoom = (thinking, budget = 2048) => (thinking ? 2048 + budget : 2048);
const NOTES_ROOM = 700; // tokens for its notes when memory fills (about 200 words, with room to spare)
// Its notes think only briefly. With the full thinking cap, Bonsai's thinking took all
// 700 tokens three times running and left no notes (countdown card, 1 Oct).
const NOTES_THINK = 128;
// When the memory is tight, a reply's thinking shrinks to what fits under the trim line,
// down to this, before notes are written. At 16k with a 4,096 cap the request's start
// (7,300 tokens) was already over the line, so notes came after every step (1 Oct).
const LEAST_THINK = 512;
// Claude's notes that go with a request in a memory of 16k or less (else claude-notes.mjs TOP).
const SMALL_CTX_NOTES = 2;
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
// The same call again: after the second, and with "Keep going" to the stuck question.
const SAME_STEP = 'You already did exactly this step. Do something different, or finish.';
// With the request while Bypass permissions is on (see send()).
const BYPASS_OPEN = "Bypass permissions is on: Read, List, Search, Write, Edit and commands may use any folder on this Mac (a full path is fine), and commands may reach the internet. Still refused: secrets outside the project (keys, .ssh, .env), Agentic Coder's own settings, rm -rf, sudo, git push, stopping processes and the user's never-list.";
// The turn's last word when it was stopped as stuck: before, the user got only the app's
// warning line after 5 minutes of work (3 Oct 2026, a math check of a folder).
const STUCK_WORD = (why) => `You were stopped because ${why}. Do not call any tool. In at most five short lines, tell the user what you found so far (with the numbers and file names you have), what blocked you, and what they could tell you or try next.`;

// A question put to the user: a sentence ending in "?" that speaks to them
// ("Are you seeing it in TextEdit?", "Should I…?"), or a request for input.
// "Why does it fail? Let me read the test." is thinking aloud, not this.
function asksTheUserDirectly(text) {
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
// Look before answering (3 Oct 2026, the owner's picks after models on the service answered "where
// is…?" in one step, from nothing, and named files that are not there): a model on another machine
// answers a question about the project, or a change, only after a look of its own (Read, Search,
// List, Map, CodeSearch, a helper, a command that only reads); the app's opening read does not count.
//   aboutTheCode   a question that names something of the code ("where is…", a file, a name()), or
//                  a request for work. Small talk and general questions ("what is 2+2") are not.
//   filesInAnswer  the files an answer names, as paths or names with a code or text extension
const LOOK_TOOLS = new Set(['Read', 'Search', 'List', 'Map', 'CodeSearch', 'Agent']);
const CODE_WORDS = /\b(code|codebase|file|files|function|method|class|module|folder|repo|project|app|page|test|tests|component|endpoint|route|script|config|setting|bug|error|import|export|variable|defined|implemented|handled|called|where (?:is|are|does|do)|which file|in this)\b/i;
const NAMEY = /`[^`]+`|\b[\w-]+\.(?:m?[jt]sx?|cjs|py|json|md|sh|css|html|sql|ya?ml|swift|go|rs)\b|\b[a-z]+[A-Z]\w*\b|\b\w+_\w+\b|\b\w+\(\)/;
export function aboutTheCode(text) {
  const t = String(text ?? '');
  if (isSmallTalk(t)) return false;
  if (asksForWork(t)) return true;
  return CODE_WORDS.test(t) || NAMEY.test(t);
}
const FILE_NAMED = /(?<![\w/.~:-])(?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*\.(?:m?[jt]sx?|cjs|mts|cts|py|json|md|sh|css|html|sql|ya?ml|swift|go|rs|java|rb|php|vue|svelte|toml|txt)\b(?![\w/])/g;
// Full paths into `base` that a text names, spaces and all ("/Users/x/Desktop/agent docs/report.html"):
// found from where the folder's own path (or its ~ form) appears, up to a file's extension.
export function fullPathsIn(text, base, home = homedir()) {
  const t = String(text ?? '');
  const out = new Set();
  for (const form of [base, base.startsWith(`${home}/`) ? `~${base.slice(home.length)}` : null].filter(Boolean)) {
    for (let i = t.indexOf(form); i >= 0; i = t.indexOf(form, i + 1)) {
      const m = /^\/[^\n`'"]*?\.(?:m?[jt]sx?|cjs|py|json|md|sh|css|html?|sql|ya?ml|csv|tsv|txt|pdf|png)\b/.exec(t.slice(i + form.length));
      if (m) out.add(`${base}${m[0]}`);
    }
  }
  return [...out];
}
export const filesInAnswer = (text) => [...new Set(String(text ?? '').match(FILE_NAMED) ?? [])].filter((p) => !/^(NOTES|RULES|SKILLS|Rules)\//.test(p));
// The words to search for, from the request: its names first (a file, an identifier), then its longest words.
function searchWords(text) {
  const t = String(text ?? '');
  const names = [...t.matchAll(/`([^`]+)`|\b([\w-]+\.[a-z]{1,5})\b|\b([a-z]+[A-Z]\w*|\w+_\w+)\b/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  const words = (t.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? []).filter((w) => !/^(where|which|there|about|would|could|should|their|these|those|thing|things|while|other|before|after|every|being|without)$/.test(w)).sort((a, b) => b.length - a.length);
  return [...new Set([...names, ...words])].slice(0, 3);
}

// Your answer to "is it right?" after a page is saved (askPage): it looks good (the turn stops),
// check it, or anything else, which goes to the model ("looks good but make the total bold").
export const CHECK_IT = 'Check it for me: buttons, phone, dark mode';
export const looksGood = (text) => /^\W*(looks? (good|great|fine|right|perfect)|good|great|perfect|fine|ok|okay|yes|yep|y|done|thanks?|thank you|all good|nice|love it|it'?s (good|right|fine|perfect))\b/i.test(text ?? '')
  && !/\b(but|except|change|make|add|fix|move|remove|bigger|smaller)\b/i.test(text ?? '');
export const wantsCheck = (text) => /^\W*(check( it)?|test( it)?|please check|run the check)\b/i.test(text ?? '');
// The files a page links by a relative path, its scripts and style sheets, that are not there
// yet: the page is not finished while one is missing (savedPage).
export function missingParts(html, dir) {
  const out = [];
  for (const [tag] of String(html ?? '').matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const link = /^<link/i.test(tag);
    if (link && !/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) continue;
    const p = new RegExp(`\\b${link ? 'href' : 'src'}\\s*=\\s*["']([^"'#?]+)`, 'i').exec(tag)?.[1]?.trim();
    if (!p || /^(?:[a-z][\w+.-]*:|\/)/i.test(p)) continue; // a web address, data:, or from the site's root
    if (!existsSync(join(dir, p))) out.push(p);
  }
  return out;
}

// An answer that says the checks all passed or that it works (4 Oct 2026: "All 24 formulas passed" and
// "the calculator validated every formula" after a run that printed "22 passed, 2 failed", exit code 1).
export function claimsAllGood(text) {
  const t = String(text ?? '').replace(/```[\s\S]*?```/g, ' ');
  return /\b(all (?:\d+ |of (?:the|them|my|your) )?(?:[\w-]+ ){0,2}(?:pass(?:ed|es)?|work(?:s|ed)?|succeed(?:ed|s)?|validated|verified|match(?:ed|es)?|are green|check(?:ed)? out)|every (?:[\w-]+ ){0,3}(?:pass(?:ed|es)?|works?|validated|verified|matched|checks? out)|(?:validated|verified|confirmed) (?:every|all)|everything (?:pass(?:ed|es)?|works?|checks out|is correct)|no (?:failures|errors|failing)|100 ?% (?:pass|correct|of))/i.test(t);
}
// A reply that says it found or has what it needs (it read the math out of a page it had seen only the
// outline of: "Good — I found the math. The report page has all the formulas built right into it.").
export function claimsFound(text) {
  return /\b(i (?:have |'ve )?found|found (?:the|all|every|it|them)|got (?:all|the|everything)|i now have|now i have|i have (?:all|everything|a (?:good|clear|full|complete|comprehensive) (?:picture|view|idea|list))|have all the)\b/i.test(String(text ?? ''));
}
// An answer that names what blocked it (a login, a page or file not there): it did not hide it.
const MENTIONS_WALL = /\b(log ?in|sign ?in|sign ?up|login|token|auth\w*|password|blocked|not (?:there|found|open)|missing|does not exist|doesn't exist|could ?n[o'’]t (?:reach|open|get|find|read)|unable to (?:reach|open|get|find|read)|40[134]|5\d\d)\b/i;
// A request with several asks ("analyze the link… can we use the calculator…? can you check? can you
// take all of the formulas… and test them all?"): two questions or more, or a list of things to do.
export function severalAsks(text) {
  const t = String(text ?? '');
  return (t.match(/\?/g) ?? []).length >= 2 || (t.match(/^\s*(?:\d+[.)]|[-*•])\s+\S/gm) ?? []).length >= 2 || (t.length > 120 && (t.match(/\b(?:and then|then|also|after that|as well as)\b/gi) ?? []).length >= 2);
}
// The run of a check for the facts: its command's last line (a heredoc script ends with the line that runs it).
const runLine = (cmd) => String(cmd ?? '').trim().split('\n').map((l) => l.trim()).filter(Boolean).pop()?.slice(0, 140) ?? '';
const countLine = (out) => String(out ?? '').split('\n').map((l) => l.trim()).reverse().find((l) => /\b\d+ (?:passed|failed|passing|failing)\b|\b\d+\s*(?:\/|of)\s*\d+ (?:passed|pass|ok)\b/i.test(l))?.slice(0, 160) ?? '';

// A request that wants its file on the Desktop (flows/words.mjs, where the sorting uses it too).
export { wantsDesktop };
// An answer that holds code to put in a file (a fenced block of three lines or more) instead of a change.
const writesCodeInstead = (text) => /```[^\n]*\n(?:[^\n]*\n){3,}[\s\S]*?```/.test(String(text ?? ''));

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
// Tokens as the screen says them: 812, 6.1k.
const kTok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

// What a Write cut off at the reply limit had sent of its content: the whole lines, as
// text, when there are enough of them to be worth keeping (else null). The arguments
// stop mid-string, so they are read up to the last line break that arrived.
export const KEEP_FROM = 20;
export function keptPart(args) {
  const raw = String(args ?? '');
  const m = /"content"\s*:\s*"/.exec(raw);
  if (!m) return null;
  const rest = raw.slice(m.index + m[0].length);
  // The last \n that is an escape of its own (an even run of backslashes before it).
  let at = -1;
  for (let i = rest.lastIndexOf('\\n'); i >= 0; i = rest.lastIndexOf('\\n', i - 1)) {
    let b = 0;
    for (let j = i - 1; j >= 0 && rest[j] === '\\'; j--) b++;
    if (b % 2 === 0) { at = i; break; }
  }
  if (at < 0) return null;
  let content;
  try { content = JSON.parse(`"${rest.slice(0, at)}"`); } catch { return null; }
  const lines = content.split('\n').length;
  return lines >= KEEP_FROM ? { content, lines } : null;
}
// What the model is told once the cut-off Write's whole lines are saved.
export function keptWriteNote(path, kept) {
  const tail = kept.content.split('\n').slice(-3).join('\n');
  return `Your Write of ${path} ran out of room before the end. Agentic Coder saved what had arrived: its first ${kept.lines} lines, which end with:\n${tail}\nThe file is unfinished on purpose. Carry on from line ${kept.lines + 1}: add the rest with Edit, old_text = those last lines exactly as above and new_text = the same lines followed by the next part. Keep each part well under 100 lines, and do not write the file again from the start.`;
}

const inParts = (file) => `Build ${file} in parts instead. First Write ${file} with only a short skeleton: its opening, empty sections marked with comments, and its closing. Then add one section at a time with Edit, each part well under 100 lines. Start with the skeleton now.`;
function cutCallNote(name, path) {
  const file = path || 'the file';
  if (name === 'Write' || name === 'Edit') {
    return `Your ${name} call ran out of room before the end, so nothing was written: the whole content does not fit in one reply. ${inParts(file)}`;
  }
  return `Your ${name} call ran out of room before the end and was not run. Do it again in smaller pieces.`;
}
// A reply cut at the limit with nothing of it arrived: Ollama holds a tool call back until it is
// whole, so a call cut off never comes at all (nor its path).
const emptyCutNote = () => `Your reply reached the reply limit before it ended, and none of it arrived: most likely a file too long for one reply. ${inParts('the file')}`;

// Where a tool call written as text starts: <tool_call> (Qwen's kind and the
// 27B's), <ifm|tool_calls> / <ifm|tool_call> (K2 Horizon's). The text before
// it is what the model said; the stop words keep a text-only reply from one.
export const CALL_MARK = /<tool_call>|<ifm\|tool_calls?>/;
// What a service says when it cannot read the tool call a model wrote (Ollama's tool parsers).
const CALL_UNREADABLE = /\b(?:XML syntax error|error parsing tool call|failed to parse (?:the )?tool call|unexpected end of JSON input)\b/i;
const CALL_STOPS = ['<tool_call>', '<ifm|tool_calls>', '<ifm|tool_call>'];
export const beforeCall = (s) => String(s ?? '').split(CALL_MARK)[0];

// Thinking that came out in the answer's text: a reply that opens with <think> (after Qwen's own
// <|mask_start|> and the like), or holds those tokens. { thought, text } with the thinking taken out
// (to its </think>, or to the end when it never closes), or null when there is none.
const MASK = /<\|mask_(?:start|end)\|>/g;
export function leakedThinking(text) {
  const s = String(text ?? '');
  const masked = /<\|mask_(?:start|end)\|>/.test(s);
  const t = s.replace(MASK, '');
  const at = t.search(/<think>/);
  if (at < 0 || (at > 0 && t.slice(0, at).trim() && !masked)) return masked ? { thought: '', text: t.trim() } : null;
  const end = t.indexOf('</think>', at);
  const thought = (end < 0 ? t.slice(at + 7) : t.slice(at + 7, end)).trim();
  const rest = `${t.slice(0, at)}${end < 0 ? '' : t.slice(end + 8)}`.trim();
  return { thought, text: rest };
}

// Tool-call text written into a file by mistake: a line that is only a call's
// tag. On 1 Oct Bonsai closed a Write's content with </content> instead of
// </parameter>, so its next call (<tool_call><function=Bash>… ls) was saved at
// the end of the page and showed beside the card. A file that already has such
// a line (a parser's notes, its tests) keeps its own: `before` is the text it
// replaces. Returns { line, text } of the first one, or null.
const CALL_LINE = /^[ \t]*(<\/?tool_call>|<\/?ifm\|tool_calls?>|<function=[^>\s]+>|<\/function>|<parameter=[^>\s]+>|<\/parameter>)[ \t]*$/;
export function leakedCall(text, before = '') {
  const had = new Set(String(before ?? '').split('\n').map((l) => l.trim()).filter((l) => CALL_LINE.test(l)));
  const lines = String(text ?? '').split('\n');
  const i = lines.findIndex((l) => CALL_LINE.test(l) && !had.has(l.trim()));
  return i < 0 ? null : { line: i + 1, text: lines[i].trim() };
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
  // K2 Horizon's (its chat template): inside <ifm|tool_calls>, each call is
  //   <ifm|tool_call>Name\n<ifm|arg_key>k</ifm|arg_key>\n[<ifm|arg_type>t</ifm|arg_type>\n]<ifm|arg_value>v</ifm|arg_value>\n…</ifm|tool_call>
  // (xml, its default, and xml_typed), or <ifm|tool_call>{"name": …, "arguments": {…}}</ifm|tool_call> (json).
  // A text value is written as it is; anything else as JSON (the type says which when given).
  const k = /<ifm\|tool_call>([\s\S]*?)<\/ifm\|tool_call>/.exec(text);
  if (k) {
    const at = /<ifm\|tool_calls>/.exec(text);
    const before = text.slice(0, at && at.index < k.index ? at.index : k.index).trim();
    const body = k[1].trim();
    if (body.startsWith('{')) {
      try {
        const j = JSON.parse(body);
        if (typeof j.name === 'string') return { name: j.name, args: typeof j.arguments === 'string' ? j.arguments : JSON.stringify(j.arguments ?? {}), before };
      } catch {}
      return null;
    }
    const name = /^([^\s<]+)/.exec(body)?.[1];
    if (!name) return null;
    const args = {};
    const re = /<ifm\|arg_key>([\s\S]*?)<\/ifm\|arg_key>\s*(?:<ifm\|arg_type>([\s\S]*?)<\/ifm\|arg_type>\s*)?<ifm\|arg_value>([\s\S]*?)<\/ifm\|arg_value>/g;
    for (const p of body.matchAll(re)) {
      const type = p[2]?.trim();
      args[p[1].trim()] = type === 'string' ? p[3] : paramValue(p[3]);
    }
    return { name, args: JSON.stringify(args), before };
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

// A tool call written as bare JSON, with no tags: what older models on an Ollama
// service write when their template does not turn it into a real call (Qwen 2.5
// Coder: {"name": "Read", "arguments": {…}}; Llama 3.1: {"name": …, "parameters": …}),
// alone or in a ```json fence, as the whole reply or its last part. Only a name of
// one of the tools it was given counts, so a JSON example in an answer is not run.
// names: the tools' names. Returns { name, args, before } or null.
export function bareCallInText(text, names = []) {
  const t = String(text ?? '').trim();
  if (!t.endsWith('}') && !t.endsWith('```')) return null;
  const fenced = /```(?:json)?\s*(\{[\s\S]*\})\s*```\s*$/.exec(t);
  let at = fenced ? fenced.index : -1;
  let body = fenced?.[1];
  if (!body) {
    // The last top-level { … } of the text: from each { back from the end, the first that parses.
    // (at most 40 tries, from the end; the outermost that parses wins)
    for (let i = t.lastIndexOf('{'), n = 0; i >= 0 && n < 40; i = i ? t.lastIndexOf('{', i - 1) : -1, n++) {
      try { JSON.parse(t.slice(i)); body = t.slice(i); at = i; } catch { /* not this one */ }
    }
  }
  if (!body) return null;
  let j;
  try { j = JSON.parse(body); } catch { return null; }
  const fn = j?.function && typeof j.function === 'object' ? j.function : j;
  const a = fn?.arguments ?? fn?.parameters ?? fn?.args ?? fn?.input;
  // {"tool": "mcp__shop__sales_report", "arguments": {…}}: an MCP call the way the Mcp tool takes
  // one, written out (Qwen3.6, 3 Oct 2026). By the tool's own name when it was given one, else
  // through Mcp, which reaches every MCP tool of the conversation.
  if (typeof fn?.tool === 'string' && typeof fn?.name !== 'string' && isMcpCall(fn.tool) && (a === undefined || typeof a === 'object' || typeof a === 'string')) {
    const before = t.slice(0, at).trim();
    if (names.includes(fn.tool)) return { name: fn.tool, args: typeof a === 'string' ? a : JSON.stringify(a ?? {}), before };
    if (names.includes(MCP_TOOL)) return { name: MCP_TOOL, args: JSON.stringify(fn), before };
  }
  // A name of its own for one of the tools ("read_files", "run_command": Qwen3.6, 3 Oct 2026), or none:
  // a reply that is only the arguments, of a tool that only looks ({"file": "convert.mjs"}).
  const name = typeof fn?.name === 'string' ? toolNamed(fn.name, names) : at === 0 || fenced ? argsTool(fn, names) : null;
  if (!name || (a !== undefined && typeof a !== 'object' && typeof a !== 'string')) return null;
  const args = typeof fn?.name === 'string' ? a : fn;
  return { name, args: typeof args === 'string' ? args : JSON.stringify(args ?? {}), before: t.slice(0, at).trim() };
}

// The tool a call written as text means: its own name, or a name models use for it.
const TOOL_WORDS = { Read: ['read', 'readfile', 'readfiles', 'openfile', 'cat', 'view', 'viewfile'], List: ['list', 'ls', 'listfiles', 'listdir', 'listdirectory', 'glob'], Search: ['search', 'grep', 'searchfiles', 'find', 'findinfiles', 'searchcode'], Edit: ['edit', 'editfile', 'replace', 'strreplace', 'strreplacebasededittool'], Write: ['write', 'writefile', 'createfile'], Bash: ['bash', 'shell', 'run', 'runcommand', 'execute', 'exec', 'terminal'], TodoWrite: ['todowrite', 'todo', 'todos', 'plan'] };
function toolNamed(name, names) {
  if (names.includes(name)) return name;
  const k = name.toLowerCase().replace(/[^a-z]/g, '');
  const hit = Object.entries(TOOL_WORDS).find(([, ws]) => ws.includes(k))?.[0];
  return hit && names.includes(hit) ? hit : null;
}
// A reply that is only a tool's arguments: only the tools that look, so text never runs a command.
function argsTool(o, names) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const keys = Object.keys(o);
  const is = (...ks) => keys.length && keys.every((x) => ks.includes(x));
  const tool = is('path', 'file', 'file_path', 'filename', 'paths', 'files', 'offset', 'limit', 'find') && keys.some((x) => /^(path|file|file_path|filename|paths|files)$/.test(x)) ? 'Read'
    : is('pattern', 'path', 'glob') && keys.includes('pattern') ? 'Search' : null;
  return tool && names.includes(tool) ? tool : null;
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
// How long a conversation's first message waits for MCP servers that are still starting.
const MCP_WAIT_MS = 8000;
// A helper's instructions: the conversation's (the project, its rules), then what a helper is.
// own: one of your helper agent files (prompt-files.mjs parseHelperAgent): its instructions follow,
// and it reports as an explore helper does when it only reads.
export function helperPrompt(system, kind, own = null) {
  const looks = own ? own.tools === 'look' : kind === 'explore';
  const base = `${system}\n\n# You are a helper\nThe main agent handed you one task. You see only this task, not its conversation, and you cannot ask the user anything. Work it out with your tools, then end with a short report for the main agent: ${looks ? 'what you found, with file:line or the page it came from. You only read: do not change anything; say what should change instead.' : 'what you changed (files and lines) and what you checked, or what stopped you.'}`;
  return own ? `${base}\n\n# Your job: ${own.kind}\nThe user wrote these instructions for you (${own.name}.md):\n${own.body}` : base;
}

// The tools one of your helper agents is given: look = an explore helper's; all = a general
// helper's (null: no filter); a list = those of the app's tools, in any case (others are left out).
export function helperToolFilter(tools, names) {
  if (tools === 'look') return EXPLORE_TOOLS;
  if (!Array.isArray(tools)) return null;
  const want = new Set(tools.map((t) => t.toLowerCase()));
  // A name ending in * names several (mcp__github__get_*: every tool of that server that starts so).
  const starts = [...want].filter((t) => t.endsWith('*')).map((t) => t.slice(0, -1));
  return new Set(names.filter((n) => want.has(n.toLowerCase()) || starts.some((s) => n.toLowerCase().startsWith(s))));
}
// The context a helper agent on another model of the service is loaded at (as /subagents' helpers).
const OWN_HELPER_CTX = 32_768;

// The web addresses (http or https) a request names, each once.
const webAddresses = (text) => [...new Set(String(text ?? '').match(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi) ?? [])].map((u) => u.replace(/[.,;:!?]+$/, ''));

// What an edit will do, in plain words, for the plan question (questions.mjs).
const planLine = planSaid;

// A test run's counts and the names that fail, or null when the output says neither.
function failsOf(text, failed) {
  const r = readResults(String(text ?? ''), failed ? 1 : 0);
  return r.failed == null ? null : { failed: r.failed, failing: r.failing };
}

// Its plan as it last wrote it with TodoWrite: the whole list goes into its notes when memory
// fills (restartFrom), and a short line comes back every PLAN_EVERY steps (planDue).
const stepText = (t) => String(t?.text ?? t?.content ?? '').replace(/\s+/g, ' ').trim();
function planList(todos) {
  return (todos ?? []).filter(stepText).map((t) => `- [${t.status === 'done' ? 'done' : t.status === 'in_progress' ? 'doing now' : 'to do'}] ${stepText(t).slice(0, 160)}`).join('\n');
}
// task: what a short follow-up ("try again") stands for, said first (4 Oct 2026: the reminder of a
// 29-step message quoted only "try again").
export function requestReminder(request, task = '') {
  const said = (s, n) => { const w = String(s ?? '').replace(/\s+/g, ' ').trim(); return w.length > n ? `${w.slice(0, n - 1)}…` : w; };
  const words = said(request, 400);
  const first = said(task, 400);
  if (!words) return '';
  return first && first !== words ? `(What the user asked: "${first}"; this message, about that: "${words}")` : `(What the user asked, which this message is for: "${words}")`;
}
export function planReminder(todos) {
  const items = (todos ?? []).filter(stepText);
  const left = items.filter((t) => t.status !== 'done');
  if (!left.length) return '';
  const now = left.find((t) => t.status === 'in_progress') ?? left[0];
  const next = left.filter((t) => t !== now);
  const then = next.length ? ` Then: ${next.slice(0, 3).map((t) => `"${stepText(t).slice(0, 80)}"`).join('; ')}${next.length > 3 ? `, and ${next.length - 3} more` : ''}.` : '';
  return `(Your plan: ${items.length - left.length} of ${items.length} steps done. Now: "${stepText(now).slice(0, 120)}".${then} Keep to it, and send TodoWrite when a step is done or the plan changes.)`;
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
  constructor({ url, model, cwd, system, thinking = true, effort, ctx = 32768, mode = 'ask', ask, waitForServer, verify = true, flows = true, maxTries = 8, testTimeoutMs = 120_000, checkIns = CHECK_INS, confirmPlan = true, slots, trimAt = TRIM_AT, fullAt = FULL, maxSteps = MAX_STEPS, bash = null, whenFull = process.env.AGENTIC_WHEN_FULL === 'trim' ? 'trim' : 'notes', rewarm, memory = null, ranker = null, helpers = null, embedder = null, indexDir, search = null, reranker = null, permissions = null, rewind = null, design, thinkBudgetSecs = budgetFromEnv(), way = 'app', hooks = null, web = null, subagents = true, home = homedir(), openPage = null, pageAsk = false, instructions = null, keepProgress = false, mcp = null, userHooks = null, steering = null, lean = false }) {
    super();
    // Who decides (way.mjs): 'app' as before, or 'model'; and the app's checks switched on as
    // hooks for when the model decides (on App they all run, as they always have).
    // The lean harness (way.mjs leanFrom): the model decides, and none of the app's checks run.
    this.lean = Boolean(lean);
    this.way = this.lean ? 'model' : wayOf(way);
    this.hooks = hooksOn(hooks ?? []);
    // /web: { search: 'off' | 'brave' | 'tavily', fetch, claude } (null: no web tools, as in a practice run).
    this.web = web;
    // The Agent tool (helpers): "subagents": false in settings.json leaves it out.
    this.subagents = subagents !== false;
    // /mcp: the hub of the user's MCP servers (tools/mcp.mjs), or null (a practice run, a test): no MCP tools.
    this.mcp = mcp;
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
    // The home folder its Desktop is in (a test gives a folder of its own),
    // and the screen's way to open a finished page in the browser: given by
    // the app only, so coding -p and the tests never open or offer anything
    // (deliverDesktop).
    this.home = home;
    this.openPage = openPage;
    // A loop's run (/loop): changes that leave fewer tests failing, and none newly failing, stay (putBackWhy).
    this.keepProgress = Boolean(keepProgress);
    // steering() → the notes typed to a loop's run while it works (loop-run.mjs): each goes on the end of
    // the next step's result, so it is read now rather than when the turn ends ('steered' says so).
    this.steering = steering;
    // Someone is at the screen to look at a saved page (askPage): the app says so; coding -p,
    // the benches and the tests check pages by themselves, as before.
    this.pageAsk = pageAsk;
    // The design examples and the layout check (design.mjs): settings.json's
    // "design" as saved; AGENTIC_DESIGN, AGENTIC_DESIGN_SETS and AGENTIC_LAYOUT win over it.
    this.designSaved = design ?? {};
    this.lessons = []; // what happened in each turn, for the next save (lessons.mjs)
    // When Agentic Coder started the server itself it has two slots: the
    // conversation stays in 0, side requests (sorting, tries) use 1.
    this.slots = slots ?? null;
    // How this project runs its tests; used to check a change before calling it done.
    this.testCmd = verify ? testCommand(cwd) : null;
    this.messages = [{ role: 'system', content: leanPrompt(wayPrompt(system, this.way), this.lean) }];
    this.conversation = newConversation(); // its own first line on an Ollama service (client.mjs ownStart)
    this.workingInstructions = readInstructions().sections;
    // The instructions set (prompt-files.mjs): a prompt built for the other set than this
    // model's (the app and coding -p build the local one) is built again here, once. A helper
    // gets its parent's row, so the prompt it was given (the parent's set) is kept.
    this.instructionsSet = instructions ?? null;
    this.rulesSetUsed = promptSetOf(system);
    this.promptStampUsed = this.rulesSetUsed === this.rulesSet() ? this.promptStamp() : null;
    if (this.promptStampUsed === null && typeof system === 'string') this.refreshNotes();
    this.allowedPrefixes = new Set();
    this.readFiles = new SeenFiles(); // files read (or written) in this conversation
    // Background commands (Bash with background: true): each one's end is news for the model (jobEnded).
    this.jobs = new Jobs({ onEnd: (job) => this.jobEnded(job) });
    this.jobNews = []; // jobs that ended by themselves, not yet told
    // Your own hooks (user-hooks.mjs UserHooks): commands of yours at seven moments, beside the app's checks.
    this.userHooks = userHooks;
    this.sessionContext = null; // what a SessionStart hook printed, for the next message
    this.todos = null;
    this.ctxUsed = tokensOf(this.messages[0].content) + 1200; // system + tool definitions, until the server reports
    this.busy = false;
    this.sending = false;
    this.stats = { tps: null, pps: null, outTokens: 0, requests: 0 };
  }

  // Which set (prompt-files.mjs rulesSetOf): null follows settings.json "instructions" (auto by
  // default: the remote set for a model on another machine). Read before each message, so a switch
  // of model or of the saved choice applies then. A helper is handed its parent's set.
  instructionsSet = null;
  rulesSet() { return rulesSetOf(this.instructionsSet, this.model); }
  // The memory goes with the rules when it is on, as it did when the conversation started
  // (App.jsx, headless.mjs): a practice run without it never reads the user's own.
  notesFrom() { return { memory: Boolean(this.memory), home: this.memory?.home }; }
  // The prompt of this way: the model's own tool lines when it decides (way.mjs wayPrompt).
  setSystem(system) { this.messages[0] = { role: 'system', content: leanPrompt(wayPrompt(system, this.way), this.lean) }; }
  // The tools the model is offered: the app's eight, and its own five when it decides.
  tools() {
    const agents = this.agentsOn();
    const all = toolSchemas(this.way, this.webTools(), { agents, screen: this.screenOn(), helpers: agents ? this.helperAgents() : [] });
    // CodeSearch only when it can run (4 Oct 2026: qwen3-coder-next called it twice, was told twice
    // "the code search is off here", and those two errors helped stop it at five in a row).
    // The same for the four never called in 40 runs on a service (5 Oct 2026): Map not in the home
    // folder, Rename and TestFirst in a folder of code, Remember with a memory. The folder is looked at
    // once a conversation, so the list does not move under it; a call to one left out still runs.
    const here = this.toolPlace?.cwd === this.cwd ? this.toolPlace : (this.toolPlace = { cwd: this.cwd, home: isHomeFolder(this.cwd), code: isCodeProject(this.cwd) });
    const off = new Set([
      ...(this.codeSearchOff() ? ['CodeSearch'] : []),
      ...(here.home ? ['Map'] : []),
      ...(here.code ? [] : ['Rename', 'TestFirst']),
      ...(this.memory ? [] : ['Remember']),
    ]);
    const can = (t) => !off.has(t.function.name);
    const own = (this.toolFilter ? all.filter((t) => this.toolFilter.has(t.function.name)) : all).filter(can);
    // The tools of the user's MCP servers go last, in one order, so the list above them never moves.
    const mcp = this.mcpDefs();
    return mcp.length ? [...own, ...mcp] : own;
  }
  // ---- MCP tools (agent/mcp.mjs; the servers themselves: tools/mcp.mjs) ----
  // A conversation's MCP tools are taken once, before its first message, and kept until the next
  // conversation: a server that changes its tools, or one that connects late, would otherwise
  // change the top of the prompt, and a model on a service would read the whole conversation
  // again (15.7 s for 15.6k tokens, measured 3 Oct 2026). What you change yourself in /mcp
  // (mcpStale) is taken at your next message, with a line saying so.
  mcpFrozen = null;
  mcpStale = false;
  mcpPrints = new Map(); // "don't ask again this session": tool id → the fingerprint it was given for
  // settled: only when no server is still starting (before the model's warm-up, so what it reads
  // ahead holds the tools; a server not there yet must not be shut out of the conversation for that).
  async mcpTake({ settled = false } = {}) {
    if (!this.mcp || this.isHelper || (this.mcpFrozen && !this.mcpStale)) return;
    if (settled && this.mcp.status().some((s) => s.state === 'starting')) return;
    const late = await this.mcp.ready(MCP_WAIT_MS);
    const entries = this.mcp.catalog();
    const stamp = catalogStamp(entries);
    const had = this.mcpFrozen?.stamp ?? catalogStamp([]);
    this.mcpStale = false;
    this.mcpFrozen = { entries, stamp, notes: this.mcp.notes?.() ?? {}, connectors: (this.mcp.connectors?.() ?? []).map(({ name, url }) => ({ name, url })) };
    this.mcpPlans = new Map();
    if (late.length) this.emit('note', { text: `MCP: ${late.join(', ')} ${late.length === 1 ? 'is' : 'are'} still starting, so ${late.length === 1 ? 'its' : 'their'} tools are not in this conversation. They join at the next one (/clear), or when you save in /mcp.`, tone: 'warn' });
    if (had !== stamp && this.messages.length > 1) this.emit('note', { text: 'The MCP tools changed (/mcp): the model reads the conversation again with the new list.', tone: 'dim' });
    // The MCP guide and TOOLS.md's MCP lines are in the instructions only while a tool is offered
    // (a prompt this app built; a caller's own is left as it is).
    if ((this.mcpInPrompt ?? '') !== this.mcpPrompt() && typeof this.messages[0]?.content === 'string' && this.messages[0].content.includes('\nTool use\n')) this.refreshNotes();
  }
  // The tools a retry offers (mcpFocus: requestHits of the request): the ones the request's note
  // named, by their own definitions, and Mcp for those reached through it; nothing else, so "that tool
  // is not available" cannot be the answer. Only for that one step: the next has the whole list again.
  mcpFocusTools(hits) {
    const names = new Set(hits.flatMap((h) => h.tools.map((e) => e.name)));
    const gate = hits.some((h) => h.gated || !h.tools.length);
    const defs = this.mcpDefs().filter((t) => names.has(t.function.name) || (gate && t.function.name === MCP_TOOL));
    return defs.length ? defs : this.tools();
  }
  // The MCP tools this agent may use, of the conversation's list: every one that is on; an explore
  // helper those the user marked as reading; one of the user's helper agents those its file names.
  // off: with the ones switched off too (a call to one is told it is off, not that it does not exist).
  mcpEntries({ off = false } = {}) {
    // On the Claude API a server handed to Anthropic's connector is Anthropic's to call, not this app's.
    const theirs = endpointOf(this.url)?.kind === 'claude' ? new Set((this.mcpFrozen?.connectors ?? []).map((s) => s.name)) : null;
    const all = (this.mcpFrozen?.entries ?? []).filter((e) => (off || e.on) && !theirs?.has(e.server));
    if (!this.toolFilter) return all;
    return this.toolFilter === EXPLORE_TOOLS ? all.filter((e) => e.reads) : all.filter((e) => this.toolFilter.has(e.name));
  }
  mcpOn() { return this.mcpEntries().length > 0; }
  // The servers Anthropic's connector calls in this conversation (the Claude API only), each with its token as it is now.
  mcpConnectors() {
    if (endpointOf(this.url)?.kind !== 'claude' || !this.mcpFrozen?.connectors?.length || this.isHelper) return [];
    const now = new Map((this.mcp?.connectors?.() ?? []).map((s) => [s.name, s]));
    return this.mcpFrozen.connectors.map((s) => now.get(s.name) ?? s);
  }
  // What the instructions say of the MCP tools: '' (none on), or the servers' list (agent/mcp.mjs
  // mcpBrief), which also brings TOOLS.md's MCP lines.
  mcpPrompt() {
    const entries = this.mcpEntries();
    if (!entries.length) return '';
    return mcpBrief(entries, { listed: this.mcpListed(), notes: this.mcpFrozen?.notes ?? {} });
  }
  // The tools listed inside the Mcp tool (by name only), of this conversation's plan.
  mcpListed() {
    this.mcpDefs();
    return this.mcpPlans?.get(`${endpointOf(this.url)?.kind === 'claude' ? 'claude' : 'other'}|${this.ctx}`)?.plan?.listed ?? [];
  }
  // As tool definitions (agent/mcp.mjs mcpPlan): by name, by name and one line with the Mcp tool,
  // or deferred on the Claude API. Worked out once per conversation, kind of server and context
  // size, so the list a model is sent stays the same, letter for letter (another context size, or
  // another kind of server, has the model read everything again anyway).
  mcpDefs() {
    if (!this.mcpFrozen) return [];
    const kind = endpointOf(this.url)?.kind === 'claude' ? 'claude' : 'other';
    const key = `${kind}|${this.ctx}`;
    const plans = (this.mcpPlans ??= new Map());
    if (!plans.has(key)) { const plan = mcpPlan(this.mcpEntries(), { kind, ctx: this.ctx }); plans.set(key, { plan, defs: mcpToolDefs(plan, { kind }) }); }
    return plans.get(key).defs;
  }
  // The Agent tool (a helper, tools.mjs AGENT_TOOL_DEF): when the model decides, on the Claude
  // API, and on the remote set once you have a helper agent file (prompt-files.mjs ownDir);
  // never inside a helper; "subagents": false in settings.json leaves it out.
  agentsOn() { return !this.isHelper && this.subagents !== false && (this.way === 'model' || endpointOf(this.url)?.kind === 'claude' || this.helperAgents().length > 0); }
  // Your helper agents (prompt-files.mjs readHelperAgents): read from their folder each time, so a
  // new file is offered at the next step. None inside a helper, none on the local set.
  helperAgents() { return this.isHelper ? [] : readHelperAgents(this.rulesSetUsed ?? this.rulesSet()); }
  // The Screen tool (tools/screen.mjs): on a Mac, for a model that can look at pictures now or
  // once its vision is turned on (visionOn); "screen": false in settings.json leaves it out.
  // mayLook: the app says whether this model can turn its vision on (App.jsx).
  screenOn() { return process.platform === 'darwin' && this.screen !== false && !this.isHelper && Boolean(this.canSee || this.mayLook?.()); }
  // The web tools on offer (/web): WebSearch with a search service, WebFetch with reading pages.
  // On the Claude API both are Anthropic's own (claude.mjs), unless /web's Claude row is off.
  webTools() {
    const w = this.web;
    if (!w) return null;
    if (endpointOf(this.url)?.kind === 'claude') return w.claude === false ? null : { search: 'claude', fetch: true };
    return { search: w.search && w.search !== 'off' ? w.search : null, fetch: w.fetch !== false };
  }
  // Whether one of the app's checks runs (way.mjs HOOKS): always on App, when switched on on Model.
  // On the lean harness (way.mjs) none runs.
  hook(id) { return this.lean ? false : OPT_IN_HOOKS.has(id) ? this.hooks.has(id) : this.way !== 'model' || this.hooks.has(id); }
  // /subagents (helper-models.mjs): the helper model for a job on an Ollama service, as
  // the endpoint override a call takes, or undefined (the job is off, its model is the
  // main one, or this is not an Ollama service). helperJobs is set by the app.
  helperUse(id) { return !this.isHelper && endpointOf(this.url)?.ollama ? useOf(this.helperJobs?.[id], id) : undefined; }
  sideUse() { return this.helperUse('side'); }
  // /effort's Who decides row: the next message goes the new way. The prompt and the tools
  // change with it, so the next reply reads the instructions again (the app warms them up).
  setWay(way, hooks) {
    // Lean is the model deciding: while it is on, Who decides stays Model (/hooks full ends it).
    const next = this.lean ? 'model' : wayOf(way);
    if (hooks !== undefined) this.hooks = hooksOn(hooks ?? []);
    if (next === this.way) return false;
    const before = tokensOf(this.messages[0].content);
    this.way = next;
    this.messages[0] = { role: 'system', content: wayPrompt(this.messages[0].content, next) };
    this.ctxUsed += tokensOf(this.messages[0].content) - before;
    this.emit('way', next);
    return true;
  }
  // The lean harness on or off (/hooks lean · /hooks full): from the next message. On, Who decides is Model.
  setLean(on) {
    const next = Boolean(on);
    if (next === this.lean) return false;
    this.lean = next;
    if (next && this.way !== 'model') this.setWay('model');
    const before = tokensOf(this.messages[0].content);
    this.messages[0] = { role: 'system', content: leanPrompt(this.messages[0].content, next) };
    this.ctxUsed += tokensOf(this.messages[0].content) - before;
    this.emit('lean', next);
    return true;
  }
  // /effort's Rules room and Up-front reading: 0 = auto, a share of the context (room.mjs).
  // /effort's Look first (look.mjs): 'auto' follows Effort, 'off', or a number of seconds. The app
  // and coding -p set it from /effort (auto by default); a bare Agent (tests, the practice runs) does not look first.
  look = 'off';
  // /remote's Clean up at (settings.json "remoteCleanAt", 4 Oct 2026): on a model on another machine the
  // memory is cleaned up (notes, then a fresh start from them) as if it held only this many tokens. The
  // model keeps its whole memory, so one big file still fits. 0: its whole memory, as before.
  workRoom = 0;
  get cleanCap() { return this.workRoom > 0 && this.model?.remote ? Math.min(this.ctx, this.workRoom) : this.ctx; }
  get lookSecsNow() { return this.lean ? 0 : lookSecs(this.look, { thinking: this.thinking, effort: this.effort }); }
  rulesRoom = 0;
  upFront = 0;
  get notesRoomNow() { return this.rulesRoom || notesRoom(this.ctx); }
  get upFrontNow() { return this.upFront || upFrontFor(this.ctx); }
  // The rules or the context changed what the room comes to: the rules are read again once, before the next message.
  // So is the set (/effort's Instructions row, or a model on another machine now): said in a note.
  syncRules() {
    if (this.rulesSetUsed !== undefined && this.rulesSetUsed !== this.rulesSet()) {
      this.refreshNotes();
      this.emit('note', { text: this.setNote(), tone: 'dim' });
      return;
    }
    if (this.notesRoomUsed === undefined || this.notesRoomUsed === this.notesRoomNow) return;
    this.refreshNotes();
  }
  setNote() {
    return this.rulesSetUsed === 'remote' ? 'Remote instructions (terminal/rules/remote): HARNESS.md, TOOLS.md, the guides and the skills, for a model on another machine.' : 'Local instructions (terminal/rules), as on this Mac.';
  }
  // The rules changed (/rules): the next message reads them. The instructions
  // are read again once, as after a move to another folder.
  refreshNotes() {
    const before = tokensOf(this.messages[0].content);
    this.notesRoomUsed = this.notesRoomNow;
    this.promptStampUsed = this.promptStamp();
    this.rulesSetUsed = this.rulesSet();
    this.setSystem(systemPrompt({ cwd: this.cwd, notes: projectNotes(this.cwd, this.notesRoomUsed, this.notesFrom()).text, git: gitSummary(this.cwd), instructions: this.workingInstructions, set: this.rulesSetUsed, agents: this.agentsOn(), mcp: (this.mcpInPrompt = this.mcpPrompt()), web: Boolean(this.webTools()?.fetch) }));
    this.ctxUsed += tokensOf(this.messages[0].content) - before;
  }
  // The prompt files as they are now: the rules files (AGENTS.md or CLAUDE.md, whole, without
  // the memory), TOOLS.md's Tool use lines and SKILLS.md's list (prompt-files.mjs). A change to
  // any of them, saved in the hub or anywhere else, is read before the next message. With them
  // the set this model gets, and on the remote set HARNESS.md and the guides' list.
  promptStamp() {
    try {
      const set = this.rulesSet();
      const agents = this.agentsOn();
      const mcp = this.mcpInPrompt ?? '';
      const remote = set === 'remote' ? `${JSON.stringify(harnessOf())}\u0000${guidesList(readGuides(set, { agents, mcp: Boolean(mcp) }), { path: guidePath(this.cwd) })}` : '';
      return `${set}\u0000${set === 'remote' ? agents : ''}\u0000${projectNotes(this.cwd, Infinity, { memory: false }).text}\u0000${toolUseFor(set, undefined, { mcp, web: Boolean(this.webTools()?.fetch) })}\u0000${skillsList(readSkills(undefined, set), { path: skillPath(this.cwd) })}\u0000${remote}`;
    } catch { return null; }
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
    this.userHooks?.moveTo(dir);
    this.testCmd = this.verify ? testCommand(dir) : null;
    this.notesRoomUsed = this.notesRoomNow;
    this.rulesSetUsed = this.rulesSet();
    this.setSystem(systemPrompt({ cwd: dir, notes: projectNotes(dir, this.notesRoomUsed, this.notesFrom()).text, git: gitSummary(dir), instructions: this.workingInstructions, set: this.rulesSetUsed, agents: this.agentsOn(), mcp: (this.mcpInPrompt = this.mcpPrompt()), web: Boolean(this.webTools()?.fetch) }));
    this.ctxUsed += tokensOf(this.messages[0].content) - before;
    this.promptStampUsed = this.promptStamp();
    this.readFiles = new SeenFiles();
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
  // The model that compares meanings for the code search: the service's Code search helper
  // (/subagents, helper-models.mjs RemoteEmbedder) when the app set one, else this Mac's.
  searchModel() { return this.searchEmbedder ?? this.embedder; }
  // Why CodeSearch cannot run here, or null when it can.
  codeSearchOff() {
    return !this.helpers.has('rag') ? 'the code search helper (Oracle) is off in /helpers' : !this.searchModel() ? "the small model that compares meanings is off (/effort's Embedder)" : isHomeFolder(this.cwd) ? 'there is no code search of the home folder' : null;
  }
  codeSearch() {
    const embedder = this.searchModel();
    if (!this.helpers.has('rag') || !embedder || isHomeFolder(this.cwd)) return null;
    // It waits while the model answers (a step here, or a focused path's call). Another
    // embedder (the helper switched on or off) starts a new index: their numbers differ.
    if (this.codeIndex?.cwd !== this.cwd || this.codeIndex.embedder !== embedder) this.codeIndex = new CodeIndex(this.cwd, embedder, { ...(this.indexDir ? { dir: this.indexDir } : {}), paused: () => this.answering > 0 || llmCalls.now > 0 });
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
    const home = this.home ?? homedir();
    this.namedFolder = null;
    // Only from the home folder or its Desktop, Documents and Downloads.
    if (!isHomeFolder(this.cwd, home)) return null;
    this.projects ??= findProjects(home);
    this.offered ??= new Set();
    const projects = projectsNamed(text, this.projects, this.cwd);
    // A folder the request names by its path, a code project or not (4 Oct 2026, the owner's pick: ask
    // "Work in that folder?"; either way the checks the home folder turns off work for it: turn.workFolder).
    const named = projects.length ? projects : foldersNamed(text, this.cwd, home);
    this.namedFolder = named.length === 1 ? named[0] : null;
    const found = named.filter((d) => !this.offered.has(d));
    if (!found.length || found.length > 4) return null;
    for (const d of found) this.offered.add(d);
    const tilde = (p) => (p === home ? '~' : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);
    const one = found.length === 1;
    const code = found.some((d) => this.projects.includes(d));
    const question = `${one ? `Work in ${tilde(found[0])}?` : `Work in which ${code ? 'project' : 'folder'}?`} ${code ? 'Agentic Coder then uses its tests and its AGENTS.md, and its' : 'Agentic Coder then starts there:'} commands can only change files there, until /clear.`;
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
  // the text for the model when something is broken, else null. `again`: a
  // look after its fix, which says what is left. `send`: what it finds goes
  // back to the model (the first look, and the second of LAYOUT_ROUNDS).
  // `quiet`: no notes (the look at the end of the turn, see stillBroken).
  async checkLayout(again = false, { quiet = false, send = !again } = {}) {
    if (!designSettings(this.designSaved).check || !(this.turn?.startTexts?.size || this.madePages().length)) return null;
    const pages = pagesToCheck(this.cwd, [...(this.turn.startTexts?.keys() ?? []), ...this.madePages()]);
    if (!pages.length) return null;
    const chrome = findChrome();
    if (!chrome) {
      if (!this.layoutTold) { this.layoutTold = true; this.emit('note', { text: 'Layout check skipped: no headless Chrome on this Mac (Chrome, or Playwright\'s own).', tone: 'dim' }); }
      return null;
    }
    const notes = [];
    const left = [];
    let ran = 0;
    for (const rel of pages) {
      const abs = resolvePath(this.cwd, rel).abs;
      let html = '';
      try { html = readFileSync(abs, 'utf8'); } catch { continue; }
      const server = needsServer(html);
      if (server) { this.emit('note', { text: `Layout check skipped for ${rel}: ${server}.`, tone: 'dim' }); continue; }
      const r = await layoutCheck(abs, { chrome });
      if (r.skipped) { this.emit('note', { text: `Layout check skipped for ${rel}: ${r.skipped}.`, tone: 'dim' }); continue; }
      ran++;
      const n = r.problems.length;
      // `check` is the same result for the screen, which draws it as a step with each problem named.
      const check = { page: rel, problems: r.problems, secs: r.secs, again, sent: send };
      if (quiet) { if (n) left.push({ page: rel, problems: r.problems }); continue; }
      if (!n) this.emit('note', { text: `Layout check, ${rel}: nothing broken at 1440 px, on a phone or in dark mode (${r.secs.toFixed(1)} s).`, tone: 'dim', check });
      else this.emit('note', { text: `Layout check, ${rel}: ${n} problem${n === 1 ? '' : 's'}${again ? ' left' : ''} (${r.secs.toFixed(1)} s)${send ? ', sent back to fix.' : `: ${r.problems.slice(0, 3).join(' ')}`}`, tone: 'warn', check });
      if (n) { notes.push(layoutNote(rel, r.problems, again)); left.push({ page: rel, problems: r.problems }); }
    }
    // After its fix: what is still broken, and how many edits the turn had then.
    if (this.turn && again) { this.turn.layoutLeft = left.length ? left : null; this.turn.editsAtLook = this.turn.edits ?? 0; }
    if (quiet) return null;
    // ran: the pages really opened (not skipped); found: each problem, for the question after it (askPage).
    if (this.turn) this.turn.layout = { pages, problems: notes.length, again, ran, found: left.flatMap((p) => p.problems) };
    return notes.length ? notes.join('\n\n') : null;
  }

  // Look first, check after (the user's pick, 1 Oct 2026): a page saved for a request opens in
  // the browser and you are asked before anything checks it. On Bonsai at 16k the invoice page
  // was saved 6 minutes in and the checks after it took the next 14 (its own commands, then the
  // layout check sending it back). "Check it for me" runs the layout check (under a second, no
  // model) and asks again before anything goes back to be fixed; what you type goes to the model.
  // /design ask off (or AGENTIC_LAYOUT_ASK=off): the checks run by themselves, as before.
  askFirst() {
    return Boolean(this.pageAsk && this.turn && designSettings(this.designSaved).ask && asksForWork(this.turn.request));
  }

  // The page a Write of this reply saved, ready to look at: an .html file whose own files (a
  // script or style sheet it links by a relative path) are there too. One that still waits
  // for its app.js is not finished, so the turn goes on.
  savedPage(calls) {
    for (const c of [...calls].reverse()) {
      const path = parseArgs('Write', c.args).args?.path;
      if (!path || !/\.html?$/i.test(path)) continue;
      const { abs, rel, inside } = resolvePath(this.cwd, path);
      if (!inside) continue;
      let html = '';
      try { html = readFileSync(abs, 'utf8'); } catch { continue; }
      if (missingParts(html, dirname(abs)).length) continue;
      return rel;
    }
    return null;
  }

  // → { end: reason } the turn stops here · { send, fix } go on with that message · {} nothing to ask.
  //   saved: asked right after the Write, before the model's reply (the app says the last line).
  //   again: a look after a fix you asked for.
  async askPage(pages, signal, { saved = false, again = false } = {}) {
    const t = this.turn;
    const names = pages.map((p) => basename(p)).join(' and ');
    const it = pages.length === 1 ? 'it' : 'them';
    const mtimes = () => pages.map((p) => { try { return statSync(resolvePath(this.cwd, p).abs).mtimeMs; } catch { return 0; } }).join();
    const end = (line) => { if (saved) this.finishLine(line); return { end: 'done' }; };
    if (!t.checkWanted) {
      // Asked already, and the page has not changed since: nothing new to look at.
      if (t.askedAt === mtimes()) return {};
      t.pageAsked = (t.pageAsked ?? 0) + 1;
      t.askedAt = mtimes();
      const opened = await this.openPages(pages);
      const canCheck = designSettings(this.designSaved).check && Boolean(findChrome());
      const question = `${names} ${pages.length === 1 ? 'is' : 'are'} saved${opened ? ' and open in your browser' : ''}. Have a look: is ${it} right?`;
      const id = `page_${Date.now()}`;
      this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
      const answer = await this.ask({ id, name: 'Ask', kind: 'page', args: { question, options: ['Looks good', ...(canCheck ? [CHECK_IT] : [])] }, prepared: {}, label: 'Ask', arg: question });
      if (signal?.aborted) return { end: 'interrupted' };
      const text = (answer.text ?? answer.feedback ?? '').trim();
      if (answer.choice === 'no' && !text) return { end: 'declined' }; // "Stop here"
      this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: text || 'Looks good' } });
      if (!text || looksGood(text)) return end(`Saved ${pages.join(' and ')}. You looked at ${it} and said ${it} looks good, so nothing more was checked.`);
      if (!wantsCheck(text) || !canCheck) {
        // "No, this is wrong" and little more: what is wrong, as choices; then back with that and the request.
        let what = '';
        const wrong = /^\W*(no|nope|wrong|not right|this is wrong|that'?s wrong|incorrect|bad)\b/i.test(text) && text.split(/\s+/).length <= 8;
        if (wrong) {
          const q = pageWrongQuestion(names);
          const id2 = `pagewrong_${Date.now()}`;
          this.emit('tool-ask', { id: id2, name: 'Ask', label: 'Ask', arg: q.question });
          const a2 = await this.ask({ id: id2, name: 'Ask', kind: 'page', args: q, prepared: {}, label: 'Ask', arg: q.question });
          if (signal?.aborted) return { end: 'interrupted' };
          what = String(a2.text ?? a2.feedback ?? '').trim();
          if (what) this.emit('tool', { id: id2, name: 'Ask', label: 'Ask', arg: q.question, view: { kind: 'answer', question: q.question, text: what } });
        }
        // An instruction ("make the total bold") goes back as it was; "wrong" with its detail and the request.
        if (!wrong) return { send: `[Page] You stopped after saving ${names} so the user could look at ${it}. The user answered: ${text}\nFollow that.` };
        const asked = String(t.task ?? t.request ?? '').split('\n\n(')[0].replace(/\s+/g, ' ').trim();
        const hint = this.rememberHint('corrected');
        return { send: `[Page] You stopped after saving ${names} so the user could look at ${it}. The user answered: ${text}${what ? `\nWhat is wrong, in their words: ${what}` : ''}\nTheir request, to hold the page against: "${asked.length > 900 ? `${asked.slice(0, 899)}…` : asked}"\nFollow that.${hint ? `\n${hint}` : ''}` };
      }
      t.checkWanted = true;
    }
    const found = await this.checkLayout(again, { send: false });
    if (signal?.aborted) return { end: 'interrupted' };
    if (!found) return end(`Saved ${pages.join(' and ')}. ${t.layout?.ran ? 'The page check found nothing broken.' : 'The page check could not run (the line above says why).'}`);
    const n = t.layout?.found?.length || 1;
    const question = `The page check found ${n === 1 ? 'a problem' : `${n} problems`}${again ? ' left after the fix' : ''} (above). Fix ${n === 1 ? 'it' : 'them'}?`;
    const id = `pagefix_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'page', args: { question, options: [n === 1 ? 'Fix it' : 'Fix them', 'Leave it'] }, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { end: 'interrupted' };
    const text = (answer.text ?? answer.feedback ?? '').trim();
    if (answer.choice === 'no' && !text) return { end: 'declined' };
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text } });
    if (/^(fix|yes|y|ok|okay|go|sure|do it)\b/i.test(text)) return { send: auto(found), fix: true };
    if (/^(leave|no|n|skip)\b/i.test(text)) return end(`Saved ${pages.join(' and ')}. You chose to leave what the page check found.`);
    return { send: `[Page check] The page check found this:\n\n${found}\n\nThe user answered: ${text}\nFollow that.`, fix: true };
  }

  // The pages, opened in your browser by the app (openPage): true when any is open. A page is
  // opened again only once it changed, and deliverDesktop does not open it a second time.
  async openPages(pages) {
    if (!this.openPage) return false;
    const t = this.turn;
    t.opened ??= new Map();
    let any = false;
    for (const rel of pages) {
      const abs = resolvePath(this.cwd, rel).abs;
      let mtime = 0;
      try { mtime = statSync(abs).mtimeMs; } catch { continue; }
      if (t.opened.get(abs) === mtime) { any = true; continue; }
      try { await this.openPage(abs); } catch (e) { this.emit('note', { text: `Could not open ${this.tilde(abs)}: ${e.message}.`, tone: 'warn' }); continue; }
      t.opened.set(abs, mtime);
      any = true;
      this.emit('note', { text: `Opened ${this.tilde(abs)} in your browser.`, tone: 'dim' });
    }
    return any;
  }

  // The turn's last reply, said by the app when it ends at a question of its own (askPage
  // right after a Write): the conversation gets its answer, and the screen shows it.
  finishLine(text) {
    this.messages.push({ role: 'assistant', content: text });
    this.emit('assistant', { text, reasoning: '', secs: 0, thinkSecs: 0, tokens: 0, final: true });
  }

  // This turn's request with what goes along with it (see send()): the steps
  // for its kind of bug, the user's own math notes when the topic came up, and
  // the design examples with a request to make or restyle a page.
  withTurnNotes(messages) {
    const t = this.turn;
    if (t?.baked) return messages;
    const extras = [t?.bug, t?.skill, t?.folder, t?.look, t?.asks, t?.fixNote, t?.math, t?.design, t?.carried, t?.web, t?.mcp, t?.open, t?.rules].filter(Boolean);
    const pin = this.pinnedNote();
    if (!extras.length && !pin) return messages;
    return messages.map((m) => {
      const notes = extras.filter((x) => m === x.request).map((x) => `\n\n(${x.steps ?? x.notes})`).join('');
      const held = pin && m === t.requestMsg ? `\n\n(${pin})` : '';
      return notes || held ? { ...m, content: `${m.content}${notes}${held}` } : m;
    });
  }

  // What a trim must not drop, sent with the request: the success check, and the last tool
  // error once its own message has been shortened. While that message is still whole, the
  // model already has it. The focused tries put the last failure in the next prompt; this
  // is the free loop's copy of that.
  pinnedNote() {
    const t = this.turn;
    if (!t) return '';
    const parts = [];
    if (t.check) parts.push(`This request passes when this command passes: ${t.check}`);
    const held = t.lastError && this.messages.some((m) => m.keep === 'error' && !String(m.content).startsWith('[older output removed'));
    if (t.lastError && !held) parts.push(`The last tool error, kept whole:\n${t.lastError}`);
    return parts.join('\n\n');
  }

  // The reminder of its plan (planReminder) when this step is PLAN_EVERY steps or more past the last
  // time it saw it, and steps are left. Only a plan written in this message counts (planAt).
  planDue(calls) {
    const t = this.turn;
    if (!t) return '';
    if (calls.some((c) => c.name === 'TodoWrite')) { t.planAt = t.steps ?? 0; return ''; }
    if (this.lean || t.planAt == null || (t.steps ?? 0) - t.planAt < PLAN_EVERY) return '';
    const line = planReminder(this.todos);
    if (line) t.planAt = t.steps ?? 0;
    return line;
  }
  // Remember at the moments that teach something (4 Oct 2026, the owner's picks: your answers to its
  // questions, your corrections, a fix that worked, a wall it hit): one line, once a moment a message,
  // when the model has the Remember tool (Model way, the memory on and saving).
  rememberHint(kind) {
    const t = this.turn;
    if (!t || this.isHelper || this.lean || this.way !== 'model' || !this.memory || this.memory.saveOff) return '';
    t.remembered ??= new Set();
    if (t.remembered.has(kind)) return '';
    t.remembered.add(kind);
    const what = { answers: 'If one of these answers will hold next time too', corrected: 'If what was wrong will matter again', fixed: 'That worked. If the fix will matter again', wall: 'Once you are past it, if how will matter again' }[kind];
    return what ? `(${what}, save it with Remember: one short sentence.)` : '';
  }

  // A question from Claude's notes taken for the request (claude-notes.mjs chasedQuestion): once a message,
  // the line that sets it right, with the request (4 Oct 2026: a quoted 30 Sep question was worked on for
  // 20 minutes in place of the request).
  noteChaseDue(said) {
    const t = this.turn;
    if (!t || t.noteChased || !this.claudeSaid) return '';
    const q = chasedQuestion(said, this.claudeSaid, t.task ?? t.request);
    if (!q) return '';
    t.noteChased = true;
    const words = String(t.task ?? t.request ?? '').split('\n\n(')[0].replace(/\s+/g, ' ').trim();
    this.emit('note', { text: `It took a question from Claude's notes for your request ("${q.length > 80 ? `${q.slice(0, 79)}…` : q}"); set it right.`, tone: 'warn' });
    return `(The question "${q}" is quoted in Claude's notes from an earlier conversation; it is not this request, so leave it. This message's request: "${words.length > 600 ? `${words.slice(0, 599)}…` : words}". Work on that.)`;
  }

  // Your request (requestReminder) on a model with a big memory, REQUEST_EVERY steps after it was last in sight.
  requestDue() {
    const t = this.turn;
    if (!t || this.lean || this.ctx < BIG_MEMORY || !String(t.request ?? '').trim()) return '';
    if ((t.steps ?? 0) - (t.requestAt ?? 0) < REQUEST_EVERY) return '';
    t.requestAt = t.steps ?? 0;
    return requestReminder(t.request, t.task);
  }
  // The follow-through lines with a step's result (4 Oct 2026, the owner's picks after a Qwen run): a wall
  // it met and has not asked you about after two more steps (Stop when blocked); a reply that says it
  // found what it needs when it saw only outlines of the files (Read before claiming); a request with
  // several asks and no plan by the third step (Plan for several asks). Each once a message.
  followDue(calls, text) {
    const t = this.turn;
    if (!t || this.isHelper) return [];
    const out = [];
    const wall = t.walls[0];
    if (wall && !t.askedUser && !t.wallReminded && (t.steps ?? 0) - wall.step >= 2 && this.hook('blocked')) {
      t.wallReminded = true;
      this.emit('note', { text: 'It has not asked you about what blocked it; reminded it to ask.', tone: 'warn' });
      out.push(`(You have not asked the user yet: ${wall.why}. Ask now, with Ask, before you go on. Do not do a different task instead.)`);
    }
    if (!t.readFirstSent && t.outlined.size && claimsFound(text) && this.hook('read-first')) {
      t.readFirstSent = true;
      const names = [...t.outlined].slice(0, 3).map((f) => basename(f));
      this.emit('note', { text: `It says it found what it needs, but saw only the outline of ${names.join(', ')}; told it to read the part first.`, tone: 'warn' });
      out.push(`(You wrote that you found or have what you need, but of ${names.join(', ')} you have seen only the outline: its parts and line numbers, none of its text. Read the part you need (offset and limit, or find) before you use what is in it.)`);
    }
    if (!t.toDoSent && t.planAt == null && (t.steps ?? 0) >= 3 && !calls.some((c) => c.name === 'TodoWrite') && severalAsks(t.request) && this.hook('to-do') && this.tools().some((x) => x.function?.name === 'TodoWrite')) {
      t.toDoSent = true;
      this.emit('note', { text: 'Several asks and no plan yet: asked it to write one.', tone: 'dim' });
      out.push('(Your request has several asks. Write your plan now with TodoWrite: one item for each thing the user asked, and mark each one as you finish it.)');
    }
    return out;
  }
  // The request's cases (cases.mjs): with the first change of a message, on a model on another machine in a
  // project with tests, a call of their own lists them with a fixed form of answer (listCases), and the model is
  // told the list; the check before its answer stands holds it to them. The owner's pick, 4 Oct 2026: asked to
  // write its plan as the cases, two models of four ignored it twice, so the check had nothing to hold them to.
  // A plan written as cases adds its own, kept for the whole message (a plan written again after memory filled
  // dropped Qwen3.6's ten). No list from the call: the model is asked to write them, as before (once, then once more).
  async casesDue(calls, signal) {
    const t = this.turn;
    if (!t || this.isHelper || !this.model?.remote || !this.testCmd || !this.hook('cases') || !this.tools().some((x) => x.function?.name === 'TodoWrite')) return '';
    const wrotePlan = calls.some((c) => c.name === 'TodoWrite');
    if (wrotePlan) for (const c of casesOf(t.planAt != null ? this.todos ?? [] : [])) addCase(t, c);
    if (!t.casesAsked && calls.some((c) => CHANGES.has(c.name))) {
      t.casesAsked = true;
      t.toDoSent = true;
      const listed = await this.listCases(signal);
      if (signal?.aborted) return '';
      for (const c of listed) addCase(t, c);
      if (listed.length) {
        t.casesListed = true;
        this.emit('note', { text: `The request's cases, listed by a call of their own: ${listed.length}, each to be tried by a test before the answer stands.`, tone: 'dim' });
        return casesTold(listed);
      }
      if (t.cases?.length) return '';
      this.emit('note', { text: "Asked it for its plan as the request's cases, each with an example to test.", tone: 'dim' });
      return CASES_ASK;
    }
    if (t.casesAsked && !t.casesListed && !t.casesFixAsked && wrotePlan && !t.cases?.length) {
      t.casesFixAsked = true;
      this.emit('note', { text: 'Its plan has no examples to test: asked for them once more.', tone: 'dim' });
      return CASES_FIX;
    }
    return '';
  }

  // The request's cases from the model, in a call of their own: only the request, and a fixed form of answer
  // (as the Done check asks its question). [] when it gives none or fails.
  async listCases(signal) {
    const request = String(this.turn?.request ?? '').trim();
    if (!request) return [];
    try {
      const r = await complete({ url: this.url, model: this.model, slot: this.slots?.side, signal, temperature: 0, maxTokens: 4000,
        system: 'You list the cases a coding request specifies, so each can be tested. Judge only from the request.',
        user: `Request:\n${request.slice(0, 6000)}\n\nList what this request specifies, so that each thing can be tested. Go through it phrase by phrase and stay with its own words: add no behaviour, argument or path it does not state.\n- cases: each behaviour it asks for. One case for every form it names: "A, B or C" is three cases.\n- unchanged: each thing it says must stay as it is, be refused, or be left alone. Again one for every form it names.\nFor each one: example is the input alone, just as the request writes it (a command line, a string, a value), with a small made-up value where it has a placeholder (FILE becomes notes.txt, DIR becomes src, N becomes 3) and relative names only, never a path from the root. Give a call only when the request's form is itself a call. expect is what the request says happens, in the request's own words, with no data shape of your own.\nAt most ${MAX_CASES} in each list.`,
        schema: { type: 'object', properties: { cases: { type: 'array', items: CASE_ITEM, maxItems: MAX_CASES }, unchanged: { type: 'array', items: CASE_ITEM, maxItems: MAX_CASES } }, required: ['cases', 'unchanged'] } });
      const listed = casesFromList(r.json?.cases, r.json?.unchanged, request);
      // What the request spells out and the list left unused (cases.mjs gapCases): a case each.
      return listed.length ? [...listed, ...gapCases(request, listed)] : listed;
    } catch (e) {
      if (signal?.aborted) throw e;
      return [];
    }
  }

  // Case review: the changed code (not its tests), read against each case of the request by a call of its
  // own with a fixed form of answer. What goes back to the model, or '' (all read right, nothing to read, no answer).
  async reviewCases(signal) {
    const t = this.turn;
    // A sign the request spells out (gapCases) is read as an example made of two listed ones; a flag alone has none.
    const listed = (t?.cases ?? []).filter((c) => !c.sign && !c.probe).map((c) => c.example);
    const cases = (t?.cases ?? []).filter((c) => !c.probe).map((c) => (c.sign ? { ...c, example: signSample(c.sign, listed), text: `\`${signSample(c.sign, listed)}\` → what the request says about \`${c.sign}\`` } : c)).slice(0, REVIEW_MAX);
    const request = String(t?.request ?? '').trim();
    if (!cases.length || !request) return '';
    let code = [...(t.wrote?.keys() ?? [])].filter((rel) => !isTestPath(rel)).map((rel) => { try { return `--- ${rel}\n${readFileSync(join(this.cwd, rel), 'utf8')}`; } catch { return ''; } }).filter(Boolean).join('\n\n');
    if (!code) return '';
    if (code.length > REVIEW_CODE) code = t.diffs?.trim() ? `(The changed files are long, so these are this message's changes: + added, - removed.)\n${t.diffs.slice(0, REVIEW_CODE)}` : code.slice(0, REVIEW_CODE);
    const t0 = Date.now();
    this.emit('busy', { task: 'reading the code against the cases' });
    try {
      const r = await complete({ url: this.url, model: this.model, slot: this.slots?.side, signal, temperature: 0, maxTokens: 4000, system: REVIEW_SYSTEM, user: reviewAsk({ request, code, cases }), schema: REVIEW_SCHEMA(cases.length) });
      const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
      if (!Array.isArray(r.json?.reviews)) { this.emit('note', { text: `Case review: no answer came back (${secs} s); the answer stands as it is.`, tone: 'dim', fold: true }); return ''; }
      const wrong = reviewWrong(r.json.reviews, cases);
      if (!wrong.length) { this.emit('note', { text: `Case review: the code reads right for all ${cases.length} cases (${secs} s).`, tone: 'dim', fold: true }); return ''; }
      this.emit('note', { text: `Case review: ${wrong.length} of the ${cases.length} cases read as wrong (${secs} s); sent back once to be checked. · ${wrong.slice(0, 4).map((w) => w.example).join(' · ')}`, tone: 'warn' });
      return reviewBack(wrong, cases.length);
    } catch (e) {
      if (signal?.aborted) throw e;
      this.emit('note', { text: 'Case review: no answer came back; the answer stands as it is.', tone: 'dim', fold: true });
      return '';
    }
  }

  // Who checks that a model on another machine stays on task (drift.mjs): on an Ollama service its Side
  // jobs helper, else the main model; on the owner's other Mac (coding serve) the main model on the
  // server's second lane, as Auto's check does, so the conversation's own lane is not read again.
  driftWho() {
    if (!this.model?.remote) return null;
    const ep = endpointOf(this.url);
    if (ep?.ollama) return { use: this.sideUse() };
    if (ep?.kind === 'llama') return this.slots?.side !== undefined ? { slot: this.slots.side } : { none: 'its server has one lane (coding serve --slots 2 gives it a second)' };
    return null;
  }
  // Who takes the second look (second-look.mjs): on a model on another machine as for Stays on task; on this
  // Mac the server's second lane when it has one (as the Done check); the Claude API and other services: none.
  lookWho() {
    if (this.model?.remote) return this.driftWho();
    return this.slots?.side !== undefined ? { slot: this.slots.side } : null;
  }
  // Second look (/hooks, on): after a message that ran commands, wrote files or fetched pages, the answer is
  // checked against what the app saw; one that does not hold goes back once. Answers the line to send, or ''.
  async lookDue(answer, signal) {
    const t = this.turn;
    if (!t || this.isHelper || t.looked2 || !lookOn() || !this.hook('second-look')) return '';
    if (!(t.ranCommand || t.changed || t.wroteByCommand || t.fetched)) return '';
    t.looked2 = true;
    const who = this.lookWho();
    if (!who || who.none) return '';
    this.emit('busy', { task: 'taking a second look at the answer' });
    // The model's own calls of this message, kept as they ran (a summary of the conversation cannot lose them).
    const steps = ownSteps([{ role: 'assistant', tool_calls: t.callLog ?? [] }]);
    const r = await secondLook({ url: this.url, model: this.model, slot: who.slot, use: who.use, request: t.request, plan: t.planAt != null ? planList(this.todos) : '', steps, facts: lookFacts(t, { home: this.home ?? homedir() }), answer, signal });
    const secs = `${(r.ms / 1000).toFixed(1)} s`;
    if (r.failed) { this.emit('note', { text: `Second look: not made (${r.reason}).`, tone: 'dim' }); return ''; }
    if (r.ok) { this.emit('note', { text: `Second look: the answer holds (${secs}).`, tone: 'dim', check: { title: 'Second look', page: '', problems: [], ok: 'the answer holds', where: secs } }); return ''; }
    this.emit('note', { text: `Second look: ${r.problems.join(' · ')} Sent it back (${secs}).`, tone: 'warn', check: { title: 'Second look', page: '', problems: r.problems, bad: `${r.problems.length === 1 ? 'one thing' : `${r.problems.length} things`} the answer must fix`, where: secs, sent: true } });
    return lookText(r.problems);
  }
  // Stays on task (/hooks, off until you switch it on): every DRIFT_EVERY steps, the check; off task, the
  // line that brings it back (DRIFT_NUDGES a message at most). Answers that line, or ''.
  async driftDue(signal) {
    const t = this.turn;
    if (!t || this.isHelper || !this.hook('drift') || (t.nudges ?? 0) >= DRIFT_NUDGES) return '';
    if ((t.steps ?? 0) - (t.driftAt ?? 0) < DRIFT_EVERY) return '';
    t.driftAt = t.steps ?? 0;
    const who = this.driftWho();
    if (!who) return '';
    if (who.none) {
      if (!t.driftNone) { t.driftNone = true; this.emit('note', { text: `Stays on task: not checked, ${who.none}.`, tone: 'dim' }); }
      return '';
    }
    const { steps, said } = recentSteps(this.messages);
    this.emit('busy', { task: 'checking it stays on task' });
    const r = await driftCheck({ url: this.url, model: this.model, slot: who.slot, use: who.use, request: t.request, plan: t.planAt != null ? planList(this.todos) : '', steps, said, signal });
    const secs = `${(r.ms / 1000).toFixed(1)} s`;
    if (r.failed) { this.emit('note', { text: `Stays on task: not checked (${r.reason}).`, tone: 'dim' }); return ''; }
    if (r.on) { this.emit('note', { text: `Stays on task: on track (${secs}).`, tone: 'dim' }); return ''; }
    t.nudges = (t.nudges ?? 0) + 1;
    this.emit('note', { text: `Stays on task: ${r.reason}. Nudged it back (${t.nudges} of ${DRIFT_NUDGES}, ${secs}).`, tone: 'warn' });
    return nudgeText(r.reason);
  }
  setMode(mode) { this.mode = mode; this.emit('mode', mode); }
  // What you saved with /permissions for the folder Agentic Coder works in now:
  // { allow, never, protect }. `permissions` is a function of the folder (the app
  // and `coding -p` give one), so a move to another project switches the lists;
  // read at every call, so a rule saved in another window counts at once.
  savedRules() { return (typeof this.permissions === 'function' ? this.permissions(this.cwd) : this.permissions) ?? null; }
  reset(system) { for (const j of this.jobs.all) j.orphan = true; this.jobNews = []; this.conversation = newConversation(); this.messages = [{ role: 'system', content: system ?? this.messages[0].content }]; this.todos = null; this.readFiles = new SeenFiles(); this.mapGiven = false; this.keptWrite = null; this.desktopAsked = false; this.desktopMade = null; this.mcpFrozen = null; this.mcpPlans = null; this.toolPlace = null; this.cardsGiven = new Set(); this.task = null; this.ctxUsed = tokensOf(this.messages[0].content) + 1200; }
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

  // A tool result's room: 15% of the context, at most RESULT_MAX characters. At a service's 262k
  // context one Read of a report page brought 142,000 characters (4 Oct 2026), and every step after was slow.
  get maxResultChars() { return Math.min(RESULT_MAX, Math.max(4000, Math.floor(this.ctx * 0.15 * 3.6))); }

  // Past half this request's time for thinking (THINK_BUDGET_SECS): true, and the first time a
  // note says so. Never with thinking off, a budget of 0, or AGENTIC_THINK=old.
  // Not while steps are failing in a row (4 Oct 2026, the owner's pick: it stepped down right after a
  // script failed, and three quick fixes in a row failed too); it steps down after one that works.
  // Nor on a service that takes no thinking cap (capsThinking): there it could only say so.
  steppedDown() {
    if (!this.thinking || !(this.thinkBudgetSecs > 0) || !this.requestStarted || oldThinking() || !this.capsThinking()) return false;
    if (Date.now() - this.requestStarted < this.thinkBudgetSecs * 500) return false;
    if (this.turn?.errorsInRow > 0) return false;
    if (this.steppedAt == null) {
      this.steppedAt = Date.now();
      this.emit('note', { text: `Half of the ${Math.round(this.thinkBudgetSecs / 60)} minutes for this request used: thinking briefly from here, to finish in time`, tone: 'dim', fold: true });
    }
    return true;
  }

  // The same step-down on an Ollama service, which takes no cap: past half the request's time its replies are
  // asked for with thinking off (about 1.3 s there for the switch). 5 Oct 2026: Qwen3.6 thought two to three
  // minutes in single steps, 12 of its 25 minutes, and ran out of time in four runs of six. Not while steps
  // are failing in a row, as above. (gpt-oss cannot stop thinking: off is its lowest level.)
  serviceSteppedDown() {
    if (!this.thinking || !(this.thinkBudgetSecs > 0) || !this.requestStarted || oldThinking() || !endpointOf(this.url)?.ollama) return false;
    if (Date.now() - this.requestStarted < this.thinkBudgetSecs * 500) return false;
    if (this.turn?.errorsInRow > 0) return false;
    if (this.steppedAt == null) {
      this.steppedAt = Date.now();
      this.emit('note', { text: `Half of the ${Math.round(this.thinkBudgetSecs / 60)} minutes for this request used: thinking is off from here, to finish in time`, tone: 'dim', fold: true });
    }
    return true;
  }

  // Whether the service ends the thinking at a cap of ours (client.mjs thinking_budget_tokens): llama.cpp,
  // this Mac's server and `coding serve`, does; Ollama, OpenAI-style services and the Claude API take
  // none, and there Reply length holds the thinking and the answer (4 Oct 2026: a remote run showed
  // "39 of 64" after the step-down, a cap the service never had).
  capsThinking() {
    const ep = endpointOf(this.url);
    return !(ep?.ollama || ep?.kind === 'openai' || ep?.kind === 'claude');
  }

  // The effort of this turn's next reply. High is for working the problem out: once this turn
  // has changed a file, the steps left (run the tests, report) think at Medium. Not for a model
  // whose template writes the effort at the very top of the prompt (effortAtTop, Bonsai): there
  // a new effort is a new prompt from its first word, so the server reads the whole conversation
  // again (1 Oct 2026, Bonsai at 16k: 3 minutes each time, three times in one turn). The notes
  // call takes the same, so the conversation it reads is the one already read.
  stepEffort() {
    return this.effort === 'high' && this.turn?.changed && !this.model?.effortAtTop && !this.levelInPrompt() ? 'medium' : this.effort;
  }
  // gpt-oss on an Ollama service: its thinking level is written into the system message (the
  // harmony format's "Reasoning: …"), so a new level is a new prompt from its first lines and the
  // service reads the whole conversation again, as with effortAtTop above.
  levelInPrompt() {
    const ep = endpointOf(this.url);
    return Boolean(ep?.ollama && /gpt-?oss/i.test(`${ep.family ?? ''} ${this.turn?.use?.model ?? ep.model ?? ''}`));
  }

  // What the conversation holds now, the two newest messages counted (they
  // may not be in ctxUsed yet).
  estNow() {
    return this.ctxUsed + this.messages.slice(-2).reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : ''), 0);
  }

  // The thinking the next reply may use: none with thinking off, STEP_DOWN_CAP
  // past half the request's time, else the model's cap, shrunk to what fits
  // under the trim line with the answer's 2,048 (but never below LEAST_THINK).
  thinkRoom(est = this.estNow()) {
    if (!this.thinking) return 0;
    const cap = this.steppedDown() ? STEP_DOWN_CAP : (this.model?.thinkingBudget ?? 2048);
    const fits = Math.floor(this.ctx * this.trimAt - est - 2048);
    return Math.max(Math.min(cap, LEAST_THINK), Math.min(cap, fits));
  }

  // What a restart from notes keeps: the instructions, the request and the
  // notes that go with it (design cards, a skill…), and the tools.
  keptTokens() {
    const opening = (this.turn?.opening ?? []).filter((m) => this.messages.includes(m));
    return this.withTurnNotes([this.messages[0], ...opening]).reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : ''), 0) + 1300;
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
      // A run of the tests says so, with whether they failed (a loop's run reads it: loop-run.mjs).
      const run = label === 'Bash' && view?.kind === 'bash' ? testRunOf(arg, { testCmd: this.testCmd }) : null;
      const tests = run ? { failed: testsFailed((view.lines ?? []).join('\n'), view.code ?? (error ? 1 : 0), run) } : null;
      this.emit('tool', { id: `flow_${++seq}`, name: label, label, arg, view, error, ...(tests ? { tests } : {}) });
    };
    return {
      // The facts brought back for this request (recall.mjs), for the paths' own prompts.
      instructions: focusedInstructions(this.messages[0].content),
      memory: this.happened?.notes ?? '',
      // The helpers on (helpers.mjs), for the paths that use one.
      helpers: this.helpers,
      url: this.url, model: this.model, slot: this.slots?.side, sideSlots: this.slots?.sides ?? (this.slots?.side !== undefined ? [this.slots.side] : []), cwd: this.cwd, testCmd: this.testCmd ?? testCommand(this.cwd), testTimeoutMs: this.testTimeoutMs, signal, maxTries: this.maxTries,
      // A loop's run: notes typed while a path works go with its next try (flows/tries.mjs), and stay with the ones after.
      steering: this.steering ? () => this.steering() : null, notes: [],
      // Code and tests are written at the chat's thinking level (Off by default), read at each
      // call: past half the request's time it is off (steppedDown).
      get thinking() { return agent.thinking && !agent.steppedDown(); },
      effort: this.effort,
      // The memory's small model, which also ranks files by meaning (rank.mjs).
      embedder: this.searchEmbedder ?? this.ranker ?? this.memory?.embedder ?? null,
      emit: (name, ev) => {
        if (name === 'route') { this.lastRoute = ev; this.sorted(ev.kind, { shortcut: true }); }
        if (name === 'tries-done') this.happened?.tries.push({ label: ev.label, marks: (ev.marks ?? []).join(''), summary: ev.summary, failed: Boolean(ev.failed) });
        this.emit(name, ev);
      },
      ask: (req) => this.ask(req),
      confirm: (plan) => (this.confirmPlan && this.mode !== 'bypass' ? this.confirm(plan, signal) : { ok: true }),
      // The focused paths know two ways (flows/apply.mjs): edits asked about, or on auto-accept.
      // Auto and Bypass let edits inside the project through, as Accept edits does.
      mode: () => (this.mode === 'auto' || this.mode === 'bypass' ? 'edits' : this.mode),
      setMode: (m) => this.setMode(m),
      // A protected file always asks (permissions.mjs), even on auto-accept; in Bypass only the
      // app's own settings still do (the tool loop refuses those; here the path asks).
      protectedBy: (rel) => { const at = resolvePath(this.cwd, rel); return this.mode === 'bypass' ? ownBy([rel, at.realRel]) : protectedBy([rel, at.realRel], this.savedRules()?.protect); },
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
  // fromServer: the message is an MCP server's own prompt (/server:prompt): no MCP note goes with it.
  // wake: the app's own message for a background job that ended after the reply (jobWake): it carries
  // on the last turn, so nothing sorts it or reads ahead for it, as when the model decides.
  async send(text, { signal, shown, images, fromServer = null, wake = false } = {}) {
    this.sending = true;
    // Your hooks for a message you send (not the app's own wake): exit 2 stops it; what one prints
    // goes with it, as does what a SessionStart hook printed.
    if (!wake && this.userHooks?.has('UserPromptSubmit')) {
      const r = await this.userHooks.run('UserPromptSubmit', { prompt: String(text) }, { signal, permissionMode: this.mode });
      if (r.block) {
        this.sending = false;
        this.emit('note', { text: `Your hook stopped this message, so it was not sent: ${r.reason || 'it said no'}`, tone: 'warn' });
        return 'blocked';
      }
      if (r.context) text = `${text}\n\n(From the user's hook: ${r.context})`;
    }
    if (this.sessionContext && !wake) { text = `${text}\n\n(From the user's hook at the start: ${this.sessionContext})`; this.sessionContext = null; }
    // Background jobs that ended while nothing was running ride with this message.
    const news = this.takeJobNews();
    if (news) text = `${text}\n\n(Meanwhile: ${news})`;
    this.fromServer = fromServer;
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
    // This conversation's MCP tools, taken before its first message (mcpTake).
    try { await this.mcpTake(); } catch { /* no MCP tools in this conversation */ }
    try { reason = await this.work(text, { signal, images, wake }); } finally {
      this.sending = false;
      // A job that ended during the reply and was not told with a step: the app sends it now
      // (not after you stopped the reply: it goes with your next message then).
      if (this.jobNews.length && reason !== 'interrupted') setTimeout(() => { if (this.idle() && this.jobNews.length) this.emit('jobs-waiting', { count: this.jobNews.length }); }, 0);
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
    this.readFiles = new SeenFiles();
    this.mapGiven = this.messages.some((m) => m.role === 'tool' && String(m.content).startsWith('Code files in the project'));
    this.ctxUsed = this.messages.reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : '') + tokensOf(m.reasoning_content ?? ''), 0) + 1300;
    return true;
  }

  async work(text, { signal, images, wake = false } = {}) {
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
    // Not in a helper: its one task keeps the prompt it was handed (the parent's, with its part).
    if (!this.isHelper && this.promptFilesChanged()) {
      const was = this.rulesSetUsed;
      this.refreshNotes();
      this.emit('note', { text: was === this.rulesSetUsed ? 'Updated prompt files loaded (AGENTS.md, TOOLS.md, SKILLS.md).' : this.setNote(), tone: 'dim' });
    }
    this.busy = true;
    const started = Date.now();
    const turnStart = this.messages.length;
    // A picture this model cannot see, and a Pictures helper on the service: it describes
    // the picture first, and the words go in its place (/subagents, 2 Oct 2026).
    const lookUse = images?.length && !this.canSee ? this.helperUse('pictures') : undefined;
    if (lookUse) {
      this.emit('note', { text: `Pictures: ${lookUse.model} looks at ${images.length === 1 ? 'the picture' : `the ${images.length} pictures`} first…`, tone: 'dim' });
      try {
        const d = await describePictures({ url: this.url, use: lookUse, images, question: text, signal });
        this.emit('note', { text: `Pictures: ${lookUse.model} described ${images.length === 1 ? 'it' : 'them'} (${d.secs.toFixed(0)} s): ${d.text.replace(/\s+/g, ' ').slice(0, 160)}${d.text.length > 160 ? '…' : ''}`, tone: 'dim' });
        text = `${text}\n\n${describedNote(images, lookUse.model, d.text)}`;
      } catch (e) {
        if (signal?.aborted) throw e;
        this.emit('note', { text: `Pictures: ${lookUse.model} could not look (${e.message}); the message goes with a line saying a picture was attached.`, tone: 'warn' });
        text = `${text}\n\n(The user attached ${images.length === 1 ? 'a picture' : `${images.length} pictures`} (${images.map((i) => i.path).join(', ')}), but this model is not looking at pictures now.)`;
      }
      images = undefined;
    }
    this.messages.push({ role: 'user', content: text, ...(images?.length ? { images } : {}) });
    if (images?.length) this.ctxUsed += images.length * IMAGE_TOKENS;
    if (this.happened) this.happened.message = this.messages.at(-1);
    this.emit('turn-start', { started });
    // The model decides (way.mjs): no word rules pick a path for it, not even for a greeting or
    // "update memory" (it answers, or saves with Remember). Only the loop below runs.
    const decides = this.way === 'model' || wake;
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
    // The task a short follow-up stands for ("try again", "try again another way"): the last request
    // that was not one; the request reminder says both.
    const prior = this.messages.slice(0, turnStart).some((m) => m.role === 'assistant');
    const again = prior && (isFollowUp(text, true) || (String(text).trim().split(/\s+/).length <= 6 && /\b(?:again|retry|another way)\b/i.test(text)));
    if (!this.isHelper && !wake) this.task = again && this.task ? this.task : text;
    if (follow) this.sorted('follow-up');
    // The saved facts that fit the request come along with it. They are
    // written into the request itself, so the conversation read so far stays
    // as it was (a note that came and went would make the model read the
    // last turn again).
    this.claudeCame = false;
    this.claudeSaid = '';
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
    // the request on both ways. On App the work goes step by step with them, not down a focused
    // path. Model way used to get only the list and had to Read the skill itself.
    let skill = null;
    if (!follow) { try { skill = pickSkill(text, readSkills(undefined, this.rulesSetUsed ?? this.rulesSet())); } catch {} }
    // First the focused paths (rename / fix / change); the loop handles the rest.
    // (The model that decides calls them itself: Rename and TestFirst.)
    this.carried = null;
    if (!decides && !follow && this.flows && this.mode !== 'plan' && !images?.length && !skill) {
      // Every focused call's tokens, for the done line (the loop counts its own).
      const counted = { steps: 0, tokens: 0, thinkTokens: 0 };
      const tally = ({ tokens, thought }) => { counted.steps++; counted.tokens += tokens + thought; counted.thinkTokens += thought; this.stats.outTokens += tokens + thought; };
      tallies.add(tally);
      const fctx = this.flowContext(signal);
      try {
        const r = await runFlows(fctx, text);
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
        this.carriedNotes = [...fctx.notes]; // notes a path read before it handed over go with the first step
      } catch (e) {
        tallies.delete(tally);
        this.carriedNotes = [...fctx.notes]; // notes a path read before it gave up go with the first step
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
    // kindFor: what a /agents step is (agents-driver.mjs), so its words are not sorted again.
    const kind = follow || decides ? undefined : this.kindFor ?? this.lastRoute?.kind ?? routeByRules(text)?.kind;
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
    let repeatOut = '';
    let repeats = 0;
    let errorsInRow = 0;
    let nudges = 0;
    let stopBacks = 0; // your Stop hooks' send-backs this message
    let checks = 0;
    let cuts = 0; // replies cut off at the reply limit mid-tool-call
    let toolsUsed = 0; // tool calls run for this message: a nudge is only for work already under way
    this.turn = { changed: false, testedAfterChange: false, created: [], asked: [], diffs: '', looked: [], since: Date.now(), planOk: false,
      // What the follow-through checks keep (4 Oct 2026): walls met, files seen only as an outline, the check runs.
      walls: [], outlined: new Set(), checks: [],
      // From the home folder, the folder the request names (offerProject): look-first, real-files and did-you-mean use it.
      workFolder: isHomeFolder(this.cwd, this.home) ? this.namedFolder ?? null : null,
      // The request's words steer which lines of a long file a Read shows first.
      request: typeof request?.content === 'string' ? request.content : '',
      requestMsg: request,
      task: this.task ?? null,
      // The request (and a question and answer before it): kept word for word when the conversation is summarized.
      opening: this.messages.slice(turnStart).filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.tool_calls)),
      fixing: kind === 'fix', question: kind === 'question', findings: [], nudged: 0, looksAtNudge: 0, reads: new Map(), stuckSteps: new Set(),
      // A helper agent of yours with a model of its own (runHelper): every step on that model.
      ...(this.ownUse ? { use: this.ownUse } : {}) };
    if (asksForWork(this.turn.request) && wantsDesktop(this.turn.request)) this.desktopAsked = true;
    // A request about what one of the user's MCP servers reaches: a line naming its tools (mcp.mjs requestNote).
    // Not for a message that brings a server's data with it (a resource you attached: @server:uri), or
    // that is a server's own prompt (/server:prompt).
    const mcpSays = this.mcpFrozen && request?.role === 'user' && typeof request.content === 'string' && !this.fromServer && !/<resource server="/.test(text) ? requestNote(text, this.mcpEntries(), { listed: this.mcpListed() }) : '';
    if (mcpSays) this.turn.mcp = { request, notes: mcpSays, hits: requestHits(text, this.mcpEntries(), { listed: this.mcpListed() }) };
    // Look first (look.mjs): a minimum of looking before the answer, on every task that goes step
    // by step here; not a follow-up (it continues a turn that already looked), not in the home
    // folder (a general question there needs no files), not for a helper (it is part of the looking),
    // not for a request that names one of your MCP servers (its answer is there, not in the project).
    // A folder that is not a code project (folder.mjs, 4 Oct 2026): what it says about itself (its
    // README, its manifest) goes with the first request there, and the names the request uses are
    // matched against it; when the folder does not settle which one is meant, you are asked.
    const folder = !follow && !this.isHelper && request?.role === 'user' && typeof request.content === 'string' ? await this.folderNotes(text, request, signal) : null;
    // Your standing rules ([always] facts) with the request itself, on a model on another machine: they are
    // in the instructions' Memory lines too, far above a long conversation (4 Oct 2026: a 29-step run's
    // answer went against "explain simply… no file names or code unless asked").
    if (this.model?.remote && this.memory && !this.isHelper && request?.role === 'user' && typeof request.content === 'string') {
      let rules = [];
      try { rules = alwaysRules(this.cwd, { home: this.memory.home ?? this.home }); } catch { /* no memory to read */ }
      if (rules.length) this.turn.rules = { request, notes: `Your standing rules, for this answer too:\n${rules.map((r) => `- ${r}`).join('\n')}` };
    }
    // A request that asks to be asked: the questions as choices in the window (questions.mjs ASK_NOTE).
    if (!this.isHelper && request?.role === 'user' && typeof request.content === 'string' && wantsQuestions(text)) this.turn.asks = { request, notes: ASK_NOTE };
    // A message that corrects it: Remember what was wrong, when it will matter again (rememberHint).
    if (request?.role === 'user' && typeof request.content === 'string' && CORRECTS.test(String(text).trim())) {
      const hint = this.rememberHint('corrected');
      if (hint) this.turn.fixNote = { request, notes: hint.replace(/^\(|\)$/g, '') };
    }
    const lookFloor = !follow && !this.isHelper && !isHomeFolder(this.cwd) && !this.turn.mcp?.hits.some((x) => x.named) ? this.lookSecsNow : 0;
    let lookBacks = 0;
    if (this.lean && !this.isHelper && !follow) this.emit('note', { text: LEAN_NOTE, tone: 'dim', fold: true });
    if (lookFloor && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.look = { request, notes: folder?.kind === 'data' ? LOOK_NOTE_DATA : LOOK_NOTE };
      this.emit('note', { text: `Looking first: at least ${lookFloor} s of searching and reading before it answers (/effort Look first).`, tone: 'dim', fold: true });
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
      this.turn.fence = new Set(skill.fence ?? []);
      this.ctxUsed += tokensOf(this.turn.skill.notes);
      const fence = skill.fence?.length ? `; fence: ${skill.fence.join(', ')}` : '';
      this.emit('note', { text: `Skill: ${skill.name} (SKILLS.md; its words here: ${skill.matched.join(', ')}${fence}; ≈${tokensOf(this.turn.skill.notes).toLocaleString('en-US')} tokens).`, tone: 'dim', skill: skill.name });
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
      this.turn.web = { request, urls, notes: `${urls.length === 1 ? 'The request names a web page' : 'The request names web pages'} (${urls.slice(0, 3).join(', ')}): read ${urls.length === 1 ? 'it' : 'them'} with WebFetch. ${urls.length === 1 ? 'It is' : 'They are'} not a file in the project.` };
    }
    // Bypass permissions: the prompt's rules say commands stay in the folder, offline. They are
    // kept word for word (the service's cache), so the request says what is true while it is on.
    if (this.mode === 'bypass' && request?.role === 'user' && typeof request.content === 'string') {
      // With where the user's own folders are: it does not know their name, and guessed /Users/Shared/Desktop (5 Oct 2026).
      this.turn.open = { request, notes: `${BYPASS_OPEN} The user's home folder is ${this.home}; their Desktop is ${this.desktopDir}.` };
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
    // UI design · writes (/subagents): a page request runs on that helper, when it is not the main model.
    if (this.turn && (forced || (!['question', 'fix', 'rename'].includes(kind) && isDesignRequest(text)))) {
      const writer = this.helperUse('designWrite');
      if (writer) { this.turn.use = { ...writer, keepAlive: undefined }; this.emit('note', { text: `UI design: ${writer.model} writes this page.`, tone: 'dim' }); }
    }
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
    // The opening read (opening.mjs): on the remote set, the memory whole and where the project
    // stands, before the first step of a conversation, on either way; again after it was trimmed away.
    this.giveOpening(text);
    this.giveMaps(text);
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
    let unlooked = false; // sent back once for answering about the code without a look of its own
    let unreal = false; // sent back once for naming files that are not in the project
    let lostChecked = false;
    let layoutSends = 0; // what the layout check found, sent back at most LAYOUT_ROUNDS times
    let layoutDone = false;
    let looked = false; // UI design · checks: a picture of the page looked at once (/subagents)
    let pageReads = 0; // What a reader sees (page-read.mjs): read, and once more after a send-back
    let reviewed = false; // the second opinion: once per message (/subagents)
    let desktopSent = false; // sent back once to move a page asked for on the Desktop
    let correctedAlready = false;
    let blankRetry = false;
    let leakBacks = 0; // a reply that was only thinking written out as text, sent back (twice at most)
    let mcpBacks = 0; // a request about an MCP server's data, answered with no MCP tool tried (MCP_BACKS)
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
          this.emit('reply-dropped');
          this.emit('note', { text: 'The model started repeating itself; asked it to try again.', tone: 'warn' });
          continue;
        }
        let calls = turn.calls;
        let text = turn.text;
        if (!calls.length) {
          // A call written as text, or (thinking mode) written inside the thinking.
          // Bare JSON naming one of its tools (older models on an Ollama service) counts too.
          const inText = toolCallInText(turn.text) ?? (!turn.text.trim() ? toolCallInText(turn.reasoning) : null) ?? bareCallInText(turn.text, (this.tools() ?? []).map((t) => t.function?.name ?? t.name));
          if (inText) { calls = [{ id: `call_${Date.now()}`, name: inText.name, args: inText.args }]; text = turn.text.trim() ? inText.before : ''; }
          // An MCP tool's call written the way code calls a function: mcp__warehouse__stock_level(item="mug").
          const written = !inText && this.mcpFrozen ? mcpCallInText(turn.text, this.mcpEntries()) : null;
          if (written) { calls = [{ id: `call_${Date.now()}`, name: MCP_TOOL, args: JSON.stringify(written.call) }]; text = written.before; }
        }
        // Only the first call runs, so only the first is kept in the history
        // (otherwise the model waits for results that never come). When the model
        // decides, every call of the reply runs, in order (at most MAX_CALLS), and so
        // they do for a model on another machine on either way (the remote set's TOOLS.md
        // asks for the reads of a step together: one round trip to the service, not three).
        calls = calls.slice(0, decides || this.remoteSet() ? MAX_CALLS : 1);
        // A call cut off by the reply limit (finish 'length'): running it can
        // only give "not valid JSON", and the old error told the model to send
        // the same too-big call again. Instead: build the file in parts.
        const cutCall = turn.finish === 'length' && (calls[0] ?? (CALL_MARK.test(text) ? { name: /<function=([^>\s]+)>|<ifm\|tool_call>\s*([^\s<{]+)/.exec(text)?.slice(1).find(Boolean) ?? 'the last', args: text } : null));
        if (cutCall) {
          cuts++;
          if (cuts >= 3) {
            reason = 'stuck';
            this.emit('note', { text: 'Three replies in a row were cut off mid-call, so it stopped. Ask for the file in smaller pieces.', tone: 'warn' });
            break;
          }
          const p = /"path"\s*:\s*"([^"]+)"|<parameter=path>\s*\n?([^\n<]+)|<ifm\|arg_key>path<\/ifm\|arg_key>\s*(?:<ifm\|arg_type>[^<]*<\/ifm\|arg_type>\s*)?<ifm\|arg_value>([^\n<]+)/.exec(cutCall.args ?? '');
          const path = p?.[1] ?? (p?.[2] ?? p?.[3])?.trim();
          const thought = beforeCall(turn.reasoning).trim();
          // Its row on the screen ("Writing … lines") goes: the reply will not be run as it is.
          this.emit('reply-dropped');
          const size = `cut at ${kTok(turn.tokens)} of ${kTok(this.lastRoom ?? turn.tokens)} tokens`;
          // A Write cut off with a good part of the file in it: that part is saved through
          // the usual Write (it asks and checks as ever) and the model carries on from its
          // last line. On 1 Oct Bonsai lost a 211-line try this way, then wrote it all again.
          const kept = cutCall.name === 'Write' && path ? keptPart(cutCall.args) : null;
          if (kept) {
            const id = cutCall.id ?? `call_${Date.now()}`;
            const args = JSON.stringify({ path, content: kept.content });
            this.messages.push({ role: 'assistant', content: beforeCall(text), ...(thought ? { reasoning_content: thought } : {}), tool_calls: [{ id, type: 'function', function: { name: 'Write', arguments: args } }] });
            this.emit('note', { text: `File too long for one reply (${size}): saving its first ${kept.lines} lines, then carrying on from there`, tone: 'dim' });
            const out = await this.runTool({ id, name: 'Write', args }, signal);
            this.messages.push({ role: 'tool', tool_call_id: id, content: out.text });
            this.messages.push({ role: 'user', content: auto(out.error ? cutCallNote('Write', path) : keptWriteNote(path, kept)) });
            if (!out.error) cuts = 0; // a step landed: cut-off replies are no longer "in a row"
            continue;
          }
          this.messages.push({ role: 'assistant', content: beforeCall(text), ...(thought ? { reasoning_content: thought } : {}) });
          this.messages.push({ role: 'user', content: auto(cutCallNote(cutCall.name, path)) });
          this.emit('note', { text: `${cutCall.name === 'Write' || cutCall.name === 'Edit' ? 'File too long' : 'Call too long'} for one reply (${size}): asked it to ${cutCall.name === 'Write' || cutCall.name === 'Edit' ? `build ${path ?? 'the file'} in parts` : 'do it in smaller pieces'}`, tone: 'dim' });
          continue;
        }
        // A reply that puts a question to you ends the turn, even with a tool
        // call in it: the call is dropped and Agentic Coder waits for your answer.
        // Not an Ask: its question is the one put to you, with its choices (4 Oct 2026: an outline that ends
        // "which do you prefer?" with an Ask call would have lost the Ask).
        if (calls.length && text.trim() && asksTheUserDirectly(text) && !calls.some((c) => c.name === 'Ask')) calls = [];
        const assistant = { role: 'assistant', content: text };
        const thought = beforeCall(turn.reasoning).trim();
        if (thought) assistant.reasoning_content = thought;
        if (calls.length) assistant.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: safeArgs(c.args) } }));
        this.messages.push(assistant);
        const lines = keyLines(`${thought}\n${text}`);
        for (const l of lines) if (!this.turn.findings.includes(l)) this.turn.findings.push(l);
        this.turn.findings = this.turn.findings.slice(-6);
        // A request about what an MCP server holds (its note, turn.mcp), answered with no MCP tool tried:
        // the answer cannot have come from the server (Qwen3.6, 3 Oct 2026: "42 mugs were sold" with no
        // call; "I do not have access to mcp__shop__logo" while holding it). On both ways, as the leaked
        // thinking is, and its words are not shown. Sent back MCP_BACKS times, each for one step with only
        // that tool and thinking on (mcpFocus), the second with how the tool is called; then the answer is
        // replaced by a line saying it did not come from the server (the owner's pick, 3 Oct 2026).
        // Only when the request names the server itself, and nothing else was looked at: an answer from
        // the project's own files (Read, Search, a command) is not made up, and a word that is only in
        // a tool's name ("add a test", a tool named add) is no sign the request is the server's.
        if (!calls.length && this.turn.mcp?.hits.some((h) => h.named) && !this.turn.mcpTried && !this.turn.lookedElsewhere && !(turn.leaked && !text.trim())) {
          const { hits } = this.turn.mcp;
          const servers = `${hits.length === 1 ? 'server' : 'servers'} ${hits.map((h) => `"${h.server}"`).join(' and ')}`;
          const theirs = hits.length === 1 ? 'its' : 'their';
          if (mcpBacks < MCP_BACKS) {
            mcpBacks++;
            this.emit('assistant', { text: '', reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: false });
            this.emit('note', { text: `It answered without calling the MCP tool the request is about (that answer is not shown); asked it ${mcpBacks === 1 ? 'again' : 'a second time'}, with only that tool and thinking on.`, tone: 'dim' });
            this.turn.mcpFocus = hits;
            const how = hits.flatMap((h) => h.tools.map((e) => callHint(e, { gated: h.gated })));
            this.messages.push({ role: 'user', content: auto(mcpBacks === 1
              ? `You answered without calling an MCP tool, so your answer did not come from the user's server. ${this.turn.mcp.notes}`
              : `Your answer still did not come from the user's MCP ${servers}: none of ${theirs} tools was called. It is in your tools now: ${how.length ? how.join('; ') : `${MCP_TOOL}, with a tool's name from its list`}. Call it now, then answer from what it returns.`) });
            continue;
          }
          const why = /\b(not|cannot|can['’]?t|unable|no access|unavailable)\b/i.test(text) ? ` It said: "${text.replace(/\s+/g, ' ').trim().slice(0, 200)}"` : '';
          text = `I couldn't get this from your MCP ${servers}: none of ${theirs} tools was called, so there is no answer from ${hits.length === 1 ? 'it' : 'them'}.${why}`;
          assistant.content = text;
          this.emit('note', { text: 'Its own answer is not shown: it did not come from your MCP server.', tone: 'warn' });
        }
        this.emit('assistant', { text, reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: !calls.length });
        if (!calls.length) {
          // Thinking that came out as the reply's text (leakedThinking) and nothing else: not an
          // answer. Qwen3.6 ended hard task 32 this way, mid-task (3 Oct 2026). A technical
          // recovery, so on both ways.
          if (turn.leaked && !text.trim() && leakBacks < 2) {
            leakBacks++;
            this.emit('note', { text: 'The reply was only thinking, written out as text; asked it to take the next step.', tone: 'dim' });
            this.messages.push({ role: 'user', content: auto('Your last reply was only your thinking, with no tool call and no answer. Take the next step now with a tool, or give your answer.') });
            continue;
          }
          // A reply that asks you something ends the turn: it waits for you.
          // The questions the request asked for, written as text: back once to put them in Ask, the outline kept.
          if (this.turn.asks && !this.turn.askedUser && !this.turn.askBack && questionLines(text) >= 2) {
            this.turn.askBack = true;
            this.emit('note', { text: 'It wrote its questions as text; asked it to put them in the picker (Ask).', tone: 'warn' });
            this.messages.push({ role: 'user', content: auto(`You wrote your questions as text. Put them to the user with the Ask tool now: each with 2 to 4 choices, up to 5 questions in one Ask. Keep the rest of your answer as it is; do not write it again.`) });
            continue;
          }
          // An answer to a question from Claude's notes in place of the request: back once with the request.
          const chasedNow = !this.turn.noteChased ? this.noteChaseDue(`${turn.reasoning ?? ''}\n${text}`) : '';
          if (chasedNow) { this.messages.push({ role: 'user', content: auto(chasedNow.replace(/^\(|\)$/g, '')) }); continue; }
          if (asksTheUser(text)) break;
          // Small models often announce the next step mid-task ("Now I will
          // update main().") and stop. Tell them to go ahead, at most twice per
          // message, and only once work is under way (a tool already ran).
          if (nudges < 2 && toolsUsed > 0 && this.hook('next-step') && announcesNextStep(text)) {
            nudges++;
            this.messages.push({ role: 'user', content: auto('You said what you will do next but did not do it. If you meant to, do it now with the tools; if you are waiting for the user, stop.') });
            continue;
          }
          // Look before answering (a model on another machine, in a project, aboutTheCode): an answer
          // with no look of its own goes back once with the words to search for; a request for work
          // that made a file is not held to it (a new file needs no look). The second time it is
          // let through with a line under it (the owner's pick).
          // A reply cut off at the limit with nothing in it is no answer: the cut handling below has it.
          const lookHeld = this.model?.remote && !this.isHelper && (!isHomeFolder(this.cwd) || Boolean(this.turn.workFolder)) && !(!text.trim() && turn.finish === 'length');
          // Files the app read for it before its first step count as a look (App reads ahead); the opening
          // read and the maps do not (they say where things are, not what is in them).
          const sawCode = this.turn.lookedOwn || (this.turn.given ?? 0) > 0 || this.turn.shown;
          if (lookHeld && this.hook('look-first') && !sawCode && !this.turn.changed && aboutTheCode(this.turn.request)) {
            if (!unlooked) {
              unlooked = true;
              const words = searchWords(this.turn.request);
              this.emit('note', { text: 'It answered without looking at the project; asked it to search first.', tone: 'dim' });
              this.messages.push({ role: 'user', content: auto(`You answered without looking at this project's files. Do not answer about the code from memory: Search for the names in the request${words.length ? ` (for example ${words.map((w) => `"${w}"`).join(', ')})` : ''}, Read what the search finds, then answer from what you saw, naming the files.`) });
              continue;
            }
            this.emit('note', { text: 'Answered without looking at the project\'s files: check it before you rely on it.', tone: 'warn' });
          }
          // The page the request names, never tried (Look before answering): the answer goes back once, with the
          // tool to use; the second time a line under it says the page was not read.
          if (this.turn.web?.urls?.length && !this.turn.fetched && !this.isHelper && this.hook('look-first') && text.trim()) {
            if (!this.turn.webBack) {
              this.turn.webBack = true;
              this.emit('note', { text: `It answered without reading ${this.turn.web.urls[0]}; told it to read the page with WebFetch.`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`You answered without reading ${this.turn.web.urls.slice(0, 3).join(', ')}. WebFetch is one of your tools here and this address is allowed: call it now, then answer from what the page shows. If it fails, tell the user exactly what it answered; do not say you cannot reach the internet without trying.`) });
              continue;
            }
            this.emit('note', { text: `Answered without reading ${this.turn.web.urls[0]}: what it says about that page is not from the page.`, tone: 'warn' });
          }
          // Files that exist: an answer that names files not in the project (and not made this
          // message, nor named in the request) goes back once; the second time, a line says which.
          if (lookHeld && this.hook('real-files')) {
            const missing = this.missingFiles(text);
            if (missing.length) {
              if (!unreal) {
                unreal = true;
                this.emit('note', { text: `It named files that are not in the project (${missing.slice(0, 3).join(', ')}); asked it to check.`, tone: 'dim' });
                this.messages.push({ role: 'user', content: auto(`These files are not in this project: ${missing.join(', ')}. Search for what you meant (Search or List), and answer only with files you have seen in a tool's result.`) });
                continue;
              }
              this.emit('note', { text: `It named files that are not in this project: ${missing.slice(0, 5).join(', ')}.`, tone: 'warn' });
            }
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
          // A skill's check fence: one command before the turn may end. The steps say
          // so too; the loop is what holds it when that sentence loses.
          if (this.turn.fence?.has('check') && !this.turn.ranCommand && asksForWork(this.turn.request) && (this.turn.checkNudges ?? 0) < 2) {
            this.turn.checkNudges = (this.turn.checkNudges ?? 0) + 1;
            this.emit('note', { text: 'This skill requires a command before it is done; asked it to run one.', tone: 'warn' });
            this.messages.push({ role: 'user', content: auto('This skill is not done until a command has checked the work. Run that command with Bash, then answer.') });
            continue;
          }
          // It says the work is done, but nothing changed in this message: no
          // Edit, no Write, and no command that could have written instead
          // (an ls or a git log could not: 3 Oct 2026, that one let it through).
          // Sent back once; if it still claims it with nothing changed, a note
          // under the answer says so. So is an answer that is the change written
          // out as code (Qwen3.6 on hard task 30, the model deciding): nothing
          // was changed, and the user cannot apply it from there.
          const t = this.turn;
          const codeInstead = writesCodeInstead(text);
          if (!t.changed && !t.question && !t.carried && !t.wroteByCommand && this.hook('said-done') && asksForWork(t.request) && (claimsDone(text) || codeInstead)) {
            if (!doneUnchanged) {
              doneUnchanged = true;
              this.emit('note', { text: codeInstead ? 'It wrote the change in its answer, but no file changed; asked it to make the change.' : 'It says the work is done, but no file changed; asked it to look again.', tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(codeInstead ? 'You wrote the change in your answer, but no file was changed: the user cannot apply it from there. Make the change now with Edit or Write, then check it.' : 'You said the work is done, but no file was changed in this message. If the request needs a change, make it now with the tools. If it was really done before this message, say which file has it and that nothing changed now, in one or two sentences.') });
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
          // Answer matches results: it says all passed or it works, but its last run of the checks failed
          // (4 Oct 2026: "All 24 formulas passed" after "Results: 22 passed, 2 failed", exit code 1). Back
          // once with that run's own line; if it still says so, a line under the answer does.
          const lastCheck = this.turn.checks.at(-1);
          if (lastCheck?.failed && claimsAllGood(text) && this.hook('results')) {
            const said = `\`${lastCheck.cmd}\`${lastCheck.counts ? ` printed "${lastCheck.counts}"` : ''}${lastCheck.code ? ` and ended with exit code ${lastCheck.code}` : ''}`;
            if (!this.turn.resultsBack) {
              this.turn.resultsBack = true;
              this.emit('note', { text: `Its answer says everything passed, but its last check run did not (${lastCheck.counts || `exit code ${lastCheck.code}`}); sent it back.`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`Your answer says it all passed or works, but your last run of the checks did not: ${said}. Answer again from that run: what passed, what failed and why, in plain words. If you fixed it since, run the checks again first and answer from that run.`) });
              continue;
            }
            this.emit('note', { text: `Check this answer: its last check run did not pass (${lastCheck.counts || `exit code ${lastCheck.code}`}).`, tone: 'warn' });
          }
          // Stop when blocked: it met a wall (a login, an address or path you gave that is not there) and
          // its answer neither asked you nor says so. Back once to say it and ask; then a line names it.
          const wallMet = this.turn.walls[0];
          if (wallMet && !this.turn.askedUser && !MENTIONS_WALL.test(text) && this.hook('blocked')) {
            if (!this.turn.wallBack) {
              this.turn.wallBack = true;
              this.emit('note', { text: `Its answer leaves out what blocked it (${wallMet.why}); sent it back to say so and ask you.`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`Your answer leaves out what blocked you: ${wallMet.why}. Say it plainly at the start of your answer, say what you did instead (if anything), and ask the user how they want to go on.`) });
              continue;
            }
            this.emit('note', { text: `Not said in the answer: ${wallMet.why}.`, tone: 'warn' });
          }
          // Read before claiming, at the end: the answer says it found what it needs while files it leans
          // on were seen only as outlines. Back once to read the part; the step-by-step line (followDue)
          // covers the replies before.
          if (!this.turn.readFirstSent && this.turn.outlined.size && claimsFound(text) && this.hook('read-first')) {
            this.turn.readFirstSent = true;
            const names = [...this.turn.outlined].slice(0, 3).map((f) => basename(f));
            this.emit('note', { text: `It says it found what it needs, but saw only the outline of ${names.join(', ')}; sent it back to read the part.`, tone: 'warn' });
            this.messages.push({ role: 'user', content: auto(`You wrote that you found or have what you need, but of ${names.join(', ')} you have seen only the outline: its parts and line numbers, none of its text. Read the part you need (offset and limit, or find), then answer from what it says.`) });
            continue;
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
            // Counted with the cut-off calls: told the same thing three times running, it stops
            // (it was sent back with no end: three in a row on 3 Oct, until you pressed esc).
            cuts++;
            const size = `${kTok(turn.tokens)} of ${kTok(this.lastRoom ?? turn.tokens)} tokens`;
            if (cuts >= 3) {
              reason = 'stuck';
              this.emit('note', { text: `Three replies in a row were cut off at the reply limit (${size}), so it stopped. Raise Reply length in /effort, or ask for the file in smaller pieces.`, tone: 'warn' });
              break;
            }
            // Cut at your own Reply length (/effort) while the context has room for twice as much:
            // this step once more with that room, for the rest of the message (4 Oct 2026: Qwen3.6
            // at 8.2k thought for 3½ minutes and none of its page arrived; "build it in parts" made
            // one write many steps). Ollama's limit holds the thinking and the answer together.
            const own = this.model?.replyTokens;
            const more = Math.min(SERVICE_REPLY, Math.floor(this.ctx * this.trimAt) - this.estNow());
            if (own && !this.turn.roomUp && more >= own * 2) {
              this.turn.roomUp = more;
              this.messages.pop();
              this.emit('note', { text: `The reply was cut off at your Reply length (${size}) before anything arrived; this step goes again with ${kTok(more)} of room. Raise Reply length in /effort to keep it.`, tone: 'warn' });
              continue;
            }
            // The thinking took the room: think less. Little or no thinking (a model that cannot
            // think, like qwen3-coder-next): it was writing a call, most likely a file, and Ollama
            // hands back nothing of a tool call cut at the limit, so "think less" was the wrong advice.
            if (tokensOf(turn.reasoning) >= turn.tokens * 0.6) {
              this.messages.push({ role: 'user', content: auto('You ran out of room while thinking. Think less and take the next step.') });
              this.emit('note', { text: `The model ran out of room while thinking (${size}); asked it to act.`, tone: 'warn' });
            } else {
              this.messages.push({ role: 'user', content: auto(emptyCutNote()) });
              this.emit('note', { text: `The reply was cut off at the limit (${size}) and nothing of it arrived, most likely a file too long for one reply: asked it to build the file in parts.`, tone: 'warn' });
            }
            continue;
          }
          // It says it is done after changing files but never ran the tests:
          // run them (through the normal permission prompt); if they fail, send
          // it back to fix them. At most twice per message.
          const checkCmd = this.turn.check ?? (this.turn.bug?.kind && !this.turn.bug.kind.testsSeeIt ? null : this.testCmd);
          // Only a file on the Desktop changed: the project's tests cannot see it (3 Oct: a helper's
          // .md for the Desktop started the whole suite, more than 10 minutes on this Mac).
          const onlyAway = this.turn.changedAway && !this.turn.changedHere && !this.turn.check;
          if (checkCmd && this.turn.changed && !onlyAway && !this.turn.testedAfterChange && checks < 2 && this.hook('tests')) {
            checks++;
            const call = { id: `check_${Date.now()}`, name: 'Bash', args: JSON.stringify({ command: checkCmd, description: this.turn.check ? 'Run the check the request names' : 'Check the change with the project’s tests' }) };
            assistant.tool_calls = [{ id: call.id, type: 'function', function: { name: 'Bash', arguments: call.args } }];
            this.emit('note', { text: `Checking the change: ${checkCmd}`, tone: 'dim' });
            const out = await this.runTool(call, signal);
            const checkMsg = { role: 'tool', tool_call_id: call.id, content: out.text, ...(out.images?.length ? { images: out.images } : {}) };
            this.messages.push(checkMsg);
            if (out.stop) { reason = out.stop; break; }
            if (out.error) {
              this.noteError(out.text, checkMsg);
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
          // (flows/layoutcheck.mjs). What is broken goes back; after the fix
          // it looks again, and what is left goes back once more
          // (LAYOUT_ROUNDS); after that the turn ends with "Still broken".
          // Asking first (askPage), it looks only when you said "Check it", further down.
          if (this.turn.changed && !layoutDone && !signal?.aborted && this.hook('layout') && (!this.askFirst() || layoutSends >= LAYOUT_ROUNDS)) {
            const found = await this.checkLayout(layoutSends > 0, { send: layoutSends < LAYOUT_ROUNDS });
            if (found && layoutSends < LAYOUT_ROUNDS) {
              layoutSends++;
              this.messages.push({ role: 'user', content: auto(found) });
              continue;
            }
            layoutDone = true;
          }
          // A page asked for "on my desktop" saved somewhere else, when the
          // Desktop is inside this folder: back once, with the command that
          // moves it (Qwen, 30 Sep: "download it to my desktop" became
          // ~/media-player-card.html, a cp onto itself, and "ready on your
          // Desktop"). Outside this folder, the end of the turn offers a copy.
          if (this.turn.changed && !desktopSent && !signal?.aborted && this.hook('desktop') && this.desktopInside() && asksForWork(this.turn.request) && wantsDesktop(this.turn.request)) {
            const away = this.pagesOffDesktop();
            if (away.length) {
              desktopSent = true;
              const shq = (p) => (/^[\w./-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`);
              const moves = away.map((p) => `mv ${shq(relative(this.cwd, p.abs))} ${shq(relative(this.cwd, this.desktopTarget(p.abs)))}`);
              const names = away.map((p) => this.tilde(p.abs)).join(' and ');
              this.emit('note', { text: `Asked for on the Desktop, but ${names} ${away.length === 1 ? 'is' : 'are'} not there; asked it to move ${away.length === 1 ? 'it' : 'them'}.`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`The request asks for the file on the Desktop, but ${names} ${away.length === 1 ? 'is' : 'are'} not on the Desktop. Move ${away.length === 1 ? 'it' : 'them'} there with Bash: ${moves.join(', then ')}. Then say where ${away.length === 1 ? 'it is' : 'they are'} now, with the full path, in one sentence.`) });
              continue;
            }
          }
          // What a reader sees (page-read.mjs): each page this message wrote, opened before the answer
          // stands; one mostly empty to a reader goes back once, and is read again after its fix.
          if ((pageReads === 0 || (pageReads === 1 && this.turn.pageSentBack)) && !signal?.aborted && this.hook('page-read') && pageReadOn()) {
            pageReads++;
            const back = await this.readPages({ send: pageReads === 1 });
            if (back) { this.turn.pageSentBack = true; this.messages.push({ role: 'user', content: auto(back) }); continue; }
          }
          // A page this message changed, and asking first: it is yours to look at before any check
          // (askPage), now that the model says it is done and the page is where it was asked for.
          if ((this.turn.changed || this.madePages().length) && !layoutDone && !signal?.aborted && this.askFirst() && layoutSends < LAYOUT_ROUNDS) {
            const pages = pagesToCheck(this.cwd, [...(this.turn.startTexts?.keys() ?? []), ...this.madePages()]);
            if (pages.length) {
              const a = await this.askPage(pages, signal, { again: layoutSends > 0 });
              if (a.end) { reason = a.end; break; }
              if (a.send) { if (a.fix) layoutSends++; this.messages.push({ role: 'user', content: a.send }); continue; }
              layoutDone = true;
            }
          }
          // UI design · checks (/subagents): a picture of a page it built, looked at by a
          // helper that sees; what looks off goes back once (after the measured layout check).
          if (this.turn.changed && !looked && !signal?.aborted && !this.turn.pageAsked && this.helperUse('designCheck')) {
            looked = true;
            const found = await this.lookAtPages(signal);
            if (found) { this.messages.push({ role: 'user', content: auto(found) }); continue; }
          }
          // The request's cases (cases.mjs): each case of its plan needs a test file changed in this message
          // that tries its example. Back twice with the ones still untested; then a line names them.
          if (this.turn.changed && this.model?.remote && this.hook('cases') && !this.turn.casesDone && !signal?.aborted) {
            const cases = this.turn.cases ?? [];
            if (cases.length) {
              const tests = [...(this.turn.wrote?.keys() ?? [])].filter(isTestPath).map((rel) => { try { return readFileSync(join(this.cwd, rel), 'utf8'); } catch { return ''; } }).join('\n');
              const missing = untested(cases, tests);
              if (!missing.length) this.turn.casesDone = true;
              else if ((this.turn.casesBacks ?? 0) < 2) {
                this.turn.casesBacks = (this.turn.casesBacks ?? 0) + 1;
                this.emit('note', { text: `${missing.length} of the ${cases.length} cases in its plan have no test yet: sent back (${this.turn.casesBacks} of 2).`, tone: 'warn' });
                this.messages.push({ role: 'user', content: auto(casesBack(missing)) });
                continue;
              } else {
                this.turn.casesDone = true;
                this.emit('note', { text: `Untested cases from its plan: ${missing.map((c) => c.example).join(' · ')}`, tone: 'warn' });
              }
            }
          }
          // Case review (cases.mjs): once a message, when the cases have their tests or their send-backs are
          // used up, a call of its own reads the changed code against each case; what reads wrong goes back once.
          if (this.turn.changed && this.model?.remote && this.hook('case-review') && !this.turn.caseReviewed && this.turn.cases?.length && !signal?.aborted) {
            this.turn.caseReviewed = true;
            const read = await this.reviewCases(signal);
            if (read && !signal?.aborted) { this.messages.push({ role: 'user', content: auto(read) }); continue; }
          }
          // It changed files and says it is done: does the work cover every
          // part of the request? Once per message; a miss sends it back. Not
          // after you were asked to look at the page yourself (askPage).
          if (this.turn.changed && this.verify && !verified && !signal?.aborted && this.hook('done') && !this.turn.pageAsked) {
            verified = true;
            const miss = await this.verifyDone(text, signal);
            if (miss) {
              this.emit('note', { text: `Not finished: ${miss}`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`A quick check (it can be wrong) thinks this may be missing: ${miss}. Look once. If it is actually fine, say so in one sentence and stop; otherwise fix it with the tools, run the tests if there are any, then report.`) });
              continue;
            }
          }
          // Second opinion (/subagents): another model on the service reads the request and
          // the diff; what it finds goes back once. It can be wrong, and the model is told so.
          // /agents asks it at its own moments instead (agents-run.mjs: reviewInTurn off).
          if (this.turn.changed && !reviewed && !signal?.aborted && this.turn.diffs && this.reviewInTurn !== false && this.helperUse('review')) {
            reviewed = true;
            const found = await this.secondOpinion(signal);
            if (found) { this.messages.push({ role: 'user', content: auto(found) }); continue; }
          }
          // Second look (second-look.mjs): the answer against what happened, once a message, after real work.
          if (!signal?.aborted && text.trim()) {
            const back = await this.lookDue(text, signal);
            if (signal?.aborted) { reason = 'interrupted'; break; }
            if (back) { this.messages.push({ role: 'user', content: auto(back) }); continue; }
          }
          // Your Stop hooks (user-hooks.mjs): exit 2 sends it back to work with what the hook says,
          // STOP_BACKS times at most in one message (stop_hook_active says it was sent back already).
          if (this.userHooks?.has('Stop') && !this.isHelper && !signal?.aborted && stopBacks < STOP_BACKS) {
            const r = await this.userHooks.run('Stop', { stop_hook_active: stopBacks > 0, last_assistant_message: text }, { signal, permissionMode: this.mode });
            if (r.block) {
              stopBacks++;
              this.emit('note', { text: `Your stop hook sent it back: ${(r.reason || 'it said no').split('\n')[0].slice(0, 160)}`, tone: 'dim' });
              this.messages.push({ role: 'user', content: auto(`A hook of the user's says the work is not done: ${r.reason || 'it said no'}. Carry on, then report.`) });
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
        const wrote = []; // the Writes of this reply that saved (a page among them: askPage)
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
          // It looked at something besides an MCP server (a file, a search, a command): see the MCP send-back above.
          if (!out.error && !isMcpCall(c.name) && !['List', 'TodoWrite', 'Ask'].includes(c.name)) this.turn.lookedElsewhere = true;
          if (c.name === 'Read' && !out.error) this.turn.readsRun = (this.turn.readsRun ?? 0) + (out.readKeys?.length || 1);
          // A look of its own at the project (lookFirst below): a read, a search, a list, a command that only reads.
          if (!out.error && (LOOK_TOOLS.has(c.name) || (c.name === 'Bash' && isReadOnly(String(parseArgs('Bash', c.args).args?.command ?? ''))))) this.turn.lookedOwn = true;
          if (!out.error) { cuts = 0; landed = true; } // a step landed: cut-off replies are no longer "in a row"
          if (!out.error && c.name === 'Write') wrote.push(c);
          // A background job that ended meanwhile is told with this step's result.
          const news = this.takeJobNews();
          const result = { role: 'tool', tool_call_id: c.id, content: news ? `${out.text}\n\n(Meanwhile: ${news})` : out.text, ...(out.images?.length ? { images: out.images } : {}) };
          this.messages.push(result);
          if (out.error) this.noteError(out.text, result);
          else if (/^(?:Rules\/)?SKILLS\//.test(String(out.text))) result.keep = 'skill';
          if (out.images?.length) this.ctxUsed += out.images.length * IMAGE_TOKENS;
          for (const r of out.readKeys ?? (out.readKey ? [out] : [])) this.turn.reads.set(r.readKey, { msg: result, mtime: r.mtime, ...(r.next ? { outline: Boolean(r.outline), next: r.next, total: r.total } : {}) });
          if (out.stop) stopped = out.stop;
        }
        if (stopped) { reason = stopped; break; }
        if (signal?.aborted) { reason = 'interrupted'; break; }
        // Its plan and your request, with this step's result, when it has not seen them for a while,
        // and the line that brings it back when the check says it moved off (on the end, so the
        // conversation before it is not read again).
        const plan = this.planDue(calls);
        const chased = this.noteChaseDue(`${turn.reasoning ?? ''}\n${text ?? ''}`);
        const asked = chased ? '' : this.requestDue();
        const nudge = await this.driftDue(signal);
        if (signal?.aborted) { reason = 'interrupted'; break; }
        const cases = await this.casesDue(calls, signal);
        if (signal?.aborted) { reason = 'interrupted'; break; }
        const follow = this.followDue(calls, text);
        // A loop's notes: those a focused path read before it handed over (carriedNotes), then any typed since.
        const stepped = this.messages.at(-1)?.role === 'tool';
        const fresh = stepped ? this.steering?.() ?? [] : [];
        const typed = [...(stepped ? this.carriedNotes?.splice(0) ?? [] : []), ...fresh];
        const said = typed.length ? `(A note from the user, sent while you worked: ${typed.join(' · ')})` : '';
        const extra = [plan, chased, asked, nudge, cases, ...follow, said].filter(Boolean);
        if (extra.length && this.messages.at(-1)?.role === 'tool') {
          this.messages.at(-1).content += `\n\n${extra.join('\n')}`;
          if (fresh.length) this.emit('steered', { notes: fresh });
          if (plan) this.emit('note', { text: `Reminded it of its plan: ${plan.match(/\d+ of \d+ steps done/)[0]}`, tone: 'dim' });
          if (asked) this.emit('note', { text: 'Reminded it of your request', tone: 'dim', fold: true });
        }
        // A page saved for this request: the turn stops here, the page opens, and you are asked
        // before anything checks it (askPage). Once a message; after that the end of it asks.
        const page = wrote.length && !this.turn.pageAsked && this.askFirst() ? this.savedPage(wrote) : null;
        if (page) {
          const a = await this.askPage([page], signal, { saved: true });
          if (a.end) { reason = a.end; break; }
          if (a.send) { if (a.fix) layoutSends++; this.messages.push({ role: 'user', content: a.send }); continue; }
        }
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
        // A Read moved on to a long file's next part (runTool) got new lines: not a repeat.
        const paged = this.turn.paged;
        this.turn.paged = false;
        // A command that says something new is not the same step again (a job watched, a list after a change).
        // Numbers apart: a test run's times differ every run, and the same failing run is the same step.
        const outText = String(out?.text ?? '');
        const sameWords = (a, b) => a.replace(/\d+(?:\.\d+)?/g, '#') === b.replace(/\d+(?:\.\d+)?/g, '#');
        const saidNew = key === repeatKey && calls.length === 1 && calls[0].name === 'Bash' && !sameWords(outText, repeatOut);
        repeats = key === repeatKey && !paged && !saidNew ? repeats + 1 : 0;
        repeatKey = key;
        repeatOut = outText;
        // Looking again is not being stuck yet: a model reads a file twice to have it fresh, and the third Read
        // gives the text again (runTool). For looks the question, and the stop after it, come one step later.
        const askAt = calls.length && calls.every((c) => LOOK_TOOLS.has(c.name)) ? 3 : 2;
        // A reply of only TodoWrite calls that failed is not one more error in a row: a plan sent in the
        // wrong shape harms no work (4 Oct 2026: Qwen3.6 was stopped by five of them, the repeat stop still holds).
        errorsInRow = landed ? 0 : calls.length && calls.every((c) => c.name === 'TodoWrite') ? errorsInRow : errorsInRow + 1;
        this.turn.errorsInRow = errorsInRow;
        if (repeats > askAt || errorsInRow >= 5) {
          reason = 'stuck';
          this.emit('note', { text: repeats > askAt ? 'It kept repeating the same step, so it stopped. Try rephrasing the task, or give it a hint.' : 'Five tool errors in a row, so it stopped. Try rephrasing the task, or give it a hint.', tone: 'warn' });
          await this.lastWord(repeats > askAt ? 'you kept repeating the same step' : 'five steps in a row failed', signal);
          break;
        }
        // The same step a second time: the app says why nothing changed, to the model and in that step's own
        // words (sameStepNote), and you are not asked (5 Oct 2026, the owner's picks: before, the second time
        // asked you at once, with one choice, Keep going, which let it do the same again).
        if (repeats === 1) {
          const plan = this.turn.planAt != null ? this.todos ?? [] : [];
          const said = sameStepNote(call?.name, outText, plan.find((x) => x.status === 'pending')?.text ?? '');
          if (said) this.messages.push({ role: 'user', content: auto(said) });
        }
        // Stuck: the same step a third time (a look: a fourth), or three errors in a row, and it asks you,
        // with ways out as choices. An answer starts the counts over; a step asked about once is not asked
        // about again in this message (Read of one file six times asked three times in a minute, 2 Oct).
        // With no one to answer (coding -p, the practice bench) it carries on and the limits above stop it.
        const repeatAsk = repeats === askAt && !this.turn.stuckSteps.has(key);
        if ((repeatAsk || errorsInRow === 3) && this.checkIns && !checkedIn && this.hook('stuck')) {
          const s2 = await this.stuckAsk(repeatAsk ? 'repeat' : 'errors', call, out, signal, { tries: repeats + 1 });
          if (s2?.stop) { reason = s2.stop; break; }
          if (s2?.text) this.messages.push({ role: 'user', content: s2.text });
          if (repeatAsk && s2?.text) this.turn.stuckSteps.add(key);
          if (s2?.text) { repeats = 0; repeatKey = null; errorsInRow = 0; }
        }
        if (repeats === askAt) this.messages.push({ role: 'user', content: auto(SAME_STEP) });
        if (step === this.maxSteps - 1) { reason = 'limit'; this.emit('note', { text: `Stopped after ${this.maxSteps} steps (/effort moves this).`, tone: 'warn' }); }
      }
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') reason = 'interrupted';
      else { reason = 'error'; this.emit('note', { text: e.message, tone: 'error' }); }
    } finally {
      this.busy = false;
      try {
        const why = this.putBackWhy(reason);
        // A bench that scores part of the work (AGENTIC_PUT_BACK=off; the model shootout, 4 Oct 2026):
        // the changes stay to be scored, and the note says what the app would have done.
        if (why && process.env.AGENTIC_PUT_BACK === 'off') this.emit('note', { text: `${why}: the app would put this message's changes back; they stay to be scored (AGENTIC_PUT_BACK=off).`, tone: 'dim' });
        else if (why) {
          const { back, left } = this.putBack();
          if (back.length) this.emit('note', { text: `${why}, so this message's changes were put back: ${back.join(', ')}.`, tone: 'warn' });
          if (left.length) this.emit('note', { text: `Not put back, because they changed after the last edit: ${left.join(', ')}.`, tone: 'warn' });
        }
      } catch (e) { this.emit('note', { text: `Could not put the changes back (${e.message}).`, tone: 'warn' }); }
      this.turn?.scratch?.dispose();
    }
    if (reason === 'interrupted') {
      this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
    }
    const t = this.turn ?? {};
    // The prompt cache of a model on another machine: the notes that went with this request stay
    // in it, written in, so the next message starts from the same text the service has cached. Left
    // to come and go, they changed the request and the service read everything after it again.
    if (this.remoteSet()) this.bakeTurnNotes();
    await this.stillBroken(reason);
    await this.deliverDesktop(reason);
    this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000, steps: t.steps ?? 0, reads: (t.readsRun ?? 0) + (t.given ?? 0), readFirst: t.ranked?.files?.length ?? 0, thinkTokens: t.thinkTokens ?? 0, tokens: t.tokens ?? 0, stuckAsks: t.stuckAsks ?? 0, made: this.madeSummary() });
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
    // Matched on what the request is about, not on how it asks to be answered (claude-notes.mjs topicOf).
    const topic = topicOf(text);
    const r = await recall(this.cwd, topic, { embedder: this.memory.embedder ?? null, home: this.memory.home, signal, retriever: this.search.retriever, reranker: this.reranker });
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
    const c = await this.rememberClaude(topic, goesAlong, signal);
    for (const n of c?.notes ?? []) items.push({ from: 'Claude', text: n.name.replace(/-/g, ' '), close: n.close, tokens: tokensOf(n.part) });
    // With Claude's notes after it, the request again at the end, so the last thing read is the request
    // (4 Oct 2026: 7,000 characters of notes followed a 420-character request, and a question one of them
    // quoted was taken for it).
    if (c?.notes?.length && request?.role === 'user' && typeof request.content === 'string') {
      const words = String(text).replace(/\s+/g, ' ').trim();
      request.content += `\n\n(This message's request, the one to answer; what is above it is background: "${words.length > 900 ? `${words.slice(0, 899)}…` : words}")`;
    }
    // Said on the line when /effort's Search rows changed how they were chosen.
    const chosen = [r.chosen, c?.chosen].find((x) => x && (x.order === 'hybrid' || x.reranked));
    if (items.length) this.emit('context', { items, tokens: added, ms: Date.now() - t0, how: r.how, ...(chosen ? { chosen: howChosen(chosen, r.how) } : {}) });
  }

  // Claude's notes (claude-notes.mjs): what Claude Code wrote down about the
  // user's work, read where it is. Up to four notes that fit the request
  // go along with it, as the saved facts do (two in a memory of 16k or less,
  // where the request's start must leave room to work: 1 Oct). They are never
  // counted for or against (no trust): Agentic Coder does not change them.
  async rememberClaude(text, goesAlong, signal) {
    const c = this.memory.claude;
    if (!c) return;
    const dir = c === true ? notesDir() : notesDir({ setting: c.dir ?? c });
    if (!dir) return;
    let r;
    // A service that is not the owner's own machine gets only the notes about this project (Memory sent).
    const sent = this.notesSent();
    try { r = await recallClaude(this.cwd, text, { embedder: this.memory.embedder ?? null, dir, store: c.store, kind: routeByRules(text)?.kind ?? null, signal, retriever: this.search.retriever, reranker: this.reranker, top: this.ctx <= 16384 ? SMALL_CTX_NOTES : undefined, sent }); } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; return; }
    if (!r.notes.length) return;
    const said = claudeText(r.notes, { pack: Boolean(this.notesView()) });
    goesAlong(said);
    if (this.happened) this.happened.claude = r.notes.map((n) => n.id);
    this.claudeCame = true; // for this message: a step that is turned away points back at the note (runTool)
    this.claudeSaid = said; // which places the notes name (noteNames)
    this.emit('memory', { claude: r.notes.map((n) => ({ id: n.id, name: n.name, type: n.type, ...(n.project ? { project: n.project } : {}), close: n.close, chars: n.part.length })), how: r.how, ms: r.ms, of: r.of, sent });
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

  // Whether Claude's notes with this request name a place (its last part, as "notes.md" or
  // "MATH"): only then does a step turned away for being outside the folder point back at them.
  // On 3 Oct 2026 a script refused for "/" (a division) was told to answer from an unrelated
  // note, and the model gave up on the user's own files.
  noteNames(where) {
    const last = basename(String(where ?? '').trim().replace(/\/+$/, ''));
    return Boolean(this.claudeCame && last.length > 2 && String(this.claudeSaid ?? '').includes(last));
  }

  // A model on another machine (prompt-files.mjs, the remote set).
  remoteSet() { return (this.rulesSetUsed ?? this.rulesSet()) === 'remote'; }

  // This turn's notes (withTurnNotes) written into its request for good, once the turn is over.
  bakeTurnNotes() {
    const t = this.turn;
    if (!t?.requestMsg || t.baked) return;
    const [m] = this.withTurnNotes([t.requestMsg]);
    if (m !== t.requestMsg) t.requestMsg.content = m.content;
    t.baked = true;
  }

  // The opening read (opening.mjs): once a conversation on the remote set, as a step the model did not
  // have to take, a List of the project folder, and on the screen as "Reading all memory files". A step,
  // because Qwen3.6 writes its first call as plain JSON text ({"file": "convert.mjs"}) when the
  // conversation has no call in it to follow (3 Oct 2026: every hard task, with the read written into
  // the request instead). A List, not the Bash it stands for: given a Bash, it ran git log and ls -la
  // itself twice more and copied the Bash's "description" into its Reads. A trim, the notes or /rewind
  // can take it away: then it comes again.
  giveOpening(text = '') {
    if (this.isHelper || !openingOn() || !this.remoteSet()) return;
    if (this.messages.some((m) => m.opening && !String(m.content).startsWith('[older output removed'))) return;
    let r = null;
    // Facts about the user go in full only to the owner's own other computer (opening.mjs memorySent).
    const sent = memorySent(this.model);
    // The maps go with it (opening.mjs mapsRead): the code map, and Claude's notes as Memory sent allows.
    let maps = null;
    try { maps = mapsRead(this.cwd, { ctx: this.ctx, request: text, notes: this.notesView() }); } catch { /* left out */ }
    try { r = openingRead(this.cwd, { memory: sent === 'none' ? null : this.memory, home: this.memory?.home ?? this.home, you: sent === 'all', maps }); } catch { return; }
    if (!r) return;
    const id = `opening_${Date.now()}`;
    this.messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'List', arguments: JSON.stringify({ path: '.' }) } }] });
    this.messages.push({ role: 'tool', tool_call_id: id, content: r.body, opening: true });
    this.ctxUsed += tokensOf(r.body) + 30;
    this.emit('tool', { id, name: 'List', label: r.view.title, arg: r.args.command, view: r.view, given: true });
  }

  // The files an answer names that are not in this project: not at that path, and no file of the
  // project has that name or ends with that path. Left out: files the request names (it may ask
  // about one that is gone), files made this message, places outside the project (~/…, /…).
  missingFiles(text) {
    // From the home folder, the folder the request names stands for the project (turn.workFolder).
    const base = this.turn?.workFolder ?? this.cwd;
    const request = String(this.turn?.request ?? '');
    // A full path into that folder is looked at where it says (4 Oct 2026: answers there name files by their full path).
    const full = this.turn?.workFolder ? fullPathsIn(text, base).filter((p) => !request.includes(p) && !existsSync(p) && !(this.turn?.created ?? []).some((c) => p.endsWith(String(c).replace(/^\.\//, '')))) : [];
    const named = filesInAnswer(text).filter((p) => !/^(~|\/)/.test(p) && !request.includes(p));
    if (!named.length) return full;
    let all = this.turn?.projectFiles;
    if (!all) { try { all = projectFiles(base); } catch { all = []; } if (this.turn) this.turn.projectFiles = all; }
    const made = new Set((this.turn?.created ?? []).map((f) => String(f).replace(/^\.\//, '')));
    const names = new Set(all.map((f) => f.split('/').pop()));
    return named.filter((p) => {
      const rel = p.replace(/^\.\//, '');
      if (made.has(rel) || [...made].some((m) => m.endsWith(`/${rel}`) || m.split('/').pop() === rel)) return false;
      if (existsSync(join(this.cwd, rel)) || existsSync(join(base, rel)) || (/^SCRIPTS\//.test(rel) && existsSync(resolvePath(this.cwd, rel).abs))) return false;
      return rel.includes('/') ? !all.some((f) => f === rel || f.endsWith(`/${rel}`)) : !names.has(rel);
    }).concat(full);
  }

  // What of Claude's notes this model may be given: all of them on this Mac and on the owner's own
  // machine, else only those about this project, or none (opening.mjs memorySent, /remote's Memory sent).
  notesSent() {
    return this.model?.remote ? memorySent(this.model) : 'all';
  }

  // The pack of Claude's notes (claude-pack.mjs) as this model may see it: its map, its topics and
  // notes under NOTES/. null with the notes off, no pack, or nothing this model may see.
  notesView() {
    const c = this.memory?.claude;
    if (!c) return null;
    const named = c === true ? null : c.dir ?? c;
    const dir = typeof named === 'string' ? (existsSync(join(named, 'pack.json')) ? named : existsSync(join(dirname(named), 'pack.json')) ? dirname(named) : null) : packDir();
    if (!dir) return null;
    try { return packView(dir, { sent: this.notesSent(), cwd: this.cwd, home: this.home }); } catch { return null; }
  }

  // The maps for a model of the local set (on this Mac): the code map (docs/map/MAP.md) and Claude's
  // notes map, as much of each as its context has room for, once a conversation, as a step it did
  // not have to take, like the opening read (not counted as conversation: said()). A model of the
  // remote set gets them in its opening read (giveOpening).
  giveMaps(text = '') {
    if (this.isHelper || this.remoteSet() || !openingOn()) return;
    // Once while it is in the conversation; trimmed away or summarized, it comes again.
    if (this.messages.some((m) => m.maps && !String(m.content).startsWith('[older output removed'))) return;
    let maps = null;
    try { maps = mapsRead(this.cwd, { ctx: this.ctx, request: text, notes: this.notesView() }); } catch { return; }
    if (!maps) return;
    const body = `Agentic Coder read these for you before your first step; do not read them again.\n\n${maps.parts.join('\n\n')}`;
    const id = `maps_${Date.now()}`;
    this.messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'List', arguments: JSON.stringify({ path: MAP_DIR }) } }] });
    this.messages.push({ role: 'tool', tool_call_id: id, content: body, maps: true });
    this.ctxUsed += tokensOf(body) + 30;
    this.emit('tool', { id, name: 'List', label: 'Reading the maps', arg: maps.commands.join('; '), view: { kind: 'opening', title: 'Reading the maps', command: maps.commands.join('; '), lines: maps.lines, content: body }, given: true });
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
    const r = await execute('Read', { path: f.rel }, {}, { cwd: this.cwd, request: text, maxResultChars: this.maxResultChars, read: this.model?.harness?.read });
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
    if (on.ranked) { try { ranked = await rankFiles(this.cwd, text, { embedder: this.searchEmbedder ?? this.ranker ?? this.memory?.embedder ?? null, entries, signal, retriever: this.search.retriever, reranker: this.reranker }); } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; } }
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
    if (this.turn) this.turn.shown = true; // the app looked for it (lookFirst counts it)
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
    let scratch;
    try {
      scratch = new Scratch(this.cwd);
      const r = await scratch.run(this.testCmd, { signal, timeoutMs: TESTS_FIRST_MS });
      return { cmd: this.testCmd, out: r.out ?? '', code: r.code, timedOut: r.timedOut, secs: (r.ms ?? 0) / 1000 };
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') throw e;
      return null;
    } finally { scratch?.dispose(); }
  }

  // A turn stopped as stuck still answers the user: one short reply without tools, saying
  // what it found, what blocked it and what to try. Without a usable reply (it wrote a call,
  // nothing, or the service failed), the app says what the turn did. Before (3 Oct 2026) the
  // user got only the warning line after five minutes of work.
  async lastWord(why, signal) {
    if (signal?.aborted) return;
    let text = '';
    let turn = null;
    try {
      this.messages.push({ role: 'user', content: auto(STUCK_WORD(why)) });
      turn = await this.generate(signal, { textOnly: true, maxTokens: 700 });
      if (!turn.aborted) text = beforeCall(turn.text ?? '').trim();
      if (turn.calls?.length || toolCallInText(text)) text = '';
    } catch (e) { if (signal?.aborted || e.name === 'AbortError') return; }
    if (signal?.aborted) return;
    if (!text) {
      const did = (this.happened?.did ?? []).slice(-6).map((d) => `- ${d.replace(/\s+/g, ' ').slice(0, 120)}`);
      text = `I stopped because ${why}, before I had an answer.${did.length ? `\nThe last steps:\n${did.join('\n')}` : ''}\nTell me where to look or what to try, or rephrase the task.`;
    }
    this.messages.push({ role: 'assistant', content: text });
    this.emit('assistant', { text, reasoning: turn?.reasoning ?? '', secs: turn?.secs ?? 0, thinkSecs: turn?.thinkSecs ?? 0, tokens: turn?.tokens ?? 0, final: true });
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
        let text = beforeCall(turn.text).trim();
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
      const out = await saveLessons({ url: this.url, model: this.model, slot: this.slots?.side, use: this.sideUse(), cwd: this.cwd, home: this.memory.home, lessons: this.lessons, messages: this.messages.slice(0, -1), signal, embedder: this.memory.embedder, why: 'update memory', request });
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
  async generate(signal, { retry = true, textOnly = false, maxTokens: cap, focus, noThink = false } = {}) {
    // A retry after an answer that skipped the MCP tool its request is about (mcpFocus): this one
    // step offers only that tool, and thinks (a model that cannot think answers without it).
    if (focus === undefined) { focus = this.turn?.mcpFocus ?? null; if (this.turn) this.turn.mcpFocus = null; }
    const thinking = (this.thinking || Boolean(focus)) && !noThink && !this.turn?.overThought && !this.serviceSteppedDown();
    const sampling = thinking ? this.model.thinkingSampling : this.model.sampling;
    // A model on a service with its own Reply length (/effort): up to that, never more than the
    // context has left under the trim line (at least the answer's 2,048).
    // One that cannot think (a single level: a remote's None) gets no room for thinking.
    // Auto on a service: SERVICE_REPLY, the same way (its thinking and its file both fit).
    const own = this.turn?.roomUp || this.model?.replyTokens || (this.model?.remote?.ollama ? SERVICE_REPLY : 0);
    const thinks = thinking && (this.model?.thinkingLevels?.length ?? 2) > 1;
    const maxTokens = cap ?? (own ? Math.max(2048, Math.min(own, Math.floor(this.ctx * this.trimAt) - this.estNow())) : replyRoom(thinks, this.model?.thinkingBudget));
    this.lastRoom = maxTokens;
    // fitContext keeps the answer's 2,048 and this much thinking free: in a tight
    // memory the thinking shrinks (thinkRoom), not the answer.
    const think = this.thinkRoom();
    const thinkCap = thinking && think < (this.model?.thinkingBudget ?? 2048) ? think : undefined;
    const effort = this.stepEffort();
    const t0 = Date.now();
    let firstToken = null;
    let thinkEnd = null;
    let measured = null; // the server's own speed for this request (llama.cpp, Ollama); none from the Claude API or OpenRouter
    let written = 0; // the tokens the service says it wrote, for timing one that sends no speed
    const turn = { reasoning: '', text: '', calls: [], finish: null, tokens: 0 };
    const local = new AbortController();
    const onAbort = () => local.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    // Stopped already (during the warm-up, say): the listener above never fires then, so the
    // request would go out and run to its end. It is not sent.
    if (signal?.aborted) local.abort();
    // The screen's meters: the most this reply may write, and its thinking cap.
    // whole: an Ollama service sends a tool call whole when it is written, so a long one streams nothing (screen.jsx says so).
    // The thinking meter's limit: where the service takes no cap, the reply's room, which holds it.
    // An Ollama service takes no thinking cap, so the app holds one itself: a reply that thinks past the
    // model's thinking budget is stopped and asked for once more with thinking off (5 Oct 2026: one reply
    // of Qwen3.6 thought for 14 minutes, 28.4k tokens, to the end of its reply room, in a 25-minute task).
    const serviceCap = thinking && endpointOf(this.url)?.ollama ? this.model?.thinkingBudget ?? 4096 : 0;
    this.emit('waiting', { room: maxTokens, thinkCap: !thinking ? 0 : serviceCap ? serviceCap : !this.capsThinking() ? maxTokens : this.steppedDown() ? STEP_DOWN_CAP : thinkCap ?? this.model?.thinkingBudget ?? 2048, whole: Boolean(endpointOf(this.url)?.ollama) });
    this.answering = (this.answering ?? 0) + 1;
    try {
      // Text only: the model may still start writing a call out as text, so the server stops there.
      const stream = streamChat({ url: this.url, conversation: this.conversation, messages: this.withTurnNotes(this.messages), tools: focus ? this.mcpFocusTools(focus) : this.tools(), toolChoice: textOnly ? 'none' : 'auto', extra: (() => { const conn = textOnly ? [] : this.mcpConnectors(); return textOnly || conn.length ? { ...(textOnly ? { stop: CALL_STOPS } : {}), ...(conn.length ? { mcpServers: conn } : {}) } : undefined; })(), thinking, effort, model: this.model, sampling, maxTokens, thinkCap, slot: this.slots?.main, signal: local.signal, parallel: this.way === 'model' && !textOnly, use: this.turn?.use });
      for await (const ev of stream) {
        if (ev.type !== 'done' && firstToken === null) firstToken = Date.now();
        if (ev.type === 'reasoning') {
          turn.reasoning += ev.text;
          this.emit('reasoning', { text: ev.text, all: turn.reasoning });
          if (isLooping(turn.reasoning)) { turn.looping = true; local.abort(); break; }
          if (serviceCap && turn.reasoning.length > serviceCap * 3 && tokensOf(turn.reasoning) > serviceCap) { turn.overThought = true; local.abort(); break; }
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
        } else if (ev.type === 'busy') {
          // The service said "too many requests": the client waits and asks again (busy.mjs).
          const secs = Math.max(1, Math.round(ev.waitMs / 1000));
          this.emit('note', { text: ev.shared
            ? `Another window was told the service is busy: waiting ${secs} s with it, then asking (try ${ev.next} of ${ev.of}).`
            : `The service is busy: too many requests right now. Trying again in ${secs} s (try ${ev.next} of ${ev.of}). Your conversation stays as it is.`, tone: 'warn' });
          this.emit('busy', { waitMs: ev.waitMs, until: Date.now() + ev.waitMs, next: ev.next, of: ev.of });
        } else if (ev.type === 'server') {
          // A web search or page, or a search for tools, done on the server's side (the Claude API): shown as a finished step.
          this.emit('tool', { id: ev.id, name: ev.name, ...(ev.shown ?? display(ev.name, ev.args)), view: ev.view, error: ev.error });
        } else if (ev.type === 'done') {
          turn.finish = ev.finish;
          if (ev.usage) this.ctxUsed = (ev.usage.prompt_tokens ?? 0) + (ev.usage.completion_tokens ?? 0);
          written = ev.usage?.completion_tokens ?? 0;
          measured = ev.timings?.predicted_per_second ?? null;
          if (ev.timings) {
            this.stats.tps = ev.timings.predicted_per_second ?? this.stats.tps;
            if ((ev.timings.prompt_n ?? 0) > 50) this.stats.pps = ev.timings.prompt_per_second;
            turn.tokens = ev.timings.predicted_n ?? 0;
          }
        }
      }
    } catch (e) {
      if (turn.looping || turn.overThought) { /* aborted on purpose */ }
      else if (signal?.aborted) {
        turn.secs = (Date.now() - t0) / 1000;
        turn.thinkSecs = turn.reasoning ? ((thinkEnd ?? Date.now()) - (firstToken ?? t0)) / 1000 : 0;
        return { ...turn, aborted: true };
      }
      // The connection broke (not an answer from the server: one that says no carries its status,
      // and a service's "llama-server process has terminated" is such an answer).
      else if (retry && !e.status && /fetch failed|ECONNREFUSED|socket|terminated/i.test(`${e.message} ${e.cause?.message ?? ''}`) && this.waitForServer) {
        this.emit('note', { text: this.model?.remote ? 'The remote model stopped answering; connecting again…' : 'The model server stopped; restarting it and trying again…', tone: 'warn' });
        await this.waitForServer();
        return this.generate(signal, { retry: false, textOnly, maxTokens: cap, focus });
      // Nothing came for minutes and a limit on the way gave up (Bun's own fetch did after 6 minutes, "The
      // operation timed out.", until client.mjs turned it off: 4 Oct 2026, Qwen3.6 on a shared service with
      // a 165k-token conversation). Asked once more; a second time, it says so in words.
      } else if (e?.name === 'TimeoutError' || /operation timed out/i.test(e?.message ?? '')) {
        if (!retry) throw Object.assign(new Error('The model service sent nothing back in time, twice: it may be busy with other work, or the conversation too long for it to read again quickly (/compact shortens it).'), { cause: e });
        this.emit('note', { text: 'The model service sent nothing back for minutes (busy, or reading a long conversation again); asking once more…', tone: 'warn' });
        return this.generate(signal, { retry: false, textOnly, maxTokens: cap, focus });
      // A tool call the service could not read (Ollama's parser: "XML syntax error on line 17:
      // unexpected EOF", Qwen3.6, 3 Oct 2026): the reply is lost, so the model is told and writes it again,
      // twice at most a message. Before, the message ended there as an error.
      } else if (CALL_UNREADABLE.test(e.message) && this.turn && (this.turn.unreadable ?? 0) < 2) {
        this.turn.unreadable = (this.turn.unreadable ?? 0) + 1;
        this.emit('note', { text: `The service could not read the tool call it wrote (${String(e.message).replace(/^model server:\s*/, '').slice(0, 120)}); asked it to send the call again.`, tone: 'warn' });
        this.messages.push({ role: 'user', content: auto('The service could not read the tool call in your last reply: its arguments were cut off or not valid. Send the call again, complete and valid.') });
        return this.generate(signal, { retry, textOnly, maxTokens: cap, focus });
      // A conversation too long for the model. Not a busy service: "Rate limit exceeded" is a 429,
      // already waited for and asked again (busy.mjs); summarizing would only lose the conversation.
      // Nor a model with no room on the service's GPU (its error ends "a smaller Context": 2 Oct 2026,
      // a CUDA out-of-memory summarized the conversation away and failed again).
      } else if (retry && !e.busy && !isBusy(e) && !e.noRoom && /context|exceed/i.test(e.message)) {
        this.emit('note', { text: 'The conversation outgrew the model’s memory; summarizing it and trying again…', tone: 'warn' });
        await this.compact(signal);
        return this.generate(signal, { retry: false, textOnly, maxTokens: cap, focus });
      } else throw e;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.answering--;
    }
    if (turn.overThought) {
      this.stats.outTokens += tokensOf(turn.reasoning);
      // And the rest of this request with it off: thinking stopped at the cap is thrown away, and a model that
      // passes it once passes it again (5 Oct 2026: six capped replies in one run, about 100 s each, 10 of its 25 minutes).
      if (this.turn) this.turn.overThought = true;
      this.emit('note', { text: `It thought past ${kTok(serviceCap)} in one reply (the service takes no thinking cap): that reply is asked for again with thinking off, and so is the rest of this request.`, tone: 'dim' });
      return this.generate(signal, { retry, textOnly, maxTokens: cap, focus, noThink: true });
    }
    turn.calls = turn.calls.filter(Boolean).filter((c) => c.name);
    // Thinking written into the answer (<think>, Qwen's <|mask_start|>): it goes with the thinking.
    const leak = leakedThinking(turn.text);
    if (leak) { turn.reasoning = [turn.reasoning, leak.thought].filter(Boolean).join('\n'); turn.text = leak.text; turn.leaked = true; }
    turn.tokens ||= tokensOf(turn.reasoning + turn.text + turn.calls.map((c) => c.args).join(''));
    this.stats.outTokens += turn.tokens;
    this.stats.requests++;
    turn.secs = (Date.now() - t0) / 1000;
    turn.thinkSecs = turn.reasoning ? ((thinkEnd ?? Date.now()) - (firstToken ?? t0)) / 1000 : 0;
    // The footer's gauges on a remote (app/remote-footer.mjs): the time to this request's first
    // token, and its speed, timed here when the service sends none; the last 8 speeds of the
    // model in use (speedsOf names it, so another model starts its own).
    if (firstToken) {
      this.stats.ttft = (firstToken - t0) / 1000;
      const writing = (Date.now() - firstToken) / 1000;
      const speed = measured ?? ((written || turn.tokens) > 20 && writing > 0.2 ? (written || turn.tokens) / writing : null);
      if (speed) {
        if (!measured) this.stats.tps = speed;
        const who = this.model?.remote?.model ?? this.model?.id ?? null;
        this.stats.speeds = [...(this.stats.speedsOf === who ? this.stats.speeds ?? [] : []), speed].slice(-8);
        this.stats.speedsOf = who;
      }
    }
    this.emit('stats', { ...this.stats, ctxUsed: this.ctxUsed, ctx: this.ctx, replyRoom: replyRoom(this.thinking, this.thinkRoom()) });
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

  // ---- background jobs (tools/jobs.mjs) ----
  // Nothing running: no reply, and no message on its way in.
  idle() { return !this.busy && !this.sending; }

  // A background job ended. One stopped (by the model, by you, at quit) or one of a conversation
  // that was cleared is only a line. One that ended by itself is news for the model: told with its
  // next step while a reply runs, and once nothing runs the app sends it as a message of its own
  // ('jobs-waiting', App.jsx), as Claude Code does (the owner's pick, 3 Oct 2026).
  jobEnded(job) {
    const how = job.stopped ? 'stopped' : `ended, exit code ${job.code ?? '?'}`;
    if (job.stopped !== 'model') this.emit('note', { text: `${job.id} ${how} after ${took(job.ended - job.started)}: ${job.command}`, tone: job.stopped || job.code === 0 ? 'dim' : 'warn' });
    if (job.stopped || job.orphan) return;
    this.jobNews.push(job);
    if (this.idle()) this.emit('jobs-waiting', { count: this.jobNews.length });
  }

  // The ended jobs not told yet, as one note (and from now on told); null when there are none.
  takeJobNews(lines = 10) {
    if (!this.jobNews.length) return null;
    return this.jobNews.splice(0).map((j) => {
      const last = this.jobs.tail(j, lines);
      return `background job ${j.id} (${j.command}) ended by itself: exit code ${j.code ?? '?'} after ${took(j.ended - j.started)}.${last.length ? ` Its last lines:\n${last.join('\n')}` : ''}`;
    }).join('\n\n');
  }

  // The message that wakes the model for jobs that ended after its reply: { text, shown } or null.
  jobWake() {
    const ids = this.jobNews.map((j) => j.id);
    const news = this.takeJobNews(20);
    if (!news) return null;
    return {
      text: `(From Agentic Coder, not the user: ${news})\nA background job you started ended after your last reply. Carry on with what it was for; if nothing is left to do, say so in one line.`,
      shown: `${ids.join(', ')} ended`,
    };
  }

  // ---- your hooks (user-hooks.mjs) ----
  // The window opens, comes back after /clear or /resume: what a SessionStart hook prints goes with
  // the next message. source: startup · resume · clear.
  async startSession(source = 'startup') {
    if (!this.userHooks?.has('SessionStart')) return;
    const r = await this.userHooks.run('SessionStart', { source }, { permissionMode: this.mode });
    if (r.context) this.sessionContext = r.context;
  }
  // The window closes, or /clear: SessionEnd, waited for at most ms. reason: quit · clear · exit.
  async endSession(reason = 'quit', ms = 5000) {
    if (!this.userHooks?.has('SessionEnd')) return;
    await Promise.race([this.userHooks.run('SessionEnd', { reason }), new Promise((r) => setTimeout(r, ms).unref?.())]);
  }

  // A step, with your hooks around it: PreToolUse may stop it (the model is told why), allow it
  // without a question or make it ask; PostToolUse may tell the model something after it. A hook
  // that changed a file the model has seen (a formatter after an Edit) is said with the lines.
  async runTool(call, signal) {
    const hooks = this.userHooks;
    const name = toolNameOf(call.name, this.way);
    if (!hooks || (!hooks.has('PreToolUse', name) && !hooks.has('PostToolUse', name))) return this.runStep(call, signal);
    const args = parseArgs(name, call.args, this.way).args ?? {};
    const input = toolInput(name, args, this.cwd);
    let pre = null;
    if (hooks.has('PreToolUse', name)) {
      pre = await hooks.run('PreToolUse', { tool_name: name, tool_input: input }, { tool: name, signal, permissionMode: this.mode });
      if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      if (pre.block) {
        const why = pre.reason || 'it said no';
        this.emit('tool', { id: call.id, name, ...display(name, args), view: { kind: 'denied', message: `your hook: ${why.split('\n')[0].slice(0, 160)}` }, error: true });
        return { text: `A hook of the user's stopped this ${name}: ${why}. Do something else, or ask the user.`, error: true };
      }
    }
    const out = await this.runStep({ ...call, pre }, signal);
    if (out.error || out.stop || signal?.aborted || !hooks.has('PostToolUse', name)) return out;
    const r = await hooks.run('PostToolUse', { tool_name: name, tool_input: input, tool_response: { output: String(out.text ?? '').slice(0, 20_000), ...(input.file_path ? { filePath: input.file_path } : {}) } }, { tool: name, signal, permissionMode: this.mode });
    if (r.block || r.reason) out.text += `\n\n(A hook of the user's says: ${r.reason || 'something is wrong with this step'})`;
    if ((name === 'Edit' || name === 'Write') && input.file_path) {
      const ch = this.readFiles.changed(input.file_path);
      if (ch) {
        const rel = relative(this.cwd, input.file_path);
        const lines = changesText(ch);
        out.text += lines ? `\n(A hook of the user's changed ${rel} after this ${name}; this counts as reading it:\n${lines})` : `\n(A hook of the user's changed ${rel} after this ${name}: Read it again before you Edit it.)`;
        if (lines) this.readFiles.add(input.file_path, ch.now);
      }
    }
    return out;
  }

  // Two slips of an edit, set right (4 Oct 2026, eight runs: "Edit needs path" and "Write needs content",
  // three times each, a step lost every time): a Write with old_text and new_text and no content is the
  // Edit it means; an Edit with no path goes to the one file the model has seen that holds old_text.
  mendEdit(call) {
    let raw;
    try { raw = JSON.parse(call.args || '{}'); } catch { return call; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return call;
    const e = normalizeArgs('Edit', raw, this.way);
    let name = call.name;
    if (name === 'Write' && normalizeArgs('Write', raw, this.way).content === undefined && typeof e.old_text === 'string' && typeof e.new_text === 'string') name = 'Edit';
    // An Edit with the whole file and no old text (content, not new_text: a few new lines sent alone must never
    // replace a file) is the Write it means; Write's own rules still decide (read first, nothing broken).
    if (name === 'Edit' && e.old_text === undefined && e.new_text === undefined && typeof normalizeArgs('Write', raw, this.way).content === 'string' && e.path) return { ...call, name: 'Write' };
    if (name !== 'Edit' || e.path || typeof e.old_text !== 'string' || !e.old_text.trim()) return name === call.name ? call : { ...call, name };
    const holds = this.readFiles.paths().filter((abs) => { try { return readFileSync(abs, 'utf8').includes(e.old_text); } catch { return false; } });
    return holds.length === 1 ? { ...call, name, args: JSON.stringify({ ...raw, path: relative(this.cwd, holds[0]) }) } : { ...call, name };
  }

  // gpt-oss's own way to change files (4 Oct 2026: gpt-oss:120b sent apply_patch three times, was told
  // there is no such tool, and was stopped): each hunk runs as an Edit and each new file as a Write
  // (tools.mjs patchOps), so their checks and questions hold; the first that fails ends it.
  async applyPatch(call, signal) {
    let raw = {};
    try { raw = JSON.parse(call.args || '{}'); } catch { raw = { patch: call.args }; }
    const ops = patchOps(typeof raw === 'string' ? raw : raw.patch ?? raw.input ?? raw.diff ?? '');
    if (!ops.length) {
      this.emit('tool', { id: call.id, name: 'Edit', label: 'Update', arg: '', view: { kind: 'error', message: 'A patch with no change in it' }, error: true });
      return { text: 'The patch has no change in it. Change a file with Edit (path, old_text, new_text), or make one with Write.', error: true };
    }
    const said = [];
    for (const [i, op] of ops.entries()) {
      const where = ops.length > 1 ? `Change ${i + 1} of ${ops.length}${op.args?.path ? ` (${op.args.path})` : ''}: ` : '';
      if (op.error) return { text: `${where}${op.error}${i ? ` The ${i} before it went in.` : ''}`, error: true };
      const out = await this.runStep({ id: `${call.id}-${i}`, name: op.name, args: JSON.stringify(op.args) }, signal);
      if (out.error || out.stop) return { ...out, text: `${where}${out.text}${i ? ` The ${i} before it went in.` : ''}` };
      said.push(`${where}${out.text}`);
    }
    return { text: said.join('\n') };
  }

  async runStep(call, signal) {
    call = { ...call, name: toolNameOf(call.name, this.way) };
    // A tool of an MCP server: by its name here, through Mcp, or by the tool's own name when
    // that is no tool of the app's and only one server has it (runMcp).
    if (this.mcpFrozen && (isMcpCall(call.name) || (!this.tools().some((t) => t.function.name === call.name) && findEntry(this.mcpEntries(), call.name).entry))) return this.runMcp(call, signal);
    // A wrapper of its own making with a server's tool inside ("call_mcp", agent/mcp.mjs madeUpCall):
    // run through Mcp, as the call it means.
    if (this.mcpFrozen && !this.tools().some((t) => t.function.name === call.name)) {
      let raw = null;
      try { raw = JSON.parse(call.args || '{}'); } catch { /* not one */ }
      const made = madeUpCall(call.name, raw);
      if (made && findEntry(this.mcpEntries(), made.tool).entry) return this.runMcp({ ...call, name: MCP_TOOL, args: JSON.stringify(made) }, signal);
    }
    if (call.name === 'apply_patch') return this.applyPatch(call, signal);
    if (call.name === 'Edit' || call.name === 'Write') call = this.mendEdit(call);
    let parsed = parseArgs(call.name, call.args, this.way);
    if (call.name === 'Write') parsed = this.keepWrite(call, parsed);
    const shown = display(call.name, parsed.args ?? {});
    const id = call.id;
    if (parsed.error) {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: parsed.shown ?? parsed.error }, error: true });
      // A name that is no tool at all, with MCP tools on: they are named too (Qwen3.6 made up
      // "Shop_get_note", was told only the app's tools, and said the server was not there).
      const mcpNames = /^There is no tool called/.test(parsed.error) && this.mcpFrozen ? this.mcpDefs().map((t) => t.function.name) : [];
      return { text: mcpNames.length ? `${parsed.error} And the MCP tools: ${mcpNames.slice(0, 12).join(', ')}${mcpNames.length > 12 ? ', …' : ''}.` : parsed.error, error: true };
    }
    const args = parsed.args;
    // A helper refuses a tool it was not given (an explore helper does not change anything).
    if (this.toolFilter && !this.toolFilter.has(call.name)) {
      // A helper agent file's own list of tools: say which it has.
      const reads = this.toolFilter === EXPLORE_TOOLS;
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: reads ? 'this helper only reads' : `not one of this helper's tools` }, error: true });
      return { text: reads ? `${call.name} is not one of this helper's tools: it only reads. Report what should change instead.` : `${call.name} is not one of this helper's tools (it has ${[...this.toolFilter].join(', ') || 'none'}). Do the work with those, or report what should be done instead.`, error: true };
    }
    // A command that names one of the conversation's MCP tools ("claude mcp__shop__create_ticket …":
    // Qwen3.6 in the window, 3 Oct 2026, which then waited on your yes): the tool is no program, so
    // nothing runs and it is told how the tool is called.
    if (call.name === 'Bash' && this.mcpFrozen) {
      const named = this.mcpEntries().find((e) => String(args.command ?? '').includes(e.name));
      if (named) {
        const gated = this.mcpListed().some((e) => e.name === named.name);
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: `${named.name} is an MCP tool, not a command` }, error: true });
        return { text: `Nothing ran: ${named.name} is a tool of the user's MCP server "${named.server}", not a command. Call it as a tool${gated ? `: ${MCP_TOOL} with "tool": "${named.name}" and its "arguments"` : ', with its arguments as JSON'}.`, error: true };
      }
    }
    // A folder that is not there before the command ("cd /testbed && npm test", "cd /Users/gkane && …": six
    // times in eight runs, 4 Oct 2026, each refused as outside the project): the command runs here, and says so.
    if (call.name === 'Bash' && typeof args.command === 'string') {
      const m = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)\s*(\S[\s\S]*)$/.exec(args.command);
      const there = m?.[1].replace(/^["']|["']$/g, '');
      if (m && isAbsolute(there) && !existsSync(there)) {
        const out = await this.runStep({ ...call, args: JSON.stringify({ ...args, command: m[2] }) }, signal);
        if (typeof out?.text === 'string') out.text = `(There is no ${there} on this machine. You are already in the project folder, so the command ran here; leave the cd out.)\n${out.text}`;
        return out;
      }
    }
    if (call.name === 'Agent') return this.runHelper(id, args, shown, signal);
    if (call.name === 'Ask') { if (this.turn) this.turn.askedUser = true; return this.askUser(id, args, shown, signal); }
    // List of a file: it is read (4 Oct 2026: "Listed docs/map/docs.md · 0 paths").
    if (call.name === 'List' && typeof args.path === 'string' && !args.pattern) {
      let file = false;
      try { file = statSync(resolvePath(this.cwd, args.path).abs).isFile(); } catch {}
      if (file) return this.runTool({ id, name: 'Read', args: JSON.stringify({ path: args.path }) }, signal);
    }
    // A plain read in a command on a model on another machine (cat, head, tail, sed -n, grep -r, rg, ls,
    // find -name): run as Read, Search or List (tools.mjs plainRead), so a long file comes in parts with an
    // outline and a profile, and it counts as a look (4 Oct 2026: a 35 KB file came back cut, twice).
    let reading = call.name === 'Bash' && this.model?.remote ? plainRead(args.command, this.cwd) : null;
    // A range of a short file (sed -n '95,120p', tail -n 3) runs as typed: Read gives a short file whole,
    // from line 1 and unnumbered, so the lines asked for get lost (4 Oct 2026: Qwen3.6 asked for lines
    // 95-120 of a 183-line file, got all 183, and spent 40 steps hunting line 101 with od and xxd).
    if (reading?.name === 'Read' && reading.args.offset > 1) {
      try {
        const text = readFileSync(resolvePath(this.cwd, reading.args.path).abs, 'utf8');
        if (text.split('\n').length <= (this.model?.harness?.read?.whole ?? WHOLE_MAX) && text.length <= (this.maxResultChars ?? 12000)) reading = null;
      } catch { /* Read says what is wrong */ }
    }
    if (reading) {
      const out = await this.runTool({ id, name: reading.name, args: JSON.stringify(reading.args) }, signal);
      if (typeof out?.text === 'string') out.text = `(Run as ${reading.name}: the app's own tool shows a long file in parts, with an outline. Use ${reading.name} yourself.)\n${out.text}`;
      return out;
    }
    // A plain curl or wget of a page outside Bypass, with WebFetch on: run as WebFetch, since commands reach
    // the internet only in Bypass (tools.mjs plainFetch); asked about as WebFetch is.
    const fetching = call.name === 'Bash' && this.mode !== 'bypass' && this.webTools()?.fetch ? plainFetch(args.command) : null;
    if (fetching) {
      this.emit('note', { text: `A plain fetch of ${fetching}: run as WebFetch (commands reach the internet only in Bypass).`, tone: 'dim', fold: true });
      const out = await this.runTool({ id, name: 'WebFetch', args: JSON.stringify({ url: fetching }) }, signal);
      if (typeof out?.text === 'string') out.text = `(Run as WebFetch: commands reach the internet only in Bypass permissions. Call WebFetch yourself for a page.)\n${out.text}`;
      return out;
    }
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
    // A skill's read fence. The steps may say "do not edit"; this is what holds.
    if (this.turn?.fence?.has('read') && (call.name === 'Edit' || call.name === 'Write')) {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: 'This skill only reads' }, error: true });
      return { text: 'This skill only reads. Edit and Write are turned off for it. Answer from what you have read.', error: true };
    }
    // A picture, or a scanned PDF, the model reads by itself while it is not looking at pictures:
    // its vision is turned on first where it can be (visionOn: the window's reload, or coding -p's),
    // as when you attach one. Without it, Read says to ask you to attach it.
    if (call.name === 'Read' && !this.canSee && this.visionOn && needsSight(this.cwd, args)) { try { await this.visionOn(); } catch { /* Read says why it cannot see */ } }
    if (call.name === 'Screen' && !this.canSee && this.visionOn) { try { await this.visionOn(); } catch { /* the picture goes with a line saying it cannot be seen */ } }
    // checks: the lsp helper also checks JSX, TypeScript and a page's scripts before an edit lands.
    const env = { cwd: this.cwd, home: this.home, jobs: this.jobs, rulesSet: this.rulesSetUsed ?? 'local', notes: () => this.notesView(), rewrite: (abs) => this.readFiles.has(abs), agents: this.agentsOn(), mcp: this.mcpOn(), permissionsNow: () => ({ mode: this.mode, rules: this.savedRules(), session: this.allowedPrefixes }), signal, maxResultChars: this.maxResultChars, bash: this.bash, read: this.model?.harness?.read, canSee: Boolean(this.canSee), onScreenSetup: () => this.emit('screen-setup', {}), web: { search: this.web?.search, key: () => searchKey(this.web?.search) }, request: this.turn?.request ?? '', searches: this.turn?.searches ?? [], blocked: this.hook('blocked'), workFolder: this.turn?.workFolder ?? null, checks: this.helpers.has('lsp'), setTodos: (t) => { this.todos = t; this.emit('todos', t); }, todos: () => this.todos, outsideOk: (name, abs) => this.mode === 'bypass' || this.desktopOpen(name, abs) };
    // A new file goes to the Desktop unless the request says where (tools.mjs desktopDefault); a new code
    // file at the top of a code project is asked about once a message. AGENTIC_DESKTOP_DEFAULT=off: as before (the tests).
    // The page the request names, not read yet (Look before answering; 5 Oct 2026: asked to scrape a link, Qwen3.6
    // called no web tool, wrote a "mockup" of what the page might hold to three places, and said it could not reach
    // the internet). A file is not written about a page nobody read: twice, then it is let through.
    if (this.turn?.web?.urls?.length && !this.turn.fetched && !this.isHelper) {
      const t = this.turn;
      if (call.name === 'Bash' && t.web.urls.some((u) => String(args.command ?? '').includes(u.replace(/^https?:\/\//, '').split('/')[0]))) t.fetched = true;
      else if ((call.name === 'Write' || call.name === 'Edit') && this.hook('look-first') && (t.webHeld ?? 0) < 2) {
        t.webHeld = (t.webHeld ?? 0) + 1;
        if (t.webHeld === 1) this.emit('note', { text: `It began to write before reading ${t.web.urls[0]}: told it to read the page first.`, tone: 'warn' });
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: 'The page was not read yet' }, error: true });
        return { text: `Nothing was written: you have not read ${t.web.urls.slice(0, 3).join(', ')} yet. WebFetch is one of your tools and this address is allowed: read the page with it first, then write from what it shows. Never write what a page might say from memory. If WebFetch fails, tell the user exactly what it answered.`, error: true };
      }
    }
    // A Desktop in a command that is not this user's ("curl -o /Users/Shared/Desktop/x.html …"): their own, said so.
    if (call.name === 'Bash' && typeof args.command === 'string' && process.env.AGENTIC_DESKTOP_DEFAULT !== 'off' && !this.isHelper && this.turn) {
      const req = String(this.turn.task ?? this.turn.request ?? '');
      let was = '';
      const fixed = args.command.replace(/\/(?:Users|home)\/([^/\s'"]+)\/Desktop(?=[/\s'"]|$)/g, (all, user) => (all === this.desktopDir || req.includes(`${user}/Desktop`) ? all : (was ||= all, this.desktopDir)));
      if (was) {
        this.emit('note', { text: `${was} is not your Desktop: the command uses yours, ${this.tilde(this.desktopDir)}.`, tone: 'warn' });
        const out = await this.runStep({ ...call, args: JSON.stringify({ ...args, command: fixed }) }, signal);
        if (typeof out?.text === 'string') out.text = `(${was} is not this user's Desktop; the command ran with their own, ${this.desktopDir}. Use that path from here on.)\n${out.text}`;
        return out;
      }
    }
    let notYours = '';
    if (call.name === 'Write' && typeof args.path === 'string' && process.env.AGENTIC_DESKTOP_DEFAULT !== 'off' && !this.isHelper && this.turn) {
      const t = this.turn;
      let where = null;
      try { where = desktopDefault(args.path, { cwd: this.cwd, home: this.home, request: t.task ?? t.request ?? '', code: (this.folderKinds?.get(this.cwd) ?? folderKind(this.cwd)) === 'code' }); } catch {}
      if (where?.ask && !t.whereChoice) {
        const question = `Where should ${where.name} go?`;
        const qid = `where_${Date.now()}`;
        const q = { question, options: ['Your Desktop', `This project (${basename(this.cwd)})`], about: ['A new file on the Desktop, where your pages and documents go.', 'Beside the project\'s own files.'], typeLabel: 'Somewhere else…', typeAbout: 'Name the folder.' };
        this.emit('tool-ask', { id: qid, name: 'Ask', label: 'Ask', arg: question });
        const a = await this.ask({ id: qid, name: 'Ask', kind: 'where', args: q, prepared: {}, label: 'Ask', arg: question });
        const said = String(a.text ?? a.feedback ?? '').trim();
        t.whereChoice = /desktop/i.test(said) ? 'desktop' : said ? 'project' : 'project';
        if (said) this.emit('tool', { id: qid, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: said } });
      }
      if (where?.ask && t.whereChoice === 'desktop') where = { to: join(this.desktopDir, args.path) };
      if (where?.to) {
        args.path = where.to;
        this.desktopAsked = true; // the Desktop's opening for a new file (desktopOpen)
        t.desktopDefaulted = this.tilde(where.to);
        if (where.notYours) {
          const desk = where.notYours.endsWith('/Desktop');
          notYours = `(${where.notYours} is not ${desk ? "this user's Desktop" : "a folder of this user's"}, so the file is on their own Desktop: ${this.tilde(where.to)}. Use that path from here on.)`;
          this.emit('note', { text: `${where.notYours} is not ${desk ? 'your Desktop' : 'a folder of yours'}: written to your own Desktop, ${this.tilde(where.to)}.`, tone: 'warn' });
        }
        else this.emit('note', { text: `New file on your Desktop: ${this.tilde(where.to)} (new files go there unless you say where).`, tone: 'dim', fold: true });
      }
    }
    let prepared;
    try { prepared = prepare(call.name, args, env); } catch (e) { prepared = { error: `${call.name} failed: ${e.code ?? e.message}` }; }
    if (prepared.error) {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: prepared.error }, error: true });
      return { text: prepared.error, error: true };
    }
    // /agents' stop list (agents-guards.mjs): a step on it asks you first, and a no turns it away.
    if (this.toolGuard) {
      const stop = await this.toolGuard({ name: call.name, args, before: prepared.before ?? '', cwd: this.cwd });
      if (stop) {
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: stop.denied }, error: true });
        return { text: stop.text, error: true };
      }
    }
    // Tool-call text in what would be written (leakedCall): turned back, so the
    // file never gets it, and the model sends the call again without it.
    if (call.name === 'Write' || call.name === 'Edit') {
      // prepared.before: the file as it is now (empty for a new one).
      const leak = leakedCall(call.name === 'Write' ? args.content : args.new_text, prepared.before ?? args.old_text ?? '');
      if (leak) {
        const msg = `Nothing was written: line ${leak.line} of your ${call.name === 'Write' ? 'content' : 'new_text'} is "${leak.text}", which is tool-call text, not part of the file (the end of your call got into it). Send the ${call.name} again with only the file's own text, and make any next call separately.`;
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: `Turned back: line ${leak.line} is tool-call text (${leak.text})` }, error: true });
        return { text: msg, error: true };
      }
    }
    // Like Claude Code: an existing file must be read before it is edited, so
    // old_text is copied from what is really there.
    if (call.name === 'Edit' && prepared.abs && !this.readFiles.has(prepared.abs)) {
      const msg = `Read ${prepared.rel} first, then copy old_text from it exactly.`;
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: msg }, error: true });
      return { text: msg, error: true };
    }
    // Like Claude Code: a file that changed on disk since the model saw it (a command, a
    // formatter, you, another session) is not changed from the old copy. The lines that changed
    // are shown, and that counts as seeing it again (seen.mjs); too many, and it reads it again.
    if ((call.name === 'Edit' || call.name === 'Write') && prepared.abs && !prepared.created) {
      const ch = this.readFiles.changed(prepared.abs);
      if (ch) {
        const note = changedNote(prepared.rel, ch, call.name);
        if (note.shown) this.readFiles.add(prepared.abs, ch.now);
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: `${prepared.rel} changed since it was read: ${note.shown ? 'shown the changes' : 'asked to read it again'}` }, error: true });
        return { text: note.text, error: true };
      }
    }
    const at = args.path ? resolvePath(this.cwd, args.path) : null;
    const away = Boolean(at && !at.inside && this.desktopOpen(call.name, at.abs)); // on the Desktop (desktopOpen)
    const inside = at ? at.inside || away : true;
    const rules = this.savedRules();
    let d = decide(call.name, args, { mode: this.mode, allowedPrefixes: this.allowedPrefixes, inside, cwd: this.cwd, rules, rel: at?.realRel ? [at.rel, at.realRel] : at?.rel });
    // Your PreToolUse hook's answer (runTool): allow skips the question, ask asks; a hard stop still holds.
    if (call.pre?.allow && d.decision !== 'deny') d = { decision: 'allow' };
    else if (call.pre?.ask && d.decision !== 'deny') d = { ...d, decision: 'ask' };
    // Auto (/mode): the rules left this step open, so the model checks it against your
    // request first (auto-check.mjs): it runs, or it asks you with the check's reason.
    if (d.decision === 'check') {
      this.emit('auto-check', { id, name: call.name, ...shown });
      const r = await autoCheck({ url: this.url, model: this.model, slot: this.slots?.side, request: this.turn?.request ?? '', name: call.name, args, cwd: this.cwd, signal });
      if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      this.emit('note', { text: `Auto ${r.run ? 'let it run' : 'asks you'}: ${r.reason} (${(r.ms / 1000).toFixed(1)} s)`, tone: 'dim', auto: { run: r.run, failed: Boolean(r.failed) } });
      d = r.run ? { decision: 'allow' } : { ...d, decision: 'ask', autoReason: r.reason };
    }
    // The screen while macOS does not allow pictures yet: no question first, straight to the
    // tool, which takes nothing and says how to set it up (/screen setup).
    if (call.name === 'Screen' && d.decision === 'ask' && !screenAccess()) d = { decision: 'allow' };
    if (d.decision === 'deny') {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: d.reason }, error: true });
      const where = args.path ?? /^(.+?) is outside the project folder/.exec(String(d.reason))?.[1];
      return { text: `Not allowed: ${d.reason}. ${this.noteNames(where) ? "If the note that came with the request answers it, answer from the note now; do not look for the files it names." : 'Do something else.'}`, error: true };
    }
    // Edits on auto-accept: the first one of a message is shown as a plan first (not in Bypass, where nothing asks).
    if (d.decision !== 'ask' && (call.name === 'Edit' || call.name === 'Write') && this.turn && !this.turn.planOk && this.confirmPlan && this.mode !== 'bypass' && this.hook('plan')) {
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
      this.userHooks?.fire('Notification', { message: `Agentic Coder needs your permission to use ${call.name}`, notification_type: 'permission_prompt' });
      const answer = await this.ask({ id, name: call.name, args, prepared, ...shown, ...(d.once ? { once: true } : {}), ...(d.protectedBy ? { protectedBy: d.protectedBy } : {}), ...(d.rule ? { rule: d.rule } : {}), ...(d.autoReason ? { autoReason: d.autoReason } : {}), ...(call.name === 'WebSearch' ? { service: PROVIDER_NAMES[this.web?.search] } : {}) });
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
    let paged = null; // the line a repeated Read of an outlined file was moved on to
    if (call.name === 'Read' && this.turn?.reads) {
      const abs = resolvePath(this.cwd, args.path).abs;
      readKey = `${abs}|${args.offset ?? ''}|${args.limit ?? ''}|${args.find ?? ''}`;
      try { mtime = statSync(abs).mtimeMs; } catch {}
      const seen = this.turn.reads.get(readKey);
      // The answer before was a long file's outline, not its lines: "it is above" was not
      // true, and Qwen3.6 went round seven times between the outline and that line until it
      // was stopped as stuck (3 Oct 2026). Asked again with no offset, it gets the file's next
      // part, and the step counts as new. The same for one part asked for twice (the same
      // offset and limit): Qwen3.6 read lines 1-100 of a report twice and the stuck question
      // came up (4 Oct 2026, the owner's pick: give the next part instead).
      if (seen?.next && seen.mtime === mtime && !args.find && seen.next <= (seen.total ?? Infinity) && this.messages.includes(seen.msg) && !String(seen.msg.content).startsWith('[older output removed')) {
        paged = { from: seen.next, outline: seen.outline };
        args.offset = paged.from;
        this.turn.paged = true;
      } else
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
    if (out.error && /outside the project folder/.test(String(out.text)) && String(args.command ?? args.path ?? '').split(/[\s'"]+/).some((w) => w.includes('/') && this.noteNames(w))) out.text += ' If the note that came with the request answers it, answer from the note now.';
    if (readKey && !out.error) {
      Object.assign(out, { readKey, mtime });
      // An outline, or one part of a long file: a repeat of the same Read moves on (see above).
      const shownLines = out.view?.kind === 'read' && !args.find ? out.view.lines ?? 0 : 0;
      if (out.view?.outline) Object.assign(out, { outline: true, next: 1, total: out.view.total });
      else if (paged) {
        Object.assign(out, { outline: paged.outline, next: paged.from + shownLines, total: out.view?.total });
        out.text = `${paged.outline ? `(You asked for ${args.path} again without an offset. The answer before had only its outline, so here is its next part.` : `(You asked for the same part of ${args.path} again; it is above, so here is the part after it.`} For another part, pass offset and limit.)\n${out.text}`;
      } else if (shownLines && out.view.total > shownLines) Object.assign(out, { next: (args.offset ?? 1) + shownLines, total: out.view.total });
    }
    // Files seen only as an outline (with none of their lines), and walls met (Read before claiming, Stop when blocked).
    if (this.turn) {
      if (call.name === 'Read' && !out.error && args.path) {
        const abs = resolvePath(this.cwd, args.path).abs;
        if (out.view?.outline && !out.view?.matched) { if (!this.turn.readSome?.has(abs)) this.turn.outlined.add(abs); }
        else if (!out.view?.outline) { this.turn.outlined.delete(abs); (this.turn.readSome ??= new Set()).add(abs); }
      }
      if (call.name === 'Bash' && this.turn.outlined.size) for (const f of [...this.turn.outlined]) if (String(args.command ?? '').includes(basename(f))) this.turn.outlined.delete(f);
      if (call.name === 'WebFetch') this.turn.fetched = true;
      (this.turn.callLog ??= []).push({ function: { name: call.name, arguments: JSON.stringify(args ?? {}) } });
      // The app's own words for a step that failed (never a page's or a command's output): the second look's facts.
      if (out.error) (this.turn.errors ??= []).push(call.name === 'Bash' ? `${runLine(args.command)} ended with exit code ${out.view?.code ?? '?'}` : `${call.name}: ${String(out.text).split('\n')[0].split(' What it said')[0].slice(0, 160)}`);
      if (out.wall && !this.turn.walls.some((w) => w.url === out.wall.url)) {
        this.turn.walls.push({ ...out.wall, step: this.turn.steps ?? 0 });
        const hint = this.rememberHint('wall');
        if (hint) out.text += `\n${hint}`;
        this.emit('note', { text: `Blocked: ${out.wall.why}. Told it to ask you rather than do something else.`, tone: 'warn' });
      }
    }
    // What this step did, for which facts the turn really used (usedFacts).
    if (this.happened && this.happened.did.length < 60) this.happened.did.push(`${call.name} ${args.path ?? args.command ?? args.pattern ?? ''}`.slice(0, 300));
    if (!out.error && call.name === 'Read') this.readFiles.add(resolvePath(this.cwd, args.path).abs);
    // This message's searches, newest first: a Read of a long file shows what they found in it.
    if (this.turn && !out.error && call.name === 'Search' && args.pattern) this.turn.searches = [args.pattern, ...(this.turn.searches ?? []).filter((p) => p !== args.pattern)].slice(0, 3);
    if (!out.error && (call.name === 'Edit' || call.name === 'Write') && prepared.abs) this.readFiles.add(prepared.abs, prepared.after);
    if (this.turn && !out.error && (call.name === 'Edit' || call.name === 'Write')) {
      this.keepOriginal(prepared);
      this.turn.changed = true;
      this.turn.testedAfterChange = false;
      this.turn.edits = (this.turn.edits ?? 0) + 1;
      this.happened?.files.add(prepared.rel);
      // A file on the Desktop: it may be read and edited again; one in the project is what the tests check.
      if (away) { (this.desktopMade ??= new Set()).add(prepared.abs); this.turn.changedAway = true; } else this.turn.changedHere = true;
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
      // The built styles are the app's own change: the file as it is now is what the model has seen.
      this.readFiles.add(prepared.abs);
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
    if (notYours && !out.error && typeof out.text === 'string') out.text += `\n${notYours}`;
    // A Write that landed has used (or replaced) the kept content.
    if (!out.error && call.name === 'Write' && this.keptWrite) {
      if (parsed.fromKept) this.emit('note', { text: `Wrote the kept content to ${prepared.rel}; it was not written again.`, tone: 'dim' });
      this.keptWrite = null;
    }
    // A command may have written files the Edit and Write counts never see.
    if (this.turn && call.name === 'Bash') this.turn.ranCommand = true;
    // A long script it typed in is saved as SCRIPTS/… (scripts.mjs): it has seen it, so Edit may change it.
    if (call.name === 'Bash' && out.saved?.abs) this.readFiles.add(out.saved.abs);
    // The files a command wrote (made.mjs): said in its result, kept for the page checks and the second look.
    if (this.turn && call.name === 'Bash' && out.view?.kind === 'bash' && !out.view.timedOut && !isReadOnly(args.command)) {
      let made = [];
      try { made = filesMade(args.command, { since: t0, cwd: this.cwd, home: this.home, dirs: [this.cwd, this.turn.workFolder, this.desktopDir] }).filter((f) => !inScripts(f.abs)); } catch {}
      if (made.length) {
        this.turn.madeByCommand ??= new Map();
        for (const f of made) this.turn.madeByCommand.set(f.abs, f.bytes);
        out.text += `\n${madeNote(made, (p) => this.tilde(p))}`;
      }
    }
    // One that could have written a file (not ls, git log, cat…): the "said done, nothing changed" check counts it as a change.
    if (this.turn && call.name === 'Bash' && !isReadOnly(args.command)) this.turn.wroteByCommand = true;
    // A run of the tests (the project's test command, this message's check, or a test runner): only
    // such a command is the check, never one that reads or searches a test file. It failed when its
    // runner counted a failure or it exited with an error; piped on into another command (… | tail)
    // with no counts in what came out, the result is not known (failed: null) and changes nothing,
    // so the app runs the tests itself before the message ends (checkCmd).
    const run = call.name === 'Bash' && out.view?.kind === 'bash' ? testRunOf(args.command, { testCmd: this.testCmd, check: this.turn?.check }) : null;
    const tests = run ? { failed: testsFailed(out.view.lines?.join('\n') ?? out.text, out.error ? 1 : 0, run) } : null;
    const known = tests && tests.failed !== null;
    // How many fail, when the runner counted them: a loop's run says it (loop-run.mjs), and a
    // debugging loop that is not getting closer waits for you (loops.mjs stuckWhy).
    const count = known ? failsOf(out.view?.lines?.join('\n') ?? out.text, tests.failed)?.failed : null;
    // Every run of checks this message (Answer matches results): a test run, or any command whose output
    // counts what passed and failed (a script of its own, written by a heredoc: 4 Oct 2026).
    if (this.turn && call.name === 'Bash' && out.view?.kind === 'bash') {
      const said = out.view.lines?.join('\n') ?? out.text;
      const counted = readResults(said, out.view.code ?? 0);
      if (run || counted.failed !== null) {
        const failed = run && tests.failed !== null ? tests.failed : counted.failed !== null ? counted.failed > 0 || (out.view.code ?? 0) !== 0 : (out.view.code ?? 0) !== 0;
        const before = this.turn.checks.at(-1);
        this.turn.checks.push({ cmd: runLine(args.command), code: out.view.code ?? 0, failed, counts: countLine(said), step: this.turn.steps ?? 0 });
        if (before?.failed && !failed) { const hint = this.rememberHint('fixed'); if (hint) out.text += `\n${hint}`; }
      }
    }
    if (Number.isFinite(count)) tests.count = count;
    if (this.keepProgress && this.turn && known && !this.turn.changed && !this.turn.failsBefore) this.turn.failsBefore = failsOf(out.view?.lines?.join('\n') ?? out.text, tests.failed);
    if (this.turn && known && this.turn.changed) {
      this.turn.testedAfterChange = true;
      this.turn.checkOk = !tests.failed;
      this.turn.checkFailed = tests.failed;
      // What still fails after the change, for a loop's run that may keep a half-fix.
      if (this.keepProgress) this.turn.failsAfter = failsOf(out.view?.lines?.join('\n') ?? out.text, tests.failed);
      if (this.happened) this.happened.check = { cmd: String(args.command).slice(0, 120), ok: !tests.failed };
    }
    this.emit('tool', { id, name: call.name, ...shown, view: out.view, error: out.error, secs: (Date.now() - t0) / 1000, ...(tests ? { tests } : {}) });
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

  // A call to a tool of one of the user's MCP servers (agent/mcp.mjs): by its own name, or through
  // Mcp for a tool listed by name only (Mcp with only "tool" answers with that tool's arguments and
  // runs nothing). The steps: which tool, its arguments made to fit, whether it may run (asked
  // before a tool's first use; a tool that changed since you allowed it asks again; a question, or
  // a skill that only reads, asks even for an allowed tool you did not mark as reading; /agents'
  // stop list), then the call, and its answer as text and pictures, marked as data.
  async runMcp(call, signal) {
    const id = call.id;
    if (this.turn) this.turn.mcpTried = true;
    const fail = (shown, text, view) => { this.emit('tool', { id, name: call.name, ...shown, view: view ?? { kind: 'error', message: String(text).split('\n')[0].slice(0, 200) }, error: true }); return { text, error: true }; };
    let raw = null;
    try { raw = call.args && String(call.args).trim() ? JSON.parse(call.args) : {}; } catch { /* said below */ }
    const gate = call.name === MCP_TOOL;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail({ label: 'MCP', arg: call.name }, 'The arguments were not valid JSON. Write the call again with a valid JSON object.');
    const sent = gate ? gateCall(raw) : null;
    const asked = gate ? sent.asked : call.name;
    const found = findEntry(this.mcpEntries({ off: true }), asked);
    if (found.error) {
      // A helper asking for a tool it was not given: said as for the app's own tools.
      const other = this.toolFilter ? findEntry((this.mcpFrozen?.entries ?? []).filter((e) => e.on), asked).entry : null;
      return fail({ label: 'MCP', arg: String(asked ?? '') }, other ? `${other.name} is not one of this helper's tools${this.toolFilter === EXPLORE_TOOLS ? ': it only reads, and the user has not marked that tool as one that only reads' : ''}. Report what should be done instead.` : found.error, other ? { kind: 'denied', message: this.toolFilter === EXPLORE_TOOLS ? 'this helper only reads' : "not one of this helper's tools" } : undefined);
    }
    if (found.tools) {
      const text = describeServer(found.server, found.tools);
      this.emit('tool', { id, name: call.name, label: 'MCP', arg: `${found.server}'s tools`, view: { kind: 'list', count: found.tools.length, content: text } });
      return { text };
    }
    const entry = found.entry;
    let given = gate ? sent.given : unwrapArgs(entry, raw);
    const label = `${entry.server} · ${entry.tool}`;
    // Only "tool": its arguments, and nothing runs; a tool that takes none just runs (Qwen3.6 asked for
    // the logo tool's arguments three times over, was told "none" each time, and gave up: 3 Oct 2026).
    if (gate && given === undefined && !argLines(entry).length) given = {};
    if (gate && given === undefined) {
      const text = describeEntry(entry);
      this.emit('tool', { id, name: call.name, label, arg: 'its arguments', view: { kind: 'mcp', looked: true, lines: text.split('\n').length, content: text } });
      return { text };
    }
    const checked = checkArgs(entry, given);
    if (checked.error) return fail({ label, arg: '' }, checked.error);
    const args = checked.args;
    const shown = { label, arg: argsPreview(args) };
    // The tool as its server lists it now. One that is no longer the tool this conversation's list
    // was taken with, or the one you allowed, counts as changed: it asks again, and your "reads"
    // mark (made for the tool as it was) does not hold.
    const live = this.mcp.printOf(entry.server, entry.tool);
    const server = this.mcp.stateOf(entry.server);
    if (live === null && server?.state === 'connected') return fail(shown, `${entry.name} is gone: the MCP server "${entry.server}" no longer lists it. Use another tool, or tell the user.`);
    const now = live ?? entry.print;
    const rule = mcpRule(entry.server, entry.tool);
    const rules = this.savedRules();
    const has = (list) => [...(list ?? [])].some((r) => String(r).toLowerCase() === rule.toLowerCase());
    let savedPrint = has(rules?.allow) ? this.mcp.allowed?.print(entry.id) ?? null : null;
    // A rule typed in /permissions has no fingerprint yet: it takes the tool as it is at its first use.
    if (has(rules?.allow) && !savedPrint) { savedPrint = now; try { this.mcp.allowed?.remember(entry.id, now); } catch { /* it holds for this run */ } }
    const allowedNow = (has(rules?.allow) && savedPrint === now) || (has(this.allowedPrefixes) && this.mcpPrints.get(entry.id) === now);
    const moved = now !== entry.print;
    const changed = !allowedNow && (moved || has(rules?.allow) || has(this.allowedPrefixes));
    const reads = entry.reads && !moved;
    // A call by another form of the tool's name (shop__get_ticket) is judged as the tool it is.
    let d = decide(gate ? MCP_TOOL : entry.name, args, { mode: this.mode, allowedPrefixes: this.allowedPrefixes, rules, mcp: { server: entry.server, tool: entry.tool, reads, changed } });
    // A question changes nothing, and a skill that only reads stays that way: a tool you did not
    // mark as reading asks here even when a rule allows it (not in Bypass, where nothing asks).
    let note = null;
    if (!reads && d.decision === 'allow' && this.mode !== 'bypass' && (this.turn?.question || this.turn?.fence?.has('read'))) {
      note = this.turn?.question ? 'This was read as a question, and the tool is not one you marked as only reading.' : 'This skill only reads, and the tool is not one you marked as only reading.';
      d = { decision: 'ask', rule, once: true };
    }
    // /agents' stop list (agents-guards.mjs): a tool that may change things asks first while it
    // builds, and is turned away where a stage only reads.
    if (this.toolGuard) {
      const stop = await this.toolGuard({ name: entry.name, args, before: '', cwd: this.cwd, mcp: { server: entry.server, tool: entry.tool, reads } });
      if (stop) return fail(shown, stop.text, { kind: 'denied', message: stop.denied });
    }
    if (d.decision === 'deny') return fail(shown, `Not allowed: ${d.reason}. Do something else.`, { kind: 'denied', message: d.reason });
    if (d.decision === 'ask') {
      this.emit('tool-ask', { id, name: call.name, ...shown });
      this.userHooks?.fire('Notification', { message: `Agentic Coder needs your permission to use ${call.name}`, notification_type: 'permission_prompt' });
      const answer = await this.ask({ id, name: MCP_TOOL, args, ...shown, ...(d.once ? { once: true } : { rule }), mcp: { id: entry.id, server: entry.server, tool: entry.tool, name: entry.name, print: now, says: entry.says, changed, note, where: server?.where ?? null, runs: server?.runs ?? null } });
      if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      if (answer.choice === 'no') {
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'declined', feedback: answer.feedback }, error: true });
        return { text: `The user said no to this${answer.feedback ? ` and wrote: ${answer.feedback}` : '. Wait for their next message.'}`, error: true, stop: answer.feedback ? null : 'declined' };
      }
      if (answer.choice === 'always' && !d.once) { this.allowedPrefixes.add(rule); this.mcpPrints.set(entry.id, now); }
    }
    const t0 = Date.now();
    this.emit('tool-running', { id, name: call.name, ...shown });
    let result;
    try {
      result = await this.mcp.call(entry.server, entry.tool, args, { signal, ask: (params) => this.mcpAsked(entry, params, signal) });
    } catch (e) {
      if (signal?.aborted || e.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      const down = this.mcp.stateOf(entry.server)?.state !== 'connected';
      return fail(shown, `${label} did not run: ${e.message}.${down ? ` The MCP server "${entry.server}" is not running now: its tools are not there until the user looks at it in /mcp. Go on with what you can do without it, and say so.` : ''}`, { kind: 'error', message: `${e.message}`.slice(0, 200) });
    }
    const parts = resultParts(result);
    // A picture, for a model that is not looking at pictures yet: its vision is turned on where it can be, as for Screen.
    if (parts.pictures.length && !this.canSee && this.visionOn) { try { await this.visionOn(); } catch { /* the result says the picture is not shown */ } }
    const images = this.canSee ? parts.pictures.map((pic, i) => pictureFor(pic, `${label}${parts.pictures.length > 1 ? `, picture ${i + 1}` : ''}`)).filter(Boolean) : [];
    if (this.happened && this.happened.did.length < 60) this.happened.did.push(`${entry.name} ${argsPreview(args, 200)}`.slice(0, 300));
    // A tool that may have changed something counts as a command run (the "nothing changed" checks).
    if (this.turn && !reads) this.turn.ranCommand = true;
    this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'mcp', lines: parts.body ? parts.body.split('\n').length : 0, pictures: parts.pictures.length, shown: images.length, content: parts.body, ms: Date.now() - t0 }, error: parts.error });
    return { text: resultText(entry, parts, { max: this.maxResultChars, seen: images.length > 0 }), error: parts.error, ...(images.length ? { images } : {}) };
  }

  // A question of an MCP server's own while one of its tools runs (elicitation): it is the
  // server's question, shown as such, one line at a time; your answer goes to the server only.
  // { action: 'accept', content } · { action: 'decline' } · { action: 'cancel' }
  async mcpAsked(entry, params, signal) {
    if (!this.ask) return { action: 'decline' };
    const who = { kind: 'mcp', asker: entry.server, tool: entry.tool };
    const asked = async (question, options = []) => {
      const answer = await this.ask({ id: `mcp-ask-${randomUUID().slice(0, 8)}`, name: 'Ask', ...who, args: { question, options, about: [], recommended: -1, several: false }, prepared: {}, label: 'Ask', arg: question });
      if (signal?.aborted) return { stop: 'cancel' };
      return answer.choice === 'no' || answer.text === undefined ? { stop: 'decline' } : { text: String(answer.text).trim() };
    };
    // It wants a page opened (a sign-in, a payment): the address is shown; you open it yourself.
    if (params?.mode === 'url') {
      const got = await asked(`${String(params.message ?? 'Open this page to go on').trim()}\n${params.url}`, ['I opened it']);
      return got.stop ? { action: got.stop } : { action: 'accept' };
    }
    const props = Object.entries(params?.requestedSchema?.properties ?? {});
    if (!props.length) { const got = await asked(String(params?.message ?? 'Go on?').trim(), ['Yes']); return got.stop ? { action: got.stop } : { action: 'accept', content: {} }; }
    const content = {};
    for (const [key, p] of props) {
      const choices = Array.isArray(p?.enum) ? p.enum.map(String) : Array.isArray(p?.oneOf ?? p?.anyOf) ? (p.oneOf ?? p.anyOf).map((o) => String(o.const ?? o.title ?? '')).filter(Boolean) : p?.type === 'boolean' ? ['yes', 'no'] : [];
      const got = await asked(`${String(params.message ?? '').trim()}${props.length > 1 ? `\n${p?.title ?? key}${p?.description ? `: ${p.description}` : ''}` : ''}`.trim() || key, choices.slice(0, 8));
      if (got.stop) return { action: got.stop };
      content[key] = p?.type === 'boolean' ? /^(y|yes|true|1)$/i.test(got.text) : (p?.type === 'number' || p?.type === 'integer') && Number.isFinite(Number(got.text)) ? Number(got.text) : got.text;
    }
    return { action: 'accept', content };
  }

  // A helper (Agent): a second agent with a fresh conversation, the same model, folder, mode,
  // permissions and web, on the side slot when the server has one (the conversation's place
  // on the main slot stays), and no Agent of its own. Its steps show on one line as it goes;
  // only its report comes back. esc stops it with the rest.
  // One of your helper agents (kind = its name) gets its file's instructions, tools and model.
  async runHelper(id, args, shown, signal) {
    const asked = String(args.kind ?? '').toLowerCase();
    const own = this.helperAgents().find((h) => h.kind === asked) ?? null;
    const kind = own ? own.kind : asked === 'general' ? 'general' : 'explore';
    if (!own && shown.label !== 'Agent') shown = { ...shown, label: 'Explore' };
    // Its Model line: another model on the same Ollama service; anywhere else it runs on this one.
    // The main model by its own name is the main model (another size would load it again).
    const bare = (m) => String(m ?? '').toLowerCase().replace(/:latest$/, '');
    const otherModel = own && ![bare('main'), bare(endpointOf(this.url)?.model)].includes(bare(own.model)) ? own.model : null;
    const ownUse = otherModel && endpointOf(this.url)?.ollama ? { model: otherModel, numCtx: OWN_HELPER_CTX, keepAlive: '30m' } : undefined;
    const t0 = Date.now();
    const slot = this.slots ? { main: this.slots.side ?? this.slots.main } : undefined;
    const helper = new Agent({
      // On a model of its own it has that model's room (OWN_HELPER_CTX), so it summarizes in time.
      url: this.url, model: this.model, cwd: this.cwd, system: helperPrompt(this.messages[0].content, kind, own), thinking: this.thinking, effort: this.effort, ctx: ownUse ? Math.min(this.ctx, OWN_HELPER_CTX) : this.ctx,
      mode: this.mode, flows: false, verify: false, confirmPlan: false, checkIns: false, maxSteps: HELPER_STEPS, slots: slot, bash: this.bash,
      way: this.way, hooks: [...(this.hooks ?? [])], web: this.web, mcp: this.mcp, permissions: this.permissions, waitForServer: this.waitForServer, instructions: this.rulesSet(),
      // Its questions to you come one at a time, as the conversation's do (several helpers may ask at once on the Claude API).
      ask: (req) => (this.askLine = (this.askLine ?? Promise.resolve()).then(() => this.ask({ ...req, helper: kind }), () => this.ask({ ...req, helper: kind }))),
    });
    // Its tools: the app's, and of the MCP tools those its file names (mcp__github__get_* names several).
    const toolFilter = own ? helperToolFilter(own.tools, [...this.tools().map((t) => t.function.name), ...this.mcpEntries().map((e) => e.name)]) : kind === 'explore' ? EXPLORE_TOOLS : null;
    Object.assign(helper, { jobs: this.jobs, userHooks: this.userHooks, isHelper: true, parentTurn: () => this.turn, look: 'off', toolFilter, ownUse, canSee: this.canSee, visionOn: this.visionOn, allowedPrefixes: this.allowedPrefixes, setMode: () => {} });
    // The same MCP servers and this conversation's list of their tools (worked out for its own room), and what you allowed.
    if (this.mcpFrozen) Object.assign(helper, { mcpFrozen: this.mcpFrozen, mcpPlans: new Map(), mcpPrints: this.mcpPrints });
    // Its edits and commands can be put back with /rewind as part of your message (no point of its own).
    if (this.rewind) helper.rewind = { begin: async () => null, edited: (...a) => this.rewind.edited(...a), around: (fn) => this.rewind.around(fn) };
    const steps = [];
    let report = '';
    const say = (last) => this.emit('tool-running', { id, name: 'Agent', label: shown.label, arg: `${shown.arg} · ${steps.length} step${steps.length === 1 ? '' : 's'}${last ? ` · ${last}` : ''}` });
    // Its changes count as this message's, so "done" after them is not "nothing changed".
    const edited = new Set();
    helper.on('tool', (ev) => { if (!ev.error && ['Update', 'Write', 'Create'].includes(ev.label) && ev.arg) edited.add(String(ev.arg)); steps.push(`${ev.error ? '✗' : '⏺'} ${ev.label}(${String(ev.arg ?? '').slice(0, 80)})`); say(`${ev.label}(${String(ev.arg ?? '').slice(0, 50)})`); });
    helper.on('assistant', (ev) => { if (ev.final) report = String(ev.text ?? ''); });
    say('');
    let reason;
    try { reason = await helper.send(args.prompt, { signal }); } catch (e) { reason = 'error'; report ||= `It stopped: ${e.message}`; }
    const secs = (Date.now() - t0) / 1000;
    this.stats.requests += helper.stats.requests;
    if (edited.size && this.turn) {
      this.turn.changed = true;
      this.turn.changedHere = true;
      this.turn.testedAfterChange = false;
      for (const f of edited) this.happened?.files.add(f);
    }
    const done = reason === 'done' || reason === 'answered';
    const body = report.trim() || '(it ended without a report)';
    const view = { kind: 'agent', steps: steps.length, secs, reason, content: `${steps.join('\n')}${steps.length ? '\n\n' : ''}${body}` };
    if (signal?.aborted) { this.emit('tool', { id, name: 'Agent', ...shown, view: { ...view, reason: 'interrupted' }, error: true }); return { text: 'Interrupted.', stop: 'interrupted' }; }
    // You said no to one of its changes (with nothing more to say): the turn ends there, as it does for the conversation's own.
    if (reason === 'declined') { this.emit('tool', { id, name: 'Agent', ...shown, view: { ...view, reason: 'you said no' }, error: true }); return { text: 'The user said no to a change the helper wanted to make. Wait for their next message.', error: true, stop: 'declined' }; }
    this.emit('tool', { id, name: 'Agent', ...shown, view, error: !done && !report.trim() });
    const where = ownUse ? `, on ${ownUse.model}` : otherModel ? `, on this model: its Model line (${otherModel}) works on an Ollama service only` : '';
    return { text: `The ${kind} helper's report (${steps.length} step${steps.length === 1 ? '' : 's'}, ${Math.round(secs)} s${where}${done ? '' : `, it stopped: ${reason}`}):\n${body}`, error: !done && !report.trim() };
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
      // A part of the project's code map (docs/map/<part>.md, tools/codemap.mjs).
      if (args.part) {
        const ladder = readLadder(join(this.cwd, MAP_DIR));
        // A path for a part ("docs/map/docs/tools.md", "terminal/src/agent/x.mjs") means the part it is in (ladder.mjs partFor).
        const p = ladder ? openPart(ladder.dir, partFor(ladder, args.part) ?? args.part) : null;
        if (!p) { const all = ladder ? [...new Set(ladder.parts.map((x) => x.file.replace(/\.md$/, '')))] : []; const names = all.length <= 8 ? all : nearParts(ladder, args.part); seen({ kind: 'error', message: 'No such part' }, true); return { text: ladder ? `No part "${args.part}" in docs/map. ${all.length <= 8 ? 'Its parts' : 'Parts near it'}: ${names.join(', ')}${all.length <= 8 ? '' : ' (MAP.md lists the top ones)'}; a part names the parts inside it with an arrow.` : 'This project has no code map (docs/map). Map without a part lists its code files.', error: true }; }
        this.mapGiven = true;
        seen({ kind: 'list', count: partsOf(p.text).length, content: p.text });
        return { text: `docs/map/${p.file}:\n${p.text}` };
      }
      let map = null;
      try { map = repoMap(this.cwd, { maxChars: 4500, ladder: true }); } catch {}
      if (!map?.entries?.length) { seen({ kind: 'list', count: 0, content: '' }); return { text: 'No code files here. List shows what the folder holds.' }; }
      this.mapGiven = true;
      seen({ kind: 'list', count: map.entries.length, content: map.text });
      return { text: map.ladder ? map.text : `Code files in the project (lines: top-level names):\n${map.text}` };
    }
    if (name === 'CodeSearch') {
      const off = this.codeSearchOff();
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
    if ((this.happened?.files.size ?? 0) > filesBefore && this.turn) { this.turn.changed = true; this.turn.changedHere = true; this.turn.testedAfterChange = Boolean(out?.done); }
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
      : this.memory.saveOff || process.env.AGENTIC_MEMORY_SAVE === 'off' ? 'saving to memory is off here'
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

  // The last tool error, kept out of the trim (fitContext skips a message with keep).
  // Only the latest one: every error kept would fill the memory.
  noteError(text, msg) {
    if (!this.turn) return;
    for (const m of this.messages) if (m.keep === 'error') delete m.keep;
    if (msg) msg.keep = 'error';
    this.turn.lastError = String(text ?? '').slice(0, 2500);
  }

  // Edits land in the project, so commands see them and keep what they write. The text
  // each file had before this message first changed it is kept, with what the last edit
  // wrote; a failed check puts the first back (putBack). A helper's edits go in its
  // parent's book, so the parent's check covers them too.
  keepOriginal(prepared) {
    const t = this.parentTurn?.() ?? this.turn;
    if (!t || t.question || !prepared?.rel) return;
    t.originals ??= new Map();
    t.wrote ??= new Map();
    if (!t.originals.has(prepared.rel)) t.originals.set(prepared.rel, prepared.created ? null : prepared.before);
    t.wrote.set(prepared.rel, prepared.after);
  }

  // Why this message's changes go back, or null: a skill's check fence ran no command,
  // or the last check ran and failed. A check that never ran holds nothing back (the
  // tests hook off, or nothing to run). A stop or a no keeps the rest, as before: a no
  // refuses that one change, and /rewind undoes the message.
  putBackWhy(reason) {
    const t = this.turn;
    if (this.isHelper || this.lean || !t?.originals?.size || reason === 'interrupted' || reason === 'declined') return null;
    if (t.fence?.has('check') && !t.ranCommand) return "The skill's check never ran";
    if (t.checkFailed && this.keepProgress && this.madeProgress()) return null;
    if (t.checkFailed) return 'The check failed';
    return null;
  }

  // A loop's run: its last check failed, but fewer tests fail than before this message and none
  // fails that passed before (the owner's pick, 3 Oct 2026). Unknown either way counts as no progress.
  madeProgress() {
    const t = this.turn;
    const before = t.failsBefore ?? (this.happened?.testRun ? failsOf(this.happened.testRun.out, this.happened.testRun.code !== 0) : null);
    const after = t.failsAfter;
    if (!before || !after || before.failed == null || after.failed == null) return false;
    if (after.failed >= before.failed) return false;
    const was = new Set(before.failing);
    // Runners name at most ten failing tests: with more than that the names cannot show "none newly".
    if (before.failed > before.failing.length || after.failed > after.failing.length) return false;
    if (after.failing.some((n) => !was.has(n))) return false;
    this.emit('note', { text: `Kept: ${after.failed} of the ${before.failed} failing tests still fail and none fails newly, so this run's changes stay for the next run.`, tone: 'dim' });
    return true;
  }

  // Each changed file back to its text before this message. A file that changed after
  // the model's last edit (you, a formatter, a command) is left as it is.
  putBack() {
    const t = this.turn;
    const back = [];
    const left = [];
    for (const [rel, before] of t.originals) {
      const abs = join(this.cwd, rel);
      let now = null;
      try { now = readFileSync(abs, 'utf8'); } catch {}
      if (now !== t.wrote.get(rel)) { left.push(rel); continue; }
      if (before === null) rmSync(abs, { force: true });
      else writeFileSync(abs, before);
      back.push(rel);
    }
    t.originals = new Map();
    t.wrote = new Map();
    return { back, left };
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

  // The Desktop, as `~/…` for the screen, and whether this folder's commands
  // can write there (started from the home folder or the Desktop itself).
  get desktopDir() { return join(this.home, 'Desktop'); }
  desktopInside() { return this.desktopDir === this.cwd || this.desktopDir.startsWith(`${this.cwd}/`); }
  // The Desktop from a project folder, outside the fence (3 Oct 2026, the user's ask: "allow them to
  // think and write on my desktop"; the file had gone into the project as Desktop/CodeIndex-Helper.md
  // and every mv out was refused). Once a request in this conversation asked for a file there, a new
  // file goes right on it with Write, and the files it made there may be read and edited again.
  // Nothing else: not your files already there, not its folders (your other projects), no commands.
  desktopOpen(name, abs) {
    if (this.desktopInside() || dirname(abs) !== this.desktopDir) return false;
    if (this.desktopMade?.has(abs)) return name === 'Read' || name === 'Edit' || name === 'Write';
    return name === 'Write' && Boolean(this.desktopAsked) && !existsSync(abs);
  }
  tilde(p) { return p === this.home ? '~' : p.startsWith(`${this.home}/`) ? `~${p.slice(this.home.length)}` : p; }
  // The pages this message changed that are somewhere else than the Desktop
  // (one moved there since is gone from where it was, so it is not counted).
  pagesOffDesktop() {
    const t = this.turn;
    if (!t?.startTexts) return [];
    const out = [];
    for (const rel of [...t.startTexts.keys()].filter((r) => /\.html?$/i.test(r))) {
      const abs = resolvePath(this.cwd, rel).abs;
      if (!existsSync(abs) || abs.startsWith(`${this.desktopDir}/`)) continue;
      out.push({ rel, abs });
    }
    return out.slice(0, 2);
  }
  // Where a page goes on the Desktop: its own name, or name-v2, -v3… when a
  // page of that name is there already (the user keeps the original).
  desktopTarget(abs) {
    const name = basename(abs);
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let target = join(this.desktopDir, name);
    for (let v = 2; existsSync(target); v++) target = join(this.desktopDir, `${stem}-v${v}${ext}`);
    return target;
  }

  // The end of a turn that made a page "on my desktop", on the app's screen
  // (openPage): what the model cannot do from inside the fence. A page still
  // somewhere else is offered to be copied to the Desktop (the user's pick,
  // 30 Sep: ask each time), and the page on the Desktop opens in the browser.
  async deliverDesktop(reason) {
    const t = this.turn;
    if (!this.openPage || reason !== 'done' || !t?.changed || !t.startTexts || !asksForWork(t.request) || !wantsDesktop(t.request)) return;
    const pages = [];
    for (const rel of [...t.startTexts.keys()].filter((r) => /\.html?$/i.test(r))) {
      const abs = resolvePath(this.cwd, rel).abs;
      // Moved to the Desktop with a Bash mv: there under its own name, changed in this message.
      const moved = join(this.desktopDir, basename(abs));
      if (!existsSync(abs)) { try { if (statSync(moved).mtimeMs >= t.since - 1000) pages.push(moved); } catch {} continue; }
      if (abs.startsWith(`${this.desktopDir}/`)) { pages.push(abs); continue; }
      const target = this.desktopTarget(abs);
      const question = `Copy ${basename(abs)} to your Desktop${basename(target) !== basename(abs) ? ` as ${basename(target)}` : ''}? It is in ${this.tilde(dirname(abs))} now.`;
      const id = `desktop_${Date.now()}`;
      this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
      const answer = await this.ask({ id, name: 'Ask', args: { question, options: ['Yes, copy it', 'No, leave it there'] }, prepared: {}, label: 'Ask', arg: question });
      const said = (answer.text ?? '').trim();
      const yes = answer.choice === 'yes' || answer.choice === 'always' || /^(yes|y|ok|okay|sure|copy)\b/i.test(said);
      this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: said || (yes ? 'yes' : 'no') } });
      if (!yes) continue;
      try { copyFileSync(abs, target); } catch (e) { this.emit('note', { text: `Could not copy ${basename(abs)} to the Desktop: ${e.code ?? e.message}.`, tone: 'warn' }); continue; }
      this.emit('note', { text: `Copied to ${this.tilde(target)}.`, tone: 'dim' });
      pages.push(target);
    }
    for (const page of pages.slice(0, 2)) {
      // Open already as it is now (askPage opened it for you to look at): not a second time.
      try { if (t.opened?.get(page) === statSync(page).mtimeMs) continue; } catch {}
      try { await this.openPage(page); this.emit('note', { text: `Opened ${this.tilde(page)} in your browser.`, tone: 'dim' }); } catch (e) { this.emit('note', { text: `Could not open ${this.tilde(page)}: ${e.message}.`, tone: 'warn' }); }
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
  // Second opinion (/subagents): the request and this message's diff to the review
  // helper. Answers the message that goes back, or null (nothing real found, or it
  // could not answer: a note says so and the turn ends as it would have).
  async secondOpinion(signal) {
    const use = this.helperUse('review');
    if (!use) return null;
    this.emit('note', { text: `Second opinion: ${use.model} reads the change…`, tone: 'dim' });
    this.emit('busy', { task: 'second opinion' });
    try {
      const r = await reviewChange({ url: this.url, use, request: this.turn.request, diff: this.turn.diffs, signal });
      if (r.ok) { this.emit('note', { text: `Second opinion: ${use.model} found nothing wrong (${r.secs.toFixed(0)} s).`, tone: 'dim' }); return null; }
      this.emit('note', { text: `Second opinion: ${use.model} found ${r.findings.length} thing${r.findings.length === 1 ? '' : 's'} (${r.secs.toFixed(0)} s): ${r.findings.join(' · ')}`, tone: 'warn' });
      return `Another model read your change and thinks ${r.findings.length === 1 ? 'this is' : 'these are'} wrong (it can be wrong itself):\n${r.findings.map((f) => `- ${f}`).join('\n')}\nCheck each one with the tools. Fix what is real; for what is not, say why in one sentence. Then report.`;
    } catch (e) {
      if (signal?.aborted) throw e;
      this.emit('note', { text: `Second opinion skipped: ${use.model} did not answer (${e.message}).`, tone: 'dim' });
      return null;
    }
  }

  // UI design · checks (/subagents): each page this message changed, as a picture,
  // looked at by a helper that sees. Answers the message that goes back, or null.
  async lookAtPages(signal) {
    const use = this.helperUse('designCheck');
    if (!use || !(this.turn?.startTexts?.size || this.madePages().length)) return null;
    const pages = pagesToCheck(this.cwd, [...(this.turn.startTexts?.keys() ?? []), ...this.madePages()]);
    if (!pages.length) return null;
    // No Chrome: a Mac takes the picture with Quick Look (helper-models.mjs screenshotPage).
    const chrome = findChrome();
    if (!chrome && !canQuickLook()) return null;
    const notes = [];
    for (const rel of pages) {
      const abs = resolvePath(this.cwd, rel).abs;
      const image = screenshotPage(abs, chrome);
      if (!image) continue;
      this.emit('note', { text: `UI design: ${use.model} looks at ${rel}…`, tone: 'dim' });
      try {
        const r = await checkPagePicture({ url: this.url, use, image, page: rel, request: this.turn.request, signal });
        if (r.ok) { this.emit('note', { text: `UI design: ${use.model} says ${rel} looks right (${r.secs.toFixed(0)} s).`, tone: 'dim' }); continue; }
        this.emit('note', { text: `UI design: ${use.model} sees ${r.findings.length} thing${r.findings.length === 1 ? '' : 's'} off in ${rel}: ${r.findings.join(' · ')}`, tone: 'warn' });
        notes.push(`${rel}:\n${r.findings.map((f) => `- ${f}`).join('\n')}`);
      } catch (e) {
        if (signal?.aborted) throw e;
        this.emit('note', { text: `UI design check skipped: ${use.model} did not answer (${e.message}).`, tone: 'dim' });
        return null;
      }
    }
    return notes.length ? `A model that can see looked at a screenshot of the page (1440 px wide) and thinks this looks off (it can be wrong):\n${notes.join('\n')}\nFix what is real with Edit; then say what you changed in one sentence.` : null;
  }

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

  // A check-in while it explores: after CHECK_INS.steps different looks (Read,
  // Search, List, Bash) or CHECK_INS.secs seconds with no change made, it says
  // what it has looked at and asks where to look. The answer steers the next
  // step. The same look again does not count: one file read six times is a
  // loop, which the stuck question handles (and an answer to that one starts
  // this count over, stuckAsk).
  async checkIn(call, signal) {
    const t = this.turn;
    if (!t || !this.checkIns || t.changed || !LOOKS.has(call.name)) return null;
    const args = parseArgs(call.name, call.args).args ?? {};
    const shown = display(call.name, args);
    // Counted by the step itself; listed in plain words (the file's name, the words searched for).
    t.looked.push({ key: `${call.name} ${shown.arg ?? ''}`.trim(), said: lookSaid(call.name, args) });
    const secs = (Date.now() - t.since) / 1000;
    const seen = [...new Set(t.looked.map((l) => l.key))];
    if (seen.length < this.checkIns.steps && secs < this.checkIns.secs) return null;
    const said = [...new Set(t.looked.map((l) => l.said))];
    const q = checkInQuestion(said, secs);
    const { question } = q;
    t.looked = [];
    t.since = Date.now();
    const id = `checkin_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'checkin', args: q, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    if (answer.choice === 'no' && !answer.feedback) return { stop: 'declined' }; // "Stop here"
    const text = (answer.text ?? answer.feedback ?? '').trim();
    if (!text) return null; // no answer: carry on
    t.asked.push(question);
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text } });
    if (/^(keep going|go on|continue|carry on|yes|ok|okay|y)\W*$/i.test(text)) return { asked: true };
    return { asked: true, text: `[Check-in] You asked whether you are on the right track. The user answered: ${text}\nFollow that.` };
  }

  // The folder a request works in, when it is not a code project (folder.mjs, 4 Oct 2026): what it
  // says about itself the first time in a conversation, the names the request uses, and a question
  // for a name the folder does not settle. { kind } (null for the home folder).
  async folderNotes(text, request, signal) {
    const dir = this.turn?.workFolder ?? (isHomeFolder(this.cwd, this.home) ? null : this.cwd);
    if (!dir) return null;
    this.folderKinds ??= new Map();
    let kind = this.folderKinds.get(dir);
    if (!kind) { try { kind = folderKind(dir); } catch { return null; } this.folderKinds.set(dir, kind); }
    this.cardsGiven ??= new Set();
    this.folderLabels ??= new Map();
    // A code project: its README, for a model on another machine, once a conversation, when it says
    // something (200 characters or more); the opening read already gives git, the top and the map.
    if (kind === 'code') {
      if (!this.model?.remote || this.cardsGiven.has(dir)) return { kind };
      this.cardsGiven.add(dir);
      let readme = null;
      try { readme = folderCard(dir, { chars: 2000 }); } catch {}
      const files = (readme?.files ?? []).filter((f) => /^readme/i.test(f));
      if (!files.length || readme.text.length < 200) return { kind };
      const notes = `What this project says about itself (${files.join(', ')}; Read it for the rest):\n${readme.text}`;
      this.turn.folder = { request, notes };
      this.ctxUsed += tokensOf(notes);
      this.emit('note', { text: `Read the project's ${files.join(' and ')}`, tone: 'dim', fold: true });
      return { kind };
    }
    let card = null;
    if (!this.cardsGiven.has(dir)) { try { card = folderCard(dir); } catch {} this.cardsGiven.add(dir); }
    if (card) this.folderLabels.set(dir, card.labels);
    // Names only in a folder of data: in any other, a request's words match its files' names too often.
    let names = null;
    if (kind === 'data') { try { names = namesInRequest(text, dir, { labels: this.folderLabels.get(dir) ?? new Map() }); } catch {} }
    const said = [];
    for (const u of (names?.unclear ?? []).slice(0, 2)) {
      if (signal?.aborted) break;
      const a = await this.namesAsk(u, signal);
      if (a) said.push(`The user says "${u.word}" means ${a}.`);
    }
    const notes = [card ? `What this folder says about itself (${card.files.join(', ')}; Read the file for the rest):\n${card.text}` : '', names?.note ?? '', said.join(' ')].filter(Boolean).join('\n\n');
    if (!notes) return { kind };
    this.turn.folder = { request, notes };
    this.ctxUsed += tokensOf(notes);
    const words = (names?.matched ?? []).map((m) => `${m.word} → ${m.to ?? 'asked'}`).join(', ');
    this.emit('note', { text: `${card ? `Read the folder's ${card.files.join(' and ')}` : 'This folder'}${words ? ` · names in your request: ${words}` : ''}`, tone: 'dim', fold: true });
    return { kind };
  }

  // One question for a name of the request that the folder does not settle (folder.mjs namesQuestion).
  // What to tell the model, or null (no answer, no one to ask).
  async namesAsk(u, signal) {
    const q = namesQuestion(u);
    const { question } = q;
    const id = `names_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'names', args: q, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted || answer?.choice === 'skip') return null;
    const text = String(answer?.text ?? answer?.feedback ?? '').trim();
    if (!text) return null;
    this.turn?.asked.push(question);
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text } });
    const g = u.groups.find((x) => x.key.toLowerCase() === text.toLowerCase() || /^yes\b/i.test(text) && u.groups.length === 1);
    if (/^all of them$/i.test(text)) return u.groups.map((x) => `${x.key} (${x.names.join(', ')})`).join(' and ');
    return g ? `${g.key} (${g.names.join(', ')})` : `"${text}"`;
  }

  // What a reader sees of each page this message wrote (page-read.mjs, at most 3, newest first): a line
  // each on screen, kept for the second look. send: a page mostly empty to a reader is the text that
  // goes back to the model (else null).
  async readPages({ send = true } = {}) {
    const t = this.turn;
    const rels = pagesToCheck(this.cwd, [...(t?.startTexts?.keys() ?? []), ...this.madePages()], 3);
    if (!rels.length) return null;
    let back = null;
    t.pageReads = [];
    t.pageEmpty = new Set();
    for (const rel of rels) {
      const abs = resolvePath(this.cwd, rel).abs;
      this.emit('busy', { task: `opening ${basename(abs)} to see what a reader sees` });
      const read = await readPage(abs);
      if (!read) continue;
      const e = emptyOf(read);
      const said = this.tilde(abs);
      const line = pageReadLine(said, read, e);
      t.pageReads.push(line);
      const sending = send && e.problem && !back;
      if (e.problem) t.pageEmpty.add(said);
      const shown = e.of ? `${e.of - e.empty.length} of ${e.of} sections show text` : `${read.text.toLocaleString('en-US')} characters on screen`;
      const problems = e.problem ? [e.of ? `${e.empty.length} of ${e.of} sections show only their heading: ${e.empty.slice(0, 6).map((x) => x.title || x.id || 'untitled').join(', ')}` : `only ${read.text} characters on screen of ${(read.bytes / 1000).toFixed(1)} KB`, ...(read.errors?.length ? ['a script stopped with an error when it opened'] : [])] : [];
      this.emit('note', { text: `Page check, ${line}${sending ? '; sent back to fill it' : ''}.`, tone: e.problem ? 'warn' : 'dim', check: { title: 'Page check', page: said, problems, ok: shown, bad: shown, where: read.ran ? 'opened in WebKit, scripts run' : 'read as text', sent: sending } });
      if (sending) back = pageReadNote(said, read, e);
    }
    return back;
  }

  // What this message made or changed: its Writes and Edits and the files its commands wrote, each with
  // its size now and, for a page, what the page check found (the "Made" lines under the answer).
  madeSummary() {
    const t = this.turn;
    if (!t || this.isHelper) return [];
    const files = new Map();
    const created = new Set((t.created ?? []).map((c) => resolvePath(this.cwd, String(c)).abs));
    for (const rel of t.startTexts?.keys() ?? []) { const abs = resolvePath(this.cwd, rel).abs; files.set(abs, created.has(abs) || t.startTexts.get(rel) == null); }
    for (const abs of t.madeByCommand?.keys() ?? []) if (!files.has(abs)) files.set(abs, true);
    const out = [];
    for (const [abs, isNew] of files) {
      let bytes;
      try { bytes = statSync(abs).size; } catch { continue; }
      // Inside the project: its path from there; elsewhere with ~ (the page check's lines use ~ throughout).
      const said = this.tilde(abs);
      const page = (t.pageReads ?? []).find((l) => l.startsWith(`${said}:`));
      out.push({ path: abs.startsWith(`${this.cwd}/`) ? relative(this.cwd, abs) : said, bytes, created: isNew, ...(page ? { page: `page check: ${page.slice(said.length + 2)}`, empty: Boolean(t.pageEmpty?.has(said)) } : {}) });
    }
    return out;
  }

  // The pages a command wrote this message (made.mjs), as paths from the project folder.
  madePages() {
    return [...(this.turn?.madeByCommand?.keys() ?? [])].filter((a) => /\.html?$/i.test(a) && existsSync(a)).map((a) => relative(this.cwd, a));
  }

  // Stuck: the same step again and again, or three tool errors in a row. One question that says what it is
  // working on, what it tried and what came of it; a way out picked, or a hint, goes straight to the model.
  async stuckAsk(why, call, out, signal, { tries = 3 } = {}) {
    const t = this.turn;
    const step = stepSaid(call.name, parseArgs(call.name, call.args).args ?? {});
    const err = errorSaid(call.name, out?.text);
    const plan = t?.planAt != null ? this.todos ?? [] : [];
    const next = plan.find((x) => x.status === 'pending')?.text ?? '';
    const q = stuckQuestion(why, step, err, { tries, goal: plan.find((x) => x.status === 'in_progress')?.text ?? '', result: why === 'repeat' ? sameResultSaid(call.name, String(out?.text ?? '')) : '' });
    const { question } = q;
    const id = `stuck_${Date.now()}`;
    if (t) t.stuckAsks = (t.stuckAsks ?? 0) + 1;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'stuck', args: q, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    if (answer.choice === 'skip') return null; // no one to ask: carry on as before
    if (answer.choice === 'no' && !answer.feedback) return { stop: 'declined' }; // "Stop here"
    // You were just asked: the check-in counts from here, so the two never ask about one loop.
    if (t) { t.looked = []; t.since = Date.now(); }
    const text = (answer.text ?? answer.feedback ?? '').trim();
    if (!text) return null;
    t?.asked.push(question);
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text } });
    // The ways out: stop; another way ("Keep going" means that too: the same again is what it was doing); skip.
    if (/^stop( here)?\W*$/i.test(text)) return { stop: 'declined' };
    const was = why === 'repeat' ? `You sent the same step ${tries} times (${step}) and nothing changed` : `Three steps in a row failed (the last: ${step})`;
    if (/^(try (a|an)?\s*(different|other|another) way|keep going|go on|continue|carry on|yes|ok|okay|y)\W*$/i.test(text)) return { text: `[Stuck] ${was}. The user says: try a different way. Do not send that step again; reach what it was for another way, or go on to the next step.` };
    if (/^skip( (this|that|the) step| it)?\W*$/i.test(text)) return { text: `[Stuck] ${was}. The user says: skip this step. Leave it and go on with the rest of the request${next ? `; next in your plan: ${next}` : ''}. In your final answer, say that this step was skipped.` };
    return { text: `[Stuck] You were going round in circles and asked the user for a hint. The user answered: ${text}\nFollow that.` };
  }

  // One yes-or-steer question before changing files; yes (or "ok", "go")
  // allows the rest of this message's changes.
  async confirm(plan, signal) {
    const q = planQuestion(plan);
    const { question } = q;
    const id = `plan_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'plan', args: q, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    const text = (answer.text ?? '').trim();
    const yes = answer.choice === 'yes' || answer.choice === 'always' || /^(yes|y|ok|okay|go|go ahead|sure|do it|yep|👍|yes,? go ahead)\W*$/i.test(text);
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
  // Several questions (more) are asked one after another, each with its place ("1 of 2").
  async askUser(id, args, shown, signal) {
    this.userHooks?.fire('Notification', { message: `Agentic Coder asks: ${String(args.question ?? '').slice(0, 200)}`, notification_type: 'question' });
    const questions = askedQuestions(args);
    if (!questions.length) questions.push({ question: String(args.question ?? ''), options: [], about: [], recommended: -1, several: false });
    const got = [];
    for (const [i, q] of questions.entries()) {
      const qid = i ? `${id}_${i}` : id;
      const qShown = i ? { label: 'Ask', arg: q.question } : shown;
      this.emit('tool-ask', { id: qid, name: 'Ask', ...qShown });
      const answer = await this.ask({ id: qid, name: 'Ask', args: { ...q, ...(questions.length > 1 ? { step: { at: i + 1, of: questions.length } } : {}) }, prepared: {}, ...qShown });
      if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      if (answer.choice === 'no' || !answer.text?.trim()) {
        this.emit('tool', { id: qid, name: 'Ask', ...qShown, view: { kind: 'declined', feedback: answer.feedback }, error: true });
        const sofar = got.length ? ` Their answers before that: ${got.map((g) => `${g.question} → ${g.text}`).join('; ')}.` : '';
        return { text: `The user did not answer${answer.feedback ? ` and wrote: ${answer.feedback}` : '. Wait for their next message.'}${sofar}`, error: true, stop: answer.feedback ? null : 'declined' };
      }
      const text = answer.text.trim();
      this.turn?.asked?.push(q.question);
      this.emit('tool', { id: qid, name: 'Ask', ...qShown, view: { kind: 'answer', question: q.question, text } });
      got.push({ question: q.question, text });
    }
    const hint = this.rememberHint('answers');
    if (got.length === 1) return { text: `The user answered: ${got[0].text}${hint ? `\n${hint}` : ''}` };
    return { text: `The user answered:\n${got.map((g, i) => `${i + 1}. ${g.question} → ${g.text}`).join('\n')}${hint ? `\n${hint}` : ''}` };
  }

  // Keep the conversation inside the model's memory: first empty old tool
  // outputs, then (if still too big) replace the history with a summary.
  // Emptying an old output makes the model re-read everything after it, so
  // it happens rarely and deeply: past trimAt, the oldest outputs go until
  // the conversation is under TRIM_TO. (Trimming just enough once emptied the
  // file the model had just read, so it read it again, step after step.)
  async fitContext(signal) {
    // The next reply needs its room too: at 16k, trimming without counting it
    // let a High reply run into the end of the memory mid-thought. The room is
    // the answer's 2,048 and the thinking that still fits (thinkRoom): in a
    // tight memory the thinking shrinks first, and nothing is cut while it fits.
    let est = this.estNow();
    const room = replyRoom(this.thinking, this.thinkRoom(est));
    // Where the cleanup starts: the model's whole memory, or /remote's Clean up at (cleanCap).
    const cap = this.cleanCap;
    if (est + room < cap * this.trimAt) return;
    // Notes and a summary both start over from what a restart keeps. When that
    // alone leaves no room for a reply, they free nothing and come back after
    // the very next step: at 16k a 7,300-token start wrote notes four times in
    // 18 minutes and changed nothing (countdown card, 1 Oct). Then only
    // trimming old output can help.
    const kept = this.keptTokens();
    const restartFits = kept + NOTES_ROOM + room < cap * this.trimAt;
    if (!restartFits && this.turn && !this.turn.toldTight) {
      this.turn.toldTight = true;
      this.emit('note', { text: `The ${Math.round(cap / 1024)}k memory is nearly all taken by this request's start (about ${kept.toLocaleString('en-US')} tokens: the instructions, the request and what came with it), so notes would free nothing; carrying on without them. ${cap < this.ctx ? 'A later Clean up at in /remote’s More' : 'A bigger memory in /effort'} gives it room.`, tone: 'warn' });
    }
    // On a model on another machine, older copies go first (dropSuperseded): what the conversation holds a
    // newer copy of frees room and loses nothing, where notes start the conversation over and the model reads
    // its files again. Only when that leaves real room (8% of the memory); else the notes, as before.
    if (this.model?.remote) {
      const d = this.dropSuperseded();
      if (d.freed) {
        est -= d.freed;
        this.ctxUsed = Math.max(0, this.ctxUsed - d.freed);
        const what = [d.reads ? `${d.reads} older read${d.reads === 1 ? '' : 's'} of ${d.files} file${d.files === 1 ? '' : 's'}` : '', d.writes ? `${d.writes} older version${d.writes === 1 ? '' : 's'} it wrote` : '', d.runs ? `${d.runs} older run${d.runs === 1 ? '' : 's'} of the same command` : ''].filter(Boolean).join(', ');
        this.emit('note', { text: `Memory: dropped what it has a newer copy of (${what}), about ${d.freed.toLocaleString('en-US')} tokens.`, tone: 'dim' });
        if (est + room < cap * (this.trimAt - 0.08)) return;
      }
    }
    // Notes first. Emptying old output makes the model read again everything
    // after it (measured: 186 to 261 s each time, up to half of a long try).
    // Its notes are written in the conversation it already holds, so only
    // the notes themselves are read afterwards.
    if (this.whenFull === 'notes' && restartFits && est + NOTES_ROOM + NOTES_THINK < this.ctx * 0.97 && await this.notesInPlace(signal)) return;
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
      if (est - freed < cap * TRIM_TO) break;
      const m = this.messages[i];
      if (keep.has(i) || m.keep || m.content.length <= 300) continue;
      freed += tokensOf(m.content);
      m.content = `[older output removed to save space: ${m.content.slice(0, 120).replace(/\n/g, ' ')}…]`;
    }
    est -= freed;
    this.ctxUsed = Math.max(0, this.ctxUsed - freed);
    if (freed) this.emit('note', { text: `Trimmed old tool output to save memory (about ${freed.toLocaleString()} tokens).`, tone: 'dim' });
    if (restartFits && est + room >= cap * this.fullAt) await this.compact(signal);
  }

  // Older copies of what the conversation holds a newer copy of (5 Oct 2026: in the hard task's runs a model
  // read one file five to twenty times, wrote it three to six times whole and ran the same tests ten times;
  // memory filled in most runs, the notes started the conversation over, and it read the files again):
  //  - an older Read of a file whose text came again later: the whole file, or the same lines;
  //  - an older whole version it wrote (a Write's content) of a file it wrote or read whole again later;
  //  - an older output of a command it ran again later, word for word.
  // The newest two outputs, a kept error and anything short stay. A dropped output starts as the trim's own
  // does ("[older output removed"), so a Read of it later is given the text again, not pointed back to it.
  dropSuperseded() {
    const calls = new Map();
    for (const m of this.messages) {
      if (m.role !== 'assistant') continue;
      for (const tc of m.tool_calls ?? []) {
        const f = tc.function ?? tc;
        let args = null;
        try { args = typeof f.arguments === 'string' ? JSON.parse(f.arguments || '{}') : f.arguments; } catch { /* a call that did not parse had no result worth keeping track of */ }
        if (args && typeof args === 'object') calls.set(tc.id, { name: toolNameOf(f.name, this.way), args, f });
      }
    }
    const STUB = '[older output removed';
    const text = (m) => (typeof m.content === 'string' ? m.content : '');
    const abs = (p) => { try { return resolvePath(this.cwd, String(p)).abs; } catch { return null; } };
    // What a Read's result holds, from its own first lines: the whole file ("x (60 lines):"), or lines a-b.
    const holds = (t) => {
      const head = t.split('\n').slice(0, 3).join('\n');
      const part = /\(lines (\d+)-(\d+) of \d+/.exec(head);
      if (part) return `${part[1]}-${part[2]}`;
      return /^(?:\([^\n]*\)\n)?[^\n]* \(\d+ lines?\):/.test(head) ? 'whole' : null;
    };
    const newest = new Set(this.messages.filter((m) => m.role === 'tool').slice(-2));
    const laterRead = new Map(); // file → the parts a later result holds
    const laterWrite = new Set(); // file → written whole again later
    const laterRun = new Set(); // command → ran again later
    const out = { freed: 0, reads: 0, files: 0, writes: 0, runs: 0 };
    const files = new Set();
    const resultOf = new Map(this.messages.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, m]));
    for (let i = this.messages.length - 1; i > 0; i--) {
      const m = this.messages[i];
      if (m.role === 'tool') {
        const c = calls.get(m.tool_call_id);
        const t = text(m);
        // Not a copy of anything: dropped already, or the line that points back to an earlier Read.
        if (!c || !t || t.startsWith(STUB) || t.startsWith('You already read')) continue;
        const read = c.name === 'Read' ? c.args : c.name === 'Bash' && typeof c.args.command === 'string' ? (plainRead(c.args.command, this.cwd)?.name === 'Read' ? plainRead(c.args.command, this.cwd).args : null) : null;
        const file = read && typeof read.path === 'string' ? abs(read.path) : null;
        const cmd = c.name === 'Bash' && typeof c.args.command === 'string' ? c.args.command.trim() : null;
        const has = file ? holds(t) : null;
        const later = file ? laterRead.get(file) : null;
        const stale = (file && has && later && (later.has('whole') || later.has(has))) || (!file && cmd && laterRun.has(cmd));
        if (stale && !newest.has(m) && !m.keep && t.length > 300) {
          const said = file ? `an older copy of ${relative(this.cwd, file) || basename(file)}; its text is further down` : `an earlier run of ${cmd.split('\n')[0].slice(0, 80)}; its newest run is further down`;
          const stub = `${STUB} to save space: ${said}]`;
          out.freed += Math.max(0, tokensOf(t) - tokensOf(stub));
          m.content = stub;
          if (file) { out.reads++; files.add(file); } else out.runs++;
          continue;
        }
        if (file && has) laterRead.set(file, (later ?? new Set()).add(has));
        // A command that ran (not one turned away) counts as the newer run, however short its output.
        else if (!file && cmd && !m.keep && !/^(blocked|Nothing ran|The user said no)/i.test(t) && !/is outside the project folder/.test(t.slice(0, 200))) laterRun.add(cmd);
      } else if (m.role === 'assistant' && i < this.messages.length - 2) {
        for (const tc of [...(m.tool_calls ?? [])].reverse()) {
          const c = calls.get(tc.id);
          if (c?.name !== 'Write' || typeof c.args.path !== 'string' || typeof c.args.content !== 'string') continue;
          const file = abs(c.args.path);
          if (!file) continue;
          const landed = /^(Created|Updated) /.test(text(resultOf.get(tc.id) ?? {}));
          if (c.args.content.length > 1200 && (laterWrite.has(file) || laterRead.get(file)?.has('whole'))) {
            const stub = '[an older version of this file, removed to save space: it was written or read whole again later]';
            out.freed += Math.max(0, tokensOf(c.args.content) - tokensOf(stub));
            const slim = { ...c.args, content: stub };
            c.f.arguments = typeof c.f.arguments === 'string' ? JSON.stringify(slim) : slim;
            out.writes++;
          } else if (landed) laterWrite.add(file);
        }
      }
    }
    out.files = files.size;
    return out;
  }

  // Its notes, written by the model in the conversation it already holds
  // (nothing to read but the request for them), then the conversation starts
  // over from the request and the notes. False when no usable notes came.
  async notesInPlace(signal) {
    if (this.messages.length <= 3) return false;
    // Numbered within the request, so a fourth time reads as a fourth time.
    const n = this.turn ? (this.turn.fulls = (this.turn.fulls ?? 0) + 1) : 1;
    this.emit('note', { text: `Memory full (${n}): saving notes, then carrying on`, tone: 'dim' });
    this.emit('busy', { task: 'saving notes' });
    const t0 = Date.now();
    const ask = auto(`Your memory is nearly full. Write your notes now, in plain words and under 200 words, with no tool call: what you have done so far, the files and line numbers that matter, any cause you have already worked out (word for word), and the single next step.`);
    // The newest tool output came after the model's last reply: it has not
    // read it yet. Reading it only to summarize it away costs a whole step
    // (70 s for 130 lines of a page, measured), so it is held back from the
    // notes and follows them, as it is.
    const held = this.heldBack();
    const asked = held ? [...this.messages.slice(0, -held.length), held[0], { ...held[1], content: '(This output is kept for you: it comes back, whole, right after your notes.)' }] : this.messages;
    let summary = '';
    let called = false;
    try {
      // Thinking stays on (turning it off would change the prompt and read it all
      // again) but is capped at NOTES_THINK, so the 700 tokens go to the notes. A service
      // has no such cap (Ollama: 4 Oct 2026, every note came out empty, the thinking took
      // all 828 tokens), and there turning it off for one step costs about 1.3 s.
      const remote = Boolean(this.model?.remote);
      const think = this.thinking && !remote;
      const sampling = think ? this.model.thinkingSampling : this.model.sampling;
      const notesCall = (tools) => streamChat({ url: this.url, conversation: this.conversation, messages: [...this.withTurnNotes(asked), { role: 'user', content: ask }], tools, toolChoice: 'none', extra: { stop: CALL_STOPS }, thinking: think, effort: this.stepEffort(), model: this.model, sampling, maxTokens: NOTES_ROOM + (remote ? 1024 : think ? NOTES_THINK : 0), thinkCap: NOTES_THINK, slot: this.slots?.main, signal });
      for await (const ev of notesCall(this.tools())) {
        if (ev.type === 'text') summary += ev.text;
        if (ev.type === 'tool') called = true;
      }
      // A model that answers with a tool call (Ollama does not hold it to toolChoice 'none'; gpt-oss's notes came
      // out empty every time, 4 Oct 2026) is asked once more with no tools: one more read of the conversation.
      if (called && beforeCall(summary).trim().length < 40) {
        summary = '';
        this.emit('note', { text: 'It answered the notes request with a tool call: asked again with no tools.', tone: 'dim' });
        for await (const ev of notesCall([])) if (ev.type === 'text') summary += ev.text;
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      return false;
    }
    summary = beforeCall(summary).trim();
    if (summary.length < 40) {
      this.emit('note', { text: `Notes came out empty${called ? ' (it called a tool instead)' : summary ? ` (only "${summary.slice(0, 60)}")` : ''}: freeing memory another way`, tone: 'dim' });
      return false;
    }
    const before = this.ctxUsed;
    if (!this.restartFrom(summary, held)) return false;
    // The instructions are read from their saved state, not again from the start.
    try { await this.rewarm?.(signal); } catch (e) { if (signal?.aborted) throw e; }
    this.emit('compacted', { summary, inPlace: true, n: this.turn?.fulls ?? 1, secs: (Date.now() - t0) / 1000, freed: Math.max(0, before - this.ctxUsed) });
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
    // Its plan of this message goes with the notes: the TodoWrite that held it is left behind.
    const steps = this.turn?.planAt != null ? planList(this.todos) : '';
    const plan = steps ? `\n\nMy plan, as I last wrote it with TodoWrite:\n${steps}` : '';
    if (plan) this.turn.planAt = this.turn.steps ?? 0;
    // The request's cases go with the notes too: the step's result that listed them is left behind
    // (4 Oct 2026: memory filled in three runs of four, and the list was gone from then on).
    const cases = this.turn?.cases?.length && !this.turn.casesDone ? `\n\nThe request's cases (before I answer, each needs a test that tries its example):\n${this.turn.cases.map((c, i) => `${i + 1}. ${c.text}`).join('\n')}` : '';
    // The request is at the top again: its reminder counts from here.
    if (this.turn) this.turn.requestAt = this.turn.steps ?? 0;
    // The notes that go with the request (the steps for its kind of bug, a
    // check the fix path made) follow the request into the new conversation.
    for (const x of [this.turn?.bug, this.turn?.skill, this.turn?.look, this.turn?.math, this.turn?.design, this.turn?.carried].filter(Boolean)) {
      const i = (this.turn?.opening ?? []).filter((m) => this.messages.includes(m)).indexOf(x.request);
      if (i >= 0) x.request = opening[i];
    }
    this.messages = [this.messages[0], ...opening,
      // "Nothing is saved anywhere else": after its notes the model once went
      // looking for them on disk (ls ~/.claude/sessions, chart bug, 27 Sep).
      { role: 'assistant', content: `My memory filled up, so I wrote down where I am. My notes (all of them are here; nothing is saved anywhere else):\n${summary.trim()}${facts}${plan}${cases}${this.seenSoFar()}` },
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

  // How many messages you and the model have said. The opening read (giveOpening: two messages the
  // app put in) is not conversation, so on a remote one short exchange is still too short to
  // summarize, as it is on this Mac, where there is no opening read and the count is the same as before.
  said() { return this.messages.filter((m) => !m.opening && !m.maps && !(m.tool_calls ?? []).some((c) => /^(opening|maps)_/.test(String(c.id)))).length; }

  async compact(signal, { instructions } = {}) {
    if (this.said() <= 3) return;
    this.emit('note', { text: 'Summarizing the conversation to free memory…', tone: 'dim' });
    this.emit('busy', { task: 'summarizing' });
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
    // On a service with a Side jobs helper (/subagents) it writes the summary; if it cannot, the main model does.
    const side = this.sideUse();
    const sum = async (use) => { summary = ''; for await (const ev of streamChat({ url: this.url, messages: ask, thinking: false, sampling: this.model.sampling, maxTokens: 600, slot: this.slots?.side, signal, use })) if (ev.type === 'text') summary += ev.text; };
    try { await sum(side); } catch (e) {
      if (!side || signal?.aborted) throw e;
      this.emit('note', { text: `Side jobs: ${side.model} could not write the summary (${e.message}); the main model does.`, tone: 'dim' });
      await sum(undefined);
    }
    if (this.restartFrom(summary)) this.emit('compacted', { summary: summary.trim(), n: this.turn ? (this.turn.summaries = (this.turn.summaries ?? 0) + 1) : 1 });
  }
}
