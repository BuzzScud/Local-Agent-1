// /tune in the real window (27 Oct 2026), on a stand-in Ollama service: the / menu finds it, the panel opens
// on the model in use with Preset on top and Bonsai's suggested values, a preset and a row moved are saved for
// it alone, /tune notes gives it instructions of its own, and its next request carries the sampling and the
// instructions; enter on the Instructions row puts them in the prompt box to change.
import { test, expect } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { runInPty } from './pty.mjs';
import { setup, quitTyped, ON_REMOTE } from './app-setup.mjs';

const NO_ENV_KEYS = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '', ANTHROPIC_API_KEY: '', AGENTIC_THINK_BUDGET: '' };
const down = (n) => Array.from({ length: n }, () => [{ key: 'down' }, { sleep: 70 }]).flat();
const right = (n) => Array.from({ length: n }, () => [{ key: 'right' }, { sleep: 80 }]).flat();
const NAME = 'bonsai-2:9b';

// One model that calls tools and cannot think (so Look first waits for nothing); each chat's options and system prompt kept.
const standIn = () => new Promise((ok) => {
  const chats = [];
  const srv = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const body = b ? JSON.parse(b) : {};
    const json = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    const details = { family: 'qwen35', parameter_size: '9.0B', quantization_level: 'Q2_0' };
    if (req.url === '/api/version') return json(200, { version: '0.40.11' });
    if (req.url === '/api/tags') return json(200, { models: [{ name: NAME, size: 3.2e9, digest: 'd-bonsai', modified_at: '2026-10-27T12:00:00Z', details }] });
    if (req.url === '/api/ps') return json(200, { models: [{ name: NAME, size: 3.9e9, context_length: 65536 }] });
    if (req.url === '/api/show') return json(200, { details, model_info: { 'qwen35.context_length': 262144 }, capabilities: ['completion', 'tools'] });
    if (req.url === '/api/generate') return json(200, { model: NAME, response: '', done: true, done_reason: 'load' });
    if (req.url === '/v1/models') return json(200, { object: 'list', data: [{ id: NAME, object: 'model', owned_by: 'library' }] });
    if (req.url === '/api/chat') {
      if (!body.stream) return json(200, { model: NAME, message: { role: 'assistant', content: 'ready' }, done: true });
      chats.push({ options: body.options ?? {}, system: body.messages?.find((m) => m.role === 'system')?.content ?? '' });
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ model: NAME, message: { role: 'assistant', content: `From ${NAME}, reply ${chats.length}.` }, done: false })}\n`);
      res.write(`${JSON.stringify({ model: NAME, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 900, prompt_eval_duration: 1e9, eval_count: 6, eval_duration: 1e8 })}\n`);
      return res.end();
    }
    json(404, { error: 'not found' });
  });
  srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}`, chats, close: () => new Promise((d) => { srv.closeAllConnections?.(); srv.close(d); }) }));
});

test('/tune: the menu finds it; the panel is the model in use with Preset on top; a preset and Top-k saved for it alone, its own instructions with /tune notes, both in its next request; a save in the hub reaches it within 2 s; enter on Instructions puts them in the prompt box', async () => {
  const { cwd, env, base } = setup();
  const srv = await standIn();
  const r0 = { source: 'machine', address: srv.url, port: null, connect: 'http', kind: 'openai', model: NAME, context: 0, key: false, keyEnd: '', keyId: 'machine' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { machine: r0 } }));
  let byWindow = null; // settings.json as the window saved it, before the hub's save
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--no-flows'], rows: 40, cols: 140, timeoutMs: 60_000, steps: [
    { wait: ON_REMOTE, ms: 20_000 }, { sleep: 300 },
    { type: '/tu' }, { sleep: 300 }, { snapshot: 'menu' },
    { type: 'ne' }, { key: 'enter' }, { wait: `/tune · ${NAME}` }, { sleep: 300 }, { snapshot: 'panel' },
    // Preset: Maker's own → Coding; Top-k: its own → 10 → 20; enter saves
    ...down(1), { key: 'left' }, { sleep: 100 }, ...down(4), ...right(2), { sleep: 150 }, { snapshot: 'moved' },
    { key: 'enter' }, { wait: 'kept for next time' }, { sleep: 200 }, { snapshot: 'saved' },
    { type: '/tune notes Read each file once, then edit it.' }, { key: 'enter' }, { wait: 'own instructions' }, { sleep: 200 },
    { type: 'hello' }, { key: 'enter' }, { wait: `From ${NAME}, reply` }, { sleep: 300 },
    // the hub's Tune tab saves for it (Top-k 40, other instructions): the window takes them within 2 s, says so, and its next request has them
    { fn: () => {
      const f = join(base, 'home', 'settings.json');
      const j = JSON.parse(readFileSync(f, 'utf8'));
      byWindow = structuredClone(j);
      for (const svc of [j.remote, j.remotes.machine]) svc.tuned[NAME] = { limits: { ...svc.tuned[NAME].limits, topK: 40 }, notes: 'Search before reading.' };
      writeFileSync(f, JSON.stringify(j));
    } },
    { wait: 'changed in the hub', ms: 8000 }, { sleep: 300 }, { snapshot: 'followed' },
    { type: 'again' }, { key: 'enter' }, { wait: /From bonsai-2:9b, reply [2-9]/ }, { sleep: 300 },
    { type: '/tune' }, { key: 'enter' }, { wait: `/tune · ${NAME}` }, { sleep: 300 }, { snapshot: 'again' },
    ...down(13), { sleep: 100 }, { key: 'enter' }, { wait: '/tune notes Search before' }, { sleep: 200 }, { snapshot: 'notes' },
    ...quitTyped,
  ] });
  await srv.close();
  const s = r.snapshots;
  const flat = (x) => x.replace(/\s+/g, ' ');
  // the / menu: /tune under /model's row, found by its first letters
  expect(s.menu).toMatch(/❯ \/tune\s/);
  expect(flat(s.menu)).toContain('Tune the model in use: a preset, temperature and sampling');
  expect(s.menu).not.toContain('type what it needs'); // alone it opens the panel, as /effort does
  // the panel: the model in use, Bonsai's suggested values and where they come from, Preset on top, then the rows in order
  expect(s.panel).toMatch(new RegExp(`/tune · ${NAME}\\s+in use · enter saves, from its next step`));
  expect(flat(s.panel)).toContain('Suggested: a 9B that thinks long');
  expect(s.panel).toMatch(/How it writes/);
  expect(s.panel).toMatch(/Preset\s+◀ Maker’s own\s+▶\s+default · every row the model’s own on the service/);
  expect(s.panel).toMatch(/Temperature\s+◀ its own\s+▶\s+default · the model’s own on the service/);
  expect(s.panel).toMatch(/Thinking time\s+◀ auto\s+▶/);
  expect(s.panel).toMatch(/Instructions\s+none of its own/);
  expect(s.panel).toContain('t saves and tests on 3 Arena tasks');
  const at = (label) => s.panel.indexOf(label);
  expect(at('Preset')).toBeLessThan(at('Temperature'));
  expect(at('Repeat penalty')).toBeLessThan(at('Thinking time'));
  expect(at('Context')).toBeLessThan(at('Instructions'));
  // moved: Coding sets the two rows; Top-k 20 makes it Custom
  expect(s.moved).toMatch(/Preset\s+◀ Custom\s+▶/);
  expect(s.moved).toMatch(/Temperature\s+◀ 0\.6\s+▶ •/);
  expect(s.moved).toMatch(/Top-k\s+◀ 20\s+▶ •/);
  expect(flat(s.saved)).toContain(`Saved: Temperature its own → 0.6 · Presence penalty its own → 0 · Top-k its own → 20. In use from the next step; kept for next time. Kept for ${NAME} alone.`);
  // kept for it alone, the instructions beside its rows
  expect(byWindow.remote.tuned[NAME]).toEqual({ limits: { temperature: 0.6, presence: 0, topK: 20 }, notes: 'Read each file once, then edit it.' });
  expect(byWindow.remotes.machine.tuned[NAME]).toEqual(byWindow.remote.tuned[NAME]);
  expect(byWindow.limits?.topK).toBe(undefined);
  // its next request: the sampling, and its instructions the last part of the working instructions
  const first = srv.chats[0];
  expect(first.options).toMatchObject({ temperature: 0.6, presence_penalty: 0, top_k: 20 });
  expect(first.options.top_p).toBe(undefined);
  expect(first.system).toContain('For this model\nRead each file once, then edit it.');
  // saved in the hub meanwhile: said in one line, and in its very next request
  expect(flat(s.followed)).toContain(`${NAME}’s own settings were changed in the hub or another window: Top-k 20 → 40 · its own instructions. In use from its next step.`);
  const last = srv.chats.at(-1);
  expect(last.options).toMatchObject({ temperature: 0.6, top_k: 40 });
  expect(last.system).toContain('For this model\nSearch before reading.');
  expect(last.system).not.toContain('Read each file once');
  // opened again: what is saved now, the instructions on their row; enter there puts them in the prompt box
  expect(s.again).toMatch(/Preset\s+◀ Custom\s+▶/);
  expect(s.again).toMatch(/Top-k\s+◀ 40\s+▶/);
  expect(s.again).toMatch(/Instructions\s+Search before reading\./);
  expect(s.notes).toMatch(/│ > \/tune notes Search before reading\./);
}, 90_000);
