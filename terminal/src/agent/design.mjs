// The design examples: a folder of short "design cards" (the colours, type,
// spacing and skeleton of a page that looks right, with its do's and don'ts)
// that go along with a request to make or restyle a page, so a small model
// builds in a look the user already liked instead of inventing one. The
// model's weights never change; it is handed the closest card each time,
// the way a designer is handed a mood board.
//   where         `design examples/` in the DOCS folder (AGENTIC_DESIGN_DIR names
//                 another), one subfolder per set: your picks, your rules, opus,
//                 fable, public systems (any other subfolder is a set too)
//   a card        one .md file: "# Name", then "- For:", "- Words:", and
//                 optionally "- Page:" (a full example page beside it),
//                 "- Always: yes" (comes with every page request: the rules),
//                 "- Default: yes" (comes when no card's words match)
//   when          a request to make or restyle a page, screen or widget
//                 (isDesignRequest), or any request sent with /design; never a
//                 question, a bug fix or a code-only change (matching every
//                 request by its words sent ordinary ones to the MATH notes,
//                 26 Sep)
//   how much      the always cards + the ONE best example, cut to NOTE_CHARS
//                 (≈1,400 tokens, 7–12 s of reading on this Mac); the other
//                 cards that fit are named by path, and the model may Read them
//                 or a full page under DESIGN/ (read-only, like MATH/)
//   switches      settings.json "design": { auto, check, sets }; AGENTIC_DESIGN
//                 (on|off), AGENTIC_DESIGN_SETS (all | set,set) and AGENTIC_LAYOUT
//                 (on|off, the browser check in flows/layoutcheck.mjs) win over it
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep, relative, isAbsolute } from 'node:path';
import { findDocsDir } from '../app/docs-dir.mjs';

export const FOLDER = 'design examples';
export const CARD_CHARS = 3200; // of one card
export const NOTE_CHARS = 5600; // everything that goes along, all cards together
export const MORE = 3; // other fitting cards named by path
// The sets in the order they win a tie: the user's own first.
export const SET_ORDER = ['your rules', 'your picks', 'opus', 'fable', 'public systems'];

export function designDir() {
  const named = process.env.AGENTIC_DESIGN_DIR;
  if (named) return existsSync(named) ? resolve(named) : null;
  const docs = findDocsDir();
  const d = docs ? join(docs, FOLDER) : null;
  return d && existsSync(d) ? d : null;
}

const onOff = (v) => (v === undefined || v === '' ? undefined : !/^(off|0|false|no)$/i.test(v));

// What is switched on: the saved settings, with the environment on top.
export function designSettings(saved = {}) {
  const s = { auto: true, check: true, sets: 'all', ...(saved && typeof saved === 'object' ? saved : {}) };
  const auto = onOff(process.env.AGENTIC_DESIGN);
  const check = onOff(process.env.AGENTIC_LAYOUT);
  if (auto !== undefined) s.auto = auto;
  if (check !== undefined) s.check = check;
  const sets = process.env.AGENTIC_DESIGN_SETS?.trim();
  if (sets) s.sets = /^all$/i.test(sets) ? 'all' : sets.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (s.sets !== 'all' && !Array.isArray(s.sets)) s.sets = 'all';
  return s;
}

// "# Name" and the "- Key: value" lines under it; the rest is the card.
export function parseCard(text, file = '') {
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const m = /^#\s+(.+)$/.exec(lines[i] ?? '');
  const name = m ? m[1].trim() : file.replace(/\.md$/i, '').split('/').pop();
  if (m) i++;
  const fields = {};
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) { if (Object.keys(fields).length) { i++; break; } continue; }
    const f = /^-\s*([A-Za-z]+)\s*:\s*(.*)$/.exec(l);
    if (!f) break;
    fields[f[1].toLowerCase()] = f[2].trim();
  }
  const body = lines.slice(i).join('\n').trim();
  const yes = (v) => /^(yes|true|on)$/i.test(v ?? '');
  return {
    name,
    for: fields.for ?? '',
    words: (fields.words ?? '').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean),
    page: fields.page || null,
    always: yes(fields.always),
    default: yes(fields.default),
    body,
  };
}

const setRank = (name) => { const i = SET_ORDER.indexOf(name); return i < 0 ? SET_ORDER.length : i; };

// Every card in the folder, set by set. A README is for people, not a card.
export function readCards(dir = designDir()) {
  if (!dir || !existsSync(dir)) return { dir: null, sets: [], cards: [] };
  const cards = [];
  const add = (set, sub) => {
    let names = [];
    try { names = readdirSync(join(dir, sub)).sort(); } catch { return; }
    for (const f of names) {
      if (!/\.md$/i.test(f) || /^readme\.md$/i.test(f) || f.startsWith('.')) continue;
      const rel = sub ? `${sub}/${f}` : f;
      let text;
      try { text = readFileSync(join(dir, rel), 'utf8'); } catch { continue; }
      const card = parseCard(text, rel);
      const page = card.page && existsSync(join(dir, sub, card.page)) ? (sub ? `${sub}/${card.page}` : card.page) : null;
      cards.push({ ...card, set, file: rel, page, chars: text.length });
    }
  };
  add('', '');
  for (const d of readdirSync(dir).sort()) {
    if (d.startsWith('.')) continue;
    try { if (statSync(join(dir, d)).isDirectory()) add(d.toLowerCase(), d); } catch {}
  }
  const sets = [...new Set(cards.map((c) => c.set))].sort((a, b) => setRank(a) - setRank(b) || a.localeCompare(b))
    .map((name) => ({ name, cards: cards.filter((c) => c.set === name) }));
  return { dir, sets, cards };
}

// A request to make or restyle something people look at: a page, a screen, a
// widget, a dashboard, a stylesheet, the design itself. Not a question about
// it, and not work on server or script code (a .py or .go file named).
const MAKE = /\b(?:create|make|build|design|redesign|restyle|style|write|generate|add|give|improve|polish|update|change|rework|revamp|refresh|modernize|beautify|tidy|clean up|lay out|layout)\b/i;
const THING = /\b(?:web ?pages?|pages?|web ?sites?|sites?|web ?app|dashboards?|html|widgets?|ui|user interface|interface|screens?|forms?|landing|layouts?|themes?|dark mode|light mode|css|stylesheets?|styles?|styling|looks?|design|wizard|portfolio|home ?page|gallery|slides?|mock-?up|front-?end|navbar|nav bar|sidebar|hero|pop-?up|modal|report page|results page)\b/i;
// Things that are only a page when one is being made: "a todo app", "a countdown
// timer", "a table of my repos" (not "build the app", "the users table").
const MADE_THING = /\b(?:a|an)\s+(?:[\w-]+\s+){0,3}?(?:app|application|timer|countdown|clock|stopwatch|calculator|converter|counter|game|quiz|calendar|kanban|board|chart|graph|gallery|tracker|planner|table|list|visuali[sz]ation|infographic|poster|flyer|resume|cv|invitation|menu)\b|\btables? (?:of|with|that|showing)\b|\b(?:sortable|data|html) tables?\b/i;
const LOOKS = /\b(?:look(?:s|ing)? (?:better|nicer|good|great|cleaner|modern|professional|prettier|ugly|bad|off|dated|plain|boring)|prettier|nicer looking|better looking|more modern|redesign|restyle|the design|visual(?:ly)?)\b/i;
const NOT_UI_FILE = /\b[\w-]+\.(py|rb|go|rs|java|kt|swift|c|cc|cpp|h|sh|sql|ya?ml|toml|json|csv|txt|md)\b/i;
const CODE_ONLY = /\b(function|method|class|helper|endpoint|parser|stdout|stderr|exception|unit tests?|test suite|api route|database|schema|migration|regex|cli|command line|script)\b/i;
const QUESTION = /^(?:(?:just|please|hey|hi|ok|so)[,\s]+)?(?:what|which|where|why|how|who|when|explain|describe|tell me|does|is|are|do|did|should)\b/i;

export function isDesignRequest(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const looks = LOOKS.test(t);
  if (QUESTION.test(t) && !/\b(?:can|could|would) you\b/i.test(t.split(/[.?!]/)[0]) && !looks) return false;
  if (NOT_UI_FILE.test(t) && !/\.(html?|css|jsx|tsx|vue|svelte)\b/i.test(t)) return false;
  if (CODE_ONLY.test(t) && !looks) return false;
  return looks || (MAKE.test(t) && (THING.test(t) || MADE_THING.test(t)));
}

const clean = (s) => ` ${String(s).toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;

// How well a card fits a request: its Words found in the request (a phrase
// counts twice) and the words of its name.
export function scoreCard(card, text) {
  const t = clean(text);
  let score = 0;
  for (const w of card.words) {
    const c = clean(w).trim();
    if (!c) continue;
    // "explain" also finds "explains" and "explained"; a phrase counts twice.
    const re = new RegExp(` ${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es|d|ed|ing)? `);
    if (re.test(t)) score += c.includes(' ') ? 2 : 1;
  }
  for (const w of clean(card.name).trim().split(' ')) if (w.length > 3 && t.includes(` ${w} `)) score += 1;
  return score;
}

const onSet = (sets) => (c) => sets === 'all' || !sets || sets.includes(c.set);

// The cards that go along with a request: every "Always" card in the sets that
// are on, the one best example (a "Default" card when no Words match), and
// the paths of up to MORE other cards that also fit.
export function pickCards(text, { dir = designDir(), sets = 'all', cards } = {}) {
  const all = (cards ?? readCards(dir).cards).filter(onSet(sets));
  const always = all.filter((c) => c.always);
  const scored = all.filter((c) => !c.always).map((c) => ({ c, score: scoreCard(c, text) }))
    .sort((a, b) => b.score - a.score || setRank(a.c.set) - setRank(b.c.set) || a.c.file.localeCompare(b.c.file));
  let best = scored.find((x) => x.score > 0)?.c ?? null;
  if (!best) best = scored.map((x) => x.c).filter((c) => c.default).sort((a, b) => setRank(a.set) - setRank(b.set))[0] ?? null;
  const more = scored.filter((x) => x.score > 0 && x.c !== best).slice(0, MORE).map((x) => x.c);
  return { always, examples: best ? [best] : [], more };
}

// A card as the model reads it, cut at a section (then a line) to fit.
function cardText(dir, card, room) {
  let text = '';
  try { text = readFileSync(join(dir, card.file), 'utf8').trim(); } catch { text = `# ${card.name}\n${card.body}`; }
  const max = Math.min(CARD_CHARS, room);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = Math.max(cut.lastIndexOf('\n## '), cut.lastIndexOf('\n'));
  // An open code fence would swallow what follows it.
  let out = cut.slice(0, at > max * 0.5 ? at : max).trimEnd();
  if ((out.match(/```/g) ?? []).length % 2) out += '\n```';
  return `${out}\n(… the rest is in DESIGN/${card.file})`;
}

const HEAD = "Design examples for this request, from the user's design folder (read-only, under DESIGN/). Use them for the look: take the colours, type, spacing and starting skeleton from the example, and keep to its Do and Don't lines and to the rules. Write this request's own content; do not copy the example's words or its subject.";

// The text that goes with the request, and what it holds (for the Context line).
export function designNotes(pick, dir = designDir()) {
  if (!dir || (!pick.always.length && !pick.examples.length)) return null;
  const parts = [HEAD];
  const used = [];
  let room = NOTE_CHARS - HEAD.length;
  for (const [label, c] of [...pick.always.map((c) => ['Rules', c]), ...pick.examples.map((c) => ['Example', c])]) {
    if (room < 400) break;
    const t = `[${label} · DESIGN/${c.file}]\n${cardText(dir, c, room - 60)}`;
    parts.push(t);
    used.push(c);
    room -= t.length + 2;
  }
  const page = pick.examples.find((c) => c.page && used.includes(c))?.page;
  if (page) parts.push(`A full page built this way: DESIGN/${page} (Read it only if the card is not enough; it is long).`);
  if (pick.more.length) parts.push(`Other examples that fit: ${pick.more.map((c) => `DESIGN/${c.file}`).join(', ')}.`);
  const text = parts.join('\n\n');
  return { text, cards: used, chars: text.length };
}

// "DESIGN/…" in a tool's path: the design folder, read-only (tools.mjs).
export function designPathFor(p, dir = designDir()) {
  if (p !== 'DESIGN' && !p.startsWith('DESIGN/')) return null;
  if (!dir) return null;
  const abs = resolve(dir, p === 'DESIGN' ? '.' : p.slice(7));
  if (abs !== resolve(dir) && !abs.startsWith(`${resolve(dir)}${sep}`)) return null; // "DESIGN/../…" stays out
  return { abs, rel: p };
}

// A full path into the folder still means it, read-only.
export function inDesignDir(abs, dir = designDir()) {
  if (!dir) return null;
  const r = relative(dir, abs);
  if (r.startsWith('..') || isAbsolute(r)) return null;
  return `DESIGN${r ? `/${r.split(sep).join('/')}` : ''}`;
}

// /design alone: the folder, set by set, and what is switched on.
export function designSummary(settings = designSettings(), dir = designDir()) {
  const { sets } = readCards(dir);
  if (!dir) return { dir: null, rows: [] };
  const rows = sets.map((s) => {
    const on = settings.sets === 'all' || settings.sets.includes(s.name);
    return [`${on ? '●' : '○'} ${s.name || '(top)'}`, `${s.cards.length} card${s.cards.length === 1 ? '' : 's'}: ${s.cards.map((c) => c.file.split('/').pop().replace(/\.md$/i, '')).join(', ')}`];
  });
  return { dir, rows };
}
