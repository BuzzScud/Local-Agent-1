// Look first (/effort's last row, agent/look.mjs): a minimum of looking before the model answers.
import { test, expect, setSystemTime, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

// A throwaway home BEFORE the models part is first imported (it reads AGENTIC_HOME once).
process.env.AGENTIC_HOME = mkdtempSync(join(tmpdir(), 'agentic-look-home-'));
const { lookSecs, showLook, lookBackNote, LOOK_NOTE, LOOK_BACKS, LOOK_STEPS } = await import('../src/agent/look.mjs');
const { LIMITS, defaultLimits, readLimits, limitNote, limitsToSave, applyLimits, panelData } = await import('../src/app/limits.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

afterEach(() => setSystemTime());
const model = MODELS[DEFAULT_MODEL];

test('the minimum: auto follows Effort (Low none, Medium 15 s, High 30 s); off; or a number of seconds whatever the Effort', () => {
  expect(LOOK_STEPS).toEqual(['auto', 'off', '15', '30', '45', '60']);
  expect(lookSecs('auto', { thinking: false })).toBe(0);
  expect(lookSecs('auto', { thinking: true, effort: 'high' })).toBe(30);
  expect(lookSecs('auto', { thinking: true, effort: 'medium' })).toBe(15);
  expect(lookSecs('off', { thinking: true, effort: 'high' })).toBe(0);
  expect(lookSecs('45', { thinking: false })).toBe(45);
  expect(['auto', 'off', '15', '60'].map(showLook)).toEqual(['auto', 'off', '15 s', '60 s']);
  expect(lookBackNote([])).toContain('You have not looked at any file yet.');
  expect(lookBackNote(['Read(a.mjs)', 'Read(a.mjs)', 'Search(total)'])).toContain('So far you looked at: Read(a.mjs); Search(total).');
});

test('/effort: the last row, auto by default, saved only when moved, its note says what the minimum is now', () => {
  expect(LIMITS.at(-1).id).toBe('look'); // last, so the rows above keep their places
  expect(defaultLimits(model).look).toBe('auto');
  expect(readLimits({ limits: { look: '60' } }, model).look).toBe('60');
  expect(readLimits({ limits: { look: 60 } }, model).look).toBe('auto'); // not a step: the default stays
  expect(limitsToSave({ ...defaultLimits(model), look: 'off' }, model)).toEqual({ look: 'off' });
  const env = (look, effortOn, effortLevel) => ({ values: { ...defaultLimits(model), look }, effortOn, effortLevel });
  expect(limitNote('look', env('auto', false, null))).toBe('follows Effort: none on Low · answers as soon as it is ready');
  expect(limitNote('look', env('auto', true, 'high'))).toBe(`follows Effort: 30 s · searches and reads at least 30 s before it answers; sent back up to ${LOOK_BACKS}×`);
  expect(limitNote('look', env('45', false, null))).toBe(`searches and reads at least 45 s before it answers; sent back up to ${LOOK_BACKS}×`);
  const a = {};
  applyLimits(a, { ...defaultLimits(model), look: '15' });
  expect(a.look).toBe('15');
  // the Tests page's panel shows it and a run may be given it
  expect(panelData([model])[model.id].rows.at(-1)).toMatchObject({ id: 'look', label: 'Look first', def: 'auto' });
});

function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-look-'));
  writeFileSync(join(cwd, 'cart.mjs'), 'export const total = (xs) => xs.reduce((a, b) => a + b, 0);\n');
  writeFileSync(join(cwd, 'package.json'), '{"type":"module"}');
  return cwd;
}
const agentFor = (url, cwd, opts = {}) => new Agent({ url, model, cwd, system: systemPrompt({ cwd, git: 'none' }), memory: false, flows: false, verify: false, mode: 'edits', ...opts });

test('an answer before the minimum goes back to look further, with what it looked at; at most 3 times', async () => {
  const cwd = project();
  const fake = await startFakeServer([
    { tool: { name: 'Read', args: { path: 'cart.mjs' } } },
    { text: 'total adds the numbers.' }, { text: 'Still: total adds the numbers.' }, { text: 'Again.' }, { text: 'Final answer.' },
  ], { delayMs: 0 });
  try {
    const agent = agentFor(fake.url, cwd);
    agent.look = '60';
    const notes = [];
    agent.on('note', (e) => notes.push(e.text));
    await agent.send('what does total in cart.mjs do?');
    expect(notes[0]).toBe('Looking first: at least 60 s of searching and reading before it answers (/effort Look first).');
    expect(notes.filter((n) => /of the 60 s minimum \(\/effort Look first\); asked it to look further first\./.test(n))).toHaveLength(LOOK_BACKS);
    const loop = fake.requests.filter((r) => r.tools?.length);
    expect(loop[0].messages.findLast((m) => m.role === 'user').content).toBe(`what does total in cart.mjs do?\n\n(${LOOK_NOTE})`);
    const back = agent.messages.filter((m) => m.role === 'user' && String(m.content).includes('Before you answer, look further.'));
    expect(back).toHaveLength(LOOK_BACKS);
    expect(back[0].content).toContain('So far you looked at: Read(cart.mjs).');
    expect(agent.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Final answer.' }); // after 3 it stands
  } finally { await fake.close(); }
});

test('once the minimum has passed the answer stands; Low (auto) never waits; nor the home folder, a changed file or a helper', async () => {
  const cwd = project();
  // the minimum passes while it reads: the first answer stands
  let t = Date.now();
  const fake = await startFakeServer([], { delayMs: 0, route: (req) => {
    if (!req.tools?.length) return { text: '{}' };
    t += 20_000; setSystemTime(new Date(t));
    return req.messages.some((m) => m.role === 'tool') ? { text: 'It adds them.' } : { tool: { name: 'Read', args: { path: 'cart.mjs' } } };
  } });
  try {
    const a = agentFor(fake.url, cwd);
    a.look = '15';
    const notes = [];
    a.on('note', (e) => notes.push(e.text));
    await a.send('what does total in cart.mjs do?');
    expect(notes.some((n) => n.includes('asked it to look further'))).toBe(false);
    expect(a.messages.at(-1).content).toBe('It adds them.');
    setSystemTime();
    // a bare Agent does not look first; the app and coding -p set the row from /effort
    expect(agentFor(fake.url, cwd, { thinking: true, effort: 'high' }).look).toBe('off');
    // auto on Low (thinking off): no note with the request, no wait
    const low = agentFor(fake.url, cwd, { thinking: false });
    low.look = 'auto';
    expect(low.lookSecsNow).toBe(0);
    const before = fake.requests.length;
    await low.send('what does total do?');
    const asked = fake.requests.slice(before).find((r) => r.tools?.length).messages.findLast((m) => m.role === 'user').content;
    expect(asked).toBe('what does total do?');
    // auto on High: 30 s
    const high = agentFor(fake.url, cwd, { thinking: true, effort: 'high' });
    high.look = 'auto';
    expect(high.lookSecsNow).toBe(30);
  } finally { await fake.close(); setSystemTime(); }
  // the home folder: a general question needs no files
  const home = await startFakeServer([{ text: 'Four.' }, { text: 'It adds them.' }], { delayMs: 0 });
  try {
    const h = agentFor(home.url, homedir());
    h.look = '60';
    const notes = [];
    h.on('note', (e) => notes.push(e.text));
    await h.send('what is 2 plus 2 in words?');
    expect(notes.some((n) => n.startsWith('Looking first'))).toBe(false);
    // a helper is part of the looking: it never waits itself
    const helper = agentFor(home.url, cwd);
    Object.assign(helper, { look: '60', isHelper: true });
    const seen = [];
    helper.on('note', (e) => seen.push(e.text));
    await helper.send('what does total in cart.mjs do?');
    expect(seen.some((n) => n.startsWith('Looking first') || n.includes('look further'))).toBe(false);
  } finally { await home.close(); }
  // a change made: the answer after it is not sent back to look
  const edit = await startFakeServer([{ tool: { name: 'Write', args: { path: 'notes.md', content: '# Notes\n' } } }, { text: 'Made notes.md.' }], { delayMs: 0 });
  try {
    const e = agentFor(edit.url, cwd, { confirmPlan: false });
    e.look = '60';
    const notes = [];
    e.on('note', (x) => notes.push(x.text));
    await e.send('make a file notes.md with a Notes heading');
    expect(readFileSync(join(cwd, 'notes.md'), 'utf8')).toBe('# Notes\n'); // the change was made
    expect(e.messages.at(-1).content).toBe('Made notes.md.');
    expect(notes.some((n) => n.includes('asked it to look further'))).toBe(false);
  } finally { await edit.close(); }
});
