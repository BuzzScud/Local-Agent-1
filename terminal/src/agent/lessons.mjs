// Saving on its own: after a task and when the window closes, what is worth
// keeping goes into the memory (facts.mjs) without being asked. The model
// reads what happened in each turn (the agent writes that down itself: what
// was asked, which files changed, whether the check passed, the tries, where
// it got stuck, what you corrected) and the conversation, and answers with
// at most five facts. It runs on the side slot, so the conversation's own
// reading is left alone, and it steps aside the moment you send a message.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { testPrompts } from '../../../models/index.mjs';
import { complete } from '../flows/llm.mjs';
import { digest } from './memory.mjs';
import { memoryDirs, dirFor, readFacts, applyChanges, tidy, readState, writeState, namesMissingFile, fileNames, countDay, KINDS } from './facts.mjs';
import { closest, factVectors } from './recall.mjs';

export const MAX_FACTS = 5;

export const SAVE_SCHEMA = {
  type: 'object',
  properties: {
    add: { type: 'array', maxItems: MAX_FACTS, items: { type: 'object', properties: {
      kind: { type: 'string', enum: KINDS },
      text: { type: 'string' },
      turn: { type: 'integer' },
      steps: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      replaces: { type: 'string' },
    }, required: ['kind', 'text'] } },
    drop: { type: 'array', maxItems: 4, items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] } },
  },
  required: ['add', 'drop'],
};

const one = (s, n = 200) => String(s ?? '').replace(/\n\n\(From your memory,[\s\S]*\)\s*$/, '').replace(/\s+/g, ' ').trim().slice(0, n);

// One turn, as the model reads it.
export function lessonText(l, i) {
  const how = { passed: 'the check passed', failed: 'the check FAILED', stuck: 'Agentic Coder got STUCK', stopped: 'the user STOPPED Agentic Coder', declined: 'the user said no', done: 'finished, nothing to check' }[l.outcome] ?? l.outcome;
  const lines = [`Turn ${i + 1} (${l.kind ?? 'other'}): "${one(l.request, 300)}" → ${how}`];
  if (l.files?.length) lines.push(`  changed: ${l.files.join(', ')}`);
  if (l.check) lines.push(`  check: ${l.check.cmd} → ${l.check.ok ? 'passed' : 'failed'}`);
  for (const t of l.tries ?? []) lines.push(`  tries: ${t.label} ${t.marks} (${t.summary})`);
  for (const f of l.findings ?? []) lines.push(`  it found: ${one(f)}`);
  for (const w of l.warnings ?? []) lines.push(`  trouble: ${one(w)}`);
  if (l.summary) lines.push(`  result: ${one(l.summary, 300)}`);
  const used = l.used ?? l.recalled;
  if (used?.length) lines.push(`  it used from memory: ${used.map((f) => `"${one(f.text, 80)}"`).join(', ')}`);
  if (l.corrected) lines.push(`  then the user CORRECTED it: "${one(l.corrected)}"`);
  return lines.join('\n');
}

// request: the user asked for the save ("update memory", "remember that …").
// review: a whole conversation read again, slowly (the review at night).
export function savePrompt({ lessons, conversation, saved, today, seeding = false, request = null, review = false, declined = [] }) {
  const jobs = saved.filter((f) => f.kind === 'worked' || f.kind === 'recipe');
  return {
    system: [
      'You keep Agentic Coder\'s memory: short facts that will help in later conversations. Agentic Coder is a coding assistant; "the user" is the person it works for.',
      `Save at most ${MAX_FACTS} facts, and only what will still be true and useful next week. Most turns teach nothing new: then answer with empty lists.`,
      'The kinds:',
      '- you: how the user likes to work, what they asked Agentic Coder to do or not to do, corrections they gave. Only from what the user said.',
      '- project: where things are in this project, commands that work, how it is built and tested. Only what a turn showed to be so.',
      '- worked: what made a check pass, in one sentence, with the file. Only from a turn whose check passed.',
      '- failed: an approach that did not work, so it is not tried again. Only from a failed check or failed tries.',
      '- mistake: what Agentic Coder did wrong (got stuck, repeated itself, was stopped or corrected) and what to do instead next time.',
      '- recipe: the steps of a job, in order, in "steps". Only when this kind of job passed now AND is in "Jobs done before": it was done twice.',
      'Rules: one fact is one plain sentence of at most 30 words, with the file or the command it is about. No code, no secrets, no passwords, nothing only true today. Never save what is already in "Saved already", in the same or in other words. "turn" is the number of the turn the fact comes from.',
      'A saved fact that a turn showed to be wrong or out of date: put a better one in "add" with "replaces" set to its id, or put its id in "drop" with why.',
      `Today is ${today}. Answer as JSON: {"add": [...], "drop": [...]}.`,
    ].join('\n'),
    user: [
      `Saved already:\n${saved.length ? saved.map((f) => `- [${f.id}] (${f.kind}) ${one(f.text, 160)}`).join('\n') : '(nothing yet)'}`,
      `Jobs done before:\n${jobs.length ? jobs.map((f) => `- ${one(f.text, 160)}`).join('\n') : '(none)'}`,
      `${seeding ? 'What was done here before Agentic Coder had a memory' : review ? 'A conversation of today, read again; the quick saves after each task may have missed something' : 'What happened'}:\n${lessons.length ? lessons.map(lessonText).join('\n') : '(no task, only talk)'}`,
      `The conversation:\n${conversation || '(none)'}`,
      ...(declined.length ? [`The user said no to saving these; never offer them again, in any words:\n${declined.slice(-15).map((t) => `- ${one(t, 160)}`).join('\n')}`] : []),
      ...(request ? [`The user now says: ${one(request, 400)}\nIf they say what to remember, save exactly that (kind "you" when it is about how they like to work, "project" when it is about this project).`] : []),
    ].join('\n\n'),
  };
}

// The user says how they want things done, in general. An instruction about
// this one task is not that: "Don't change any files" at the end of a
// question started a save every time the question was asked (27 Sep).
const IN_GENERAL = /\b(always|never|from now on|next time|every time|in future|i (like|prefer|hate)|remember (that|to)|stop (doing|asking|using))\b/i;
const A_HABIT = /\b(don'?t|do not|please (don'?t|stop)|make sure)\b/i;
const THIS_TASK = /\b(don'?t|do not|without|no)\s+(chang|edit|touch|modif|delet|remov|renam|commit|push|run|add|creat)\w*\b|\bno (code )?changes?\b|\bchange nothing\b|\bmake sure (it|this|that|the|all|every)\b/i;
export const saysHow = (text) => { const t = String(text ?? ''); return IN_GENERAL.test(t) || (A_HABIT.test(t) && !THIS_TASK.test(t)); };
const SAYS_HOW = { test: saysHow };

// Where a fact says it came from.
export const fromTask = (request) => `the task "${one(request, 70)}"`;

// A turn that taught nothing new: it went well (passed its check, or ended
// with nothing to check), nothing went wrong on the way, and the memory
// already held what it is about: a saved fact was used for it, or a fact
// was saved from this same request before. A save for it would cost the
// model a quarter of a minute to answer "nothing to add".
export function knownAlready(l, { cwd, home = homedir() } = {}) {
  if (!['passed', 'done'].includes(l.outcome) || l.corrected || l.warnings?.length) return false;
  if ((l.tries ?? []).some((t) => t.failed || /✗/.test(t.marks))) return false;
  if (SAYS_HOW.test(l.request)) return false;
  if ((l.used ?? l.recalled)?.length) return true;
  const dirs = memoryDirs(cwd, home);
  const from = fromTask(l.request);
  return [...readFacts(dirs.project), ...readFacts(dirs.you)].some((f) => f.from === from);
}

// The tests' own starter files and answers (a Battle set's tests and the
// bench's tasks, under models/evals/) are practice, not your work: a turn that
// changed one, or ran inside one, is never saved. Pasting a Battle prompt into
// the app is a way to watch a test, and what it "learns" would be about the
// test (and would sit in your memory as if it were about you).
const PRACTICE = /(^|\/)models\/evals\/(battle\/[^/]+|bench\/tasks)\/[^/]+\/(project|solution|reference)(\/|$)/;
// A test's prompt pasted into the app is practice too, wherever it ran: of
// the first three saves (28–29 Sep 2026) two came from test prompts (an HTML
// card, w01), in the home folder, with no test file in sight. prompts: every
// test prompt this Mac knows (testPrompts, models part).
export function practiceWork(l, cwd = '.', { prompts = null } = {}) {
  if ([cwd, ...(l.files ?? []).map((f) => resolve(cwd, String(f)))].some((p) => PRACTICE.test(String(p)))) return true;
  try { return isTestPrompt(l.request, prompts ?? testPrompts()); } catch { return false; }
}

// Runs of five words in a row. A request is a test's prompt when most of
// the runs of the shorter of the two are in the other: a header pasted
// above it ("w01 · …"), a cut at 600 characters or a word changed here and
// there still match; a short request ("run the tests") never does.
const RUN = 5;
const MIN_WORDS = 12;
const SAME = 0.6;
const runsOf = (text, max = 120) => {
  const w = String(text ?? '').toLowerCase().match(/[a-z0-9]+/g)?.slice(0, max) ?? [];
  const out = new Set();
  for (let i = 0; i + RUN <= w.length; i++) out.add(w.slice(i, i + RUN).join(' '));
  return { words: w.length, runs: out };
};
let known = { list: null, runs: [] };
export function isTestPrompt(request, prompts = []) {
  const r = runsOf(request);
  if (r.words < MIN_WORDS || !prompts.length) return false;
  if (known.list !== prompts) known = { list: prompts, runs: prompts.map((p) => runsOf(p)) };
  return known.runs.some((t) => {
    if (t.runs.size < 4) return false;
    let shared = 0;
    for (const x of t.runs) if (r.runs.has(x)) shared++;
    return shared / Math.min(t.runs.size, r.runs.size) >= SAME;
  });
}

// Is there anything to learn from? A turn that ended with a result, a
// correction, or the user saying how they want things.
// again: the review at quit, which reads saved turns again too.
export function worthSaving(lessons, { again = false } = {}) {
  return lessons.some((l) => (again || !l.saved) && !l.known && !l.practice && (['passed', 'failed', 'stuck', 'stopped'].includes(l.outcome) || l.corrected || l.files?.length || SAYS_HOW.test(l.request)));
}

// The save itself: what the model would change is worked out (proposeSave),
// asked about when asking is on, then written (applySave). Answers what was
// added, replaced and dropped, in both memories; never throws for what the
// model wrote, only when it was stopped.
//   lessons   the turns since the last save (agent.lessons, not yet saved)
//   messages  the conversation (for the digest)
//   declined  facts you said no to in this conversation: never offered again
// A declined save answers declined: the texts said no to, for the next one.
export async function saveLessons({ url, model, slot, cwd, home = homedir(), lessons, messages = [], signal, today = new Date().toISOString().slice(0, 10), embedder = null, seeding = false, why = 'save', request = null, review = false, confirm = null, declined = [] }) {
  const p = await proposeSave({ url, model, slot, cwd, home, lessons, messages, signal, today, embedder, seeding, request, review, declined });
  const out = { added: [], replaced: [], retired: [], refused: p.refused, secs: p.secs, tokens: p.tokens };
  if (p.none) return out;
  // Asked first (the user's pick, 28 Sep 2026): what would change is shown and
  // nothing is written without a yes. 'later' leaves the turns for the next pause.
  if (confirm && (p.adds.length || p.drops.length)) {
    const ok = await confirm(shownOf(p));
    if (signal?.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
    if (ok !== 'later') countDay(memoryDirs(cwd, home), { asked: 1, yes: ok ? 1 : 0, no: ok ? 0 : 1 }, today);
    if (ok === 'later') return { ...out, later: true };
    if (!ok) {
      for (const l of p.fresh) l.saved = true;
      rememberDeclined(memoryDirs(cwd, home), p.adds.map((a) => a.text));
      return { ...out, skipped: p.adds.length + p.drops.length, declined: p.adds.map((a) => a.text) };
    }
  }
  const done = applySave({ cwd, home, adds: p.adds, drops: p.drops }, { today, why });
  for (const l of p.fresh) l.saved = true;
  return { ...done, refused: [...p.refused, ...done.refused], secs: p.secs, tokens: p.tokens };
}

// What a proposal would change, as the Save / Skip panel lists it.
export const shownOf = (p) => ({ add: p.adds.map((a) => ({ kind: a.kind, text: a.text })), drop: p.drops.map((d) => ({ id: d.id, text: d.text, why: d.why })) });

// The facts at most shown to the model as "Saved already" (the closest to
// what happened); the check for repeats below still looks at all of them.
export const SAVE_SEEN = 15;

// What the model would save, checked, and nothing written.
// Answers { none } when there was nothing to read, else { fresh (the turns
// read), adds, drops, refused, secs, tokens }.
export async function proposeSave({ url, model, slot, cwd, home = homedir(), lessons, messages = [], signal, today = new Date().toISOString().slice(0, 10), embedder = null, seeding = false, request = null, review = false, declined = [] }) {
  // The review reads every turn again, saved or not; repeats are refused below.
  const unsaved = review ? lessons : lessons.filter((l) => !l.saved);
  const practice = (l) => l.practice || practiceWork(l, cwd);
  const fresh = unsaved.filter((l) => !practice(l));
  const nothing = { none: true, fresh, adds: [], drops: [], refused: [], secs: 0, tokens: 0 };
  // Only practice turns and nobody asked: nothing is read, nothing saved.
  if (!seeding && !request && unsaved.length && !fresh.length) return nothing;
  const dirs = memoryDirs(cwd, home);
  // What you ask to save now is saved, even a fact you once skipped.
  declined = request ? [] : [...new Set([...declined, ...declinedBefore(dirs)])];
  const saved = [...readFacts(dirs.you), ...readFacts(dirs.project)];
  const conversation = seeding ? String(messages[0]?.content ?? '') : digest(messages, 6000);
  const about = [request ?? '', ...fresh.map((l, i) => lessonText(l, i)), conversation.slice(-2000)].join('\n');
  const seen = await closest(saved, about, { embedder, n: SAVE_SEEN, signal });
  const p = savePrompt({ lessons: fresh, conversation, saved: seen, today, seeding, request, review, declined });
  const r = await complete({ url, model, slot, signal, temperature: 0, maxTokens: 600, schema: SAVE_SCHEMA, system: p.system, user: p.user });
  if (signal?.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
  const refused = [];
  const answer = r.json ?? { add: [], drop: [] };
  const from = (a) => { const l = fresh[(a.turn ?? 0) - 1]; return seeding ? 'what was done here before' : l ? fromTask(l.request) : 'the conversation'; };
  const root = dirs.project ? dirname(dirname(dirs.project)) : null;
  const names = root ? fileNames(root) : null;
  // Checked against what the turns show: a "worked" needs a turn that
  // passed, a "failed" one that failed, a recipe a job done before.
  const allowed = (a) => {
    const l = fresh[(a.turn ?? 0) - 1];
    const any = (test) => (l ? test(l) : fresh.some(test));
    if (!KINDS.includes(a.kind)) return 'not a kind of fact';
    // A file the fact names has to be there: the model can make a path up.
    if (root && namesMissingFile({ kind: a.kind, text: `${a.text} ${(a.steps ?? []).join(' ')}` }, root, names)) return 'names a file that is not in the project';
    if (declined.some((t) => normText(t) === normText(a.text))) return 'you said no to it before';
    // Checked here too, not only when written: a proposal kept for the next
    // start (the review at quit) must not ask about what is saved already.
    if (!a.replaces && saved.some((f) => normText(f.text) === normText(a.text))) return 'saved already';
    if (seeding) return null;
    if (a.kind === 'worked' && !any((x) => x.outcome === 'passed')) return 'no check passed in these turns';
    if (a.kind === 'failed' && !any((x) => x.outcome === 'failed' || x.outcome === 'stuck' || x.tries?.some((t) => t.failed || /✗/.test(t.marks)))) return 'nothing failed in these turns';
    if (a.kind === 'recipe' && !(any((x) => x.outcome === 'passed') && saved.some((f) => f.kind === 'worked' || f.kind === 'recipe'))) return 'this job was not done twice yet';
    if (a.kind === 'recipe' && (a.steps ?? []).filter((s) => String(s).trim()).length < 2) return 'a recipe needs its steps';
    return null;
  };
  const adds = [];
  for (const a of (answer.add ?? []).slice(0, MAX_FACTS)) {
    const no = allowed(a);
    if (no) { refused.push({ text: one(a.text, 80), why: no }); continue; }
    adds.push({ ...a, from: from(a) });
  }
  // The same fact in other words is a repeat too, when the small model can
  // tell: of a saved fact (its numbers are kept, only the new ones are
  // worked out) or of one you said no to.
  if (embedder && adds.length && (saved.length || declined.length)) {
    try {
      const vec = saved.length ? await factVectors(saved, embedder, signal) : new Map();
      const recent = declined.slice(-30);
      const v = await embedder.embed([...adds.map((a) => a.text), ...recent], { signal });
      const no = recent.map((t, k) => ({ text: t, v: v[adds.length + k] }));
      for (let i = adds.length - 1; i >= 0; i--) {
        if (adds[i].replaces) continue;
        const twin = saved.find((f) => vec.has(`${f.dir}\0${f.id}`) && dotOf(v[i], vec.get(`${f.dir}\0${f.id}`)) >= 0.9);
        const said = !twin && no.find((d) => dotOf(v[i], d.v) >= 0.9);
        if (twin) refused.push({ text: one(adds[i].text, 80), why: `saved already, in other words: ${one(twin.text, 60)}` });
        else if (said) refused.push({ text: one(adds[i].text, 80), why: 'you said no to it before, in other words' });
        if (twin || said) adds.splice(i, 1);
      }
    } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; }
  }
  const byId = new Map(saved.map((f) => [f.id, f]));
  const drops = (answer.drop ?? []).filter((d) => byId.has(d.id)).map((d) => ({ id: d.id, text: byId.get(d.id).text, why: one(d.why, 120) }));
  return { fresh, adds, drops, refused, secs: r.secs, tokens: r.tokens };
}

// Writes a proposal into both memories (one batch in each log), then tidies
// once a day. A proposal kept since the window closed is written the same
// way: the folders are found again from cwd.
export function applySave({ cwd, home = homedir(), adds = [], drops = [] }, { today = new Date().toISOString().slice(0, 10), why = 'save' } = {}) {
  const dirs = memoryDirs(cwd, home);
  const out = { added: [], replaced: [], retired: [], refused: [] };
  const batch = `${why}-${Date.now()}`;
  for (const dir of [dirs.you, dirs.project].filter(Boolean)) {
    const mine = (a) => dirFor(dirs, a.kind) === dir;
    const here = new Set(readFacts(dir).map((f) => f.id));
    const replace = adds.filter((a) => mine(a) && a.replaces && here.has(a.replaces)).map((a) => ({ id: a.replaces, by: a }));
    const add = adds.filter((a) => mine(a) && !(a.replaces && here.has(a.replaces)));
    const retire = drops.filter((d) => here.has(d.id)).map((d) => ({ id: d.id, reason: d.why || 'a turn showed it to be wrong' }));
    if (!add.length && !replace.length && !retire.length) continue;
    const res = applyChanges(dir, { add, replace, retire }, { batch, today, why });
    out.added.push(...res.added.map((f) => ({ ...f, dir })));
    out.replaced.push(...res.replaced.map((x) => ({ ...x, dir })));
    out.retired.push(...res.retired.map((f) => ({ ...f, dir })));
    out.refused.push(...res.refused);
  }
  // Once a day the memory is tidied: repeats, facts about files that are
  // gone, facts not used in a long time.
  out.tidied = tidyDue(dirs, today);
  return out;
}

// What you said no to, kept in your memory's state.json (the last 100), so
// a fact skipped once is not offered again by a later save or the review.
const DECLINED_KEEP = 100;
export const declinedBefore = (dirs) => { try { return readState(dirs.you).declined ?? []; } catch { return []; } };
export function rememberDeclined(dirs, texts = []) {
  const add = texts.map((t) => String(t).trim()).filter(Boolean);
  if (!add.length) return;
  try { writeState(dirs.you, { declined: [...new Set([...declinedBefore(dirs), ...add])].slice(-DECLINED_KEEP) }); } catch { /* not kept: asked again next time */ }
}

const normText = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const dotOf = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * y[i]; return s; };

export function tidyDue(dirs, today) {
  const did = [];
  for (const dir of [dirs.you, dirs.project].filter(Boolean)) {
    if (!existsSync(dir) || readState(dir).tidied === today) continue;
    const t = tidy(dir, { today, root: dir === dirs.project ? dirname(dirname(dir)) : null });
    writeState(dir, { tidied: today });
    if (t.merged.length || t.retired.length) did.push({ dir, ...t });
  }
  return did;
}

// One line for the screen.
export function saveLine(out) {
  const n = (k, word) => (out[k].length ? `${out[k].length} ${word}` : '');
  const parts = [n('added', 'saved'), n('replaced', 'replaced'), n('retired', 'retired')].filter(Boolean);
  if (!parts.length) return '';
  const first = out.added[0] ?? out.replaced[0]?.fact;
  return `Memory: ${parts.join(', ')}${first ? ` · "${one(first.text, 70)}${first.text.length > 70 ? '…' : ''}"` : ''} · /memory shows it, /memory undo takes it back`;
}

// First use in a project: what is already written becomes the first facts.
// The notes file is carried over by openMemory (facts.mjs); here, the
// conversations Agentic Coder had in this folder before it had a memory, and the
// test record's runs on this project, are read once and put to the model
// like turns that just happened. AGENTS.md is read whole at every start
// already, so only what it holds beyond that limit is read here.
export function writtenBefore(cwd, { sessionsDir, record = [], agentsLimit = 6000, max = 12 } = {}) {
  const turns = [];
  const texts = [];
  if (sessionsDir && existsSync(sessionsDir)) {
    const files = readdirSync(sessionsDir).filter((f) => f.endsWith('.json')).sort().slice(-5);
    for (const f of files) {
      let s;
      try { s = JSON.parse(readFileSync(join(sessionsDir, f), 'utf8')); } catch { continue; }
      const said = (s.messages ?? []).filter((m) => m.role === 'user' && typeof m.content === 'string' && !m.content.startsWith('['));
      for (const m of said.slice(-4)) turns.push({ request: m.content, kind: null, outcome: 'done', reason: 'done', files: [], tries: [], findings: [], warnings: [], recalled: [] });
      texts.push(digest(s.messages ?? [], 1500));
    }
  }
  for (const r of record.slice(0, 6)) turns.push({ request: `${r.name}${r.note ? ` (${r.note})` : ''}`, kind: 'test run', outcome: r.result === 'pass' ? 'passed' : 'failed', reason: 'done', files: [], check: { cmd: r.name, ok: r.result === 'pass' }, tries: [], findings: [], warnings: [], recalled: [], summary: `${r.passed ?? '?'} of ${r.total ?? '?'} passed` });
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const p = join(cwd, name);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    if (text.length > agentsLimit) texts.push(`From ${name}, the part that is not read at every start:\n${text.slice(agentsLimit, agentsLimit + 3000)}`);
    break;
  }
  return { turns: turns.slice(-max), text: texts.filter(Boolean).join('\n\n').slice(0, 6000) };
}

export async function seedMemory({ url, model, slot, cwd, home = homedir(), sessionsDir, record, signal, today, embedder, confirm = null }) {
  const dirs = memoryDirs(cwd, home);
  const dir = dirs.project ?? dirs.you;
  if (readState(dir).seeded) return null;
  const w = writtenBefore(cwd, { sessionsDir, record });
  if (!w.turns.length && !w.text) { writeState(dir, { seeded: today ?? new Date().toISOString().slice(0, 10) }); return { added: [], nothing: true }; }
  const out = await saveLessons({ url, model, slot, cwd, home, lessons: w.turns, messages: [{ role: 'user', content: w.text }], signal, today, embedder, seeding: true, why: 'seed', confirm });
  if (out?.later) return out; // not answered yet: asked again at the next pause
  writeState(dir, { seeded: today ?? new Date().toISOString().slice(0, 10) });
  return out;
}
