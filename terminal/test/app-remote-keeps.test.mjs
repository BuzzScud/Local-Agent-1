// /remote keeps the owner's pick (9 Oct 2026). Their screenshots: /remote → Claude API connected, then the
// next step said "Main: claude-opus-5-5 → Qwen3.6:35B-A3B" and the service answered, because profiles.json's
// Main (the conversation's profile) still named the service and the router moves the conversation to Main
// at every step. Their picks: Connect makes the new model Main (every window follows from its next step), the
// helpers keep their own profiles (one line names them), /model's "Just this window" holds, the footer names
// the profile, and a restart after "Work in …? → Yes" opens its conversation from the folder it was saved in.
// The preview these follow: docs/design rounds/agentic-coder-remote-keeps-your-pick-2026-10-09.html.
// On a pretend Ollama service (coder:30b stands in for Qwen3.6) and a pretend Claude API.
import { test, expect } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runInPty } from './pty.mjs';
import { T, setup, quit, ON_REMOTE } from './app-setup.mjs';
import { fakeOllama } from './fake-ollama.mjs';
import { startFakeAnthropic } from './fake-anthropic.mjs';

const KEY = 'test-anthropic-key-0123456789';
const ENV = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: KEY, ANTHROPIC_API_KEY: '' };
const flat = (t) => t.replace(/\s+/g, ' ');
const footerOf = (text) => text.trimEnd().split('\n').filter((l) => /⏵⏵/.test(l)).at(-1) ?? '';
const slug = (cwd) => cwd.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-100) || 'root';

// The owner's files, shape for shape: /remote saved for both, profiles with Main and the helpers on the service.
function theirHome(base, { svcUrl, claudeUrl, on }) {
  const svc = { source: 'openai', address: svcUrl, port: null, connect: 'http', kind: 'openai', model: 'coder:30b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  const cl = { source: 'claude', address: claudeUrl, port: null, connect: 'http', kind: 'claude', model: 'claude-opus-5-5', context: 0, key: true, keyEnd: '6789', keyId: 'claude' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...(on === 'claude' ? cl : svc), use: true }, remotes: { openai: svc, claude: cl } }));
  const server = (r) => ({ kind: r.kind, source: r.source, address: r.address, port: null, connect: r.connect, keyId: r.keyId });
  const profiles = {
    Main: { server: server(svc), model: 'coder:30b', backup: null, spillAfter: 30 },
    Vision: { server: server(svc), model: 'llava:latest', backup: 'Main', spillAfter: 0 },
    Fast: { server: server(svc), model: 'tiny:3b', backup: 'Main', spillAfter: 0 },
    Search: { server: server(svc), model: 'embed:latest', backup: null, spillAfter: 0 },
    Review: { server: server(svc), model: 'thinker:35b', backup: 'Main', spillAfter: 0 },
    Claude: { server: server(cl), model: 'claude-opus-5-5', backup: null, spillAfter: 0 },
  };
  const uses = { 'ai:main': 'Main', 'ai:pictures': 'Vision', 'ai:side': 'Fast', 'ai:btw': 'Fast', 'ai:search': 'Search', 'ai:review': 'Review', 'ai:designWrite': 'Main', 'ai:designCheck': 'Review' };
  writeFileSync(join(base, 'home', 'profiles.json'), JSON.stringify({ profiles, uses }, null, 2));
}
const fileOf = (base, name) => JSON.parse(readFileSync(join(base, 'home', name), 'utf8'));
const mainOf = (base) => { const d = fileOf(base, 'profiles.json'); return d.profiles[d.uses['ai:main']]; };

test('their case: started on the Claude API it stays there; /remote service and /remote claude each move Main; "hello" goes to Claude, and the footer says Main', async () => {
  const { cwd, env, base } = setup();
  const svc = await fakeOllama();
  const claude = await startFakeAnthropic(Array.from({ length: 6 }, () => ({ text: 'Answered by the Claude API.' })), { key: KEY });
  theirHome(base, { svcUrl: svc.url, claudeUrl: claude.url, on: 'claude' });
  const mains = [];
  const r = await runInPty({ cwd, env: { ...env, ...ENV }, args: ['--no-flows', '--mode', 'bypass'], timeoutMs: 120_000, steps: [
    // past the window's 2 s look at the file, which is when the old code moved it back
    { wait: ON_REMOTE, ms: 25_000 }, { sleep: 4500 }, { snapshot: 'start' }, { fn: () => mains.push(mainOf(base).model) },
    // before your first message the start page's line says where it runs now (start-notes.jsx)
    { type: '/remote service' }, { key: 'enter' }, { wait: /coder:30b on \S+, \d+ ms/, ms: 20_000 }, { sleep: 3000 }, { snapshot: 'service' }, { fn: () => mains.push(mainOf(base).model) },
    { type: '/remote claude' }, { key: 'enter' }, { wait: 'Main → claude-opus-5-5 · Claude API (was coder:30b', ms: 20_000 }, { sleep: 3000 }, { fn: () => mains.push(mainOf(base).model) },
    { type: 'hello' }, { key: 'enter' }, { wait: 'Answered by the Claude API.', ms: 30_000 }, { sleep: 800 }, { snapshot: 'hello' },
    ...quit,
  ] });
  const s = r.snapshots;
  const hello = [...svc.chats().filter((b) => JSON.stringify(b.messages ?? '').includes('hello')).map((b) => `service:${b.model}`),
    ...claude.seen.filter((x) => x.body?.stream && JSON.stringify(x.body.messages ?? '').includes('hello')).map((x) => `claude:${x.body.model}`)];
  await svc.close(); await claude.close();
  // started on the Claude API and still there after the window looked at the file: Main moved with it, said once
  expect(flat(s.start)).toContain('Main → claude-opus-5-5 · Claude API (was coder:30b · service): your conversation, and every other window on this Mac from its next step.');
  // the helpers left on the service: counted in the start page's one line (start-notes.jsx), no paragraph
  expect(flat(s.start)).toContain('4 helper models on the service');
  expect(flat(s.start)).not.toContain('The helpers keep their own profiles');
  expect(s.start).not.toMatch(/Main: claude-opus-5-5 → coder:30b/);
  expect(footerOf(s.start)).toContain('● Main · claude-opus-5-5');
  // each Connect moved Main, in the file every window reads
  expect(mains).toEqual(['claude-opus-5-5', 'coder:30b', 'claude-opus-5-5']);
  expect(flat(s.service)).toContain('Main → coder:30b · service (was claude-opus-5-5 · Claude API)');
  expect(footerOf(s.service)).toMatch(/● Main · coder:30b on /);
  // hello: on the Claude API, nothing moved it back
  expect(hello).toEqual(['claude:claude-opus-5-5']);
  expect(s.hello).not.toMatch(/Main: claude-opus-5-5 → coder:30b/);
  expect(footerOf(s.hello)).toContain('● Main · claude-opus-5-5');
  // /remote's own set-up is the Claude API, as Main is
  expect(fileOf(base, 'settings.json').remote).toMatchObject({ kind: 'claude', model: 'claude-opus-5-5', use: true });
}, T * 2);

test('/model\'s "Just this window" holds: the window stays on the model picked over two messages, Main stays as it was, and the footer says so', async () => {
  const { cwd, env, base } = setup();
  const svc = await fakeOllama();
  const claude = await startFakeAnthropic([], { key: KEY });
  theirHome(base, { svcUrl: svc.url, claudeUrl: claude.url, on: 'service' });
  const r = await runInPty({ cwd, env: { ...env, ...ENV }, args: ['--no-flows', '--mode', 'bypass'], timeoutMs: 120_000, steps: [
    { wait: ON_REMOTE, ms: 25_000 }, { sleep: 3000 },
    { type: '/model' }, { key: 'enter' }, { wait: '1 of 3' }, { type: 'thinker' }, { sleep: 500 }, { key: 'enter' },
    // step 2: ↑ from Main goes round to Just this window
    { wait: '2 of 3' }, { sleep: 300 }, { key: 'up' }, { sleep: 400 }, { snapshot: 'step2' }, { key: 'enter' },
    { wait: 'enter switches to it' }, { sleep: 400 }, { key: 'enter' }, { wait: 'Now on thinker:35b', ms: 20_000 }, { sleep: 3500 }, { snapshot: 'switched' },
    { type: 'hello' }, { key: 'enter' }, { wait: 'From thinker:35b.', ms: 30_000 }, { sleep: 600 },
    // (Look first sends a stand-in's instant answer back a few times: every one of them is asked of thinker:35b too)
    { type: 'hello again' }, { key: 'enter' }, { sleep: 8000 }, { snapshot: 'twice' },
    ...quit,
  ] });
  const s = r.snapshots;
  // every request of the conversation after the switch (each one carries the first "hello"), and the second message's own
  const asked = svc.chats().filter((b) => JSON.stringify(b.messages ?? '').includes('hello')).map((b) => b.model);
  const again = svc.chats().filter((b) => JSON.stringify(b.messages ?? '').includes('hello again')).map((b) => b.model);
  await svc.close(); await claude.close();
  expect(s.step2).toMatch(/❯ Just this window \(no profile\)/);
  // after the switch: no move back to Main, and the footer names the window's own pick
  expect(s.switched).not.toMatch(/Main: thinker:35b → coder:30b|coder:30b → coder:30b/);
  expect(footerOf(s.switched)).toMatch(/● this window · thinker:35b on /);
  // both messages on thinker:35b; Main is still the service's coder:30b for every other window
  expect(asked.length).toBeGreaterThanOrEqual(2);
  expect(again.length).toBeGreaterThanOrEqual(1);
  expect(asked.every((m) => m === 'thinker:35b')).toBe(true);
  expect(footerOf(s.twice)).toMatch(/● this window · thinker:35b on /);
  expect(mainOf(base).model).toBe('coder:30b');
}, T * 2);

test('a restart after "Work in …? → Yes": the conversation saved under that folder opens from there, and the window works there again', async () => {
  const { cwd, env, base } = setup();
  const svc = await fakeOllama();
  const claude = await startFakeAnthropic([], { key: KEY });
  theirHome(base, { svcUrl: svc.url, claudeUrl: claude.url, on: 'service' });
  const other = join(base, 'agentic-coder');
  mkdirSync(other, { recursive: true });
  writeFileSync(join(base, 'home', 'trust.json'), JSON.stringify({ [cwd]: new Date().toISOString(), [other]: new Date().toISOString() }));
  const id = '2026-10-09T14-45-06-958Z';
  const dir = join(base, 'home', 'sessions', slug(other));
  mkdirSync(dir, { recursive: true });
  const said = 'hello , how do we add a git to the agentic coder? can you check?';
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ title: said, messages: [{ role: 'system', content: 'x' }, { role: 'user', content: said }, { role: 'assistant', content: 'It has one already.' }], items: [{ type: 'user', text: said }], mode: 'bypass', cwd: other, id, updated: new Date().toISOString() }));
  const r = await runInPty({ cwd, env: { ...env, ...ENV }, args: ['--no-flows', '--mode', 'bypass', '--resume', id], timeoutMs: 60_000, steps: [
    { wait: ON_REMOTE, ms: 25_000 }, { sleep: 1500 }, { snapshot: 'start' },
    { type: '!pwd' }, { key: 'enter' }, { sleep: 1500 }, { snapshot: 'pwd' },
    ...quit,
  ] });
  await svc.close(); await claude.close();
  const s = r.snapshots;
  expect(s.start).not.toContain('Could not open that conversation');
  expect(flat(s.start)).toContain(`Opened from ${other}, where it was saved: this window works there again.`);
  expect(s.start).toContain(`resumed: ${said}`);
  expect(s.pwd).toMatch(new RegExp(`${basename(base)}/agentic-coder\\s*$`, 'm'));
}, T);
