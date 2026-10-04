// Keep loaded "while open" on an Ollama service (3 Oct 2026, on fake-ollama.mjs). Before, the main
// model was kept with keep_alive -1 and only a clean quit let it go, so a window that crashed, or
// went back to this Mac with /remote here, left it loaded there for ever (a 25 GB model was found
// so). Now every request keeps it OPEN_KEEP (15 min), the open window asks again before that runs
// out (and brings a model kept for ever down to it), and /remote here lets go of it at once.
import { test, expect } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { fakeOllama } from './fake-ollama.mjs';

const NO_ENV_KEYS = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '', ANTHROPIC_API_KEY: '' };
const onService = (base, url, model = 'coder:30b') => {
  const r0 = { source: 'openai', address: url, port: null, connect: 'http', kind: 'openai', model, context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { openai: r0 } }));
};

test('Keep loaded while open: each request keeps the model 15 min, the open window asks again before that runs out (and for a model kept for ever), and /remote here lets go of it at once', async () => {
  const { cwd, env, base } = setup();
  let left = 14 * 60_000; // what the service says is left before it lets the model go
  const svc = await fakeOllama({ until: () => new Date(Date.now() + left).toISOString() });
  onService(base, svc.url);
  const renewals = () => svc.seen.filter((x) => x.path === '/api/generate' && x.body.prompt === '' && x.body.keep_alive === '15m');
  const letGo = () => svc.seen.filter((x) => x.path === '/api/generate' && x.body.keep_alive === 0);
  const at = {};
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS, AGENTIC_MODEL_AT_START: 'off', AGENTIC_UNLOAD: 'on', AGENTIC_PS_EVERY: '300' }, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    { wait: 'On the remote:', ms: 25_000 },
    { type: 'hello' }, { key: 'enter' }, { wait: 'From coder:30b.', ms: 20_000 },
    // 14 of its 15 min left: nothing asked; 1 min left: kept another 15; kept for ever: brought down to 15
    { sleep: 1500 }, { fn: () => { at.far = renewals().length; left = 60_000; } },
    { sleep: 1500 }, { fn: () => { at.soon = renewals().length; left = 290 * 365 * 24 * 3_600_000; } },
    { sleep: 1500 }, { fn: () => { at.forever = renewals().length; left = 60_000; } },
    // back to this Mac: let go of there at once, and asked about no more
    { type: '/remote here' }, { key: 'enter' }, { wait: 'The model is off', ms: 15_000 }, { sleep: 300 }, { snapshot: 'here' },
    { fn: () => { at.letGo = letGo().map((x) => x.body.model); at.here = renewals().length; } },
    { sleep: 1500 },
    ...quit,
  ] });
  await new Promise((d) => setTimeout(d, 500));
  // every reply keeps the main model 15 min, not for ever
  const chats = svc.chats().filter((b) => b.model === 'coder:30b' && b.stream);
  expect(chats.length).toBeGreaterThan(0);
  expect(chats.every((b) => b.keep_alive === '15m')).toBe(true);
  // asked again only when it was running out, or kept for ever; each at the context the replies use
  expect(at.far).toBe(0);
  expect(at.soon).toBeGreaterThan(0);
  expect(at.forever).toBeGreaterThan(at.soon);
  expect(renewals().every((x) => x.body.model === 'coder:30b' && x.body.options?.num_ctx === chats[0].options.num_ctx)).toBe(true);
  // /remote here: the service let go of it then (and of the helpers, as at quit), not at quit; nothing kept it after
  expect(r.snapshots.here).toContain('on this Mac');
  expect(at.letGo).toEqual(expect.arrayContaining(['coder:30b', 'tiny:3b']));
  expect(svc.loaded.has('coder:30b')).toBe(false);
  expect(renewals().length).toBe(at.here);
  expect(letGo().length).toBe(at.letGo.length);
  await svc.close();
}, T);
