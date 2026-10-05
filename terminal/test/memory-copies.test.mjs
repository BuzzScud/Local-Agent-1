// Older copies leave the conversation before notes are needed (agent.mjs dropSuperseded; 5 Oct 2026, the owner's
// pick). In the hard task's runs a model read one file five to twenty times, wrote it whole three to six times
// and ran the same tests ten times; memory filled in most runs, the notes started the conversation over, and it
// read the files again. What the conversation holds a newer copy of now goes first, on a model on another machine.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-copies-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent } = await import('../src/agent/agent.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

const local = MODELS[DEFAULT_MODEL];
const remote = { ...local, remote: { kind: 'openai', label: 'the service', ollama: '0.12.0' } };
const big = (word, lines = 120) => Array.from({ length: lines }, (_, i) => `${word} line ${i + 1} of the file, long enough to count for something`).join('\n');
let n = 0;
const call = (name, args) => { const id = `c${++n}`; return { id, msg: { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }; };
const step = (name, args, result, extra = {}) => { const c = call(name, args); return [c.msg, { role: 'tool', tool_call_id: c.id, content: result, ...extra }]; };
function agentWith(steps, model = remote, extra = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-copies-'));
  writeFileSync(join(cwd, 'tools.mjs'), 'export const x = 1;\n');
  const a = new Agent({ url: 'http://127.0.0.1:1', model, cwd, system: 'x', memory: false, flows: false, way: 'model', hooks: [], thinking: false, ctx: 32768, ...extra });
  a.messages.push({ role: 'user', content: 'change tools.mjs' }, ...steps.flat());
  return a;
}
const outs = (a) => a.messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
const args = (a, i) => JSON.parse(a.messages.filter((m) => m.role === 'assistant')[i].tool_calls[0].function.arguments);

test('an older read, an older version it wrote and an older run of the same command go; the newest of each stays', () => {
  const a = agentWith([
    step('Read', { path: 'tools.mjs' }, `tools.mjs (120 lines):\n${big('first')}`),
    step('Write', { path: 'tools.mjs', content: big('written once') }, 'Updated tools.mjs (+120 −1 lines).'),
    step('Bash', { command: 'npm test' }, `> test\n${big('✖ failing', 30)}\nℹ fail 30`),
    step('Read', { path: 'tools.mjs' }, `tools.mjs (120 lines):\n${big('second')}`),
    step('Write', { path: 'tools.mjs', content: big('written twice') }, 'Updated tools.mjs (+120 −120 lines).'),
    step('Bash', { command: 'npm test' }, '> test\n(15 passing tests not shown)\nℹ tests 15\nℹ pass 15\nℹ fail 0'),
    step('Read', { path: 'tools.mjs', offset: 10, limit: 11 }, `tools.mjs (lines 10-20 of 120; pass offset to read on):\n${big('part', 11)}`),
    step('List', { path: '.' }, 'tools.mjs'),
  ]);
  const d = a.dropSuperseded();
  expect(d).toMatchObject({ reads: 1, files: 1, writes: 1, runs: 1 });
  expect(d.freed).toBeGreaterThan(3000);
  const o = outs(a);
  expect(o[0]).toBe('[older output removed to save space: an older copy of tools.mjs; its text is further down]');
  expect(o[2]).toBe('[older output removed to save space: an earlier run of npm test; its newest run is further down]');
  expect(o[3]).toContain('second line 120'); // the newest whole read
  expect(o[5]).toContain('ℹ pass 15'); // the newest run
  expect(o[6]).toContain('part line 11'); // lines read since
  // The older version it wrote is a line now, in a call that still reads as one; the newer one is whole.
  expect(args(a, 1)).toEqual({ path: 'tools.mjs', content: '[an older version of this file, removed to save space: it was written or read whole again later]' });
  expect(args(a, 4).content).toContain('written twice line 120');
  // A second pass finds nothing more.
  expect(a.dropSuperseded().freed).toBe(0);
});

test('what stays: the two newest outputs, a kept error, short outputs, and text no later result holds', () => {
  const a = agentWith([
    step('Read', { path: 'tools.mjs', offset: 1, limit: 100 }, `tools.mjs (lines 1-100 of 500; pass offset to read on):\n${big('top', 100)}`),
    // The same Read again was moved on to the next part: it does not hold the first.
    step('Read', { path: 'tools.mjs', offset: 1, limit: 100 }, `(You asked for the same part of tools.mjs again; it is above, so here is the part after it.)\ntools.mjs (lines 101-200 of 500; pass offset to read on):\n${big('next', 100)}`),
    step('Read', { path: 'tools.mjs' }, `tools.mjs (120 lines):\n${big('whole')}`),
    // Pointed back, not given again: this is no newer copy.
    step('Read', { path: 'tools.mjs' }, 'You already read this part of tools.mjs and it has not changed since; it is above. Use it, or read a different part.'),
    step('Bash', { command: 'npm test' }, `> test\n${big('✖ kept', 30)}`, { keep: 'error' }),
    step('Bash', { command: 'npm test' }, 'blocked: wait for the other run to end'),
    step('Bash', { command: 'ls' }, 'tools.mjs'),
    step('Bash', { command: 'ls' }, 'tools.mjs'),
  ]);
  const before = outs(a);
  const d = a.dropSuperseded();
  // The whole read came after both parts, so they go; nothing else does.
  expect(d).toMatchObject({ reads: 2, files: 1, writes: 0, runs: 0 });
  const o = outs(a);
  expect(o[0]).toStartWith('[older output removed');
  expect(o[1]).toStartWith('[older output removed');
  expect(o.slice(2)).toEqual(before.slice(2));
});

test('a part read again later replaces only the same lines', () => {
  const a = agentWith([
    step('Read', { path: 'tools.mjs', offset: 1, limit: 100 }, `tools.mjs (lines 1-100 of 500; pass offset to read on):\n${big('top', 100)}`),
    step('Read', { path: 'tools.mjs', offset: 101, limit: 100 }, `tools.mjs (lines 101-200 of 500; pass offset to read on):\n${big('mid', 100)}`),
    step('Read', { path: 'tools.mjs', offset: 1, limit: 100 }, `tools.mjs (lines 1-100 of 500; pass offset to read on):\n${big('top again', 100)}`),
    step('List', { path: '.' }, 'tools.mjs'),
    step('List', { path: 'src' }, 'nothing'),
  ]);
  expect(a.dropSuperseded()).toMatchObject({ reads: 1, files: 1 });
  const o = outs(a);
  expect(o[0]).toStartWith('[older output removed');
  expect(o[1]).toContain('mid line 100');
  expect(o[2]).toContain('top again line 100');
});

test('when memory is nearly full on a service, the older copies go and no notes are needed; on this Mac it is as before', async () => {
  const steps = () => [
    step('Read', { path: 'tools.mjs' }, `tools.mjs (400 lines):\n${big('first', 400)}`),
    step('Read', { path: 'tools.mjs' }, `tools.mjs (400 lines):\n${big('second', 400)}`),
    step('Read', { path: 'tools.mjs' }, `tools.mjs (400 lines):\n${big('third', 400)}`),
    step('List', { path: '.' }, 'tools.mjs'),
    step('List', { path: 'src' }, 'nothing'),
  ];
  const a = agentWith(steps());
  const notes = [];
  a.on('note', (e) => notes.push(e.text));
  a.ctxUsed = 27_000; // of 32k: past the line where the cleanup starts
  const held = a.messages.length;
  await a.fitContext();
  expect(notes.some((t) => /^Memory: dropped what it has a newer copy of \(2 older reads of 1 file\), about [\d,]+ tokens\.$/.test(t))).toBe(true);
  expect(notes.some((t) => /Memory full/.test(t))).toBe(false);
  expect(a.messages.length).toBe(held); // the conversation goes on as it was
  expect(a.ctxUsed).toBeLessThan(20_000);
  // On this Mac a changed old message is read again slowly, so its conversations are left to the notes.
  const here = agentWith(steps(), local);
  let asked = false;
  here.dropSuperseded = () => { asked = true; return { freed: 0 }; };
  here.notesInPlace = async () => true;
  here.ctxUsed = 27_000;
  await here.fitContext();
  expect(asked).toBe(false);
});
