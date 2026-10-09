// What the Agent reads in a reply and its limits (agent.mjs): the numbers it works to, and the checks of
// a reply's text (asks the user, says it is done, a call written as text, thinking that leaked).
import { randomUUID } from 'node:crypto';
import { planSaid } from './questions.mjs';
import { EXPLORE_TOOLS, didYouMean, resolvePath } from './tools.mjs';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { isSmallTalk } from '../flows/index.mjs';
import { wantsDesktop } from '../flows/words.mjs';
import { readResults } from '../flows/results.mjs';
import { MCP_TOOL, isMcpCall } from './mcp.mjs';

export const MAX_STEPS = 40;
// Its plan (TodoWrite) goes back with a step's result after this many steps without it, while steps
// are left: in a long message the list it wrote at the start is far up the conversation by then.
export const PLAN_EVERY = 5;
// Your request comes back the same way every REQUEST_EVERY steps on a model whose memory is this big or
// bigger (a model on a service: 256k), where by then much of the conversation sits between it and the
// newest step. A smaller memory is cleaned up long before that, and starts again from the request.
export const REQUEST_EVERY = 10;
export const BIG_MEMORY = 65_536;
export const newConversation = () => randomUUID().slice(0, 8);
// How many times what the layout check finds goes back to the model in one
// message: the first look, and once more when its fix left something (30 Sep:
// Qwen's one fix made the play button fainter, 3.9 → 3.7:1, and the turn ended).
export const LAYOUT_ROUNDS = 2;
// When the model decides (way.mjs): the calls of one reply that run, in order.
export const MAX_CALLS = 8;
// A request about an MCP server's data answered with no MCP tool tried: sent back this many times, then replaced.
export const MCP_BACKS = 2;
// Its own tools on Model (tools.mjs MODEL_TOOL_DEFS), run by the agent itself.
export const MODEL_TOOLS = new Set(['Map', 'CodeSearch', 'Rename', 'TestFirst', 'Remember']);
// The calls that change the project's files (the cases' ask comes with the first of them).
export const CHANGES = new Set(['Edit', 'Write', 'apply_patch', 'TestFirst', 'Rename']);
export const CASE_ITEM = { type: 'object', properties: { example: { type: 'string' }, expect: { type: 'string' } }, required: ['example', 'expect'] };
export const CODE_SEARCH_CHARS = 6000; // what one CodeSearch brings back, at most (~1,700 tokens)
// A request's time for thinking (30 Sep 2026): past half of it, it thinks only briefly, so it
// finishes instead of running out of time (practice task 28 at High ran out of its 30 minutes on
// 29 Sep, while Low passed it in under 3). The chat keeps the template's thinking switch and is
// capped at STEP_DOWN_CAP tokens a reply: Gemma's template puts the switch at the very top of the
// prompt, so turning it off would read the whole conversation again. The focused paths' own calls
// stop thinking. AGENTIC_THINK_BUDGET: seconds (0: never); the practice runs pass their limit.
export const THINK_BUDGET_SECS = 900;
export const STEP_DOWN_CAP = 64;
export const budgetFromEnv = () => { const v = Number(process.env.AGENTIC_THINK_BUDGET); return Number.isFinite(v) && v >= 0 ? v : THINK_BUDGET_SECS; };
export const TRIM_AT = 0.78; // share of the context that starts a trim
export const TRIM_TO = 0.45; // …and where it stops
export const FULL = 0.85; // past this share (with the reply room counted) trimming was not enough: summarize
export const RESULT_MAX = 30_000; // the most characters one tool result keeps (Claude Code's own for a command)
// Room kept free for one reply: thinking (up to the server's reasoning budget)
// plus the answer. At 16k, a trim at 78% left too little, and a High reply
// ran into the end of the memory (chart bug, 25 Sep). The thinking part is the
// model's own budget, so raising it in model.mjs leaves the answer its 2,048.
export const replyRoom = (thinking, budget = 2048) => (thinking ? 2048 + budget : 2048);
export const NOTES_ROOM = 700; // tokens for its notes when memory fills (about 200 words, with room to spare)
// Its notes think only briefly. With the full thinking cap, Bonsai's thinking took all
// 700 tokens three times running and left no notes (countdown card, 1 Oct).
export const NOTES_THINK = 128;
// When the memory is tight, a reply's thinking shrinks to what fits under the trim line,
// down to this, before notes are written. At 16k with a 4,096 cap the request's start
// (7,300 tokens) was already over the line, so notes came after every step (1 Oct).
export const LEAST_THINK = 512;
// Claude's notes that go with a request in a memory of 16k or less (else claude-notes.mjs TOP).
export const SMALL_CTX_NOTES = 2;
// Its own thinking goes back with each step: the model's chat template shows
// every earlier step's thinking, and without it each step looked as if it had
// thought nothing, so it worked the cause out again (or lost it). The newest
// KEEP_THOUGHTS steps keep all of it; older ones keep only their key lines
// once memory runs short.
export const KEEP_THOUGHTS = 3;
// A question that names files gets them read in one go (see prefetch).
export const PREFETCH_MAX_LINES = 1000;
// Characters a question's named files may fill: /effort's Up-front reading, a share of the context (room.mjs: 45,000 at 32k).
export const MAP_MIN_FILES = 4; // fewer code files than this: no project map, the model just reads them
// Any other request in a project: the files it is most likely about
// (rank.mjs), read before the first step. The budget follows the memory:
// ~2,950 tokens at 16k (about 20 s of reading), ~5,900 at 32k, at most 8,000.
export const RANK_SHARE = 0.18;
export const RANK_MAX_TOKENS = 8000;
export const TESTS_FIRST_MS = 60_000; // the tests helper's run before the first step
// Asking about code even when the request was not sorted (plan mode, a folder that is not a project).
export const EXPLAIN = /\b(explain|describe|walk me through|summari[sz]e|what does|how does|what is in|tell me about)\b/i;
// A message that says the last turn went wrong.
export const CORRECTS = /^(no[,.! ]|nope\b|wrong\b|that('?s| is| was) (not|wrong)|this is (not|wrong)|not what i\b|that('?s| is) not what\b|you (broke|missed|forgot|did ?n[o']t|should ?n[o']t have|were not supposed)|undo (that|this|it)\b|revert (that|this|it)\b|put it back\b|why did you\b|i (did ?n[o']t|never) (ask|say|want))/i;

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
export const tokensOf = (s) => Math.ceil((s?.length ?? 0) / 3.6);

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
export const CUT_MARK = '[… cut here by Agentic Coder for this check; the rest is in the file]';
export const auto = (text) => `${AUTO} ${text}`;
// The same call again: after the second, and with "Keep going" to the stuck question.
export const SAME_STEP = 'You already did exactly this step. Do something different, or finish.';
// With the request while Bypass permissions is on (see send()).
export const BYPASS_OPEN = "Bypass permissions is on: Read, List, Search, Write, Edit and commands may use any folder on this Mac (a full path is fine), and commands may reach the internet. Still refused: secrets outside the project (keys, .ssh, .env), Agentic Coder's own settings, rm -rf, sudo, git push, stopping processes and the user's never-list.";
// The same while Agentic Coder works on itself (permissions.mjs isSelf: Bypass on the Claude API).
export const SELF_OPEN = "Bypass permissions is on, and you run on the Claude API, so Agentic Coder may work on itself: Read, List, Search, Write, Edit and commands may use any folder on this Mac (a full path is fine), commands may reach the internet, and its own settings, rules, hooks, memory and code may change (a copy of each file as it was is kept first), git push runs, and a process of its own may be stopped. The App tool runs its slash commands, reads or sets a setting, and restarts it on code you changed; when its own code changed and the tests pass, it restarts on its own after your answer. Still refused: secrets outside the project (keys, .ssh, .env), the door's own file, the two destructive commands (rm -rf, sudo) and the user's never-list.";
// The turn's last word when it was stopped as stuck: before, the user got only the app's
// warning line after 5 minutes of work (3 Oct 2026, a math check of a folder).
export const STUCK_WORD = (why) => `You were stopped because ${why}. Do not call any tool. In at most five short lines, tell the user what you found so far (with the numbers and file names you have), what blocked you, and what they could tell you or try next.`;

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

// A reply that says it will run a command and ends with that command in a shell block, with no
// call: the command never ran (qwen3-coder-next on the service, 9 Oct 2026: "First, let me locate
// the existing memory file." then ```bash find …``` for "update memory", twice, each message over
// in 2 s with nothing run and nothing saved). Answers the command, or '' when the reply does not
// end that way. Commands offered to the user ("Run something like:", several blocks) are not this.
export function commandInText(text) {
  const t = String(text ?? '').trimEnd();
  const m = /```(?:bash|sh|shell|zsh|console)?[ \t]*\n([\s\S]*?)\n?```$/i.exec(t);
  if (!m) return '';
  const before = t.slice(0, m.index);
  if (before.includes('```')) return '';
  const cmd = m[1].split('\n').map((l) => l.replace(/^\s*\$\s+/, '')).join('\n').trim();
  if (!cmd || cmd.split('\n').length > 10) return '';
  return announcesNextStep(before.replace(/[‘’]/g, "'")) ? cmd : '';
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
export const LOOK_TOOLS = new Set(['Read', 'Search', 'List', 'Map', 'CodeSearch', 'Agent']);
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
export function searchWords(text) {
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
export const MENTIONS_WALL = /\b(log ?in|sign ?in|sign ?up|login|token|auth\w*|password|blocked|not (?:there|found|open)|missing|does not exist|doesn't exist|could ?n[o'’]t (?:reach|open|get|find|read)|unable to (?:reach|open|get|find|read)|40[134]|5\d\d)\b/i;
// A request with several asks ("analyze the link… can we use the calculator…? can you check? can you
// take all of the formulas… and test them all?"): two questions or more, or a list of things to do.
export function severalAsks(text) {
  const t = String(text ?? '');
  return (t.match(/\?/g) ?? []).length >= 2 || (t.match(/^\s*(?:\d+[.)]|[-*•])\s+\S/gm) ?? []).length >= 2 || (t.length > 120 && (t.match(/\b(?:and then|then|also|after that|as well as)\b/gi) ?? []).length >= 2);
}
// The run of a check for the facts: its command's last line (a heredoc script ends with the line that runs it).
export const runLine = (cmd) => String(cmd ?? '').trim().split('\n').map((l) => l.trim()).filter(Boolean).pop()?.slice(0, 140) ?? '';
export const countLine = (out) => String(out ?? '').split('\n').map((l) => l.trim()).reverse().find((l) => /\b\d+ (?:passed|failed|passing|failing)\b|\b\d+\s*(?:\/|of)\s*\d+ (?:passed|pass|ok)\b/i.test(l))?.slice(0, 160) ?? '';

// A request that wants its file on the Desktop (flows/words.mjs, where the sorting uses it too).
export { wantsDesktop };
// An answer that holds code to put in a file (a fenced block of three lines or more) instead of a change.
export const writesCodeInstead = (text) => /```[^\n]*\n(?:[^\n]*\n){3,}[\s\S]*?```/.test(String(text ?? ''));

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
export const kTok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

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

// A reply with no call that the server says was far longer than what arrived (its words and thinking):
// a call written and dropped on the way. A reply cut at the limit is the cut handling's.
export function lostCall(turn, text) {
  const said = [turn?.text, text].reduce((a, b) => (String(b ?? '').length > a.length ? String(b) : a), '');
  const got = tokensOf(`${turn?.reasoning ?? ''}${said}`);
  const wrote = turn?.tokens ?? 0;
  return turn?.finish !== 'length' && wrote - got >= 1000 && wrote > got * 3;
}
export const LOST_CALL = 'Your last reply wrote a tool call that never arrived: it was lost on the way (a long file in one call can be dropped by the model server), so nothing ran. Take that step again, smaller. For a file: Write a short first version now (under 80 lines: its outline and first part), then add the rest with Edit, one part at a time.';

export function cutCallNote(name, path) {
  const file = path || 'the file';
  if (name === 'Write' || name === 'Edit') {
    return `Your ${name} call ran out of room before the end, so nothing was written: the whole content does not fit in one reply. ${inParts(file)}`;
  }
  return `Your ${name} call ran out of room before the end and was not run. Do it again in smaller pieces.`;
}
// A reply cut at the limit with nothing of it arrived: Ollama holds a tool call back until it is
// whole, so a call cut off never comes at all (nor its path).
export const emptyCutNote = () => `Your reply reached the reply limit before it ended, and none of it arrived: most likely a file too long for one reply. ${inParts('the file')}`;

// Where a tool call written as text starts: <tool_call> (Qwen's kind and the
// 27B's), <ifm|tool_calls> / <ifm|tool_call> (K2 Horizon's). The text before
// it is what the model said; the stop words keep a text-only reply from one.
export const CALL_MARK = /<tool_call>|<ifm\|tool_calls?>/;
// What a service says when it cannot read the tool call a model wrote (Ollama's tool parsers).
export const CALL_UNREADABLE = /\b(?:XML syntax error|error parsing tool call|failed to parse (?:the )?tool call|unexpected end of JSON input)\b/i;
export const CALL_STOPS = ['<tool_call>', '<ifm|tool_calls>', '<ifm|tool_call>'];
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
  // The same with its tag cut short: <Name> for <function=Name>, and no <tool_call> round it (Qwen3.6 on a
  // service, 8 Oct 2026: "<Search>\n<parameter=pattern>\nfile-card\n</parameter>\n</function>", every step
  // of a page request, so no tool ever ran and no page was made). It needs a <parameter=…> and the
  // </function>, which no page or prose has.
  const y = /(?:<tool_call>\s*)?<(?:function=)?([A-Za-z][\w-]*)>\s*((?:<parameter=[^>\s]+>[\s\S]*?<\/parameter>\s*)+)<\/function>(?:\s*<\/tool_call>)?/.exec(text);
  if (y) {
    const args = {};
    for (const p of y[2].matchAll(/<parameter=([^>\s]+)>\n?([\s\S]*?)\n?<\/parameter>/g)) args[p[1]] = paramValue(p[2]);
    return { name: y[1], args: JSON.stringify(args), before: text.slice(0, y.index).trim() };
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

// The line after two one-file Reads in a row (see runStep's results).
export const READ_TIP = '\n\n(Tip: Read takes "paths", a list of files. The other files you need can come together in one reply.)';

// Check-ins while exploring: every this many looks, or seconds, without a change.
// 6 looks (was 8, 28 Sep): a task that has read six things and changed
// nothing is usually lost, and a word from you costs less than more steps.
export const CHECK_INS = { steps: 6, secs: 300 };
export const LOOKS = new Set(['Read', 'Search', 'List', 'Glob', 'Grep', 'Bash']);

// A helper's steps at most (its own limit, under the conversation's).
export const HELPER_STEPS = 30;
// How long a conversation's first message waits for MCP servers that are still starting.
export const MCP_WAIT_MS = 8000;
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
export const OWN_HELPER_CTX = 32_768;

// The web addresses (http or https) a request names, each once.
export const webAddresses = (text) => [...new Set(String(text ?? '').match(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi) ?? [])].map((u) => u.replace(/[.,;:!?]+$/, ''));

// What an edit will do, in plain words, for the plan question (questions.mjs).
export const planLine = planSaid;

// A test run's counts and the names that fail, or null when the output says neither.
export function failsOf(text, failed) {
  const r = readResults(String(text ?? ''), failed ? 1 : 0);
  return r.failed == null ? null : { failed: r.failed, failing: r.failing };
}

// Its plan as it last wrote it with TodoWrite: the whole list goes into its notes when memory
// fills (restartFrom), and a short line comes back every PLAN_EVERY steps (planDue).
const stepText = (t) => String(t?.text ?? t?.content ?? '').replace(/\s+/g, ' ').trim();
export function planList(todos) {
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
