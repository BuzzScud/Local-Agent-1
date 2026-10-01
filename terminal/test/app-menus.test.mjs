// End-to-end, the real app in a pseudo-terminal (see app.test.mjs).
// Here: the menus and the keys of the prompt.
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit, quitTyped } from './app-setup.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';

// The model on this Mac in these tests is the default one (its file, name and size).
const D = MODELS[DEFAULT_MODEL];
const DN = D.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // its name inside a pattern
const DGB = `${(D.bytes / 1e9).toFixed(1)} GB`;

test('slash menu, /help, ? shortcuts, ! shell, history, shift+tab and @files', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'Hi there.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' },
    { type: '/' }, { wait: 'Open the Help page in the browser' }, { type: 'he' }, { key: 'enter' }, { wait: 'esc or enter to close' }, { key: 'esc' },
    { type: '?' }, { wait: '\\ + enter for a new line' }, { key: 'esc' },
    { type: '!echo shell-ok' }, { key: 'enter' }, { wait: 'shell-ok' },
    { type: 'say hi' }, { key: 'enter' }, { wait: 'Hi there.' },
    { key: 'up' }, { wait: '> say hi' },
    { key: 'ctrlC' }, { sleep: 200 },
    { key: 'shiftTab' }, { wait: 'accept edits on' }, { key: 'shiftTab' }, { wait: 'plan mode on' },
    { type: 'look at @exp' }, { wait: '@export.test.mjs' }, { key: 'tab' }, { wait: 'look at @export' },
    ...quitTyped,
  ] });
  await fake.close();
  expect(r.text).not.toContain('esc or enter to close'); // esc closed the /help box
  expect(r.text).toContain('! echo shell-ok');
  expect(r.text).toContain('Hi there.');
  expect(r.text).toContain('plan mode on');
  // the shell output reached the model with the next prompt
  expect(JSON.stringify(fake.requests.at(-1).messages)).toContain('The user ran `echo shell-ok`');
}, T);

test('/effort alone opens the Effort and limits panel: ←→ moves Effort, enter saves it, esc goes back unchanged, "/eff" + enter opens it too', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([{ text: 'Hi.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/effort' }, { key: 'enter' },
    { wait: 'moves a row' }, { sleep: 200 }, { snapshot: 'menu' },
    { key: 'right' }, { sleep: 100 }, { snapshot: 'moved' }, { key: 'enter' }, { wait: 'Effort is high' },
    { type: '/effort' }, { key: 'enter' }, { wait: 'moves a row' }, { sleep: 200 }, { snapshot: 'again' },
    { key: 'left' }, { sleep: 100 }, { key: 'esc' }, { wait: 'kept as they were' }, { sleep: 200 }, { snapshot: 'back' },
    { type: '/eff' }, { key: 'enter' }, { wait: 'moves a row' }, { sleep: 200 }, { snapshot: 'kept' }, { key: 'left' }, { sleep: 100 }, { key: 'enter' }, { wait: 'Effort is low' },
    { type: '/eff' }, { key: 'enter' }, { wait: 'moves a row' }, { sleep: 200 }, { key: 'right' }, { sleep: 100 }, { key: 'enter' }, { sleep: 300 },
    { type: 'hi' }, { key: 'enter' }, { wait: 'Hi.' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.menu).toMatch(/❯ Effort\s+◀ Low\s+▶\s+default · answers straight away \(fastest\)/);
  expect(r.snapshots.menu).not.toContain('Medium'); // the model has no effort dial (Gemma and Qwen: Low and High)
  expect(r.snapshots.menu).toContain('↑↓ choose · ←→ change · enter saves · esc cancels · ↻ restarts model');
  expect(r.snapshots.moved).toMatch(/❯ Effort\s+◀ High\s+▶ •\s+thinks first/); // moved, not saved yet: the •
  expect(r.snapshots.again).toMatch(/❯ Effort\s+◀ High\s+▶\s+thinks first/); // opens on the level in use
  expect(r.snapshots.back).not.toContain('←→ moves a row'); // esc closed it
  expect(r.snapshots.kept).toMatch(/❯ Effort\s+◀ High\s+▶\s+thinks first/); // …and left High as it was
  expect(r.text).toContain('Effort is high: it thinks first');
  expect(r.text).toContain('Effort is low: it answers straight away');
  const sent = fake.requests.find((q) => q.stream && q.tools);
  expect(sent.chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'high' }); // High reached the model
  const saved = JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));
  expect([saved.thinking, saved.effort]).toEqual([true, 'high']); // and is kept for next time
}, T);

test('/mode and /meters alone open the same kind of menu: the one in use marked, a pick applies it, esc keeps it', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/mode' }, { key: 'enter' }, // the start page is drawn before the app takes keys
    { wait: 'How Agentic Coder asks before it changes things' }, { sleep: 200 }, { snapshot: 'mode' },
    { key: 'down' }, { sleep: 100 }, { key: 'enter' }, { wait: 'Mode is auto-edit' }, { wait: 'accept edits on' },
    { type: '/mo' }, { key: 'enter' }, { wait: 'How Agentic Coder asks before it changes things' }, { sleep: 200 }, { snapshot: 'mode2' }, { key: 'esc' }, { wait: 'Kept mode as auto-edit' },
    { type: '/meters' }, { key: 'enter' }, { wait: 'on one line under the prompt' }, { sleep: 200 }, { snapshot: 'meters' },
    { type: '1' }, { wait: 'Status bar on' },
    { type: '/meters' }, { key: 'enter' }, { wait: 'on one line under the prompt' }, { key: 'esc' }, { wait: 'Kept the status bar as on' },
    { type: '/mode plan' }, { key: 'enter' }, { wait: 'Mode is plan' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.mode).toMatch(/❯ 1\. Ask first\s+asks before every edit and before commands that change things\s+✔ in use/);
  expect(r.snapshots.mode).toMatch(/ 2\. Auto-edit\s+edits files without asking; still asks before commands/);
  expect(r.snapshots.mode).toMatch(/ 3\. Plan\s+only reads and searches, then replies with a plan/);
  expect(r.snapshots.mode).toContain('↑↓ to choose · enter to select · esc to go back');
  expect(r.snapshots.mode2).toMatch(/❯ 2\. Auto-edit[^\n]*✔ in use/); // "/mo" opened it, on the mode in use
  expect(r.snapshots.meters).toMatch(/ 1\. On\s+show it under the prompt/);
  expect(r.snapshots.meters).toMatch(/❯ 2\. Off\s+hide it; \/stats has the numbers\s+✔ in use/); // off by default
  const saved = JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));
  expect(saved.meters).toBe(true); // esc kept it on
}, T);

test('/model: the model list and the effort in one picker; the choice is used and kept; /effort and --effort', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([{ text: 'Hi.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/model' }, { key: 'enter' },
    { wait: 'Pick the model and its effort' }, { sleep: 200 }, { snapshot: 'picker' },
    { key: 'right' }, { wait: 'High: thinks first' }, { sleep: 200 }, { key: 'enter' },
    { wait: `${D.name} · effort high.` }, { sleep: 300 }, { snapshot: 'after' },
    { type: 'hi' }, { key: 'enter' }, { wait: 'Hi.' },
    // the old names still work: /think, and "off" for low
    // a level this model does not have is refused, and nothing changes
    { type: '/think medium' }, { key: 'enter' }, { wait: 'has no medium effort' },
    { type: '/effort off' }, { key: 'enter' }, { wait: 'Effort is low' },
    ...quit,
  ] });
  await fake.close();
  const picker = r.snapshots.picker;
  expect(picker).toMatch(new RegExp(`❯ ${DN}\\s+${DGB} · on this Mac\\s+✔ in use`));
  expect(picker).toMatch(/Effort\s+◀\s+Low\s+·\s+High\s+▶/);
  expect(picker).not.toMatch(/Thinking\s+◀/);
  expect(picker).toContain('Low: answers straight away (fastest)');
  expect(picker).toContain('↑↓ model · ←→ effort · enter to save · esc to cancel');
  expect(r.snapshots.after).toMatch(new RegExp(`${DN} · effort high\\.`)); // the note; no status bar by default
  const sent = fake.requests.find((q) => q.stream && q.tools);
  expect(sent.chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'high' });
  expect(r.text).toContain(`${D.name} has no medium effort: it has Low and High. Effort stays high.`);
  const saved = JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));
  expect(saved.thinking).toBe(false); // /effort off (the old name for low) came last
  expect(saved.effort).toBe('high'); // …and /effort on would bring back High
  // --effort on the command line sets the level for this run
  const fake2 = await startFakeServer([{ text: 'Hello.' }]);
  const r2 = await runInPty({ cwd, env, args: ['--url', fake2.url, '--no-flows', '--effort', 'high'], steps: [
    { wait: '? for shortcuts' }, { type: 'hi' }, { key: 'enter' }, { wait: 'Hello.' }, ...quit,
  ] });
  await fake2.close();
  expect(r2.text).not.toContain('tok/s'); // the status bar is off unless /meters on
  expect(fake2.requests.find((q) => q.stream && q.tools).chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'high' });
}, T);

test('"/" menu like Claude Code: all 18 commands (the rest are in /settings), the footer makes room, tab fills in', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/' }, { wait: 'Open the Help page in the browser' }, { sleep: 200 }, { snapshot: 'all' },
    { type: 'model' }, { wait: 'Pick the model and its effort' }, { sleep: 200 }, { snapshot: 'mo' },
    { key: 'tab' }, { sleep: 300 }, { snapshot: 'tab' },
    ...quitTyped,
  ] });
  await fake.close();
  const rows = (s) => s.split('\n').filter((l) => /^\s{2}\/[a-z]+\s{2,}\S/.test(l));
  expect(rows(r.snapshots.all)).toHaveLength(18);
  expect(r.snapshots.all).toMatch(/\/settings\s+Everything else in one menu/);
  expect(r.snapshots.all).toMatch(/\/exit\s+Quit Agentic Coder/); // the last one shows too: nothing scrolls
  expect(r.snapshots.all).not.toMatch(/^\s{2}\/(doctor|weights|meters)\s/m); // those live in /settings
  expect(r.snapshots.all).not.toContain('? for shortcuts');
  expect(rows(r.snapshots.mo)[0]).toMatch(/\/model\s+Pick the model and its effort/);
  expect(r.snapshots.tab).toMatch(/> \/model/);
}, T);

test('shift + arrows select text in the prompt: copied at once, delete removes it, typing replaces it, esc keeps the text', async () => {
  const { cwd, env, base } = setup();
  const clip = join(base, 'clipboard.txt'); // stands in for the Mac clipboard
  const fake = await startFakeServer([]);
  const SL = '\x1b[1;2D', SU = '\x1b[1;2A'; // what Terminal.app sends for shift+← and shift+↑
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_CLIPBOARD: clip }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'hello world' }, { sleep: 150 },
    ...Array.from({ length: 5 }, () => [{ key: SL }, { sleep: 40 }]).flat(),
    { wait: 'copied 5 chars to clipboard' }, { snapshot: 'selected' },
    { key: 'backspace' }, { sleep: 200 }, { snapshot: 'deleted' },
    { type: 'there' }, { sleep: 150 }, { key: SU }, { wait: 'copied 11 chars to clipboard' },
    { type: 'x' }, { sleep: 200 }, { snapshot: 'replaced' },
    { type: 'yz' }, { key: SL }, { sleep: 400 }, { key: 'esc' }, { sleep: 200 }, { snapshot: 'kept' },
    ...quitTyped,
  ] });
  await fake.close();
  const prompt = (snap) => snap.split('\n').find((l) => /^[│ ]*> /.test(l)) ?? '';
  expect(prompt(r.snapshots.selected)).toContain('> hello world');
  expect(prompt(r.snapshots.deleted)).toMatch(/> hello\s*│?\s*$/);
  expect(prompt(r.snapshots.replaced)).toMatch(/> x\s*│?\s*$/); // shift+↑ took the whole line
  expect(prompt(r.snapshots.kept)).toMatch(/> xyz\s*│?\s*$/); // esc dropped only the selection
  expect(readFileSync(clip, 'utf8')).toBe('z'); // the last selection copied
}, T);

test('/meters shows the status bar; off by default, like Claude Code', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'Hi.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Recent activity' }, { sleep: 300 }, { snapshot: 'off' },
    { type: '/meters on' }, { key: 'enter' }, { wait: 'Status bar on' }, { sleep: 300 }, { snapshot: 'on' },
    { type: '/meters off' }, { key: 'enter' }, { wait: 'Status bar off' }, { sleep: 300 }, { snapshot: 'offAgain' },
    { type: 'exit' }, { key: 'enter' }, { sleep: 300 },
  ] });
  await fake.close();
  expect(r.snapshots.off).not.toMatch(/ctx .* of 32k/); // no status bar (the start page's model line says its effort)
  expect(r.snapshots.on).toMatch(new RegExp(`${DN}\\s+idle\\s+ctx .* of 32k\\s+effort`));
  expect(r.snapshots.offAgain).not.toMatch(/ctx .* of 32k/);
}, T);
