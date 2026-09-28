// /rules: what the model reads at the start of every conversation, numbered,
// and short commands to change it (design 1 of the 28 Sep design round,
// agentic-coder DOCS/design rounds/rules-command-2-designs-2026-09-28.html).
//   Always       facts marked "always": read in full at every start
//   Other notes  one line each at the start, the whole fact when a request fits
//   Off          switched off with /rules off: kept in retired/, /rules on brings one back
// The numbers are the order shown, so "/rules off 16" means the 16th line.
import { readFacts, applyChanges, restoreFact, setAlways } from '../agent/facts.mjs';

// A small model follows a short list of rules better than a long one: past
// this many, a new "always" rule asks for one to be switched off first.
export const ALWAYS_MAX = 20;
const OFF = 'switched off with /rules off';
const tokensOf = (text) => Math.round(text.length / 4);

// A note that only says what happened ("Created notes.html on the Desktop…")
// rather than how to work: worth little at the next start.
const DID = /^(?:created|made|wrote|added|fixed|built|ran|updated|deleted|removed|moved|saved|changed|renamed|installed|opened|started|finished|generated|implemented)\b/i;
const HOW = /\b(?:always|never|should|must|use|prefer|avoid|when|before|after|instead|do not|don'?t|make sure|ask)\b/i;
export const looksLikeEvent = (text) => DID.test(String(text).trim()) && !HOW.test(text);

// The list in the order shown, numbered from 1, from the memory about you and
// the one about this project.
export function rulesList(dirs) {
  const folders = [dirs.you, dirs.project].filter(Boolean);
  const live = folders.flatMap((dir) => readFacts(dir));
  const always = live.filter((f) => f.always);
  const other = live.filter((f) => !f.always);
  const off = folders.flatMap((dir) => readFacts(dir, { retired: true })).filter((f) => String(f.retired ?? '').includes(OFF));
  let n = 0;
  const number = (list) => list.map((f) => ({ ...f, n: ++n }));
  const out = { always: number(always), other: number(other), off: number(off) };
  out.all = [...out.always, ...out.other, ...out.off];
  out.tokens = tokensOf(out.always.map((f) => f.text).join('\n'));
  return out;
}

// "/rules off 16" → the 16th line, or why not.
function pick(list, arg) {
  const n = Number(String(arg ?? '').trim());
  if (!Number.isInteger(n) || n < 1) return { error: 'Say which one by its number: /rules off 16' };
  const f = list.all.find((x) => x.n === n);
  return f ? { fact: f } : { error: `There is no ${n}: /rules shows the numbers.` };
}

// One change from "/rules <what> <arg>". Answers { text, tone, changed }.
export function changeRules(dirs, what, arg) {
  const list = rulesList(dirs);
  const full = list.always.length >= ALWAYS_MAX;
  const fullText = `${ALWAYS_MAX} rules already: switch one off first (/rules off <number>).`;
  if (what === 'add') {
    const text = String(arg ?? '').trim();
    if (!text) return { text: 'Say the rule: /rules add Keep answers short.', tone: 'warn' };
    if (full) return { text: fullText, tone: 'warn' };
    const r = applyChanges(dirs.you, { add: [{ kind: 'you', text, always: true, from: 'added with /rules add' }] }, { why: 'rules' });
    if (!r.added.length) return { text: `Not added: ${r.refused[0]?.why ?? 'it could not be saved'}.`, tone: 'warn' };
    return { text: `Added as rule ${list.always.length + 1}: read at every start from your next message.`, changed: true };
  }
  const p = pick(list, arg);
  if (p.error) return { text: p.error, tone: 'warn' };
  const f = p.fact;
  const short = f.text.length > 60 ? `${f.text.slice(0, 59)}…` : f.text;
  const isOff = list.off.some((x) => x.n === f.n);
  if (what === 'on') {
    if (!isOff) return { text: `${f.n} is on already.`, tone: 'dim' };
    if (f.always && full) return { text: fullText, tone: 'warn' };
    restoreFact(f.dir, f.id);
    return { text: `${f.n} is back on: "${short}"`, changed: true };
  }
  if (isOff) return { text: `${f.n} is off. /rules on ${f.n} brings it back first.`, tone: 'warn' };
  if (what === 'off' || what === 'remove') {
    const reason = what === 'off' ? OFF : 'removed with /rules remove';
    applyChanges(f.dir, { retire: [{ id: f.id, reason }] }, { why: 'rules' });
    return { text: what === 'off' ? `${f.n} is off: "${short}" · /rules on brings it back` : `${f.n} is removed: "${short}" · /memory undo takes that back`, changed: true };
  }
  if (what === 'always') {
    if (f.always) { setAlways(f.dir, f.id, false); return { text: `${f.n} moved to Other notes: read only when a request fits it.`, changed: true }; }
    if (full) return { text: fullText, tone: 'warn' };
    setAlways(f.dir, f.id, true);
    return { text: `${f.n} is now a rule: read at every start.`, changed: true };
  }
  return { text: `No /rules ${what}: add, off, on, remove, always or open.`, tone: 'warn' };
}
