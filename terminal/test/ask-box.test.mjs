// The question box's keys (app/app-ask.mjs, 9 Oct 2026, the owner's pick "2 · Claude Code box"):
// the model's questions as tabs, ticks on any of them, the row you type into, the Submit page,
// and esc sending what was answered. Pure: no screen, no model.
import { test, expect } from 'bun:test';
import { askState, askKey, askPaste, askOptions, tabAnswer } from '../src/app/app-ask.mjs';

const K = (over = {}) => ({ upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, return: false, escape: false, tab: false, shift: false, ctrl: false, meta: false, backspace: false, delete: false, ...over });
const KEYS = { up: K({ upArrow: true }), down: K({ downArrow: true }), left: K({ leftArrow: true }), right: K({ rightArrow: true }), enter: K({ return: true }), esc: K({ escape: true }), tab: K({ tab: true }), stab: K({ tab: true, shift: true }), bs: K({ backspace: true }) };
// Presses keys one after another: a name above, or text typed (each string one chunk, as Ink gives it).
function press(req, keys, box = askState(req)) {
  let flash = null;
  for (const k of keys) {
    const r = KEYS[k] ? askKey(req, box, '', KEYS[k]) : askKey(req, box, k, K());
    if (r.flash) flash = r.flash;
    if (r.done) return { done: r.done, box, flash };
    box = r.box;
  }
  return { box, flash };
}

const footer = { question: 'What should the footer show?', header: 'Footer', options: ['Time left', 'Messages used'], about: ['A small clock', 'A count'], recommended: 0 };
const pages = { question: 'Which pages should get it?', header: 'Pages', options: ['Home', 'Settings', 'Reports'], about: ['', '', ''], recommended: -1 };
const two = { name: 'Ask', args: { ...footer, questions: [footer, pages] } };
const one = { name: 'Ask', args: { ...footer, questions: [footer] } };
// The app's own question (the check-in): one question, no tabs, no ticks.
const own = { name: 'Ask', args: { question: 'Am I on the right track?', options: ['Keep going'], about: ['I carry on.'], typeLabel: 'Tell me where to look…', typeAbout: 'Name a file.' } };

test('the rows: each choice with what it means, then the row you type into ("Type something…")', () => {
  expect(askOptions(footer)).toEqual([
    { label: 'Time left', choice: 'answer', text: 'Time left', about: 'A small clock', recommended: true },
    { label: 'Messages used', choice: 'answer', text: 'Messages used', about: 'A count', recommended: false },
    { label: 'Type something…', choice: 'type', about: '' },
  ]);
  expect(askOptions(own.args).at(-1)).toEqual({ label: 'Tell me where to look…', choice: 'type', about: 'Name a file.' });
  const box = askState(two);
  expect(box.tabs.map((t) => [t.header, t.ticks])).toEqual([['Footer', true], ['Pages', true]]);
  expect(askState(own).tabs.map((t) => [t.header, t.ticks])).toEqual([['Question 1', false]]);
});

test('enter with nothing ticked picks the choice you are on, and goes to the next question, then Submit', () => {
  let r = press(two, ['down', 'enter']);
  expect(r.box.at).toBe(1);
  expect(r.box.tabs[0].answer).toBe('Messages used');
  r = press(two, ['enter'], r.box);
  expect(r.box.at).toBe(2); // the Submit page
  r = press(two, ['enter'], r.box);
  expect(r.done).toEqual({ choice: 'answers', answers: ['Messages used', 'Home'] });
});

test('ticks on any of the model\'s questions: space or a number, in the list\'s order, with what you typed as one more', () => {
  const r = press(two, ['enter', ' ', '3', 'down', 'also on Help', 'enter', 'enter']);
  expect(r.done).toEqual({ choice: 'answers', answers: ['Time left', 'Home, Reports, also on Help'] });
  // A number ticks and unticks again; the type row's number goes to it.
  const b = press(two, ['2', '2', '1']).box;
  expect(b.tabs[0].ticked).toEqual([0]);
  expect(press(two, ['3']).box.tabs[0].selected).toBe(2);
});

test('the row you type into: letters, space and numbers type there; a letter on a choice starts your own answer', () => {
  let r = press(one, ['h', 'i 2', ' ', 'u']);
  expect(r.box.tabs[0].selected).toBe(2);
  expect(r.box.tabs[0].typed.value).toBe('hi 2 u');
  r = press(one, ['left', 'left', 'X', 'bs'], r.box); // ←/→ move in what you typed
  expect(r.box.tabs[0].typed).toMatchObject({ value: 'hi 2 u', cursor: 4 });
  expect(press(one, ['enter'], r.box).done).toEqual({ choice: 'answers', answers: ['hi 2 u'] });
  // One question: no Submit page, enter sends.
  expect(press(one, ['enter']).done).toEqual({ choice: 'answers', answers: ['Time left'] });
});

test('an empty row you type into sends nothing: it says so', () => {
  const r = press(one, ['3', 'enter']);
  expect(r.done).toBeUndefined();
  expect(r.flash).toBe('Type your answer first, or pick a choice');
});

test('back and forth: ←/→ and tab move between the questions and keep each one\'s answer and ticks', () => {
  let r = press(two, ['right', ' ', 'left']);
  expect(r.box.at).toBe(0);
  expect(r.box.tabs[1].ticked).toEqual([0]);
  r = press(two, ['tab', 'tab', 'tab', 'tab'], r.box);
  expect(r.box.at).toBe(2); // stops at Submit
  r = press(two, ['stab'], r.box);
  expect(r.box.at).toBe(1);
  // On the row you type into, ←/→ move the cursor while it has text, and change question while empty.
  r = press(two, ['down', 'down', 'down', 'left'], r.box);
  expect(r.box.at).toBe(0);
});

test('changing an earlier answer goes on to the next one not answered, else Submit', () => {
  let r = press(two, ['enter', 'enter']); // both answered, on Submit
  r = press(two, ['left', 'left', 'down', 'enter'], r.box);
  expect(r.box.at).toBe(2);
  expect(r.box.tabs[0].answer).toBe('Messages used');
  // Skipped with →, answered the second: back to the first.
  r = press(two, ['right', 'enter']);
  expect(r.box.at).toBe(0);
});

test('Submit with a question not answered sends it as null; esc sends what was answered (stopped), or a no', () => {
  // The second answered, back on the first (not answered), then tab twice to Submit.
  expect(press(two, ['right', 'enter', 'tab', 'tab', 'enter']).done).toEqual({ choice: 'answers', answers: [null, 'Home'] });
  expect(press(two, ['enter', 'esc']).done).toEqual({ choice: 'answers', answers: ['Time left', null], stopped: true });
  expect(press(two, ['esc']).done).toEqual({ choice: 'no' });
});

test('the app\'s own question: a number picks at once, no ticks, the typed row answers as before', () => {
  expect(press(own, ['1']).done).toEqual({ choice: 'answer', text: 'Keep going' });
  expect(press(own, [' ']).box.tabs[0].ticked).toEqual([]);
  expect(press(own, ['look in src', 'enter']).done).toEqual({ choice: 'answer', text: 'look in src' });
  expect(press(own, ['esc']).done).toEqual({ choice: 'no' });
});

test('a paste goes into the row you type into, on one line', () => {
  const box = askPaste(askState(one), 'two\nlines');
  expect(box.tabs[0].selected).toBe(2);
  expect(box.tabs[0].typed.value).toBe('two lines');
  expect(tabAnswer(box.tabs[0])).toBe('two lines');
});
