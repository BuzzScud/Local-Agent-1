// A message sent the moment the reply before it ends (agent.mjs send): the reply is on the screen ('turn-end') while
// that message still finishes (/rewind's copy of the folder, the memory's note of it). Before 13 Oct 2026 a message
// sent in that moment overlapped it: the older one's end wiped the newer one's record, and the newer one ended at
// once with no reply, its window waiting for ever (the /btw test failed so in 18 of 111 full runs).
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

test('a message sent as the reply before it ends waits for that one to finish, and gets its own reply', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-send-after-end-'));
  const fake = await startFakeServer([{ text: 'Once upon a time.' }, { text: 'You are welcome.' }]);
  // /rewind's copy at the end of a message, as slow as on a busy Mac
  const rewind = { begin: async () => ({ id: 1 }), finish: () => new Promise((r) => setTimeout(r, 150)), moved: () => {} };
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: false, mode: 'edits', flows: false, verify: false, confirmPlan: false, checkIns: false, rewind });
  const ends = [];
  const settled = [];
  agent.on('settled', (l) => settled.push(l.request));
  let second = null;
  agent.on('turn-end', (e) => {
    ends.push(e.reason);
    // as the window does with a message queued during the reply: sent the moment the reply is shown done
    if (ends.length === 1) second = agent.send('now one about the tests');
  });
  const first = await agent.send('tell me a story');
  await new Promise((r) => { const t = setInterval(() => { if (second) { clearInterval(t); r(); } }, 5); });
  const reason = await second;
  await fake.close();
  expect(first).toBe('done');
  expect(reason).toBe('done');
  expect(ends).toEqual(['done', 'done']);
  expect(settled).toEqual(['tell me a story', 'now one about the tests']);
  expect(fake.requests.filter((j) => j.stream).length).toBe(2);
  expect(agent.messages.filter((m) => m.role === 'assistant').map((m) => m.content)).toEqual(['Once upon a time.', 'You are welcome.']);
});
