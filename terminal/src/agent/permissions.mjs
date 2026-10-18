import { resolve, basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import { isMcpCall, mcpRule, parseMcpRule } from './mcp.mjs';
import { BLOCKED, CMD, at, blockedReason, isReadOnly, outsidePaths, readerPart, shellText, shellWords, splitCommand } from './command-words.mjs';
export { BLOCKED, blockedReason, isReadOnly, outsidePath, runsTests, splitCommand, testRunOf } from './command-words.mjs';

// Which tool calls run straight away, which ask you first, and which are
// never allowed. Modes, as /mode lists them (Claude Code's five):
//   auto    the rules decide the clear cases; the model checks the rest
//           (agent/auto-check.mjs): fits the request and can be undone → runs, else asks
//   ask     Manual: asks before every change (the default)
//   edits   Accept edits: file changes go through; commands still ask
//   plan    read-only: it may look but not change anything
//   bypass  never asks; the blocked commands, your never-list and the app's own
//           settings still hold. The folder fence and the sandbox's internet block
//           are lifted (the owner's pick, 3 Oct 2026); what already runs on this
//           Mac stays out of reach (sandbox.mjs)
export const MODES = ['auto', 'ask', 'edits', 'plan', 'bypass'];
// shift+tab walks these. Bypass is picked on purpose (/mode 5, /mode bypass, --mode
// bypass), never by cycling into it; from Bypass, shift+tab goes back to Manual.
export const CYCLE = ['ask', 'edits', 'plan', 'auto'];
export const nextMode = (mode) => CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length];
// The words a mode is typed as: Claude Code's names, and the ones this app used before.
const MODE_ALIASES = { manual: 'ask', default: 'ask', accept: 'edits', 'accept-edits': 'edits', acceptedits: 'edits', 'auto-edit': 'edits', bypasspermissions: 'bypass', 'bypass-permissions': 'bypass' };
export const modeOf = (word) => { const w = String(word ?? '').trim().toLowerCase(); return MODES.includes(w) ? w : MODE_ALIASES[w] ?? null; };

// Self (the owner's pick, 8 Oct 2026): Bypass permissions with the Claude API as the model. The app
// is then let work on itself: its own code (always a project like any other), and its own settings,
// rules, hooks and memory in ~/.agentic-coder and .agentic/, which Bypass alone refuses (OWN); a copy
// of each own file is kept before it changes (self.mjs). What stays locked even then: the door's
// key and who may come through it (another Mac could join), and every secret (SECRET_FILES).
// A local model never gets this: the guards below were written for one.
export const SELF_LOCKED = ['door.key', 'trust.json'];
export const isSelf = (mode, kind) => mode === 'bypass' && kind === 'claude';
export const selfLockedBy = (rel) => protectedBy(rel, [], SELF_LOCKED);

// A commit always asks first, every time (the user's pick, 29 Sep 2026):
// "don't ask again" for a command's first two words, or a commit chained
// after an allowed one ("npm test && git commit -am …"), never lets one
// through. Quotes count as a start too (sh -c "git commit …"): asking once
// too often is cheap, a commit made without asking is not.
const GIT_COMMIT = new RegExp(`(?:${CMD}|["'])\\s*git(?:\\s+(?:-[cC]\\s+\\S+|--?[\\w-]+(?:=\\S+)?))*\\s+commit\\b`);
export const runsGitCommit = (command) => GIT_COMMIT.test(String(command ?? ''));
// A push asks every time too, in every mode and on every model (the owner's pick, 8 Oct 2026: changes
// go to GitHub from here, but never unseen); Bypass on the Claude API lets it run (SELF). Text that
// only names it (grep 'git push' log) does not ask: shellText drops it.
const GIT_PUSH = new RegExp(`(?:${CMD}|["'])\\s*git(?:\\s+(?:-[cC]\\s+\\S+|--?[\\w-]+(?:=\\S+)?))*\\s+push\\b`);
export const runsGitPush = (command) => GIT_PUSH.test(shellText(command));

// ---- What you save with /permissions: commands that run without asking,
// commands that never run, and files that always ask. Rules are plain words.

const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean);
const STAR = /\s*\*\s*$/;
// npm run, bun run …: the script after them is what a rule names.
const RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'deno']);
const RUN_WORDS = new Set(['run', 'exec', 'x', 'dlx', 'task']);
// A rule that names a whole program ("make", "bun run"): it still covers only
// that command and its options; /permissions says "make *" covers the rest.
const isBroad = (w) => w.length === 1 || (w.length === 2 && RUNNERS.has(w[0]) && RUN_WORDS.has(w[1]));

// Does a rule cover one command (one part of a longer one)? The command must
// start with the rule's words, whole words, and whatever follows must be
// options (words that start with -): "npm test" covers "npm test --watch",
// not "npm testing", not "npm run test", and "rm notes.txt" never covers
// "rm notes.txt other.txt". For npm, bun and the like, what follows -- goes
// to the script you allowed ("npm test -- foo"). A rule ending with * covers
// anything after its words ("git add *").
export function ruleCovers(rule, part) {
  const r = words(String(rule ?? '').replace(STAR, ''));
  const w = words(part);
  if (!r.length || r.length > w.length || !r.every((x, i) => x === w[i])) return false;
  if (STAR.test(String(rule))) return true;
  const toScript = RUNNERS.has(r[0]);
  for (let i = r.length; i < w.length; i++) {
    if (toScript && w[i] === '--') return true;
    if (!w[i].startsWith('-')) return false;
  }
  return true;
}

// The rule "always allow" saves for a command: what it runs ("npm test",
// "bun run test", "git add", "node --test"), or the whole command when
// that would not cover it ("git add ." → "git add ."; "rm notes.txt").
export function ruleFor(part) {
  const w = words(part);
  if (!w.length) return null;
  const n = RUNNERS.has(w[0]) && RUN_WORDS.has(w[1] ?? '') && w[2] && !w[2].startsWith('-') ? 3 : 2;
  const head = w.slice(0, n).join(' ');
  return ruleCovers(head, part) ? head : w.join(' ');
}

// The protected file a command names, if any ("cp .env.example .env" → ".env"):
// a word of it, or a piece after = (--out=.env). Reading one is fine; this is
// for a part that can change things.
function namesProtected(part, protect = []) {
  for (const w of shellWords(String(part ?? ''))) { const g = protectedBy(String(w), protect); if (g) return g; }
  return null;
}

// Every part of a command against the rules: which part only reads, which
// a saved rule or this session's "don't ask again" covers, which nothing does.
// Allowed only when every part is covered and its words can be trusted (no
// $(…), no file written by >, no job left running). A part that names a
// protected file is never covered, whatever the rules say: it asks.
export function coverage(command, { saved = [], session = [], protect = [] } = {}) {
  const s = splitCommand(command);
  const plain = !(s.nested || s.writes || s.background || s.open);
  const sessionRules = [...(session ?? [])];
  const parts = s.parts.map((p) => p.trim()).filter(Boolean).map((part) => {
    if (readerPart(part)) return { part, by: 'reads' };
    if (/^cd\s+\S/.test(part)) return { part, by: 'cd' }; // the fence already keeps cd inside the project
    const guard = namesProtected(part, protect);
    if (guard) return { part, by: null, protectedBy: guard };
    const rule = (saved ?? []).find((r) => ruleCovers(r, part));
    if (rule) return { part, by: 'saved', rule };
    const now = sessionRules.find((r) => ruleCovers(r, part));
    if (now) return { part, by: 'session', rule: now };
    return { part, by: null };
  });
  return { plain, parts, allowed: plain && parts.length > 0 && parts.every((p) => p.by) };
}

// What "always allow" would save for this command: the rule for its first
// part nothing covers yet. Nothing to offer when its words cannot be trusted
// ($(…), a file written by >, a job left running) or every part is covered.
export function offerFor(command, rules = {}) {
  const c = coverage(command, rules);
  if (!c.plain) return null;
  const next = c.parts.find((p) => !p.by);
  if (next?.protectedBy) return null; // no rule could let it through
  const rule = next ? ruleFor(next.part) : null;
  // A rule longer than a typed one may be (checkRule) is not offered: the question asks each time.
  return rule && rule.length <= 120 ? { rule, part: next.part } : null;
}

// The rule of yours (never) whose words appear one after another as whole
// words anywhere in a command, quoted or chained: sh -c "npm publish" too.
const escapeText = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function neverRule(command, never = []) {
  const text = String(command ?? '');
  for (const rule of never ?? []) {
    const w = words(String(rule).replace(STAR, ''));
    if (!w.length) continue;
    const re = new RegExp(`(?:^|[\\s;&|(\\x60"'])${w.map(escapeText).join('\\s+')}(?=$|[\\s;&|)\\x60"'])`);
    if (re.test(text)) return rule;
  }
  return null;
}

// Files that always ask before a change, even in Auto-edit: secrets, git's
// own folder, and this app's settings (a model that could write "mode":
// "edits" there would turn Auto-edit on for itself; started in the home
// folder, .agentic-coder/ with the saved rules is inside the project). Yours
// come on top. Names match whatever their case: on a Mac .ENV is .env.
export const PROTECTED = ['.env', '.env.*', '*.pem', '*.key', 'id_rsa*', 'id_ed25519*', '.git', '.git/**', '.agentic/settings.json', '.agentic/mcp.json', '.agentic/hooks.json', '.agentic-coder/**'];
// The app's own settings and rules: in Bypass, where nothing asks, a change to one is
// refused instead (a model that could write them could change its own mode or rules).
// .agentic/mcp.json names programs that start with the next window (a project's MCP servers): a model
// that could write it could give itself a command to run, and so could one writing .agentic/hooks.json
// (a project's own hooks, user-hooks.mjs).
export const OWN = ['.agentic/settings.json', '.agentic/mcp.json', '.agentic/hooks.json', '.agentic-coder/**'];
// * is any run of characters within one name, ** any run across folders, ? one character.
const globText = (g) => g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]');
const globRe = (g) => new RegExp(`(?:^|/)${globText(g)}$`, 'i');
// rel: a path from the project folder, or several (a link and where it points).
export function protectedBy(rel, extra = [], list = PROTECTED) {
  for (const one of [].concat(rel ?? [])) {
    if (!one) continue;
    const p = String(one).replace(/\\/g, '/').replace(/^\.\//, '');
    for (const g of [...list, ...(extra ?? [])]) if (globRe(String(g).replace(/^\.\//, '')).test(p)) return g;
  }
  return null;
}
// One of the app's own files (OWN), by path or named in a command's words.
export const ownBy = (rel) => protectedBy(rel, [], OWN);
// Secrets outside the project stay out of reach even in Bypass, which lifts the folder fence:
// an SSH key or another project's .env would go to a model on another machine.
export const SECRET_FILES = ['.ssh', '.ssh/**', '.env', '.env.*', '*.pem', '*.key', 'id_rsa*', 'id_ed25519*'];
const secretBy = (paths) => protectedBy(paths, [], SECRET_FILES);
const namesOwn = (command, list = OWN) => { for (const w of shellWords(String(command ?? ''))) { const g = protectedBy(String(w), [], list); if (g) return g; } return null; };

// The files a part writes with > or >> (not /dev/null, not >&2), as typed.
function writeTargets(part) {
  const s = String(part ?? '');
  const out = [];
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '\\') { i++; continue; }
    if (c !== '>') continue;
    let j = i + 1;
    if (s[j] === '>' || s[j] === '|') j++;
    if (s[j] === '&') { i = j; continue; }
    while (s[j] === ' ' || s[j] === '\t') j++;
    const m = /^(?:"([^"]*)"|'([^']*)'|([^\s;|&<>()]+))/.exec(s.slice(j));
    if (!m) continue;
    const target = m[1] ?? m[2] ?? m[3];
    if (target !== '/dev/null') out.push(target);
    i = j + m[0].length - 1;
  }
  return out;
}

// The app's own settings and rules a command may change (Bypass refuses it): one named by a part
// that does more than read, or written with >; after a cd, the names are taken from that folder too.
// A part that only reads may name them: 7 Oct 2026, a grep of the test record (~/.agentic-coder/tests)
// piped on into another command was refused as if it changed the app's own settings.
// list: the files looked for (OWN; SELF_LOCKED when the app works on itself).
function ownChanged(command, list = OWN) {
  const s = splitCommand(command);
  if (s.nested || s.open || s.background) return namesOwn(command, list);
  let dir = '';
  const by = (w) => protectedBy(w, [], list);
  for (const raw of s.parts) {
    const part = raw.trim();
    const words = shellWords(part).map(String);
    const own = (names) => { for (const w of names) { const g = by(w) ?? (dir ? by(join(dir, w)) : null); if (g) return g; } return null; };
    if (words[0] === 'cd' || words[0] === 'pushd') { const to = words[1] ?? '~'; dir = !dir || to.startsWith('/') || to.startsWith('~') ? to : join(dir, to); continue; }
    const hit = readerPart(part) ? own(writeTargets(part)) : own(words);
    if (hit) return hit;
  }
  return null;
}

// What a typed rule may be, for /permissions allow | never | protect:
// { rule, note? } to save, or { error } to say why not.
export function checkRule(kind, text, { protect = [] } = {}) {
  const t = String(text ?? '').trim().replace(/^(["'`])(.*)\1$/s, '$2').replace(/\s+/g, ' ').trim();
  if (!t) return { error: kind === 'protect' ? 'Say which file, like /permissions protect config/prod.*' : `Say which command, like /permissions ${kind} npm test` };
  if (t.length > 120) return { error: 'That is too long for a rule (120 characters at most).' };
  if (kind === 'protect') {
    if (/^[/~]|(^|\/)\.\.(\/|$)/.test(t)) return { error: 'A protected file is named from the project folder: config/prod.*, not a full path or ../ .' };
    if (!/[^*?/]/.test(t)) return { error: 'That would match every file. Name the file: .env.local, config/prod.*' };
    return { rule: t };
  }
  // A screen rule: Screen(TextEdit), or Screen(whole screen).
  const scr = SCREEN_RULE.exec(t);
  if (scr) return { rule: `Screen(${scr[1].trim()})` };
  // An MCP rule: Mcp(server:tool) for one tool; Mcp(server:*) for a whole server, on the never-list only
  // (to let a server's tools run unasked, mark them as reading in /mcp, one by one).
  if (/^mcp\(/i.test(t)) {
    const m = parseMcpRule(t);
    if (!m) return { error: 'An MCP rule names one tool of one server: Mcp(github:create_issue).' };
    if (m.tool === '*' && kind === 'allow') return { error: `Allow one tool at a time: Mcp(${m.server}:its_tool). A whole server (Mcp(${m.server}:*)) can only go on the never-list.` };
    return { rule: m.rule };
  }
  // A web rule: WebSearch, or WebFetch(site).
  const web = WEB_RULE.exec(t);
  if (web) return { rule: web[2] ? `WebFetch(${web[2].toLowerCase()})` : 'WebSearch' };
  const bare = t.replace(STAR, '');
  if (/[;&|<>\x60$()]/.test(bare)) return { error: 'A rule is one command, without ; & | > or $( ). Save each part as its own rule.' };
  const why = blockedReason(bare);
  if (kind === 'allow') {
    if (why) return { error: `That is never allowed (${why}), so no rule can allow it.` };
    if (runsGitCommit(bare) || /^git\s+commit\b/.test(bare)) return { error: 'A commit always asks first, so no rule can allow it.' };
    if (runsGitPush(bare) || /^git\s+push\b/.test(bare)) return { error: 'A push always asks first, so no rule can allow it.' };
    if (isReadOnly(bare)) return { error: `"${bare}" only reads, so it already runs without asking.` };
    const guard = namesProtected(bare, protect);
    if (guard) return { error: `That names a protected file (${guard}): a command that changes one always asks, so no rule can allow it.` };
    const w = words(bare);
    if (isBroad(w) && !STAR.test(t)) return { rule: t, note: `"${bare} *" would cover anything after it.` };
    return { rule: t };
  }
  if (why) return { error: `That is already never allowed (${why}).` };
  return { rule: t };
}

// The web tools' rules, as /permissions keeps them: "WebSearch", and "WebFetch(site)"
// for one site (its host, without www.). siteOf answers null for what is not a web address.
export const siteOf = (url) => {
  const t = String(url ?? '').trim();
  const scheme = /^[a-z][a-z\d+.-]*:\/\//i.test(t) || /^(mailto|data|javascript|about|tel|file):/i.test(t);
  try { const u = new URL(scheme ? t : `https://${t}`); return /^https?:$/.test(u.protocol) && u.hostname ? u.hostname.replace(/^www\./, '').toLowerCase() : null; } catch { return null; }
};
const webRule = (name, args) => (name === 'WebSearch' ? 'WebSearch' : siteOf(args?.url) ? `WebFetch(${siteOf(args.url)})` : null);
const WEB_RULE = /^(WebSearch|WebFetch\((?:www\.)?([a-z0-9.-]+\.[a-z0-9-]+)\))$/i;

// The screen (the Screen tool, tools/screen.mjs): what the model may look at, by app,
// as /permissions keeps it: "Screen(TextEdit)", or "Screen(whole screen)" for all of it.
// It only looks (a picture), so it is asked once per app in every mode but Bypass.
const screenTarget = (args) => String(args?.app ?? '').trim().replace(/\s+/g, ' ').slice(0, 60) || 'whole screen';
const screenRule = (args) => `Screen(${screenTarget(args)})`;
const SCREEN_RULE = /^Screen\(([^()]{1,60})\)$/i;
const hasRule = (list, rule) => [...(list ?? [])].some((r) => String(r).toLowerCase() === rule.toLowerCase());

// The decision for one tool call, with the reason (the /permissions test
// panel prints it). decide() below is the same without the reason.
//   rules: { allow, never, protect } from /permissions; rel: the path from the project folder.
//   mcp: for a tool of an MCP server, what the app knows of it: { server, tool, reads, changed }.
//   self: Bypass with the Claude API (isSelf): the app's own files, git push and its own processes are open.
export function judge(name, args, { mode, allowedPrefixes, inside = true, cwd, rules, rel, mcp, self = false } = {}) {
  const bypass = mode === 'bypass';
  self = bypass && Boolean(self);
  // A tool of an MCP server (agent/mcp.mjs): a program or a service of the user's, which can do
  // whatever its server lets it. Each tool asks before its first use, in every mode but Bypass,
  // until a rule allows it. reads: the user marked it in /mcp as one that only reads (the server's
  // own label is never taken for that); such a tool is let through where reading is (plan mode,
  // Auto). changed: its description or arguments are not what they were when it was allowed or
  // marked, so the old yes does not count.
  if (isMcpCall(name)) {
    if (!mcp?.server) return { decision: 'deny', reason: 'that is not one of this conversation\'s MCP tools' };
    const rule = mcpRule(mcp.server, mcp.tool);
    const blocked = [rule, mcpRule(mcp.server, '*')].find((r) => hasRule(rules?.never, r));
    if (blocked) return { decision: 'deny', reason: `blocked by your rule "${blocked}" (/permissions)` };
    if (mode === 'plan' && !mcp.reads) return { decision: 'deny', reason: 'plan mode is on, and this MCP tool is not one you marked as only reading (/mcp)' };
    const saved = hasRule(rules?.allow, rule);
    if ((saved || hasRule(allowedPrefixes, rule)) && !mcp.changed) return { decision: 'allow', why: `"${rule}" is allowed (${saved ? 'saved' : 'this session'})` };
    if (bypass) return { decision: 'allow', why: `Bypass permissions is on${mcp.changed ? ' (the tool changed since you allowed it)' : ''}` };
    if (mode === 'auto' && mcp.reads) return { decision: 'allow', why: 'Auto: you marked this tool as one that only reads' };
    return { decision: 'ask', rule, ...(mcp.changed ? { changed: true } : {}), why: mcp.changed ? 'the tool changed since you allowed it' : mode === 'auto' ? 'Auto cannot tell what an MCP tool changes, so it asks' : `no rule allows ${mcp.server}'s ${mcp.tool} yet` };
  }
  if (name === 'TodoWrite' || name === 'Ask') return { decision: 'allow', why: 'it changes nothing' };
  // The app itself (tools.mjs APP_TOOL_DEF): only when it works on itself.
  if (name === 'App') return self ? { decision: 'allow', why: 'Bypass on Claude: the app may drive itself', self: true } : { decision: 'deny', reason: 'the App tool runs only in Bypass permissions on the Claude API' };
  // A background command's output, or a stop of it: the command itself was asked about when it started.
  if (name === 'Jobs') return { decision: 'allow', why: 'it reads or stops a command you already let run' };
  // The model's own tools when it decides (agent/way.mjs): two read, one writes to the memory,
  // and two run a focused path, whose every change asks as your mode says (so plan mode refuses them).
  if (name === 'Map' || name === 'CodeSearch') return { decision: 'allow', why: 'it only reads' };
  // A helper: the call itself changes nothing; each thing it does is asked about as your mode says.
  if (name === 'Agent') return { decision: 'allow', why: args?.kind === 'general' ? 'each change the helper makes asks as your mode says' : 'the helper only reads' };
  if (name === 'Remember') return { decision: 'allow', why: 'it writes to the memory, not to the project' };
  if (name === 'Rename' || name === 'TestFirst') return mode === 'plan' ? { decision: 'deny', reason: 'plan mode is on, so nothing may be changed yet' } : { decision: 'allow', why: 'each change it makes asks as your mode says' };
  // The screen: a picture of one app's window, or of all of it. It changes nothing, but it can
  // show anything that is open, so each app asks once (this time, this session, always, no),
  // in every mode but Bypass; your never-list holds even there.
  if (name === 'Screen') {
    const rule = screenRule(args);
    if (hasRule(rules?.never, rule)) return { decision: 'deny', reason: `blocked by your rule "${rule}" (/permissions)` };
    const saved = hasRule(rules?.allow, rule);
    if (saved || hasRule(allowedPrefixes, rule)) return { decision: 'allow', why: `"${rule}" is allowed (${saved ? 'saved' : 'this session'})` };
    if (bypass) return { decision: 'allow', why: 'Bypass permissions is on' };
    return { decision: 'ask', rule, why: `the model has not been allowed to look at ${screenTarget(args) === 'whole screen' ? 'the whole screen' : screenTarget(args)} yet` };
  }
  // The web: a search sends its words to the search service, a page is read from a site. Each asks
  // first (it changes nothing here, so plan mode asks too), until a rule allows it: "don't ask
  // again" for this session, or one saved with /permissions. Auto: the model checks it first.
  if (name === 'WebSearch' || name === 'WebFetch') {
    const rule = webRule(name, args);
    if (!rule) return { decision: 'deny', reason: 'that is not a web address (http or https)' };
    if ((rules?.never ?? []).includes(rule)) return { decision: 'deny', reason: `blocked by your rule "${rule}" (/permissions)` };
    const saved = (rules?.allow ?? []).includes(rule);
    if (saved || [...(allowedPrefixes ?? [])].includes(rule)) return { decision: 'allow', why: `"${rule}" is allowed (${saved ? 'saved' : 'this session'})` };
    if (bypass) return { decision: 'allow', why: 'Bypass permissions is on' };
    if (mode === 'auto') return { decision: 'check', rule, why: 'Auto: the model checks that it fits your request' };
    return { decision: 'ask', rule, why: name === 'WebSearch' ? 'a search sends its words to the search service' : `no rule allows reading ${siteOf(args.url)} yet` };
  }
  // Outside the project, Bypass lets a step through unless it names a secret (SECRET_FILES).
  const away = [].concat(rel ?? [], args?.path ?? []);
  if (name === 'Read' || name === 'List' || name === 'Search') {
    if (inside) return { decision: 'allow', why: 'reading inside the project never asks' };
    if (bypass && !secretBy(away)) return { decision: 'allow', why: 'Bypass permissions is on: any folder may be read' };
    return { decision: 'deny', reason: bypass ? 'that is a secret outside the project folder (a key, .ssh or .env), which even Bypass does not reach' : 'that is outside the project folder; only files inside it may be read' };
  }
  if (name === 'Edit' || name === 'Write') {
    if (!inside && (!bypass || secretBy(away))) return { decision: 'deny', reason: bypass ? 'that is a secret outside the project folder (a key, .ssh or .env), which even Bypass does not reach' : 'that file is outside the project folder' };
    if (mode === 'plan') return { decision: 'deny', reason: 'plan mode is on, so nothing may be changed yet' };
    // A protected file always asks, even in Accept edits and Auto, and has no "allow all edits"
    // choice (once). In Bypass nothing asks: it goes through, but the app's own settings never do.
    const guard = protectedBy(rel ?? args?.path, rules?.protect);
    if (bypass) {
      const own = ownBy(rel ?? args?.path);
      if (own && self) {
        const locked = selfLockedBy(rel ?? args?.path);
        return locked ? { decision: 'deny', reason: `${locked} is the door's own file (who may reach this Mac), which stays locked even when Agentic Coder works on itself` } : { decision: 'allow', why: `Bypass on Claude: Agentic Coder's own file (${own}) may change; a copy is kept first`, self: true };
      }
      return own ? { decision: 'deny', reason: `${own} holds Agentic Coder's own settings and rules, which the model never changes, even in Bypass permissions` } : { decision: 'allow', why: 'Bypass permissions is on' };
    }
    if (guard) return { decision: 'ask', once: true, protectedBy: guard, why: `it is a protected file (${guard}); protected files always ask` };
    if (mode === 'edits') return { decision: 'allow', why: 'Accept edits is on' };
    if (mode === 'auto') return { decision: 'allow', why: 'Auto: edits inside the project go through' };
    return { decision: 'ask', why: 'Manual is on' };
  }
  if (name === 'Bash') {
    const command = args?.command ?? '';
    const why = blockedReason(command, { self });
    if (why) return { decision: 'deny', reason: `blocked: ${why}` };
    // Bypass lifts the fence: a command may name any folder, but not a secret outside the
    // project (SECRET_FILES), and not the app's own settings (below).
    const outs = outsidePaths(command, cwd);
    const secret = bypass ? outs.find((w) => secretBy(w)) : null;
    if (secret) return { decision: 'deny', reason: `${secret} is a secret outside the project folder (a key, .ssh or .env), which even Bypass does not reach` };
    // A path that is not there (a made-up value in code, a file to make in /tmp): say what to use instead.
    const gone = outs[0] && outs[0] !== '~' && !outs[0].startsWith('~') && !existsSync(resolve(cwd ?? '.', outs[0]));
    if (outs.length && !bypass) return { decision: 'deny', reason: `${outs[0]} is outside the project folder; commands stay inside it${gone ? `. Nothing is there now: for a file of your own, or a made-up path in code, use a name inside the project, such as ${JSON.stringify(basename(outs[0]) || 'tmp')}` : ''}` };
    // Your own never-list holds in every mode.
    const mine = neverRule(command, rules?.never);
    if (mine) return { decision: 'deny', reason: `blocked by your rule "${mine}" (/permissions)` };
    if (mode === 'plan') return isReadOnly(command) ? { decision: 'allow', why: 'it only reads' } : { decision: 'deny', reason: 'plan mode is on, so only read-only commands may run' };
    if (bypass && !self && runsGitPush(command)) return { decision: 'ask', once: true, why: 'a push sends your code to GitHub, so it always asks (even in Bypass, unless the model is Claude)' };
    if (bypass) {
      const own = ownChanged(command);
      if (own && self) {
        const locked = ownChanged(command, SELF_LOCKED);
        return locked ? { decision: 'deny', reason: `it names ${locked}, the door's own file (who may reach this Mac), which stays locked even when Agentic Coder works on itself` } : { decision: 'allow', why: `Bypass on Claude: it may change Agentic Coder's own file (${own})`, self: true };
      }
      return own ? { decision: 'deny', reason: `it names ${own}, Agentic Coder's own settings and rules, which the model never changes, even in Bypass permissions` } : { decision: 'allow', why: `Bypass permissions is on (any folder and the internet; what already runs on this Mac stays out of reach${self ? '; git push and stopping its own processes may run' : ''})` };
    }
    // once: no "don't ask again" for it.
    if (runsGitCommit(command)) return { decision: 'ask', once: true, why: 'a commit always asks' };
    if (runsGitPush(command)) return { decision: 'ask', once: true, why: 'a push sends your code to GitHub, so it always asks' };
    if (isReadOnly(command)) return { decision: 'allow', why: 'it only reads' };
    const c = coverage(command, { saved: rules?.allow, session: allowedPrefixes, protect: rules?.protect });
    if (c.allowed) {
      const used = [...new Set(c.parts.filter((p) => p.rule).map((p) => `"${p.rule}" (${p.by === 'saved' ? 'saved' : 'this session'})`))];
      return { decision: 'allow', why: `every part is covered: ${used.join(', ')}${c.parts.some((p) => p.by === 'reads') ? ', the rest only reads' : ''}` };
    }
    const open = c.parts.find((p) => !p.by);
    // A command that names a protected file: asked every time, with no "don't ask again".
    const guarded = c.parts.find((p) => p.protectedBy);
    if (guarded) return { decision: 'ask', once: true, protectedBy: guarded.protectedBy, why: `"${guarded.part}" names a protected file (${guarded.protectedBy}), so it asks` };
    // Auto: what no rule covers, the model checks against your request (agent/auto-check.mjs);
    // runs when it fits and can be undone, else it asks you as Manual would.
    if (mode === 'auto') return { decision: 'check', why: 'Auto: no rule covers it, so the model checks it first' };
    return { decision: 'ask', why: !c.plain ? 'its words cannot be trusted for a rule ($(…), a file written with >, or a job left running), so it asks' : c.parts.length > 1 ? `"${open.part}" is not covered by any rule` : 'it can change things and no rule covers it' };
  }
  return { decision: 'deny', reason: 'unknown tool' };
}

export function decide(name, args, ctx) {
  const { why, ...d } = judge(name, args, ctx);
  return d;
}

// ---- the remote set's PERMISSIONS guide (prompt-files.mjs) -------------------------------------

const MODE_NAMES = { auto: 'Auto', ask: 'Manual', edits: 'Accept edits', plan: 'Plan', bypass: 'Bypass permissions' };
// What each kind of step does in a mode, as judge() decides it.
const STEPS = {
  edit: { ask: 'asks first', edits: 'runs', auto: 'runs', plan: 'refused', bypass: 'runs' },
  protect: { ask: 'always asks', edits: 'always asks', auto: 'always asks', plan: 'refused', bypass: 'runs' },
  readCmd: { ask: 'runs', edits: 'runs', auto: 'runs', plan: 'runs', bypass: 'runs' },
  cmd: { ask: 'asks first', edits: 'asks first', auto: 'the app checks it against the request: runs, or asks', plan: 'refused', bypass: 'runs' },
  commit: { ask: 'always asks', edits: 'always asks', auto: 'always asks', plan: 'refused', bypass: 'runs' },
  web: { ask: 'asks first', edits: 'asks first', auto: 'the app checks it against the request: runs, or asks', plan: 'asks first', bypass: 'runs' },
  mcp: { ask: 'asks first', edits: 'asks first', auto: 'asks first, unless the user marked the tool as only reading', plan: 'refused, unless the user marked the tool as only reading', bypass: 'runs' },
};
// "Right now": a table of what runs, asks or is refused in this mode, with the user's own rules,
// added to PERMISSIONS.md when the model reads it, so the guide never disagrees with the app.
export function permissionsTable({ mode = 'ask', rules = null, session = [], self = false } = {}) {
  const m = MODES.includes(mode) ? mode : 'ask';
  self = m === 'bypass' && Boolean(self);
  const blocked = [...new Set(BLOCKED.filter((b) => !(self && b.self)).map((b) => b.why))];
  const list = (xs) => (xs?.length ? xs.map((x) => `"${x}"`).join(', ') : 'none');
  const rows = [
    ['Read, List and Search inside the project', 'runs'],
    ['Edit or Write a file in the project', STEPS.edit[m]],
    [`A protected file (${[...PROTECTED.slice(0, 5), ...(rules?.protect ?? [])].join(', ')}…)`, STEPS.protect[m]],
    ['A command that only reads (ls, cat, git status, git diff…)', STEPS.readCmd[m]],
    ['Any other command', `${STEPS.cmd[m]}${m === 'ask' || m === 'edits' || m === 'auto' ? ', unless a rule below allows it' : ''}`],
    ['git commit', STEPS.commit[m]],
    ['git push (only when the user asks; a force push is refused)', m === 'plan' ? 'refused' : m === 'bypass' && self ? 'runs' : 'asks first, every time (it then reaches GitHub)'],
    ['WebSearch and WebFetch (when offered)', `${STEPS.web[m]}${m !== 'bypass' ? ', unless a rule allows the site' : ''}`],
    ['A tool of the user\'s MCP servers (mcp__server__tool, when offered)', `${STEPS.mcp[m]}${m === 'ask' || m === 'edits' || m === 'auto' ? ', or a rule allows it' : ''}`],
    ['A new file on the Desktop the user asked for there (Write ~/Desktop/<name>)', STEPS.edit[m]],
    ['Other files or commands outside the project, the internet from a command', m === 'bypass' ? 'runs (Bypass lifts the fence), except secrets outside the project (keys, .ssh, .env); ssh, scp and rsync still log in with this Mac\'s saved keys; what already runs on this Mac stays out of reach' : 'refused (the sandbox)'],
    ['Agentic Coder\'s own settings and rules (~/.agentic-coder, .agentic/)', self ? 'runs: you work on Agentic Coder itself (a copy of each own file is kept first); only door.key and trust.json stay locked' : 'refused'],
    ...(self ? [['The App tool: a slash command, a setting, a restart on new code', 'runs']] : []),
  ];
  return `## Right now (from the app, as you read this)

Mode: ${MODE_NAMES[m]}${self ? ' on the Claude API: Agentic Coder may work on itself (its code, its own settings, git push, stopping its own processes, the App tool)' : ''}.

| Step | Here |
|---|---|
${rows.map(([a, b]) => `| ${a} | ${b} |`).join('\n')}

Always refused, in every mode (what each would do): ${blocked.join('; ')}.

The user's rules (/permissions): allowed without asking: ${list(rules?.allow)}; never: ${list(rules?.never)}; protected: ${list(rules?.protect)}.
Allowed for this session: ${list([...(session ?? [])])}.`;
}
