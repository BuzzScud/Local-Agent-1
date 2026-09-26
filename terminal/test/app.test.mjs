// End-to-end: the real app in a real pseudo-terminal, driven by keystrokes,
// read back through a terminal emulator. The model is the scripted fake.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { demoReplies } from './demo-script.mjs';
import { runInPty } from './pty.mjs';
import { ENGINE } from '../../models/index.mjs';

const T = 60_000;
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'bonsai-e2e-'));
  const cwd = join(base, 'demo-project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  seedTrust(base, cwd);
  return { base, cwd, env: { BONSAI_HOME: join(base, 'home') } };
}
// The folder is pre-trusted, so tests land straight on the welcome
// (the safety check itself has its own test below).
function seedTrust(base, cwd) {
  mkdirSync(join(base, 'home'), { recursive: true });
  writeFileSync(join(base, 'home', 'trust.json'), JSON.stringify({ [cwd]: new Date().toISOString() }));
}
const quit = [{ sleep: 300 }, { key: 'ctrlC' }, { sleep: 200 }, { key: 'ctrlC' }];

test('classic: the whole task, answering each question by key', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer(demoReplies);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome to Bonsai Code' }, { type: 'add a --json flag to export.mjs' }, { key: 'enter' },
    { wait: 'Do you want to make this edit' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'export.test.mjs?' }, { sleep: 200 }, { type: '2' },
    { wait: 'Do you want to proceed?' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'tests pass' }, ...quit,
  ] });
  await fake.close();
  for (const s of ['> add a --json flag to export.mjs', '∴ Thought for', '⏺ Read(export.mjs)', 'Read 19 lines', '⏺ Update Todos', '⏺ Update(export.mjs)', 'Updated export.mjs with 1 addition',
    "14 +   if (argv.includes('--json'))", '⏺ Bash(node --test)', '✔ --json prints the rows as JSON', 'accept edits on', 'Saved. Continue this conversation with: bonsai -c']) expect(r.text).toContain(s);
  expect(readFileSync(join(cwd, 'export.mjs'), 'utf8')).toContain("argv.includes('--json')");
  expect(existsSync(join(base, 'home', 'sessions'))).toBe(true);
}, T);

test('Bonsai asks: answer by number, or type an answer on the prompt line', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { tool: { name: 'Ask', args: { question: 'Which file should change?', options: ['export.mjs', 'trades.json'] } } },
    { text: 'OK, export.mjs it is.' },
    { tool: { name: 'Ask', args: { question: 'What should the flag be called?' } } },
    { text: 'Named it --json.' },
  ]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome to Bonsai Code' }, { type: 'do the thing' }, { key: 'enter' },
    { wait: 'Which file should change?' }, { sleep: 200 }, { snapshot: 'asking' }, { type: '1' },
    { wait: 'OK, export.mjs it is.' }, { type: 'add the flag' }, { key: 'enter' },
    { wait: 'What should the flag be called?' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'Type your answer to Bonsai' }, { type: '--json' }, { key: 'enter' },
    { wait: 'Named it --json.' }, ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.asking).toContain('Bonsai asks');
  expect(r.snapshots.asking).toMatch(/1\. export\.mjs[\s│]+2\. trades\.json[\s│]+3\. Type an answer[\s│]+4\. Stop here/);
  for (const s of ['⏺ Ask(Which file should change?)', 'You: export.mjs', '> --json', 'You: --json', 'Named it --json.']) expect(r.text).toContain(s);
}, T);

test('working: "∴ Thinking…" above the spinner, which shows time and tokens; esc interrupts', async () => {
  const { cwd, env } = setup();
  const slow = [{ reasoning: 'I should read export.mjs first to see how main builds its output, then decide where the flag goes. '.repeat(3), text: 'Done.' }];
  const fake = await startFakeServer(slow, { delayMs: 60, chunk: 3 });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' }, { type: 'hello' }, { key: 'enter' }, { wait: '∴ Thinking…' }, { sleep: 1200 }, { snapshot: 'thinking' }, { key: 'esc' }, { wait: 'Interrupted' }, ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.thinking).toMatch(/∴ Thinking…/);
  expect(r.snapshots.thinking).toMatch(/[·✢✳✶✻✽] [A-Z][a-z]+… \(\d+s · ↓ \d+ tokens · esc to interrupt\)/);
  expect(r.snapshots.thinking).not.toMatch(/┃/); // no streaming window: one layout, like Claude Code
  expect(r.text).toContain('∴ Thought for'); // what it had thought so far is kept, folded
  expect(r.text).toContain('Interrupted · What should Bonsai do instead?');
}, T);

test('a finished turn leaves its time behind, like Claude Code: "✳ Worked for 2s · done 12:58 PM"', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'Hi there, how can I help you today with this project?' }], { delayMs: 40, chunk: 1 });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' }, { type: 'hello' }, { key: 'enter' }, { wait: 'with this project?' }, { wait: '· done ' }, { sleep: 300 }, ...quit,
  ] });
  await fake.close();
  expect(r.text).toMatch(/✳ [A-Z][a-z]+ for \d+s · done \d{1,2}:\d\d [AP]M/);
}, T);

test('slash menu, /help, ? shortcuts, ! shell, history, shift+tab and @files', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'Hi there.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' },
    { type: '/' }, { wait: 'Show commands and keys' }, { type: 'he' }, { key: 'enter' }, { wait: 'Commands' },
    { type: '?' }, { wait: '\\ + enter for a new line' }, { key: 'esc' },
    { type: '!echo shell-ok' }, { key: 'enter' }, { wait: 'shell-ok' },
    { type: 'say hi' }, { key: 'enter' }, { wait: 'Hi there.' },
    { key: 'up' }, { wait: '> say hi' },
    { key: 'ctrlC' }, { sleep: 200 },
    { key: 'shiftTab' }, { wait: 'accept edits on' }, { key: 'shiftTab' }, { wait: 'plan mode on' },
    { type: 'look at @exp' }, { wait: '@export.test.mjs' }, { key: 'tab' }, { wait: 'look at @export' },
    ...quit,
  ] });
  await fake.close();
  expect(r.text).toContain('/help       Show commands and keys');
  expect(r.text).toContain('! echo shell-ok');
  expect(r.text).toContain('Hi there.');
  expect(r.text).toContain('plan mode on');
  // the shell output reached the model with the next prompt
  expect(JSON.stringify(fake.requests.at(-1).messages)).toContain('The user ran `echo shell-ok`');
}, T);

test('long lines in finished steps wrap at the window edge, between words', async () => {
  const { cwd, env } = setup();
  const long = 'This is a long answer that goes on well past the edge of an eighty column window so that it has to wrap onto the next line at a space.';
  const fake = await startFakeServer([{ text: long }]);
  const r = await runInPty({ cwd, env, cols: 80, args: ['--url', fake.url, '--no-flows'], steps: [{ wait: 'Welcome' }, { type: 'hi' }, { key: 'enter' }, { wait: 'at a space.' }, ...quit] });
  await fake.close();
  const lines = r.text.split('\n').filter((l) => l.includes('long answer') || l.includes('onto the next'));
  expect(lines.length).toBeGreaterThan(0);
  for (const l of r.text.split('\n')) expect(l.length).toBeLessThanOrEqual(80);
  expect(r.text).not.toMatch(/eig\nhty|colu\nmn/);
  expect(r.text).toMatch(/\n {2}\S/); // the second line is indented under the first
}, T);

test('focused paths on screen: the plan, the try counter, the rename prompt and the fix prompt', async () => {
  const base = mkdtempSync(join(tmpdir(), 'bonsai-e2e-'));
  const cwd = join(base, 'project');
  cpSync(join(import.meta.dir, 'fixture-fix'), cwd, { recursive: true });
  seedTrust(base, cwd);
  const env = { BONSAI_HOME: join(base, 'home') };
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
  for (const s of ['⏺ Plan', '☐ Run the tests', '⏺ Trying fixes', '✗ ✓', 'passes all 4 tests', '⏺ Update(stats.mjs)', 'Fixed stats.mjs; all 4 tests pass']) expect(r.text).toContain(s);
  expect(r.snapshots.asking).toContain('Edit file');
  expect(r.snapshots.rename).toMatch(/Rename median to middleValue: \d+ uses in 2 files\?/);
  expect(r.text).toMatch(/Renamed median to middleValue: \d+ uses in 2 files; all 4 tests pass/);
  expect(readFileSync(join(cwd, 'stats.test.mjs'), 'utf8')).toContain('middleValue(');
}, T);

test('/model: the model list and the effort in one picker; the choice is used and kept; /effort and --effort', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([{ text: 'Hi.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' }, { type: '/model' }, { key: 'enter' },
    { wait: 'Pick the model and its effort' }, { sleep: 200 }, { snapshot: 'picker' },
    { key: 'right' }, { wait: 'Medium: thinks briefly first' },
    { key: 'right' }, { wait: 'High: thinks carefully first' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'Bonsai 2 27B · effort high.' }, { sleep: 300 }, { snapshot: 'after' },
    { type: 'hi' }, { key: 'enter' }, { wait: 'Hi.' },
    // the old names still work: /think, and "off" for low
    { type: '/think medium' }, { key: 'enter' }, { wait: 'Effort is medium' },
    { type: '/effort off' }, { key: 'enter' }, { wait: 'Effort is low' },
    ...quit,
  ] });
  await fake.close();
  const picker = r.snapshots.picker;
  expect(picker).toMatch(/❯ Bonsai 2 27B\s+7\.2 GB · on this Mac\s+✔ in use/);
  expect(picker).toMatch(/Effort\s+◀\s+Low\s+·\s+Medium\s+·\s+High\s+▶/);
  expect(picker).not.toMatch(/Thinking\s+◀/);
  expect(picker).toContain('Low: answers straight away (fastest)');
  expect(picker).toContain('↑↓ model · ←→ effort · enter to save · esc to cancel');
  expect(r.snapshots.after).toMatch(/Bonsai 2 27B · effort high\./); // the note; no status bar by default
  const sent = fake.requests.find((q) => q.stream && q.tools);
  expect(sent.chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'xhigh' });
  const saved = JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));
  expect(saved.thinking).toBe(false); // /effort off (the old name for low) came last
  expect(saved.effort).toBe('medium'); // …and /effort on would bring back Medium
  // --effort on the command line sets the level for this run
  const fake2 = await startFakeServer([{ text: 'Hello.' }]);
  const r2 = await runInPty({ cwd, env, args: ['--url', fake2.url, '--no-flows', '--effort', 'high'], steps: [
    { wait: 'Welcome' }, { type: 'hi' }, { key: 'enter' }, { wait: 'Hello.' }, ...quit,
  ] });
  await fake2.close();
  expect(r2.text).not.toContain('tok/s'); // the status bar is off unless /meters on
  expect(fake2.requests.find((q) => q.stream && q.tools).chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'xhigh' });
}, T);

test('"/" menu like Claude Code: up to 10 commands, the footer makes room, tab fills in', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/' }, { wait: 'Show commands and keys' }, { sleep: 200 }, { snapshot: 'all' },
    { type: 'model' }, { wait: 'Pick the model and its effort' }, { sleep: 200 }, { snapshot: 'mo' },
    { key: 'tab' }, { sleep: 300 }, { snapshot: 'tab' },
    ...quit,
  ] });
  await fake.close();
  const rows = (s) => s.split('\n').filter((l) => /^\s{2}\/[a-z]+\s{2,}\S/.test(l));
  expect(rows(r.snapshots.all)).toHaveLength(10);
  expect(r.snapshots.all).not.toContain('? for shortcuts');
  expect(rows(r.snapshots.mo)[0]).toMatch(/\/model\s+Pick the model and its effort/);
  expect(r.snapshots.tab).toMatch(/> \/model/);
}, T);

test('the welcome on the top line, the prompt box on the last lines, space in between', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, rows: 43, args: ['--url', fake.url], steps: [{ wait: '? for shortcuts' }, { sleep: 400 }, { snapshot: 'start' }, ...quit] });
  await fake.close();
  const lines = r.snapshots.start.split('\n');
  while (lines.length < 43) lines.push('');
  const welcome = lines.findIndex((l) => l.includes('Welcome to Bonsai Code'));
  const tipsEnd = lines.findIndex((l) => l.includes('nothing is sent anywhere'));
  const footer = lines.findIndex((l) => l.includes('? for shortcuts'));
  expect(welcome).toBeLessThanOrEqual(2);          // at the top (this harness may show one line above)
  expect(footer).toBeGreaterThanOrEqual(43 - 3);   // the prompt box and footer at the bottom
  expect(lines.slice(tipsEnd + 1, footer - 3).every((l) => !l.trim())).toBe(true); // space in between
  expect(footer - 3 - tipsEnd).toBeGreaterThan(10);
}, T);

test('start-up says what it waits for; a message typed meanwhile is sent when ready; the next start restores', async () => {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', 'Ternary-Bonsai-2-27B-PQ2_0.gguf'), 'stand-in');
  const first = await runInPty({ cwd, env, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    { wait: 'reading its instructions', ms: 45_000 }, { type: 'hello' }, { key: 'enter' },
    { wait: 'sends as soon as the model is ready' }, { snapshot: 'queued' },
    { wait: 'Hello from the stand-in model.', ms: 45_000 }, ...quit,
  ] });
  expect(first.snapshots.queued).toMatch(/Starting Bonsai 2 27B… reading its instructions, about 30 s the first time/);
  expect(first.snapshots.queued).toContain('⏵ Queued: hello');
  expect(readdirSync(join(home, 'slots')).filter((f) => f.startsWith('warm-'))).toHaveLength(1);
  const second = await runInPty({ cwd, env, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    { wait: 'restoring its instructions from last time', ms: 45_000 }, { wait: '? for shortcuts', ms: 45_000 },
    { type: 'hello' }, { key: 'enter' }, { wait: 'Hello from the stand-in model.', ms: 45_000 }, ...quit,
  ] });
  expect(second.text).toContain('Hello from the stand-in model.');
}, 240_000);

// The safety check is a menu: ❯ on "Yes" first, the arrows move it, enter
// picks. Here it is moved down to No and back up to Yes before enter.
test('a folder not yet trusted gets the safety check first; arrows + enter say yes, and it is remembered', async () => {
  const base = mkdtempSync(join(tmpdir(), 'bonsai-e2e-'));
  const cwd = join(base, 'demo-project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  const env = { BONSAI_HOME: join(base, 'home') }; // no trust seeded
  const fake = await startFakeServer([{ text: 'Hello.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Quick safety check' }, { sleep: 200 }, { snapshot: 'menu' }, { key: 'down' }, { sleep: 100 }, { snapshot: 'onNo' }, { key: 'up' }, { sleep: 100 }, { key: 'enter' },
    { wait: 'Welcome to Bonsai Code' }, ...quit,
  ] });
  await fake.close();
  expect(r.text).toContain('Is this a folder you created or one you trust?');
  expect(r.snapshots.menu).toContain('❯ 1. Yes, I trust this folder');
  expect(r.snapshots.menu).toContain('  2. No, exit');
  expect(r.snapshots.onNo).toContain('❯ 2. No, exit');
  expect(r.snapshots.onNo).toContain('  1. Yes, I trust this folder');
  expect(r.text).toContain('loaded:'); // the welcome says what was read
  // The key is the real path (tmpdir is a link on macOS).
  const keys = Object.keys(JSON.parse(readFileSync(join(base, 'home', 'trust.json'), 'utf8')));
  expect(keys.some((k) => k.endsWith('/demo-project'))).toBe(true);
}, T);

test('safety check: typing 2 picks No at once and nothing is read; 1 still says yes', async () => {
  const mk = () => {
    const base = mkdtempSync(join(tmpdir(), 'bonsai-e2e-'));
    const cwd = join(base, 'demo-project');
    cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
    return { base, cwd, env: { BONSAI_HOME: join(base, 'home') } };
  };
  const a = mk();
  const no = await runInPty({ cwd: a.cwd, env: a.env, args: ['--no-flows'], steps: [
    { wait: 'Quick safety check' }, { sleep: 200 }, { type: '2' }, { wait: 'Nothing was read here' }, { sleep: 300 },
  ] });
  expect(no.code).toBe(0);
  expect(existsSync(join(a.base, 'home', 'trust.json'))).toBe(false);
  const b = mk();
  const fake = await startFakeServer([{ text: 'Hello.' }]);
  const yes = await runInPty({ cwd: b.cwd, env: b.env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Quick safety check' }, { sleep: 200 }, { type: '1' }, { wait: 'Welcome to Bonsai Code' }, ...quit,
  ] });
  await fake.close();
  expect(yes.text).toContain('Welcome to Bonsai Code');
  expect(existsSync(join(b.base, 'home', 'trust.json'))).toBe(true);
}, T * 2);

test('typing "exit" as a plain message quits, like /exit', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url], steps: [
    { wait: 'Welcome to Bonsai Code' }, { type: 'exit' }, { key: 'enter' }, { sleep: 400 },
  ] });
  await fake.close();
  expect(r.code).toBe(0); // it quit on the word alone: no ctrl+c steps, no kill
  expect(fake.requests.length).toBe(0); // and never sent "exit" to the model
}, T);

test('/meters shows the status bar; off by default, like Claude Code', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'Hi.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome to Bonsai Code' }, { sleep: 300 }, { snapshot: 'off' },
    { type: '/meters on' }, { key: 'enter' }, { wait: 'Status bar on' }, { sleep: 300 }, { snapshot: 'on' },
    { type: '/meters off' }, { key: 'enter' }, { wait: 'Status bar off' }, { sleep: 300 }, { snapshot: 'offAgain' },
    { type: 'exit' }, { key: 'enter' }, { sleep: 300 },
  ] });
  await fake.close();
  expect(r.snapshots.off).not.toMatch(/effort (low|medium|high)/);
  expect(r.snapshots.on).toMatch(/Bonsai 2 27B\s+idle\s+ctx .* of 32k\s+effort/);
  expect(r.snapshots.offAgain).not.toMatch(/ctx .* of 32k/);
}, T);
