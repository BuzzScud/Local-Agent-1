// Profiles in the real window (8 Oct 2026) on a pretend Ollama service (fake-ollama.mjs): /profiles in the
// / menu and /subagents opening it on its AIs group; then the owner's own case: a task under way, /model's
// three steps picked while it works (model → which profile uses it → its settings), and the task's next
// step on the new model, said on screen and in the footer.
import { test, expect } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { fakeOllama } from './fake-ollama.mjs';

const NO_ENV_KEYS = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '', ANTHROPIC_API_KEY: '' };
const onService = (base, url, model = 'coder:30b') => {
  const r0 = { source: 'openai', address: url, port: null, connect: 'http', kind: 'openai', model, context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { openai: r0 } }));
};

test('/profiles is in the / menu on a service, /subagents opens it; a profile changed in /model while a task works moves the task\'s next step to that model', async () => {
  const { cwd, env, base } = setup();
  const opts = {};
  const svc = await fakeOllama(opts);
  onService(base, svc.url);
  writeFileSync(join(cwd, 'notes.txt'), 'Shopping list\nHello wrold, buy milk\n');
  let release;
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--no-flows', '--mode', 'bypass'], timeoutMs: 120_000, steps: [
    { wait: 'On the remote:', ms: 25_000 }, { sleep: 500 },
    { type: '/' }, { sleep: 400 }, { snapshot: 'menu' }, { key: 'backspace' }, { sleep: 150 },
    { type: '/subagents' }, { key: 'enter' }, { wait: 'Profiles' }, { sleep: 300 }, { snapshot: 'subagents' }, { key: 'esc' }, { sleep: 200 },
    // the task: its first reply held on the service while /model's steps are picked
    { fn: () => { opts.hold = { model: 'coder:30b', until: new Promise((ok) => { release = ok; }) }; } },
    { type: 'fix the typo in notes.txt' }, { key: 'enter' }, { wait: 'esc to interrupt', ms: 20_000 }, { sleep: 800 },
    { type: '/model' }, { key: 'enter' }, { wait: '1 of 3' }, { type: 'thinker' }, { sleep: 400 }, { key: 'enter' },
    { wait: '2 of 3' }, { sleep: 300 }, { snapshot: 'step2' }, { key: 'enter' }, { wait: '3 of 3' }, { sleep: 300 }, { key: 'enter' },
    { wait: 'Main saved', ms: 10_000 }, { sleep: 300 }, { snapshot: 'saved' },
    { fn: () => release() },
    { wait: 'Fixed the typo', ms: 40_000 }, { sleep: 600 }, { snapshot: 'done' },
    { type: '/profiles' }, { key: 'enter' }, { wait: 'Profiles' }, { sleep: 1500 }, { snapshot: 'panel' }, { key: 'esc' }, { sleep: 200 },
    ...quit,
  ] });
  release?.();
  const s = r.snapshots;
  // the / menu on a service: /profiles where /subagents was; /subagents typed opens /profiles on the AIs
  expect(s.menu).toMatch(/\/profiles\s/);
  expect(s.menu).not.toMatch(/\/subagents\s/);
  expect(s.subagents).toMatch(/\[ AIs \]/);
  expect(s.subagents).toMatch(/Side jobs\s+◀ Fast\s+▶/);
  // step 2 while it works: the line says the next step, not the next request
  expect(s.step2).toMatch(/A reply is running: a change here reaches its next step/);
  expect(s.step2).toMatch(/Main → thinker:35b: your conversation.*from the next step/);
  expect(s.saved).toMatch(/Main saved: thinker:35b/);
  expect(s.saved).toMatch(/from its next step: the step under way finishes on the one before/);
  // the file: Main is thinker:35b now
  const saved = JSON.parse(readFileSync(join(base, 'home', 'profiles.json'), 'utf8'));
  expect(saved.profiles.Main.model).toBe('thinker:35b');
  expect(saved.uses['ai:main']).toBe('Main');
  // the task: its first reply on coder:30b, every step after on thinker:35b; the screen says so
  const steps = svc.chats().filter((b) => b.stream && b.tools?.length && JSON.stringify(b.messages).includes('fix the typo in notes.txt'));
  expect(steps[0].model).toBe('coder:30b');
  expect(steps.length).toBeGreaterThanOrEqual(3);
  expect(steps.slice(1).every((b) => b.model === 'thinker:35b')).toBe(true);
  expect(readFileSync(join(cwd, 'notes.txt'), 'utf8')).toContain('Hello world');
  expect(s.done).toMatch(/Main: coder:30b → thinker:35b, from this step/);
  expect(s.done).toMatch(/thinker:35b/);
  // /profiles afterwards: Main on thinker:35b, with today's requests on its meter
  expect(s.panel).toMatch(/Main\s+◀ thinker:35b\s+▶/);
  expect(s.panel).toMatch(/Main\s+◀ thinker:35b\s+▶\s+service\s+none\s+\d+ today/);
  await svc.close();
}, T * 3);
