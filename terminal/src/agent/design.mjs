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
//   switches      settings.json "design": { auto, check, sets, style, studio, polish, brief, learn }; AGENTIC_DESIGN
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
  // polish, brief, learn (8 Oct 2026, the owner's picks): check and look before asking, a plan before
  // writing, and "Looks good" offering to keep the page (agent-pages.mjs polishPage, pageBrief, offerPick).
  // library, look (8 Oct 2026): the downloaded pieces (library.mjs) picked with the studio's own, and
  // a brand look every page takes (null: the user's own; a request that names one still gets it).
  const s = { auto: true, check: true, ask: true, sets: 'all', style: 'auto', studio: true, polish: true, brief: true, learn: true, library: true, look: null, ...(saved && typeof saved === 'object' ? saved : {}) };
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
  for (const [k, env] of [['polish', 'AGENTIC_DESIGN_POLISH'], ['brief', 'AGENTIC_DESIGN_BRIEF'], ['learn', 'AGENTIC_DESIGN_LEARN'], ['library', 'AGENTIC_DESIGN_LIBRARY']]) {
    const v = onOff(process.env[env]);
    if (v !== undefined) s[k] = v;
    s[k] = s[k] !== false;
  }
  const sets = process.env.AGENTIC_DESIGN_SETS?.trim();
  if (sets) s.sets = /^all$/i.test(sets) ? 'all' : sets.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (s.sets !== 'all' && !Array.isArray(s.sets)) s.sets = 'all';
  const look = process.env.AGENTIC_DESIGN_LOOK?.trim().toLowerCase();
  if (look) s.look = /^(off|none|mine|yours)$/.test(look) ? null : look;
  if (typeof s.look !== 'string' || !s.look) s.look = null;
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
// Diagrams, slide decks and posters (8 Oct 2026, the owner: "better at ui design and design in general",
// picking charts, slides and posters, and diagrams): a page when one is made, with draw and sketch as
// make-words. Not "the presentation layer", not a diagram of a database's tables written in SQL.
const DRAW = /\b(?:draw|sketch|diagram)\b/i;
const MADE_DESIGN = /\b(?:flow ?charts?|(?:[\w-]+ )?diagrams?|org(?:anization(?:al)?)? charts?|mind ?maps?|slide ?decks?|pitch decks?|(?:a|an|the|my|our)\s+(?:[\w-]+\s+){0,2}?(?:presentation|deck)(?!\s+layer)s?\b|posters?|one-pagers?|infographics?)\b/i;
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
  return looks || ((MAKE.test(t) || DRAW.test(t)) && (THING.test(t) || MADE_THING.test(t) || MADE_MORE.test(t) || MADE_DESIGN.test(t))) || CHART_ASK.test(t);
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

// The thing a request asks for (8 Oct 2026): "for a travel boarding-pass card", "displays a social feed
// post", "redesign the settings page". Any word of the request counted the same before, so a part it
// names ("a small progress indicator", "toggle play", "city codes") brought a goal card, a toggle switch
// or a weather card to a file card, a media player and a boarding pass (3 of the owner's 5 card prompts).
// → { phrase, words: the words that say what kind it is, head } or null.
const HEADS = 'cards?|posts?|pass(?:es)?|players?|widgets?|forms?|tables?|lists?|dashboards?|modals?|pop-?ups?|toasts?|banners?|panels?|screens?|pages?|apps?|items?|tiles?|charts?|graphs?|timelines?|calendars?|boards?|menus?|navbars?|sidebars?|headers?|footers?|wizards?|reports?|invoices?|receipts?|galler(?:y|ies)|feeds?|maps?|games?|quiz(?:zes)?|trackers?|planners?|timers?|clocks?|calculators?|converters?|shops?|stores?|portfolios?|blogs?|resumes?|chats?|logins?|profiles?|layouts?|sites?|websites?|bars?|badges?|buttons?|views?|sections?|strips?|summar(?:y|ies)|snapshots?|feeds?|inbox(?:es)?|flow ?charts?|diagrams?|org charts?|mind ?maps?|decks?|presentations?|slides?|posters?|flyers?|one-pagers?|infographics?';
const ASK_FOR = new RegExp(`\\b(?:for|of|displays?|renders?|shows?|showing|build|create|make|write|design|redesign|restyle|draw|sketch|is)\\s+(?:a|an|one|the|my|our)\\s+((?:(?!(?:of|for|with|about|from|in|on|to|that|which|showing)\\s)[\\w-]+\\s+){0,4})(${HEADS})\\b`, 'i');
const GENERIC = /^(?:pages?|sections?|screens?|sites?|websites?|views?|layouts?|panels?|blocks?)$/;
// Words that say nothing about which kind it is.
const PLAIN = new Set(['a', 'an', 'the', 'or', 'and', 'of', 'with', 'for', 'my', 'our', 'one', 'single', 'self', 'contained', 'html', 'file', 'css', 'compact', 'modern', 'small', 'simple', 'clean', 'mini', 'little', 'tiny', 'nice', 'new', 'minimal', 'sleek', 'basic', 'quick', 'full', 'responsive', 'beautiful', 'pretty', 'cool', 'in', 'app', 'web', 'big', 'large', 'main', 'whole', 'standalone', 'interactive', 'live', 'static', 'card', 'cards']);
export function askedThing(text) {
  const first = String(text ?? '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0];
  const m = ASK_FOR.exec(first) ?? ASK_FOR.exec(String(text ?? '').replace(/\s+/g, ' '));
  if (!m) return null;
  const head = m[2].toLowerCase();
  const before = clean(m[1]).trim().split(' ').filter(Boolean);
  // "a file or document card": file is the kind there, not the "HTML file" every request is.
  const words = before.filter((w, i) => !PLAIN.has(w) || (w === 'file' && before[i - 1] !== 'html'));
  const headWord = clean(head).trim();
  // A page, a section, a screen: the word before says what kind ("a pricing page" is pricing, "an FAQ
  // section" an FAQ), so that word is the noun and "page" says nothing (8 Oct 2026: with the library's
  // pieces, "pricing page" brought pagination and "team page" a page-numbers bar).
  if (GENERIC.test(headWord) && words.length) {
    const kind = words.filter((w) => w !== headWord && !GENERIC.test(w));
    if (kind.length) return { phrase: clean(`${m[1]}${m[2]}`).trim(), words: [...new Set(kind)], head: kind[kind.length - 1] };
  }
  if (!['card', 'cards'].includes(headWord) && !words.includes(headWord)) words.push(headWord.replace(/s$/, ''));
  return { phrase: clean(`${m[1]}${m[2]}`).trim(), words: [...new Set(words)], head: headWord };
}

// How much of the thing asked for a card (or piece) says: of its Words and its name, the one that says
// the most kind words (2 for "media player" in "compact media player card", 1 for "dashboard"; never
// counted twice, so a card named just "Dashboard" does not beat a closer one). Each must sit in the
// asked-for phrase and hold one of its kind words ("media player" in "compact media player card"; never
// "card" alone). When the thing takes two kind words or more ("boarding pass", "social feed post"), one
// word alone does not say it (a report's "pass" as in pass or fail, a brief's "feed"), unless it is the
// thing's own noun ("post") or one of two it offers ("billing or invoice snapshot": an invoice card).
export function kindHits(card, thing) {
  if (!thing?.words.length) return 0;
  const phrase = ` ${thing.phrase} `;
  const kind = new Set(thing.words);
  const noun = thing.head.replace(/s$/, '');
  const either = new Set([...thing.phrase.matchAll(/(\w+) or (\w+)/g)].flatMap((m) => [m[1], m[2]]));
  const says = (w) => {
    const c = clean(w).trim();
    const parts = c ? c.split(' ') : [];
    const n = parts.filter((x) => kind.has(x) || kind.has(x.replace(/s$/, ''))).length;
    if (!n) return 0;
    if (parts.length === 1 && thing.words.length > 1 && c.replace(/s$/, '') !== noun && !either.has(c)) return 0;
    return new RegExp(` ${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)? `).test(phrase) ? n : 0;
  };
  return Math.max(0, ...card.words.map(says), says(card.name));
}

// scoreCard without the single Words that are only a part of the thing asked for (the "pass" of a
// boarding pass, the "feed" of a social feed post): they say another thing (pass or fail, a news feed).
export function plainScore(card, text, thing = askedThing(text)) {
  if (!thing || thing.words.length < 2) return scoreCard(card, text);
  const either = new Set([...thing.phrase.matchAll(/(\w+) or (\w+)/g)].flatMap((m) => [m[1], m[2]]));
  const noun = thing.head.replace(/s$/, '');
  const part = (w) => { const c = clean(w).trim(); return !c.includes(' ') && thing.words.includes(c) && c !== noun && !either.has(c); };
  return scoreCard({ ...card, words: card.words.filter((w) => !part(w)), name: part(card.name) ? '' : card.name }, text);
}

// The fit: that score, with what says the thing asked for worth three more.
export const fitScore = (card, text, thing = askedThing(text)) => plainScore(card, text, thing) + 3 * kindHits(card, thing);

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
  const thing = askedThing(text);
  const scored = kinds.map((c) => ({ c, score: fitScore(c, text, thing), hits: kindHits(c, thing) }))
    .sort((a, b) => b.score - a.score || setRank(a.c.set) - setRank(b.c.set) || a.c.file.localeCompare(b.c.file));
  const fits = scored.filter((x) => x.score > 0);
  // A style's set wins among the cards that say the thing asked for as well as the best does.
  const top = fits[0]?.hits ?? 0;
  let best = (style === 'opus' || style === 'fable' ? fits.find((x) => x.c.set === style && x.hits >= top)?.c : null) ?? fits[0]?.c ?? null;
  if (!best) best = scored.map((x) => x.c).filter((c) => c.default).sort((a, b) => setRank(a.set) - setRank(b.set))[0] ?? null;
  const bestHits = scored.find((x) => x.c === best)?.hits ?? 0;
  const more = fits.filter((x) => x.c !== best).slice(0, MORE).map((x) => x.c);
  // The look comes from the example's own set; for a card of your picks or a public system, from the chosen style's set, else opus's.
  const looks = all.filter((c) => c.look);
  const want = pickLook(text, looks);
  const from = [best?.set, style === 'fable' ? 'fable' : 'opus', 'opus', 'fable'];
  const base = (c) => c.file.split('/').pop();
  const look = want ? from.map((set) => looks.find((c) => c.set === set && base(c) === base(want))).find(Boolean) ?? want : null;
  // hits: how well the example says the thing asked for, against the studio's pieces (agent-work.mjs).
  return { always, examples: best ? [best] : [], more, look, hits: bestHits, thing };
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

// ── The page plan (8 Oct 2026, the owner's pick "Plan before writing") ─────────
// Before a page request's first step, the model the window is on writes six short lines: what comes
// first and largest, how wide it is and where it sits, the parts in order, the look, the states and the
// phone. A small model wrote a file card as a 1,380-px strip with a green square for its sync mark
// (gemma4, 8 Oct): it never decided how big a card is. The plan goes with the design notes.
export const BRIEF_LINES = ['Main thing', 'Size', 'Parts', 'Look', 'States', 'Phone'];
export const BRIEF_SYSTEM = `You plan a web page or component before another assistant writes its HTML. Answer with exactly these six lines and nothing else, each one short and concrete:
Main thing: what the person comes for; it goes first and largest
Size: how wide it is and where it sits (a card or widget is about 320-440 px wide, centred, or a grid of them; a full page has a centred column about 960-1200 px wide)
Parts: the parts from top to bottom, a few words each, every part the request names
Look: the colours, type, corners and spacing, taken from the design example when one is given
States: hover, pressed, empty, loading or error states the parts need (or "none")
Phone: what changes at 390 px wide`;

export function briefAsk(request, notes = '') {
  const look = cardSection(String(notes), 'Look') || (/The colours are the user's theme[^\n]*/.exec(String(notes))?.[0] ?? '');
  return { system: BRIEF_SYSTEM, user: `The request:\n${String(request).trim().slice(0, 1600)}${look ? `\n\nThe design example's look:\n${look.slice(0, 1200)}` : ''}` };
}

// The six lines out of the answer, in order; null when fewer than four came back.
export function parseBrief(text) {
  const got = new Map();
  for (const l of String(text ?? '').replace(/\*\*/g, '').split('\n')) {
    const m = /^\s*[-*\d.)\s]*([A-Za-z ,]+?)\s*:\s*(.+)$/.exec(l);
    const key = m && BRIEF_LINES.find((k) => k.toLowerCase() === m[1].trim().toLowerCase().replace(/,? top to bottom$/, ''));
    if (key && !got.has(key)) got.set(key, m[2].trim().slice(0, 240));
  }
  if (got.size < 4) return null;
  return BRIEF_LINES.filter((k) => got.has(k)).map((k) => `${k}: ${got.get(k)}`).join('\n');
}

export const briefNote = (brief) => `The plan for this page, made before writing it (keep to it; where the request says otherwise, the request wins):\n${brief}`;

// ── Learn from "Looks good" (8 Oct 2026, the owner's pick) ────────────────────
// A page you look at and call good can be kept as one of your picks: a card in "your picks" with the
// page beside it (its "- Page:"), so a later request for the same kind of thing gets it as its example,
// ahead of the other sets and of the studio's pieces (agent-work.mjs). Asked each time, never saved unasked.

// The Words a kept page is found by: the thing asked for as a phrase and the phrases inside it, each
// kind word with its noun ("file card", "document card"), never a single word (a report's "pass").
export function pickWords(thing) {
  if (!thing) return [];
  const toks = thing.phrase.split(' ');
  const kind = new Set(thing.words);
  const out = new Set([thing.phrase]);
  for (let i = 0; i < toks.length; i++) {
    for (let n = 2; n <= Math.min(4, toks.length - i); n++) {
      const g = toks.slice(i, i + n);
      if (PLAIN.has(g[0]) && !kind.has(g[0]) || ['or', 'and', 'of'].includes(g.at(-1)) || ['or', 'and', 'of'].includes(g[0])) continue;
      if (g.some((w) => kind.has(w))) out.add(g.join(' '));
    }
  }
  // A kind word with the noun: the one next to it, and each of two it offers ("file card", "document card").
  const either = new Set([...thing.phrase.matchAll(/(\w+) or (\w+)/g)].flatMap((m) => [m[1], m[2]]));
  const last = thing.words.filter((w) => w !== thing.head).at(-1);
  for (const w of thing.words) if (w !== thing.head && (w === last || either.has(w))) out.add(`${w} ${thing.head}`);
  return [...out].slice(0, 12);
}

const slugOf = (s) => clean(s).trim().split(' ').slice(0, 6).join('-') || 'page';
const titleOf = (html) => /<title[^>]*>([^<]{1,80})<\/title>/i.exec(html)?.[1].trim() ?? '';

// The page's look in a few lines: its colour variables (light, then dark), its fonts, its widths and corners.
function lookOf(html) {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n').replace(/<style id="studio-css">[\s\S]*?<\/style>/, '');
  const at = css.search(/prefers-color-scheme\s*:\s*dark/);
  const varsIn = (part) => [...part.matchAll(/(--[\w-]+)\s*:\s*([^;}{]{1,40})/g)].map((m) => `${m[1]}: ${m[2].trim()}`);
  const light = varsIn(at < 0 ? css : css.slice(0, at));
  const dark = at < 0 ? [] : varsIn(css.slice(at));
  const fonts = [...new Set([...css.matchAll(/font-family\s*:\s*([^;}{]{1,90})/g)].map((m) => m[1].trim()))].slice(0, 2);
  const widths = [...new Set([...css.matchAll(/max-width\s*:\s*([^;}{]{1,30})/g)].map((m) => m[1].trim()))].slice(0, 4);
  const radii = [...new Set([...css.matchAll(/border-radius\s*:\s*([^;}{]{1,30})/g)].map((m) => m[1].trim()))].slice(0, 4);
  return [
    light.length ? `- Colours: ${light.slice(0, 14).join('; ')}` : '',
    dark.length ? `- Dark mode: ${dark.slice(0, 14).join('; ')}` : '',
    fonts.length ? `- Type: ${fonts.join(' · ')}` : '',
    widths.length ? `- Widths: ${widths.join(', ')}` : '',
    radii.length ? `- Corners: ${radii.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

// The body as an outline of its tags and classes, three levels deep, at most `max` lines.
function skeletonOf(html, max = 34) {
  const body = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '<svg></svg>').replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  let depth = 0;
  for (const m of body.matchAll(/<(\/)?([a-z][\w-]*)([^>]*)>/gi)) {
    const [, close, tag, attrs] = m;
    const empty = /^(br|hr|img|input|meta|link|source|wbr)$/i.test(tag) || attrs.trim().endsWith('/');
    if (close) { depth = Math.max(0, depth - 1); continue; }
    if (depth <= 3 && !/^(span|b|i|em|strong|small|path|br|wbr)$/i.test(tag)) {
      const cls = /class="([^"]{1,60})"/.exec(attrs)?.[1].trim().split(/\s+/).slice(0, 3).join('.');
      const id = /id="([^"]{1,30})"/.exec(attrs)?.[1];
      out.push(`${'  '.repeat(depth)}${tag.toLowerCase()}${id ? `#${id}` : ''}${cls ? `.${cls}` : ''}`);
    }
    if (!empty) depth++;
    if (out.length >= max) break;
  }
  return out.join('\n');
}

// The card a kept page becomes (≤ CARD_CHARS), named by the thing asked for.
export function pickCard({ html, request, page, thing = askedThing(request), day = new Date().toLocaleDateString('en-CA') }) {
  const name = thing ? thing.phrase.replace(/^./, (c) => c.toUpperCase()) : titleOf(html) || page.replace(/\.html?$/i, '');
  const words = pickWords(thing);
  const first = String(request).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0].slice(0, 160);
  const look = lookOf(html);
  const skeleton = skeletonOf(html);
  const text = [
    `# ${name}`,
    `- For: ${first}`,
    `- Words: ${(words.length ? words : [name.toLowerCase()]).join(', ')}`,
    `- Page: ${page}`,
    '',
    '## Look',
    look || '- The look of the page beside this card (DESIGN/your picks/' + page + ').',
    '',
    '## Skeleton',
    '```',
    skeleton,
    '```',
    '',
    '## Do',
    `- The user looked at this page and said it looks good (${day}): keep its colours, type, spacing, widths and order of parts.`,
    `- The whole page is DESIGN/your picks/${page}; Read it when this card is not enough.`,
    '- Write the new request\'s own content; never copy this page\'s words.',
  ].join('\n');
  return text.length > CARD_CHARS ? `${text.slice(0, CARD_CHARS - 4).replace(/\n[^\n]*$/, '')}\n\`\`\`` : text;
}

// Keeps a page as one of your picks: its card and a copy of the page in "your picks" (a name already
// there gets -2, -3…). → { card, page } (paths in the folder), or null when there is no design folder.
export function savePick({ abs, request, dir = designDir() }) {
  if (!dir) return null;
  const html = readFileSync(abs, 'utf8');
  const thing = askedThing(request);
  const into = join(dir, 'your picks');
  mkdirSync(into, { recursive: true });
  const base = slugOf(thing?.phrase ?? (titleOf(html) || abs.split(sep).pop().replace(/\.html?$/i, '')));
  let slug = base;
  for (let n = 2; existsSync(join(into, `${slug}.md`)) || existsSync(join(into, `${slug}.html`)); n++) slug = `${base}-${n}`;
  writeFileSync(join(into, `${slug}.html`), html);
  writeFileSync(join(into, `${slug}.md`), `${pickCard({ html, request, page: `${slug}.html`, thing })}\n`);
  return { card: `your picks/${slug}.md`, page: `your picks/${slug}.html` };
}
