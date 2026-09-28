// /increase: the limits that move up and down (src/app/limits.mjs), and that
// the agent and its tools really follow them.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, defaultLimits, readLimits, limitsToSave, moveLimit, limitChanges, modelWithLimits, applyLimits, showLimit, limitNote } from '../src/app/limits.mjs';
import { COMMANDS } from '../src/app/commands.mjs';
import { Agent } from '../src/agent/agent.mjs';
import { execute } from '../src/agent/tools.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const project = () => { const d = mkdtempSync(join(tmpdir(), 'bonsai-limits-')); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };

test('/increase is a command, and every limit has a default on one of its own steps', () => {
  expect(COMMANDS.some((c) => c.name === 'increase')).toBe(true);
  const d = defaultLimits(model);
  expect(d).toEqual({ context: 0, thinking: model.thinkingBudget, tries: 8, steps: 40, outputLines: 80, timeoutSecs: 120, trimAt: 0.78, summarizeAt: 0.85 });
  for (const l of LIMITS) expect(l.steps(model)).toContain(d[l.id]);
  // the context goes as far as the model can (Gemma: 256k), 0 = auto
  expect(LIMITS[0].steps(model)).toEqual([0, 16384, 32768, 65536, 131072, 262144]);
});

test('saved limits: valid ones are used, junk and out-of-range ones are left out, only changes are saved', () => {
  const v = readLimits({ limits: { context: 131072, tries: 12, steps: 'lots', outputLines: 10_000, timeoutSecs: 300 } }, model);
  expect(v.context).toBe(131072);
  expect(v.tries).toBe(12);
  expect(v.steps).toBe(40); // not a number
  expect(v.outputLines).toBe(80); // past the last step
  expect(v.timeoutSecs).toBe(300);
  expect(limitsToSave(v, model)).toEqual({ context: 131072, tries: 12, timeoutSecs: 300 });
  expect(limitsToSave(defaultLimits(model), model)).toEqual({});
  // trim at or past summarize would never trim: both go back to their defaults
  const bad = readLimits({ limits: { trimAt: 0.85, summarizeAt: 0.85 } }, model);
  expect([bad.trimAt, bad.summarizeAt]).toEqual([0.78, 0.85]);
});

test('←→ moves one step, stops at the ends, and trim stays below summarize', () => {
  let v = defaultLimits(model);
  v = moveLimit(v, 'context', 1, model);
  expect(v.context).toBe(16384);
  for (let i = 0; i < 9; i++) v = moveLimit(v, 'context', 1, model);
  expect(v.context).toBe(262144);
  v = moveLimit(v, 'thinking', 1, model);
  expect(v.thinking).toBe(8192);
  expect(moveLimit(v, 'thinking', 1, model).thinking).toBe(8192);
  v = moveLimit(v, 'trimAt', 1, model); // 78% → 85% would reach summarize (85%)
  expect(v.trimAt).toBe(0.78);
  v = moveLimit(moveLimit(v, 'summarizeAt', 1, model), 'trimAt', 1, model); // summarize 90%, then trim 85%
  expect([v.trimAt, v.summarizeAt]).toEqual([0.85, 0.9]);
  expect(moveLimit(v, 'summarizeAt', -1, model).summarizeAt).toBe(0.9); // 85% would meet trim
  // a hand-typed value between steps goes to the next step that way
  expect(moveLimit({ ...v, tries: 5 }, 'tries', 1, model).tries).toBe(8);
  expect(moveLimit({ ...v, tries: 5 }, 'tries', -1, model).tries).toBe(4);
});

test('each value says what it costs; the changes read as from → to', () => {
  const v = { ...defaultLimits(model), context: 131072 };
  const env = { model, freeBytes: 7.2e9, tps: 13, pps: 130, ctxNow: 16384, values: v };
  expect(limitNote('context', env)).toMatch(/^⚠ needs 9\.\d GB of 7\.2 free · a full re-read ~13 min$/);
  expect(limitNote('context', { ...env, freeBytes: 12e9 })).not.toContain('⚠');
  expect(limitNote('context', { ...env, values: { ...v, context: 0 } })).toBe('32k, or 16k when memory is short');
  expect(limitNote('thinking', { ...env, values: { ...v, thinking: 8192 } })).toBe('up to ~11 min per think (High only)');
  // at 16k an 8,192 cap would leave the chat no room
  expect(limitNote('thinking', { ...env, values: { ...v, context: 16384, thinking: 8192 } })).toBe('⚠ too big for a 16k context: raise Context first');
  expect(showLimit('timeoutSecs', 300)).toBe('5 min');
  expect(showLimit('summarizeAt', 0.85)).toBe('85%');
  expect(limitChanges(defaultLimits(model), v)).toEqual([{ id: 'context', label: 'Context', from: 'auto', to: '128k', restart: true }]);
});

test('the thinking cap reaches the model copy; the registry model is never changed', () => {
  const was = model.thinkingBudget;
  const m = modelWithLimits(model, { thinking: 8192 });
  expect(m.thinkingBudget).toBe(8192);
  expect(m.file).toBe(model.file);
  expect(model.thinkingBudget).toBe(was);
  expect(modelWithLimits(model, { thinking: was })).toBe(model);
});

test('the agent stops after the steps /increase set, and says where to move it', async () => {
  const cwd = project();
  const fake = await startFakeServer(Array.from({ length: 10 }, () => ({ tool: { name: 'List', args: { path: '.' } } })));
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, ctx: 32768, mode: 'edits', flows: false, ask: async () => ({ choice: 'yes' }) });
  applyLimits(agent, { ...defaultLimits(model), steps: 3 });
  const notes = [];
  agent.on('note', (n) => notes.push(n.text));
  const reason = await agent.send('list the files forever');
  await fake.close();
  expect(reason).toBe('limit');
  expect(fake.requests.length).toBe(3);
  expect(notes).toContain('Stopped after 3 steps (/increase moves this).');
});

test('Bash shows the output lines and stops at the timeout /increase set', async () => {
  const cwd = project();
  const cut = await execute('Bash', { command: 'seq 1 100' }, {}, { cwd, bash: { maxLines: 10, timeoutMs: 120_000 } });
  expect(cut.view.lines).toEqual(['1', '2', '3', '4', '5', '… 90 lines cut …', '96', '97', '98', '99', '100']);
  const whole = await execute('Bash', { command: 'seq 1 100' }, {}, { cwd, bash: { maxLines: 160, timeoutMs: 120_000 } });
  expect(whole.view.lines).toHaveLength(100);
  const slow = await execute('Bash', { command: 'sleep 5' }, {}, { cwd, bash: { maxLines: 80, timeoutMs: 500 } });
  expect(slow.text).toContain('(stopped after 1 s)');
}, 15_000);
