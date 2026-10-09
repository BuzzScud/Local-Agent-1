// End-to-end, the real app in a pseudo-terminal (see app.test.mjs).
// Here: the start, where to start (typed in the home folder), the safety check of a new folder,
// and coding -p.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit, quitTyped, seedTrust } from './app-setup.mjs';
import { ENGINE, MODELS, DEFAULT_MODEL } from '../../models/index.mjs';

// The stand-in plays the default model (its file name and its name on screen).
const D = MODELS[DEFAULT_MODEL];
const DN = D.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // its name inside a pattern

test('the page in the middle of the window, the prompt box on the last lines, space under it', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, rows: 43, args: ['--url', fake.url], steps: [{ wait: '? for shortcuts' }, { sleep: 400 }, { snapshot: 'start' }, ...quit] });
  await fake.close();
  const lines = r.snapshots.start.split('\n');
  while (lines.length < 43) lines.push('');
  const welcome = lines.findIndex((l) => l.includes('Welcome!'));
  const keys = lines.findLastIndex((l) => l.includes('@ a file')); // the page's last row
  const footer = lines.findIndex((l) => l.includes('? for shortcuts'));
  expect(welcome).toBeGreaterThan(2);              // not at the top: the column sits in the middle
  expect(welcome).toBeLessThan(43 / 2);
  expect(footer).toBeGreaterThanOrEqual(43 - 3);   // the prompt box and footer at the bottom
  // the box is three rows and sits one empty row above the footer (1 Oct 2026)
  expect(lines.slice(keys + 1, footer - 4).every((l) => !l.trim())).toBe(true); // space in between
  expect(footer - 4 - keys).toBeGreaterThan(3);
}, T);

test('start-up says what it waits for; a message typed meanwhile is sent when ready; the next start restores', async () => {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', D.file), 'stand-in');
  // "✓ model" shows only while the instructions are taken in (2.5 s with the stand-in), and a busy run's
  // look at the screen can take longer than that: then the step was never seen and the wait ran out
  // (3 Oct 2026). The stand-in takes 9 s here, so there is time to see it and to type into it.
  const first = await runInPty({ cwd, env: { ...env, FAKE_LLAMA_WARM_MS: '9000' }, args: ['--no-flows'], timeoutMs: 75_000, steps: [
    { wait: '✓ model', ms: 45_000 }, { type: 'hello' }, { key: 'enter' },
    { wait: 'sends as soon as the model is ready' }, { snapshot: 'queued' },
    { wait: 'Hello from the stand-in model.', ms: 45_000 }, ...quit,
  ] });
  expect(first.snapshots.queued).toMatch(new RegExp(`${DN}[\\s│]+✓ model ─ [◐◓◑◒] (instructions|reading) \\d+s`)); // the start page's steps under the model's name, live while it loads
  expect(first.snapshots.queued).toContain('⏵ Queued: hello');
  // Live while it loaded, then printed once, ready: one start page in the whole scrollback.
  expect(first.text.match(/Pick up where you left off/g)).toHaveLength(1);
  expect(first.text).toMatch(/● ready · effort \w+ · \d+k/);
  expect(readdirSync(join(home, 'slots')).filter((f) => f.startsWith('warm-'))).toHaveLength(1);
  const second = await runInPty({ cwd, env, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    { wait: 'restoring', ms: 45_000 }, { wait: '? for shortcuts', ms: 45_000 },
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
    { wait: 'Pick up where you left off' }, ...quit,
  ] });
  await fake.close();
  expect(r.text).toContain('Is this a folder you created or one you trust?');
  expect(r.snapshots.menu).toContain('❯ 1. Yes, I trust this folder');
  expect(r.snapshots.menu).toContain('  2. No, exit');
  expect(r.snapshots.onNo).toContain('❯ 2. No, exit');
  expect(r.snapshots.onNo).toContain('  1. Yes, I trust this folder');
  expect(r.text).toContain('no AGENTS.md yet · reads'); // the start page says what was read
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
    { wait: 'Quick safety check' }, { sleep: 200 }, { type: '1' }, { wait: 'Pick up where you left off' }, ...quit,
  ] });
  await fake.close();
  expect(yes.text).toContain('Pick up where you left off');
  expect(existsSync(join(b.base, 'home', 'trust.json'))).toBe(true);
}, T * 2);

// Where to start (start-folder.mjs): typed in the home folder (a stand-in one, HOME), it asks
// first; 2 is Agentic Coder's folder (AGENTIC_REPO, a stand-in with the file findRepo looks for).
test('typed in the home folder: where to start comes first; 2 starts in Agentic Coder\'s folder, esc starts nothing', async () => {
  const mk = () => {
    const base = mkdtempSync(join(tmpdir(), 'agentic-e2e-'));
    const home = join(base, 'home-folder');
    const repo = join(home, 'agentic-coder');
    cpSync(join(import.meta.dir, '..', 'demo-project'), repo, { recursive: true });
    mkdirSync(join(repo, 'terminal', 'src'), { recursive: true });
    writeFileSync(join(repo, 'terminal', 'src', 'cli.jsx'), '');
    seedTrust(base, home); // the home folder trusted, and with it everything inside it
    return { base, home, env: { HOME: home, AGENTIC_HOME: join(base, 'home'), AGENTIC_REPO: repo, AGENTIC_MODEL_AT_START: 'on' } };
  };
  const a = mk();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd: a.home, env: a.env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Where should it work?' }, { sleep: 200 }, { snapshot: 'menu' }, { type: '2' }, { wait: '? for shortcuts' }, { sleep: 300 }, { snapshot: 'start' },
    { type: 'hello there' }, { wait: '> hello there' }, ...quitTyped, // typing reaches the prompt box after the menu
  ] });
  await fake.close();
  // the window cleared, the doors side by side in its middle (folder-page.jsx, "2 · Doors")
  const menu = r.snapshots.menu.split('\n');
  expect(menu.findIndex((l) => l.includes('Where should it work?'))).toBeGreaterThan(3);
  expect(menu.find((l) => /❯ 1/.test(l))).toMatch(/❯ 1 .* 2 /);
  expect(r.snapshots.menu).toContain('your home folder');
  expect(r.snapshots.menu).toContain('~/agentic-coder');
  expect(r.snapshots.menu.match(/✓ trusted/g)).toHaveLength(2); // the home folder's yes covers both
  expect(r.text).not.toContain('Quick safety check'); // the home folder's yes covers the folder inside it
  expect(r.snapshots.start).toMatch(/● ready[^\n]*~\/agentic-coder/); // the start page: working in the folder picked
  const b = mk();
  const esc = await runInPty({ cwd: b.home, env: b.env, args: ['--no-flows'], steps: [{ wait: 'Where should it work?' }, { sleep: 200 }, { key: 'esc' }, { sleep: 800 }] });
  expect(esc.code).toBe(0);
  expect(esc.text).not.toContain('Pick up where you left off');
}, T * 2);

// The last menu comes after a typed line (readline, which pauses the terminal's input as it closes):
// its keys still arrive. Under Bun 1.4.2 a reader that starts right on that pause gets none (2 Oct 2026).
// The way a new Terminal window starts (2 Oct 2026, "it won't let me type"): coding typed in the
// home folder, enter on Where to start, enter on the safety check, then typing. Under Bun 1.4.2
// nothing typed reached the prompt box on one Mac (a race; never on the other).
test('typed in the home folder, enter through where to start and the safety check: typing reaches the prompt box', async () => {
  const base = mkdtempSync(join(tmpdir(), 'agentic-e2e-'));
  const home = join(base, 'home-folder');
  const repo = join(home, 'agentic-coder');
  cpSync(join(import.meta.dir, '..', 'demo-project'), repo, { recursive: true });
  mkdirSync(join(repo, 'terminal', 'src'), { recursive: true });
  writeFileSync(join(repo, 'terminal', 'src', 'cli.jsx'), '');
  const env = { HOME: home, AGENTIC_HOME: join(base, 'home'), AGENTIC_REPO: repo }; // no trust seeded, no model
  const r = await runInPty({ cwd: home, env, args: ['--no-flows'], steps: [
    { wait: 'Where should it work?' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'Quick safety check' }, { sleep: 200 }, { key: 'enter' },
    { wait: '? for shortcuts' }, { sleep: 1000 }, { type: 'hello there' }, { wait: '> hello there' }, { snapshot: 'typed' }, ...quitTyped,
  ] });
  expect(r.snapshots.typed).toContain('~ · your home folder');
  expect(Object.keys(JSON.parse(readFileSync(join(base, 'home', 'trust.json'), 'utf8')))).toHaveLength(1);
}, T);

test('coding -p: a question with choices is an arrow menu, "Type an answer" takes a line, a bare question takes a line, and a menu after a typed line still takes keys', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { tool: { name: 'Ask', args: { question: 'Which file should change?', options: ['export.mjs', 'trades.json'] } } },
    { tool: { name: 'Ask', args: { question: 'Pretty or one line?', options: ['pretty', 'one line'] } } },
    { tool: { name: 'Ask', args: { question: 'What should the flag be called?' } } },
    { tool: { name: 'Ask', args: { question: 'A test as well?', options: ['with a test', 'without a test'] } } },
    { text: 'trades.json, indented by 4, named --json.' },
  ]);
  const r = await runInPty({ cwd, env, args: ['-p', 'do the thing', '--url', fake.url, '--no-flows'], steps: [
    { wait: 'Which file should change?' }, { sleep: 200 }, { snapshot: 'menu' }, { key: 'down' }, { sleep: 100 }, { snapshot: 'down' }, { key: 'enter' },
    { wait: 'Pretty or one line?' }, { sleep: 200 }, { type: '3' }, { wait: '>' }, { type: 'indented by 4' }, { key: 'enter' },
    { wait: 'What should the flag be called?' }, { sleep: 200 }, { type: '--json' }, { key: 'enter' },
    { wait: 'A test as well?' }, { sleep: 200 }, { key: 'down' }, { sleep: 100 }, { snapshot: 'afterLine' }, { key: 'enter' },
    { wait: 'named --json.' }, { sleep: 300 },
  ] });
  await fake.close();
  expect(r.snapshots.menu).toContain('❯ 1. export.mjs');
  expect(r.snapshots.menu).toContain('  3. Type an answer');
  expect(r.snapshots.down).toContain('❯ 2. trades.json');
  expect(r.snapshots.afterLine).toContain('❯ 2. without a test'); // the arrow reached the menu after a typed line
  expect(r.text).toContain('trades.json, indented by 4, named --json.');
  expect(r.code).toBe(0);
  // The answers reached the model: the picked row, the typed line, the bare line.
  const sent = JSON.stringify(fake.requests);
  for (const a of ['trades.json', 'indented by 4', '--json', 'without a test']) expect(sent).toContain(a);
}, T);
