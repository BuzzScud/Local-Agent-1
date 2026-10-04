// The conversation's rail (src/app/rail.jsx, design 2 of 29 Sep 2026): what came along in one
// line, a new file's first lines, a change's lines, the layout check as a step, the turn's end
// line, and what the working line says while a file is being written.
import { test, expect } from 'bun:test';
import React from 'react';
import { renderToString } from 'ink';
import { machineWords, writingWhat, doingWords, EndLine, CheckNode, ToolNode, UserStrip, WritingNode, ThinkingLive, ThoughtNode, gist, writtenSoFar } from '../src/app/rail.jsx';
import { ItemFrame, gapUnder } from '../src/app/screen.jsx';
import { runInPty } from './pty.mjs';
import { setup, quit } from './app-setup.mjs';
import { startFakeServer } from './fake-server.mjs';

const h = React.createElement;
const draw = (el, columns = 100) => renderToString(el, { columns });

test('what came along with the request is one line: the notes, the helpers, the design cards, how it was sorted', () => {
  expect(machineWords({
    contexts: [{ items: [{ text: 'a' }, { text: 'b', skipped: true }] }, { title: 'Helpers', items: [{}, {}] }],
    design: ['your rules/rules', 'fable/widget'],
    sorted: 'Sorted as: task · step by step',
  })).toBe('1 note · helpers brought 2 · design: your rules + fable/widget · task, step by step');
  expect(machineWords({ sorted: 'Sorted as: question · step by step' })).toBe('question, step by step');
});

test('while a tool call is written, the working line names the file and counts its lines so far', () => {
  const w = { name: 'Write', args: '{"path":"/Users/x/Desktop/notification-card.html","content":"<!doctype html>\\n<html lang=\\"en\\">\\n<he' };
  expect(writingWhat(w)).toEqual({ name: 'Write', file: 'notification-card.html', lines: 3 });
  expect(doingWords({ writing: w })).toBe('writing notification-card.html');
  expect(writingWhat({ name: 'Bash', args: '{"command":"ls' })).toEqual({ name: 'Bash', file: null, lines: 0 });
  expect(doingWords({ running: { label: 'Bash', arg: 'ls' } })).toBe('running Bash');
  expect(doingWords({ thinking: { text: 'hm' } })).toBe('thinking');
  expect(writingWhat(null)).toBeNull();
});

test('the end line closes the turn: its time and counts, the layout problems left, or why it stopped', () => {
  const at = new Date('2026-09-29T22:30:18').getTime();
  expect(draw(h(EndLine, { it: { type: 'done', reason: 'done', past: 'Cooked', secs: 252, at, left: 0 }, counts: ' · 5 steps' }))).toBe('  ╰─ ⠿ Cooked for 4m 12s · 5 steps · done 10:30 PM');
  expect(draw(h(EndLine, { it: { type: 'done', reason: 'done', past: 'Cooked', secs: 252, at, left: 2 }, counts: ' · 5 steps' }))).toBe('  ╰─ ✗ Ended with 2 layout problems left · Cooked for 4m 12s · 5 steps · done 10:30 PM');
  expect(draw(h(EndLine, { it: { type: 'done', reason: 'interrupted', text: 'Interrupted · What should Agentic Coder do instead?', at } }))).toBe('  ╰─ ■ Interrupted · What should Agentic Coder do instead?');
  expect(draw(h(EndLine, { it: { type: 'done', reason: 'stuck', text: 'Stopped: it was stuck', secs: 61, at } }))).toBe('  ╰─ Stopped: it was stuck · 1m 01s · 10:30 PM');
  expect(draw(h(EndLine, { it: { type: 'done', reason: 'done', past: 'Worked', secs: 0.4, at } }))).toBe('  ╰─ ⠿ done 10:30 PM');
});

test('the layout check is a step that names each problem; after the fix it says what is left, or that nothing broke', () => {
  const problems = ['Text is too faint to read at 1440×900: "New" (span.badge) is #ffffff on #2a78d6 (4.4:1; needs 4.5:1).', 'Text is too faint to read at 1440×900: "View" (button#viewBtn) is #ffffff on #2a78d6 (4.4:1; needs 4.5:1).'];
  const first = draw(h(CheckNode, { check: { page: 'Desktop/notification-card.html', problems, secs: 0.6, again: false } }), 200);
  expect(first).toContain('◎ Layout check  Desktop/notification-card.html  ✗ 2 problems · 1440 px, phone, dark · 0.6 s · sent back to fix');
  expect(first).toContain('  │ Text is too faint to read at 1440×900: "New" (span.badge) is #ffffff on #2a78d6 (4.4:1; needs 4.5:1).');
  expect(draw(h(CheckNode, { check: { page: 'card.html', problems, secs: 0.5, again: true } }), 200)).toContain('✗ 2 problems left · 1440 px, phone, dark · 0.5 s');
  expect(draw(h(CheckNode, { check: { page: 'card.html', problems, secs: 0.5, again: true, sent: false } }), 200)).not.toContain('sent back to fix');
  // the second of two rounds (agent.mjs LAYOUT_ROUNDS): what is left goes back again, and says so
  expect(draw(h(CheckNode, { check: { page: 'card.html', problems, secs: 0.5, again: true, sent: true } }), 200)).toContain('✗ 2 problems left · 1440 px, phone, dark · 0.5 s · sent back to fix');
  expect(draw(h(CheckNode, { check: { page: 'card.html', problems: [], secs: 0.5, again: false } }), 200)).toContain('◎ Layout check  card.html  ✓ nothing broken · 1440 px, phone, dark · 0.5 s');
});

test('a new file shows its first 8 lines plain; a change shows only its changed lines', () => {
  const hunk = Array.from({ length: 20 }, (_, i) => ({ type: '+', newNo: i + 1, text: `line ${i + 1}` }));
  const made = draw(h(ToolNode, { it: { label: 'Write', arg: '/x/page.html', view: { kind: 'diff', created: true, path: 'page.html', hunk, additions: 20, removals: 0 } } }));
  expect(made).toContain('✎ Created  page.html · 20 lines · 151 B'); // 131 characters and 20 line ends
  expect(made).toContain('  │    8  line 8');
  expect(made).not.toContain('line 9');
  expect(made).toContain('… 12 more lines  (ctrl+o to see it)');
  const edit = draw(h(ToolNode, { it: { label: 'Update', arg: '/x/page.html', view: { kind: 'diff', created: false, path: 'page.html', additions: 1, removals: 1, hunk: [
    { type: ' ', oldNo: 1, newNo: 1, text: 'keep' }, { type: '-', oldNo: 2, text: 'color:#fff;' }, { type: '+', newNo: 2, text: 'color:#e8f1ff;' }, { type: ' ', oldNo: 3, newNo: 3, text: 'keep too' }] } } }));
  expect(edit).toContain('✎ Changed  page.html · 1 line');
  expect(edit).toContain('   2  - color:#fff;');
  expect(edit).toContain('   2  + color:#e8f1ff;');
  expect(edit).not.toContain('keep');
});

test('a turn\'s steps hang on the rail with no blank line between them; your message is a strip as wide as the window', () => {
  const step = { key: 'i1', type: 'text', text: 'Done.', rail: true };
  expect(draw(h(ItemFrame, { it: step, width: 60 })).split('\n')).toEqual(['  │', '  ● Done.']);
  expect([gapUnder(step), gapUnder({ type: 'done', rail: true }), gapUnder({ type: 'user' }), gapUnder({ type: 'note' })]).toEqual([0, 1, 0, 1]);
  // (without colours Ink trims the spaces; on screen all three rows are the window's width, on grey)
  const strip = draw(h(UserStrip, { text: 'make a card', width: 40 }), 40).split('\n');
  expect(strip).toEqual(['', ' › make a card', '']);
});

// The real app, with a stand-in model that writes a page slowly: while the file is being written,
// the rail shows it and the working line names it.
test('while it writes a file, the rail says which and how many lines so far', async () => {
  const { cwd, env } = setup();
  const content = Array.from({ length: 80 }, (_, i) => `<p>line ${i + 1} of the page</p>`).join('\n');
  const fake = await startFakeServer([{ tool: { name: 'Write', args: { path: 'page.html', content } } }], { delayMs: 12 });
  const r = await runInPty({ cwd, env, cols: 120, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'make a page with 80 lines' }, { key: 'enter' },
    { wait: '✎ Writing  page.html' }, { sleep: 600 }, { snapshot: 'writing' }, { key: 'esc' }, { wait: 'Interrupted' }, ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.writing).toMatch(/✎ Writing {2}page\.html · \d+ lines?/);
  expect(r.snapshots.writing).toMatch(/[▰▱]{10} [\d.]+k? of [\d.]+k? reply room/);
  expect(r.snapshots.writing).toMatch(/╰─ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] [A-Z][a-z]+… \(\d+s · ↓ [\d.]+k? tokens this session · this step \d+s · (↓ [\d.]+ tok\/s · )?esc to interrupt\)/);
  expect(r.snapshots.writing).not.toContain('writing page.html'); // the row above says it
  expect(r.text).toMatch(/╰─ ■ Interrupted/);
}, 60_000);

// ————— The new live rows (countdown card, 1 Oct): meters against the limits, the lines arriving —————
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('the writing row: lines, a meter against the reply room (orange from 85%), tok/s, the last two lines numbered', () => {
  const content = Array.from({ length: 167 }, (_, i) => `line ${i + 1}`).join('\n');
  const writing = { name: 'Write', args: `{"path":"Desktop/countdown-card.html","content":"${JSON.stringify(content).slice(1, -1)}` };
  const out = plain(draw(h(WritingNode, { writing, room: 6144, used: 5700, tps: 11.4 })));
  expect(out).toContain('✎ Writing  countdown-card.html · 167 lines');
  expect(out).toContain('▰▰▰▰▰▰▰▰▰▱ 5.7k of 6.1k reply room · near the limit · 11.4 tok/s');
  expect(out).toMatch(/166 {2}line 166\n.*167 {2}line 167/);
  const calm = plain(draw(h(WritingNode, { writing, room: 6144, used: 3000 })));
  expect(calm).not.toContain('near the limit');
  expect(writtenSoFar('{"path":"a","content":"a \\"q\\"\\n\\tb')).toBe('a "q"\n  b');
});

test('thinking, live: a meter against its cap and the last three lines with its own breaks; done: the gist of it', () => {
  const thinking = { text: 'I need to look into this further.\n\nThe notes say the file exists.\nI should check it is complete.\nThen write the rest.', startedAt: 0, tokens: 3600 };
  const out = plain(draw(h(ThinkingLive, { thinking, now: 38_000, width: 100, cap: 4096 })));
  expect(out).toContain('◇ thinking · 38s · ▰▰▰▰▰▰▰▱ 3.6k of 4.1k');
  expect(out).toContain('The notes say the file exists.');
  expect(out).toContain('Then write the rest.');
  expect(out).not.toContain('I need to look into this further'); // only the last three lines
  expect(gist('I need to look into this further. Let me check the details.\n\nMy notes claim that Desktop/countdown-card.html has already been created. But wait')).toBe('My notes claim that Desktop/countdown-card.html has already been created');
  expect(gist('I have thought enough. Now I act on it.')).toBe('');
  expect(plain(draw(h(ThoughtNode, { it: { text: 'countdown-card.html already exists in the Desktop. Let me check it.', secs: 4.2 } })))).toContain('◇ thought 4s · countdown-card.html already exists in the Desktop  (ctrl+o)');
});

// The screenshot of 1 Oct: a Write cut off at the reply limit left its "Writing … lines so far" row
// up (and "writing <file>" on the working line) while the app went on to something else.
test('a Write cut off at the reply limit leaves no Writing row behind; its whole lines are saved', async () => {
  const { cwd, env } = setup();
  const lines = Array.from({ length: 30 }, (_, i) => `<p>line ${i + 1} of the card</p>`);
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'card.html', content: `${lines.join('\n')}\n<p>line 31 of the ca` } }, finish: 'length' },
    { text: 'Saved the first part.' }, { text: '{"done": true, "missing": ""}' },
  ], { delayMs: 4 });
  // The saved part goes through the usual Write, so it asks as ever.
  const r = await runInPty({ cwd, env, cols: 120, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'make card.html' }, { key: 'enter' },
    { wait: 'saving its first 30 lines' }, { wait: 'Create file' }, { key: 'enter' }, { wait: 'Saved the first part.' }, { sleep: 400 }, { snapshot: 'after' }, ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.after).toMatch(/· File too long for one reply \(cut at [\d.]+k? of [\d.]+k? tokens\): saving its first 30 lines, then carrying on from there/);
  expect(r.snapshots.after).not.toContain('✎ Writing');
  expect(r.snapshots.after).toMatch(/✎ Created {2}card\.html · 30 lines/);
}, 60_000);
