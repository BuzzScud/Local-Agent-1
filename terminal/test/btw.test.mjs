// /btw's parts without the app: what the side question sees, how it is cut
// to the room left, and how the panel lays the answer out.
import { test, expect } from 'bun:test';
import { conversationParts, rightNow, roomFor, sideMessages, BTW_SYSTEM, MIN_ROOM, ANSWER_TOKENS } from '../src/agent/btw.mjs';
import { answerRows, btwLayout } from '../src/app/screen.jsx';

const convo = [
  { role: 'system', content: 'SYSTEM PROMPT '.repeat(200) },
  { role: 'user', content: 'fix the failing date test\n\n<file path="src/when.mjs">\n1\tconst x = 1;\n</file>' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ path: 'test/when.test.mjs' }) } }] },
  { role: 'tool', tool_call_id: 'a', content: Array.from({ length: 200 }, (_, i) => `${i + 1}\tline ${i + 1}`).join('\n') },
  { role: 'user', content: '[Automatic note from Agentic Coder, not from the user] The tests fail (output above). Find what is wrong.' },
  { role: 'assistant', content: 'The day was read in UTC; I switched it to local time.' },
];

test('the copy: every message in order, no system prompt, results cut, attached files by name only', () => {
  const parts = conversationParts(convo);
  expect(parts.join('\n')).not.toContain('SYSTEM PROMPT');
  expect(parts[0]).toBe('User: fix the failing date test\n\n[attached file src/when.mjs]');
  expect(parts[1]).toBe('Agentic Coder used Read(test/when.test.mjs)');
  expect(parts[2].startsWith('  Result: 1\tline 1')).toBe(true);
  expect(parts[2]).toMatch(/… \(\d+ more lines cut\)$/);
  expect(parts[2].length).toBeLessThan(460);
  expect(parts[3]).toStartWith("(Agentic Coder's own note to itself: The tests fail");
  expect(parts[4]).toBe('Agentic Coder: The day was read in UTC; I switched it to local time.');
});

test('right now: working (time, step, tool) or idle, and the to-do list', () => {
  const live = { phase: 'working', turnStart: 1_000, flowStep: { index: 1, count: 4, text: 'find the cause' }, running: { label: 'Bash', arg: 'bun test' } };
  const s = rightNow({ busy: true, live, todos: [{ text: 'read the test', status: 'done' }, { text: 'run the tests', status: 'in_progress' }], now: 1_000 + 252_000 });
  expect(s).toContain('still working on the last request (4m 12s so far), on step 2 of 4: find the cause, running Bash(bun test).');
  expect(s).toContain('[done] read the test');
  expect(s).toContain('[doing now] run the tests');
  expect(rightNow({ busy: false, live: { phase: 'idle' } })).toBe('Right now Agentic Coder is idle, waiting for the user.');
});

test('room: the pool less the conversation, its reply room while it works, the answer and a margin', () => {
  expect(roomFor({ ctx: 16384, ctxUsed: 4000, busy: false, thinking: false })).toBe(16384 - 4000 - ANSWER_TOKENS - 256);
  expect(roomFor({ ctx: 16384, ctxUsed: 4000, busy: true, thinking: false })).toBe(16384 - 4000 - 2048 - ANSWER_TOKENS - 256);
  expect(roomFor({ ctx: 16384, ctxUsed: 4000, busy: true, thinking: true })).toBe(16384 - 4000 - 4096 - ANSWER_TOKENS - 256);
  // the thinking part follows the model's own budget (Gemma: 4,096 since 28 Sep)
  expect(roomFor({ ctx: 16384, ctxUsed: 4000, busy: true, thinking: true, budget: 4096 })).toBe(16384 - 4000 - 6144 - ANSWER_TOKENS - 256);
  // the worst case (the conversation at 85% with its reply room) still leaves a question room at 16k
  expect(roomFor({ ctx: 16384, ctxUsed: Math.floor(16384 * 0.85) - 2048, busy: true, thinking: false })).toBeGreaterThan(MIN_ROOM);
});

test('the side messages: short instructions + the conversation + right now + the question; the oldest part goes first when short of room', () => {
  const now = 'Right now Agentic Coder is idle, waiting for the user.';
  const full = sideMessages({ messages: convo, question: 'eta?', now, room: 4000 });
  expect(full[0]).toEqual({ role: 'system', content: BTW_SYSTEM });
  expect(full).toHaveLength(2);
  expect(full[1].content).toStartWith('The conversation so far (long outputs are cut):\n\nUser: fix the failing date test');
  expect(full[1].content).toEndWith(`${now}\n\nThe side question: eta?`);
  // a tight room: the start is left out, the latest part and the question stay
  const long = [...convo.slice(0, 2), ...Array.from({ length: 30 }, (_, i) => ({ role: 'assistant', content: `step ${i + 1}: ${'looked at the code '.repeat(15)}` })), ...convo.slice(2)];
  const tight = sideMessages({ messages: long, question: 'eta?', now, room: 700 });
  expect(tight[1].content).toContain('left out to fit');
  expect(tight[1].content).not.toContain('fix the failing date test');
  expect(tight[1].content).toContain('I switched it to local time.');
  expect(tight[1].content).toContain('The side question: eta?');
  // below the floor: nothing is sent
  expect(sideMessages({ messages: convo, question: 'eta?', now, room: MIN_ROOM - 1 })).toBeNull();
});

test('the panel rows: words wrap at the width, lists hang, bold stays bold across a wrap, code is cut', () => {
  const rows = answerRows('**A guess:** about four minutes more if the tests pass.\n\n- one short item\n- a longer item that has to wrap onto the next row here\n\n```\nconst veryLongLineOfCodeThatIsCut = 1;\n```', 30);
  const text = rows.map((r) => r.map((p) => p.t).join(''));
  expect(text[0]).toBe('A guess: about four minutes');
  expect(rows[0][0]).toEqual({ t: 'A', s: 'bold' });
  expect(text).toContain('• one short item');
  const at = text.indexOf('• a longer item that has to');
  expect(at).toBeGreaterThan(0);
  expect(text[at + 1].startsWith('  ')).toBe(true); // the hanging indent
  expect(text.at(-1)).toBe('  const veryLongLineOfCodeThat');
  for (const t of text) expect(t.length).toBeLessThanOrEqual(30);
});

test('the panel layout: follows the end while it writes, starts at the top when done, scroll is clamped', () => {
  const text = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
  const base = { width: 100, rows: 30 };
  const writing = btwLayout({ ...base, btw: { question: 'eta?', text, phase: 'writing', scroll: null } });
  expect(writing.view).toBe(30 - 12 - 1);
  expect(writing.offset).toBe(40 - writing.view);
  const done = btwLayout({ ...base, btw: { question: 'eta?', text, phase: 'done', scroll: null } });
  expect(done.offset).toBe(0);
  expect(btwLayout({ ...base, btw: { question: 'eta?', text, phase: 'done', scroll: 999 } }).offset).toBe(done.maxOffset);
  expect(btwLayout({ ...base, btw: { question: 'eta?', text: 'short', phase: 'done', scroll: null } }).view).toBe(3);
  const answering = btwLayout({ ...base, btw: { question: 'eta?', text: '', phase: 'answering', scroll: null } });
  expect(answering.panelRows).toBe(1 + 1 + 1 + 1 + 1 + 1 + 1);
});

test('the panel rows fit inside its padding, and a bold still being written shows bold', () => {
  const b = { question: 'eta?', text: 'The full 28-task run would take another 30+ minutes. I would offer that as a separate step rather than run it.', phase: 'done', scroll: null };
  const L = btwLayout({ width: 80, rows: 24, btw: b });
  for (const r of L.rows) expect(r.map((p) => p.t).join('').length).toBeLessThanOrEqual(80 - 8);
  expect(L.rows.map((r) => r.map((p) => p.t).join('')).join(' ')).toBe(b.text);
  const writing = btwLayout({ width: 80, rows: 24, btw: { ...b, text: '**Rough gues', phase: 'writing' } });
  expect(writing.rows[0]).toEqual([{ t: 'Rough', s: 'bold' }, { t: ' ', s: null }, { t: 'gues', s: 'bold' }]);
});

test('right now names the request being worked on and its steps so far', () => {
  const s = rightNow({ busy: true, live: { phase: 'working', turnStart: 0 }, messages: convo, now: 5_000 });
  expect(s).toContain('The request it is working on: "fix the failing date test [attached file src/when.mjs]"');
  expect(s).toContain('Steps taken for it so far (1): Read(test/when.test.mjs)');
  expect(rightNow({ busy: false, live: { phase: 'idle' }, messages: convo })).not.toContain('working on');
});
