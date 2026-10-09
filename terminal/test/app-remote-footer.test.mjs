// The footer on a remote, in the app (2 Oct 2026, design 2 of docs/design rounds/
// remote-footer-2-designs-2026-10-02.html) on a pretend Ollama service (fake-ollama.mjs) whose
// model is 62% in GPU memory: "? for shortcuts" until the first answer, then gauges in its
// place (the speed, the context, GPU from /api/ps in amber), never this Mac's memory; ctrl+t opens
// the service's model list, ? lists the remote keys, ctrl+r has nothing to review, ctrl+p compacts.
import { test, expect } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { setup, quit, ON_REMOTE } from './app-setup.mjs';
import { fakeOllama } from './fake-ollama.mjs';

const NO_ENV_KEYS = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '', ANTHROPIC_API_KEY: '' };
const MAC = /Mac \d+(\.\d)?\/\d+ GB/;

test('on an Ollama service: gauges after the first answer with GPU spilling in amber, no Mac; ctrl+t the model list, ? the remote keys, ctrl+p compacts', async () => {
  const { cwd, env, base } = setup();
  const svc = await fakeOllama({ gpu: 0.62 });
  const r0 = { source: 'openai', address: svc.url, port: null, connect: 'http', kind: 'openai', model: 'coder:30b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { openai: r0 } }));
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS, AGENTIC_PS_EVERY: '400' }, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    { wait: ON_REMOTE, ms: 25_000 }, { wait: '? for shortcuts' }, { sleep: 300 }, { snapshot: 'start' },
    { type: 'say hello' }, { key: 'enter' }, { wait: 'From coder:30b.', ms: 20_000 }, { wait: '↓40 tok/s', ms: 10_000 }, { sleep: 600 }, { snapshot: 'gauges' },
    { key: 'ctrlT' }, { wait: 'Loaded on the service' }, { sleep: 200 }, { snapshot: 'list' }, { key: 'esc' }, { sleep: 300 },
    { type: '?' }, { wait: 'ctrl+r for a second opinion now' }, { sleep: 150 }, { snapshot: 'keys' }, { type: '?' }, { sleep: 200 },
    { key: 'ctrlP' }, { wait: 'Nothing to summarize yet' }, { snapshot: 'short' }, // a note takes the gauges' place for a moment
    { key: 'ctrlR' }, { wait: 'Nothing changed in the last message' }, // the review model is there (thinker:35b), but "say hello" changed nothing
    { type: 'say hello again' }, { key: 'enter' }, { wait: '↓40 tok/s', ms: 20_000 }, { sleep: 2800 },
    { key: 'ctrlP' }, { wait: 'Summarized', ms: 20_000 }, { sleep: 300 },
    ...quit,
  ] });
  await svc.close();
  const s = r.snapshots;
  // the footer's row, inside the prompt box over its bottom edge (the "Panel", 8 Oct 2026)
  const footer = (t) => t.trimEnd().split('\n').filter((l) => l.trim() && !l.startsWith('╰')).at(-1);
  // before the first answer: the hint, and no Mac's memory
  expect(footer(s.start)).toContain('? for shortcuts');
  expect(s.start).not.toMatch(MAC);
  // after it: the gauges in the hint's place, GPU 62% with what runs on the CPU, the model on the right
  const f = footer(s.gauges);
  expect(f).not.toContain('? for shortcuts');
  expect(f).toMatch(/↓40 tok\/s .*ctx .*\d+%.*GPU ▰+ 62% rest on CPU .*● coder:30b/);
  expect(s.gauges).not.toMatch(MAC);
  expect(svc.seen.filter((x) => x.path === '/api/ps').length).toBeGreaterThan(2); // read again and again (400 ms here, 30 s for real)
  // ctrl+t: the service's list (nothing loads on this Mac); ? the remote keys
  expect(s.list).toContain('Loaded on the service');
  expect(s.keys).toContain('ctrl+t to switch the model');
  expect(s.keys).toContain('ctrl+p to compact now');
  expect(s.keys).not.toContain('ctrl+t to start or stop the model');
  // ctrl+p: too short at first, said in the gauges' place; then the summary on the service
  expect(footer(s.short)).toMatch(/^│ Nothing to summarize yet.*● coder:30b/);
  expect(svc.chats().some((b) => /summarize a coding session/i.test(String(b.messages?.find((m) => m.role === 'system')?.content ?? '')))).toBe(true);
}, 70_000);
