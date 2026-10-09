// Questions in plain words (3 Oct 2026). A question to you is one or more
// questions asked one after another, each with up to four choices; a choice
// has a short label, a line saying what it means for you (shown under the
// list for the choice you are on), and may be the one recommended. A
// question may let you tick several choices. The app's own questions (the
// go-ahead before a change, the check-in, the stuck question) say what it did
// in everyday words, with a file's name at the end.
import { basename, dirname } from 'node:path';

// Five (4 Oct 2026): the owner asks for "up to 5 clarifying questions" and picks each in the window.
const MAX_QUESTIONS = 5;
const MAX_CHOICES = 4;
const RECOMMENDED = /\s*[([]\s*recommended\s*[)\]]\s*$/i;
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// One choice as a model wrote it: a string, or { label, about, recommended }
// (also text/name/title and description/detail/example, which small models send).
function choiceOf(o) {
  if (o && typeof o === 'object') {
    const raw = String(o.label ?? o.text ?? o.name ?? o.title ?? o.answer ?? o.option ?? '').trim();
    const about = clip(o.about ?? o.description ?? o.detail ?? o.details ?? o.explanation ?? o.example ?? '', 160);
    return { label: clip(raw.replace(RECOMMENDED, ''), 80), about, recommended: o.recommended === true || RECOMMENDED.test(raw) };
  }
  const raw = String(o ?? '').trim();
  return { label: clip(raw.replace(RECOMMENDED, ''), 80), about: '', recommended: RECOMMENDED.test(raw) };
}

// One question: { question, options: [labels], about: [lines], recommended: index or -1, several }.
function questionOf(q) {
  const seen = new Set();
  const choices = [];
  for (const c of (Array.isArray(q?.options) ? q.options : []).map(choiceOf)) {
    const k = c.label.toLowerCase();
    if (!c.label || seen.has(k)) continue;
    seen.add(k);
    choices.push(c);
    if (choices.length === MAX_CHOICES) break;
  }
  return {
    question: String(q?.question ?? '').trim(),
    options: choices.map((c) => c.label),
    about: choices.map((c) => c.about),
    recommended: choices.findIndex((c) => c.recommended),
    several: q?.several === true && choices.length > 1,
  };
}

// The Ask tool's arguments as the questions to ask, in order (at most four):
// the first is question/options/several, the rest come in more (or questions).
export function askedQuestions(args = {}) {
  const extra = Array.isArray(args.more) ? args.more : Array.isArray(args.questions) ? args.questions : [];
  const first = args.question ? [args] : [];
  return [...first, ...extra].map(questionOf).filter((q) => q.question).slice(0, MAX_QUESTIONS);
}

// A file as you would say it: its name, and the folder when that helps
// ("social-feed-post.html on your Desktop", "export.mjs in src").
export function fileSaid(rel) {
  const p = String(rel ?? '').replace(/^\.\//, '').replace(/^~\//, '');
  const name = basename(p);
  const dir = dirname(p);
  if (!p || dir === '.' || dir === '') return name;
  if (/^Desktop$/i.test(dir)) return `${name} on your Desktop`;
  return `${name} in ${dir}`;
}

const lines = (n) => `${n} line${n === 1 ? '' : 's'}`;

// The go-ahead before the first change, in plain words: what will happen, the file last.
export function planSaid(name, args = {}, prepared = {}) {
  const where = fileSaid(prepared.rel ?? args.path);
  if (name === 'Write') return prepared.created ? `make a new file, ${where}` : `replace what is in ${where}`;
  const changed = Math.max(prepared.additions ?? 0, prepared.removals ?? 0);
  return `change ${changed ? lines(changed) : 'one part'} of ${where}`;
}

// A focused change's files, in plain words ("change 3 lines of export.mjs and 1 line of cli.mjs").
export function changesSaid(changes) {
  const each = changes.map((c) => `${lines(Math.max(c.additions ?? 0, c.removals ?? 0, 1))} of ${fileSaid(c.rel)}`);
  return `change ${each.length > 1 ? `${each.slice(0, -1).join(', ')} and ${each.at(-1)}` : each[0]}`;
}

// One look, as the check-in lists it: the file read, the folder listed, the words searched for.
export function lookSaid(name, args = {}) {
  const path = args.path ?? args.paths?.[0] ?? '';
  switch (name) {
    case 'Read': return Array.isArray(args.paths) && args.paths.length > 1 ? `${args.paths.length} files` : fileSaid(path) || 'a file';
    case 'List': return !path || path === '.' ? 'the list of files here' : `the files in ${fileSaid(path)}`;
    case 'Search': return `everywhere "${clip(args.pattern ?? args.query ?? '', 40)}" appears`;
    case 'CodeSearch': return `the code for "${clip(args.query ?? '', 40)}"`;
    case 'Map': return 'a map of the project';
    case 'WebSearch': return `the web for "${clip(args.query ?? '', 40)}"`;
    case 'WebFetch': { try { return `a web page on ${new URL(args.url).hostname}`; } catch { return 'a web page'; } }
    case 'Bash': return 'the output of a command';
    default: return name;
  }
}

// One step as the stuck question names it: the command it ran, the file it changed, else what it
// looked at ("running npm test", "changing export.mjs in src", "looking at the files in src").
// A script typed into the command (a heredoc) is named by its first line, not its body run together.
export function stepSaid(name, args = {}) {
  const cmd = String(args.command ?? '').trim();
  if (name === 'Bash' && cmd) return `running ${cmd.includes('\n') ? `${clip(cmd.split('\n')[0], 76)} …` : clip(cmd, 80)}`;
  if (['Edit', 'Update', 'Write'].includes(name) && args.path) return `${name === 'Write' ? 'writing' : 'changing'} ${fileSaid(args.path)}`;
  return `looking at ${lookSaid(name, args)}`;
}

// "a, b and c" (and "and 3 more" past six).
function listSaid(items, max = 6) {
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0] ?? '';
}

const minutes = (secs) => { const m = Math.round(secs / 60); return m < 1 ? 'under a minute' : `${m} minute${m === 1 ? '' : 's'}`; };

// The check-in: how long it has looked, what at, and the choice to go on.
export function checkInQuestion(looked, secs) {
  return {
    question: `I have spent ${minutes(secs)} looking around and have not changed anything yet. I looked at ${listSaid(looked)}. Am I on the right track?`,
    options: ['Keep going'],
    about: ['I carry on the way I am going.'],
    typeLabel: 'Tell me where to look…',
    typeAbout: 'Name a file, a page or a part of the app, and I start there.',
  };
}

// The words of a failed step that say what went wrong. A command's output: the last line that
// reads as an error (a Python traceback ends with it), with the line number the traceback gives,
// else its last line; never the app's own "(exit code 1)" or make's "*** Error 1". Other tools: their first line.
// 4 Oct 2026: a script that printed "=== MNQ ===" before its traceback was asked about as
// "The last one said: === MNQ ===".
const ERROR_LINE = /\w*(Error|Exception)\b|\berror\b|\bfatal\b|no such file|not found|denied|refused|cannot|can't|failed|invalid/i;
export function errorSaid(name, text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (name !== 'Bash') return clip(lines[0] ?? '', 160);
  const said = lines.filter((l) => !/^\((exit code -?\d+|stopped after [^)]*)\)$/.test(l) && !/^… \d+ lines cut …$/.test(l));
  const hit = said.findLastIndex((l) => ERROR_LINE.test(l) && !/^(Traceback \(most recent call last\)|make(\[\d+\])?: \*\*\*)/.test(l));
  const at = hit >= 0 ? hit : said.length - 1;
  if (at < 0) return '';
  const line = said.slice(Math.max(0, at - 3), at).reverse().map((l) => l.match(/\bline (\d+)\b/)?.[1]).find(Boolean);
  return clip(`${said[at]}${line && !/\bline \d+/.test(said[at]) ? ` (line ${line})` : ''}`, 160);
}

// A request that asks to be asked ("Ask me up to 5 clarifying questions…"): the questions go through
// the Ask tool as choices picked in the window, never as text (4 Oct 2026, the owner's ask).
export const wantsQuestions = (text) => /\bask (?:me|the user)\b[^.?!\n]{0,40}\bquestions?\b|\b(?:clarifying|follow[- ]up) questions?\b/i.test(String(text ?? ''));
// Questions written out as text: lines (or list items) that end with a question mark.
export const questionLines = (text) => String(text ?? '').replace(/```[\s\S]*?```/g, ' ').split('\n').filter((l) => /\?\s*[*_)"'”]*\s*$/.test(l.trim())).length;
// The note that goes with such a request (agent.mjs turn.asks).
export const ASK_NOTE = 'The request asks for questions. Put them to the user with the Ask tool, never as text: each with 2 to 4 choices, a few words each with an about line, and up to 5 questions in one Ask (question, then the rest in more). When the request also asks for an outline or a plan, write that first as your reply\'s text, then call Ask in the same reply.';

// After "no, this is wrong" about a page it made: what is wrong, as choices (4 Oct 2026, the owner's
// pick: the answer went back alone, and the model rewrote the same page three times).
export function pageWrongQuestion(names) {
  return {
    question: `What is wrong with ${names}?`,
    options: ['Not what I asked', 'Parts are missing', 'Wrong place', 'It looks wrong'],
    about: ['It is about something else than your request.', 'It is on the right subject but leaves things out.', 'It is saved somewhere you did not want.', 'The content is right; the look is not.'],
    typeLabel: 'Say what is wrong…',
    typeAbout: 'In your own words.',
  };
}

// Stuck: the same step again and again, or three that failed (5 Oct 2026, the owner's picks after "I tried the
// same step twice (…) and I am not getting further. What should I do?" with one choice, Keep going, which let it
// do the same again). The question says what it is working on (its plan's step), what it tried, how often and
// what came of it; the choices are ways out. step: the step in words (stepSaid); err: errorSaid.
export function stuckQuestion(why, step, err, { tries = 3, goal = '', result = '' } = {}) {
  const end = /[.!?]$/.test(err ?? '') ? '' : '.';
  return {
    question: why === 'repeat'
      ? `I am going round in circles${goal ? ` on "${clip(goal, 70)}"` : ''}: I tried ${step} ${tries} times and nothing changed${result ? ` (${result})` : ''}. What should I do?`
      : `Three steps in a row did not work. The last one (${step}) ${err ? `ended with: ${err}${end}` : 'gave no error words.'} What should I do?`,
    options: ['Try a different way', 'Skip this step', 'Stop here'],
    about: ['I drop this approach and take another.', 'I leave this step and go on with the rest.', 'I stop and tell you where things stand.'],
    typeLabel: 'Give me a hint…',
    typeAbout: 'Say what to try, or where to look, and I follow that.',
  };
}
// The step limit reached with the work not done (9 Oct 2026, the owner's pick: ask, rather than stop
// or no limit). Keep going gives it as many steps again; stop ends the message as before.
export function limitQuestion(steps, { goal = '' } = {}) {
  return {
    question: `I have taken ${steps} steps${goal ? ` and am on "${clip(goal, 70)}"` : ''}, and the task is not done yet. Keep going?`,
    options: ['Keep going', 'Stop here'],
    about: [`I carry on for up to ${steps} more steps.`, 'I stop now, at this step, as before.'],
    typeLabel: 'Tell me what to do next…',
    typeAbout: 'Say what to focus on, and I carry on with that.',
  };
}
// What a repeated step gave, in a few words, for the question.
export function sameResultSaid(name, outText = '') {
  if ((name === 'Write' || name === 'Edit') && /\(\+0 −0 lines\)/.test(outText)) return 'the file already holds that content';
  if (name === 'Read') return 'I have read it already';
  const line = String(outText).split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line ? `it answered: ${clip(line, 90)}` : '';
}
// The second time the same step comes, the model is told why nothing changed, each kind of step in its own
// words; the user is not asked yet. next: the next step of its plan. '' for a Read: Read answers for itself
// (the part after, or "it is above", and the third time the text again).
export function sameStepNote(name, outText = '', next = '') {
  const go = next ? ` Go on to the next step of your plan: ${clip(next, 120)}.` : ' Go on to the next step.';
  if ((name === 'Write' || name === 'Edit') && /\(\+0 −0 lines\)/.test(outText)) return `(That ${name === 'Write' ? 'write' : 'change'} changed nothing: the file already holds exactly this, and it is saved. Do not send it again.${go})`;
  if (name === 'Read') return '';
  if (name === 'Bash') return '(The same command gave the same result as before: nothing has changed since. Change something first, or do something else. Do not run it again as it is.)';
  if (['List', 'Search', 'Map', 'CodeSearch', 'WebFetch', 'WebSearch'].includes(name)) return '(You asked exactly this before and the answer is the same; it is above. Use it, or look somewhere else.)';
  return '(You already did exactly this step, and nothing changed. Do something different, or finish.)';
}

// The go-ahead before changing files: yes covers the rest of this request's changes.
export function planQuestion(plan) {
  return {
    question: `Before I change anything: I will ${plan}. Go ahead?`,
    options: ['Yes, go ahead'],
    about: ['I make this change, and any others this request needs, without asking again.'],
    recommended: 0,
    typeLabel: 'Change something first…',
    typeAbout: 'Tell me what to do instead, and I do that.',
  };
}
