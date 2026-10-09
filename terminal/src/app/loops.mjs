// Loops (/loop, 3 Oct 2026, the owner's ask): a message Agentic Coder sends again by itself, every
// so often or until its job is done. Their picks:
//   - a loop belongs to the window it was made in and stops when that window closes;
//   - each run is a fresh conversation, told how the last run ended;
//   - a run that would ask is paused ("needs you") and the other loops go on;
//   - runs work right in the folder; they wait while the model is off (nothing loads by itself);
//   - a loop ends when a run says its job is done, or after 24 hours ($5 on a paid service);
//   - a debugging run keeps a half-fix when fewer tests fail and none fails newly (agent.mjs).
// The window keeps the loops (Loops below) and starts `coding -p --loop-events` for each run
// (startRun, loop-run.mjs). What it knows is written to <home>/loops/<pid>/ for the board
// (`coding loops`, loops-board.mjs), which sends its keys back as small files in cmd/.
import { mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync, rmSync, appendFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { HOME } from '../../../models/index.mjs';
import { selfCommand } from './sessions.mjs';
import { libraryOf, saveLoop, removeLoop, trustLoop } from './loop-files.mjs';

export const KINDS = ['debug', 'test', 'web', 'task'];
const UNIT = { s: 1, m: 60, h: 3600, d: 86_400 };
// The shortest gap between two runs of a loop (a test sets AGENTIC_LOOP_MIN_SECS).
const minSecs = (env = process.env) => Math.max(1, Number(env.AGENTIC_LOOP_MIN_SECS) || 60);
export const SELF_SECS = 600; // no time given: ten minutes, unless a run says NEXT RUN IN <n> MIN
const RETRY_SECS = 15; // a debugging loop tries again this long after a miss
const MAX_HOURS = 24;
const MAX_USD = 5;
export const PRESET = {
  debug: 'Some tests in this folder fail. Find why and fix the code until every test passes.',
  test: 'Run the tests. Say which fail and why. This is only a question: change no file.',
};
export const guessKind = (message) => (/\b(fix|debug|bug|bugs|broken)\b/i.test(message) ? 'debug'
  : /https?:\/\/|\b(web|page|pages|site|sites|url|release|releases|browse|news|blog)\b|\b[a-z0-9-]+\.(com|org|net|io|sh|dev|ai|app|co)\b/i.test(message) ? 'web'
  : /\b(test|tests|check|lint|build)\b/i.test(message) ? 'test' : 'task');
const PRESET_NAME = { debug: 'Fix the failing tests', test: 'Run the tests' };
const nameOf = (message) => { const t = String(message).replace(/\s+/g, ' ').trim().split(/[.:!?](?:\s|$)/)[0]; return t.length > 28 ? `${t.slice(0, 27)}…` : t; };
export const everyWord = (secs) => (!secs ? '' : secs % 86_400 === 0 ? `${secs / 86_400}d` : secs % 3600 === 0 ? `${secs / 3600}h` : secs % 60 === 0 ? `${secs / 60}m` : `${secs}s`);

// A time as people write it: 10m, 10 min, 10 minutes, 1.5h, 2 hours, 30 seconds, every hour.
const UNIT_WORD = String.raw`(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)`;
const LEAD_TIME = new RegExp(String.raw`^(?:every\s+)?(?:(\d+(?:\.\d+)?)\s*${UNIT_WORD}|(?:an?\s+)?(second|minute|hour|day))\b[,:]?\s*`, 'i');
const TAIL_TIME = new RegExp(String.raw`[\s,]+every\s+(?:(\d+(?:\.\d+)?)\s*${UNIT_WORD}|(?:an?\s+)?(second|minute|hour|day))\s*[.!]?$`, 'i');
const secsOf = (m) => Math.round(Number(m[1] ?? 1) * UNIT[(m[2] ?? m[3])[0].toLowerCase()]);

// What follows /loop: [debug|test|web] [10m] [message] [every 10 minutes]. The time comes first or
// last ("every …"), in short or long words. A kind alone uses its ready-made message; a debugging
// loop with no time runs until its tests pass; any other loop with no time paces itself.
export function parseLoop(text, { min = minSecs() } = {}) {
  let rest = String(text ?? '').trim();
  let kind = null;
  let m = /^(debug|tests?|web)\b\s*/i.exec(rest);
  if (m) { kind = m[1].toLowerCase().replace(/^tests$/, 'test'); rest = rest.slice(m[0].length); }
  let every = null;
  m = LEAD_TIME.exec(rest) ?? TAIL_TIME.exec(rest);
  if (m) { every = secsOf(m); rest = `${rest.slice(0, m.index)}${rest.slice(m.index + m[0].length)}`; }
  let message = rest.trim();
  let name = null;
  if (!message) {
    if (kind && PRESET[kind]) { message = PRESET[kind]; name = PRESET_NAME[kind]; }
    else return { error: kind === 'web' ? 'A web loop needs to know what to look at: /loop web 30m read the Bun release page and tell me when there is a new version' : 'A loop needs a message: /loop 10m check the tests and say what fails' };
  }
  kind ??= guessKind(message);
  let note = '';
  if (every !== null && every < min) { note = ` (the shortest gap is ${everyWord(min)})`; every = min; }
  return { kind, every, until: kind === 'debug' && every === null, message, name: name ?? nameOf(message), note };
}

// A task the rules cannot read well, asked about before the loop starts (4 Oct 2026, the owner's
// pick after "/loop test5m" made a loop whose whole task was the word "test5m"): a kind and a time
// typed together, or a single word. No model is asked. Answers null, or { why, options } for the
// board's setup: use (the kind and time it looks like), keep (the words as they are), again.
const GLUED = /^(tests?|debug|fix|web)(\d+(?:\.\d+)?)(s|m|h|mins?|hrs?)$/i;
export function unclearOf(text) {
  const t = String(text ?? '').trim();
  if (isLoopCommand(t)) return null; // "/loop 2 every 7m" changes a loop that is there
  const g = GLUED.exec(t);
  if (g) {
    const kind = /^t/i.test(g[1]) ? 'test' : /^web$/i.test(g[1]) ? 'web' : 'debug';
    const secs = Math.round(Number(g[2]) * UNIT[g[3][0].toLowerCase()]);
    const what = { test: 'Run the tests', debug: 'Fix the failing tests', web: 'Read a web page' }[kind];
    return { why: `"${t}" looks like two things typed together: "${g[1]}" and "${g[2]}${g[3]}".`, options: [
      { act: 'use', kind, every: everyWord(secs), label: `${what}, every ${everyWord(secs)}`, note: { test: 'runs them and says what fails; changes no file', debug: 'fixes the code until every test passes', web: 'you say which page next' }[kind] },
      { act: 'keep', label: `Keep "${t}" as what each run does`, note: 'the model gets only this word' },
      { act: 'again', label: 'Type it again', note: '' },
    ] };
  }
  const p = parseLoop(t);
  if (p.error || PRESET[p.kind] === p.message || /\s/.test(p.message) || [...p.message].length >= 16 || /^https?:/i.test(p.message)) return null;
  return { why: `"${p.message}" is one word. Each run gets only these words, so say what it should do.`, options: [
    { act: 'again', label: 'Type it again', note: 'e.g. "run the tests and say what fails"' },
    { act: 'keep', label: `Keep "${p.message}" as what each run does`, note: 'the model gets only this word' },
  ] };
}

// /loop <a sentence> (9 Oct 2026, the owner: "can we make 1 command for it all? … easier to set up"):
// the words as people say them, read for how often and when it stops, the rest being what each run
// does. "run the tests every 10 min until 6pm", "check bun.sh/blog every hour, stop after 5 runs",
// "fix the failing tests until they pass". A phrase of time or count is taken out of the message; a
// goal ("until they pass") stays in it, and makes a fixing loop run until done. No model is asked.
// Answers { fields, found } (the setup's fields, rulesOf reads them; found: the phrases it took), or
// { error } when nothing is left to do.
const STOP_COUNT = String.raw`(?:(?:and\s+)?(?:stop|end)\s+)?after\s+(\d+)\s+(?:runs?|times|tries)|(\d+)\s+times`;
const STOP_TIME = String.raw`(?:(?:and\s+)?(?:stop|end)\s+(?:at\s+)?|until\s+|till\s+|(?:and\s+)?stop\s+at\s+)(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})`;
const STOP_FOR = String.raw`for\s+(?:the\s+next\s+)?(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h)\b|for\s+(?:an?\s+)(hour|minute)\b`;
const EVERY_ANY = new RegExp(String.raw`(?:^|[\s,])(?:every\s+(?:(\d+(?:\.\d+)?)\s*${UNIT_WORD}|(?:an?\s+)?(second|minute|hour|day))|(hourly|daily))\b`, 'i');
const UNTIL_DONE = /\buntil\s+(?:(?:they|it|all|every\s+test|the\s+tests?)\s+)*(?:all\s+)?(?:pass(?:es)?|is\s+(?:fixed|green|done)|are\s+(?:fixed|green)|(?:it'?s|its)\s+(?:fixed|done)|done|green|fixed)\b/i;
export function readSentence(text, { now = Date.now() } = {}) {
  let rest = String(text ?? '').trim().replace(/^\/loops?\b\s*/i, '');
  const found = [];
  const fields = { every: null, runs: 'no limit', stopAt: 'none' };
  const take = (re, fn) => { const m = new RegExp(re.source ?? re, 'i').exec(rest); if (!m) return; found.push(m[0].trim().replace(/^,\s*/, '')); fn(m); rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`; };
  // A kind and a time first, as /loop always read them ("test 5m", "debug", "web 30m …").
  const lead = /^(debug|tests?|web)\b\s*/i.exec(rest);
  let kind = null;
  if (lead) { kind = lead[1].toLowerCase().replace(/^tests$/, 'test'); rest = rest.slice(lead[0].length); }
  const lt = LEAD_TIME.exec(rest);
  if (lt) { found.push(lt[0].trim()); fields.every = everyWord(secsOf(lt)); rest = rest.slice(lt[0].length); }
  if (!fields.every) take(EVERY_ANY, (m) => { fields.every = m[4] ? (m[4].toLowerCase() === 'daily' ? '1d' : '1h') : everyWord(secsOf([m[0], m[1], m[2], m[3]])); });
  take(new RegExp(STOP_COUNT, 'i'), (m) => { fields.runs = m[1] ?? m[2]; });
  take(new RegExp(STOP_TIME, 'i'), (m) => { fields.stopAt = m[1].replace(/\s+/g, ''); });
  take(new RegExp(STOP_FOR, 'i'), (m) => { fields.stopAt = m[1] ? `${m[1]}${m[2][0].toLowerCase()}` : m[3].toLowerCase() === 'hour' ? '1h' : '1m'; });
  // What is left is what each run does, tidied of the commas and "and"s the phrases leave.
  let message = rest.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/(^|[,.]\s*)(and|then)\s*$/i, '').replace(/[\s,;:-]+$/, '').replace(/^[\s,;:-]+/, '').trim();
  if (!message && kind && PRESET[kind]) message = PRESET[kind];
  if (!message) return { error: kind === 'web' ? 'Say what to read: /loop read the Bun release page every hour' : 'Say what each run should do: /loop run the tests every 10 min' };
  kind ??= guessKind(message);
  const until = kind === 'debug' && (!fields.every || UNTIL_DONE.test(message));
  // A stop time that cannot be read is left to the setup, which says so.
  if (fields.stopAt !== 'none' && readStopAt(fields.stopAt, now).error) fields.stopAt = 'none';
  return { fields: { message, kind, every: until ? 'until done' : fields.every ?? 'own pace', runs: fields.runs, stopAt: fields.stopAt }, found };
}

// A gap as said aloud: 10 min, 90 s, hour, 2 hours, day.
export const spokenEvery = (secs) => (secs % 86_400 === 0 ? (secs === 86_400 ? 'day' : `${secs / 86_400} days`) : secs % 3600 === 0 ? (secs === 3600 ? 'hour' : `${secs / 3600} hours`) : secs % 60 === 0 ? `${secs / 60} min` : `${secs} s`);
// ---- a loop's own rules (4 Oct 2026, the owner's ask: "i want to be able to control it more") ----
// Set in the board's setup and form (^N makes a loop, ^O changes one) or with /loop <n> <rule>. Their picks: a
// loop can stop after a number of runs or at a time, have a spending cap of its own, and wait for
// your go before each run; it also has its own mode and the steps a run may take. Empty = no limit.
export const LOOP_MODES = ['ask', 'edits', 'auto', 'plan'];
export const STEPS_WORD = 'as /effort'; // no steps of its own: /effort's Steps per request
const KIND_WORD = { debug: 'Fix the tests', test: 'Run the tests', web: 'Read the web', task: 'Any task' };
export const kindWord = (k) => KIND_WORD[k] ?? KIND_WORD.task;
const MODE_NAME = { ask: 'Manual', edits: 'Accept edits', auto: 'Auto', plan: 'Plan', bypass: 'Bypass permissions' };
export const modeName = (m) => MODE_NAME[m] ?? MODE_NAME.ask;
const NONE = /^(|-|—|none|no|off|no limit|never)$/i;
export const hm = (t) => new Date(t).toTimeString().slice(0, 5);
export const money = (usd) => `$${Number(usd || 0).toFixed(2)}`;
// How often, as typed in the form: 10m, 90s, 2 hours, own pace, until done (a fixing loop only).
export function readEvery(text, { kind = 'task', min = minSecs() } = {}) {
  const t = String(text ?? '').trim().replace(/^every\s+/i, '');
  if (/^(until( it is)? done|until done|until the tests pass)$/i.test(t)) return kind === 'debug' ? { every: null, until: true, note: '' } : { error: 'Only a loop that fixes tests runs until done: give a time, or its own pace' };
  if (NONE.test(t) || /^(its )?own pace$/i.test(t)) return kind === 'debug' && !/pace/i.test(t) ? { every: null, until: true, note: '' } : { every: null, until: false, note: '' };
  const m = new RegExp(String.raw`^(\d+(?:\.\d+)?)\s*${UNIT_WORD}$`, 'i').exec(t);
  if (!m) return { error: 'How often: a time like 10m, 90s or 2h, or "own pace"' };
  const secs = secsOf(m);
  return secs < min ? { every: min, until: false, note: ` (the shortest gap is ${everyWord(min)})` } : { every: secs, until: false, note: '' };
}
// Stop at: a time of day (18:30, 6pm, 6:30 pm: the next time it comes round) or a while from now (2h).
export function readStopAt(text, now = Date.now()) {
  const t = String(text ?? '').trim();
  if (NONE.test(t)) return { stopAt: null };
  const lead = new RegExp(String.raw`^(?:in\s+)?(\d+(?:\.\d+)?)\s*${UNIT_WORD}$`, 'i').exec(t);
  if (lead) return { stopAt: now + secsOf(lead) * 1000 };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t);
  if (!m || (!m[2] && !m[3])) return { error: 'Stop at: a time like 18:30 or 6pm, or a while like 2h' };
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]) { if (h < 1 || h > 12) return { error: 'Stop at: an hour from 1 to 12 with am or pm' }; h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0); }
  if (h > 23 || min > 59) return { error: 'Stop at: a time like 18:30' };
  const at = new Date(now);
  at.setHours(h, min, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return { stopAt: at.getTime() };
}
export function readRuns(text) {
  const t = String(text ?? '').trim().replace(/\s*runs?$/i, '');
  if (NONE.test(t)) return { maxRuns: null };
  return /^\d+$/.test(t) && Number(t) >= 1 && Number(t) <= 1000 ? { maxRuns: Number(t) } : { error: 'Stop after: a number of runs, 1 to 1000, or "no limit"' };
}
export function readCap(text) {
  const t = String(text ?? '').trim();
  if (NONE.test(t)) return { usdCap: null };
  const m = /^\$?\s*(\d+(?:\.\d{1,2})?)$/.exec(t);
  return m && Number(m[1]) > 0 ? { usdCap: Number(m[1]) } : { error: 'Spending cap: dollars, like $1 or 0.50, or "none"' };
}
export function readSteps(text) {
  const t = String(text ?? '').trim().replace(/\s*steps?$/i, '');
  if (NONE.test(t) || /^(default|as \/?effort)$/i.test(t)) return { steps: null };
  return /^\d+$/.test(t) && Number(t) >= 5 && Number(t) <= 200 ? { steps: Number(t) } : { error: 'Steps a run: 5 to 200, or "as /effort"' };
}
// A loop's page check (rules/loops: "- Page check: {page}"), its blank answered: "index.html · who can use it"
// → { page, access }; nothing → null. Its run checks the page before it starts (cli.jsx, flows/layoutcheck.mjs).
export function readCheck(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const page = t.replace(/\s*·.*$/, '').trim();
  return page ? { page, access: /·\s*(who can use it|access)/i.test(t) } : null;
}
export const checkWords = (c) => (c ? `${c.page}${c.access ? ' · who can use it' : ''}` : '');
// The form's fields, as typed, made into a loop's rules. Answers { rules } or { error, field }.
export function rulesOf(f, { now = Date.now(), min = minSecs() } = {}) {
  const message = String(f.message ?? '').trim();
  if (!message) return { error: 'A loop needs a message: what should each run do?', field: 'message' };
  const kind = KINDS.includes(f.kind) ? f.kind : guessKind(message);
  const steps = [['every', readEvery(f.every, { kind, min })], ['runs', readRuns(f.runs)], ['stopAt', readStopAt(f.stopAt, now)], ['cap', readCap(f.cap)], ['steps', readSteps(f.steps)]];
  const bad = steps.find(([, r]) => r.error);
  if (bad) return { error: bad[1].error, field: bad[0] };
  const mode = LOOP_MODES.includes(f.mode) || f.mode === 'bypass' ? f.mode : 'ask';
  const [every, runs, stopAt, cap, st] = steps.map(([, r]) => r);
  // A loop loaded or saved by name keeps it (loop-files.mjs); else a name from its words.
  const name = String(f.name ?? '').trim().slice(0, 60) || (PRESET[kind] === message ? PRESET_NAME[kind] : nameOf(message));
  return { rules: { message, kind, name, every: every.every, until: every.until, maxRuns: runs.maxRuns, stopAt: stopAt.stopAt, usdCap: cap.usdCap, steps: st.steps, mode, askFirst: Boolean(f.askFirst), picture: f.picture ?? null, ...('check' in f ? { check: readCheck(f.check) } : {}) }, note: every.note };
}
// A loop's rules as the form shows them, to change them.
export function fieldsOf(l) {
  return { message: l.message, kind: l.kind, every: l.until ? 'until done' : l.every ? everyWord(l.every) : 'own pace', runs: l.maxRuns ? String(l.maxRuns) : 'no limit', stopAt: l.stopAt ? hm(l.stopAt) : 'none', cap: l.usdCap ? money(l.usdCap) : 'none', steps: l.steps ? String(l.steps) : STEPS_WORD, mode: l.mode ?? 'ask', askFirst: Boolean(l.askFirst), ...(l.check ? { check: checkWords(l.check) } : {}) };
}
// Why a loop has reached one of its limits, or null. Runs stopped to start over do not count.
export function limitWhy(l, now = Date.now()) {
  if (l.maxRuns && (l.counted ?? 0) >= l.maxRuns) return `ran its ${l.maxRuns} run${l.maxRuns === 1 ? '' : 's'}`;
  if (l.stopAt && now >= l.stopAt) return `reached its stop time, ${hm(l.stopAt)}`;
  if (l.usdCap && (l.spent ?? 0) >= l.usdCap) return `spent ${money(l.spent)} of its ${money(l.usdCap)}`;
  return null;
}
// The limits a loop has, a few words each, for the window's list (short: for a box on the board).
export function limitWords(l, { short = false } = {}) {
  const out = [];
  if (l.maxRuns) out.push(short ? `${l.counted ?? 0}/${l.maxRuns} runs` : `${l.counted ?? 0} of ${l.maxRuns} runs`);
  if (l.stopAt) out.push(short ? `till ${hm(l.stopAt)}` : `ends ${hm(l.stopAt)}`);
  const whole = (usd) => money(usd).replace(/\.00$/, '');
  if (l.usdCap) out.push(short ? `${whole(l.spent)}/${whole(l.usdCap)}` : `${money(l.spent)} of ${money(l.usdCap)}`);
  return out;
}
// The rewind copies of one loop's runs (rewind.mjs), kept apart from the window's own.
export const sessionOf = (pid, id) => `loop-${pid}-${id}`;

// The lines a run's message ends with: which run this is, a line for each earlier run (the last
// JOURNAL of them, the newest said in full), and the two words a run can end the loop or set its
// own pace with. Before 4 Oct 2026 only the last run was told, so a later run could try again what
// an earlier one had tried and seen fail.
const JOURNAL = 8;
export function loopNote(loop, n, { now = Date.now() } = {}) {
  const at = (t) => new Date(t).toTimeString().slice(0, 5);
  const parts = [`Run ${n} of a loop that ${loop.until ? 'runs until its job is done' : loop.every ? `runs every ${everyWord(loop.every)}` : 'paces itself'}; each run is a fresh conversation.`];
  const runs = loop.runs.slice(-JOURNAL);
  if (runs.length) {
    const earlier = runs[0].n - 1;
    const line = (r, max) => {
      const words = String((r.reason && r.reason !== 'done' ? r.summary : r.said || r.summary) || 'nothing said').replace(/\s+/g, ' ').trim();
      const fails = r.failing > 0 ? `, ${r.failing} test${r.failing === 1 ? '' : 's'} still failing` : '';
      return `- Run ${r.n} at ${at(r.startedAt)}${fails}: ${words.length > max ? `${words.slice(0, max - 1)}…` : words}`;
    };
    // A loop that checks or reads the same thing each run is meant to repeat itself; one that fixes or makes something is not.
    const anew = ['debug', 'task'].includes(loop.kind) ? '\nDo not try again what an earlier run tried and saw fail.' : '';
    parts.push(`What the earlier runs did${earlier > 0 ? ` (the last ${runs.length}; ${earlier} before them are not listed)` : ''}, oldest first:\n${runs.map((r, i) => line(r, i === runs.length - 1 ? 400 : 160)).join('\n')}${anew}\n`);
  }
  parts.push('If the whole job is finished for good and no further run is needed, end your answer with the line: LOOP DONE');
  if (!loop.every && !loop.until) parts.push('You may set when the next run starts by ending with the line: NEXT RUN IN <minutes> MIN');
  return `(${parts.join(' ').replace(/\n /g, '\n')})`;
}
// A debugging loop that is not getting closer: its last two runs ended with tests failing, the
// second with as many as the first or more. Answers why in a line, or null. It then waits for
// you (Loops.finish) instead of trying the same thing again: a note, r or p sends it on.
export function stuckWhy(loop) {
  if (loop.kind !== 'debug') return null;
  const [b, a] = loop.runs.slice(-2);
  // A loop that fixes a page (its page check): by the problems the check still found after each run.
  if (loop.check) {
    const left = (r) => r?.page?.left;
    if (!a || !b || [a, b].some((r) => r.reason === 'interrupted') || !(left(a) > 0) || !(left(b) > 0) || left(a) < left(b)) return null;
    return `${left(a)} problem${left(a) === 1 ? '' : 's'} still on the page after runs ${b.n} and ${a.n}: it is not getting closer`;
  }
  if (!a || !b || [a, b].some((r) => r.reason === 'interrupted') || !(a.failing > 0) || !(b.failing > 0) || a.failing < b.failing) return null;
  const n = a.failing;
  return `${n} test${n === 1 ? '' : 's'} still fail${n === 1 ? 's' : ''} after runs ${b.n} and ${a.n}: it is not getting closer`;
}
// What a run's last words say about the loop: done for good, and when to run next.
export function readEnding(text) {
  const t = String(text ?? '');
  const next = /^\W*NEXT RUN IN (\d+(?:\.\d+)?)\s*MIN/im.exec(t);
  return { done: /^\W*LOOP DONE\W*$/im.test(t), nextSecs: next ? Math.min(3600, Math.max(60, Math.round(Number(next[1]) * 60))) : null, said: t.replace(/^\W*(LOOP DONE|NEXT RUN IN [\d.]+\s*MIN\w*)\W*$/gim, '').trim() };
}
// The page check's line on the board: checking, what it found, or why it could not look.
export function pageWords(ev) {
  const what = ev.when === 'after' ? 'After the run, the page check' : 'The page check';
  if (ev.when === 'start') return `Checking ${ev.page} in a hidden browser…`;
  if (ev.skipped) return `${what} of ${ev.page} could not run: ${ev.skipped}`;
  return `${what} of ${ev.page}: ${ev.count ? `${ev.count} problem${ev.count === 1 ? '' : 's'}` : 'nothing broken'} (${Number(ev.secs ?? 0).toFixed(1)} s)`;
}
// One line about how a run ended, for the board.
export function summaryOf(said, reason) {
  const t = String(said ?? '').replace(/[*`#>]/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const line = t.find((l) => /[a-z]/i.test(l)) ?? '';
  const one = line.length > 90 ? `${line.slice(0, 89)}…` : line;
  if (reason === 'done') return one || 'done, nothing said';
  const why = { interrupted: 'stopped', declined: 'you said no', error: 'it failed', steps: 'out of steps', stuck: 'stuck' }[reason] ?? `stopped (${reason})`;
  return one ? `${why}: ${one}` : why;
}

// ---- the files the board reads -------------------------------------------------------------------
export const loopsDir = (home = HOME) => join(home, 'loops');
export const dirOf = (home, pid) => join(loopsDir(home), String(pid));
const stateFile = (home, pid) => join(dirOf(home, pid), 'state.json');
const cmdDir = (home, pid) => join(dirOf(home, pid), 'cmd');
export const runFile = (home, pid, id, n) => join(dirOf(home, pid), `run-${id}-${n}.jsonl`);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const tilde = (p) => (p && p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);

// The windows that have loops now, oldest first; a folder whose window is gone is removed.
export function listBoards(home = HOME) {
  let names = [];
  try { names = readdirSync(loopsDir(home)); } catch { return []; }
  const out = [];
  for (const name of names) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (!alive(pid)) { try { rmSync(dirOf(home, pid), { recursive: true, force: true }); } catch {} continue; }
    const s = readState(home, pid);
    if (s) out.push(s);
  }
  return out.sort((a, b) => (a.started ?? 0) - (b.started ?? 0));
}
export function readState(home, pid) { try { return JSON.parse(readFileSync(stateFile(home, pid), 'utf8')); } catch { return null; } }
export function readRun(home, pid, id, n) {
  let text = '';
  try { text = readFileSync(runFile(home, pid, id, n), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) { if (!line) continue; try { out.push(JSON.parse(line)); } catch { /* a line half written */ } }
  return out;
}
let cmdSeq = 0;
// A key pressed on the board, for the window to act on at its next look (half a second at most).
export function sendCommand(home, pid, cmd) {
  const dir = cmdDir(home, pid);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const name = `${Date.now()}-${process.pid}-${++cmdSeq}`;
    writeFileSync(join(dir, `${name}.tmp`), JSON.stringify(cmd), { mode: 0o600 });
    renameSync(join(dir, `${name}.tmp`), join(dir, `${name}.json`));
    return true;
  } catch { return false; }
}

// ---- one run, as a process -----------------------------------------------------------------------
// spec: { folder, prompt, mode, url, slots, local, flows, allow, owner, steps, rewind, resume }. Answers { send, kill, on, pid }.
// resume: a transcript file (AGENTIC_TRANSCRIPT's) whose conversation the run carries on (the web's follow-ups).
export function startRun(spec, { self = selfCommand(), env = process.env } = {}) {
  const args = ['-p', '--loop-events', '--mode', spec.mode ?? 'ask', ...(spec.url ? ['--url', spec.url, ...(spec.slots > 1 ? ['--slots', String(spec.slots)] : [])] : spec.local ? ['--local'] : []), ...(spec.flows === false ? ['--no-flows'] : [])];
  const child = spawn(self[0], [...self.slice(1), ...args], {
    cwd: spec.folder, stdio: ['pipe', 'pipe', 'pipe'],
    // The memory is read, never saved to, by a run nobody watches; what it costs counts under its window.
    env: { ...env, AGENTIC_LOOP_SPEC: JSON.stringify({ prompt: spec.prompt, allow: spec.allow ?? [], steps: spec.steps ?? null, rewind: spec.rewind ?? null, ...(spec.resume ? { resume: spec.resume } : {}), ...(spec.check ? { check: spec.check } : {}) }), AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_SPEND_PID: String(spec.owner ?? process.pid), AGENTIC_OPEN: 'off' },
  });
  const fns = [];
  let carry = '', err = '', ended = false;
  const emit = (ev) => { if (ev.t === 'end') { if (ended) return; ended = true; } for (const f of fns) f(ev); };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    carry += d;
    for (let i = carry.indexOf('\n'); i >= 0; i = carry.indexOf('\n')) { const line = carry.slice(0, i); carry = carry.slice(i + 1); if (line[0] !== '{') continue; try { emit(JSON.parse(line)); } catch { /* not a line of ours */ } }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  child.on('error', (e) => emit({ t: 'end', reason: 'error', final: `The run could not start: ${e.message}` }));
  // A run that ends without saying so (a crash, the model gone): its last words on stderr say why.
  // Said once its output has closed, so a last line still on its way is read first; a run whose
  // output stays open after it exits (something it started still holds it) is ended 2 s later.
  const gone = (code) => emit({ t: 'end', reason: 'error', final: err.trim().split('\n').filter((l) => l.trim() && !l.startsWith('·')).slice(-1)[0] ?? `the run ended (code ${code})` });
  child.on('close', (code) => gone(code));
  child.on('exit', (code) => setTimeout(() => gone(code), 2000).unref?.());
  child.stdin.on('error', () => {});
  return {
    pid: child.pid,
    on(fn) { fns.push(fn); },
    send(msg) { try { child.stdin.write(`${JSON.stringify(msg)}\n`); } catch { /* it has ended */ } },
    // wait: you stopped it (or start it over), so it is given 10 s to keep its copy for undo and say
    // its last word; the window closing gives it 1.5 s.
    kill({ wait = false } = {}) { try { child.stdin.write('{"t":"stop"}\n'); } catch {} setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, wait ? 10_000 : 1500).unref?.(); },
  };
}

// Whether a folder has tests to run, from its top level only (the setup says so beside each folder):
// a package.json with a test script, a test folder, a *.test.* or *_test.* file, or pytest's files.
export function hasTests(folder) {
  let names = [];
  try { names = readdirSync(folder); } catch { return false; }
  if (names.some((n) => /^(tests?|__tests__|spec)$/.test(n) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(n) || /^test_.*\.py$|_test\.(py|go)$/.test(n) || /^(pytest\.ini|conftest\.py)$/.test(n))) return true;
  if (!names.includes('package.json')) return false;
  try { return Boolean(JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).scripts?.test); } catch { return false; }
}

// ---- the window's side ---------------------------------------------------------------------------
// status() → { on, why, name, where, limit, mode, url, slots, local }: whether a run can start now
// (the model loaded, the window not answering), how many may run at once, and how a run reaches
// the model. spend() → what this window has spent on a paid service, in dollars.
export class Loops {
  // rewind(session) → the copies of one loop's runs (rewind.mjs), for undo.
  // places() → the folders a new loop may work in besides this window's (your recent projects); wake() turns the
  // model on, for a loop started while it is off (9 Oct 2026, the owner's pick: Start turns it on).
  constructor({ home = HOME, pid = process.pid, folder = process.cwd(), name = basename(process.cwd()), status = () => ({ on: true, limit: 1 }), spend = () => 0, start = startRun, now = () => Date.now(), onChange = () => {}, maxHours = MAX_HOURS, maxUsd = MAX_USD, rewind = null, places = () => [], wake = null } = {}) {
    Object.assign(this, { home, pid, folder, name, status, spend, start, now, onChange, maxHours, maxUsd, places, wake });
    this.rewind = rewind ?? (async (session) => { const { Rewind } = await import('./rewind.mjs'); return new Rewind({ home, session }); });
    this.loops = [];
    this.log = [];
    this.nextId = 1;
    this.started = now();
    this.handles = new Map(); // loop id → the run's process
    this.dirty = false;
    this.closed = false;
    this.last = { on: true, why: '' };
  }
  loop(id) { return this.loops.find((l) => l.id === id) ?? null; }
  get open() { return this.loops.filter((l) => !['done', 'stopped'].includes(l.state)); }
  get needsYou() { return this.loops.filter((l) => l.current?.needs); }
  // The debugging loops that stopped getting closer and wait for you (stuckWhy).
  get stuck() { return this.loops.filter((l) => l.stuck && !l.current); }
  // The loops whose next run waits for your go (Ask first).
  get ready() { return this.loops.filter((l) => l.ready && !l.current); }
  // The oldest question waiting.
  get asking() { return [...this.needsYou].sort((a, b) => a.current.needs.since - b.current.needs.since)[0] ?? null; }
  say(l, kind, text, more = {}) { this.log.push({ at: this.now(), id: l?.id ?? null, kind, text, ...more }); if (this.log.length > 300) this.log.shift(); }
  changed() { this.dirty = true; this.onChange(); }
  line(l, run, kind, text, more = {}) { try { mkdirSync(dirOf(this.home, this.pid), { recursive: true, mode: 0o700 }); appendFileSync(runFile(this.home, this.pid, l.id, run.n), `${JSON.stringify({ at: this.now() - run.startedAt, kind, text, ...more })}\n`); } catch { /* the board shows less */ } run.lines = (run.lines ?? 0) + 1; }

  // /loop <text>: a new loop in this window's folder, in the mode it is in now.
  // parsed: parseLoop's answer, or rulesOf's rules (the form), which also carry the loop's own limits.
  add(parsed, { folder = this.folder, mode = 'ask' } = {}) {
    const t = this.now();
    const l = { id: this.nextId++, kind: parsed.kind, name: parsed.name, message: parsed.message, every: parsed.every, until: parsed.until, folder, mode: parsed.mode ?? mode, state: 'waiting', nextAt: t + 1000, endsAt: t + this.maxHours * 3_600_000, created: t, runs: [], current: null, note: null, queued: false, pauseAfter: false, allowed: [], doneWhy: null, gap: null, stuck: null,
      maxRuns: parsed.maxRuns ?? null, stopAt: parsed.stopAt ?? null, usdCap: parsed.usdCap ?? null, steps: parsed.steps ?? null, askFirst: Boolean(parsed.askFirst), counted: 0, spent: 0, ready: null, go: false, lastNote: null, picture: parsed.picture ?? null, check: parsed.check ?? null };
    this.loops.push(l);
    this.say(l, 'new', parsed.message);
    this.changed();
    return l;
  }

  // Twice a second: the board's keys, then every loop that is due.
  tick() {
    if (this.closed) return;
    this.readCommands();
    const t = this.now();
    const st = this.status() ?? { on: true };
    // The window's own spending and its loops' runs (each run says its cost when it ends).
    const usd = (Number(this.spend()) || 0) + this.loops.reduce((n, l) => n + (l.spent ?? 0), 0);
    const hold = usd >= this.maxUsd ? `this window has spent $${usd.toFixed(2)} on its service: its loops wait` : !st.on ? (st.why || 'the model is off') : '';
    const running = () => this.loops.filter((l) => l.current && !l.current.needs).length;
    for (const l of [...this.loops].sort((a, b) => a.nextAt - b.nextAt)) {
      if (l.current || ['paused', 'done', 'stopped', 'redoing'].includes(l.state)) continue;
      if (t >= l.endsAt) { this.end(l, 'done', `ran for ${this.maxHours} hours`); continue; }
      const limit = limitWhy(l, t);
      if (limit) { this.end(l, 'done', limit); continue; }
      if (hold) { if (l.state !== 'off' || l.offWhy !== hold) { l.state = 'off'; l.offWhy = hold; this.changed(); } continue; }
      if (l.state === 'off') { l.state = 'waiting'; l.offWhy = null; this.changed(); }
      if (t < l.nextAt) continue;
      // Ask first: a run that is due waits for your go (y on the board, /loop <n> go), and says so once.
      if (l.askFirst && !l.go) {
        if (!l.ready) { l.ready = { n: (l.runs.at(-1)?.n ?? 0) + 1, since: t }; this.say(l, 'ready', `run ${l.ready.n} is ready and waits for your go`); this.changed(); }
        continue;
      }
      // One run at a time on this Mac's model (more on a service): a loop that is due waits its turn.
      if (running() >= Math.max(1, st.limit ?? 1)) { if (!l.queued) { l.queued = true; this.changed(); } continue; }
      l.queued = false;
      this.begin(l, st);
    }
    if (this.dirty) this.save();
  }

  begin(l, st = this.status() ?? {}) {
    const t = this.now();
    const run = { n: (l.runs.at(-1)?.n ?? 0) + 1, startedAt: t, endedAt: null, ok: null, summary: null, needs: null, lines: 0 };
    l.current = run;
    l.state = 'running';
    l.go = false;
    l.ready = null;
    const note = loopNote(l, run.n, { now: t });
    this.line(l, run, 'user', l.message);
    this.line(l, run, 'loopnote', note);
    let prompt = `${l.message}\n\n${note}`;
    if (l.note) {
      this.line(l, run, 'you', l.note);
      prompt = `${l.message}\n\n(A note from the user for this run: ${l.note})\n\n${note}`;
      l.note = null;
      if (l.lastNote && !l.lastNote.read) l.lastNote.read = { start: run.n };
    }
    this.say(l, 'start', `run ${run.n}`, { n: run.n });
    let h;
    try { h = this.start({ folder: l.folder, prompt, mode: l.mode, url: st.url ?? null, slots: st.slots ?? 1, local: Boolean(st.local), flows: st.flows, allow: l.allowed, owner: this.pid, steps: l.steps, rewind: sessionOf(this.pid, l.id), check: l.check ? { ...l.check, after: Boolean(l.until) } : null }); }
    catch (e) { this.finish(l, run, { reason: 'error', final: `The run could not start: ${e.message}` }); return; }
    this.handles.set(l.id, h);
    h.on((ev) => this.onEvent(l, run, ev));
    this.changed();
  }

  onEvent(l, run, ev) {
    if (this.closed) return;
    // The last word of a run that was stopped: its copy for undo, and a start over that waited for it.
    if (l.current !== run) { if (ev.t === 'end') this.lateEnd(l, run, ev); return; }
    if (ev.t === 'tool') { const failed = ev.test && ev.failed !== undefined ? Boolean(ev.failed) : Boolean(ev.error); this.line(l, run, failed ? 'fail' : 'tool', `${ev.label}(${ev.arg ?? ''})`, { test: Boolean(ev.test) }); if (ev.test && ev.failed !== undefined) run.tests = { ok: !failed }; }
    else if (ev.t === 'note') this.line(l, run, 'note', ev.text);
    // A note you typed reached the model with a step's result (loop-run.mjs heard).
    else if (ev.t === 'heard') {
      this.line(l, run, 'heard', ev.text, { after: ev.after ?? null });
      this.say(l, 'heard', ev.after ? `read your note after ${ev.after}` : 'read your note');
      if (l.lastNote && !l.lastNote.read) l.lastNote.read = { after: ev.after ?? null, n: run.n };
    }
    else if (ev.t === 'text') this.line(l, run, 'text', ev.text);
    // The page check (cli.jsx): before the run, and for a loop that fixes until done, again after it.
    else if (ev.t === 'page') {
      run.page = { ...(run.page ?? {}), [ev.when === 'after' ? 'left' : 'found']: ev.skipped ? null : ev.count };
      this.line(l, run, 'page', pageWords(ev));
    }
    else if (ev.t === 'ask') {
      run.needs = { id: ev.id, kind: ev.kind, name: ev.name, text: ev.text, options: ev.options ?? [], always: ev.always ?? null, sig: ev.sig ?? null, since: this.now() };
      l.state = 'needs';
      this.line(l, run, 'ask', ev.text);
      this.say(l, 'ask', ev.text);
    } else if (ev.t === 'end') { this.finish(l, run, ev); return; }
    this.changed();
  }

  finish(l, run, ev) {
    if (l.current !== run) return;
    this.handles.delete(l.id);
    const end = readEnding(ev.final);
    run.endedAt = this.now();
    // A run is ok (the app's blue) when it finished and the tests it ran last passed; a stop or a miss is red.
    const tests = ev.tests ?? run.tests ?? null;
    run.ok = ev.reason === 'done' && (tests ? tests.ok : true);
    run.summary = run.redo ? 'stopped to start over' : run.stopped ? 'stopped by you' : summaryOf(end.said, ev.reason);
    run.said = end.said.slice(0, 600);
    run.needs = null;
    // A note that came as the answer was given is the run's next message (loop-run.mjs more): read, with no step after it.
    if (l.lastNote && !l.lastNote.read && l.lastNote.n === run.n && !run.redo && !run.stopped) l.lastNote.read = { late: true, n: run.n };
    const usd = Number(ev.usd) || 0;
    l.spent = (l.spent ?? 0) + usd;
    if (!run.redo) l.counted = (l.counted ?? 0) + 1;
    l.runs.push({ n: run.n, startedAt: run.startedAt, endedAt: run.endedAt, ok: run.ok, summary: run.summary, said: run.said, lines: run.lines, reason: ev.reason, failing: Number.isFinite(tests?.count) ? tests.count : null, page: run.page ?? null, usd, point: ev.point ?? null, until: ev.until ?? ev.point ?? null, files: ev.files ?? [], redo: run.redo ?? null });
    if (l.runs.length > 60) l.runs.shift();
    l.current = null;
    this.say(l, 'end', run.summary, { ok: run.ok, n: run.n, ms: run.endedAt - run.startedAt });
    if (l.state === 'stopped') { this.changed(); return; }
    // Stopped to start over: it waits for the run's copy (lateEnd), puts its changes back if you said so, then runs again.
    if (run.redo) { l.state = 'redoing'; this.redoWait(l, l.runs.at(-1)); this.changed(); return; }
    // The job is done: the run said so, or a debugging loop's tests pass.
    if (ev.reason === 'done' && (end.done || (l.until && tests?.ok && !l.check))) { this.end(l, 'done', end.done ? 'the run said its job is done' : `the tests pass after ${run.n} run${run.n === 1 ? '' : 's'}`); return; }
    const limit = limitWhy(l, this.now());
    if (limit) { this.end(l, 'done', limit); return; }
    l.gap = end.nextSecs;
    l.nextAt = run.endedAt + (l.every ?? (l.until ? RETRY_SECS : end.nextSecs ?? SELF_SECS)) * 1000;
    // Not getting closer: it waits for you rather than trying the same thing again.
    const stuck = stuckWhy(l);
    if (stuck) { l.pauseAfter = false; l.state = 'paused'; l.stuck = stuck; this.say(l, 'stuck', stuck); }
    else if (l.pauseAfter) { l.pauseAfter = false; l.state = 'paused'; this.say(l, 'state', 'paused'); }
    else l.state = 'waiting';
    this.changed();
  }
  end(l, state, why) { l.state = state; l.doneWhy = why; l.queued = false; l.stuck = null; l.ready = null; l.go = false; this.say(l, 'state', state === 'done' ? `the loop ends: ${why}` : why); this.changed(); }

  // ---- what you can do to a loop (the board's keys, /loop in the window) ----
  answer(id, choice, text = null) {
    const l = this.loop(id);
    const n = l?.current?.needs;
    if (!n) return false;
    const h = this.handles.get(id);
    if (choice === 'always' && n.sig && !l.allowed.includes(n.sig)) l.allowed.push(n.sig);
    const said = text != null ? String(text) : choice === 'always' ? `Yes, always${n.always ? ` (${n.always})` : ''}` : choice === 'yes' ? 'Yes' : 'No';
    this.line(l, l.current, 'answer', said);
    this.say(l, 'answer', said);
    l.current.needs = null;
    l.state = 'running';
    h?.send({ t: 'answer', id: n.id, choice, ...(text != null ? { text: String(text) } : {}) });
    this.changed();
    return true;
  }
  // A note to a loop: its run reads it with its next step's result (loop-run.mjs); between runs, the next run starts with it.
  steer(id, text) {
    const l = this.loop(id);
    const note = String(text ?? '').trim();
    if (!l || !note) return null;
    this.say(l, 'you', note);
    // The last note, for the board: sent, then read after a step or at the start of a run.
    l.lastNote = { text: note, at: this.now(), n: l.current?.n ?? null, read: null };
    // A loop that ended starts again with the note (its rules as they were, its counts from nothing).
    if (['done', 'stopped'].includes(l.state)) {
      this.edit(id, {}, { again: true });
      l.note = note;
      this.changed();
      return `${l.name} starts again, with your note`;
    }
    if (l.current) {
      this.line(l, l.current, 'you', note);
      this.handles.get(id)?.send({ t: 'note', text: note });
      this.changed();
      return `Sent to ${l.name}: it reads it at its next step`;
    }
    l.note = l.note ? `${l.note}\n${note}` : note;
    // A loop that waits because it was stuck runs again now, with your note.
    if (l.stuck) { l.stuck = null; l.state = 'waiting'; l.nextAt = this.now(); this.changed(); return `${l.name} runs again now, with your note`; }
    this.changed();
    return `${l.name} starts its next run with your note`;
  }
  // What was typed in the board's chat box: /loop makes a loop, an open question gets it as its
  // answer, anything else is a note to the picked loop. Answers a line to show.
  typed(text, selId, { mode = 'ask' } = {}) {
    const t = String(text ?? '').trim();
    if (!t) return null;
    const m = /^\/loops?\b\s*(.*)$/is.exec(t);
    if (m && isLoopCommand(m[1])) { const r = this.command(m[1]); return r.then ? r.then((u) => (u.error ? { text: u.error, warn: true } : u.text)) : r.error ? { text: r.error, warn: true } : r.text; }
    if (m) {
      const p = parseLoop(m[1]);
      if (p.error) return p.error;
      const l = this.add(p, { mode: this.status()?.mode ?? mode });
      return { made: l.id, text: `Loop ${l.id} started: ${describe(l, this.now())}${p.note}` };
    }
    if (t.startsWith('/')) return 'Only /loop is a command here. Anything else is a note to the picked loop.';
    const l = this.loop(selId);
    if (l?.current?.needs?.kind === 'question') { this.answer(l.id, 'yes', t); return `Answered ${l.name}`; }
    return this.steer(selId, t);
  }
  runNow(id) {
    const l = this.loop(id);
    if (!l || l.current || ['done', 'stopped'].includes(l.state)) return false;
    if (l.state === 'paused') l.state = 'waiting';
    l.stuck = null;
    l.nextAt = this.now();
    this.changed();
    this.tick();
    return true;
  }
  pause(id) {
    const l = this.loop(id);
    if (!l || ['done', 'stopped'].includes(l.state)) return false;
    if (l.state === 'paused' || l.pauseAfter) { l.pauseAfter = false; l.stuck = null; if (l.state === 'paused') { l.state = 'waiting'; l.nextAt = Math.max(l.nextAt, this.now() + 1000); } this.say(l, 'state', 'going again'); }
    else if (!l.current) { l.state = 'paused'; this.say(l, 'state', 'paused'); }
    else { l.pauseAfter = true; this.say(l, 'state', 'pauses after this run'); }
    this.changed();
    return true;
  }
  stop(id) {
    const l = this.loop(id);
    if (!l || ['done', 'stopped'].includes(l.state)) return false;
    const run = l.current;
    l.state = 'stopped';
    l.doneWhy = 'stopped by you';
    l.queued = false;
    l.stuck = null;
    l.ready = null;
    this.say(l, 'state', 'stopped by you');
    if (run) { run.stopped = true; this.line(l, run, 'note', 'Stopped by you.'); this.handles.get(id)?.kill({ wait: true }); this.finish(l, run, { reason: 'interrupted', final: '' }); }
    this.changed();
    return true;
  }
  setEvery(id, secs) {
    const l = this.loop(id);
    if (!l || l.until || ['done', 'stopped'].includes(l.state)) return false;
    l.every = Math.max(minSecs(), Math.round(secs));
    if (!l.current) l.nextAt = Math.max(this.now() + 1000, (l.runs.at(-1)?.endedAt ?? this.now()) + l.every * 1000);
    this.changed();
    return true;
  }

  // Ask first: y on the board lets the waiting run start; n leaves this one out (a loop with no
  // time of its own, or one that runs until done, pauses instead).
  go(id) {
    const l = this.loop(id);
    if (!l?.ready) return false;
    l.ready = null;
    l.go = true;
    l.nextAt = Math.min(l.nextAt, this.now());
    this.say(l, 'state', 'you said go');
    this.changed();
    this.tick();
    return true;
  }
  notNow(id) {
    const l = this.loop(id);
    if (!l?.ready) return false;
    const n = l.ready.n;
    l.ready = null;
    if (l.every) { l.nextAt = this.now() + l.every * 1000; this.say(l, 'state', `run ${n} left out: the next one in ${everyWord(l.every)}`); }
    else { l.state = 'paused'; this.say(l, 'state', `run ${n} left out: paused`); }
    this.changed();
    return true;
  }

  // The form (e on the board) or /loop <n> <rule>: new rules for a loop. again: a loop that ended
  // starts again with them (its runs so far stay; its run count and spending start from nothing).
  edit(id, rules, { again = false } = {}) {
    const l = this.loop(id);
    if (!l) return { error: 'No such loop here' };
    const ended = ['done', 'stopped'].includes(l.state);
    if (ended && !again) return { error: `${l.name} has ended: save it with "start again"` };
    const was = { every: l.every, until: l.until };
    // Its name stays unless its message changed.
    if ('message' in rules && rules.message !== l.message && rules.name) l.name = rules.name;
    for (const k of ['message', 'kind', 'every', 'until', 'maxRuns', 'stopAt', 'usdCap', 'steps', 'mode', 'askFirst', 'check']) if (k in rules) l[k] = rules[k];
    const t = this.now();
    if (ended) {
      Object.assign(l, { state: 'waiting', nextAt: t + 1000, endsAt: t + this.maxHours * 3_600_000, doneWhy: null, counted: 0, spent: 0, stuck: null, ready: null, go: false, pauseAfter: false });
      this.say(l, 'state', 'started again');
    } else {
      if (!l.askFirst) l.ready = null;
      // A new pace counts from the last run's end.
      if ((was.every !== l.every || was.until !== l.until) && !l.current) l.nextAt = Math.max(t + 1000, (l.runs.at(-1)?.endedAt ?? t) + (l.every ?? (l.until ? RETRY_SECS : l.gap ?? SELF_SECS)) * 1000);
      this.say(l, 'state', 'its rules changed');
    }
    this.changed();
    return { text: `${l.name}: ${ended ? 'starts again' : 'saved'} · ${describe(l, t)}` };
  }

  // Stop the run under way and start it over with your note (^X on the board). putBack: what it
  // changed goes back first (undo), else the new run starts from where it left the files.
  // Between runs: the last run's changes go back if you said so, and a run starts now with the note.
  redo(id, note, { putBack = true } = {}) {
    const l = this.loop(id);
    const text = String(note ?? '').trim();
    if (!l || ['done', 'stopped'].includes(l.state)) return { error: l ? `${l.name} has ended` : 'No such loop here' };
    if (l.state === 'redoing') return { error: `${l.name} is already starting over` };
    this.say(l, 'you', text ? `start over: ${text}` : 'start over');
    if (text) l.lastNote = { text, at: this.now(), n: null, read: null };
    const run = l.current;
    if (run) {
      run.redo = { note: text || null, putBack: Boolean(putBack) };
      this.line(l, run, 'note', putBack ? 'Stopped by you, to start over; its changes go back.' : 'Stopped by you, to start over from here.');
      this.handles.get(id)?.kill({ wait: true });
      this.finish(l, run, { reason: 'interrupted', final: '' });
      return { text: `${l.name}: stopping run ${run.n} to start over${putBack ? ', its changes put back first' : ''}` };
    }
    const last = [...l.runs].reverse().find((r) => !r.undone);
    l.state = 'redoing';
    l.stuck = null;
    l.ready = null;
    this.redoNext(l, { note: text || null, putBack: Boolean(putBack) && Boolean(last) }, last);
    this.changed();
    return { text: `${l.name}: starting over now${putBack && last ? `, run ${last.n}'s changes put back first` : ''}` };
  }
  // A run stopped to start over: wait (10 s at most) for its last word, which carries its copy.
  redoWait(l, rec) {
    rec.waiting = true;
    setTimeout(() => { if (rec.waiting) { rec.waiting = false; this.redoNext(l, rec.redo, null, 'the run ended before its copy was kept: its changes stay'); } }, 10_000).unref?.();
  }
  lateEnd(l, run, ev) {
    const rec = l.runs.find((r) => r.n === run.n);
    if (!rec) return;
    if (ev.point != null && rec.point == null) { rec.point = ev.point; rec.until = ev.until ?? ev.point; rec.files = ev.files ?? []; }
    if (ev.usd) { rec.usd = (rec.usd ?? 0) + Number(ev.usd); l.spent = (l.spent ?? 0) + Number(ev.usd); }
    if (rec.waiting) { rec.waiting = false; this.redoNext(l, rec.redo, rec); }
    this.changed();
  }
  async redoNext(l, redo, rec, why = null) {
    let said = why;
    if (redo?.putBack && rec && rec.point != null && !rec.undone) { const r = await this.undo(l.id, rec.n, { during: true }); said = r.error ?? r.text; }
    if (this.closed || l.state !== 'redoing') return;
    if (said) this.say(l, 'undo', said);
    if (redo?.note) l.note = l.note ? `${l.note}\n${redo.note}` : redo.note;
    l.state = 'waiting';
    l.go = true; // starting over is your go
    l.nextAt = this.now();
    this.changed();
    this.tick();
  }

  // Put back what run n changed (^B on the board, /loop <n> undo): the files its edits and commands
  // changed, from the copy kept before it ran (rewind.mjs, that run only). A file changed since (by
  // you, another run, another loop) is left alone and named.
  async undo(id, n = null, { during = false } = {}) {
    const l = this.loop(id);
    if (!l) return { error: 'No such loop here' };
    if (l.current && !during) return { error: `${l.name} is running: wait for run ${l.current.n} to end, or start it over (^X)` };
    const rec = n ? l.runs.find((r) => r.n === n) : [...l.runs].reverse().find((r) => r.point != null && !r.undone);
    if (!rec) return { error: n ? `${l.name} has no run ${n}` : `${l.name} has no run to put back` };
    if (rec.undone) return { error: `Run ${rec.n} was already put back` };
    if (rec.point == null) return { error: `Run ${rec.n} kept no copy to put back` };
    let r = null;
    try { const rw = await this.rewind(sessionOf(this.pid, l.id)); r = await rw.restore(rec.point, { until: rec.until ?? rec.point }); } catch (e) { return { error: `Run ${rec.n} could not be put back: ${e.message}` }; }
    if (!r) return { error: `Run ${rec.n}'s copy is gone` };
    rec.undone = { at: this.now(), put: r.put.map((f) => f.rel), skip: r.skip.map((f) => ({ rel: f.rel, why: f.why })), failed: r.failed.map((f) => ({ rel: f.rel, why: f.why })) };
    const names = (list) => (list.length <= 3 ? list.join(', ') : `${list.slice(0, 3).join(', ')} and ${list.length - 3} more`);
    const text = r.put.length ? `Put back run ${rec.n}: ${names(r.put.map((f) => f.rel))}` : `Run ${rec.n} had nothing of its own to put back`;
    const left = [...r.skip, ...r.failed].map((f) => f.rel);
    const said = `${text}${left.length ? ` · left alone: ${names(left)} (changed since)` : ''}`;
    if (!during) this.say(l, 'undo', said);
    this.changed();
    return { text: said };
  }

  // /loop <n> <rule> (the window, and the board's chat box): one rule of loop n changed, or one thing
  // done to it. Answers { text } or { error }, or a promise of one (undo).
  command(text) {
    const c = loopCommand(text, { now: this.now() });
    if (c.error) return c;
    const l = this.loop(c.id);
    if (!l) return { error: `No loop ${c.id} here. /loop lists them.` };
    if (c.op === 'rule') {
      const ended = ['done', 'stopped'].includes(l.state);
      if (ended) return { error: `${l.name} has ended: /loop ${l.id} again starts it again` };
      if (c.rules.until && l.kind !== 'debug') return { error: 'Only a loop that fixes tests runs until done: give a time, or own pace' };
      const e = this.edit(l.id, c.rules);
      return e.error ? e : { text: `${e.text}${c.note ?? ''}` };
    }
    if (c.op === 'again') return this.edit(l.id, {}, { again: true });
    if (c.op === 'go') return this.go(l.id) ? { text: `${l.name}: run ${l.runs.length + 1} starts` } : { error: `${l.name} is not waiting for a go` };
    if (c.op === 'skip') return this.notNow(l.id) ? { text: `${l.name}: that run is left out` } : { error: `${l.name} is not waiting for a go` };
    if (c.op === 'undo') return this.undo(l.id, c.n ?? null);
    if (c.op === 'redo') return this.redo(l.id, c.text, { putBack: !c.keep });
    if (c.op === 'note') { const r = this.steer(l.id, c.text); return r ? { text: r } : { error: 'A note needs words' }; }
    if (c.op === 'stop') return this.stop(l.id) ? { text: `Stopped: ${l.name}` } : { error: `${l.name} has already ended` };
    if (c.op === 'pause') return this.pause(l.id) ? { text: `${l.name}: paused, or going again` } : { error: `${l.name} has ended` };
    if (c.op === 'run') return this.runNow(l.id) ? { text: `${l.name}: running now` } : { error: `${l.name} cannot run now` };
    return { error: 'Not a loop command' };
  }

  // ---- the board ----
  // One thing the board sent (a key, a typed line, the form): done here, and what to say back, or
  // a promise of it (undo). The board in another terminal sends it as a file (readCommands); the loop
  // screen in this window calls it directly.
  apply(c) {
    // The form or the setup: a new loop (add) or new rules (edit); both checked here again, as typed.
    if (c.op === 'add' || c.op === 'edit') {
      const read = rulesOf(c.fields ?? {}, { now: this.now() });
      if (read.error) return { text: read.error, warn: true };
      if (c.op === 'add') {
        // Its folder: this window's or one of the places offered (a path from the board is never taken as it is).
        const folder = c.fields?.folder ? this.placesNow().find((x) => x.path === c.fields.folder)?.path : this.folder;
        if (!folder) return { text: 'That folder is not one of the places offered here', warn: true };
        // Save and start: kept first, so a name already taken stops it before anything runs.
        const kept = c.save ? this.keep(c.save) : null;
        if (kept?.warn) return kept;
        // A project's loop you did not save: Start was your yes to that very file.
        if (c.trust) { const e = this.libraryNow().find((x) => x.file === c.trust && x.from === 'project'); if (e) { try { trustLoop(this.home, e.file, readFileSync(e.file, 'utf8')); this.libraryKept = null; } catch {} } }
        const l = this.add(read.rules, { mode: read.rules.mode, folder });
        const woke = c.wake && !this.status()?.on ? this.wakeUp() : null;
        return { made: l.id, text: `Loop ${l.id} started: ${describe(l, this.now())}${read.note}${kept ? ` · ${kept.text}` : ''}${woke ? ` · ${woke}` : ''}` };
      }
      const e = this.edit(c.id, read.rules, { again: Boolean(c.again) });
      return e.error ? { text: e.error, warn: true } : `${e.text}${read.note}`;
    }
    if (c.op === 'save') return this.keep(c.save ?? {});
    if (c.op === 'remove') { const r = removeLoop(String(c.file ?? ''), { home: this.home, folders: this.placesNow() }); this.libraryKept = null; return r.error ? { text: r.error, warn: true } : { text: `Removed “${c.name ?? 'that loop'}”` }; }
    if (c.op === 'wake') return this.wakeUp() ?? { text: 'The model cannot be turned on from here: /start in the coding window', warn: true };
    if (c.op === 'undo') return this.undo(c.id, c.n ?? null).then((u) => ({ text: u.error ?? u.text, warn: Boolean(u.error) }));
    if (c.op === 'redo') { const d = this.redo(c.id, c.text, { putBack: c.putBack !== false }); return d.error ? { text: d.error, warn: true } : d.text; }
    if (c.op === 'go') this.go(c.id);
    else if (c.op === 'skip') this.notNow(c.id);
    else if (c.op === 'answer') this.answer(c.id, c.choice, c.text ?? null);
    else if (c.op === 'typed') return this.typed(c.text, c.id);
    else if (c.op === 'run') this.runNow(c.id);
    else if (c.op === 'pause') this.pause(c.id);
    else if (c.op === 'stop') this.stop(c.id);
    else if (c.op === 'every') this.setEvery(c.id, c.secs);
    return null;
  }
  // The folders a loop may work in: this window's first, then the places offered, each once.
  // Read again at most every 30 s: the window's list reads its saved conversations.
  placesNow() {
    const t = this.now();
    if (this.placesKept && t - this.placesKept.at < 30_000) return this.placesKept.list;
    const out = [{ path: this.folder, shown: tilde(this.folder), tests: hasTests(this.folder) }];
    let more = [];
    try { more = this.places() ?? []; } catch {}
    for (const f of more) if (f && !out.some((x) => x.path === f)) out.push({ path: f, shown: tilde(f), tests: hasTests(f) });
    this.placesKept = { at: t, list: out };
    return out;
  }
  // The loops that can be loaded (loop-files.mjs): the ready-made ones, yours, and the places' own.
  // Read again at most every 5 s, and at once after a save.
  libraryNow() {
    const t = this.now();
    if (this.libraryKept && t - this.libraryKept.at < 5000) return this.libraryKept.list;
    let list = [];
    try { list = libraryOf({ home: this.home, folders: this.placesNow() }); } catch {}
    this.libraryKept = { at: t, list };
    return list;
  }
  // Keeps a loop to load again: s = { name, about, message (with its {fill-ins}), fills, picture, fields, where, folder, replace }.
  keep(s) {
    const folder = s.where === 'project' ? this.placesNow().find((x) => x.path === s.folder)?.path : null;
    if (s.where === 'project' && !folder) return { text: 'That project is not one of the places offered here', warn: true };
    const { folder: _, ...fields } = s.fields ?? {};
    const r = saveLoop({ name: s.name, about: s.about, message: s.message, fills: s.fills, picture: s.picture, fields }, { home: this.home, where: s.where, folder, replace: s.replace ?? null });
    this.libraryKept = null;
    if (r.error) return { text: r.error, warn: true };
    return { text: `kept as “${String(s.name).trim()}” ${s.where === 'project' ? `in ${tilde(folder).split('/').pop()}` : 'for you'}: /loop loads it`, kept: r.file };
  }
  // The model on, for a loop (the window's own /start); a line to say, or null where it cannot.
  wakeUp() {
    if (!this.wake) return null;
    try { return this.wake() || 'turning the model on: the first run starts once it is loaded'; } catch { return null; }
  }
  readCommands() {
    let files = [];
    try { files = readdirSync(cmdDir(this.home, this.pid)).filter((f) => f.endsWith('.json')).sort(); } catch { return; }
    for (const f of files) {
      const p = join(cmdDir(this.home, this.pid), f);
      let c = null;
      try { c = JSON.parse(readFileSync(p, 'utf8')); } catch {}
      try { rmSync(p, { force: true }); } catch {}
      if (!c) continue;
      const r = this.apply(c);
      // What the window says back, for the board's own line (said: the command's stamp).
      const reply = (u) => { this.reply = { at: this.now(), stamp: c.stamp ?? null, text: typeof u === 'object' ? u.text : u, made: typeof u === 'object' ? u.made ?? null : null, warn: typeof u === 'object' && Boolean(u.warn) }; this.changed(); };
      if (r?.then) r.then(reply);
      else if (r) reply(r);
    }
  }
  snapshot() {
    const st = this.last = this.status() ?? this.last;
    return {
      v: 1, pid: this.pid, name: this.name, folder: tilde(this.folder), started: this.started, updated: this.now(), places: this.placesNow(), library: this.libraryNow(),
      model: { name: st.name ?? 'the model', on: Boolean(st.on), why: st.why ?? '', where: st.where ?? 'this Mac', limit: Math.max(1, st.limit ?? 1), wake: Boolean(this.wake) && !st.on && !/answering|loading/.test(st.why ?? '') }, mode: st.mode ?? 'ask',
      maxHours: this.maxHours, reply: this.reply ?? null,
      loops: this.loops.map((l) => ({ ...l, folder: tilde(l.folder), runs: l.runs.slice(-30), current: l.current ? { n: l.current.n, startedAt: l.current.startedAt, needs: l.current.needs, lines: l.current.lines, tests: l.current.tests ?? null } : null })),
      log: this.log.slice(-120),
    };
  }
  save() {
    this.dirty = false;
    try {
      mkdirSync(dirOf(this.home, this.pid), { recursive: true, mode: 0o700 });
      const tmp = `${stateFile(this.home, this.pid)}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.snapshot()), { mode: 0o600 });
      renameSync(tmp, stateFile(this.home, this.pid));
    } catch { /* the board shows the last one it read */ }
  }
  // The window closes: every loop ends with it, a run under way is stopped, and the files go.
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const h of this.handles.values()) h.kill();
    this.handles.clear();
    try { rmSync(dirOf(this.home, this.pid), { recursive: true, force: true }); } catch {}
  }
}

// /loop <n> <what>: every 7m · runs 5 · stop 18:30 · cap $1 · mode auto · steps 20 · ask on|off · go · skip ·
// undo [run] · redo [keep] [note] · note <text> · message <text> · again · stop · pause · run.
// Answers { id, op, … } or { error }.
export const LOOP_HELP = '/loop <n> every 7m · runs 5 · stop 18:30 · cap $1 · mode auto · steps 20 · ask on · go · skip · undo · redo <note> · note <text> · message <text> · again · stop · pause · run';
// A number then one of these words is a loop's rule; a number then a time ("/loop 10 minutes …") is a new loop.
const VERBS = 'every|pace|runs|after|until|stop|end|ends|cap|spend|steps|mode|ask|message|edit|undo|redo|over|note';
export const isLoopCommand = (text) => new RegExp(String.raw`^\d+(\s+(${VERBS})\b.*|\s+(again|go|skip|pause|run)\s*)?$`, 'is').test(String(text ?? '').trim());
export function loopCommand(text, { now = Date.now(), min = minSecs() } = {}) {
  const m = /^(\d+)\s*(\S*)\s*(.*)$/s.exec(String(text ?? '').trim());
  if (!m) return { error: LOOP_HELP };
  const id = Number(m[1]);
  const verb = m[2].toLowerCase();
  const rest = m[3].trim();
  const rule = (r) => (r.error ? { error: r.error } : { id, op: 'rule', rules: r.rules, note: r.note ?? '' });
  if (verb === 'every' || verb === 'pace') {
    const e = readEvery(rest, { kind: /until/i.test(rest) ? 'debug' : 'task', min });
    return e.error ? e : rule({ rules: { every: e.every, until: e.until }, note: e.note });
  }
  if (verb === 'runs' || verb === 'after') { const r = readRuns(rest); return r.error ? r : rule({ rules: { maxRuns: r.maxRuns } }); }
  if (verb === 'until' && /^done$/i.test(rest)) return rule({ rules: { every: null, until: true } });
  if ((verb === 'stop' && rest) || verb === 'until' || verb === 'end' || verb === 'ends') { const r = readStopAt(rest.replace(/^at\s+/i, ''), now); return r.error ? r : rule({ rules: { stopAt: r.stopAt } }); }
  if (verb === 'cap' || verb === 'spend') { const r = readCap(rest); return r.error ? r : rule({ rules: { usdCap: r.usdCap } }); }
  if (verb === 'steps') { const r = readSteps(rest); return r.error ? r : rule({ rules: { steps: r.steps } }); }
  if (verb === 'mode') {
    const w = rest.toLowerCase().replace(/\s+/g, '-');
    const mode = { manual: 'ask', ask: 'ask', 'accept-edits': 'edits', accept: 'edits', edits: 'edits', auto: 'auto', plan: 'plan', bypass: 'bypass' }[w];
    return mode ? rule({ rules: { mode } }) : { error: 'Mode: manual, accept edits, auto or plan' };
  }
  if (verb === 'ask') return /^(on|off)$/i.test(rest) ? rule({ rules: { askFirst: /on/i.test(rest) } }) : { error: 'Ask first: /loop <n> ask on, or ask off' };
  if (verb === 'message' || verb === 'edit') {
    if (!rest) return { error: 'A loop needs a message' };
    return rule({ rules: { message: rest, name: nameOf(rest), kind: guessKind(rest) } });
  }
  if (verb === 'undo') { const n = /^(?:run\s*)?(\d+)$/i.exec(rest); return { id, op: 'undo', n: n ? Number(n[1]) : null }; }
  if (verb === 'redo' || verb === 'over') { const k = /^keep\b\s*/i.exec(rest); return { id, op: 'redo', keep: Boolean(k), text: k ? rest.slice(k[0].length) : rest }; }
  if (verb === 'note') return rest ? { id, op: 'note', text: rest } : { error: 'A note needs words: /loop <n> note <text>' };
  if (['again', 'go', 'skip', 'stop', 'pause', 'run'].includes(verb) && !rest) return { id, op: verb };
  return { error: LOOP_HELP };
}

// One line about a loop, for the window's own notes (/loop alone lists them).
export function describe(l, now = Date.now()) {
  const pace = l.until ? 'until its job is done' : l.every ? `every ${everyWord(l.every)}` : 'at its own pace';
  const left = Math.max(0, Math.round((l.nextAt - now) / 1000));
  const state = l.current?.needs ? 'needs you' : l.current ? `running (run ${l.current.n})` : l.stuck ? `needs you: ${l.stuck}` : l.ready ? `run ${l.ready.n} waits for your go` : l.state === 'redoing' ? 'starting over' : l.state === 'paused' ? 'paused' : l.state === 'off' ? `waits: ${l.offWhy ?? 'the model is off'}` : l.state === 'done' ? `ended: ${l.doneWhy}` : l.state === 'stopped' ? 'stopped' : l.queued ? 'next in line' : `next run in ${left < 90 ? `${left}s` : `${Math.round(left / 60)}m`}`;
  return [l.kind, pace, ...limitWords(l), state].join(' · ');
}
