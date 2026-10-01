// The models part on its own: the registry (Qwen3.5 9B the default, Gemma 4 12B
// QAT, K2 Horizon 7B and Bonsai 2 27B in /model), the thinking switch, the memory
// math and the server's flags. The 27B's own tests run against its model file.
import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { MODELS, DEFAULT_MODEL, EMBEDDERS, DEFAULT_EMBEDDER, modelPath, thinkingKwargs, thinkingLevel, kvBytesPerToken, needBytes, chooseContext, serverArgs, modelFolder } from '../index.mjs';
import bonsai27b from '../bonsai-2-27b/model.mjs';

const m = bonsai27b; // the 27B: its settings as tested on this Mac (25-28 Sep 2026)
const g = MODELS.gemma;

test('Qwen3.5 9B is the default (since 30 Sep 2026), Gemma 4 12B QAT the second model, K2 Horizon 7B the third, Bonsai 2 27B the fourth (back since 1 Oct 2026), Bonsai 2 27B ConstantKV the fifth (1 Oct 2026)', () => {
  expect(Object.keys(MODELS)).toEqual(['gemma', 'qwen', 'k2', 'bonsai', 'constantkv']);
  expect(DEFAULT_MODEL).toBe('qwen');
  expect(g.file).toBe('gemma-4-12B-it-qat-UD-Q4_K_XL.gguf');
  expect(g.bytes).toBe(6_716_356_800);
  expect(g.sha256).toBe('90fd44e29e0d7cffeb0fd00dc73cfdab9ed0b0e95306ecf7821ea634c940c370');
  expect(g.thinkingDefault).toBe(false);
  expect(g.draft.file).toBe('mtp-gemma-4-12b-it.gguf'); // Google's MTP helper (speed probe, 28 Sep)
  expect(modelFolder(g)).toMatch(/models\/gemma-4-12b\/$/);
  // the 27B: listed under the id its old runs carry, on Prism's engine only, able to see
  expect(MODELS.bonsai).toBe(m);
  expect([m.engine, m.engineOnly]).toEqual(['prism', true]);
  expect(m.vision.file).toBe('Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf');
  expect(m.file).toBe('Ternary-Bonsai-2-27B-PQ2_0.gguf');
  expect(m.bytes).toBe(7_206_168_928);
  expect(m.folder).toBe('bonsai-2-27b');
  expect(existsSync(new URL('../bonsai-2-27b/README.md', import.meta.url))).toBe(true);
});

test('Gemma: Low answers straight away, High turns its thinking on (no Medium: it has no effort dial)', () => {
  expect(g.thinkingLevels.map((l) => l.label)).toEqual(['Low', 'High']);
  expect(thinkingKwargs(g, false)).toEqual({ enable_thinking: false });
  expect(thinkingKwargs(g, true)).toEqual({ enable_thinking: true, reasoning_effort: 'high' });
  expect(thinkingLevel(g, true, 'medium').label).toBe('High'); // an old saved "medium" lands on High
  expect(thinkingLevel(g, false).label).toBe('Low');
  // 8 global layers, 1 kv head of 512: far less per token than the 27B
  expect(kvBytesPerToken(g)).toBeLessThan(kvBytesPerToken(m) / 3);
  expect(needBytes(g, 32_768)).toBeLessThan(10e9);
});

test('effort levels: low (no thinking, the default), medium or high', () => {
  expect(thinkingKwargs(m, false)).toEqual({ enable_thinking: false });
  expect(thinkingKwargs(m, true)).toEqual({ enable_thinking: true, reasoning_effort: 'medium' });
  expect(thinkingKwargs(m, true, 'medium')).toEqual({ enable_thinking: true, reasoning_effort: 'medium' });
  // "High" is the template's "xhigh" ("high" errors in this build)
  expect(thinkingKwargs(m, true, 'high')).toEqual({ enable_thinking: true, reasoning_effort: 'xhigh' });
  expect(thinkingKwargs(m, false, 'high')).toEqual({ enable_thinking: false });
  expect(m.thinkingLevels.map((l) => l.label)).toEqual(['Low', 'Medium', 'High']);
  // Low is thinking off: it sends no thinking at all, never the template's own "low"
  expect(thinkingLevel(m, false, 'high').id).toBe('low');
  expect(thinkingLevel(m, true, 'nonsense').id).toBe('medium');
});

test('memory: only 16 layers keep a per-token cache; the estimate covers what was measured', () => {
  expect(kvBytesPerToken(m)).toBe(34_816);
  // without the helper, measured 2026-09-25 with two slots at 32k: 7.21 file + 2.38 working memory;
  // the estimate is the worst case (both slots full of checkpoints), not far above it
  const plain32 = needBytes(m, 32_768, { draft: false }) / 1e9;
  expect(plain32).toBeGreaterThanOrEqual(7.21 + 2.38);
  expect(plain32).toBeLessThan(7.21 + 2.38 + 0.6);
  // with the helper, measured the same way: 7.21 + 1.14 files + 3.39 working memory
  const at32 = needBytes(m, 32_768) / 1e9;
  expect(at32).toBeGreaterThanOrEqual(7.21 + 1.14 + 3.39);
  expect(at32).toBeLessThan(7.21 + 1.14 + 3.39 + 0.6);
  expect(needBytes(m, 16_384)).toBeLessThan(needBytes(m, 32_768));
  expect(chooseContext(m, { available: 12e9 }).ctx).toBe(32_768);
  const short = chooseContext(m, { available: 11.5e9 });
  expect(short.ctx).toBe(16_384);
  expect(short.reason).toMatch(/^11\.5 GB free, so using 16k \(11\.4 GB\) instead of 32k \(11\.9 GB\)$/);
  const tight = chooseContext(m, { available: 8e9 });
  expect(tight.ctx).toBe(16_384);
  expect(tight.reason).toContain('close other apps');
});

test("the server uses the model's own chat template, an 8-bit cache, a thinking budget and capped saved states", () => {
  const a = serverArgs(m, { ctx: 32_768, port: 17_600 });
  expect(a).toContain('--jinja');
  expect(a).not.toContain('--chat-template-file');
  expect(a[a.indexOf('--reasoning-budget') + 1]).toBe('2048');
  expect(a[a.indexOf('-ctk') + 1]).toBe('q8_0');
  expect(a[a.indexOf('-c') + 1]).toBe('32768');
  // saved states capped: the defaults grew to 9 GB in 13 prompts
  expect(a[a.indexOf('--ctx-checkpoints') + 1]).toBe('3');
  expect(a[a.indexOf('--cache-ram') + 1]).toBe('0');
  expect(a).not.toContain('--cache-reuse');
  // two slots sharing one cache (conversation + side requests), and a folder for saved warm-ups
  expect(a[a.indexOf('-np') + 1]).toBe('2');
  expect(a).toContain('-kvu');
  expect(a[a.indexOf('--slot-save-path') + 1]).toMatch(/slots$/);
  // n-gram speculative decoding from the prompt (measured 25-35% faster on rewrites)
  expect(a[a.indexOf('--spec-type') + 1]).toBe('ngram-simple');
});

test('with its helper the server guesses one word ahead and checks it in the same pass; without it, n-grams', () => {
  expect(m.draft.file).toBe('Qwen3.8-27B-DFlash2-r3-Q4_K_M.gguf');
  expect(m.draft.sha256).toMatch(/^[0-9a-f]{64}$/);
  const a = serverArgs(m, { ctx: 32_768, port: 17_600, draft: true });
  expect(a[a.indexOf('--spec-type') + 1]).toBe('draft-dflash');
  expect(a[a.indexOf('-md') + 1]).toMatch(/models\/Qwen3\.8-27B-DFlash2-r3-Q4_K_M\.gguf$/);
  // 1 guess per check: 3 and 7 were slower on prose (measured 2026-09-25)
  expect(a[a.indexOf('--spec-draft-n-max') + 1]).toBe('1');
  // the helper's working space is sized by the micro-batch: 128 keeps it at ~0.4 GB
  expect(a[a.indexOf('-ub') + 1]).toBe('128');
  expect(a).not.toContain('--spec-ngram-simple-size-n');
  // the file is missing, or AGENTIC_HELPER=off: the old n-gram guessing, no helper memory counted
  const b = serverArgs(m, { ctx: 32_768, port: 17_600, draft: false });
  expect(b).not.toContain('-md');
  expect(b[b.indexOf('--spec-type') + 1]).toBe('ngram-simple');
  expect(needBytes(m, 32_768, { draft: false })).toBeLessThan(needBytes(m, 32_768));
});

test('Qwen3.5 9B: Low / High like Gemma, its own MTP inside the file, about twice Gemma\'s cache a token', () => {
  const q = MODELS.qwen;
  expect([q.name, q.file, q.bytes, q.folder]).toEqual(['Qwen3.5 9B', 'Qwen3.5-9B-MTP-UD-Q5_K_XL.gguf', 6_874_345_824, 'qwen3.5-9b']);
  expect(q.sha256).toBe('bb0aa4bf2acf4b6d97eca051a7af91200729e9e97449ce98785af9e70f6d703c');
  // the MTP build won the speed test (1.12×, 29 Sep): the helper is the model file itself
  expect(q.draft).toMatchObject({ inFile: true, file: q.file, bytes: 0, type: 'draft-mtp,ngram-simple', nMax: 1, helpsThinking: true });
  const m1 = serverArgs(q, { ctx: 65_536, port: 17_600, draft: true });
  expect(m1).not.toContain('-md');
  expect(m1[m1.indexOf('--spec-type') + 1]).toBe('draft-mtp,ngram-simple');
  expect(modelFolder(q)).toMatch(/models\/qwen3\.5-9b\/$/);
  expect(q.thinkingLevels.map((l) => l.label)).toEqual(['Low', 'High']);
  expect(thinkingKwargs(q, false)).toEqual({ enable_thinking: false });
  expect(thinkingKwargs(q, true).enable_thinking).toBe(true);
  // 8 full-attention layers, 4 kv heads of 256
  expect(kvBytesPerToken(q)).toBe(8 * 4 * 256 * 2 * (34 / 32));
  expect(kvBytesPerToken(q)).toBeGreaterThan(1.9 * kvBytesPerToken(g));
  const a = serverArgs(q, { ctx: 65_536, port: 17_600, draft: false });
  expect(a).not.toContain('-md');
  expect(a[a.indexOf('--spec-type') + 1]).toBe('ngram-simple');
  expect(a[a.indexOf('-np') + 1]).toBe('2');
});

test('a helper inside the model file (draft.inFile, Qwen3.5\'s own MTP layer): no -md file to load, the same guessing flags', () => {
  const q = { ...MODELS.qwen, draft: { inFile: true, file: MODELS.qwen.file, bytes: 0, type: 'draft-mtp,ngram-simple', nMax: 1, computeBytes: 0.25e9 } };
  const a = serverArgs(q, { ctx: 65_536, port: 17_600, draft: true });
  for (const f of ['-md', '-ngld']) expect(a).not.toContain(f);
  expect(a[a.indexOf('--spec-type') + 1]).toBe('draft-mtp,ngram-simple');
  expect(a[a.indexOf('--spec-draft-n-max') + 1]).toBe('1');
  expect(a[a.indexOf('-m') + 1]).toBe(modelPath(q));
  // its file is the model's own, so nothing extra is counted for it
  expect(needBytes(q, 65_536) - needBytes(q, 65_536, { draft: false })).toBeCloseTo(0.25e9 + 2 * 1 * q.fixedStateBytes, -6);
});

test('Gemma: MTP guesses one word ahead and n-grams copy what is on screen; without the helper, n-grams alone', () => {
  expect(g.draft).toMatchObject({ type: 'draft-mtp,ngram-simple', nMax: 1, ownCache: false, helpsThinking: true, bytes: 465_109_248 });
  expect(g.draft.sha256).toBe('145db9094bc0f85f1701e255a2ed216dcc9800fc8bc8631ad00905b456bd451b');
  const a = serverArgs(g, { ctx: 32_768, port: 17_600, draft: true });
  expect(a[a.indexOf('--spec-type') + 1]).toBe('draft-mtp,ngram-simple');
  expect(a[a.indexOf('-md') + 1]).toMatch(/models\/mtp-gemma-4-12b-it\.gguf$/);
  // 1 guess: checking 2 words costs 1.19× one, 4 words 2.4× (measured 28 Sep)
  expect(a[a.indexOf('--spec-draft-n-max') + 1]).toBe('1');
  // it shares Gemma's cache and its default micro-batch
  for (const f of ['-ctkd', '-ctvd', '-ub']) expect(a).not.toContain(f);
  expect(a[a.indexOf('--spec-ngram-simple-size-n') + 1]).toBe('12');
  const b = serverArgs(g, { ctx: 32_768, port: 17_600, draft: false });
  expect(b).not.toContain('-md');
  expect(b[b.indexOf('--spec-type') + 1]).toBe('ngram-simple');
  // it speeds up thinking too, so High keeps it when memory is short (the 27B's helper went first)
  const short = needBytes(g, 16_384) + 0.2e9;
  expect(chooseContext(g, { available: short, effort: 'high' }).helper).toBeUndefined();
  expect(chooseContext(m, { available: needBytes(m, 32_768, { draft: false }) + 0.1e9, effort: 'high' }).helper).toBe(false);
});

test('the engine patch travels inside the code: patch.mjs is byte for byte pq2-multicol.patch', async () => {
  const { readFileSync } = await import('node:fs');
  const { PATCH } = await import('../runtime/engine/patch.mjs');
  expect(PATCH).toBe(readFileSync(new URL('../runtime/engine/pq2-multicol.patch', import.meta.url), 'utf8'));
  // the routine and its switch are in it
  expect(PATCH).toContain('kernel_mul_mv_pq2_0_multicol');
  expect(PATCH).toContain('GGML_METAL_PQ2_MULTICOL');
});

test('the memory\'s matcher: BGE-M3, in the engine\'s embedding mode, beside the model in use', () => {
  expect(Object.keys(EMBEDDERS)).toEqual(['bge-m3']);
  const e = EMBEDDERS[DEFAULT_EMBEDDER];
  expect([e.kind, e.file, e.bytes, e.pooling, e.cut, e.margin]).toEqual(['embedding', 'bge-m3-Q8_0.gguf', 634_553_760, 'cls', 0.56, 0.02]);
  expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
  const a = serverArgs(e, { port: 17_605 });
  expect(a.slice(0, 2)).toEqual(['-m', modelPath(e)]);
  expect(a.join(' ')).toContain('--port 17605 --embedding --pooling cls -c 2048 -ub 2048 -ngl 99 -np 1');
  // none of the chat model's flags
  for (const f of ['--jinja', '--reasoning-budget', '-md', '--slot-save-path', '--spec-type']) expect(a).not.toContain(f);
  // and it is not one of the models /model offers
  expect(Object.keys(MODELS)).toEqual(['gemma', 'qwen', 'k2', 'bonsai', 'constantkv']);
});
