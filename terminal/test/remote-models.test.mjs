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
const { groupsOf, openService, serviceRows, atRow, moveService, filterService, toggleFold, levelModelOf, rowDetail, ctxWord, gbWord, sizeWord, canWord } = await import('../src/app/remote-models.mjs');
const { modelLabels, footerParts } = await import('../src/app/screen.jsx');
const { HOME, thinkingLevel } = await import('../../models/index.mjs');
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

test('the groups: loaded ones first (the one in use at the top), then those that can run the agent (a coder first, then the newest), then chat only; embeddings left out', () => {
  const g = groupsOf(MODELS, 'Qwen3.6:35B-A3B');
  expect(g.loaded.map((m) => m.id)).toEqual(['Qwen3.6:35B-A3B', 'llama3.2:3b', 'functiongemma:latest']);
  expect(g.agent.map((m) => m.id)).toEqual(['qwen2.5-coder:14b', 'qwen3-coder:30b', 'laguna-s-2.1:latest', 'gpt-oss:120b']);
  expect(g.chatOnly.map((m) => m.id)).toEqual(['deepseek-coder-v2:16b', 'phi4:latest']);
});

test('the rows: two sections, then a fold for the chat-only models, a fold for this Mac, the other services; the folds open with enter', () => {
  const pk = openService({ inUse: 'Qwen3.6:35B-A3B', levelId: 'high', on: true });
  const rows = serviceRows(pk, SV);
  expect(text(rows)).toEqual([
    'Loaded on the service', 'm:Qwen3.6:35B-A3B', 'm:llama3.2:3b', 'm:functiongemma:latest', '',
    'Can run the agent', 'm:qwen2.5-coder:14b', 'm:qwen3-coder:30b', 'm:laguna-s-2.1:latest', 'm:gpt-oss:120b', '',
    'Chat only', 'This Mac', 'svc:claude',
  ]);
  expect(rows.find((r) => r.id === 'fold:chat').note).toBe('2 on the service · no tools, so no file reads, edits or commands');
  expect(rows.find((r) => r.id === 'fold:mac').note).toBe('2 models · Qwen3.5 9B was in use last');
  expect(atRow(pk, rows).id).toBe('m:Qwen3.6:35B-A3B'); // it opens on the model in use
  const open = toggleFold(toggleFold(pk, 'fold:chat'), 'fold:mac');
  expect(ids(serviceRows(open, SV)).slice(-7)).toEqual(['fold:chat', 'm:deepseek-coder-v2:16b', 'm:phi4:latest', 'fold:mac', 'local:gemma', 'local:qwen', 'svc:claude']);
  expect(serviceRows(toggleFold(open, 'fold:chat'), SV).some((r) => r.id === 'm:phi4:latest')).toBe(false);
});

test('↑↓ skip the headings and stop at the ends; typing filters by name (chat-only matches shown at once), the cursor kept on its model or moved to the first match', () => {
  let pk = openService({ inUse: 'Qwen3.6:35B-A3B', levelId: 'high', on: true });
  const rows = serviceRows(pk, SV);
  expect(moveService(pk, rows, -1).at).toBe('m:Qwen3.6:35B-A3B');
  pk = moveService(moveService(moveService(pk, rows, 1), rows, 1), rows, 1);
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

test('the Effort row follows the highlighted model: Low only when it cannot think, three levels for gpt-oss, the one you chose kept by name', () => {
  const row = (id) => ({ kind: 'model', m: MODELS.find((m) => m.id === id) });
  const lv = (id, on, levelId) => thinkingLevel(levelModelOf(row(id), null), on, levelId);
  expect(lv('llama3.2:3b', true, 'high').id).toBe('low');
  expect(lv('Qwen3.6:35B-A3B', true, 'high').id).toBe('high');
  expect(lv('Qwen3.6:35B-A3B', true, 'medium').id).toBe('high'); // its nearest
  expect(lv('gpt-oss:120b', true, 'medium').id).toBe('medium');
  expect(levelModelOf({ kind: 'local', m: SV.mac[0] }, null)).toBe(SV.mac[0]);
  expect(levelModelOf({ kind: 'fold' }, 'in use')).toBe('in use');
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

test('the columns’ words: context in k (or M), size with MoE, what it can do', () => {
  expect([ctxWord(262144), ctxWord(131072), ctxWord(10485760), ctxWord(null)]).toEqual(['256k', '128k', '10M', '']);
  expect([gbWord(23.9e9), gbWord(0)]).toEqual(['23.9 GB', '']);
  expect(sizeWord(MODELS[0])).toBe('36.0B MoE');
  expect(sizeWord(MODELS[1])).toBe('268M');
  expect([canWord(MODELS[0]), canWord(MODELS[2]), canWord(MODELS[7]), canWord({ known: false })]).toEqual(['tools · thinks · images', 'tools', '—', '']);
});

test('the footer on a remote: the model and where it runs, then shorter in a narrow window; connecting, loading, reconnecting and not answering say so', () => {
  const ms = (state, o = {}) => ({ remote: true, state, name: 'Qwen3.6:35B-A3B', where: '203.0.113.7:60009', gb: null, ...o });
  expect(modelLabels(ms('on'))).toEqual(['● Qwen3.6:35B-A3B on 203.0.113.7:60009', '● Qwen3.6:35B-A3B · remote', '● remote']);
  expect(modelLabels(ms('loading', { name: 'gpt-oss:120b', gb: 65.4 }))[0]).toBe('◐ gpt-oss:120b loading on the service · 65.4 GB');
  expect(modelLabels(ms('connecting'))[0]).toBe('◐ connecting to 203.0.113.7:60009…');
  expect(modelLabels(ms('reconnecting'))[0]).toBe('◐ reconnecting to 203.0.113.7:60009…');
  expect(modelLabels(ms('down'))[0]).toBe('✗ 203.0.113.7:60009 is not answering');
  const mac = { total: 8 * 2 ** 30, avail: 2.7 * 2 ** 30, level: 1 };
  const wide = footerParts({ mode: 'ask', notice: null, width: 108, modelState: ms('on'), mac });
  expect([wide.label, wide.mac]).toEqual(['● Qwen3.6:35B-A3B on 203.0.113.7:60009', 'Mac 5.3/8 GB']);
  expect(wide.labelAt.to - wide.labelAt.from + 1).toBe(wide.label.length); // where a click lands (/mouse on)
  // 56 columns: the whole label does not fit, the model's name keeps its place over the Mac's memory
  const narrow = footerParts({ mode: 'ask', notice: null, width: 56, modelState: ms('on'), mac });
  expect([narrow.label, narrow.mac]).toEqual(['● Qwen3.6:35B-A3B · remote', '']);
  // a server given with --url still has no label
  expect(modelLabels(null)).toEqual([]);
});
