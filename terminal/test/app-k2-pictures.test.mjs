// End-to-end, the real app in a pseudo-terminal (see app.test.mjs): a picture
// sent while K2 Horizon (which cannot look at pictures) is the model. You are
// asked whether a model that can (Qwen here, the one whose add-on is on this
// Mac) takes this message: it loads in K2's place with its add-on, answers, and
// K2 comes back. Esc puts the message back in the prompt, unsent.
import { test, expect } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { setup, quit, quitTyped } from './app-setup.mjs';
import { MODELS, ENGINES, engineOf } from '../../models/index.mjs';

const K2 = MODELS.k2;
const Q = MODELS.qwen;

// K2 is the model in settings.json; the stand-in server on both engines; K2's file,
// Qwen's file and Qwen's vision add-on here (Gemma's are not, so it is not offered).
function project() {
  const s = setup();
  const home = join(s.base, 'home');
  for (const tag of new Set([ENGINES.ifm.tag, engineOf(Q).tag])) {
    mkdirSync(join(home, 'engine', tag), { recursive: true });
    symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', tag, 'llama-server'));
  }
  mkdirSync(join(home, 'models'), { recursive: true });
  for (const f of [K2.file, Q.file, Q.vision.file]) writeFileSync(join(home, 'models', f), 'stand-in');
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: 'k2' }));
  return { ...s, home };
}

const { textImage } = await import('../src/tools/media.mjs');

test('K2 and a picture: asked first; Qwen takes the message with its add-on, then K2 comes back', async () => {
  const { cwd, env, base } = project();
  textImage(join(cwd, 'shot.png'), 'HELLO 42');
  const args = join(base, 'server-args.jsonl');
  const r = await runInPty({ cwd, env: { ...env, FAKE_LLAMA_ARGS: args }, args: ['--no-flows'], timeoutMs: 150_000, steps: [
    { wait: '? for shortcuts', ms: 45_000 }, { waitGone: `Starting ${K2.name}`, ms: 60_000 },
    { type: 'what is in @shot.png please' }, { key: 'enter' },
    { wait: `${K2.name} cannot look at pictures` }, { sleep: 200 }, { snapshot: 'asked' },
    { key: '1' },
    { wait: `${Q.name} looks at the picture`, ms: 60_000 },
    { wait: 'Hello from the stand-in model.', ms: 45_000 },
    { wait: `Back on ${K2.name}.`, ms: 60_000 }, ...quit,
  ] });
  const a = r.snapshots.asked.replace(/\s+/g, ' ');
  expect(a).toContain(`${Q.name} for this message`);
  expect(a).toContain('Send without the picture');
  expect(a).not.toContain(`${MODELS.gemma.name} for this message`); // its files are not here
  // Three starts: K2 (no add-on), Qwen with its add-on, K2 again; each on its own engine.
  const starts = readFileSync(args, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const file = (s) => s[s.indexOf('-m') + 1];
  expect(starts.map(file)).toEqual([K2.file, Q.file, K2.file].map((f) => join(base, 'home', 'models', f)));
  expect(starts[0]).not.toContain('--mmproj');
  expect(starts[1][starts[1].indexOf('--mmproj') + 1]).toBe(join(base, 'home', 'models', Q.vision.file));
  expect(starts[2]).not.toContain('--mmproj');
  // K2's template switch went with its starts' requests; the saved model is still K2.
  expect(JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8')).model).toBe('k2');
}, 180_000);

test('K2 and a picture, esc: nothing is sent and the message is back in the prompt', async () => {
  const { cwd, env } = project();
  textImage(join(cwd, 'shot.png'), 'HELLO 42');
  const r = await runInPty({ cwd, env, args: ['--no-flows'], timeoutMs: 120_000, steps: [
    { wait: '? for shortcuts', ms: 45_000 }, { waitGone: `Starting ${K2.name}`, ms: 60_000 },
    { type: 'what is in @shot.png please' }, { key: 'enter' },
    { wait: `${K2.name} cannot look at pictures` }, { key: 'esc' },
    { wait: 'Not sent: your message is back in the prompt.' }, { sleep: 300 }, { snapshot: 'back' }, ...quitTyped,
  ] });
  expect(r.snapshots.back).toContain('> what is in @shot.png please');
  expect(r.text).not.toContain('Hello from the stand-in model.');
}, 150_000);
