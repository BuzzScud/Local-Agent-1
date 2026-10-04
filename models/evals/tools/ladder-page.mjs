// The results page of the maps and notes check (ladder-check.mjs): the same questions before and after
// the code maps (docs/map/) and the pack of Claude's notes, side by side. It names the owner's own
// notes and questions, so it is a private page: docs/private/tests/, never committed. Its line in the
// test record names it, so the Tests tab opens it.
//   ladderPage(beforeDir, afterDir, { record }) → { file, summary }
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DOCS_DIR } from '../../../docs/tools/to-docs.mjs';
import { recordTest } from '../record.mjs';
import { buildCheckPage, sec } from './check-page.mjs';
import { notesFile } from './ladder-check.mjs';

// The rows as saved, judged again with today's made-up rule (ladder-check.mjs notesFile: a file of
// Claude's notes is not a made-up project file), and the summary's where-counts from them.
function read(dir) {
  const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  const rows = JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')).map((r) => {
    if (r.part !== 'where') return r;
    const wrong = (r.wrong ?? []).filter((p) => !notesFile(p) && !/^\.?\d*\.md$/.test(p.split('/').pop()));
    return { ...r, wrong, right: r.hit && !wrong.length };
  });
  for (const c of Object.keys(s.where ?? {})) {
    const list = rows.filter((r) => r.part === 'where' && r.config === c);
    s.where[c] = { ...s.where[c], right: list.filter((r) => r.right).length, wrong: list.reduce((n, r) => n + r.wrong.length, 0) };
  }
  return { s, rows };
}
// An answer with traces of another conversation on the shared service (3 Oct 2026: the label requests'
// JSON, an unrelated test's "Hi there friend", the other project's paths): counted, and left out of the
// second score, on both sides alike.
const OTHER = { 'agentic-coder': /backend\/api|desks\/|src\/features|wahlay|projectx/i, MAIN2026: /terminal\/src|models\/(runtime|evals)|claude-notes\.mjs/i };
// Or the answer's opening is about another question of the set: it shares more of the rarer words of
// another question than of its own (13 to 17 answered 12, 3 Oct 2026, qwen3-coder:30b).
const STOPS = new Set('where is the are and that for with which what does how its it in of to a an on by from this my me i do code file files project'.split(' '));
const wordsIn = (t) => new Set(String(t).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)?.filter((w) => !STOPS.has(w)) ?? []);
export function answersAnother(r, questions) {
  const head = wordsIn(String(r.answer ?? '').slice(0, 260));
  if (!head.size) return false;
  const df = new Map();
  for (const q of questions) for (const w of wordsIn(q)) df.set(w, (df.get(w) ?? 0) + 1);
  const score = (q) => [...wordsIn(q)].filter((w) => head.has(w)).reduce((s, w) => s + 1 / df.get(w), 0);
  const own = score(r.q);
  return questions.some((q) => q !== r.q && score(q) > own + 0.5);
}
export function leaked(r, project, questions = []) {
  const text = `${(r.did ?? []).slice(1).join(' ')} ${r.answer ?? ''}`;
  return (String(r.answer ?? '').trimStart().startsWith('{') && /"folder"/.test(r.answer)) || /Hi there friend|Say hi in 3 words/i.test(text) || Boolean(project && OTHER[project]?.test(text)) || (questions.length > 0 && answersAnother(r, questions));
}
const keyOf = (r) => `${r.part}-${r.config ?? r.sent}-${r.id}`;
const PART = { reach: 'Notes', where: 'Where is it?', notes: 'MAIN2026 notes', privacy: 'Privacy' };
const HOW = { all: 'as on this Mac', project: 'as a service gets them', remote: 'remote instructions', local: 'local instructions' };
const pad = (n) => String(n).padStart(2, '0');

// The rule, written before the after run (3 Oct 2026): after holds as many on each set as before, names
// no more made-up files, sends no note about the user to a service, and reaches at least as many notes.
export function verdictOf(b, a) {
  const where = Object.keys(a.where).every((c) => (a.where[c]?.right ?? 0) >= (b.where?.[c]?.right ?? 0));
  const wrong = Object.keys(a.where).every((c) => (a.where[c]?.wrong ?? 0) <= (b.where?.[c]?.wrong ?? 0));
  const privacy = a.privacy.of === 0 || a.privacy.right === a.privacy.of;
  const reach = a.reach.all.right >= b.reach.all.right && a.reach.userToService === 0;
  return { pass: where && wrong && privacy && reach, where, wrong, privacy, reach };
}

export async function ladderPage(beforeDir, afterDir, { record = true, docs = DOCS_DIR } = {}) {
  const B = read(beforeDir);
  const A = read(afterDir);
  // Which project each "where" question is in (the set: w1–w10 agentic-coder, w11–w20 MAIN2026).
  const projectOf = (r) => (r.part === 'where' ? (Number(r.id.slice(1)) <= 10 ? 'agentic-coder' : 'MAIN2026') : null);
  const questions = [...new Set([...A.rows, ...B.rows].filter((r) => r.part !== 'reach').map((r) => r.q))];
  for (const side of [A, B]) for (const r of side.rows) r.leak = r.part !== 'reach' && leaked(r, projectOf(r), questions);
  const clean = (side, c) => { const l = side.rows.filter((r) => r.part === 'where' && r.config === c); const both = l.filter((r) => !r.leak && !(side === A ? B : A).rows.find((x) => keyOf(x) === keyOf(r))?.leak); return { right: both.filter((r) => r.right).length, of: both.length }; };
  const before = new Map(B.rows.map((r) => [keyOf(r), r]));
  const rows = A.rows.map((r) => ({
    id: keyOf(r), ok: r.right, secs: r.secs ?? null,
    name: `${PART[r.part]} · ${HOW[r.config ?? r.sent]} · ${r.id} · ${r.q}`,
    detail: r.part === 'reach'
      ? `brought: ${r.notes.join(', ') || 'nothing'}${before.get(keyOf(r)) ? ` · before: ${before.get(keyOf(r)).notes.join(', ') || 'nothing'}` : ''}`
      : `${r.leak ? '⚠ traces of another conversation on the service · ' : ''}${r.steps} steps${r.wrong?.length ? ` · made-up files: ${r.wrong.join(', ')}` : ''}${r.notes?.length ? ` · notes: ${r.notes.join(', ')}` : ''} · ${String(r.answer ?? '').replace(/\s+/g, ' ').slice(0, 300)}`,
  }));
  const prevRows = B.rows.map((r) => ({ id: keyOf(r), ok: r.right, secs: r.secs ?? null }));
  const v = verdictOf(B.s, A.s);
  const of = (x) => `${x.right} of ${x.of}`;
  const now = new Date(A.s.when);
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const passed = rows.filter((r) => r.ok).length;
  const summary = { name: A.s.model, of: rows.length, checks: rows.length, passed, pass: v.pass, stopped: A.s.stopped, sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${A.s.code ?? ''} · ${A.s.model} on the service` };
  const cfgs = Object.keys(A.s.where);
  const cards = [
    { k: "Questions about your work: the note that comes holds the answer", v: of(A.s.reach.all), sub: `before: ${of(B.s.reach.all)} (this Mac's notes only)`, dir: 'higher is better' },
    { k: 'Notes about you sent to a service', v: String(A.s.reach.userToService + A.rows.filter((r) => r.part !== 'reach').reduce((n, r) => n + (r.userNotes?.length ?? 0), 0)), sub: `before: ${B.s.reach.userToService + B.rows.filter((r) => r.part !== 'reach').reduce((n, r) => n + (r.userNotes?.length ?? 0), 0)}`, dir: 'lower is better' },
    ...cfgs.map((c) => ({ k: `Where is it? (${HOW[c]})`, v: of(A.s.where[c]), sub: `before: ${of(B.s.where[c] ?? { right: 0, of: 0 })} · ${sec(A.s.where[c].secs)} vs ${sec(B.s.where[c]?.secs ?? null)} · made-up files ${A.s.where[c].wrong} vs ${B.s.where[c]?.wrong ?? 0}`, dir: 'higher is better' })),
    ...cfgs.map((c) => ({ k: `Where is it? (${HOW[c]}), questions with no trace of another conversation on either side`, v: of(clean(A, c)), sub: `before: ${of(clean(B, c))}`, dir: 'higher is better' })),
    { k: 'Answers with traces of another conversation', v: String(A.rows.filter((r) => r.leak).length), sub: `before: ${B.rows.filter((r) => r.leak).length} (the shared service mixes conversations)`, dir: 'lower is better' },
    { k: 'MAIN2026 questions, asked inside MAIN2026', v: of(A.s.notes), sub: `before: ${of(B.s.notes)}`, dir: 'higher is better' },
  ];
  const html = buildCheckPage({
    title: 'Maps and notes check · before and after the code maps and the pack', summary, rows, prev: { s: B.s, rows: prevRows },
    passRule: 'after ≥ before on each set, no more made-up files, no note about you to a service',
    verdict: `${v.pass ? 'Yes' : 'No'}: where-is-it ${cfgs.map((c) => `${of(A.s.where[c])} (${HOW[c]}; before ${of(B.s.where[c] ?? { right: 0, of: 0 })})`).join(', ')}; the right note for ${of(A.s.reach.all)} of your questions (before ${of(B.s.reach.all)}); ${A.s.privacy.of ? `${of(A.s.privacy)} privacy questions kept your notes on this Mac` : 'privacy not asked'}.`,
    first: false, cards,
    how: [
      `Before: the app at ${B.s.code ?? '?'} (no docs/map, Claude's notes from this Mac's memory folder only). After: ${A.s.code ?? '?'} with docs/map in both repos and the pack in ~/.agentic-coder/claude-pack. Same questions, same model (${A.s.model}${A.s.ctx ? `, ${Math.round(A.s.ctx / 1024)}k context` : ''}).`,
      'Notes: the matcher alone, no model; right when a note that comes along holds the fact the answer needs. "As a service gets them" follows Memory sent: only notes about the project worked in.',
      'Where is it?: 10 questions in agentic-coder and 10 in MAIN2026, asked in the repo; right when the answer names the file of the answer key and no file it names is made up. Remote instructions: Who decides from the big model\'s limits (Model); local instructions: the app decides, as a model on this Mac runs.',
      'MAIN2026 notes: the questions whose notes are MAIN2026\'s, asked inside MAIN2026 on the service. Privacy: three questions about you asked on the service from an empty folder; right when no note about you went along.',
      'The service is shared and mixes conversations: an answer can carry another conversation\'s words (a label request\'s JSON, an unrelated test\'s "Hi there friend", the other project\'s paths). Those answers are marked ⚠ and counted; a second score leaves out every question touched by one on either side.',
      `Raw results, on this Mac: ${relative(DOCS_DIR, beforeDir)} and ${relative(DOCS_DIR, afterDir)} (paths from docs/).`,
    ],
  });
  const page = `private/tests/agentic-coder-maps-and-notes-check-${stamp}.html`;
  if (existsSync(docs)) {
    mkdirSync(join(docs, 'private', 'tests'), { recursive: true });
    writeFileSync(join(docs, page), html);
    console.log(`results page: docs/${page}`);
  }
  if (record) recordTest({
    kind: 'other', name: 'Maps and notes check', model: A.s.local ? A.s.model : `remote:${A.s.model}`, ctx: A.s.ctx ?? null, passed, total: rows.length, secs: A.s.secs, part: Boolean(A.s.stopped),
    result: A.s.stopped ? 'stopped' : v.pass ? 'pass' : 'fail', bar: 'after ≥ before on each set, no more made-up files, no note about you to a service',
    note: `notes ${of(A.s.reach.all)} (before ${of(B.s.reach.all)}); ${cfgs.map((c) => `where ${c} ${of(A.s.where[c])} (before ${of(B.s.where[c] ?? { right: 0, of: 0 })})`).join('; ')}; MAIN2026 notes ${of(A.s.notes)} (before ${of(B.s.notes)}); privacy ${of(A.s.privacy)}`,
    raw: afterDir, page,
  });
  return { file: page, summary, verdict: v };
}
