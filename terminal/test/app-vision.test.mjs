// End-to-end, the real app in a pseudo-terminal (see app.test.mjs). Here:
// pictures. @shot.png, a pasted picture (ctrl+v, from a test clipboard: yours
// is never read) and a PDF go with the message; a server that cannot see gets a
// line saying so; with the stand-in model, the first picture turns its vision
// add-on on (a reload with --mmproj), and a missing add-on is offered first.
import { test, expect } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { ENGINE, MODELS, DEFAULT_MODEL } from '../../models/index.mjs';

const D = MODELS[DEFAULT_MODEL];
const CLI = join(import.meta.dir, '..', 'src', 'cli.jsx');
const { textImage, textPdf } = await import('../src/tools/media.mjs');

// A project with a picture and a PDF in it.
function project() {
  const s = setup();
  textImage(join(s.cwd, 'shot.png'), 'HELLO 42');
  textPdf(join(s.cwd, 'invoice.pdf'), ['Invoice 7731\nTotal due: 1,240 dollars']);
  return s;
}
// The stand-in engine and model file (as in app-start.test.mjs); vision: its add-on is here too.
function standIn(base, { vision }) {
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', D.file), 'stand-in');
  if (vision) writeFileSync(join(home, 'models', D.vision.file), 'stand-in');
  return home;
}
const imageParts = (req) => (req?.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content.filter((c) => c.type === 'image_url') : []));
const chatWith = (fake, word) => fake.requests.find((q) => q.stream && JSON.stringify(q.messages).includes(word));

test('@shot.png and a PDF go with the message to a server that can see: the picture as a picture, the PDF as its text', async () => {
  const { cwd, env } = project();
  const fake = await startFakeServer([{ text: 'It says HELLO 42.' }], { vision: true });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'what does @shot.png say, and the total in @invoice.pdf?' }, { key: 'enter' },
    { wait: 'It says HELLO 42.' }, { sleep: 200 }, { snapshot: 'done' }, ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.done).toMatch(/Attached shot\.png \(picture, 640×240\), invoice\.pdf \(PDF, 1 page\)/);
  const req = chatWith(fake, 'what does @shot.png say');
  expect(imageParts(req)).toHaveLength(1);
  expect(imageParts(req)[0].image_url.url).toMatch(/^data:image\/jpeg;base64,\/9j\//);
  expect(JSON.stringify(req.messages)).toContain('Total due: 1,240 dollars');
}, T);

test('a server that cannot see: the message goes with a line saying a picture was attached, and a note says why', async () => {
  const { cwd, env } = project();
  const fake = await startFakeServer([{ text: 'I cannot see it.' }], { vision: false });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'what is in @shot.png please' }, { key: 'enter' }, { wait: 'I cannot see it.' }, ...quit,
  ] });
  await fake.close();
  expect(r.text.replace(/\s+/g, ' ')).toContain('The model server given with --url is not looking at pictures');
  const req = chatWith(fake, 'what is in @shot.png');
  expect(imageParts(req)).toHaveLength(0);
  expect(JSON.stringify(req.messages)).toContain('(The user attached a picture (shot.png), but this model is not looking at pictures now.)');
}, T);

test('ctrl+v pastes the clipboard’s picture as [Image #1] (a test clipboard: yours is never read), and it goes with the message', async () => {
  const { cwd, env } = project();
  const fake = await startFakeServer([{ text: 'A pasted picture.' }], { vision: true });
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_TEST_CLIPBOARD: join(cwd, 'shot.png') }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'look at ' }, { key: '\x16' }, { wait: '[Image #1]' }, { sleep: 200 }, { snapshot: 'pasted' },
    { key: 'enter' }, { wait: 'A pasted picture.' }, ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.pasted).toContain('> look at [Image #1]');
  expect(r.snapshots.pasted).toContain('Picture 640×240 attached as [Image #1]');
  expect(imageParts(chatWith(fake, 'look at [Image #1]'))).toHaveLength(1);
}, T);

test('the first picture turns the model’s vision on: it reloads with its add-on (--mmproj), the conversation stays, and the message goes once it can see', async () => {
  const { cwd, env, base } = project();
  standIn(base, { vision: true });
  const args = join(base, 'server-args.jsonl');
  const r = await runInPty({ cwd, env: { ...env, FAKE_LLAMA_ARGS: args }, args: ['--no-flows'], timeoutMs: 120_000, steps: [
    { wait: '? for shortcuts', ms: 45_000 }, { waitGone: `Starting ${D.name}`, ms: 60_000 },
    { type: 'what is in @shot.png please' }, { key: 'enter' },
    { wait: `Turning on ${D.name}'s vision` }, { wait: `${D.name} can look at pictures now`, ms: 60_000 },
    { wait: 'Hello from the stand-in model.', ms: 45_000 }, { sleep: 300 },
    { type: '/stats' }, { key: 'enter' }, { wait: 'pictures' }, { sleep: 200 }, { snapshot: 'stats' }, ...quit,
  ] });
  const starts = readFileSync(args, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(starts.length).toBe(2);
  expect(starts[0]).not.toContain('--mmproj');
  expect(starts[1][starts[1].indexOf('--mmproj') + 1]).toBe(join(base, 'home', 'models', D.vision.file));
  expect(r.snapshots.stats).toMatch(/pictures\s+on: it can look at pictures/);
}, 150_000);

test('the add-on not downloaded yet: it asks first; "Send without the picture" sends it now with a line saying so', async () => {
  const { cwd, env, base } = project();
  standIn(base, { vision: false });
  const r = await runInPty({ cwd, env, args: ['--no-flows'], timeoutMs: 120_000, steps: [
    { wait: '? for shortcuts', ms: 45_000 }, { waitGone: `Starting ${D.name}`, ms: 60_000 },
    { type: 'what is in @shot.png please' }, { key: 'enter' }, { wait: 'needs its vision add-on' }, { sleep: 200 }, { snapshot: 'asked' },
    { key: '2' }, { wait: 'Hello from the stand-in model.', ms: 45_000 }, ...quit,
  ] });
  const a = r.snapshots.asked.replace(/\s+/g, ' ');
  expect(a).toContain(`Look at the picture? ${D.name} needs its vision add-on`);
  expect(a).toContain(`Download it (${(D.vision.bytes / 1e9).toFixed(2)} GB) and look`);
  expect(a).toContain('Send without the picture');
  expect(existsSync(join(base, 'home', 'models', D.vision.file))).toBe(false); // nothing downloaded
}, 150_000);

test('coding -p with a picture in the prompt: sent to a server that can see', async () => {
  const { cwd, env } = project();
  const fake = await startFakeServer([{ text: 'HELLO 42' }], { vision: true });
  const p = Bun.spawn(['bun', CLI, '-p', 'what does @shot.png say?', '--url', fake.url, '--no-flows'], { cwd, env: { ...process.env, ...env, AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1' }, stdout: 'pipe', stderr: 'pipe' });
  const [out] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  await fake.close();
  expect(out.trim()).toBe('HELLO 42');
  expect(imageParts(chatWith(fake, 'what does @shot.png say'))).toHaveLength(1);
}, T);

test('a picture the model reads by itself turns its vision on in the middle of the reply: a reload with the add-on, and the picture goes with Read’s result', async () => {
  const { cwd, env, base } = project();
  standIn(base, { vision: true });
  const args = join(base, 'server-args.jsonl');
  const r = await runInPty({ cwd, env: { ...env, FAKE_LLAMA_ARGS: args, FAKE_LLAMA_READ: 'shot.png' }, args: ['--no-flows'], timeoutMs: 120_000, steps: [
    { wait: '? for shortcuts', ms: 45_000 }, { waitGone: `Starting ${D.name}`, ms: 60_000 },
    { type: 'what is in the screenshot here' }, { key: 'enter' },
    { wait: `${D.name} wants to look at a picture`, ms: 30_000 }, { wait: 'The stand-in saw 1 picture.', ms: 60_000 }, ...quit,
  ] });
  const starts = readFileSync(args, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(starts.length).toBe(2);
  expect(starts[0]).not.toContain('--mmproj');
  expect(starts[1]).toContain('--mmproj');
  expect(r.text.replace(/\s+/g, ' ')).toContain(`${D.name} can look at pictures now`);
}, 150_000);

test('coding -p: a picture the model reads by itself reloads it with its add-on, once', async () => {
  const { cwd, env, base } = project();
  standIn(base, { vision: true });
  const args = join(base, 'server-args.jsonl');
  const p = Bun.spawn(['bun', CLI, '-p', 'what is in the screenshot here', '--no-flows'], { cwd, env: { ...process.env, ...env, FAKE_LLAMA_ARGS: args, FAKE_LLAMA_READ: 'shot.png', AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1' }, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  expect(out.trim()).toBe('The stand-in saw 1 picture.');
  expect(err).toContain(`turning on ${D.name}'s vision for a picture it reads`);
  const starts = readFileSync(args, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(starts.map((s) => s.includes('--mmproj'))).toEqual([false, true]);
}, 120_000);
