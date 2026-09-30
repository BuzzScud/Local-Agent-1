// The Test builder's reading of a prompt (the hub's Test builder):
//   parsePrompts(text)     a pasted list → [{ n, title, prompt }]. A line like "Prompt 1 — Data metric
//                          card" starts a test and the lines under it are its words; with no such
//                          lines, every block between blank lines is one test, named by its first words
//   kindOf(prompt)         page | code | question | writing, from the prompt's own words
//   suggestChecks(prompt)  the checks that fit the prompt, each with the level a new test starts
//                          with it ticked at (`from`: easy = every level; null = listed, not ticked,
//                          with the reason), and `eye`: the parts the prompt names that only a
//                          person can judge
//   startChecks(prompt, kind, level)  the checks a new test of that level starts with
// The levels' rule (the user's pick, 30 Sep 2026): Easy starts with "a page was made" and, where the
// prompt asks for them, valid scripts and nothing from the internet; Medium adds the layout check;
// Hard adds every part the prompt names that can be checked. You can untick any of them.
import { labelOf } from './checks.mjs';

export const RANK = { easy: 0, medium: 1, hard: 2 };

const HEAD = /^\s*(?:prompt|test|task)\s*#?\s*(\d+)\s*[—–:.)-]+\s*(.+?)\s*$/i;

export function parsePrompts(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const out = [];
  let cur = null;
  for (const line of src.split('\n')) {
    const m = HEAD.exec(line);
    if (m) { cur = { n: Number(m[1]), title: m[2], body: [] }; out.push(cur); continue; }
    if (cur) cur.body.push(line);
  }
  if (out.length) return out.map((t) => ({ n: t.n, title: t.title, prompt: t.body.join('\n').trim() })).filter((t) => t.prompt);
  return src.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean)
    .map((b, i) => ({ n: i + 1, title: b.split(/\s+/).slice(0, 5).join(' ').replace(/[.,;:]+$/, ''), prompt: b }));
}

export function kindOf(prompt) {
  const p = String(prompt ?? '');
  if (/\bhtml\b|\.html?\b|\bweb ?page\b|\bwidget\b|\blanding page\b/i.test(p)) return 'page';
  if (/\?\s*$/.test(p.trim()) || /^\s*(what|why|how|where|which|does|is|are|explain)\b/i.test(p)) return 'question';
  if (/\b(readme|summary|write-?up|notes?|changelog|résumé|resume)\b/i.test(p) && !/\b(fix|bug|test|function)\b/i.test(p)) return 'writing';
  return 'code';
}

const sentences = (p) => String(p).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const numOf = (w) => (/^\d+$/.test(w) ? Number(w) : NUM[String(w).toLowerCase()] ?? null);

// The parts a prompt lists ("should show a title, one large number, … and a thin sparkline"): from
// every sentence that lists what the page shows or includes.
export function partsOf(prompt) {
  const out = [];
  for (const s of sentences(prompt)) {
    if (!/\b(?:shows?|includes?|displays?)\b\s+\S+/i.test(s) || !s.includes(',')) continue;
    let list = s.replace(/^.*?\b(?:shows?|includes?|displays?)\b\s+/i, '').replace(/[.!?]\s*$/, '');
    // "play, skip, and like buttons" is one part (three buttons), not three.
    const held = [];
    list = list.replace(/((?:[a-z-]+,\s*)+(?:and\s+)?[a-z-]+)\s+(buttons|actions|chips|tags)\b/i, (all) => { held.push(all); return `\u0000${held.length - 1}`; });
    for (const x of list.split(/,\s*(?:and\s+)?/)) { const part = x.replace(/^and\s+/i, '').replace(/\u0000(\d+)/, (_, i) => held[Number(i)]).trim(); if (part && !out.includes(part)) out.push(part); }
  }
  return out;
}

// The check a part can have without a person looking, or null (then it is judged by eye).
function partCheck(part) {
  const t = part.toLowerCase();
  const named = /^((?:[a-z-]+,\s*)+(?:and\s+)?[a-z-]+)\s+(buttons|actions)\b/.exec(t);
  if (named) return { type: 'count', value: `button>=${named[1].split(/,\s*(?:and\s+)?|\s+and\s+/).filter(Boolean).length}` };
  const counted = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\b[^,]*?\b(buttons|actions|features|list items)\b/.exec(t);
  if (counted) return { type: 'count', value: `${/features|list items/.test(counted[2]) ? 'li' : 'button'}>=${numOf(counted[1])}` };
  if (/\bbutton\b/.test(t)) return { type: 'count', value: 'button>=1' };
  if (/\bpercent(age)?\b/.test(t)) return { type: 'page-has', value: '%' };
  if (/\bsparkline\b|\bprogress bar\b|\bchart\b/.test(t)) return { type: 'drawn', value: '' };
  return null;
}

export function suggestChecks(prompt, kind = kindOf(prompt)) {
  const p = String(prompt ?? '');
  const out = { kind, checks: [], eye: [] };
  const add = (c) => { const x = { value: '', ...c }; if (!out.checks.some((y) => y.type === x.type && y.value === x.value)) out.checks.push({ ...x, label: labelOf(x), key: `${x.type}:${x.value}` }); };
  if (kind === 'page') {
    add({ type: 'page-made', from: 'easy', why: 'every page test starts with it' });
    const js = sentences(p).filter((x) => /javascript|\bscript\b/i.test(x));
    const optional = js.some((x) => /\boptional\b/i.test(x) || /(javascript|script)\s+(only\s+)?if\b/i.test(x) || /\bany\b[^.]{0,30}\bscript\b/i.test(x));
    if (js.length && !optional) add({ type: 'scripts-valid', from: 'easy', why: 'the prompt asks for JavaScript' });
    else add({ type: 'scripts-valid', from: null, why: js.length ? 'not ticked: the prompt makes JavaScript optional, and this check fails a page with no script' : 'not ticked: the prompt does not ask for a script' });
    const alone = /\bno (?:external|extra|other) (?:libraries|assets|files)\b|\bno frameworks\b|\boffline\b|\blocally\b|\bno build\b|\bno audio file\b|\bby itself\b|\bself-contained\b/i.test(p);
    const cdn = /\bCDNs?\b/i.test(p);
    if (alone && !cdn) add({ type: 'offline', from: 'easy', why: 'the prompt says it must work on its own' });
    else add({ type: 'offline', from: null, why: cdn ? 'not ticked: the prompt allows fonts from a CDN' : 'not ticked: the prompt does not say so' });
    add({ type: 'layout', from: 'medium', why: /\bphone\b|\bmobile\b/i.test(p) ? 'the prompt names a phone: no sideways scroll, no overlap, readable text, desktop and phone' : 'no sideways scroll, no overlap, readable text, on a desktop and a phone' });
    for (const part of partsOf(p)) { const c = partCheck(part); if (c) add({ ...c, from: 'hard', why: `the prompt names “${part}”` }); else out.eye.push(part); }
  } else if (kind === 'code') {
    add({ type: 'tests', from: 'easy', why: 'a code change is judged by the project’s tests' });
    add({ type: 'only-named', from: 'medium', why: 'only the files the prompt names may change' });
  } else if (kind === 'question') {
    add({ type: 'no-change', from: 'easy', why: 'a question changes nothing' });
    add({ type: 'answer-has', from: null, why: 'not ticked: type the words a right answer must have' });
  } else {
    add({ type: 'saved', from: null, why: 'not ticked: type where it should be saved' });
    add({ type: 'only-named', from: 'easy', why: 'a piece of writing changes no other file' });
  }
  return out;
}

// The checks a new test starts with at a level (no level yet: Easy's).
export function startChecks(prompt, kind = kindOf(prompt), level = null) {
  const at = RANK[level] ?? 0;
  return suggestChecks(prompt, kind).checks.filter((c) => c.from && RANK[c.from] <= at).map((c) => ({ type: c.type, value: c.value }));
}
