// Context helpers: what comes along with a request so the model needs fewer
// steps to find it (plan of 28 Sep 2026, in cli docs/gemma-docs). Gemma reads
// about 120 tokens a second and writes about 12, so a step it does not have to
// take (open a file, run the tests) saves far more than reading what it would
// have found. The helpers share CEILING tokens; one with nothing to add passes
// its share on, and each brings only what clears its own bar, so the ceiling
// is a limit, not a target.
//   named  the files a request names, read whole before the first step
//          (Read first, agent.mjs prefetchRanked)
//   tests  on a fix-type request, the test run's failures before the first
//          step; the changes not yet committed when the request is about them
//   rag    the files closest to the request by meaning, read whole (Read
//          first, rank.mjs), then the closest functions of the files not read
//          whole (the code search, tools/codeindex.mjs)
//   lsp    a syntax check after every Edit and Write (tools.mjs syntaxError),
//          and where each name the request uses is defined and used
// Read first has its own room (at most 8,000 tokens, agent.mjs RANK_MAX_TOKENS);
// CEILING is for the rest.
// AGENTIC_HELPERS picks them: unset or "all" = every one, "off" = none (the
// way before), or a list such as "named,tests" (or "scout,medic").
// On screen each one goes by its codename (CODENAMES): Scout, Medic, Oracle,
// Sentry. The ids above stay the names settings.json and the bench keep.
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readResults, failureDigest } from '../flows/results.mjs';

export const HELPER_NAMES = ['named', 'tests', 'rag', 'lsp'];
export const CODENAMES = { named: 'Scout', tests: 'Medic', rag: 'Oracle', lsp: 'Sentry' };
// Which helper brought each kind of item (an item's from).
export const HELPER_OF = { file: 'named', tests: 'tests', changes: 'tests', code: 'rag', uses: 'lsp' };
// An item's from, or a helper's id, as its codename; anything else as it is.
export const codenameOf = (from) => CODENAMES[HELPER_OF[from] ?? from] ?? from;
// A helper's id from its id or its codename, any case.
const idOf = (n) => HELPER_NAMES.find((h) => h === n || CODENAMES[h].toLowerCase() === String(n).toLowerCase());

export function helpersOn(value = process.env.AGENTIC_HELPERS ?? process.env.BONSAI_HELPERS) {
  if (value instanceof Set) return value;
  const ids = (list) => new Set(HELPER_NAMES.filter((h) => list.some((n) => idOf(n) === h)));
  if (Array.isArray(value)) return ids(value);
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || /^(on|all|yes|1|true)$/.test(v)) return new Set(HELPER_NAMES);
  if (/^(off|none|no|0|false)$/.test(v)) return new Set();
  return ids(v.split(/[\s,]+/));
}

// Tokens: the whole of what the helpers bring, and each one's share.
export const CEILING = 6000;
export const SHARES = { named: 2500, tests: 1500, rag: 1500, lsp: 500 };
const CHARS = 3.6; // characters a token (agent.mjs tokensOf)
export const chars = (tokens) => Math.floor(tokens * CHARS);

// What each helper will bring, as items ({ helper, chars, … }, some with a
// smaller version in .small), in the order they go in. First each helper
// takes what fits its own share; then what is left of the ceiling goes to
// what did not fit, the named files first, then code, tests, uses.
export function shareOut(items, { ceiling = chars(CEILING), shares = Object.fromEntries(Object.entries(SHARES).map(([k, v]) => [k, chars(v)])), order = ['named', 'rag', 'tests', 'lsp'] } = {}) {
  const used = {};
  let total = 0;
  const taken = new Map();
  const fits = (it, room) => (it.chars <= room ? it : it.small && it.small.chars <= room ? it.small : null);
  items.forEach((it, i) => {
    const got = fits(it, Math.min((shares[it.helper] ?? 0) - (used[it.helper] ?? 0), ceiling - total));
    if (!got) return;
    taken.set(i, got);
    used[it.helper] = (used[it.helper] ?? 0) + got.chars;
    total += got.chars;
  });
  for (const h of order) {
    items.forEach((it, i) => {
      if (it.helper !== h || taken.has(i)) return;
      const got = fits(it, ceiling - total);
      if (!got) return;
      taken.set(i, got);
      total += got.chars;
    });
  }
  return [...taken.keys()].sort((a, b) => a - b).map((i) => taken.get(i));
}

// A request about something broken, where the failing tests say where to look.
// Not "make it red" or "add error handling": an error that happens, tests that fail.
export function fixLike(kind, text) {
  return kind === 'fix' || /\b(?:fix(?:es|ed)?|fail(?:s|ing|ed)?|broken|breaks|bug(?:gy|s)?|crash(?:es|ed|ing)?|exception|throws?|regression|tests? (?:are |is |went |turn(?:ed|s)? )?red|tests? (?:do(?:es)?n'?t|do(?:es)? not|won'?t) pass|(?:an?|the|this|that) error|errors? (?:when|on|in|at|out|if))\b/i.test(text);
}

// A request about the work in progress: "what did I change", "the diff",
// "my last edit broke it".
export function talksAboutChanges(text) {
  return /\b(?:diff|uncommitted|unstaged|staged|work in progress)\b|\b(?:my|these|those|recent|latest|last|your)\s+(?:changes?|edits?)\b|\bwhat (?:did )?(?:i|we|you) (?:just )?(?:change|changed|edit|edited|touch|touched)\b|\b(?:i|we) (?:just )?(?:changed|edited|touched|broke)\b|\bsince (?:my|the) (?:last )?(?:change|edit|commit)\b/i.test(text);
}

// Files a request asks to make ("a file called notes.html", "create notes.html"):
// a look-alike that already exists is never read in their place.
export function createdNames(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\b(?:called|named|name it|call it|save (?:it )?as|create|make|write)\s+(?:(?:a|an|the|one|new|self-contained|html|file|page)\s+)*["'`]?([\w./-]+\.[A-Za-z]\w{0,5})\b/gi)) out.add(basename(m[1]).toLowerCase());
  return out;
}

// A test run as the model reads it: all pass in one line, otherwise what
// fails and where, cut to fit.
export function testReport(cmd, out, code, { timedOut = false, secs = null, maxChars = chars(SHARES.tests) } = {}) {
  const took = secs != null ? ` (${Math.round(secs)} s)` : '';
  if (timedOut) return `$ ${cmd}\n(Stopped after ${Math.round(secs ?? 60)} s, before it finished. The last lines it printed:)\n${cut(out.trimEnd().split('\n').slice(-15).join('\n'), maxChars - 150)}`;
  const r = readResults(out, code);
  if (r.ok) return `$ ${cmd}\nAll ${r.total ?? ''} tests pass${took}.`.replace('  ', ' ');
  const head = `$ ${cmd}\n${r.failed != null ? `${r.failed} of ${r.total} tests fail` : `It failed (exit code ${code})`}${r.failing.length ? `: ${r.failing.slice(0, 5).join('; ')}` : ''}${took}.`;
  return `${head}\n${cut(failureDigest(out, 60), maxChars - head.length - 20)}`;
}

const cut = (s, max) => (s.length > max ? `${s.slice(0, Math.max(0, max))}\n… (cut here)` : s);
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 8_000_000 });

// The changes not yet committed: each changed file's lines (the smaller ones
// first; the biggest are named but cut when they do not fit), then the new
// files git does not track yet. null outside git or with nothing changed.
export function gitChanges(cwd, { maxChars = chars(SHARES.tests) } = {}) {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return null;
  const hasHead = git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']).status === 0;
  const base = hasHead ? ['HEAD'] : [];
  const stat = git(cwd, ['diff', ...base, '--numstat', '--relative', '--no-color']);
  const changed = (stat.stdout ?? '').split('\n').filter(Boolean).map((l) => { const [a, d, ...f] = l.split('\t'); return { rel: f.join('\t'), size: (Number(a) || 0) + (Number(d) || 0) }; });
  const fresh = (git(cwd, ['ls-files', '--others', '--exclude-standard']).stdout ?? '').split('\n').filter(Boolean);
  if (!changed.length && !fresh.length) return null;
  let text = '';
  const shown = [];
  const left = [];
  for (const f of [...changed].sort((a, b) => a.size - b.size)) {
    const d = (git(cwd, ['diff', ...base, '-U2', '--no-color', '--relative', '--', f.rel]).stdout ?? '').replace(/^index [0-9a-f.]+.*\n/gm, '');
    if (d && text.length + d.length <= maxChars - 300) { text += d; shown.push(f.rel); } else left.push(f.rel);
  }
  const notes = [
    left.length ? `… and ${left.length} more changed file${left.length === 1 ? '' : 's'} not shown: ${left.slice(0, 8).join(', ')}${left.length > 8 ? ', …' : ''}` : '',
    fresh.length ? `New files git does not track yet: ${fresh.slice(0, 10).join(', ')}${fresh.length > 10 ? `, and ${fresh.length - 10} more` : ''}` : '',
  ].filter(Boolean).join('\n');
  return { text: `${text}${notes ? `${text ? '\n' : ''}${notes}` : ''}`.trim(), files: shown, more: left.length, fresh: fresh.length };
}

// Just the names of the files changed since the last commit, and the new
// ones git does not track yet ([] outside git).
export function changedFiles(cwd, max = 8) {
  if (git(cwd, ['rev-parse', '--show-toplevel']).status !== 0) return [];
  const hasHead = git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']).status === 0;
  const tracked = (git(cwd, ['diff', ...(hasHead ? ['HEAD'] : []), '--name-only', '--relative']).stdout ?? '').split('\n').filter(Boolean);
  const fresh = (git(cwd, ['ls-files', '--others', '--exclude-standard']).stdout ?? '').split('\n').filter(Boolean);
  return [...new Set([...tracked, ...fresh])].slice(0, max);
}

// A word that is a name in code, not an everyday word that happens to be one
// ("formatMoney", "to_dict", "TOOL_DEFS", `route` written as code; not "list").
const esc = (w) => w.replace(/\$/g, '\\$');
const nameLike = (w, text) => /[a-z][A-Z]|_|\$|\d/.test(w) || /^[A-Z][A-Z0-9_]{2,}$/.test(w) || new RegExp(`\`${esc(w)}\`|(?<![\\w$])${esc(w)}\\(`).test(text);
const DEFINES = (name) => new RegExp(`(?:function\\s*\\*?\\s*|class\\s+|def\\s+|(?:const|let|var)\\s+)${esc(name)}(?![\\w$])`);

// Where each name the request uses is defined and used, one line each:
// "formatMoney: defined in format.mjs:4; used in report.mjs:9, 14; format.test.mjs:5".
// entries: the project map's (repomap.mjs). null when the request names none.
export function whoUses(cwd, text, entries, { maxChars = chars(SHARES.lsp), maxNames = 4, maxFiles = 6 } = {}) {
  const defined = new Map();
  for (const e of entries) for (const n of e.names) if (!defined.has(n)) defined.set(n, e.rel);
  const names = [...new Set(String(text).match(/[A-Za-z_$][\w$]*/g) ?? [])].filter((w) => w.length > 2 && defined.has(w) && nameLike(w, text)).slice(0, maxNames);
  if (!names.length) return null;
  const texts = new Map();
  const read = (rel) => { if (!texts.has(rel)) { let t = ''; try { t = readFileSync(join(cwd, rel), 'utf8'); } catch {} texts.set(rel, t.length > 400_000 ? '' : t.split('\n')); } return texts.get(rel); };
  const lines = [];
  for (const name of names) {
    const word = new RegExp(`(?<![\\w$])${esc(name)}(?![\\w$])`);
    const home = defined.get(name);
    const at = read(home).findIndex((l) => DEFINES(name).test(l));
    const uses = [];
    for (const e of entries) {
      if (uses.length >= maxFiles) break;
      const found = [];
      read(e.rel).forEach((l, i) => { if (word.test(l) && !(e.rel === home && i === at)) found.push(i + 1); });
      if (found.length) uses.push(`${e.rel}:${found.slice(0, 4).join(', ')}${found.length > 4 ? ', …' : ''}`);
    }
    lines.push(`${name}: defined in ${home}${at >= 0 ? `:${at + 1}` : ''}; ${uses.length ? `used in ${uses.join('; ')}` : 'used nowhere else'}`);
  }
  const out = `Where these names are defined and used (lines):\n${lines.join('\n')}`;
  return { text: cut(out, maxChars), names };
}
