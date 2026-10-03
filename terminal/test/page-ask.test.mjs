// Look first, check after (agent.mjs askPage; the user's pick, 1 Oct 2026): a page saved for a
// request stops the turn, opens, and asks before anything checks it.
import { test, expect } from 'bun:test';
import { needs } from './needs.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, AUTO, CHECK_IT, looksGood, wantsCheck, missingParts } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { findChrome } from '../src/flows/layoutcheck.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const REQUEST = 'Build a self-contained HTML file for an invoice snapshot with a Download button';
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invoice</title>
<style>:root{color-scheme:light dark}body{margin:0;font-family:system-ui,sans-serif;background:#ffffff;color:#1c1b18}@media (prefers-color-scheme:dark){body{background:#15161a;color:#f2f2f2}}main{max-width:440px;margin:24px auto;padding:16px}button{font:inherit;padding:8px 14px;border-radius:8px;border:0;background:#1f66bd;color:#ffffff}</style></head>
<body><main><h1>Invoice INV-2026-0087</h1><p>Total $1,698.00</p><button id="download" type="button">Download</button></main></body></html>`;

const folder = () => mkdtempSync(join(tmpdir(), 'agentic-page-ask-'));
const pageAgent = (fake, { cwd, ask, opened = [], pageAsk = true, design }) => new Agent({
  url: fake.url, model, cwd, home: cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: false, mode: 'edits',
  flows: false, verify: false, confirmPlan: false, checkIns: false, ask, openPage: (p) => { opened.push(p); }, pageAsk, design,
});
// Answers the page questions in order; every other question (a permission) is a yes.
const answering = (answers, asked) => async (req) => {
  if (req.name !== 'Ask') return { choice: 'yes' };
  asked.push({ question: req.args.question, options: req.args.options });
  return { choice: 'answer', text: answers.shift() };
};
const lastUser = (req) => [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

test('a page saved for a request: the turn stops, the page opens, and "Looks good" ends it with no more steps', async () => {
  const cwd = folder();
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'invoice.html', content: PAGE } } },
    { tool: { name: 'Bash', args: { command: 'python3 -c "print(1)"' } } }, // its own check: never asked for
    { text: 'never sent' },
  ]);
  const asked = [];
  const opened = [];
  const agent = pageAgent(fake, { cwd, opened, ask: answering(['Looks good'], asked) });
  const said = [];
  agent.on('assistant', (e) => said.push(e));
  const reason = await agent.send(REQUEST);
  await fake.close();
  expect(reason).toBe('done');
  expect(fake.requests.length).toBe(1);
  expect(opened).toEqual([join(cwd, 'invoice.html')]);
  // The layout check is off in the tests (AGENTIC_LAYOUT=off), so "Check it" is not offered.
  expect(asked).toEqual([{ question: 'invoice.html is saved and open in your browser. Have a look: is it right?', options: ['Looks good'] }]);
  const last = 'Saved invoice.html. You looked at it and said it looks good, so nothing more was checked.';
  expect(agent.messages.at(-1)).toEqual({ role: 'assistant', content: last });
  expect(said.at(-1)).toMatchObject({ text: last, final: true });
});

test('what you type instead goes to the model; after its change the end of the turn asks again', async () => {
  const cwd = folder();
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'invoice.html', content: PAGE } } },
    { tool: { name: 'Edit', args: { path: 'invoice.html', old_text: '<p>Total $1,698.00</p>', new_text: '<p><strong>Total $1,698.00</strong></p>' } } },
    { text: 'The total is bold now.' },
    { text: 'never sent' },
  ]);
  const asked = [];
  const opened = [];
  const reason = await pageAgent(fake, { cwd, opened, ask: answering(['make the total bold', 'Looks good'], asked) }).send(REQUEST);
  await fake.close();
  expect(reason).toBe('done');
  expect(lastUser(fake.requests[1])).toBe('[Page] You stopped after saving invoice.html so the user could look at it. The user answered: make the total bold\nFollow that.');
  expect(readFileSync(join(cwd, 'invoice.html'), 'utf8')).toContain('<strong>Total');
  expect(asked.length).toBe(2);
  expect(fake.remaining()).toBe(1);
  expect(opened.length).toBe(2); // opened again: the page changed since you looked
});

test('without someone at the screen (coding -p, the benches) or with /design ask off, nothing stops or asks', async () => {
  for (const opts of [{ pageAsk: false }, { design: { ask: false } }]) {
    const cwd = folder();
    const fake = await startFakeServer([
      { tool: { name: 'Write', args: { path: 'invoice.html', content: PAGE } } },
      { text: 'Done: invoice.html.' },
    ]);
    const asked = [];
    const reason = await pageAgent(fake, { cwd, ask: answering([], asked), ...opts }).send(REQUEST);
    await fake.close();
    expect([opts, reason, asked.length, fake.requests.length]).toEqual([opts, 'done', 0, 2]);
  }
});

test('a page still waiting for its own script or style sheet is not finished: the turn goes on', async () => {
  const cwd = folder();
  const linked = PAGE.replace('</head>', '<link rel="stylesheet" href="style.css"><link rel="icon" href="icon.png"></head>').replace('</body>', '<script src="app.js"></script></body>');
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'invoice.html', content: linked } } },
    { tool: { name: 'Write', args: { path: 'style.css', content: 'body{margin:0}' } } },
    { tool: { name: 'Write', args: { path: 'app.js', content: 'console.log(1)' } } },
    { text: 'Made the page, its styles and its script.' },
    { text: 'never sent' },
  ]);
  const asked = [];
  const reason = await pageAgent(fake, { cwd, ask: answering(['Looks good'], asked) }).send(REQUEST);
  await fake.close();
  expect(reason).toBe('done');
  expect(fake.requests.length).toBe(4); // asked only at the end, once all three were there
  expect(asked.map((a) => a.question)).toEqual(['invoice.html is saved and open in your browser. Have a look: is it right?']);
});

test('the answers: looks good, check it, or words for the model; a page\'s missing parts', () => {
  for (const t of ['Looks good', 'looks great!', 'perfect', 'ok', 'yes', 'thanks', "it's good"]) expect([t, looksGood(t)]).toEqual([t, true]);
  for (const t of ['looks good but make the total bold', 'make it blue', 'good, add a logo', 'no']) expect([t, looksGood(t)]).toEqual([t, false]);
  for (const t of [CHECK_IT, 'check it', 'Check it please', 'test it']) expect([t, wantsCheck(t)]).toEqual([t, true]);
  expect(wantsCheck('make the check mark green')).toBe(false);
  const dir = folder();
  writeFileSync(join(dir, 'here.js'), '');
  mkdirSync(join(dir, 'css'));
  writeFileSync(join(dir, 'css', 'site.css'), '');
  const html = '<link rel="stylesheet" href="css/site.css"><link rel=stylesheet href="gone.css"><link rel="icon" href="icon.png"><script src="here.js"></script><script src="later.js?v=2"></script><script src="https://cdn.x/y.js"></script><script src="/root.js"></script><script>inline()</script>';
  expect(missingParts(html, dir)).toEqual(['gone.css', 'later.js']);
});

// "Check it for me" runs the real layout check; what it finds is shown, and fixing it is asked too.
const chrome = findChrome();
test.skipIf(needs('chrome', () => chrome))('in a real browser: "Check it for me" finds the dead Download button and asks before fixing; "Fix it" sends it back', async () => {
  const keep = process.env.AGENTIC_LAYOUT;
  process.env.AGENTIC_LAYOUT = 'on';
  try {
    const cwd = folder();
    const fake = await startFakeServer([
      { tool: { name: 'Write', args: { path: 'invoice.html', content: PAGE } } },
      { text: 'The Download button saves the invoice now.' }, // says fixed, changed nothing
      { text: 'never sent' },
    ]);
    const asked = [];
    const notes = [];
    const agent = pageAgent(fake, { cwd, ask: answering([CHECK_IT, 'Fix it', 'Leave it'], asked) });
    agent.on('note', (e) => notes.push(e.text));
    const reason = await agent.send(REQUEST);
    await fake.close();
    expect(reason).toBe('done');
    expect(asked[0].options).toEqual(['Looks good', CHECK_IT]);
    expect(asked[1]).toEqual({ question: 'The page check found a problem (above). Fix it?', options: ['Fix it', 'Leave it'] });
    expect(notes.some((n) => /^Layout check, invoice\.html: 1 problem \([\d.]+ s\): Clicking "Download" \(button#download\) changes nothing/.test(n))).toBe(true);
    const back = lastUser(fake.requests[1]);
    expect(back).toStartWith(AUTO);
    expect(back).toContain('Clicking "Download" (button#download) changes nothing');
    // After its "fix" the page is looked at again, and what is left is asked about once more.
    expect(asked[2].question).toBe('The page check found a problem left after the fix (above). Fix it?');
    expect(fake.remaining()).toBe(1);
  } finally {
    if (keep === undefined) delete process.env.AGENTIC_LAYOUT; else process.env.AGENTIC_LAYOUT = keep;
  }
}, 60_000);
