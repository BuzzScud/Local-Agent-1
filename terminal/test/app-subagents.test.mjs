// /subagents in the app (2 Oct 2026) on a pretend Ollama service (fake-ollama.mjs): the
// first-pick try-out and its ✔ in /model, /subagents opening /profiles (a job moved to none of its own, saved), a
// picture described by the pictures helper for a main model that cannot see, the second
// opinion after a change, the summary on the side model, the main model kept loaded
// (keep_alive 15m, asked again while the window is open), and what it used let go as it closes.
import { test, expect } from 'bun:test';
import { needs } from './needs.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { fakeOllama } from './fake-ollama.mjs';

const { textImage, mediaTool } = await import('../src/tools/media.mjs');
const NO_ENV_KEYS = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '', ANTHROPIC_API_KEY: '' };
const onService = (base, url, model = 'coder:30b') => {
  const r0 = { source: 'openai', address: url, port: null, connect: 'http', kind: 'openai', model, context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { openai: r0 } }));
};

test.skipIf(needs('pictures', mediaTool))('on an Ollama service: the try-out on first use, /subagents (one switched off, saved), a picture described by llava, the second opinion after a change, the summary on the small model, and the models let go at quit', async () => {
  const { cwd, env, base } = setup();
  const svc = await fakeOllama({ review: '- notes.txt: check the second line', describe: 'A login form; the Save button is cut off.' });
  onService(base, svc.url);
  writeFileSync(join(cwd, 'notes.txt'), 'Shopping list\nHello wrold, buy milk\n');
  textImage(join(cwd, 'shot.png'), 'SAVE');
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS, AGENTIC_UNLOAD: 'on', AGENTIC_TRYOUT: 'on' }, args: ['--no-flows'], timeoutMs: 90_000, steps: [
    { wait: 'On the remote:', ms: 25_000 }, { wait: 'It works with the agent', ms: 15_000 }, { sleep: 300 }, { snapshot: 'tried' },
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 300 }, { snapshot: 'model' }, { key: 'esc' }, { sleep: 150 },
    // /subagents opens /profiles on its AIs group (8 Oct 2026): the jobs are its first profiles; UI design · checks
    // moved to none of its own is the conversation's model, which skips the check, as "off" did.
    { type: '/subagents' }, { key: 'enter' }, { wait: 'Profiles' }, { sleep: 300 }, { snapshot: 'panel' },
    ...Array.from({ length: 13 }, () => [{ key: 'down' }, { sleep: 70 }]).flat(),
    { key: 'right' }, { sleep: 300 }, { snapshot: 'off' }, { key: 'esc' }, { sleep: 200 },
    { type: 'what is in @shot.png please' }, { key: 'enter' }, { wait: 'From coder:30b.', ms: 20_000 }, { sleep: 300 }, { snapshot: 'picture' },
    { type: 'fix the typo in notes.txt' }, { key: 'enter' }, { wait: 'Do you want to make this edit', ms: 20_000 }, { sleep: 150 }, { key: 'enter' },
    { wait: 'Do you want to proceed', ms: 20_000 }, { sleep: 150 }, { key: 'enter' }, // the project's tests after the change
    { wait: 'Checked: the second line', ms: 40_000 }, { sleep: 400 }, { snapshot: 'review' },
    { type: '/compact' }, { key: 'enter' }, { wait: 'Summarized', ms: 20_000 }, { sleep: 300 }, { snapshot: 'compact' },
    ...quit,
  ] });
  await new Promise((d) => setTimeout(d, 1500)); // the curls that let the models go outlive the app
  const s = r.snapshots;
  const chats = svc.chats();
  // the try-out: three steps on the main model at its own size, kept, and ✔ in /model
  expect(s.tried).toMatch(/✔ coder:30b: ✔ read a file · ✔ fixed one line · ✔ ran a command · 40 tok\/s/);
  expect(s.model).toMatch(/coder:30b .*✔ 40 tok\/s/);
  expect(Object.values(JSON.parse(readFileSync(join(base, 'home', 'tryouts.json'), 'utf8')))[0]['coder:30b']).toMatchObject({ ok: true });
  // /profiles: a profile for each helper model, each job on its row; UI design · checks moved to none of its own, saved
  expect(s.panel).toMatch(/\[ AIs \]/);
  expect(s.panel).toMatch(/Vision\s+llava:latest\s+service/);
  expect(s.panel).toMatch(/Pictures\s+◀ Vision\s+▶/);
  expect(s.panel).toMatch(/Side jobs\s+◀ Fast\s+▶/);
  expect(s.panel).toMatch(/Second opinion\s+◀ Review\s+▶/);
  // none of its own: the conversation's model, which cannot see, so the check is skipped (and the row says why)
  expect(s.off).toMatch(/UI design · checks\s+◀ Main\s+▶\s+⚠ coder:30b cannot see pictures/);
  const saved = JSON.parse(readFileSync(join(base, 'home', 'profiles.json'), 'utf8'));
  expect(saved.uses['ai:designCheck']).toBeUndefined();
  expect(saved.uses['ai:review']).toBe('Review');
  expect(saved.profiles.Review.model).toBe('thinker:35b');
  expect(saved.profiles.Fast.model).toBe('tiny:3b');
  // the picture: llava looked first; the main model got its words, not the picture
  expect(s.picture).toMatch(/Pictures: llava:latest described it/);
  const look = chats.find((b) => b.model === 'llava:latest');
  expect(look.messages.at(-1).images).toHaveLength(1);
  const toMain = chats.filter((b) => b.model === 'coder:30b' && b.stream && JSON.stringify(b.messages).includes('which can, describes it'));
  expect(toMain.length).toBeGreaterThan(0);
  expect(JSON.stringify(toMain[0].messages)).toContain('A login form; the Save button is cut off.');
  expect(toMain.every((b) => b.messages.every((m) => !m.images))).toBe(true);
  // the change: edited, then the second opinion on thinker:35b, sent back once
  expect(readFileSync(join(cwd, 'notes.txt'), 'utf8')).toContain('Hello world');
  expect(s.review).toMatch(/Second opinion: thinker:35b found 1 thing/);
  expect(chats.some((b) => b.model === 'thinker:35b' && /review a code change/.test(b.messages[0].content) && b.messages[1].content.includes('Hello world'))).toBe(true);
  // the summary on the side model
  expect(chats.some((b) => b.model === 'tiny:3b' && /summarize a coding session/.test(b.messages[0].content))).toBe(true);
  expect(chats.some((b) => b.model === 'coder:30b' && /summarize a coding session/.test(b.messages[0]?.content ?? ''))).toBe(false);
  // the main model kept loaded while the window is open; helpers half an hour
  expect(chats.filter((b) => b.model === 'coder:30b' && b.stream).every((b) => b.keep_alive === '15m')).toBe(true);
  expect(chats.filter((b) => b.model === 'tiny:3b').every((b) => b.keep_alive === '30m')).toBe(true);
  // at quit: what it used let go (keep_alive 0)
  const gone = svc.seen.filter((x) => x.path === '/api/generate' && x.body.keep_alive === 0).map((x) => x.body.model);
  expect(gone).toEqual(expect.arrayContaining(['coder:30b', 'llava:latest', 'tiny:3b']));
  await svc.close();
}, T * 2);
