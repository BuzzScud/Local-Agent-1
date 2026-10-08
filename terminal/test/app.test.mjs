// End-to-end: the real app in a real pseudo-terminal, driven by keystrokes,
// read back through a terminal emulator. The model is the scripted fake.
// Here: a turn on the screen, from the request to the finished line. The
// menus, the start-up and the hub pages have their own files (app-*.test.mjs),
// so the four run side by side.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { demoReplies } from './demo-script.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, seedTrust, quit } from './app-setup.mjs';

test('classic: the whole task, answering each question by key', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer(demoReplies);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'add a --json flag to export.mjs' }, { key: 'enter' },
    { wait: 'Do you want to make this edit' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'export.test.mjs?' }, { sleep: 200 }, { type: '2' },
    { wait: 'Do you want to proceed?' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'tests pass' }, ...quit,
  ] });
  await fake.close();
  // The turn on its rail: your message on its strip, then each step with its mark, closed by ╰─.
  expect(r.text).toMatch(/◇ \S.* {2}\d+s\n/); // a thought: its first sentence, its seconds at the end
  for (const s of ['› add a --json flag to export.mjs', '○ Read  export.mjs · 19 lines', '☐ Update Todos', '✎ Changed  export.mjs · +1 line',
    "14  +   if (argv.includes('--json'))", '❯ Ran  node --test · 3 pass · 0 fail', '✔ toCsv writes a header row', '╰─ ⠿', 'accept edits on', 'Saved. Continue this conversation with: coding -c']) expect(r.text).toContain(s);
  expect(readFileSync(join(cwd, 'export.mjs'), 'utf8')).toContain("argv.includes('--json')");
  expect(existsSync(join(base, 'home', 'sessions'))).toBe(true);
}, T);

test('Agentic Coder asks: answer by number, or type an answer on the prompt line', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { tool: { name: 'Ask', args: { question: 'Which file should change?', options: ['export.mjs', 'trades.json'] } } },
    { text: 'OK, export.mjs it is.' },
    { tool: { name: 'Ask', args: { question: 'What should the flag be called?' } } },
    { text: 'Named it --json.' },
  ]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'do the thing' }, { key: 'enter' },
    { wait: 'Which file should change?' }, { sleep: 200 }, { snapshot: 'asking' }, { type: '1' },
    { wait: 'OK, export.mjs it is.' }, { type: 'add the flag' }, { key: 'enter' },
    { wait: 'What should the flag be called?' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'Type your answer to Agentic Coder' }, { type: '--json' }, { key: 'enter' },
    { wait: 'Named it --json.' }, ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.asking).toContain('Agentic Coder asks');
  expect(r.snapshots.asking).toMatch(/1\. export\.mjs[\s│]+2\. trades\.json[\s│]+3\. Type your own answer…/);
  expect(r.snapshots.asking).toContain('Enter pick · ↑/↓ move · Esc stop'); // esc stops: no row for it
  for (const s of ['› Ask  Which file should change?', 'You: export.mjs', 'You: --json', 'Named it --json.']) expect(r.text).toContain(s);
  expect(r.text).not.toContain('› You: --json'); // the Ask step shows a typed answer; it is not echoed as a step of its own
}, T);

test('the compact question box: what the choice you are on means, the one recommended, "1 of 2", and ticking several with space', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { tool: { name: 'Ask', args: {
      question: 'What should the footer show?',
      options: [{ label: 'Time left this hour', about: 'A small clock. Example: "42 min left"', recommended: true }, { label: 'Messages used today', about: 'A count. Example: "18 of 50 used"' }],
      more: [{ question: 'Which pages should get it?', options: ['Home', 'Settings', 'Reports'], several: true }],
    } } },
    { text: 'Footer planned.' },
  ]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'add usage to the footer' }, { key: 'enter' },
    { wait: 'What should the footer show?' }, { sleep: 200 }, { snapshot: 'first' },
    { key: 'down' }, { wait: '18 of 50 used' }, { snapshot: 'moved' }, { key: 'up' }, { sleep: 100 }, { key: 'enter' },
    { wait: 'Which pages should get it?' }, { sleep: 200 }, { key: ' ' }, { sleep: 100 }, { key: 'down' }, { sleep: 100 }, { key: 'down' }, { sleep: 100 }, { key: ' ' }, { sleep: 200 }, { snapshot: 'ticked' }, { key: 'enter' },
    { wait: 'Footer planned.' }, ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.first).toMatch(/What should the footer show\?\s+\(1 of 2\)/);
  expect(r.snapshots.first).toMatch(/❯ 1\. Time left this hour\s+\(recommended\)/);
  expect(r.snapshots.first).toContain('ⓘ A small clock. Example: "42 min left"');
  expect(r.snapshots.moved).toContain('ⓘ A count. Example: "18 of 50 used"');
  expect(r.snapshots.moved).not.toContain('A small clock');
  expect(r.snapshots.ticked).toMatch(/1\. \[✔\] Home[\s│]+2\. \[ \] Settings[\s│]+❯ 3\. \[✔\] Reports[\s│]+4\. Type your own answer…/);
  expect(r.snapshots.ticked).toContain('Space tick · Enter done');
  for (const s of ['You: Time left this hour', 'You: Home, Reports']) expect(r.text).toContain(s);
  expect(fake.requests[1].messages.find((m) => m.role === 'tool').content).toBe('The user answered:\n1. What should the footer show? → Time left this hour\n2. Which pages should get it? → Home, Reports');
}, T);

test('working: the live thinking line above the spinner, which shows time, tokens and what it is doing; esc interrupts', async () => {
  const { cwd, env } = setup();
  const slow = [{ reasoning: 'I should read export.mjs first to see how main builds its output, then decide where the flag goes. '.repeat(3), text: 'Done.' }];
  const fake = await startFakeServer(slow, { delayMs: 60, chunk: 3 });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'hello' }, { key: 'enter' }, { wait: '◇ thinking' }, { sleep: 1200 }, { snapshot: 'thinking' }, { key: 'esc' }, { wait: 'Interrupted' }, ...quit,
  ] });
  await fake.close();
  // A meter against the thinking cap (or the count, with no cap), and the step's time and speed below.
  expect(r.snapshots.thinking).toMatch(/◇ thinking · \d+s · ([▰▱]{8} [\d.]+k? of [\d.]+k?|\d+ tokens?)/);
  expect(r.snapshots.thinking).toMatch(/╰─ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] [A-Z][a-z]+… \(\d+s · ↓ [\d.]+k? tokens this session · this step \d+s · (↓ [\d.]+ tok\/s|reading) · esc to interrupt\)/);
  expect(r.snapshots.thinking).not.toMatch(/┃/); // no streaming window: one layout, like Claude Code
  expect(r.text).toMatch(/◇ I should read export\.mjs first/); // what it had thought so far is kept, one row
  expect(r.text).toMatch(/╰─ ■ Interrupted · What should Agentic Coder do instead\?/); // the end line closes the rail
}, T);

test('a finished turn leaves its time behind, like Claude Code: "⠿ Worked for 2s · done 12:58 PM"', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'Hi there, how can I help you today with this project?' }], { delayMs: 40, chunk: 1 });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'hello' }, { key: 'enter' }, { wait: 'with this project?' }, { wait: '· done ' }, { sleep: 300 }, ...quit,
  ] });
  await fake.close();
  // How it went in one row, its counts in the row under it (Tight rail, 8 Oct 2026).
  expect(r.text).toMatch(/⠿ [A-Z][a-z]+ for \d+s · done \d{1,2}:\d\d [AP]M\n {5}(\d+ steps? · )?↓ [\d.]+k? tokens this session/);
}, T);

test('long lines in finished steps wrap at the window edge, between words', async () => {
  const { cwd, env } = setup();
  const long = 'This is a long answer that goes on well past the edge of an eighty column window so that it has to wrap onto the next line at a space.';
  const fake = await startFakeServer([{ text: long }]);
  const r = await runInPty({ cwd, env, cols: 80, args: ['--url', fake.url, '--no-flows'], steps: [{ wait: '? for shortcuts' }, { type: 'hi' }, { key: 'enter' }, { wait: 'at a space.' }, ...quit] });
  await fake.close();
  const lines = r.text.split('\n').filter((l) => l.includes('long answer') || l.includes('onto the next'));
  expect(lines.length).toBeGreaterThan(0);
  for (const l of r.text.split('\n')) expect(l.length).toBeLessThanOrEqual(80);
  expect(r.text).not.toMatch(/eig\nhty|colu\nmn/);
  expect(r.text).toMatch(/\n {2}\S/); // the second line is indented under the first
}, T);

test('focused paths on screen: the plan, the try counter, the rename prompt and the fix prompt', async () => {
  const base = mkdtempSync(join(tmpdir(), 'agentic-e2e-'));
  const cwd = join(base, 'project');
  cpSync(join(import.meta.dir, 'fixture-fix'), cwd, { recursive: true });
  seedTrust(base, cwd);
  const env = { AGENTIC_HOME: join(base, 'home') };
  const src = readFileSync(join(cwd, 'stats.mjs'), 'utf8');
  const wrong = '```js\n' + src.replace('  return sorted[mid];', '  return (sorted[mid] + sorted[mid + 1]) / 2;') + '```';
  const right = '```js\n' + src.replace('  return sorted[mid];', '  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;') + '```';
  const fake = await startFakeServer([{ text: wrong }, { text: right }, { text: 'Averages the two middle values for an even count.' }], { delayMs: 4 });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url], steps: [
    { wait: 'Welcome' },
    { type: 'The tests fail. Find the bug and fix it.' }, { key: 'enter' },
    { wait: 'Do you want to make this edit to stats.mjs?' }, { snapshot: 'asking' }, { key: 'enter' },
    { wait: 'Fixed stats.mjs' },
    { type: 'Rename median to middleValue' }, { key: 'enter' },
    { wait: 'files?' }, { snapshot: 'rename' }, { key: 'enter' },
    { wait: 'Renamed median to middleValue' }, ...quit,
  ] });
  await fake.close();
  for (const s of ['☐ Plan', '☐ Run the tests', '◆ Trying fixes', '✗ ✓', 'passes all 4 tests', '✎ Changed  stats.mjs', 'Fixed stats.mjs; all 4 tests pass']) expect(r.text).toContain(s);
  expect(r.snapshots.asking).toContain('Edit file');
  expect(r.snapshots.rename).toMatch(/Rename median to middleValue: \d+ uses in 2 files\?/);
  expect(r.text).toMatch(/Renamed median to middleValue: \d+ uses in 2 files; all 4 tests pass/);
  expect(readFileSync(join(cwd, 'stats.test.mjs'), 'utf8')).toContain('middleValue(');
}, T);

test('typing "exit" as a plain message quits, like /exit', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url], steps: [
    { wait: '? for shortcuts' }, { type: 'exit' }, { key: 'enter' }, { sleep: 400 },
  ] });
  await fake.close();
  expect(r.code).toBe(0); // it quit on the word alone: no ctrl+c steps, no kill
  expect(fake.requests.length).toBe(0); // and never sent "exit" to the model
}, T);
