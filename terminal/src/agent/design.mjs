// The design examples: a folder of short "design cards" (the colours, type,
// spacing and skeleton of a page that looks right, with its do's and don'ts)
// that go along with a request to make or restyle a page, so a small model
// builds in a look the user already liked instead of inventing one. The
// model's weights never change; it is handed the closest card each time,
// the way a designer is handed a mood board.
//   where         `docs/private/design examples/` (AGENTIC_DESIGN_DIR names
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
//   looks         a card marked "- Look: yes" (look-calm, look-dense, look-bold,
//                 look-dark in each set) restyles any kind: a request with its
//                 Words ("minimal", "compact", "playful", "dark") gets the
//                 example with its own "## Look" swapped for the look's; with
//                 none of them, the example's own look, as before
//   style         which set's cards win: auto (your picks, then opus, then
//                 fable: the order below), opus, fable, or mix (opus and fable
//                 take turns, one page request each; design-turn.json holds
//                 whose turn it is)
//   switches      settings.json "design": { auto, check, sets, style, studio }; AGENTIC_DESIGN
//                 (on|off), AGENTIC_DESIGN_SETS (all | set,set), AGENTIC_DESIGN_STYLE,
//                 AGENTIC_LAYOUT (on|off, the browser check in flows/layoutcheck.mjs)
//                 and AGENTIC_STUDIO (on|off, the design studio's pieces in
//                 studio.mjs, which take the example card's place) win over it
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, sep, relative, isAbsolute } from 'node:path';
import { findPrivateDir } from '../app/docs-dir.mjs';
import { instructionHome } from './instructions.mjs';

export const FOLDER = 'design examples';
export const CARD_CHARS = 3200; // of one card
export const NOTE_CHARS = 5600; // everything that goes along, all cards together
export const MORE = 3; // other fitting cards named by path
// The sets in the order they win a tie: the user's own first.
const SET_ORDER = ['your rules', 'your picks', 'opus', 'fable', 'public systems'];
// Which set's cards win (see "style" above). mix: opus and fable take turns.
export const STYLES = ['auto', 'opus', 'fable', 'mix'];
export const styleWords = (style) => ({ auto: 'your picks, then Opus, then Fable', opus: 'Opus first', fable: 'Fable first', mix: 'Opus and Fable take turns' }[style] ?? style);
// A look swaps the example's own look section, so it adds only its Do and Don't lines: this much more room.
export const LOOK_CHARS = 700;

export function designDir() {
  const named = process.env.AGENTIC_DESIGN_DIR;
  if (named) return existsSync(named) ? resolve(named) : null;
  const own = findPrivateDir();
  const d = own ? join(own, FOLDER) : null;
  return d && existsSync(d) ? d : null;
}

const onOff = (v) => (v === undefined || v === '' ? undefined : !/^(off|0|false|no)$/i.test(v));

// What is switched on: the saved settings, with the environment on top.
export function designSettings(saved = {}) {
  // ask: a page saved for a request stops the turn and asks you first (agent.mjs askPage).
  const s = { auto: true, check: true, ask: true, sets: 'all', style: 'auto', studio: true, ...(saved && typeof saved === 'object' ? saved : {}) };
  const auto = onOff(process.env.AGENTIC_DESIGN);
  const check = onOff(process.env.AGENTIC_LAYOUT);
  const ask = onOff(process.env.AGENTIC_LAYOUT_ASK);
  const studio = onOff(process.env.AGENTIC_STUDIO);
  if (auto !== undefined) s.auto = auto;
  if (check !== undefined) s.check = check;
  if (ask !== undefined) s.ask = ask;
  s.ask = s.ask !== false;
  if (studio !== undefined) s.studio = studio;
  s.studio = s.studio !== false;
  const sets = process.env.AGENTIC_DESIGN_SETS?.trim();
  if (sets) s.sets = /^all$/i.test(sets) ? 'all' : sets.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (s.sets !== 'all' && !Array.isArray(s.sets)) s.sets = 'all';
  const style = process.env.AGENTIC_DESIGN_STYLE?.trim().toLowerCase();
  if (style) s.style = style;
  if (!STYLES.includes(s.style)) s.style = 'auto';
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
    look: yes(fields.look),
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
const MADE_THING = /\b(?:a|an)\s+(?:[\w-]+\s+){0,3}?(?:app|application|timer|countdown|clock|stopwatch|calculator|converter|counter|game|quiz|calendar|kanban|board|chart|graph|gallery|tracker|planner|table|list|visuali[sz]ation|infographic|poster|flyer|resume|cv|invitation|menu|shop|webshop|storefront|blog(?!\s+posts?\b)|invoice|receipt|survey|questionnaire)\b|\btables? (?:of|with|that|showing)\b|\b(?:sortable|data|html) tables?\b/i;
// More things that are a page when one is made, but only with the word that says so: a map of
// places (not a map from ids to names), a music player (not a player class), a chat window (not a
// chat bot), a profile card (not a card field).
const MADE_MORE = /\b(?:a|an)\s+(?:[\w-]+\s+){0,3}?(?:timeline|carousel|slideshow|lightbox|scoreboard|playlist)\b|\b(?:interactive|world|store|location|street|city|travel|leaflet) maps?\b|\bmaps? (?:of|showing) (?:my|our|the|all) (?:[\w-]+ ){0,2}(?:stores|shops|locations|offices|places|cities|countries|trips|travels|customers|branches|visits|sales)\b|\b(?:music|audio|video|media|mp3|podcast|radio) players?\b|\bchat ?(?:window|box|view|bubbles?)\b|\b(?:support|live|group|team) chat\b|\b(?:store|shop|branch) (?:locator|finder)\b|\b(?:profile|stat|stats|data|info|user|product|contact|business|weather|summary|pricing|team|recipe|flash|kpi|metric) cards?\b|\b(?:online|web) (?:shop|store)s?\b|\bempty[- ]states?\b|\bpricing (?:tables?|plans?|tiers?)\b|\bproduct (?:grid|listing|details?)\b/i;
// "show my sales as a bar chart", "plot the runs over time in a graph": a chart asked for with no
// make-word.
const CHART_ASK = /\b(?:show|draw|plot|display|put|turn|visuali[sz]e)\b[^.?!]{0,60}?\b(?:as|into|in|on) (?:a |an )?(?:[\w-]+ ){0,2}(?:charts?|graphs?|plots?|dashboards?|maps?|timelines?)\b|^\s*(?:please )?(?:chart|graph|plot|visuali[sz]e) (?:my|our|the|all)\b/i;
const LOOKS = /\b(?:look(?:s|ing)? (?:better|nicer|good|great|cleaner|modern|professional|prettier|ugly|bad|off|dated|plain|boring)|prettier|nicer looking|better looking|more modern|redesign|restyle|the design|visual(?:ly)?)\b/i;
const NOT_UI_FILE = /\b[\w-]+\.(py|rb|go|rs|java|kt|swift|c|cc|cpp|h|sh|sql|ya?ml|toml|json|csv|txt|md)\b/i;
const CODE_ONLY = /\b(function|method|class|helper|endpoint|parser|stdout|stderr|exception|unit tests?|test suite|api route|database|schema|migration|regex|cli|command line|script|matplotlib|seaborn|pandas|numpy|plotly|jupyter|notebook)\b/i;
const QUESTION = /^(?:(?:just|please|hey|hi|ok|so)[,\s]+)?(?:what|which|where|why|how|who|when|explain|describe|tell me|does|is|are|do|did|should)\b/i;

export function isDesignRequest(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const looks = LOOKS.test(t);
  if (QUESTION.test(t) && !/\b(?:can|could|would) you\b/i.test(t.split(/[.?!]/)[0]) && !looks) return false;
  if (NOT_UI_FILE.test(t) && !/\.(html?|css|jsx|tsx|vue|svelte)\b/i.test(t)) return false;
  if (CODE_ONLY.test(t) && !looks) return false;
  return looks || (MAKE.test(t) && (THING.test(t) || MADE_THING.test(t) || MADE_MORE.test(t))) || CHART_ASK.test(t);
}

const clean = (s) => ` ${String(s).toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;

// Words that say nothing about the kind of page ("a chat window", "a simple dashboard"): a card's
// single Words and the words of its name do not count them. A phrase with one ("simple page") still
// does. "small" stays a word: the user's own card requests ("a small percentage change", a compact
// profile card) find the widget by it, and "a small game" now has a game card that wins by its name.
const NOISE = new Set(['little', 'tiny', 'simple', 'basic', 'plain', 'quick', 'nice', 'window', 'page', 'pages', 'screen', 'screens', 'single', 'new', 'full', 'one']);

// How well a card fits a request: its Words found in the request (a phrase
// counts twice) and the words of its name.
export function scoreCard(card, text) {
  const t = clean(text);
  let score = 0;
  for (const w of card.words) {
    const c = clean(w).trim();
    if (!c || NOISE.has(c)) continue;
    // "explain" also finds "explains" and "explained"; a phrase counts twice.
    const re = new RegExp(` ${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es|d|ed|ing)? `);
    if (re.test(t)) score += c.includes(' ') ? 2 : 1;
  }
  for (const w of clean(card.name).trim().split(' ')) if (w.length > 3 && !NOISE.has(w) && t.includes(` ${w} `)) score += 1;
  return score;
}

const onSet = (sets) => (c) => sets === 'all' || !sets || sets.includes(c.set);

// "Add a dark mode" asks for a switch, not a dark look, and "clean up the page" asks for a tidy, not
// a calm look: the phrases are taken out before the looks are matched.
const MODE_ASK = /\b(?:dark|light)[- ](?:mode|theme) (?:toggle|switch|button|option|setting)s?\b|\b(?:dark|light)[- ]mode\b|\bdark and light\b|\blight and dark\b|\bclean(?:ed|ing)?[- ]?up\b/gi;

// The look a request asks for by its Words, or null. Only a look card's Words
// count (its name's "look" is in every restyle request). A tie goes to the
// look named first in the request.
export function pickLook(text, cards) {
  const t = String(text ?? '').replace(MODE_ASK, ' ');
  const at = (c) => Math.min(...c.words.map((w) => clean(t).indexOf(` ${clean(w).trim()} `)).filter((i) => i >= 0), Infinity);
  const scored = cards.filter((c) => c.look).map((c) => ({ c, score: scoreCard({ ...c, name: '' }, t) })).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || at(a.c) - at(b.c));
  return scored[0]?.c ?? null;
}

// Whose turn it is under the "mix" style: opus, then fable, then opus… peek:
// the hub's "Try a request" looks without taking the turn.
export function mixTurn({ peek = false, home = instructionHome() } = {}) {
  const file = join(home, 'design-turn.json');
  let last = null;
  try { last = JSON.parse(readFileSync(file, 'utf8')).last; } catch {}
  const next = last === 'opus' ? 'fable' : 'opus';
  if (!peek) try { mkdirSync(home, { recursive: true }); writeFileSync(file, `${JSON.stringify({ last: next, at: new Date().toISOString() })}\n`); } catch { /* the turn only alternates the sets */ }
  return next;
}

// The cards that go along with a request: every "Always" card in the sets that
// are on, the one best example (a "Default" card when no Words match), the
// look the request asks for, and the paths of up to MORE other cards that
// also fit. style opus or fable (mix is resolved to one of them by mixTurn):
// that set's best fitting card wins over the others; with none that fits,
// the usual order.
export function pickCards(text, { dir = designDir(), sets = 'all', cards, style = 'auto' } = {}) {
  const all = (cards ?? readCards(dir).cards).filter(onSet(sets));
  const always = all.filter((c) => c.always);
  const kinds = all.filter((c) => !c.always && !c.look);
  const scored = kinds.map((c) => ({ c, score: scoreCard(c, text) }))
    .sort((a, b) => b.score - a.score || setRank(a.c.set) - setRank(b.c.set) || a.c.file.localeCompare(b.c.file));
  const fits = scored.filter((x) => x.score > 0);
  let best = (style === 'opus' || style === 'fable' ? fits.find((x) => x.c.set === style)?.c : null) ?? fits[0]?.c ?? null;
  if (!best) best = scored.map((x) => x.c).filter((c) => c.default).sort((a, b) => setRank(a.set) - setRank(b.set))[0] ?? null;
  const more = fits.filter((x) => x.c !== best).slice(0, MORE).map((x) => x.c);
  // The look comes from the example's own set; for a card of your picks or a public system, from the chosen style's set, else opus's.
  const looks = all.filter((c) => c.look);
  const want = pickLook(text, looks);
  const from = [best?.set, style === 'fable' ? 'fable' : 'opus', 'opus', 'fable'];
  const base = (c) => c.file.split('/').pop();
  const look = want ? from.map((set) => looks.find((c) => c.set === set && base(c) === base(want))).find(Boolean) ?? want : null;
  return { always, examples: best ? [best] : [], more, look };
}

// A card's "## Name" section (up to the next one), or ''.
export function cardSection(text, name) {
  const m = new RegExp(`(^|\\n)## ${name}(?![\\w'’])[^\\n]*\\n[\\s\\S]*?(?=\\n## |$)`).exec(text);
  return m ? m[0].replace(/^\n/, '').trim() : '';
}

// The example in a look: its own "## Look" section swapped for the look
// card's, and the look's Do and Don't lines after the example's own.
function inLook(text, lookText, lookName) {
  const own = cardSection(text, 'Look');
  const theirs = cardSection(lookText, 'Look');
  if (!theirs) return text;
  const mine = theirs.replace(/^## Look[^\n]*/, () => `## Look (${lookName})`);
  const swapped = own ? text.replace(own, () => mine) : `${text}\n\n${mine}`;
  const extra = ['Do', "Don't"].map((n) => cardSection(lookText, n).replace(/^## [^\n]*/, () => `## ${n} (${lookName})`)).filter(Boolean);
  return [swapped, ...extra].join('\n\n');
}

// A card as the model reads it, cut at a section (then a line) to fit.
function cardText(dir, card, room, look) {
  let text = '';
  try { text = readFileSync(join(dir, card.file), 'utf8').trim(); } catch { text = `# ${card.name}\n${card.body}`; }
  if (look) {
    let lookText = '';
    try { lookText = readFileSync(join(dir, look.file), 'utf8').trim(); } catch { lookText = `# ${look.name}\n${look.body}`; }
    text = inLook(text, lookText, look.name);
  }
  const max = Math.min(CARD_CHARS + (look ? LOOK_CHARS : 0), room);
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
  const look = pick.look && pick.examples.length ? pick.look : null;
  let room = NOTE_CHARS + (look ? LOOK_CHARS : 0) - HEAD.length;
  for (const [label, c] of [...pick.always.map((c) => ['Rules', c]), ...pick.examples.map((c) => ['Example', c])]) {
    if (room < 400) break;
    const inIt = label === 'Example' ? look : null;
    const t = `[${label} · DESIGN/${c.file}${inIt ? ` · in the ${inIt.name} from DESIGN/${inIt.file}` : ''}]\n${cardText(dir, c, room - 60 - (inIt ? inIt.file.length + inIt.name.length + 20 : 0), inIt)}`;
    parts.push(t);
    used.push(c);
    if (inIt) used.push(inIt);
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
    const looks = s.cards.filter((c) => c.look);
    const kinds = s.cards.filter((c) => !c.look);
    return [`${on ? '●' : '○'} ${s.name || '(top)'}${settings.style === s.name ? ' ★' : ''}`, `${kinds.length} card${kinds.length === 1 ? '' : 's'}: ${kinds.map((c) => c.file.split('/').pop().replace(/\.md$/i, '')).join(', ')}${looks.length ? ` · looks: ${looks.map((c) => c.file.split('/').pop().replace(/^look-|\.md$/gi, '')).join(', ')}` : ''}`];
  });
  return { dir, rows, style: settings.style };
}
