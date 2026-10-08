// End-to-end, the real app in a pseudo-terminal (see app.test.mjs). Here:
// pictures. @shot.png, a pasted picture (ctrl+v, from a test clipboard: yours
// is never read) and a PDF go with the message; a server that cannot see gets a
// line saying so; with the stand-in model, the first picture turns its vision
// add-on on (a reload with --mmproj), and a missing add-on is offered first.
import { test, expect } from 'bun:test';
import { needs } from './needs.mjs';
import { mkdirSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { ENGINE, MODELS, DEFAULT_MODEL } from '../../models/index.mjs';

const D = MODELS[DEFAULT_MODEL];
const CLI = join(import.meta.dir, '..', 'src', 'cli.jsx');
const { textImage, textPdf, mediaTool } = await import('../src/tools/media.mjs');

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

test.skipIf(needs('pictures', mediaTool))('@shot.png and a PDF go with the message to a server that can see: the picture as a picture, the PDF as its text', async () => {
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

test.skipIf(needs('pictures', mediaTool))('a server that cannot see: the message goes with a line saying a picture was attached, and a note says why', async () => {
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

test.skipIf(needs('pictures', mediaTool))('ctrl+v pastes the clipboard’s picture as [Image #1] (a test clipboard: yours is never read), and it goes with the message', async () => {
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

test.skipIf(needs('pictures', mediaTool))('the first picture turns the model’s vision on: it reloads with its add-on (--mmproj), the conversation stays, and the message goes once it can see', async () => {
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

test.skipIf(needs('pictures', mediaTool))('the add-on not downloaded yet: it asks first; "Send without the picture" sends it now with a line saying so', async () => {
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

test.skipIf(needs('pictures', mediaTool))('coding -p with a picture in the prompt: sent to a server that can see', async () => {
  const { cwd, env } = project();
  const fake = await startFakeServer([{ text: 'HELLO 42' }], { vision: true });
  const p = Bun.spawn(['bun', CLI, '-p', 'what does @shot.png say?', '--url', fake.url, '--no-flows'], { cwd, env: { ...process.env, ...env, AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1' }, stdout: 'pipe', stderr: 'pipe' });
  const [out] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  await fake.close();
  expect(out.trim()).toBe('HELLO 42');
  expect(imageParts(chatWith(fake, 'what does @shot.png say'))).toHaveLength(1);
}, T);

test.skipIf(needs('pictures', mediaTool))('a picture the model reads by itself turns its vision on in the middle of the reply: a reload with the add-on, and the picture goes with Read’s result', async () => {
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

test.skipIf(needs('pictures', mediaTool))('coding -p: a picture the model reads by itself reloads it with its add-on, once', async () => {
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

// A file dragged into Terminal arrives as its path, escaped; with the paste brackets on (the app asks
// for them) it comes as a paste, else as keys all at once. A screenshot's name has spaces and a narrow
// space before AM.
const PASTE = (t) => `\x1b[200~${t}\x1b[201~`;
const dragged = (p) => `${p.replace(/ /g, '\\ ')} `;

test.skipIf(needs('pictures', mediaTool))('a dragged screenshot is [Image #1] at once, with a card over the box (its picture, name, size); ctrl+f opens it in Quick Look, delete takes it away in one piece, ctrl+z brings it back, and it goes to the model with where it came from', async () => {
  const { cwd, env, base } = project();
  const shot = join(base, 'Screenshot 2026-10-07 at 10.12.33 AM.png');
  textImage(shot, 'HELLO 42', { w: 1440, h: 900 });
  const pdf = join(cwd, 'invoice.pdf');
  const ql = join(base, 'quicklook.txt');
  const fake = await startFakeServer([{ text: 'I see the dropped picture.' }], { vision: true });
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_TEST_QUICKLOOK: ql }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { sleep: 300 }, { type: 'what is wrong here ' },
    { key: PASTE(dragged(shot)) }, { wait: '[Image #1]' }, { sleep: 300 }, { snapshot: 'dropped' },
    { key: '\x06' }, { sleep: 300 }, // ctrl+f
    { key: dragged(pdf) }, { wait: '[PDF #2]' }, { sleep: 300 }, { snapshot: 'both' }, // keys all at once, no brackets
    { key: 'backspace' }, { key: 'backspace' }, { sleep: 300 }, { snapshot: 'deleted' },
    { key: '\x1a' }, { sleep: 300 }, { snapshot: 'undone' }, // ctrl+z
    { key: 'enter' }, { wait: 'I see the dropped picture.' }, { sleep: 300 }, { snapshot: 'sent' }, ...quit,
  ] });
  await fake.close();
  const box = (snap) => snap.split('\n').filter((l) => /^│ [> ] /.test(l)).map((l) => l.replace(/^│ [> ] /, '').replace(/\s*│\s*$/, '')).join('|');
  expect(box(r.snapshots.dropped)).toBe('what is wrong here [Image #1]');
  expect(r.snapshots.dropped).toContain('Picture attached as [Image #1]');
  // the card, over the box: the picture drawn in half blocks, the chip, the short name, the size
  const card = r.snapshots.dropped.split('\n').slice(0, r.snapshots.dropped.split('\n').findIndex((l) => l.startsWith('╭'))).slice(-5);
  expect(card.map((l) => l.trim().split(/\s{2,}/).at(-1))).toEqual(['[Image #1]', 'Screenshot 10.12 AM', expect.stringMatching(/^1440×900 · \d+ KB$/), expect.stringMatching(/open/), expect.any(String)]);
  expect(card.every((l) => /^ {2}[▀▄ ]{16}( {2}|$)/.test(l))).toBe(true);
  // and drawn in colour: each of its 16 × 5 cells has a colour of its own, top and bottom (the picture is white with black letters)
  const buf = r.terms.dropped.buffer.active;
  let coloured = 0;
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!(line?.translateToString(true) ?? '').startsWith('  ▀')) continue;
    for (let x = 2; x < 18; x++) if (!line.getCell(x).isFgDefault() && !line.getCell(x).isBgDefault()) coloured++;
  }
  expect(coloured).toBe(80);
  expect(readFileSync(ql, 'utf8').trim()).toBe(join(base, 'home', 'attachments', readFileSync(ql, 'utf8').trim().split('/').pop()));
  expect(box(r.snapshots.both)).toBe('what is wrong here [Image #1] [PDF #2]');
  expect(r.snapshots.both).toContain('PDF · 1 page');
  expect(box(r.snapshots.deleted)).toBe('what is wrong here [Image #1]'); // the space, then the chip in one piece
  expect(r.snapshots.deleted).not.toContain('PDF · 1 page');
  expect(box(r.snapshots.undone)).toBe('what is wrong here [Image #1] [PDF #2]');
  expect(r.snapshots.undone).toContain('PDF · 1 page');
  expect(r.snapshots.sent).not.toContain('Screenshot 10.12 AM'); // the tray goes with the message
  const req = chatWith(fake, 'what is wrong here [Image #1]');
  expect(imageParts(req)).toHaveLength(1);
  const said = JSON.stringify(req.messages);
  expect(said).toContain('Total due: 1,240 dollars');
  expect(said).toContain('dropped into the window.');
}, T);
