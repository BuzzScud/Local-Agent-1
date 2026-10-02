// /model on an Ollama service (remote-models.mjs) and the footer's label for a
// remote (screen.jsx modelLabels, footerParts): the groups and their order, the
// folds, the filter, the cursor, the line about the highlighted model, the
// effort levels, and the label as the remote connects, loads, answers or stops.
// The app driving them: app-remote.test.mjs.
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-remote-models-home-'));
const { groupsOf, openService, serviceRows, atRow, moveService, filterService, toggleFold, rowDetail, ctxWord, gbWord, sizeWord, canWord, isBig } = await import('../src/app/remote-models.mjs');
const { suggestedFor } = await import('../src/app/remote-suggested.mjs');
const { modelLabels, footerParts } = await import('../src/app/screen.jsx');
const { HOME, thinkingLevel, remoteModel } = await import('../../models/index.mjs');
test('the tests run in a throwaway home', () => { expect(HOME).not.toBe(join(homedir(), '.agentic-coder')); });

// As ollama.mjs gives them (the real service's models, cut down).
const M = (id, o = {}) => ({ id, family: 'llama', params: '8.0B', quant: 'Q4_K_M', bytes: 4.9e9, modified: '2025-12-21', ctx: 131072, known: true, chat: true, tools: true, thinking: false, vision: false, embedding: false, loaded: false, loadedCtx: null, sameAs: [], ...o });
const MODELS = [
  M('Qwen3.6:35B-A3B', { family: 'qwen35moe', params: '36.0B', bytes: 23.9e9, modified: '2026-06-15', ctx: 262144, thinking: true, vision: true, loaded: true, loadedCtx: 262144 }),
  M('functiongemma:latest', { family: 'gemma3', params: '268.10M', quant: 'Q8_0', bytes: 0.3e9, modified: '2025-12-20', ctx: 32768, loaded: true, loadedCtx: 32768 }),
  M('llama3.2:3b', { params: '3.2B', bytes: 2.0e9, loaded: true, loadedCtx: 131072 }),
  M('gpt-oss:120b', { family: 'gptoss', params: '116.8B', quant: 'MXFP4', bytes: 65.4e9, modified: '2025-12-20', thinking: true }),
  M('laguna-s-2.1:latest', { family: 'laguna', params: '117.6B', bytes: 75.2e9, modified: '2026-07-23', ctx: 262144, thinking: true }),
  M('qwen2.5-coder:14b', { family: 'qwen2', params: '14.8B', bytes: 9.0e9, modified: '2025-12-24', ctx: 32768 }),
  M('qwen3-coder:30b', { family: 'qwen3moe', params: '30.5B', bytes: 18.6e9, modified: '2025-12-20', ctx: 262144 }),
  M('phi4:latest', { family: 'phi3', params: '14.7B', bytes: 9.1e9, ctx: 16384, tools: false }),
  M('deepseek-coder-v2:16b', { family: 'deepseek2', params: '15.7B', quant: 'Q4_0', bytes: 8.9e9, ctx: 163840, tools: false }),
  M('embeddinggemma:latest', { family: 'gemma3', chat: false, tools: false, embedding: true }),
];
const SV = { catalog: { version: '0.32.12', models: MODELS }, inUse: 'Qwen3.6:35B-A3B', title: 'Another service', where: '203.0.113.7:60009', mac: [{ id: 'gemma', name: 'Gemma 4 12B QAT', bytes: 6.7e9 }, { id: 'qwen', name: 'Qwen3.5 9B', bytes: 6.9e9 }], services: [{ source: 'claude', name: 'Claude API · Opus 5.5', kind: 'claude' }], lastLocal: 'Qwen3.5 9B', used: 0 };
const ids = (rows) => rows.filter((r) => r.id).map((r) => r.id);
const text = (rows) => rows.map((r) => (r.kind === 'blank' ? '' : r.kind === 'head' || r.kind === 'note' || r.kind === 'fold' ? r.text : r.id));

test('the groups: loaded ones first (the one in use at the top), then those that can run the agent (a coder first, then the newest), then chat only; the helpers (embeddings, under 1B) apart', () => {
  const g = groupsOf(MODELS, 'Qwen3.6:35B-A3B');
  expect(g.loaded.map((m) => m.id)).toEqual(['Qwen3.6:35B-A3B', 'llama3.2:3b']);
  expect(g.helpers.map((m) => m.id)).toEqual(['functiongemma:latest', 'embeddinggemma:latest']);
  expect(g.agent.map((m) => m.id)).toEqual(['qwen2.5-coder:14b', 'qwen3-coder:30b', 'laguna-s-2.1:latest', 'gpt-oss:120b']);
  expect(g.chatOnly.map((m) => m.id)).toEqual(['deepseek-coder-v2:16b', 'phi4:latest']);
});

test('the rows: two sections, then a fold for the chat-only models, one for the helpers, a fold for this Mac, the other services; the folds open with enter', () => {
  const pk = openService({ inUse: 'Qwen3.6:35B-A3B', levelId: 'high', on: true });
  const rows = serviceRows(pk, SV);
  expect(text(rows)).toEqual([
    'Loaded on the service', 'm:Qwen3.6:35B-A3B', 'm:llama3.2:3b', '',
    'Can run the agent', 'm:qwen2.5-coder:14b', 'm:qwen3-coder:30b', 'm:laguna-s-2.1:latest', 'm:gpt-oss:120b', '',
    'Chat only', 'Helpers', 'This Mac', 'svc:claude',
  ]);
  expect(rows.find((r) => r.id === 'fold:helpers').note).toBe('2 on the service · pictures, search, small jobs · /subagents gives them a job');
  expect(rows.find((r) => r.id === 'fold:chat').note).toBe('2 on the service · no tools, so no file reads, edits or commands');
  expect(rows.find((r) => r.id === 'fold:mac').note).toBe('2 models · Qwen3.5 9B was in use last');
  expect(atRow(pk, rows).id).toBe('m:Qwen3.6:35B-A3B'); // it opens on the model in use
  const open = toggleFold(toggleFold(pk, 'fold:chat'), 'fold:mac');
  expect(ids(serviceRows(open, SV)).slice(-8)).toEqual(['fold:chat', 'm:deepseek-coder-v2:16b', 'm:phi4:latest', 'fold:helpers', 'fold:mac', 'local:gemma', 'local:qwen', 'svc:claude']);
  expect(ids(serviceRows(toggleFold(pk, 'fold:helpers'), SV))).toEqual(expect.arrayContaining(['m:functiongemma:latest', 'm:embeddinggemma:latest']));
  expect(serviceRows(toggleFold(open, 'fold:chat'), SV).some((r) => r.id === 'm:phi4:latest')).toBe(false);
});

test('↑↓ skip the headings and stop at the ends; typing filters by name (chat-only matches shown at once), the cursor kept on its model or moved to the first match', () => {
  let pk = openService({ inUse: 'Qwen3.6:35B-A3B', levelId: 'high', on: true });
  const rows = serviceRows(pk, SV);
  expect(moveService(pk, rows, -1).at).toBe('m:Qwen3.6:35B-A3B');
  pk = moveService(moveService(pk, rows, 1), rows, 1);
  expect(pk.at).toBe('m:qwen2.5-coder:14b'); // over the blank row and the heading
  pk = filterService(pk, SV, 'coder');
  expect(text(serviceRows(pk, SV))).toEqual(['Can run the agent', 'm:qwen2.5-coder:14b', 'm:qwen3-coder:30b', '', 'Chat only', 'm:deepseek-coder-v2:16b']);
  expect(pk.at).toBe('m:qwen2.5-coder:14b');
  pk = filterService(pk, SV, 'gpt');
  expect(pk.at).toBe('m:gpt-oss:120b');
  const none = filterService(pk, SV, 'zzz');
  expect(serviceRows(none, SV).map((r) => r.text)).toEqual(['Nothing on the service has “zzz” in its name.']);
  expect(none.at).toBe(null);
  expect(filterService(none, SV, '').filter).toBe('');
});

// The model /model's menu is for, as App.jsx makes it from the service's entry (openOwnSettings).
const asModel = (id) => { const m = MODELS.find((x) => x.id === id); return remoteModel({ kind: 'openai', source: 'openai', address: 'http://203.0.113.7:60009' }, { model: id, ollama: { version: '0.32.12', ...m }, ctx: m.loadedCtx || m.ctx }); };

test('the menu’s Thinking row is the model’s own choices: None when it cannot think, Off · On, Off · Max on Laguna, Low · Medium · High on gpt-oss; the one you chose is kept by name', () => {
  const labels = (id) => asModel(id).thinkingLevels.map((l) => l.label);
  expect(labels('llama3.2:3b')).toEqual(['None']);
  expect(labels('Qwen3.6:35B-A3B')).toEqual(['Off', 'On']);
  expect(labels('laguna-s-2.1:latest')).toEqual(['Off', 'Max']);
  expect(labels('gpt-oss:120b')).toEqual(['Low', 'Medium', 'High']);
  const lv = (id, on, levelId) => thinkingLevel(asModel(id), on, levelId);
  expect(lv('llama3.2:3b', true, 'high').label).toBe('None');
  expect(lv('Qwen3.6:35B-A3B', true, 'medium').label).toBe('On'); // its nearest
  expect(lv('laguna-s-2.1:latest', true, 'high').label).toBe('Max');
  expect(lv('gpt-oss:120b', true, 'medium').label).toBe('Medium');
  expect(lv('gpt-oss:120b', false).note).toMatch(/always thinks/); // its Low still thinks
});

test('the suggested values come from the ranks page by name, only ones the model’s rows can take; a model not on it has none', () => {
  expect(suggestedFor('laguna-s-2.1:latest', asModel('laguna-s-2.1:latest'))).toMatchObject({ level: 'high', limits: { context: 131072, steps: 80, outputLines: 160, timeoutSecs: 600 } });
  expect(suggestedFor('Qwen3.6:35B-A3B', asModel('Qwen3.6:35B-A3B'))).toMatchObject({ level: 'high', limits: { context: 131072, steps: 80 } });
  expect(suggestedFor('qwen3-coder:30b', asModel('qwen3-coder:30b'))).toMatchObject({ level: null, limits: { context: 65536, steps: 80, tries: 12, outputLines: 160 } });
  expect(suggestedFor('gpt-oss:120b', asModel('gpt-oss:120b'))).toMatchObject({ level: 'medium', limits: {} });
  // its window is 32k: nothing to raise, and the line says why
  expect(suggestedFor('qwen2.5-coder:14b', asModel('qwen2.5-coder:14b'))).toMatchObject({ level: null, limits: {}, why: 'its window is 32k: the shared settings fit it' });
  // a context longer than the model's own is left out (deepseek-coder-v2 here at 16k)
  const small = { ...asModel('qwen2.5-coder:14b'), maxCtx: 16384 };
  expect(suggestedFor('deepseek-coder-v2:16b', small).limits).toEqual({});
  // a level the model does not have (it cannot think) is left out
  expect(suggestedFor('laguna-s-2.1:latest', asModel('llama3.2:3b')).level).toBe(null);
  expect(suggestedFor('mystery:7b', asModel('llama3.2:3b'))).toBe(null);
  expect(suggestedFor('laguna-s-2.1:latest', asModel('laguna-s-2.1:latest')).source).toMatch(/not measured here/);
});

test('the line about the highlighted model: none for one loaded or in use; one that loads first; a chat-only one asks; a chat too long for it is summed up', () => {
  const row = (id) => ({ kind: 'model', m: MODELS.find((m) => m.id === id) });
  expect(rowDetail(row('Qwen3.6:35B-A3B'), { inUse: 'Qwen3.6:35B-A3B' })).toBe(null);
  expect(rowDetail(row('llama3.2:3b'), { inUse: 'Qwen3.6:35B-A3B' })).toBe(null);
  expect(rowDetail(row('gpt-oss:120b'), { inUse: 'x' })).toEqual({ tone: 'dim', text: 'Not loaded yet: it loads as you switch (65.4 GB), so the first reply may wait.' });
  expect(rowDetail(row('phi4:latest'), { inUse: 'x' }).text).toBe('No tools: it can only answer in words (no file reads, edits or commands). Enter asks first.');
  expect(rowDetail(row('qwen2.5-coder:14b'), { inUse: 'x', used: 41_000 })).toEqual({ tone: 'warn', text: 'Its context is 32k and the chat is about 40k: the oldest part is summed up before the next reply.' });
  expect(rowDetail({ kind: 'fold' }, {})).toBe(null);
});

test('big-model mode in the list: the 30B+ models that call tools are marked big; a loaded one not in use says what that means', () => {
  expect(MODELS.filter(isBig).map((m) => m.id)).toEqual(['Qwen3.6:35B-A3B', 'gpt-oss:120b', 'laguna-s-2.1:latest', 'qwen3-coder:30b']);
  const row = (id) => ({ kind: 'model', m: MODELS.find((m) => m.id === id) });
  expect(rowDetail(row('Qwen3.6:35B-A3B'), { inUse: 'x' })).toEqual({ tone: 'dim', text: 'Big model: it reads 400 lines at a time, up to 80 steps and 12 tries a fix.' });
  // not loaded: the wait is the line (the mark beside its name says big)
  expect(rowDetail(row('qwen3-coder:30b'), { inUse: 'x' }).text).toMatch(/^Not loaded yet/);
});

test('the columns’ words: context in k (or M), size with MoE, what it can do', () => {
  expect([ctxWord(262144), ctxWord(131072), ctxWord(10485760), ctxWord(null)]).toEqual(['256k', '128k', '10M', '']);
  expect([gbWord(23.9e9), gbWord(0)]).toEqual(['23.9 GB', '']);
  expect(sizeWord(MODELS[0])).toBe('36.0B MoE');
  expect(sizeWord(MODELS[1])).toBe('268M');
  expect([canWord(MODELS[0]), canWord(MODELS[2]), canWord(MODELS[7]), canWord({ known: false })]).toEqual(['tools · thinks · images', 'tools', '—', '']);
});

test('the footer on a remote: the model and where it runs, then shorter in a narrow window; connecting, loading, reconnecting and not answering say so; this Mac\'s memory is not shown (it holds no model then)', () => {
  const ms = (state, o = {}) => ({ remote: true, state, name: 'Qwen3.6:35B-A3B', where: '203.0.113.7:60009', gb: null, ...o });
  expect(modelLabels(ms('on'))).toEqual(['● Qwen3.6:35B-A3B on 203.0.113.7:60009', '● Qwen3.6:35B-A3B', '● remote']);
  expect(modelLabels(ms('loading', { name: 'gpt-oss:120b', gb: 65.4 }))[0]).toBe('◐ gpt-oss:120b loading on the service · 65.4 GB');
  expect(modelLabels(ms('connecting'))[0]).toBe('◐ connecting to 203.0.113.7:60009…');
  expect(modelLabels(ms('reconnecting'))[0]).toBe('◐ reconnecting to 203.0.113.7:60009…');
  expect(modelLabels(ms('down'))[0]).toBe('✗ 203.0.113.7:60009 is not answering');
  const mac = { total: 8 * 2 ** 30, avail: 2.7 * 2 ** 30, level: 1 };
  const wide = footerParts({ mode: 'ask', notice: null, width: 108, modelState: ms('on'), mac });
  expect([wide.label, wide.mac]).toEqual(['● Qwen3.6:35B-A3B on 203.0.113.7:60009', '']);
  expect(wide.labelAt.to - wide.labelAt.from + 1).toBe(wide.label.length); // where a click lands (/mouse on)
  // 56 columns: the whole label does not fit, the address goes and the model's name stays
  const narrow = footerParts({ mode: 'ask', notice: null, width: 56, modelState: ms('on'), mac });
  expect([narrow.label, narrow.mac]).toEqual(['● Qwen3.6:35B-A3B', '']);
  // a server given with --url still has no label
  expect(modelLabels(null)).toEqual([]);
});
