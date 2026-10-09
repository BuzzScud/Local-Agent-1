// The Screen tool in the app: a model that sees asks to look at an app (this time, this
// session, always, no), the picture goes with the next request, /permissions and /screen say
// what is allowed; without macOS's Screen Recording it asks nothing and says /screen setup.
// AGENTIC_SCREEN_FAKE stands in for the screen. The tool itself: screen.test.mjs.
import { test, expect } from 'bun:test';
import { needs } from './needs.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { startFakeServer } from './fake-server.mjs';
import { setup, T, quit, quitTyped } from './app-setup.mjs';

const media = await import('../src/tools/media.mjs');
function screenFolder(allowed) {
  const d = mkdtempSync(join(tmpdir(), 'agentic-app-screen-'));
  writeFileSync(join(d, 'access.txt'), allowed ? 'yes' : 'no');
  writeFileSync(join(d, 'windows.json'), JSON.stringify({ front: 'Terminal', windows: [{ id: 11, app: 'Terminal', title: '', x: 0, y: 30, w: 900, h: 700 }, { id: 14, app: 'TextEdit', title: 'notes.txt', x: 10, y: 30, w: 500, h: 400 }] }));
  media.textImage(join(d, '14.png'), 'SHIP FRIDAY', { w: 1000, h: 800 });
  return d;
}
const look = { tool: { name: 'Screen', args: { app: 'TextEdit' } } };

test.skipIf(needs('pictures', media.mediaTool))('a model that sees asks to look at TextEdit once; "for this session" lets it look, the picture goes with the next request; /screen lists it', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([look, { text: 'Your note says SHIP FRIDAY.' }, look, { text: 'Still SHIP FRIDAY.' }], { vision: true });
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_SCREEN_FAKE: screenFolder(true) }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'what does my TextEdit note say?' }, { key: 'enter' },
    { wait: 'Let the model look at TextEdit?' }, { sleep: 200 }, { snapshot: 'ask' }, { type: '2' },
    { wait: 'Your note says SHIP FRIDAY.' }, { sleep: 300 }, { snapshot: 'done' },
    // The same app again: no question this session (one would wait for an answer, and this would time out).
    { type: 'and now?' }, { key: 'enter' }, { wait: 'Still SHIP FRIDAY.' }, { sleep: 200 }, { snapshot: 'again' },
    { type: '/screen' }, { key: 'enter' }, { wait: 'It only looks' }, { sleep: 200 }, { snapshot: 'status' },
    ...quit,
  ] });
  await fake.close();
  const a = r.snapshots.ask;
  for (const s of ['Look at the screen', "TextEdit's front window", 'it only looks: nothing is clicked or typed', 'Let the model look at TextEdit?', '1. This time', '2. For this session', '3. Always (saved for this folder)', '4. No (esc)']) expect(a).toContain(s);
  expect(r.snapshots.again).not.toContain('Let the model look at');
  const sent = JSON.stringify(fake.requests.find((q) => JSON.stringify(q.messages).includes('is attached for you to look at'))?.messages ?? []);
  expect(sent).toContain('data:image/jpeg;base64,'); // the picture went to the model
  expect(r.snapshots.status).toContain('Allowed: Screen(TextEdit) (this session).');
}, T);

test.skipIf(needs('pictures', media.mediaTool))('without Screen Recording nothing is asked: the model is told it cannot look and the window says /screen setup', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([look, { text: 'I cannot see your screen yet.' }], { vision: true });
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_SCREEN_FAKE: screenFolder(false) }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'what does my TextEdit note say?' }, { key: 'enter' },
    { wait: 'I cannot see your screen yet.' }, { sleep: 300 }, { snapshot: 'done' },
    ...quit,
  ] });
  await fake.close();
  expect(r.text).not.toContain('Let the model look at');
  expect(r.snapshots.done).toContain('type /screen setup (once)');
  expect(JSON.stringify(fake.requests.at(-1).messages)).toContain('Tell the user to type /screen setup');
}, T);

test('the five modes from the keyboard: /mode 1 is Auto, /mode 5 Bypass (red, with what still holds), shift+tab leaves Bypass for Manual', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/mode 1' }, { key: 'enter' }, { wait: '⏵⏵ auto │' }, { sleep: 200 }, { snapshot: 'auto' },
    { type: '/mode bypass' }, { key: 'enter' }, { wait: '⏵⏵ bypass │' }, { sleep: 200 }, { snapshot: 'bypass' },
    { key: 'shiftTab' }, { waitGone: '⏵⏵ bypass │' }, { sleep: 200 }, { snapshot: 'manual' },
    { type: '/mode yolo' }, { key: 'enter' }, { wait: 'There is no mode "yolo"' },
    ...quitTyped,
  ] });
  await fake.close();
  expect(r.snapshots.auto).toContain('Mode is auto: reading, searching and edits inside the project go through');
  expect(r.snapshots.auto).toContain('⏵⏵ auto │'); // short, with no hint ("1 · Tidy", 9 Oct 2026: the ? list has shift+tab)
  expect(r.snapshots.bypass).toContain('Bypass permissions is on: nothing asks. A git push asks first (unless the model is Claude).');
  expect(r.snapshots.bypass).toContain('Still never: rm -rf, sudo, a force push');
  expect(r.snapshots.bypass).toContain('⏵⏵ bypass │');
  expect(r.snapshots.manual.split('\n').slice(-6).join('\n')).not.toMatch(/⏵⏵|⏸/); // Manual shows no label, as Claude Code
}, T);
