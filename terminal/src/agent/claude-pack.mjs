// The pack of Claude's notes (3 Oct 2026, the owner's picks): one folder made from every place Claude
// Code keeps notes (this Mac's own, and a copy taken on another Mac), laid out as a ladder (ladder.mjs),
// the same shape as a project's code map:
//   MAP.md            level 0: one line per topic
//   <topic>.md        level 1: every note of the topic, one line each (files under 2,000 tokens)
//   notes/            level 2: the notes. notes/MEMORY.md is their titled list; claude-notes.mjs reads
//                     this folder, so a note's piece comes along with a request as before
//   history/          level 3: the whole of each long note, whose notes/ copy keeps how it stands now
//   reference/        Claude Code's own tools, for a question about Claude Code; never matched
//   pack.json         what it was built from and when, and the index the app shows a part of
// A note of a project is named <project>--<note> and says which project it is about. A note about
// signing in, a server of yours or a secret is left out whole, and a line holding a secret is left
// out of the others (claude-notes.mjs leftOut, holdsSecret), so nothing in the pack needs hiding.
// Claude's own memory folders and the copy are only read. `bun run pack` builds it; nothing rebuilds
// it by itself (packState says when the notes are newer, for /memory).
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, renameSync, rmSync, realpathSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { HOME } from '../../../models/index.mjs';
import { parseNote, leftOut, holdsSecret, foldersOf } from './claude-notes.mjs';
import { wordsOf } from './recall.mjs';
import { splitPart, PART_CHARS, MAP_FILE } from './ladder.mjs';

const PACK_NAME = 'claude-pack';
const TOPIC_INTRO = 'One line per note: its name, then what it is about. Open a note with Read NOTES/notes/<name>.md. A note can be out of date: the files of the project you are in are right.';
// A topic's files, with only the notes allow lets through (all of them without allow).
const topicFiles = (index, t, allow = null) => splitPart(t.slug, t.title, TOPIC_INTRO, t.ids.filter((i) => !allow || allow(i)).map((i) => index.notes[i]?.line ?? `- ${i}`));
export const packDir = (home = HOME) => join(home, PACK_NAME);
export const NOTE_CHARS = PART_CHARS; // a note longer than this is split: how it stands now + history/
const LINE_DESC = 150; // of a note's summary on its topic's line
const OWN_TOPIC = 10; // a project with this many notes or more is a topic of its own

// A project's name from the folder Claude Code named its memory after ("-Users-x-Desktop-MAIN2026"),
// or from a copy's folder ("Desktop-NEURAL-ENGINE-2"): the last folder, without a GitHub download's
// "-main" and a trailing "-".
export function projectName(slug, homeSlug = '') {
  let s = String(slug);
  if (homeSlug && s.startsWith(homeSlug)) s = s.slice(homeSlug.length);
  s = s.replace(/^-+/, '').replace(/^(Desktop|Downloads|Documents)-/, '');
  if (s.includes('--')) s = s.slice(s.lastIndexOf('--') + 2);
  s = s.replace(/-+$/, '').replace(/-(main|master)(-\d+)?$/i, '');
  return s || null;
}
const projectSlug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Whether a folder (a path) is a project's: one of its folder names is the project's, or starts with
// it ("MAIN2026-main-2" is MAIN2026's).
export function sameProject(project, cwd, home = homedir()) {
  const p = projectSlug(project);
  if (p.length < 3) return false;
  return foldersOf(cwd, home).some((f) => { const g = projectSlug(f); return g === p || g.startsWith(`${p}-`); });
}

const mdFiles = (dir) => { try { return readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'MEMORY.md').sort(); } catch { return []; } };
const real = (d) => { try { return realpathSync(d); } catch { return d; } };

// Where the notes are. live: Claude Code's memory folders on this Mac (~/.claude, ~/.claude-2,
// ~/.claude-3, which may share one folder). copies: folders copied from another Mac, each the
// "Claude memory …" folder (or its originals/) and the "Claude skills and tools …" folder.
// → { memory: [{ dir, project, from }], skills: [{ dir, from }], toolsFile, copies }
export function findSources({ home = homedir(), copies = [] } = {}) {
  const memory = [];
  const skills = [];
  let toolsFile = null;
  const seen = new Set();
  for (const c of copies) {
    const base = existsSync(join(c, 'originals')) ? join(c, 'originals') : c;
    if (existsSync(join(base, '1 home memory'))) {
      memory.push({ dir: join(base, '1 home memory'), project: null, from: 'copy' });
      if (existsSync(join(base, '2 MAIN2026 memory'))) memory.push({ dir: join(base, '2 MAIN2026 memory'), project: 'MAIN2026', from: 'copy' });
      const projects = join(base, '3 project memories');
      for (const d of (existsSync(projects) ? readdirSync(projects) : []).sort()) {
        if (statSync(join(projects, d)).isDirectory() && mdFiles(join(projects, d)).length) memory.push({ dir: join(projects, d), project: projectName(d), from: 'copy' });
      }
    }
    if (existsSync(join(base, '1 your own')) || existsSync(join(base, '2 synced from claude.ai'))) skills.push({ dir: base, from: 'copy' });
    const all = join(c, 'ALL-SKILLS-AND-TOOLS.md');
    if (existsSync(all)) toolsFile = all;
  }
  const homeSlug = home.replace(/[/.]/g, '-');
  for (const b of ['.claude', '.claude-2', '.claude-3']) {
    const projects = join(home, b, 'projects');
    let names = [];
    try { names = readdirSync(projects).sort(); } catch { continue; }
    for (const n of names) {
      const dir = join(projects, n, 'memory');
      if (!mdFiles(dir).length || seen.has(real(dir))) continue;
      seen.add(real(dir));
      memory.push({ dir, project: n === homeSlug ? null : projectName(n, homeSlug), from: 'live' });
    }
    if (existsSync(join(home, b, 'skills'))) skills.push({ dir: join(home, b, 'skills'), from: 'live' });
  }
  return { memory, skills, toolsFile, copies };
}

// A source's MEMORY.md: the title each note is listed under and the heading it sits below. The
// heading level with the most headings is the one that groups (# in the home list, ## in MAIN2026's).
export function listOf(dir) {
  let raw = '';
  try { raw = readFileSync(join(dir, 'MEMORY.md'), 'utf8'); } catch { return { titles: new Map(), sections: [] }; }
  const levels = new Map();
  for (const m of raw.matchAll(/^(#{1,3})\s+\S/gm)) levels.set(m[1].length, (levels.get(m[1].length) ?? 0) + 1);
  const level = [...levels].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  const titles = new Map();
  const sections = [];
  let cur = null;
  for (const line of raw.split('\n')) {
    const h = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (h && h[1].length === level) { cur = { heading: h[2].replace(/\s*\(START HERE[^)]*\)/gi, '').trim(), ids: [] }; sections.push(cur); continue; }
    for (const m of line.matchAll(/\[([^\]\n]{2,200})\]\(([\w.-]+)\.md\)/g)) {
      if (!titles.has(m[2])) titles.set(m[2], m[1].replace(/\s+/g, ' ').trim());
      if (cur && !cur.ids.includes(m[2])) cur.ids.push(m[2]);
    }
  }
  return { titles, sections: sections.filter((s) => s.ids.length) };
}

// The dates a piece of a note names: 2026-09-14, 14 Sep (2026), Sep 14.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?';
export function datesIn(text, year = 2026) {
  const out = [];
  const t = String(text);
  for (const m of t.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) out.push(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? ${MON}(?:,? (20\\d\\d))?\\b`, 'gi'))) out.push(Date.UTC(m[3] ? +m[3] : year, MONTHS[m[2].toLowerCase().slice(0, 3)] - 1, +m[1]));
  for (const m of t.matchAll(new RegExp(`\\b${MON} (\\d{1,2})(?:st|nd|rd|th)?(?:,? (20\\d\\d))?\\b`, 'gi'))) out.push(Date.UTC(m[3] ? +m[3] : year, MONTHS[m[1].toLowerCase().slice(0, 3)] - 1, +m[2]));
  return out.filter((d) => Number.isFinite(d));
}

// A note's body in blocks: a heading or a paragraph that opens in bold starts one, the paragraphs and
// lists after it belong to it. The first block is the note's opening.
function blocksOf(body) {
  const paras = String(body).split(/\n\s*\n/).map((p) => p.replace(/\s+$/, '')).filter((p) => p.trim());
  const blocks = [];
  for (const p of paras) {
    const starts = /^(#{1,4}\s|\*\*[^*\n]{2,}\*\*|__[^_\n]{2,}__)/.test(p.trimStart());
    if (!blocks.length || starts) blocks.push([p]);
    else blocks.at(-1).push(p);
  }
  return blocks.map((b, i) => ({ i, text: b.join('\n\n') }));
}
const leadOf = (text) => String(text).trimStart().split('\n')[0].replace(/^#+\s*/, '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
const cutLines = (text, room) => {
  if (text.length <= room) return text;
  let out = '';
  for (const l of text.split('\n')) { if (out.length + l.length + 1 > room - 2) break; out += `${out ? '\n' : ''}${l}`; }
  return out ? `${out}\n…` : `${text.slice(0, room - 1)}…`;
};

// A long note as it stands now (the owner's pick: made by the builder): its opening, its Why and How to
// apply, then its newest parts by the dates they name, in the note's own order, up to room; a closing
// line names the parts left out and where the whole note is. null: the note is short enough as it is.
export function nowPart(note, { id, room = NOTE_CHARS, year } = {}) {
  const full = note.body;
  if (full.length <= room) return null;
  const y = year ?? (Number(/^(20\d\d)/.exec(note.modified ?? '')?.[1]) || 2026);
  const blocks = blocksOf(full).map((b) => {
    const lead = b.text.slice(0, 260);
    const near = datesIn(lead, y);
    const any = near.length ? near : datesIn(b.text, y);
    return { ...b, lead: leadOf(b.text), date: any.length ? Math.max(...any) : null, rule: /^\s*(\*\*|__)?(why|how to apply)\b/i.test(b.text) };
  });
  const pointer = (left) => `\n\n(How it stands now, made from the newest parts of a longer note. The whole note, with its history: NOTES/history/${id}.md.${left.length ? ` Left out here: ${cutLines(left.map((b) => b.lead.slice(0, 60)).join(' · '), 700)}` : ''})`;
  let budget = room - 900; // room left for the closing line (at most 860 characters)
  const take = new Set();
  const put = (b, max) => { const t = cutLines(b.text, Math.min(max, budget)); if (t.length < 80 && b.text.length > 80) return; take.add(b.i); b.out = t; budget -= t.length + 2; };
  put(blocks[0], 1600);
  for (const b of blocks.slice(1)) if (b.rule && budget > 400) put(b, 1200);
  const rest = blocks.slice(1).filter((b) => !take.has(b.i)).sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity) || b.i - a.i);
  for (const b of rest) {
    if (budget < 300) break;
    if (b.text.length + 2 <= budget) put(b, b.text.length);
    else if (!b.date || b.date >= (rest[0].date ?? 0) - 86400000 * 3) put(b, budget); // one of the newest, cut at a line
  }
  const left = blocks.filter((b) => !take.has(b.i));
  const body = blocks.filter((b) => take.has(b.i)).map((b) => b.out).join('\n\n');
  return { body: `${body}${pointer(left)}`, kept: take.size, of: blocks.length };
}

// The head of a note in the pack: name, summary, kind and, for a project's note, its project.
const q = (s) => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
const headOf = (n) => `---\nname: ${n.id}\ndescription: ${q(n.description)}\nmetadata:\n  type: ${n.type}\n${n.project ? `project: ${q(n.project)}\n` : ''}${n.modified ? `modified: ${n.modified}\n` : ''}---\n\n`;

// Words for comparing a note with a topic.
const wordsFor = (n) => new Set(wordsOf(`${n.id.replace(/-/g, ' ')} ${n.title ?? ''} ${n.description}`));

// Skills: a card per skill (what it is for, when, its main steps) from its SKILL.md; the built-in ones
// and Claude Code's tools from the copy's ALL-SKILLS-AND-TOOLS.md (parts 3 and 4).
function skillMdFiles(dir) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 5) return;
    let list = [];
    try { list = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.isDirectory() && !/^(plugin|5 plugin|marketplaces)/i.test(e.name)) walk(join(d, e.name), depth + 1);
      else if (e.name === 'SKILL.md') out.push(join(d, e.name));
    }
  };
  walk(dir, 0);
  return out;
}
function skillCard(raw, file) {
  const n = parseNote(raw, file);
  const name = (n.name && n.name !== 'SKILL' ? n.name : basename(dirname(file))).replace(/[^\w-]+/g, '-');
  const steps = [...n.body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].trim()).filter((h) => !/^(overview|contents?|table of contents)$/i.test(h)).slice(0, 12);
  const desc = n.description.replace(/\s+/g, ' ').trim();
  const when = /(use (this|it) (when|whenever|for)|triggers?(?: on)?:|when the user)[^.]*\./i.exec(desc)?.[0] ?? '';
  return { name, description: desc, text: `What it is for: ${desc.slice(0, 600)}${when && !desc.slice(0, 600).includes(when) ? `\nWhen to use it: ${when}` : ''}${steps.length ? `\nIts main steps (its own headings): ${steps.join(' · ')}` : ''}\n\nA skill of Claude Code's, not one of yours: Agentic Coder has its own skills, listed in your instructions.` };
}
function partsOfAll(text) {
  const part = (n) => { const a = text.indexOf(`\n# Part ${n} `); if (a < 0) return ''; const b = text.indexOf('\n# Part ', a + 10); return text.slice(a, b < 0 ? undefined : b); };
  // An entry's own sub-headings ("### GOOD - Use EnterPlanMode:") stay in its text.
  const entries = (p) => {
    const out = [];
    for (const m of p.matchAll(/^### (.+)\n([\s\S]*?)(?=^### |^## |(?![\s\S]))/gm)) {
      const name = m[1].trim();
      const body = m[2].replace(/^> Note added for this copy:.*$/gm, '').trim();
      if (out.length && (/:$/.test(name) || /^(GOOD|BAD)\b/.test(name))) out.at(-1).body += `\n\n${name}\n${body}`;
      else out.push({ name: name.replace(/\s*·\s*/g, '-').replace(/[^\w-]+/g, '-'), body });
    }
    return out;
  };
  return { builtIn: entries(part(3)), tools: entries(part(4)) };
}

// Builds the pack into out (by default ~/.agentic-coder/claude-pack, through a folder beside it that
// takes its place at the end, so a reader never sees half a pack). → the counts.
export function buildPack({ home = homedir(), copies = [], out = packDir(), now = new Date() } = {}) {
  const src = findSources({ home, copies });
  const notes = new Map(); // id → note
  const skipped = { leftOut: [] };
  const lists = []; // { scope, sections, titles, ids }
  const scopeOf = (s) => s.project ?? '';
  for (const s of src.memory) {
    const list = listOf(s.dir);
    const prefix = s.project ? `${projectSlug(s.project)}--` : '';
    const own = new Set(mdFiles(s.dir).map((f) => basename(f, '.md')));
    lists.push({ scope: scopeOf(s), sections: list.sections.map((x) => ({ heading: x.heading, ids: x.ids.filter((i) => own.has(i)).map((i) => prefix + i) })), from: s.from });
    for (const f of mdFiles(s.dir)) {
      let raw;
      try { raw = readFileSync(join(s.dir, f), 'utf8'); } catch { continue; }
      const n = parseNote(raw, join(s.dir, f));
      const id = prefix + n.id;
      const why = leftOut(n);
      if (why) { skipped.leftOut.push({ id, why }); notes.delete(id); continue; }
      const had = notes.get(id);
      // This Mac's own note wins over the copy's of the same name.
      if (had && had.from === 'live' && s.from === 'copy') continue;
      const title = list.titles.get(n.id) ?? '';
      // A link to a note of the same project carries the project's prefix too.
      const body = n.body.split('\n').filter((l) => !holdsSecret(l)).join('\n')
        .replace(/\[\[([\w.-]+)\]\]/g, (m, x) => (prefix && own.has(x) ? `[[${prefix}${x}]]` : m));
      notes.set(id, { id, name: n.name, description: holdsSecret(n.description) ? '' : n.description, type: n.type, project: s.project ?? '', modified: n.modified, title: holdsSecret(title) ? '' : title, body, from: s.from, scope: scopeOf(s) });
    }
  }
  // Topics: a scope's MEMORY.md headings (the home list, MAIN2026's); a note no heading lists goes to
  // the topic of a listed note that links to it, else to the topic it shares most words with. A project
  // without headings is one topic, or with the other small projects in one.
  const topics = [];
  const topicOf = new Map();
  const scopes = [...new Set([...notes.values()].map((n) => n.scope))];
  for (const scope of scopes) {
    const ids = [...notes.values()].filter((n) => n.scope === scope).map((n) => n.id);
    const sections = [];
    for (const l of lists.filter((x) => x.scope === scope)) for (const sec of l.sections) {
      let t = sections.find((x) => x.heading === sec.heading);
      if (!t) { t = { heading: sec.heading, ids: [] }; sections.push(t); }
      for (const i of sec.ids) if (notes.has(i) && !topicOf.has(i)) { t.ids.push(i); topicOf.set(i, t); }
    }
    const listed = sections.filter((t) => t.ids.length);
    // A project whose list has one heading ("# Memory index") is one topic, named after the project.
    if (listed.length <= 1 && scope) {
      for (const i of ids) topicOf.delete(i);
      const t = { scope, project: scope, heading: scope, ids };
      for (const i of ids) topicOf.set(i, t);
      topics.push(t);
      continue;
    }
    if (!listed.length) {
      const t = { scope, project: scope, heading: scope, ids };
      for (const i of ids) topicOf.set(i, t);
      topics.push(t);
      continue;
    }
    for (const t of listed) { t.scope = scope; t.project = scope; topics.push(t); }
    // A note no heading lists: the topic whose listed notes share its rarest words (its name counts:
    // agentic-coder-…, orbit-…), each topic weighed by its size; with no word shared, the topic of a
    // listed note that links to it.
    const centroid = listed.map((t) => ({ t, words: new Set([...wordsOf(t.heading), ...t.ids.flatMap((i) => [...wordsFor(notes.get(i))])]) }));
    const df = new Map();
    for (const c of centroid) for (const w of c.words) df.set(w, (df.get(w) ?? 0) + 1);
    const linkTo = new Map();
    for (const t of listed) for (const id of t.ids) {
      for (const m of notes.get(id).body.matchAll(/\[\[([\w.-]+)\]\]|\]\(([\w.-]+)\.md\)/g)) {
        const l = m[1] ?? (scope ? `${projectSlug(scope)}--${m[2]}` : m[2]);
        if (!linkTo.has(l)) linkTo.set(l, t);
      }
    }
    for (const id of ids.filter((i) => !topicOf.has(i))) {
      const w = wordsFor(notes.get(id));
      let best = null;
      let bestScore = 0;
      for (const c of centroid) {
        const s = [...w].filter((x) => c.words.has(x)).reduce((a, x) => a + Math.log(1 + centroid.length / df.get(x)), 0) / Math.sqrt(Math.max(1, c.words.size) / 50);
        if (s > bestScore) { best = c; bestScore = s; }
      }
      const t = best?.t ?? linkTo.get(id) ?? listed[0];
      t.ids.push(id);
      topicOf.set(id, t);
    }
  }
  // Small projects without headings share one topic.
  const small = topics.filter((t) => t.scope && t.heading === t.scope && t.ids.length < OWN_TOPIC);
  if (small.length > 1) {
    const other = { scope: '*', project: '*', heading: `Other projects (${small.length} small ones)`, ids: small.flatMap((t) => t.ids), grouped: true };
    for (const t of small) topics.splice(topics.indexOf(t), 1);
    for (const i of other.ids) topicOf.set(i, other);
    topics.push(other);
  }
  // Topic names, files and lines.
  const used = new Set();
  for (const t of topics) {
    const title = t.scope && t.scope !== '*' && t.heading !== t.scope && !t.heading.toLowerCase().includes(t.scope.toLowerCase()) ? `${t.scope} · ${t.heading}` : t.heading;
    t.title = title.replace(/\s+/g, ' ').trim();
    // The slug: the title up to its first bracket, comma or dash ("Equity Orbit (MAIN2026) — …" → equity-orbit).
    const head = t.title.split(/\s*(?:\(|,|—|–|:| - )\s*/)[0];
    let slug = projectSlug(t.scope === '*' ? 'other-projects' : head).slice(0, 40).replace(/-$/, '') || 'notes';
    // Two topics with one name: the second is name--2 (name-2.md is the first one's second file).
    for (let k = 2; used.has(slug); k++) slug = `${slug.replace(/--\d+$/, '')}--${k}`;
    used.add(slug);
    t.slug = slug;
  }
  const lineOf = (n) => `- ${n.id}${n.project ? ` (${n.project})` : ''} — ${(n.title && n.title.length < 90 ? `${n.title}: ` : '')}${n.description.replace(/\s+/g, ' ').slice(0, LINE_DESC)}${n.description.length > LINE_DESC ? '…' : ''}`;
  // Skill cards and Claude Code's tools.
  const cards = new Map();
  for (const s of src.skills) for (const f of skillMdFiles(s.dir)) {
    let raw;
    try { raw = readFileSync(f, 'utf8'); } catch { continue; }
    const c = skillCard(raw, f);
    if (!c.description || (cards.has(c.name) && s.from === 'copy' && cards.get(c.name).from === 'live')) continue;
    cards.set(c.name, { ...c, from: s.from });
  }
  let tools = [];
  if (src.toolsFile) {
    const all = partsOfAll(readFileSync(src.toolsFile, 'utf8'));
    for (const b of all.builtIn) if (!cards.has(b.name)) cards.set(b.name, { name: b.name, description: b.body.replace(/\s+/g, ' ').trim(), text: `What it is for: ${b.body.replace(/\s+/g, ' ').trim().slice(0, 700)}\n\nA skill built into Claude Code (only its summary is known), not one of yours.`, builtIn: true });
    tools = all.tools.filter((t) => /^[\w-]+$/.test(t.name));
  }
  for (const c of cards.values()) {
    const id = `skill--${c.name}`;
    notes.set(id, { id, name: id, description: `Claude Code's ${c.name} skill${c.builtIn ? ' (built in)' : ''}: ${c.description}`.slice(0, 600), type: 'reference', project: '', title: '', body: c.text, scope: 'skills' });
  }
  if (cards.size) topics.push({ scope: 'skills', project: '', title: 'Skills of Claude Code (Claude\'s, not yours)', slug: 'skills', ids: [...cards.keys()].sort().map((n) => `skill--${n}`) });

  // Written to a folder beside the pack, which then takes its place.
  const tmp = `${out}.building-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  for (const d of ['notes', 'history', 'reference/claude-code-tools']) mkdirSync(join(tmp, d), { recursive: true });
  let split = 0;
  const index = { version: 1, built: now.toISOString(), sources: [...src.memory.map((s) => ({ kind: 'memory', dir: s.dir, project: s.project, from: s.from })), ...src.skills.map((s) => ({ kind: 'skills', dir: s.dir, from: s.from })), ...(src.toolsFile ? [{ kind: 'tools', file: src.toolsFile }] : [])], copies, topics: [], notes: {} };
  for (const n of notes.values()) {
    const lead = n.project ? `(A note of Claude's about the ${n.project} project.)\n\n` : '';
    // The whole file, its head included, stays under a part's 2,000 tokens.
    const cut = n.scope === 'skills' ? null : nowPart(n, { id: n.id, room: NOTE_CHARS - headOf(n).length - lead.length - 20 });
    if (cut) {
      split++;
      writeFileSync(join(tmp, 'history', `${n.id}.md`), `${headOf(n)}${n.body}\n`);
    }
    writeFileSync(join(tmp, 'notes', `${n.id}.md`), `${headOf(n)}${lead}${cut ? cut.body : n.body}\n`);
    index.notes[n.id] = { type: n.type, project: n.project || undefined, topic: topicOf.get(n.id)?.slug ?? (n.scope === 'skills' ? 'skills' : undefined), line: lineOf(n), split: Boolean(cut) || undefined };
  }
  // notes/MEMORY.md: the matcher's titled list, grouped by topic.
  const listMd = ['# Claude\'s notes (the pack, built by `bun run pack`)', ''];
  for (const t of topics) {
    listMd.push(`## ${t.title}`);
    for (const i of t.ids) { const n = notes.get(i); listMd.push(`- [${(n.title || n.name || i).replace(/[[\]]/g, '')}](${i}.md)`); }
    listMd.push('');
  }
  writeFileSync(join(tmp, 'notes', 'MEMORY.md'), `${listMd.join('\n')}\n`);
  // The topics, then the map.
  for (const t of topics) {
    const lines = t.grouped
      ? [...new Set(t.ids.map((i) => notes.get(i).project))].flatMap((p) => [`- ${p}:`, ...t.ids.filter((i) => notes.get(i).project === p).map((i) => `  ${lineOf(notes.get(i))}`)])
      : t.ids.map((i) => lineOf(notes.get(i)));
    const files = splitPart(t.slug, t.title, TOPIC_INTRO, lines);
    for (const f of files) writeFileSync(join(tmp, f.file), f.text);
    t.files = files.map((f) => f.file);
    index.topics.push({ slug: t.slug, title: t.title, project: t.project === '*' ? '*' : t.project || undefined, scope: t.scope || 'you', files: t.files, ids: t.ids, grouped: t.grouped || undefined });
  }
  if (tools.length) {
    const lines = tools.map((x) => `- ${x.name} — ${x.body.split('\n').find((l) => l.trim())?.trim().slice(0, 140) ?? ''}`);
    for (const x of tools) writeFileSync(join(tmp, 'reference', 'claude-code-tools', `${x.name}.md`), `# ${x.name} (a tool of Claude Code's, not yours: never call it)\n\n${x.body}\n`);
    const f = splitPart('claude-code-tools', "Claude Code's own tools (Claude's, not yours: never call them)", 'Each is a tool Claude Code has and you do not. Read one only when asked about Claude Code: Read NOTES/reference/claude-code-tools/<name>.md.', lines);
    for (const p of f) writeFileSync(join(tmp, 'reference', p.file), p.text);
    index.tools = { files: f.map((p) => `reference/${p.file}`), count: tools.length };
  }
  writeFileSync(join(tmp, MAP_FILE), mapText(index));
  index.counts = { notes: [...notes.values()].filter((n) => n.scope !== 'skills').length, skills: cards.size, tools: tools.length, split, leftOut: skipped.leftOut.length, topics: topics.length, projects: [...new Set([...notes.values()].map((n) => n.project).filter(Boolean))].length, live: [...notes.values()].filter((n) => n.from === 'live').length, copy: [...notes.values()].filter((n) => n.from === 'copy').length };
  index.leftOut = skipped.leftOut;
  writeFileSync(join(tmp, 'pack.json'), JSON.stringify(index, null, 1));
  // Swap: the old pack out, the new one in.
  const old = `${out}.old-${process.pid}`;
  if (existsSync(out)) renameSync(out, old);
  renameSync(tmp, out);
  rmSync(old, { recursive: true, force: true });
  return { dir: out, ...index.counts, leftOut: skipped.leftOut };
}

// MAP.md: one line per topic (those allow lets through), then the tools. The same text the app shows a
// model on a service, made from pack.json with only the notes it may see (packView).
export function mapText(index, allow = null) {
  const lines = [];
  for (const t of index.topics) {
    const n = allow ? t.ids.filter(allow).length : t.ids.length;
    if (!n) continue;
    const files = allow ? topicFiles(index, t, allow).length : t.files.length;
    lines.push(`- ${t.title}: ${n} ${n === 1 ? 'note' : 'notes'}${files > 1 ? `, in ${files} files` : ''} → ${t.slug}.md`);
  }
  if (index.tools && !allow) lines.push(`- Claude Code's own tools (${index.tools.count}; Claude's, not yours: never call them) → ${index.tools.files[0]}`);
  const about = "Claude Code wrote these notes for itself in earlier conversations with the user. Each line is a topic: Read NOTES/<file> for one line per note, then NOTES/notes/<name>.md for a note. The project's own files win over a note, which can be out of date.";
  return `# Claude's notes · map\n\n${about}\n\n${lines.join('\n')}\n`;
}

// The pack as a model may see it. sent 'all': every note and file. 'project': only the notes about the
// project the model works in (cwd), and the topics that hold them, with only those lines (Memory sent,
// opening.mjs: notes about the user stay on this Mac). 'none' or no pack: null.
export function readIndex(dir = packDir()) {
  try { return JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')); } catch { return null; }
}
export function packView(dir = packDir(), { sent = 'all', cwd = process.cwd(), home = homedir() } = {}) {
  if (sent === 'none') return null;
  const index = readIndex(dir);
  if (!index) return null;
  // As the matcher allows (claude-notes.mjs sentAllows): a note of the project's own memory, or a note of
  // the home memory about a project that names this folder.
  const folders = foldersOf(cwd, home);
  const isHere = (id) => { const n = index.notes[id]; if (!n) return false; if (n.project) return n.project !== '*' && sameProject(n.project, cwd, home); const t = n.line.toLowerCase(); return n.type === 'project' && folders.some((f) => t.includes(f)); };
  const allow = sent === 'all' ? null : isHere;
  return {
    dir, sent, index, allow: allow ?? (() => true),
    map: () => (allow ? (Object.keys(index.notes).some(allow) ? mapText(index, allow) : null) : (() => { try { return readFileSync(join(dir, MAP_FILE), 'utf8'); } catch { return mapText(index); } })()),
    // A file of the pack by its path under NOTES/: MAP.md, <topic>.md, notes/<id>.md, history/<id>.md,
    // reference/…. null: no such file, or not one this model may see.
    file: (rel) => {
      const r = String(rel ?? '').replace(/^\.?\/+/, '').replace(/^NOTES\/?/i, '');
      if (!r || r === MAP_FILE || r === 'MAP') return allow ? (Object.keys(index.notes).some(allow) ? mapText(index, allow) : null) : safeRead(join(dir, MAP_FILE));
      if (r.split('/').includes('..') || !/^[\w./ -]+$/.test(r)) return null;
      const m = /^(notes|history)\/([\w.-]+?)(?:\.md)?$/.exec(r);
      if (m) return !allow || allow(m[2]) ? safeRead(join(dir, m[1], `${m[2]}.md`)) : null;
      if (/^reference\//.test(r)) return allow ? null : safeRead(join(dir, r.endsWith('.md') ? r : `${r}.md`));
      const slug = r.replace(/\.md$/, '');
      const t = index.topics.find((x) => x.files.includes(`${slug}.md`)) ?? index.topics.find((x) => x.slug === slug);
      if (!t) return null;
      if (!allow) return safeRead(join(dir, `${slug}.md`));
      return topicFiles(index, t, allow).find((f) => f.file === `${slug}.md`)?.text ?? null;
    },
  };
}
const safeRead = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };

// For /memory: whether there is a pack, how many notes, when it was built, and whether a note it was
// built from has changed since (then `bun run pack` makes it current).
export function packState(dir = packDir()) {
  const index = readIndex(dir);
  if (!index) return null;
  const built = Date.parse(index.built);
  let newer = 0;
  for (const s of index.sources ?? []) {
    if (s.kind !== 'memory' || s.from !== 'live') continue;
    for (const f of mdFiles(s.dir)) { try { if (statSync(join(s.dir, f)).mtimeMs > built + 1000) newer++; } catch {} }
  }
  return { dir, built: index.built, notes: index.counts?.notes ?? 0, skills: index.counts?.skills ?? 0, split: index.counts?.split ?? 0, topics: index.counts?.topics ?? 0, newer };
}
