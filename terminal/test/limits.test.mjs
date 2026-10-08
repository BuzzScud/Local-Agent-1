// /effort (one panel): the effort and the limits that move up and down
// (src/app/limits.mjs), and that the agent and its tools really follow them.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, defaultLimits, readLimits, limitsToSave, moveLimit, limitChanges, modelWithLimits, applyLimits, applySearch, searchModels, showLimit, limitNote, effortNote, defaultLevelId, TEST_CTX, testDefaults, testSettings, testLimits, panelData, OWN_ROWS, ownOf, shownLimits } from '../src/app/limits.mjs';
import { COMMANDS } from '../src/app/commands.mjs';
import { Agent } from '../src/agent/agent.mjs';
import { execute } from '../src/agent/tools.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const project = () => { const d = mkdtempSync(join(tmpdir(), 'agentic-limits-')); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };

test('/effort is the one command for the panel (/increase is gone), and every limit has a default on one of its own steps', () => {
  expect(COMMANDS.some((c) => c.name === 'increase')).toBe(false);
  // /effort alone opens the panel, so it runs at once from the "/" menu
  expect(COMMANDS.find((c) => c.name === 'effort').picker).toBe(true);
  const d = defaultLimits(model);
  // the search's rows first (BGE-M3, by meaning, no reranker: as before), then the limits
  expect(d).toEqual({ embedder: 'bge-m3', retriever: 'meaning', reranker: 'off', context: 0, thinking: model.thinkingBudget, replyTokens: 0, temperature: 'own', presence: 'own', keepLoaded: 'open', tries: 8, steps: 40, rulesRoom: 0, upFront: 0, outputLines: 80, timeoutSecs: 120, trimAt: 0.78, summarizeAt: 0.85, way: 'app', look: 'auto' });
  // Who decides first, under the Effort row with no heading; then the search's three rows
  expect(LIMITS[0]).toMatchObject({ id: 'way', group: 'Effort', label: 'Who decides' });
  expect(LIMITS.slice(1, 4).map((l) => [l.id, l.group])).toEqual([['embedder', 'Search'], ['retriever', 'Search'], ['reranker', 'Search']]);
  for (const l of LIMITS) expect(l.steps(model)).toContain(d[l.id]);
  // the context goes as far as the model can (Gemma: 256k), 0 = auto
  expect(LIMITS.find((l) => l.id === 'context').steps(model)).toEqual([0, 16384, 32768, 65536, 131072, 262144]);
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

test('the Claude API has no step limit: Steps per request starts at "no limit" (0) there, the agent runs without a cap, and a saved 0 means nothing on a local model', () => {
  const claude = { ...model, id: 'remote', remote: { kind: 'claude', model: 'claude-opus-5-5' } };
  const row = LIMITS.find((l) => l.id === 'steps');
  expect(row.steps(claude)).toEqual([0, 20, 40, 60, 80, 120]);
  expect(row.steps(model)).toEqual([20, 40, 60, 80, 120]);
  expect(defaultLimits(claude).steps).toBe(0);
  expect(row.show(0)).toBe('no limit');
  expect(row.note(0)).toContain('until the request is done');
  // a count picked in /effort still wins there
  expect(readLimits({ limits: { steps: 60 } }, claude).steps).toBe(60);
  expect(limitsToSave({ ...defaultLimits(claude), steps: 60 }, claude)).toEqual({ steps: 60 });
  // 0 saved on Claude: a local model (whose row starts at 20) keeps its own 40
  expect(readLimits({ limits: { steps: 0 } }, model).steps).toBe(40);
  const agent = { bash: {} };
  applyLimits(agent, defaultLimits(claude));
  expect(agent.maxSteps).toBe(Infinity);
  applyLimits(agent, defaultLimits(model));
  expect(agent.maxSteps).toBe(40);
});

test('big-model mode: a big model on a service starts with more steps, tries and output, the app still deciding; what /effort saved still wins, and a save on it keeps the rows it left alone', () => {
  const big = { ...model, id: 'remote', remote: { kind: 'openai', ollama: '0.32.12', model: 'qwen3-coder:30b' }, harness: { steps: 80, tries: 12, outputLines: 160, read: { whole: 400, part: 400, max: 1000 } } };
  const small = defaultLimits(model);
  const d = defaultLimits(big);
  expect([small.way, small.steps, small.tries, small.outputLines]).toEqual(['app', 40, 8, 80]);
  expect([d.way, d.steps, d.tries, d.outputLines]).toEqual(['app', 80, 12, 160]);
  // the rest is this Mac's
  expect({ ...d, steps: 0, tries: 0, outputLines: 0 }).toEqual({ ...small, thinking: d.thinking, steps: 0, tries: 0, outputLines: 0 });
  // saved wins on either
  expect(readLimits({ limits: { way: 'model', steps: 60 } }, big)).toMatchObject({ way: 'model', steps: 60, tries: 12 });
  // Steps 80 saved on Qwen, then Command output moved on a big model (where 80 is the default):
  // Steps stays saved, so back on Qwen it is still 80
  const v = { ...readLimits({ limits: { steps: 80 } }, big), outputLines: 320 };
  expect(limitsToSave(v, big)).toEqual({ outputLines: 320 });
  expect(limitsToSave(v, big, { steps: 80 })).toEqual({ steps: 80, outputLines: 320 });
  // a row this save moved back to the default is not kept (Reset all, or ← to it)
  expect(limitsToSave(d, big, {})).toEqual({});
});

test('a model on a service keeps its own rows (/model’s menu): laid over the shared ones, the rest shared; another model, and this Mac’s, keep theirs; the Thinking cap and the search are not shown there', () => {
  const on = (name) => ({ ...model, id: 'remote', remote: { kind: 'openai', ollama: '0.32.12', model: name } });
  const settings = { limits: { steps: 60, timeoutSecs: 300, way: 'model' }, remote: { tuned: { 'laguna-s-2.1:latest': { level: 'high', limits: { steps: 80, timeoutSecs: 600, outputLines: 160, way: 'app', context: 131072, tries: 'many' } } } } };
  // its own rows win; a shared row (Who decides) or one it cannot keep (Context: "contexts" holds it) is not taken from its set, nor a bad value
  expect(readLimits(settings, on('laguna-s-2.1:latest'))).toMatchObject({ steps: 80, timeoutSecs: 600, outputLines: 160, way: 'model', context: 0, tries: 8 });
  expect(readLimits(settings, on('laguna-s-2.1:latest'), { own: false })).toMatchObject({ steps: 60, timeoutSecs: 300, outputLines: 80 });
  // another model on the service, and this Mac's, have the shared ones
  expect(readLimits(settings, on('ornith:35b'))).toMatchObject({ steps: 60, timeoutSecs: 300, outputLines: 80 });
  expect(readLimits(settings, model)).toMatchObject({ steps: 60, timeoutSecs: 300, outputLines: 80 });
  expect(ownOf(settings, 'laguna-s-2.1:latest').level).toBe('high');
  expect(ownOf(settings, 'ornith:35b')).toBe(null);
  expect(OWN_ROWS).toEqual(['replyTokens', 'temperature', 'presence', 'keepLoaded', 'tries', 'steps', 'rulesRoom', 'upFront', 'outputLines', 'timeoutSecs', 'trimAt', 'summarizeAt', 'look']);
  // the rows: all on this Mac; no Thinking cap on a service; the menu has the model's own and its Context
  // the rows: this Mac's as before (no model rows); on a service no Thinking cap or search, and the model's rows; the menu has the model's own and its Context
  expect(shownLimits(model).map((l) => l.id)).toEqual(LIMITS.filter((l) => !['replyTokens', 'temperature', 'presence', 'keepLoaded'].includes(l.id)).map((l) => l.id));
  expect(shownLimits(on('x')).map((l) => l.id)).toEqual(LIMITS.filter((l) => l.id !== 'thinking' && l.group !== 'Search').map((l) => l.id));
  expect(panelData([model])[model.id].rows.map((r) => r.id)).not.toContain('replyTokens');
  expect(shownLimits(on('x'), { own: true }).map((l) => l.id)).toEqual(['context', ...OWN_ROWS]);
});

test('the model on a service: its Reply length and sampling go with its requests; its own leaves the service’s', () => {
  const svc = { ...model, id: 'remote', remote: { kind: 'openai', ollama: '0.32.12', model: 'x' }, sampling: {}, thinkingSampling: {}, maxCtx: 262144 };
  const d = defaultLimits(svc);
  expect([d.replyTokens, d.temperature, d.presence, d.keepLoaded]).toEqual([0, 'own', 'own', 'open']);
  expect(modelWithLimits(svc, { ...d, thinking: svc.thinkingBudget })).toBe(svc); // nothing of its own: the same model
  const m = modelWithLimits(svc, { ...d, thinking: svc.thinkingBudget, replyTokens: 32768, temperature: 0.2, presence: 1.5 });
  expect(m.replyTokens).toBe(32768);
  expect(m.sampling).toEqual({ temperature: 0.2, presence_penalty: 1.5 });
  expect(m.thinkingSampling).toEqual({ temperature: 0.2, presence_penalty: 1.5 });
  expect(readLimits({ remote: { tuned: { x: { limits: { temperature: 0, keepLoaded: 300, replyTokens: 9_999_999 } } } } }, svc)).toMatchObject({ temperature: 0, keepLoaded: 300, replyTokens: 0 }); // more than its longest step: left out
  expect(showLimit('keepLoaded', 'open')).toBe('while open');
  expect(showLimit('replyTokens', 32768)).toBe('32k tokens');
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
  const env = { model, freeBytes: 5.2e9, tps: 13, pps: 130, ctxNow: 16384, values: v, draft: false };
  expect(limitNote('context', env)).toMatch(/^⚠ needs 6\.\d GB of 5\.2 free · a full re-read ~13 min$/);
  // the speed helper counts when it comes along, as the start's check counts it
  expect(limitNote('context', { ...env, draft: true })).toMatch(/^⚠ needs 7\.\d GB of 5\.2 free/);
  expect(limitNote('context', { ...env, freeBytes: 12e9 })).not.toContain('⚠');
  expect(limitNote('context', { ...env, values: { ...v, context: 0 } })).toBe('32k, or 16k when memory is short');
  expect(limitNote('thinking', { ...env, values: { ...v, thinking: 8192 } })).toBe('up to ~11 min per think (High only)');
  // at 16k an 8,192 cap would leave the chat no room
  expect(limitNote('thinking', { ...env, values: { ...v, context: 16384, thinking: 8192 } })).toBe('⚠ too big for a 16k context: raise Context first');
  expect(showLimit('timeoutSecs', 300)).toBe('5 min');
  expect(showLimit('summarizeAt', 0.85)).toBe('85%');
  expect(limitChanges(defaultLimits(model), v)).toEqual([{ id: 'context', label: 'Context', from: 'auto', to: '128k', restart: true }]);
});

test('the Context row counts the search models still to load, from the values in the panel, as the start does', () => {
  const v = { ...defaultLimits(model), context: 65536 };
  const env = { model, freeBytes: 12e9, tps: 13, pps: 130, ctxNow: 32768, values: v, draft: false };
  const need = Number(/needs ([\d.]+) GB/.exec(limitNote('context', env))[1]);
  const seen = [];
  const note = limitNote('context', { ...env, searchBytes: (values) => { seen.push(values); return 2.3e9; } });
  expect(seen[0]).toBe(v); // what the panel shows now: turning the reranker off there counts at once
  expect(note.startsWith(`needs ${(need + 2.3).toFixed(1)} GB (2.3 search) of 12.0 free · a full re-read`)).toBe(true);
  expect(limitNote('context', { ...env, freeBytes: (need + 1) * 1e9, searchBytes: () => 2.3e9 })).toMatch(/^⚠ needs /);
  expect(limitNote('context', { ...env, searchBytes: () => 0 })).toBe(limitNote('context', env));
  // Off, or nowhere to use one (no memory, no code search): none to load.
  expect(searchModels({ memory: {}, helpers: new Set() }, { ...v, embedder: 'off', reranker: 'off' })).toEqual([]);
  expect(searchModels({ memory: null, helpers: new Set() }, { ...v, reranker: 'off' })).toEqual([]);
});

test('Effort row: the note names the cap in use, Reset all goes to the model default, and the Thinking cap says High only while Effort is Low', () => {
  const [low, high] = model.thinkingLevels;
  expect(effortNote(low, 4096)).toBe('answers straight away (fastest)');
  expect(effortNote(high, 4096)).toBe('thinks first; stopped at 4,096 tokens');
  expect(effortNote(high, 8192)).toBe('thinks first; stopped at 8,192 tokens'); // the cap moved in the same panel
  expect(effortNote({ id: 'x', label: 'X' }, 4096)).toBe(''); // a level without a note
  expect(defaultLevelId(model)).toBe('low'); // Gemma starts on Low (thinkingDefault false)
  const env = { model, freeBytes: 12e9, tps: 13, pps: 130, ctxNow: 32768, values: defaultLimits(model) };
  expect(limitNote('thinking', { ...env, effortOn: false })).toBe('High only: not used while Effort is Low');
  expect(limitNote('thinking', { ...env, effortOn: true })).toBe('up to ~5 min per think (High only)');
  expect(limitNote('thinking', env)).toBe('up to ~5 min per think (High only)'); // no Effort row: as before
  // on Low the too-big warning waits: it is not used, and shows again on High
  const big = { ...env, values: { ...env.values, context: 16384, thinking: 8192 } };
  expect(limitNote('thinking', { ...big, effortOn: false })).toBe('High only: not used while Effort is Low');
  expect(limitNote('thinking', { ...big, effortOn: true })).toBe('⚠ too big for a 16k context: raise Context first');
});

test('the thinking cap reaches the model copy; the registry model is never changed', () => {
  const was = model.thinkingBudget;
  const m = modelWithLimits(model, { thinking: 8192 });
  expect(m.thinkingBudget).toBe(8192);
  expect(m.file).toBe(model.file);
  expect(model.thinkingBudget).toBe(was);
  expect(modelWithLimits(model, { thinking: was })).toBe(model);
});

test('a test run from the Run tab: the tests\' defaults are the app\'s but 32k, it gets only the rows changed, and a value out of range falls back', () => {
  expect(testDefaults(model)).toEqual({ ...defaultLimits(model), context: TEST_CTX });
  for (const env of [{}, { AGENTIC_TEST_SETTINGS: 'not json' }, { AGENTIC_TEST_SETTINGS: '[4]' }, { AGENTIC_TEST_SETTINGS: '{}' }]) expect(testSettings(env)).toBeNull();
  expect(testSettings({ AGENTIC_TEST_SETTINGS: '{"tries":4}' })).toEqual({ tries: 4 });
  expect(testLimits(model, null)).toBeNull(); // no settings: the run is as it always was
  const l = testLimits(model, { tries: 4, steps: 999 });
  expect(l.tries).toBe(4);
  expect(l.steps).toBe(defaultLimits(model).steps);
  expect(l.context).toBe(TEST_CTX);
  expect(testLimits(model, { context: 16384 }).context).toBe(16384);
});

test('the Run tab\'s panel: every /effort row with its steps and what each costs, the effort levels, and Context\'s note for each pair of Search models', () => {
  const p = panelData([model], { freeBytes: 20e9 })[model.id];
  // (the model rows of a service, Reply length to Keep loaded, are not for this Mac's models the tests run)
  expect(p.rows.map((r) => r.id)).toEqual(LIMITS.filter((l) => !l.model).map((l) => l.id));
  expect(p.defs).toEqual(testDefaults(model));
  for (const r of p.rows) {
    expect(r.steps.some((s) => s.v === r.def)).toBe(true);
    for (const s of r.steps) { expect(typeof s.show).toBe('string'); expect(s.note.length).toBeGreaterThan(0); }
  }
  const ctx = p.rows.find((r) => r.id === 'context');
  expect(ctx.steps.some((s) => s.v === 0)).toBe(false); // Auto is the app's: a test run names its size
  expect(Object.keys(ctx.steps[0].bySearch)).toContain('off|off');
  expect(ctx.steps[0].bySearch['off|off']).not.toBe(ctx.steps[0].bySearch[`${p.defs.embedder}|off`]);
  expect(p.levels.map((l) => l.id)).toEqual((model.thinkingLevels ?? []).map((l) => l.id));
});

test('the agent stops after the steps /effort set, and says where to move it', async () => {
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
  expect(notes).toContain('Stopped after 3 steps (/effort moves this).');
});

test('Bash shows the output lines and stops at the timeout /effort set', async () => {
  const cwd = project();
  const cut = await execute('Bash', { command: 'seq 1 100' }, {}, { cwd, bash: { maxLines: 10, timeoutMs: 120_000 } });
  expect(cut.view.lines).toEqual(['1', '2', '3', '4', '5', '… 90 lines cut …', '96', '97', '98', '99', '100']);
  const whole = await execute('Bash', { command: 'seq 1 100' }, {}, { cwd, bash: { maxLines: 160, timeoutMs: 120_000 } });
  expect(whole.view.lines).toHaveLength(100);
  const slow = await execute('Bash', { command: 'sleep 5' }, {}, { cwd, bash: { maxLines: 80, timeoutMs: 500 } });
  expect(slow.text).toContain('(stopped after 1 s; for longer, send timeout (up to 600 seconds)');
}, 15_000);

test('Search rows: named choices move along their list, junk is left out, and only a change is saved', () => {
  let v = defaultLimits(model);
  expect(moveLimit(v, 'embedder', -1, model).embedder).toBe('off');
  expect(moveLimit(v, 'embedder', 1, model)).toBe(v); // BGE-M3 is the last choice
  v = moveLimit(v, 'retriever', 1, model);
  expect(v.retriever).toBe('hybrid');
  expect(moveLimit(v, 'retriever', 1, model)).toBe(v); // stops at the end
  v = moveLimit(v, 'reranker', 1, model);
  expect(v.reranker).toBe('qwen3-reranker-0.6b');
  expect(showLimit('reranker', v.reranker)).toBe('Qwen3 0.6B');
  expect(limitsToSave(v, model)).toEqual({ retriever: 'hybrid', reranker: 'qwen3-reranker-0.6b' });
  expect(limitChanges(defaultLimits(model), v).map((c) => `${c.label} ${c.from} → ${c.to}${c.restart ? ' ↻' : ''}`)).toEqual(['Retriever Meaning → Hybrid', 'Reranker Off → Qwen3 0.6B']);
  const r = readLimits({ limits: { embedder: 'nope', retriever: 'hybrid', reranker: 7 } }, model);
  expect([r.embedder, r.retriever, r.reranker]).toEqual(['bge-m3', 'hybrid', 'off']);
  // each says what it does
  const env = (values) => ({ model, values });
  expect(limitNote('embedder', env({ ...v, embedder: 'off' }))).toContain('words only');
  expect(limitNote('retriever', env({ ...v, embedder: 'off' }))).toContain('by words while Embedder is Off');
  expect(limitNote('reranker', env({ ...v, reranker: 'off' }))).toBe('the search’s own order');
});

test('applySearch: Embedder Off takes it from every search, back on makes one; the reranker starts only when its file is here', () => {
  const made = [];
  const stopped = [];
  const fake = (kind) => (m) => { const x = { kind, model: m, stop: async (o) => { stopped.push([kind, o]); } }; made.push(x); return x; };
  const opts = (here) => ({ make: { embedder: fake('embedder'), reranker: fake('reranker') }, ready: { embedder: () => true, reranker: () => here } });
  const e0 = { stop: async () => {} };
  const agent = { embedder: e0, ranker: e0, memory: { embedder: e0 }, codeIndex: {}, search: { retriever: 'meaning' }, reranker: null };
  const d = defaultLimits(model);
  expect(applySearch(agent, d, opts(true))).toBe(null);
  expect(agent.embedder).toBe(e0); // the one it had stays
  expect(agent.reranker).toBe(null);
  applySearch(agent, { ...d, embedder: 'off', retriever: 'hybrid' }, opts(true));
  expect([agent.embedder, agent.ranker, agent.memory.embedder, agent.codeIndex]).toEqual([null, null, null, null]);
  expect(agent.search.retriever).toBe('hybrid');
  applySearch(agent, d, opts(true));
  expect(agent.embedder.kind).toBe('embedder');
  expect(agent.ranker).toBe(agent.embedder);
  expect(agent.memory.embedder).toBe(agent.embedder);
  // the reranker: not on this Mac → it stays off and says how to get it
  expect(applySearch(agent, { ...d, reranker: 'qwen3-reranker-0.6b' }, opts(false))).toContain('coding setup');
  expect(agent.reranker).toBe(null);
  expect(applySearch(agent, { ...d, reranker: 'qwen3-reranker-0.6b' }, opts(true))).toBe(null);
  expect(agent.reranker.kind).toBe('reranker');
  const rr = agent.reranker;
  applySearch(agent, { ...d, reranker: 'qwen3-reranker-0.6b' }, opts(true));
  expect(agent.reranker).toBe(rr); // the same one, not a second
  applySearch(agent, d, opts(true));
  expect(agent.reranker).toBe(null);
  expect(stopped).toEqual([['reranker', { keep: false }]]); // turned off: its memory is handed back
  // with the memory and the code search both off none is made, as at start: the focused paths keep choosing by words
  const bare = { embedder: null, ranker: null, memory: null, helpers: new Set(['named']), codeIndex: null, search: {}, reranker: null };
  applySearch(bare, d, opts(true));
  expect([bare.embedder, bare.ranker]).toEqual([null, null]);
  applySearch({ ...bare, helpers: new Set(['rag']) }, d, opts(true));
  const withRag = { ...bare, helpers: new Set(['rag']) };
  applySearch(withRag, d, opts(true));
  expect(withRag.embedder?.kind).toBe('embedder');
});

test('the Context row on a remote: no memory sum of this Mac (it said NaN GB); on an Ollama service 8k up to the model’s longest, auto the service’s own', () => {
  const plain = { thinkingLevels: [], maxCtx: 131072 }; // a remote model's settings, as remoteModel gives them
  const ollama = { ...plain, maxCtx: 262144, remote: { kind: 'openai', label: 'gpu-box:11434', model: 'coder:30b', ollama: '0.32.12' } };
  const ctx = LIMITS.find((l) => l.id === 'context');
  expect(ctx.steps(ollama)).toEqual([0, 8192, 16384, 32768, 65536, 131072, 262144]);
  expect(ctx.steps({ ...ollama, maxCtx: 10485760 }).at(-1)).toBe(1048576);
  const note = (m, v, o = {}) => limitNote('context', { model: m, values: { context: v }, freeBytes: 3.2e9, ...o });
  expect(note(ollama, 65536)).toBe('64k on the service · coder:30b loads again at this size; the chat stays');
  expect(note(ollama, 0, { ctxNow: 262144 })).toBe('the service\'s own · 256k now');
  const other = { ...plain, remote: { kind: 'openai', label: 'api.example.com', model: 'x' } };
  expect(note(other, 32768)).toBe('set where it runs: /remote’s Context row, or coding serve --ctx there');
  for (const v of ctx.steps(ollama)) expect(note(ollama, v)).not.toContain('NaN');
});
