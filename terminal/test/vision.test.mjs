// Pictures and PDFs: the macOS helper (media.mjs), a file dragged into the window
// (images.mjs), which pictures go with a request and in what form (llama.cpp and
// OpenAI-compatible, the Claude API), Read of a picture and of a PDF (tools.mjs),
// and the model's vision add-on (registry, memory, server). The app: app-vision.test.mjs.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

// A throwaway home before the models part is loaded (it reads AGENTIC_HOME once): the helper is built in it.
process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-vision-home-'));
const media = await import('../src/tools/media.mjs');
const { droppedFiles, openAIMessages, keptImages, KEEP_IMAGES } = await import('../src/agent/images.mjs');
const { execute, needsSight } = await import('../src/agent/tools.mjs');
const { textPdf } = media;
const { claudeParams } = await import('../src/agent/claude.mjs');
const { MODELS, HOME, withVision, visionPath, needBytes, serverArgs, visionBytes } = await import('../../models/index.mjs');

test('the tests run in a throwaway home', () => { expect(HOME).not.toBe(join(homedir(), '.agentic-coder')); });

const dir = mkdtempSync(join(tmpdir(), 'agentic-vision-'));
const shot = join(dir, 'shot.png');
const pdf = join(dir, 'doc.pdf');

test('the helper, built on first use with the Mac’s own Swift: a picture made smaller for the model, a PDF’s text by page, a page drawn as a picture', () => {
  media.textImage(shot, 'HELLO 42', { w: 2400, h: 900 });
  const img = media.preparedImage(shot);
  expect([img.mime, img.srcW, img.srcH, img.w, img.h]).toEqual(['image/jpeg', 2400, 900, media.MAX_SIDE, 480]);
  expect(Buffer.from(img.data, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8'); // a JPEG
  media.textPdf(pdf, ['Invoice 7731\nTotal due: 1,240 dollars', '', 'Last page.']);
  expect(media.pdfText(pdf)).toEqual(['Invoice 7731\nTotal due: 1,240 dollars', '', 'Last page.']);
  const page = media.pdfPageImage(pdf, 2);
  expect([page.mime, page.h]).toEqual(['image/jpeg', media.MAX_SIDE]);
  expect(() => media.pdfPageImage(pdf, 9)).toThrow('no page 9: the PDF has 3');
  expect(() => media.pdfText(join(dir, 'none.pdf'))).toThrow('cannot open the PDF');
  expect(() => media.preparedImage(pdf.replace('.pdf', '.txt'))).toThrow();
});

test('the test clipboard stands in for yours: a picture there is pasted, none says so', () => {
  const out = join(dir, 'pasted.png');
  process.env.AGENTIC_TEST_CLIPBOARD = shot;
  expect(media.clipboardImage(out)).toEqual({ w: 2400, h: 900 });
  process.env.AGENTIC_TEST_CLIPBOARD = '';
  expect(media.clipboardImage(out)).toBe(null);
  delete process.env.AGENTIC_TEST_CLIPBOARD;
});

test('a file dragged into the window: its path with escaped spaces and brackets, the screenshot’s narrow space, in quotes, from ~; not a file that is not there', () => {
  const home = mkdtempSync(join(homedir(), '.agentic-vision-test-'));
  try {
    const name = 'Screenshot 2026-09-30 at 3.57.51 PM (2).png';
    copyFileSync(shot, join(home, name));
    copyFileSync(pdf, join(home, 'a doc.pdf'));
    const escaped = join(home, name).replace(/([ ()])/g, '\\$1');
    const tilde = `~${join(home, 'a doc.pdf').slice(homedir().length)}`.replace(/ /g, '\\ ');
    const found = droppedFiles(`what is this ${escaped} and this '${join(home, 'a doc.pdf')}' and ${tilde} and /nope/x.png`, dir);
    expect(found.map((f) => [f.kind, f.path])).toEqual([['image', join(home, name)], ['pdf', join(home, 'a doc.pdf')], ['pdf', join(home, 'a doc.pdf')]]);
    expect(found[0].raw).toBe(escaped);
  } finally { Bun.spawnSync(['rm', '-rf', home]); }
});

const pic = (n) => ({ path: `p${n}.png`, mime: 'image/jpeg', data: `DATA${n}`, w: 10, h: 10 });

test('only the latest pictures go with a request; an older one becomes a line; a tool result’s picture follows it as a user message', () => {
  const p = [1, 2, 3, 4].map(pic);
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'look', images: [p[0], p[1]] },
    { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'Read', arguments: '{"path":"p3.png"}' } }] },
    { role: 'tool', tool_call_id: 't1', content: 'The picture p3.png is attached.', images: [p[2]] },
    { role: 'user', content: 'and this', images: [p[3]] },
  ];
  expect(KEEP_IMAGES).toBe(3);
  expect([...keptImages(messages)].map((i) => i.path).sort()).toEqual(['p2.png', 'p3.png', 'p4.png']);
  const out = openAIMessages(messages);
  expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user', 'user']);
  expect(out[1].content).toEqual([{ type: 'text', text: 'look\n[a picture shown earlier: p1.png (10×10)]' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,DATA2' } }]);
  expect(out[3]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'The picture p3.png is attached.' });
  expect(out[4].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,DATA3' } });
  expect(out[5].content.at(-1)).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,DATA4' } });
  expect(out.some((m) => 'images' in m)).toBe(false); // the servers never see the field
  const plain = [{ role: 'user', content: 'hi' }];
  expect(openAIMessages(plain)).toBe(plain); // nothing to do: the same array
});

test('on the Claude API: your pictures as image blocks, a tool result’s inside it, an older one as a line', () => {
  const p = [1, 2, 3, 4].map(pic);
  const messages = [
    { role: 'user', content: 'look', images: [p[0], p[1]] },
    { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'Read', arguments: '{"path":"p3.png"}' } }] },
    { role: 'tool', tool_call_id: 't1', content: 'attached', images: [p[2]] },
    { role: 'user', content: 'and this', images: [p[3]] },
  ];
  const r = claudeParams({ model: 'claude-opus-5-5', messages, maxTokens: 100 });
  expect(r.messages[0].content).toEqual([{ type: 'text', text: 'look' }, { type: 'text', text: '[a picture shown earlier: p1.png (10×10)]' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'DATA2' } }]);
  const result = r.messages[2].content[0];
  expect(result.type).toBe('tool_result');
  expect(result.content).toEqual([{ type: 'text', text: 'attached' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'DATA3' } }]);
  expect(r.messages[2].content.at(-1)).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'DATA4' } });
});

test('Read of a picture: shown to the model when it can see, explained when it cannot; Read of a PDF: its text by page, find, a page as a picture', async () => {
  const proj = join(dir, 'proj');
  mkdirSync(proj, { recursive: true });
  copyFileSync(shot, join(proj, 'shot.png'));
  copyFileSync(pdf, join(proj, 'doc.pdf'));
  const env = (canSee) => ({ cwd: proj, maxResultChars: 12_000, canSee });
  const seen = await execute('Read', { path: 'shot.png' }, {}, env(true));
  expect(seen.text).toBe(`The picture shot.png (2400×900, shown at ${media.MAX_SIDE}×480) is attached for you to look at.`);
  expect(seen.images).toHaveLength(1);
  const blind = await execute('Read', { path: 'shot.png' }, {}, env(false));
  expect(blind.text).toMatch(/is a picture \(2400×900, shown at \d+×480\)\. This model is not looking at pictures in this conversation: ask the user to attach it/);
  expect(blind.images).toBeUndefined();
  const doc = await execute('Read', { path: 'doc.pdf' }, {}, env(true));
  expect(doc.images?.map((i) => i.path)).toEqual(['doc.pdf, page 2']); // the page with no text (a scan), shown
  expect((await execute('Read', { path: 'doc.pdf' }, {}, env(false))).text.split('\n')[0]).toBe('doc.pdf is a PDF: 3 pages, 7 lines of text. Page 2 has no text (a scan or a picture).');
  expect(doc.text.split('\n')).toEqual(['doc.pdf is a PDF: 3 pages, 7 lines of text. Page 2 has no text (a scan or a picture). It is attached as a picture for you to look at.', '1\t--- page 1 of 3 ---', '2\tInvoice 7731', '3\tTotal due: 1,240 dollars', '4\t--- page 2 of 3 ---', '5\t(no text on this page: a scan or a picture)', '6\t--- page 3 of 3 ---', '7\tLast page.']);
  expect((await execute('Read', { path: 'doc.pdf', find: 'total' }, {}, env(true))).text).toContain('"total" is on 1 line:');
  const page = await execute('Read', { path: 'doc.pdf', page: 2 }, {}, env(true));
  expect([page.text, page.images?.[0]?.path]).toEqual(['Page 2 of doc.pdf (3 pages) is attached as a picture for you to look at.', 'doc.pdf, page 2']);
  expect((await execute('Read', { path: 'doc.pdf', page: 2 }, {}, env(false))).text).toMatch(/^Page 2 of doc\.pdf as text \(this model is not looking at pictures/);
  expect((await execute('Read', { path: 'doc.pdf', page: 9 }, {}, env(true))).text).toBe('doc.pdf has 3 pages; there is no page 9.');
  // What needs the model to see (its vision is turned on first): a picture, a page asked for, a PDF with a scanned page.
  textPdf(join(proj, 'text.pdf'), ['only text']);
  expect(['shot.png', 'doc.pdf', 'text.pdf', 'none.png'].map((path) => needsSight(proj, { path }))).toEqual([true, true, false, false]);
  expect(needsSight(proj, { path: 'text.pdf', page: 1 })).toBe(true);
});

test('the vision add-on: each model has one; loaded only with vision on (--mmproj, when its file is here), and counted in the memory then', () => {
  for (const m of Object.values(MODELS)) expect([m.id, Boolean(m.vision?.url && m.vision.sha256?.length === 64 && m.vision.bytes > 1e8)]).toEqual([m.id, true]);
  const q = MODELS.qwen;
  expect(visionBytes(q)).toBe(0);
  expect(visionBytes(withVision(q))).toBe(q.vision.bytes + q.vision.computeBytes);
  expect(needBytes(withVision(q), 32768) - needBytes(q, 32768)).toBe(q.vision.bytes + q.vision.computeBytes);
  expect(serverArgs(q, { ctx: 32768, port: 1 })).not.toContain('--mmproj');
  expect(serverArgs(withVision(q), { ctx: 32768, port: 1 })).not.toContain('--mmproj'); // its file is not in this home
  mkdirSync(join(HOME, 'models'), { recursive: true });
  writeFileSync(visionPath(q), 'stand-in');
  const a = serverArgs(withVision(q), { ctx: 32768, port: 1 });
  expect(a[a.indexOf('--mmproj') + 1]).toBe(visionPath(q));
  expect(a[a.indexOf('--image-min-tokens') + 1]).toBe('1024'); // Qwen misread small pictures at the engine's own size
  expect(visionPath(MODELS.gemma)).not.toBe(visionPath(q)); // both repos call it mmproj-F16.gguf; kept apart here
});
