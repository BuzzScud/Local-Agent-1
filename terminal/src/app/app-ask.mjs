// The question box, the Claude Code way (9 Oct 2026, the owner's pick "2 · Claude Code box"):
// the model's questions in one box, a tab each (← ☐ Git guide ☐ Who gets it ✔ Submit →), ←/→
// or tab to go back and forth with the answers kept, and a last row you type into right there.
// Any of the model's questions may have several ticked (space or a number); enter with nothing
// ticked picks the choice you are on, and what you typed counts as one more tick. With more than
// one question a Submit page shows every answer before they go. Esc stops: the questions you
// answered still go to the model (the owner's pick), and it waits for your next message.
// The app's own questions (the check-in, stuck, the go-ahead) are one question with no ticks.
// Pure: (box, keys) → box, so the keys are tested without a screen; app-keys.mjs applies them.
import { editInput, insertText } from './edit-input.mjs';

// A question's rows: its choices, each with what it means (about), then the row you type into.
export function askOptions(a = {}) {
  return [
    ...(a.options ?? []).map((o, i) => ({ label: String(o), choice: 'answer', text: String(o), about: a.about?.[i] ?? '', recommended: i === a.recommended })),
    { label: a.typeLabel ?? 'Type something…', choice: 'type', about: a.typeAbout ?? '' },
  ];
}

// The questions a request holds: the model's come all together (questions); the app's are one.
export const askQuestions = (req) => (Array.isArray(req?.args?.questions) && req.args.questions.length ? req.args.questions : [req?.args ?? {}]);
const together = (req) => Array.isArray(req?.args?.questions) && req.args.questions.length > 0;

// The box as it opens: a tab per question, on the first row of the first.
export function askState(req) {
  const all = together(req);
  return {
    at: 0,
    tabs: askQuestions(req).map((q, i) => ({
      q, header: String(q.header ?? '').trim() || `Question ${i + 1}`,
      options: askOptions(q), selected: 0, ticked: [], typed: { value: '', cursor: 0 }, answer: null,
      ticks: (all || Boolean(q.several)) && (q.options ?? []).length > 0, // a question with no choices is a box to type in
    })),
  };
}

// The row you type into: its label without the "…", then what you typed ("Type something: also…").
export const typeLabel = (o) => String(o?.label ?? '').replace(/[….]+$/, '');

// The answer a tab gives as it stands: the ticked choices in the list's order, then what you typed;
// nothing ticked, the choice you are on. null: nothing to send yet (the empty row you type into).
export function tabAnswer(t) {
  const row = t.options[t.selected];
  const typed = t.typed.value.trim();
  if (!t.ticks) return row?.choice === 'type' ? typed || null : row?.text ?? null;
  const all = [...t.ticked].sort((x, y) => x - y).map((i) => t.options[i].text).concat(typed ? [typed] : []);
  if (all.length) return all.join(', ');
  return row?.choice === 'type' ? null : row?.text ?? null;
}

// What goes back to the agent when the box closes.
function sent(req, tabs, extra = {}) {
  if (together(req)) return { choice: 'answers', answers: tabs.map((t) => t.answer), ...extra };
  return { choice: 'answer', text: tabs[0].answer };
}
// Esc: the answered questions go (marked stopped), or nothing was answered and it is a no.
function stopped(req, tabs) {
  if (together(req) && tabs.some((t) => t.answer != null)) return sent(req, tabs, { stopped: true });
  return { choice: 'no' };
}

const printable = (ch, key) => Boolean(ch) && !key.ctrl && !key.meta && !key.escape && !key.return && !key.tab && !key.backspace && !key.delete && !/[\x00-\x1f\x7f]/.test(ch);
const oneLine = (s) => s.replace(/\r\n?|\n/g, ' ');

// One key on the box: { box } (unchanged when it did nothing), { done } (the answer, the box
// closes), and a flash to show when the key could not do what it asks.
export function askKey(req, box, ch, key) {
  const n = box.tabs.length;
  const multi = n > 1;
  const go = (at) => ({ box: { ...box, at: Math.max(0, Math.min(multi ? n : n - 1, at)) } });
  if (key.escape) return { done: stopped(req, box.tabs) };
  // The Submit page: enter sends, ← or shift+tab goes back to the questions.
  if (box.at === n) {
    if (key.return) return { done: sent(req, box.tabs) };
    if (key.leftArrow || (key.tab && key.shift)) return go(n - 1);
    return { box };
  }
  const t = box.tabs[box.at];
  const put = (nt) => ({ box: { ...box, tabs: box.tabs.map((x, i) => (i === box.at ? nt : x)) } });
  const onType = t.options[t.selected]?.choice === 'type';
  const typeAt = t.options.findIndex((o) => o.choice === 'type');
  // An answer for this tab: the one question is done; else on to the next one not answered, then Submit.
  const finish = (answer) => {
    const tabs = box.tabs.map((x, i) => (i === box.at ? { ...t, answer } : x));
    if (!multi) return { done: sent(req, tabs) };
    const next = [...tabs.keys()].find((i) => i > box.at && tabs[i].answer == null) ?? tabs.findIndex((x) => x.answer == null);
    return { box: { ...box, tabs, at: next >= 0 ? next : n } };
  };
  const tick = (i) => ({ ...t, selected: i, ticked: t.ticked.includes(i) ? t.ticked.filter((x) => x !== i) : [...t.ticked, i] });
  if (key.tab) return go(box.at + (key.shift ? -1 : 1));
  if (key.upArrow) return put({ ...t, selected: (t.selected + t.options.length - 1) % t.options.length });
  if (key.downArrow) return put({ ...t, selected: (t.selected + 1) % t.options.length });
  if (key.return) {
    const answer = tabAnswer(t);
    return answer == null ? { box, flash: 'Type your answer first, or pick a choice' } : finish(answer);
  }
  // On the row you type into, keys type (space and numbers too); ←/→ move in what you typed,
  // or go to the next question while it is empty.
  if (onType) {
    if ((key.leftArrow || key.rightArrow) && !t.typed.value) return multi ? go(box.at + (key.leftArrow ? -1 : 1)) : { box };
    const s = editInput(t.typed, ch, key);
    return s === t.typed ? { box } : put({ ...t, typed: { ...s, value: oneLine(s.value) } });
  }
  if (key.leftArrow || key.rightArrow) return multi ? go(box.at + (key.leftArrow ? -1 : 1)) : { box };
  if (ch === ' ') return t.ticks ? put(tick(t.selected)) : { box };
  if (/^[1-9]$/.test(ch)) {
    const i = Number(ch) - 1;
    if (i >= t.options.length) return { box };
    if (t.options[i].choice === 'type') return put({ ...t, selected: i });
    return t.ticks ? put(tick(i)) : finish(t.options[i].text);
  }
  // A letter on a choice starts your own answer: the row you type into takes it.
  if (printable(ch, key) && typeAt >= 0) return put({ ...t, selected: typeAt, typed: insertText(t.typed, oneLine(ch)) });
  return { box };
}

// A paste goes into the row you type into (one line), wherever you are in the question.
export function askPaste(box, text) {
  const t = box.tabs[box.at];
  const typeAt = t?.options.findIndex((o) => o.choice === 'type') ?? -1;
  if (!t || typeAt < 0) return box;
  const nt = { ...t, selected: typeAt, typed: insertText(t.typed, oneLine(String(text))) };
  return { ...box, tabs: box.tabs.map((x, i) => (i === box.at ? nt : x)) };
}
