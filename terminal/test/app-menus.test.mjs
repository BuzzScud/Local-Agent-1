// End-to-end, the real app in a pseudo-terminal (see app.test.mjs).
// Here: the menus and the keys of the prompt.
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit, quitTyped } from './app-setup.mjs';

test('slash menu, /help, ? shortcuts, ! shell, history, shift+tab and @files', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'Hi there.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' },
    { type: '/' }, { wait: 'Commands and keys here' }, { type: 'he' }, { key: 'enter' }, { wait: 'Commands' },
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
  expect(r.text).toContain('/help       Commands and keys here, and the full Help page in the browser');
  expect(r.text).toContain('! echo shell-ok');
  expect(r.text).toContain('Hi there.');
  expect(r.text).toContain('plan mode on');
  // the shell output reached the model with the next prompt
  expect(JSON.stringify(fake.requests.at(-1).messages)).toContain('The user ran `echo shell-ok`');
}, T);

test('/effort alone opens a menu like Claude Code: arrows or a number pick, esc goes back unchanged, "/eff" + enter opens it too', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([{ text: 'Hi.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' }, { type: '/effort' }, { key: 'enter' },
    { wait: 'How much Bonsai thinks before it acts' }, { sleep: 200 }, { snapshot: 'menu' },
    { key: 'down' }, { sleep: 100 }, { snapshot: 'moved' }, { key: 'enter' }, { wait: 'Effort is medium' },
    { type: '/effort' }, { key: 'enter' }, { wait: 'How much Bonsai thinks before it acts' }, { sleep: 200 }, { snapshot: 'again' },
    { key: 'esc' }, { wait: 'Kept effort as medium' }, { sleep: 200 }, { snapshot: 'back' },
    { type: '/eff' }, { key: 'enter' }, { wait: 'How much Bonsai thinks before it acts' }, { sleep: 200 }, { type: '3' }, { wait: 'Effort is high' },
    { type: 'hi' }, { key: 'enter' }, { wait: 'Hi.' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.menu).toMatch(/❯ 1\. Low\s+answers straight away \(fastest\)\s+✔ in use/);
  expect(r.snapshots.menu).toMatch(/ 2\. Medium\s+thinks briefly first/);
  expect(r.snapshots.menu).toMatch(/ 3\. High\s+thinks carefully first/);
  expect(r.snapshots.menu).toContain('↑↓ to choose · enter to select · esc to go back');
  expect(r.snapshots.moved).toMatch(/❯ 2\. Medium/);
  expect(r.snapshots.again).toMatch(/❯ 2\. Medium\s+thinks briefly first[^\n]*✔ in use/); // opens on the level in use
  expect(r.snapshots.back).not.toContain('How much Bonsai thinks before it acts'); // esc closed it
  expect(r.text).toContain('Effort is high: it thinks carefully first');
  const sent = fake.requests.find((q) => q.stream && q.tools);
  expect(sent.chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'xhigh' }); // High reached the model
  const saved = JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));
  expect([saved.thinking, saved.effort]).toEqual([true, 'high']); // and is kept for next time
}, T);

test('/mode and /meters alone open the same kind of menu: the one in use marked, a pick applies it, esc keeps it', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' }, { type: '/mode' }, { key: 'enter' },
    { wait: 'How Bonsai asks before it changes things' }, { sleep: 200 }, { snapshot: 'mode' },
    { key: 'down' }, { sleep: 100 }, { key: 'enter' }, { wait: 'Mode is auto-edit' }, { wait: 'accept edits on' },
    { type: '/mo' }, { key: 'enter' }, { wait: 'How Bonsai asks before it changes things' }, { sleep: 200 }, { snapshot: 'mode2' }, { key: 'esc' }, { wait: 'Kept mode as auto-edit' },
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
    { wait: '? for shortcuts' }, { type: '/' }, { wait: 'Commands and keys here' }, { sleep: 200 }, { snapshot: 'all' },
    { type: 'model' }, { wait: 'Pick the model and its effort' }, { sleep: 200 }, { snapshot: 'mo' },
    { key: 'tab' }, { sleep: 300 }, { snapshot: 'tab' },
    ...quitTyped,
  ] });
  await fake.close();
  const rows = (s) => s.split('\n').filter((l) => /^\s{2}\/[a-z]+\s{2,}\S/.test(l));
  expect(rows(r.snapshots.all)).toHaveLength(10);
  expect(r.snapshots.all).not.toContain('? for shortcuts');
  expect(rows(r.snapshots.mo)[0]).toMatch(/\/model\s+Pick the model and its effort/);
  expect(r.snapshots.tab).toMatch(/> \/model/);
}, T);

test('shift + arrows select text in the prompt: copied at once, delete removes it, typing replaces it, esc keeps the text', async () => {
  const { cwd, env, base } = setup();
  const clip = join(base, 'clipboard.txt'); // stands in for the Mac clipboard
  const fake = await startFakeServer([]);
  const SL = '\x1b[1;2D', SU = '\x1b[1;2A'; // what Terminal.app sends for shift+← and shift+↑
  const r = await runInPty({ cwd, env: { ...env, BONSAI_CLIPBOARD: clip }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' }, { type: 'hello world' }, { sleep: 150 },
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
