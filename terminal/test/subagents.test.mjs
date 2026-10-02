// /subagents and the /remote list on an Ollama service (2 Oct 2026): the suggestion, the
// copies on one row, the helpers' group, each job's default model (subagents.mjs), the
// panel's moves, the try-out (agent/tryout.mjs), the helper jobs (agent/helper-models.mjs)
// and a call written as bare JSON (bareCallInText). The app driving them: app-subagents.test.mjs.
import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-subagents-home-'));
const { HOME, pickRemoteModel, setEndpoint, dropEndpoint, ollamaCatalog } = await import('../../models/index.mjs');
const { groupsOf, copiesOf, suggestModel, isHelper } = await import('../src/app/remote-models.mjs');
const { JOBS, MAIN, choicesFor, jobsOf, statusOf, openSubagents, moveJob, stepModel, toggleJob, savedOf } = await import('../src/app/subagents.mjs');
const { openForm, openModelPick, moveCopy, commitPick, movePick } = await import('../src/app/remote-form.mjs');
const { readTryouts, saveTryout, triedWord, serviceKey } = await import('../src/app/tryouts.mjs');
const { tryOut } = await import('../src/agent/tryout.mjs');
const { useOf, reviewChange, describePictures, findingsOf, RemoteEmbedder, checkPagePicture, screenshotPage } = await import('../src/agent/helper-models.mjs');
const { findChrome } = await import('../src/flows/layoutcheck.mjs');
const { bareCallInText } = await import('../src/agent/agent.mjs');
const { fakeOllama } = await import('./fake-ollama.mjs');
test('the tests run in a throwaway home', () => { expect(HOME).not.toBe(join(homedir(), '.agentic-coder')); });

// Their service's 26 names (2 Oct 2026), with what ollama.mjs would say of each.
const M = (id, o = {}) => ({ id, family: 'llama', params: '8.0B', quant: 'Q4_K_M', bytes: 4.9e9, modified: '2025-12-01', ctx: 131072, known: true, chat: true, tools: true, thinking: false, vision: false, embedding: false, loaded: false, loadedCtx: null, sameAs: [], ...o });
const U = (id) => M(id, { family: '', params: '', bytes: 0, known: false, ctx: null });
const SERVICE = [
  M('llava:latest', { params: '7B', tools: false, vision: true, bytes: 4.7e9 }),
  U('laguna-xs-2.1:bf16'), U('laguna-xs-2.1:latest'),
  M('llama4:latest', { family: 'llama4', params: '108.6B', vision: true, bytes: 67.4e9 }),
  U('ornith:35b'),
  M('qwen3-coder-next:latest', { family: 'qwen3next', params: '79.7B', bytes: 51.7e9, loaded: true, loadedCtx: 131072, modified: '2026-03-01' }),
  U('laguna-xs-2.1:q8_0'),
  M('laguna-s-2.1:latest', { family: 'laguna', params: '117.6B', thinking: true, bytes: 75.2e9 }),
  M('embeddinggemma:latest', { family: 'gemma3', params: '307.58M', chat: false, tools: false, embedding: true, bytes: 0.6e9 }),
  M('Qwen3.6:35B-A3B', { family: 'qwen35moe', params: '36.0B', thinking: true, vision: true, bytes: 23.9e9 }),
  M('qwen2.5:32b', { family: 'qwen2', params: '32.8B' }), M('llama3.1:70b', { params: '70.6B' }),
  M('qwen2.5-coder:32b', { family: 'qwen2', params: '32.8B' }), M('qwen2.5-coder:14b', { family: 'qwen2', params: '14.8B' }),
  M('codellama:13b', { params: '13B', tools: false }),
  M('deepseek-coder-v2:latest', { family: 'deepseek2', params: '15.7B', tools: false, sameAs: ['deepseek-coder-v2:16b'] }),
  M('deepseek-coder-v2:16b', { family: 'deepseek2', params: '15.7B', tools: false, sameAs: ['deepseek-coder-v2:latest'] }),
  M('phi4:latest', { family: 'phi3', params: '14.7B', tools: false }), M('qwen2.5:14b', { family: 'qwen2', params: '14.8B' }),
  M('llama3.2:3b', { params: '3.2B', bytes: 2.0e9 }), M('llama3.1:latest', { params: '8.0B' }),
  M('deepseek-v2:latest', { family: 'deepseek2', params: '15.7B', tools: false }),
  M('deepseek-ocr:latest', { family: 'deepseekocr', params: '3.3B', tools: false, vision: true, bytes: 6.7e9 }),
  M('qwen3-coder:30b', { family: 'qwen3moe', params: '30.5B' }),
  M('gpt-oss:120b', { family: 'gptoss', params: '116.8B', thinking: true, bytes: 65.4e9 }),
  M('functiongemma:latest', { family: 'gemma3', params: '268.10M', bytes: 0.3e9 }),
];
const NAMES = SERVICE.map((m) => m.id);

test('the suggestion: a coder, not the first name that sounds like a model (llama4 won a tie before); with the list, the loaded coder, and one that failed its try-out is passed over', () => {
  expect(pickRemoteModel(NAMES)).toBe('qwen3-coder-next:latest');
  expect(pickRemoteModel(['llama4:latest', 'llava:latest'])).toBe('llama4:latest'); // no coder: as before
  expect(suggestModel(SERVICE)).toBe('qwen3-coder-next:latest');
  expect(suggestModel(SERVICE, { 'qwen3-coder-next:latest': { ok: false } })).toBe('qwen2.5-coder:32b'); // a coder again, the bigger one
  expect(suggestModel(SERVICE, { 'gpt-oss:120b': { ok: true } })).toBe('gpt-oss:120b'); // one that passed comes first
});

test('copies are one entry: three precisions of laguna-xs-2.1, the same weights under two names; two sizes of one name stay apart', () => {
  const c = copiesOf(SERVICE);
  const lx = c.filter((m) => m.id.startsWith('laguna-xs'));
  expect(lx.map((m) => m.id)).toEqual(['laguna-xs-2.1:latest']);
  expect(lx[0].copies).toEqual(['laguna-xs-2.1:bf16', 'laguna-xs-2.1:q8_0']);
  expect(c.filter((m) => m.id.startsWith('deepseek-coder-v2')).map((m) => [m.id, m.copies])).toEqual([['deepseek-coder-v2:latest', ['deepseek-coder-v2:16b']]]);
  expect(c.filter((m) => m.id.startsWith('qwen2.5-coder')).length).toBe(2);
  expect(copiesOf(SERVICE, 'laguna-xs-2.1:q8_0').find((m) => m.id.startsWith('laguna-xs')).id).toBe('laguna-xs-2.1:q8_0'); // the one in use heads it
});

test('the groups: 15 can run the agent, 4 chat only, 4 helpers (pictures, embeddings, under 1B)', () => {
  const g = groupsOf(SERVICE);
  expect(g.loaded.map((m) => m.id)).toEqual(['qwen3-coder-next:latest']);
  expect(g.loaded.length + g.agent.length).toBe(15);
  expect(g.chatOnly.map((m) => m.id).sort()).toEqual(['codellama:13b', 'deepseek-coder-v2:latest', 'deepseek-v2:latest', 'phi4:latest']);
  expect(g.helpers.map((m) => m.id)).toEqual(['functiongemma:latest', 'embeddinggemma:latest', 'deepseek-ocr:latest', 'llava:latest']);
  expect(isHelper(SERVICE.find((m) => m.id === 'llama4:latest'))).toBe(false); // it sees, but it calls tools
});

test('/remote Connect on an Ollama service: the groups, the suggestion highlighted, ←→ picks a copy and enter takes it', () => {
  let form = openForm({ remotes: { openai: { source: 'openai', address: 'http://203.0.113.7:60009', kind: 'openai', model: '' } } }, { source: 'openai' });
  form = { ...form, test: { ok: false, needModel: true, models: NAMES, catalog: { version: '0.32.12', models: SERVICE } } };
  const p = openModelPick(form, NAMES, { tried: {} });
  expect(p.pick.groups.map((g) => g.text)).toEqual(['Loaded on the service', 'Can run the agent', 'Chat only', 'Helpers']);
  expect(p.pick.suggested).toBe('qwen3-coder-next:latest');
  expect(p.pick.models[p.pick.index]).toBe('qwen3-coder-next:latest');
  expect(p.pick.models).not.toContain('laguna-xs-2.1:bf16');
  let q = { ...p, pick: { ...p.pick, index: p.pick.models.indexOf('laguna-xs-2.1:latest') } };
  q = moveCopy(q, 1);
  expect(commitPick(q).profiles.openai.model).toBe('laguna-xs-2.1:bf16');
  expect(commitPick(p).profiles.openai.model).toBe('qwen3-coder-next:latest');
  expect(movePick(p, 1).pick.index).toBe(1);
});

test('each job\'s model at first: llava looks, llama3.2 3b does the side jobs, embeddinggemma searches, Qwen3.6 gives the second opinion (it fits beside the main model), the main model writes pages and Qwen3.6 checks them', () => {
  const jobs = jobsOf({}, SERVICE, 'qwen3-coder-next:latest');
  expect(Object.fromEntries(jobs.map((j) => [j.id, j.model]))).toEqual({ pictures: 'llava:latest', side: 'llama3.2:3b', search: 'embeddinggemma:latest', review: 'Qwen3.6:35B-A3B', designWrite: MAIN, designCheck: 'Qwen3.6:35B-A3B' });
  expect(jobs.every((j) => j.on)).toBe(true);
  expect(choicesFor('review', SERVICE, 'qwen3-coder-next:latest').slice(0, 3)).toEqual(['Qwen3.6:35B-A3B', 'gpt-oss:120b', 'laguna-s-2.1:latest']);
  expect(choicesFor('pictures', SERVICE).at(-1)).toBe('deepseek-ocr:latest'); // made for reading text: after the others
  expect(choicesFor('side', SERVICE)[0]).toBe(MAIN);
  expect(choicesFor('review', SERVICE, 'qwen3-coder-next:latest')).not.toContain('qwen3-coder-next:latest');
  // saved picks win; one no longer on the service falls back and says so
  const saved = jobsOf({ review: { on: true, model: 'gpt-oss:120b' }, pictures: { on: false, model: 'llava:latest' }, side: { on: true, model: 'gone:1b' } }, SERVICE, 'qwen3-coder-next:latest');
  expect(saved.find((j) => j.id === 'review').model).toBe('gpt-oss:120b');
  expect(saved.find((j) => j.id === 'pictures').on).toBe(false);
  expect(saved.find((j) => j.id === 'side')).toMatchObject({ model: 'llama3.2:3b', missing: true });
});

test('the panel: ↑↓ the job, ←→ its model (and on), space on or off, the status words, what is saved', () => {
  let pk = openSubagents(jobsOf({}, SERVICE, 'qwen3-coder-next:latest'));
  pk = moveJob(moveJob(moveJob(pk, 1), 1), 1);
  expect(pk.jobs[pk.at].id).toBe('review');
  pk = stepModel(pk, 1);
  expect(pk.jobs[pk.at].model).toBe('gpt-oss:120b');
  pk = toggleJob(pk);
  expect(pk.jobs[pk.at].on).toBe(false);
  expect(statusOf(pk.jobs[pk.at], SERVICE).text).toBe('off');
  expect(statusOf(pk.jobs[0], SERVICE).text).toBe('loads when needed · 4.7 GB');
  expect(statusOf(pk.jobs.find((j) => j.id === 'designWrite'), SERVICE, 'qwen3-coder-next:latest').text).toBe('your model (qwen3-coder-next:latest)');
  expect(moveJob(pk, 99).at).toBe(JOBS.length - 1);
  expect(savedOf(pk.jobs).review).toEqual({ on: false, model: 'gpt-oss:120b' });
  expect(useOf({ on: true, model: 'llama3.2:3b', entry: { family: 'llama', tools: true } }, 'side')).toMatchObject({ model: 'llama3.2:3b', numCtx: 32768, keepAlive: '30m' });
  expect(useOf({ on: true, model: MAIN }, 'designWrite')).toBe(undefined);
  expect(useOf({ on: false, model: 'llava:latest' }, 'pictures')).toBe(undefined);
});

test('a call written as bare JSON runs when it names one of the tools; a JSON answer does not', () => {
  const N = ['Read', 'Edit', 'Bash'];
  expect(bareCallInText('{"name": "Read", "arguments": {"path": "src/a.js"}}', N)).toMatchObject({ name: 'Read', args: '{"path":"src/a.js"}', before: '' });
  expect(bareCallInText('I will read it.\n```json\n{"name": "Edit", "parameters": {"path": "x", "old_text": "a", "new_text": "b"}}\n```', N)).toMatchObject({ name: 'Edit', before: 'I will read it.' });
  expect(bareCallInText('{"function": {"name": "Bash", "arguments": "{\\"command\\": \\"ls\\"}"}}', N)).toMatchObject({ name: 'Bash', args: '{"command": "ls"}' });
  expect(bareCallInText('The config is {"name": "app", "version": 1}', N)).toBe(null);
  expect(bareCallInText('Done: {"ok": true}', N)).toBe(null);
  expect(bareCallInText('{"name": "Read", "arguments": {"path": "a"}} and then more words', N)).toBe(null);
});

test('findings: LGTM is none; "- " lines are the findings, at most three', () => {
  expect(findingsOf('LGTM')).toEqual({ ok: true, findings: [] });
  expect(findingsOf('- a.js: x is never closed\n- b.js: the test was removed\n- c\n- d')).toEqual({ ok: false, findings: ['a.js: x is never closed', 'b.js: the test was removed', 'c'] });
  expect(findingsOf('1. one thing').findings).toEqual(['one thing']);
});

test('try-outs are kept by service and model; the list words', () => {
  saveTryout('http://203.0.113.7:60009/', 'coder:30b', { ok: true, tokS: 38.4 });
  expect(readTryouts('203.0.113.7:60009')['coder:30b']).toMatchObject({ ok: true, tokS: 38.4 });
  expect(serviceKey('HTTPS://Box:1/')).toBe('box:1');
  expect(triedWord(null)).toBe('not tried');
  expect(triedWord({ ok: true, tokS: 38.4 })).toBe('✔ 38 tok/s');
  expect(triedWord({ ok: false, why: 'answered in words, no call' })).toBe('✗ answered in words, no call');
  expect(existsSync(join(HOME, 'tryouts.json'))).toBe(true);
});

// ---- against a pretend Ollama service -------------------------------------------------------------
const svc = await fakeOllama({ review: '- notes.txt: the second line still says wrold', look: 'LGTM' });
setEndpoint(svc.url, { remote: true, kind: 'openai', ollama: true, model: 'coder:30b', numCtx: 131072, keepAlive: -1, free: true });
afterAll(async () => { dropEndpoint(svc.url); await svc.close(); });

test('the try-out: real calls pass, a call written as bare JSON passes (rescued), words fail; the main model is asked at its own size', async () => {
  const good = await tryOut({ url: svc.url, model: 'coder:30b', entry: { family: 'qwen3moe' }, numCtx: 131072, keepAlive: -1 });
  expect(good.ok).toBe(true);
  expect(good.steps.map((s) => s.text)).toEqual(['read a file', 'fixed one line', 'ran a command']);
  expect(good.tokS).toBeCloseTo(40, 0);
  const asked = svc.chats().filter((b) => b.model === 'coder:30b');
  expect(asked.every((b) => b.options.num_ctx === 131072 && b.keep_alive === -1 && b.tools.map((t) => t.function.name).join() === 'Read,Edit,Bash')).toBe(true);
  const json = await tryOut({ url: svc.url, model: 'jsontext:14b' });
  expect(json.ok).toBe(true);
  expect(json.steps[0].text).toBe('read a file (written as text, rescued)');
  const words = await tryOut({ url: svc.url, model: 'words:7b' });
  expect(words).toMatchObject({ ok: false, why: 'answered in words, no call' });
  expect(words.steps).toHaveLength(1);
  // One the service says cannot take tools: the client drops them and asks again (as the agent would), so it answers in words.
  const none = await tryOut({ url: svc.url, model: 'llava:latest' });
  expect(none).toMatchObject({ ok: false, why: 'answered in words, no call' });
});

test('the helpers ask their own model on the same service: the second opinion, the pictures, the code search\'s numbers', async () => {
  const n = svc.chats().length;
  const r = await reviewChange({ url: svc.url, use: { model: 'thinker:35b', numCtx: 32768, thinks: true, keepAlive: '30m' }, request: 'fix the typo', diff: 'notes.txt:\n-Hello wrold\n+Hello world' });
  expect(r).toMatchObject({ ok: false, findings: ['notes.txt: the second line still says wrold'] });
  const sent = svc.chats().slice(n)[0];
  expect(sent).toMatchObject({ model: 'thinker:35b', keep_alive: '30m', think: true });
  expect(sent.options.num_ctx).toBe(32768);
  const d = await describePictures({ url: svc.url, use: { model: 'llava:latest', numCtx: 8192, keepAlive: '30m' }, images: [{ path: '/tmp/s.png', mime: 'image/png', data: 'iVBORw0KGgo=' }], question: 'why does it overlap?' });
  expect(d.text).toBe('A login form. The Save button is cut off on the right.');
  expect(svc.chats().at(-1).messages.at(-1).images).toEqual(['iVBORw0KGgo=']);
  const e = new RemoteEmbedder({ url: svc.url, model: 'embed:latest' });
  const [v] = await e.embed(['hello']);
  expect(Math.hypot(...v)).toBeCloseTo(1, 5);
  expect(e.model.file).toBe('remote:embed:latest');
  const cat = await ollamaCatalog({ url: svc.url });
  expect(groupsOf(cat.models).helpers.map((m) => m.id)).toEqual(['embed:latest', 'llava:latest']);
});

test('UI design · checks: a picture of the page (headless Chrome, when this Mac has it) goes to the model that sees, with the request; LGTM is nothing to fix', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-look-page-'));
  const page = join(dir, 'card.html');
  writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>Card</title><body style="font:20px sans-serif"><h1>Card</h1><button>Save</button>');
  const chrome = findChrome();
  const image = chrome ? screenshotPage(page, chrome) : { path: page, mime: 'image/png', data: 'iVBORw0KGgo=', w: 1440, h: 900 };
  if (chrome) { expect(image).toMatchObject({ mime: 'image/png', w: 1440, h: 900 }); expect(Buffer.from(image.data, 'base64').subarray(1, 4).toString()).toBe('PNG'); }
  const r = await checkPagePicture({ url: svc.url, use: { model: 'thinker:35b', numCtx: 16384, keepAlive: '30m' }, image, page: 'card.html', request: 'a card with a Save button' });
  expect(r.ok).toBe(true);
  const sent = svc.chats().at(-1);
  expect(sent.model).toBe('thinker:35b');
  expect(sent.messages.at(-1).images).toEqual([image.data]);
  expect(sent.messages.at(-1).content).toContain('a card with a Save button');
});
