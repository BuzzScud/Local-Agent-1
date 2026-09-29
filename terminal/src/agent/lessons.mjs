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
import { complete } from '../flows/llm.mjs';
import { digest } from './memory.mjs';
import { memoryDirs, dirFor, readFacts, applyChanges, tidy, readState, writeState, namesMissingFile, KINDS } from './facts.mjs';

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
  if (l.recalled?.length) lines.push(`  it used from memory: ${l.recalled.map((f) => `"${one(f.text, 80)}"`).join(', ')}`);
  if (l.corrected) lines.push(`  then the user CORRECTED it: "${one(l.corrected)}"`);
  return lines.join('\n');
}

// request: the user asked for the save ("update memory", "remember that …").
// review: a whole conversation read again, slowly (the review at night).
export function savePrompt({ lessons, conversation, saved, today, seeding = false, request = null, review = false }) {
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
  if (l.recalled?.length) return true;
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
export function practiceWork(l, cwd = '.') {
  return [cwd, ...(l.files ?? []).map((f) => resolve(cwd, String(f)))].some((p) => PRACTICE.test(String(p)));
}

// Is there anything to learn from? A turn that ended with a result, a
// correction, or the user saying how they want things.
export function worthSaving(lessons) {
  return lessons.some((l) => !l.saved && !l.known && !l.practice && (['passed', 'failed', 'stuck', 'stopped'].includes(l.outcome) || l.corrected || l.files?.length || SAYS_HOW.test(l.request)));
}

// The save itself. Answers what was added, replaced and dropped, in both
// memories; never throws for what the model wrote, only when it was stopped.
//   lessons   the turns since the last save (agent.lessons, not yet saved)
//   messages  the conversation (for the digest)
export async function saveLessons({ url, model, slot, cwd, home = homedir(), lessons, messages = [], signal, today = new Date().toISOString().slice(0, 10), embedder = null, seeding = false, why = 'save', request = null, review = false, confirm = null }) {
  // The review reads every turn again, saved or not; repeats are refused below.
  const unsaved = review ? lessons : lessons.filter((l) => !l.saved);
  const practice = (l) => l.practice || practiceWork(l, cwd);
  const fresh = unsaved.filter((l) => !practice(l));
  // Only practice turns and nobody asked: nothing is read, nothing saved.
  if (!seeding && !request && unsaved.length && !fresh.length) return { added: [], replaced: [], retired: [], refused: [], secs: 0, tokens: 0 };
  const dirs = memoryDirs(cwd, home);
  const saved = [...readFacts(dirs.you), ...readFacts(dirs.project)];
  const p = savePrompt({ lessons: fresh, conversation: seeding ? String(messages[0]?.content ?? '') : digest(messages, 6000), saved, today, seeding, request, review });
  const r = await complete({ url, model, slot, signal, temperature: 0, maxTokens: 600, schema: SAVE_SCHEMA, system: p.system, user: p.user });
  if (signal?.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
  const out = { added: [], replaced: [], retired: [], refused: [], secs: r.secs, tokens: r.tokens };
  const answer = r.json ?? { add: [], drop: [] };
  const batch = `${why}-${Date.now()}`;
  const from = (a) => { const l = fresh[(a.turn ?? 0) - 1]; return seeding ? 'what was done here before' : l ? fromTask(l.request) : 'the conversation'; };
  // Checked against what the turns show: a "worked" needs a turn that
  // passed, a "failed" one that failed, a recipe a job done before.
  const allowed = (a) => {
    const l = fresh[(a.turn ?? 0) - 1];
    const any = (test) => (l ? test(l) : fresh.some(test));
    if (!KINDS.includes(a.kind)) return 'not a kind of fact';
    // A file the fact names has to be there: the model can make a path up.
    if (dirs.project && namesMissingFile({ kind: a.kind, text: `${a.text} ${(a.steps ?? []).join(' ')}` }, dirname(dirname(dirs.project)))) return 'names a file that is not in the project';
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
    if (no) { out.refused.push({ text: one(a.text, 80), why: no }); continue; }
    adds.push({ ...a, from: from(a) });
  }
  // The same fact in other words is a repeat too, when the small model can tell.
  if (embedder && adds.length && saved.length) {
    try {
      const v = await embedder.embed([...adds.map((a) => a.text), ...saved.map((f) => f.text)], { signal });
      const dot = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * y[i]; return s; };
      for (let i = adds.length - 1; i >= 0; i--) {
        if (adds[i].replaces) continue;
        const twin = saved.find((f, k) => dot(v[i], v[adds.length + k]) >= 0.9);
        if (twin) { out.refused.push({ text: one(adds[i].text, 80), why: `saved already, in other words: ${one(twin.text, 60)}` }); adds.splice(i, 1); }
      }
    } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; }
  }
  // Asked first (the user's pick, 28 Sep 2026): what would change is shown and
  // nothing is written without a yes. 'later' leaves the turns for the next pause.
  if (confirm) {
    const byId = new Map(saved.map((f) => [f.id, f]));
    const drops = (answer.drop ?? []).filter((d) => byId.has(d.id)).map((d) => ({ id: d.id, text: byId.get(d.id).text, why: one(d.why, 120) }));
    if (adds.length || drops.length) {
      const ok = await confirm({ add: adds.map((a) => ({ kind: a.kind, text: a.text })), drop: drops });
      if (signal?.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
      if (ok === 'later') return { ...out, later: true };
      if (!ok) { for (const l of fresh) l.saved = true; return { ...out, skipped: adds.length + drops.length }; }
    }
  }
  for (const dir of [dirs.you, dirs.project].filter(Boolean)) {
    const mine = (a) => dirFor(dirs, a.kind) === dir;
    const here = new Set(readFacts(dir).map((f) => f.id));
    const replace = adds.filter((a) => mine(a) && a.replaces && here.has(a.replaces)).map((a) => ({ id: a.replaces, by: a }));
    const add = adds.filter((a) => mine(a) && !(a.replaces && here.has(a.replaces)));
    const retire = (answer.drop ?? []).filter((d) => here.has(d.id)).map((d) => ({ id: d.id, reason: one(d.why, 120) || 'a turn showed it to be wrong' }));
    if (!add.length && !replace.length && !retire.length) continue;
    const res = applyChanges(dir, { add, replace, retire }, { batch, today, why });
    out.added.push(...res.added.map((f) => ({ ...f, dir })));
    out.replaced.push(...res.replaced.map((x) => ({ ...x, dir })));
    out.retired.push(...res.retired.map((f) => ({ ...f, dir })));
    out.refused.push(...res.refused);
  }
  for (const l of fresh) l.saved = true;
  // Once a day the memory is tidied: repeats, facts about files that are
  // gone, facts not used in a long time.
  out.tidied = tidyDue(dirs, today);
  return out;
}

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
