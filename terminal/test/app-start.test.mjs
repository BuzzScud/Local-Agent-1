// End-to-end, the real app in a pseudo-terminal (see app.test.mjs).
// Here: the start, the safety check of a new folder, and coding -p.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { ENGINE, MODELS, DEFAULT_MODEL } from '../../models/index.mjs';

// The stand-in plays the default model (its file name and its name on screen).
const D = MODELS[DEFAULT_MODEL];
const DN = D.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // its name inside a pattern

test('the welcome on the top line, the prompt box on the last lines, space in between', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, rows: 43, args: ['--url', fake.url], steps: [{ wait: '? for shortcuts' }, { sleep: 400 }, { snapshot: 'start' }, ...quit] });
  await fake.close();
  const lines = r.snapshots.start.split('\n');
  while (lines.length < 43) lines.push('');
  const welcome = lines.findIndex((l) => l.includes('Agentic Coder v'));
  const tipsEnd = lines.findLastIndex((l) => l.indexOf('│') > 20 && l.indexOf('│') < 60); // the start page's last row: its columns' divider
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
  writeFileSync(join(home, 'models', D.file), 'stand-in');
  const first = await runInPty({ cwd, env, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    { wait: ' · reading', ms: 45_000 }, { type: 'hello' }, { key: 'enter' },
    { wait: 'sends as soon as the model is ready' }, { snapshot: 'queued' },
    { wait: 'Hello from the stand-in model.', ms: 45_000 }, ...quit,
  ] });
  expect(first.snapshots.queued).toMatch(new RegExp(`${DN} · reading( instructions)? · \\d+s`)); // the start page's model line, live while it loads (the long words when the name leaves room)
  expect(first.snapshots.queued).toContain('⏵ Queued: hello');
  // Live while it loaded, then printed once, ready: one start page in the whole scrollback.
  expect(first.text.match(/Recent activity/g)).toHaveLength(1);
  expect(first.text).toMatch(new RegExp(`${DN} · effort \\w+ · \\d+k`));
  expect(readdirSync(join(home, 'slots')).filter((f) => f.startsWith('warm-'))).toHaveLength(1);
  const second = await runInPty({ cwd, env, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    { wait: ' · restoring', ms: 45_000 }, { wait: '? for shortcuts', ms: 45_000 },
    { type: 'hello' }, { key: 'enter' }, { wait: 'Hello from the stand-in model.', ms: 45_000 }, ...quit,
  ] });
  expect(second.text).toContain('Hello from the stand-in model.');
}, 240_000);

// The safety check is a menu: ❯ on "Yes" first, the arrows move it, enter
// picks. Here it is moved down to No and back up to Yes before enter.
test('a folder not yet trusted gets the safety check first; arrows + enter say yes, and it is remembered', async () => {
  const base = mkdtempSync(join(tmpdir(), 'agentic-e2e-'));
  const cwd = join(base, 'demo-project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  const env = { AGENTIC_HOME: join(base, 'home'), AGENTIC_MODEL_AT_START: 'on' }; // no trust seeded
  const fake = await startFakeServer([{ text: 'Hello.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Quick safety check' }, { sleep: 200 }, { snapshot: 'menu' }, { key: 'down' }, { sleep: 100 }, { snapshot: 'onNo' }, { key: 'up' }, { sleep: 100 }, { key: 'enter' },
    { wait: 'Recent activity' }, ...quit,
  ] });
  await fake.close();
  expect(r.text).toContain('Is this a folder you created or one you trust?');
  expect(r.snapshots.menu).toContain('❯ 1. Yes, I trust this folder');
  expect(r.snapshots.menu).toContain('  2. No, exit');
  expect(r.snapshots.onNo).toContain('❯ 2. No, exit');
  expect(r.snapshots.onNo).toContain('  1. Yes, I trust this folder');
  expect(r.text).toContain('This folder'); // the start page says what was read
  expect(r.snapshots.menu).toContain('not trusted yet'); // in the start page's columns, nothing read before a yes
  // The key is the real path (tmpdir is a link on macOS).
  const keys = Object.keys(JSON.parse(readFileSync(join(base, 'home', 'trust.json'), 'utf8')));
  expect(keys.some((k) => k.endsWith('/demo-project'))).toBe(true);
}, T);

test('safety check: typing 2 picks No at once and nothing is read; 1 still says yes', async () => {
  const mk = () => {
    const base = mkdtempSync(join(tmpdir(), 'agentic-e2e-'));
    const cwd = join(base, 'demo-project');
    cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
    return { base, cwd, env: { AGENTIC_HOME: join(base, 'home'), AGENTIC_MODEL_AT_START: 'on' } };
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
    { wait: 'Quick safety check' }, { sleep: 200 }, { type: '1' }, { wait: 'Recent activity' }, ...quit,
  ] });
  await fake.close();
  expect(yes.text).toContain('Recent activity');
  expect(existsSync(join(b.base, 'home', 'trust.json'))).toBe(true);
}, T * 2);

test('coding -p: a question with choices is an arrow menu, "Type an answer" takes a line, a bare question takes a line', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { tool: { name: 'Ask', args: { question: 'Which file should change?', options: ['export.mjs', 'trades.json'] } } },
    { tool: { name: 'Ask', args: { question: 'Pretty or one line?', options: ['pretty', 'one line'] } } },
    { tool: { name: 'Ask', args: { question: 'What should the flag be called?' } } },
    { text: 'trades.json, indented by 4, named --json.' },
  ]);
  const r = await runInPty({ cwd, env, args: ['-p', 'do the thing', '--url', fake.url, '--no-flows'], steps: [
    { wait: 'Which file should change?' }, { sleep: 200 }, { snapshot: 'menu' }, { key: 'down' }, { sleep: 100 }, { snapshot: 'down' }, { key: 'enter' },
    { wait: 'Pretty or one line?' }, { sleep: 200 }, { type: '3' }, { wait: '>' }, { type: 'indented by 4' }, { key: 'enter' },
    { wait: 'What should the flag be called?' }, { sleep: 200 }, { type: '--json' }, { key: 'enter' },
    { wait: 'named --json.' }, { sleep: 300 },
  ] });
  await fake.close();
  expect(r.snapshots.menu).toContain('❯ 1. export.mjs');
  expect(r.snapshots.menu).toContain('  3. Type an answer');
  expect(r.snapshots.down).toContain('❯ 2. trades.json');
  expect(r.text).toContain('trades.json, indented by 4, named --json.');
  expect(r.code).toBe(0);
  // The answers reached the model: the picked row, the typed line, the bare line.
  const sent = JSON.stringify(fake.requests);
  for (const a of ['trades.json', 'indented by 4', '--json']) expect(sent).toContain(a);
}, T);
