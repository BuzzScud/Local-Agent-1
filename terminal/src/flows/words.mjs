// Word rules for sorting a request that need nothing but the words themselves
// (no files, no model). Measured on 81 real requests (2026-09-27): the rules
// before these left thanks and offers of work unseen, sorted a short line that
// continues the conversation on its own, and asked the model to sort plain
// commands. index.mjs and clarify.mjs use these; sort.mjs puts them in order.

export const CODE_FILE = /\b[\w-]+\.(m?[jt]sx?|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h)\b/i;
export const CODE_WORDS = /\b(function|method|class|helper|bug|crash(es)?|flag|field|option|parameter|argument|variable|property|endpoint|generator|parser|stdout|stderr|exception)\b/i;
export const CODE_ISH = /[\w-]+\.[a-z]{1,5}\b|\b[a-z]+[A-Z]\w*\b|\b\w+_\w+\b|\(\)|--\w+/; // a file, camelCase, snake_case, a call, a flag
// Plain instructions that are clear on their own.
export const PLAIN = /^\W*(?:please\s+)?(?:run|start|check|execute)?\s*(?:the\s+)?(?:tests?|build|lint|linter|typecheck|type ?check|test suite)\W*$/i;

// "exit" or "quit" typed as a plain message leaves, like /exit (the app checks
// this before anything is sent).
export const isQuit = (text) => /^(exit|quit)[.!]?$/i.test(String(text).trim());

// Thanks, praise, and an offer of work with nothing to do yet, the ways they
// were really typed: "its perfect , thank you", "hello , ima need help with
// something", "i want you to help me with something". Whole messages only:
// "great, now add a --json flag" and "i need help with the export function"
// are requests.
const THANKS = String.raw`(?:thanks?(?:\s+you)?(?:\s+(?:so much|a lot|very much|again))?|thank\s+u|thx|ty)`;
const PRAISE = String.raw`(?:(?:it'?s|its|that'?s|thats|this is|looks?|all)\s+)?(?:perfect|great|good|nice|awesome|amazing|excellent|cool|fine|beautiful|wonderful|love it|i love it|well done|good job|great job|nice work|great work)`;
const NEED_HELP = String.raw`i(?:'?m|'?ma|ma)?\s*(?:a\s+)?(?:gonna\s+|going to\s+)?(?:need|want|would like|could use)\s+(?:you\s+to\s+(?:help|assist)(?:\s+me)?(?:\s+out)?|(?:some\s+|a little\s+|your\s+)?help)(?:\s+with\s+(?:something|a (?:quick )?(?:thing|question|task)|some(?:thing| stuff)))?`;
const HI = String.raw`(?:hi|hello|hey|yo|hiya|howdy|good (?:morning|afternoon|evening))`;
const MORE_TALK = new RegExp(String.raw`^\W*(?:(?:${PRAISE})[\s,!.]*(?:${THANKS})?|(?:ok(?:ay)?[\s,!.]*)?${THANKS}(?:[\s,]+(?:agentic coder|coder|coding|bonsai))?|(?:${HI}[\s!.,]*(?:agentic coder|coder|coding|bonsai|there)?[\s!.,]*)?${NEED_HELP})[\s!.?]*$`, 'i');
export const isMoreTalk = (text) => MORE_TALK.test(String(text).trim());

// A short line that continues the last turn: the thing to act on is a bare
// "it / that / them" right after the verb ("can you add it to my desktop?",
// "fix that"), or the line is a lone "why" or ends in "again". On its own such
// a line sorts wrongly ("add it …" is no code change) or gets asked about; with
// the conversation in view it is clear. A pronoun that points at something
// named in the same line ("tell me about X, how does it work?") is no
// follow-up, and neither is a line that names a file or code.
const POLITE = String.raw`(?:(?:ok|okay|now|and|then|so|please|also|great|perfect|nice|good|cool)[\s,!.]+)*(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:now\s+|also\s+)?)?`;
const AFTER_THIS = String.raw`(?:\W*$|[\s,]+(?:to|into|in|on|for|as|from|with|again|instead|too|now|please|back|up|down)\b)`;
const OBJECT = new RegExp(String.raw`^\W*${POLITE}(?:please\s+)?[a-z]+\s+(?:(?:it|them)\b|(?:that|this|those|these)${AFTER_THIS})`, 'i');
const AGAIN = /\b(?:again|instead)\W*$/i;
const LONE = /^\W*(?:why|why not|how|how so|how come|what|what do you mean|really|and|so|then|huh|go on|continue|keep going)\W*$/i;
export function isFollowUp(text, hasPrior) {
  if (!hasPrior) return false;
  const s = String(text).trim();
  if (LONE.test(s)) return true;
  const words = s.split(/\s+/).length;
  if (words > 10 || CODE_ISH.test(s) || /[~/][\w.-]+\//.test(s)) return false;
  return OBJECT.test(s) || (words <= 6 && AGAIN.test(s));
}

// A plain command ("run the tests", "commit and push to github", "git reset
// --hard"): work for the step loop, where each command passes the gates. One
// that names code ("build a login page in Login.jsx") is not sorted here.
const COMMAND = /^\W*(?:(?:please|can you|could you|just)\s+)*(?:run|execute|start|stop|restart|kill|install|uninstall|commit|push|pull|deploy|build|launch)\b|^\W*(?:git|npm|npx|bun|node|python3?|pip3?|yarn|pnpm|make|cargo|docker|brew)\s+\S/i;
export const isCommand = (t) => PLAIN.test(t) || (COMMAND.test(t) && !CODE_FILE.test(t) && !CODE_WORDS.test(t));

// "create a self contained html file and design a … dashboard": a page or a
// file with no code named. No test can define "done", so it is never a change
// for the test-first path. (The same request with the word "note" in it
// already went step by step; without it, it was sorted as a change.)
const MAKE_PAGE = /\b(?:create|make|build|design|write|generate)\s+(?:me\s+)?(?:(?:a|an|the|one)\s+)?(?:[\w-]+\s+){0,4}?(?:file|page|web ?site|site|dashboard|html)\b/i;
export const isPageRequest = (t) => MAKE_PAGE.test(t) && !CODE_FILE.test(t) && !CODE_WORDS.test(t);

// The line under your request: which path was picked.
const NAMES = { rename: 'rename', fix: 'fix', change: 'change', question: 'question', other: 'task', 'follow-up': 'follow-up' };
export function sortLine(kind, { shortcut = false, skill = null } = {}) {
  if (kind === 'follow-up') return 'Sorted as: follow-up · continues the conversation';
  const name = NAMES[kind] ?? 'task';
  // A skill from SKILLS.md came with it (prompt-files.mjs): always step by step.
  if (skill) return `Sorted as: ${name} · skill "${skill}" · step by step`;
  return `Sorted as: ${name} · ${shortcut && ['rename', 'fix', 'change'].includes(kind) ? 'shortcut' : 'step by step'}`;
}
