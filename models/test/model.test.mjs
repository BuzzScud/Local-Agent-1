// The models part on its own: the registry (Bonsai 2 27B's settings), the
// thinking switch, the memory math and the server's flags.
import { test, expect } from 'bun:test';
import { MODELS, DEFAULT_MODEL, thinkingKwargs, thinkingLevel, kvBytesPerToken, needBytes, chooseContext, serverArgs, modelFolder } from '../index.mjs';

const m = MODELS[DEFAULT_MODEL];

test('Bonsai 2 27B is the only model', () => {
  expect(Object.keys(MODELS)).toEqual(['27b']);
  expect(m.file).toBe('Ternary-Bonsai-2-27B-PQ2_0.gguf');
  expect(m.bytes).toBe(7_206_168_928);
  expect(m.thinkingDefault).toBe(false);
  // each model has its own folder in models/ (settings, README, reports, results)
  expect(m.folder).toBe('bonsai-2-27b');
  expect(modelFolder(m)).toMatch(/models\/bonsai-2-27b\/$/);
});

test('thinking switch: off, medium or high', () => {
  expect(thinkingKwargs(m, false)).toEqual({ enable_thinking: false });
  expect(thinkingKwargs(m, true)).toEqual({ enable_thinking: true, reasoning_effort: 'medium' });
  expect(thinkingKwargs(m, true, 'medium')).toEqual({ enable_thinking: true, reasoning_effort: 'medium' });
  // "High" is the template's "xhigh" ("high" errors in this build)
  expect(thinkingKwargs(m, true, 'high')).toEqual({ enable_thinking: true, reasoning_effort: 'xhigh' });
  expect(thinkingKwargs(m, false, 'high')).toEqual({ enable_thinking: false });
  expect(m.thinkingLevels.map((l) => l.label)).toEqual(['Off', 'Medium', 'High']);
  expect(thinkingLevel(m, false, 'high').id).toBe('off');
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
  // the file is missing, or BONSAI_HELPER=off: the old n-gram guessing, no helper memory counted
  const b = serverArgs(m, { ctx: 32_768, port: 17_600, draft: false });
  expect(b).not.toContain('-md');
  expect(b[b.indexOf('--spec-type') + 1]).toBe('ngram-simple');
  expect(needBytes(m, 32_768, { draft: false })).toBeLessThan(needBytes(m, 32_768));
});

test('the engine patch travels inside the code: patch.mjs is byte for byte pq2-multicol.patch', async () => {
  const { readFileSync } = await import('node:fs');
  const { PATCH } = await import('../runtime/engine/patch.mjs');
  expect(PATCH).toBe(readFileSync(new URL('../runtime/engine/pq2-multicol.patch', import.meta.url), 'utf8'));
  // the routine and its switch are in it
  expect(PATCH).toContain('kernel_mul_mv_pq2_0_multicol');
  expect(PATCH).toContain('GGML_METAL_PQ2_MULTICOL');
});
