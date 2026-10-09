// The conversation's rail (src/app/rail.jsx, design 2 of 29 Sep 2026): what came along in one
// line, a new file's first lines, a change's lines, the layout check as a step, the turn's end
// line, and what the working line says while a file is being written.
import { test, expect } from 'bun:test';
import React from 'react';
import { renderToString } from 'ink';
import { machineWords, writingWhat, doingWords, EndLine, CheckNode, ToolNode, UserStrip, WritingNode, ThinkingLive, ThoughtNode, gist, writtenSoFar, shortPath, shortCommand, foldSteps, LooksNode, outcome, MadeNode } from '../src/app/rail.jsx';
import { Markdown } from '../src/app/markdown.jsx';
import { C } from '../src/ui/theme.mjs';
import { homedir } from 'node:os';
import { ItemFrame, gapUnder, gapOver } from '../src/app/screen.jsx';
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

test('the end line closes the turn: how it went in one row, its counts in a row under it; the layout problems left, or why it stopped', () => {
  const at = new Date('2026-09-29T22:30:18').getTime();
  expect(draw(h(EndLine, { it: { type: 'done', reason: 'done', past: 'Cooked', secs: 252, at, left: 0 }, counts: ' · 5 steps' }))).toBe('  ╰─ ⠿ Cooked for 4m 12s · done 10:30 PM\n     5 steps');
  expect(draw(h(EndLine, { it: { type: 'done', reason: 'done', past: 'Cooked', secs: 252, at, left: 2 }, counts: ' · 5 steps' }))).toBe('  ╰─ ✗ Ended with 2 layout problems left · Cooked for 4m 12s · done 10:30 PM\n     5 steps');
  expect(draw(h(EndLine, { it: { type: 'done', reason: 'done', past: 'Juggled', secs: 2059, at, usd: 4.84 }, counts: ' · 60 steps · 31 reads' }))).toBe('  ╰─ ⠿ Juggled for 34m 19s · done 10:30 PM · $4.84 for this request\n     60 steps · 31 reads');
  expect(draw(h(EndLine, { it: { type: 'done', reason: 'interrupted', text: 'Interrupted · What should Agentic Coder do instead?', at } }))).toBe('  ╰─ ■ Interrupted · What should Agentic Coder do instead?');
  expect(draw(h(EndLine, { it: { type: 'done', reason: 'stuck', text: 'Stopped: it was stuck', secs: 61, at } }))).toBe('  ╰─ Stopped: it was stuck · 1m 01s · 10:30 PM');
  expect(draw(h(EndLine, { it: { type: 'done', reason: 'done', past: 'Worked', secs: 0.4, at } }))).toBe('  ╰─ ⠿ done 10:30 PM');
});

test('a long end line wraps under itself, not back at the window\'s edge (7 Oct 2026)', () => {
  const at = new Date('2026-09-29T22:30:18').getTime();
  const it = { type: 'done', reason: 'done', past: 'Whittled', secs: 10, at, left: 0, usd: 0.1 };
  const lines = renderToString(h(EndLine, { it, counts: ' · 1 step · ~99 thinking tokens · ↓ 525 tokens this session' }), { columns: 60 }).split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));
  expect(lines.length).toBeGreaterThan(1);
  expect(lines[0]).toMatch(/^  ╰─ ⠿ Whittled for 10s/);
  for (const l of lines.slice(1)) expect(l).toMatch(/^ {5}\S/); // every word of it, in its own column
  expect(lines.map((l) => l.trim()).join(' ')).toContain('$0.10 for this request');
});

test('paths and commands as short as they read the same: from the project inside it, from ~ elsewhere; a cd into the project left off', () => {
  const home = homedir(), proj = `${home}/Desktop/agentic-coder`;
  expect(shortPath(`${proj}/docs/map/MAP.md`, proj)).toBe('docs/map/MAP.md');
  expect(shortPath(`${proj}/docs/map/MAP.md`, home)).toBe('~/Desktop/agentic-coder/docs/map/MAP.md'); // working in the home folder: from ~
  expect(shortPath('/etc/hosts', proj)).toBe('/etc/hosts');
  expect(shortPath('export.mjs', proj)).toBe('export.mjs');
  expect(shortCommand(`cd ${proj} && git log -3`, proj)).toBe('git log -3');
  expect(shortCommand(`cd ${proj} && git log -3`, home)).toBe('cd ~/Desktop/agentic-coder && git log -3'); // elsewhere the cd says where, shorter
  expect(shortCommand(`ls -d ${home}/Desktop/x ${home}/.local/bin`, '/tmp')).toBe('ls -d ~/Desktop/x ~/.local/bin');
  const read = renderToString(h(ToolNode, { it: { type: 'tool', rail: true, label: 'Read', arg: `${proj}/docs/map/MAP.md`, view: { kind: 'read', lines: 8, total: 8 } }, cwd: proj }), { columns: 100 });
  expect(read).toContain('docs/map/MAP.md');
  expect(read).not.toContain(home);
  const ran = renderToString(h(ToolNode, { it: { type: 'tool', rail: true, label: 'Bash', arg: `cd ${proj} && bun test`, view: { kind: 'bash', lines: [], exit: 0 } }, cwd: proj }), { columns: 100 });
  expect(ran).toContain('bun test');
  expect(ran).not.toContain('cd ');
});

test('code in a reply keeps its indent when a long line wraps (7 Oct 2026)', () => {
  const md = 'Look:\n\n```js\nexport function toCsv(rows) {\n  return [HEADER, ...rows.map((r) => [r.symbol, r.side, r.qty, r.price].join(\',\'))].join(\'\\n\');\n}\n```';
  const lines = renderToString(h(Markdown, { text: md }), { columns: 50 }).split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));
  const code = lines.slice(lines.findIndex((l) => l.includes('export function')));
  expect(code.length).toBeGreaterThan(3); // the long line took more than one row
  for (const l of code.filter((x) => x.trim())) expect(l).toMatch(/^ {2}\S|^ {4}\S/); // none back at the edge
  expect(code.find((l) => l.includes('return'))).toMatch(/^ {4}return/); // its own indent kept
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

test('a new file shows its first 4 lines plain; a change shows only its changed lines, 6 at most', () => {
  const hunk = Array.from({ length: 20 }, (_, i) => ({ type: '+', newNo: i + 1, text: `line ${i + 1}` }));
  const made = draw(h(ToolNode, { it: { label: 'Write', arg: '/x/page.html', view: { kind: 'diff', created: true, path: 'page.html', hunk, additions: 20, removals: 0 } } }));
  expect(made).toContain('✎ Created  page.html · 20 lines · 151 B'); // 131 characters and 20 line ends
  expect(made).toContain('  │    4  line 4');
  expect(made).not.toContain('line 5');
  expect(made).toContain('… 16 more lines');
  expect(made).not.toContain('ctrl+o');
  const many = Array.from({ length: 9 }, (_, i) => ({ type: '+', newNo: i + 1, text: `new ${i + 1}` }));
  const big = draw(h(ToolNode, { it: { label: 'Update', arg: 'a.mjs', view: { kind: 'diff', path: 'a.mjs', additions: 9, removals: 0, hunk: many } } }));
  expect(big).toContain('+ new 6');
  expect(big).not.toContain('+ new 7');
  expect(big).toContain('… 3 more lines');
  const edit = draw(h(ToolNode, { it: { label: 'Update', arg: '/x/page.html', view: { kind: 'diff', created: false, path: 'page.html', additions: 1, removals: 1, hunk: [
    { type: ' ', oldNo: 1, newNo: 1, text: 'keep' }, { type: '-', oldNo: 2, text: 'color:#fff;' }, { type: '+', newNo: 2, text: 'color:#e8f1ff;' }, { type: ' ', oldNo: 3, newNo: 3, text: 'keep too' }] } } }));
  expect(edit).toContain('✎ Changed  page.html · 1 line');
  expect(edit).toContain('   2  - color:#fff;');
  expect(edit).toContain('   2  + color:#e8f1ff;');
  expect(edit).not.toContain('keep');
});

test('a turn\'s steps sit on consecutive rows, no empty rail row between them; a reply has room around it; your message is one grey row', () => {
  const step = { key: 'i1', type: 'tool', rail: true, label: 'Read', arg: 'a.mjs', view: { kind: 'read', lines: 3, total: 3 } };
  expect(draw(h(ItemFrame, { it: step, width: 60 })).split('\n')).toEqual(['  ○ Read  a.mjs · 3 lines']);
  const reply = { key: 'i2', type: 'text', text: 'Done.', rail: true };
  expect(draw(h(ItemFrame, { it: reply, width: 60 })).split('\n')).toEqual(['', '  ● Done.', '']);
  expect([gapUnder(step), gapUnder(reply), gapUnder({ type: 'done', rail: true }), gapUnder({ type: 'user' }), gapUnder({ type: 'note' })]).toEqual([0, 1, 1, 1, 1]);
  expect([gapOver(step), gapOver(reply), gapOver({ type: 'user' }), gapOver({ type: 'user', rail: true })]).toEqual([0, 1, 1, 0]);
  // (without colours Ink trims the spaces; on screen the row is the window's width, on grey)
  const strip = draw(h(UserStrip, { text: 'make a card', width: 40 }), 40).split('\n');
  expect(strip).toEqual([' › make a card']);
  // What went with it, one line, each as its card said it, cut at the strip's edge.
  const cards = [{ n: 2, text: '▣ [File #2] budget.xlsx · Excel · 3 sheets · 48 KB' }, { n: 3, text: '▣ [Folder #3] src · Folder · 23 files · 4.5 MB' }];
  expect(draw(h(UserStrip, { text: 'fix the totals in [File #2]', cards, width: 110 }), 110).split('\n')[1].trim()).toBe('▣ [File #2] budget.xlsx · Excel · 3 sheets · 48 KB   ▣ [Folder #3] src · Folder · 23 files · 4.5 MB');
  expect(draw(h(UserStrip, { text: 'fix it', cards, width: 50 }), 50).split('\n')[1].trim()).toBe('▣ [File #2] budget.xlsx · Excel · 3 sheets · …');
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
  expect(plain(draw(h(ThoughtNode, { it: { text: 'countdown-card.html already exists in the Desktop. Let me check it.', secs: 4.2 } })))).toBe('  ◇ countdown-card.html already exists in the Desktop  4s');
  // A ? inside quotes does not end the sentence (8 Oct 2026: 'The app tests all wait for the "').
  expect(gist('The app tests all wait for the "? for shortcuts" hint. Inside a window it may never show.')).toBe('The app tests all wait for the "? for shortcuts" hint');
  // A long one is cut to its row; its seconds stay whole.
  const long = plain(draw(h(ThoughtNode, { it: { text: 'This sandbox restriction on browsers and spawning is probably tied to how the home folder is set up.', secs: 3 } }), 60));
  expect(long).toMatch(/^ {2}◇ This sandbox restriction on browsers and spawning \S*…  3s$/);
  expect(long.length).toBeLessThanOrEqual(60);
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

// ————— Tight rail (8 Oct 2026, the owner's pick of two designs drawn on their own session) —————
const read = (key, path, lines = 10) => ({ key, rail: true, type: 'tool', label: 'Read', arg: path, view: { kind: 'read', lines, total: lines } });

test('reads, lists and searches in a row are one row; a run still open while the turn works is held for the live area', () => {
  const search = { key: 's', rail: true, type: 'tool', label: 'Search', arg: 'for shortcuts', view: { kind: 'search', count: 4 } };
  const ran = { key: 'b', rail: true, type: 'tool', label: 'Bash', arg: 'ls', view: { kind: 'bash', code: 0, lines: ['a'] } };
  const items = [read('r1', 'test/pty.mjs'), read('r2', 'test/app-setup.mjs'), search, read('r3', 'src/screen.jsx'), ran, read('r4', 'a.mjs'), read('r5', 'a.mjs')];
  const done = foldSteps(items);
  expect(done.printed.map((it) => it.type)).toEqual(['looks', 'tool', 'looks']);
  expect(done.printed[0].key).toBe('gr1');
  expect(done.held).toBeNull();
  const row = plain(draw(h(LooksNode, { list: done.printed[0].list }), 120));
  expect(row).toBe('  ○ Read  pty.mjs, app-setup.mjs  ·  Searched  “for shortcuts” 4  ·  Read  screen.jsx');
  expect(plain(draw(h(LooksNode, { list: done.printed[2].list }), 120))).toBe('  ○ Read  a.mjs ×2');
  // Working: the last run is not printed yet (a printed row never changes), it is held.
  const working = foldSteps(items, true);
  expect(working.printed.map((it) => it.type)).toEqual(['looks', 'tool']);
  expect(working.held.list.map((it) => it.key)).toEqual(['r4', 'r5']);
  // One look alone is itself, with its counts; an error is never folded.
  expect(foldSteps([read('r6', 'b.mjs')]).printed[0].key).toBe('r6');
  const failed = { ...read('r7', 'c.mjs'), error: true };
  expect(foldSteps([read('r8', 'd.mjs'), failed, read('r9', 'e.mjs')]).printed.map((it) => it.key)).toEqual(['r8', 'r7', 'r9']);
});

test('a command is one row with what it came to at its end: a test run\'s counts, an exit code, else its lines; two lines of its output under it', () => {
  expect(outcome('bun test ./terminal/test/rail.test.mjs', { code: 0, lines: ['bun test v1.4.2', '', ' 13 pass', ' 0 fail', ' 75 expect() calls'] })).toEqual({ end: '13 pass · 0 fail', color: C.ok });
  expect(outcome('node --test', { code: 1, lines: ['ℹ tests 4', 'ℹ pass 3', 'ℹ fail 1'] })).toEqual({ end: '3 pass · 1 fail · exit 1', color: C.bad });
  expect(outcome('grep -c x a.txt', { code: 1, lines: [] }).end).toBe('exit 1');
  // A search that found nothing (tools.mjs noMatch) is no failure: dim, not red.
  expect(outcome('grep x a.txt', { code: 1, lines: [], noMatch: true })).toEqual({ end: 'no lines matched', color: C.dim });
  expect(outcome('ls', { code: 0, lines: ['a', 'b', '… 120 lines cut …', 'y', 'z'] }).end).toBe('124 lines');
  expect(outcome('ls', { code: 0, lines: [] }).end).toBe('no output');
  // Words that look like counts in what a command that is no test printed are just its lines.
  expect(outcome('cat notes.txt', { code: 0, lines: ['22 passed, 2 failed last week'] }).end).toBe('1 line');
  expect(outcome('sleep 200', { timedOut: true, after: '2 minutes', lines: [] }).end).toBe('stopped after 2 minutes');
  const long = `sleep 100; grep -E " pass$| fail$|^Ran " SCRIPTS/unit-run.txt; grep -E "^\\(fail\\)" SCRIPTS/unit-run.txt | sort -u`;
  const out = plain(draw(h(ToolNode, { it: { label: 'Bash', arg: long, view: { kind: 'bash', code: 0, lines: ['(fail) one', '(fail) two', '(fail) three', ' 3 pass', ' 3 fail'] } } }), 80)).split('\n');
  expect(out.length).toBe(3); // the command's row and two lines of output, nothing wrapped
  expect(out[0]).toMatch(/^ {2}❯ Ran {2}sleep 100; grep .*… · 5 lines$/);
  expect(out.slice(1)).toEqual(['  │ (fail) one', '  │ (fail) two']);
  // A failed one shows its last two lines, where the error is.
  const failed = plain(draw(h(ToolNode, { it: { label: 'Bash', arg: 'node x.mjs', view: { kind: 'bash', code: 1, lines: ['start', 'at line 3', 'Error: boom'] } } }), 80)).split('\n');
  expect(failed).toEqual(['  ❯ Ran  node x.mjs · exit 1', '  │ at line 3', '  │ Error: boom']);
});

test('the fixes found on the way: a file outside the project by its own path, a job\'s row says its name once, Made is one row', () => {
  const tmp = plain(draw(h(ToolNode, { it: { label: 'Write', arg: '/tmp/agentic-replay.mjs', view: { kind: 'diff', created: true, path: '../../../../tmp/agentic-replay.mjs', hunk: [{ type: '+', newNo: 1, text: 'x' }], additions: 1 } } }), 100));
  expect(tmp).toContain('✎ Created  /tmp/agentic-replay.mjs · 1 line');
  const job = plain(draw(h(ToolNode, { it: { label: 'Jobs', arg: 'job2', view: { kind: 'job', what: 'job2 · running 1 min 56 s', lines: [] } } }), 100));
  expect(job).toBe('  ❯ Jobs  job2 · running 1 min 56 s');
  const made = plain(draw(h(MadeNode, { files: [{ path: '/tmp/a.mjs', bytes: 700, created: true }, { path: 'terminal/src/agent/tools.mjs', bytes: 121800, created: false }, { path: 'docs/b.md', bytes: 900, created: false }] }), 100));
  expect(made).toBe('  ▣ Made  1 new, 2 changed · a.mjs, tools.mjs, b.md');
});
