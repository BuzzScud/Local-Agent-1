// The model settings: Bonsai 2 27B, its memory math, its server flags and
// how much of a file a try rewrites.
import { test, expect } from 'bun:test';
import { MODELS, DEFAULT_MODEL, thinkingKwargs, thinkingLevel } from '../src/server/models.mjs';
import { systemPrompt, SESSION_MARK } from '../src/agent/prompt.mjs';
import { kvBytesPerToken, needBytes, chooseContext } from '../src/server/memory.mjs';
import { serverArgs } from '../src/server/server.mjs';
import { WHOLE_FILE_MAX, SHOW_WHOLE_MAX, isWholeFile } from '../src/flows/units.mjs';

const m = MODELS[DEFAULT_MODEL];

test('Bonsai 2 27B is the only model', () => {
  expect(Object.keys(MODELS)).toEqual(['27b']);
  expect(m.file).toBe('Ternary-Bonsai-2-27B-PQ2_0.gguf');
  expect(m.bytes).toBe(7_206_168_928);
  expect(m.thinkingDefault).toBe(false);
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

test('the instructions start the same in every project and on every day (so the warm-up can be saved)', () => {
  const a = systemPrompt({ cwd: '/tmp/a', git: 'main, clean', date: new Date('2026-09-25'), tests: 'node --test' });
  const b = systemPrompt({ cwd: '/tmp/b', git: 'none', date: new Date('2027-01-02'), tests: null, notes: 'Use tabs.' });
  const shared = (s) => s.slice(0, s.indexOf(SESSION_MARK));
  expect(shared(a).length).toBeGreaterThan(1000);
  expect(shared(a)).toBe(shared(b));
  expect(a.slice(a.indexOf(SESSION_MARK))).toContain('Today: 2026-09-25');
  expect(b.slice(b.indexOf(SESSION_MARK))).toContain('Use tabs.');
});

test('memory: only 16 layers keep a per-token cache; the estimate covers what was measured', () => {
  expect(kvBytesPerToken(m)).toBe(34_816);
  // measured 2026-09-25 with two slots at 32k: 7.21 file + 2.38 working memory;
  // the estimate is the worst case (both slots full of checkpoints), not far above it
  const at32 = needBytes(m, 32_768) / 1e9;
  expect(at32).toBeGreaterThanOrEqual(7.21 + 2.38);
  expect(at32).toBeLessThan(7.21 + 2.38 + 0.6);
  expect(needBytes(m, 16_384)).toBeLessThan(needBytes(m, 32_768));
  expect(chooseContext(m, { available: 10e9 }).ctx).toBe(32_768);
  const short = chooseContext(m, { available: 9.5e9 });
  expect(short.ctx).toBe(16_384);
  expect(short.reason).toMatch(/^9\.5 GB free, so using 16k \(9\.2 GB\) instead of 32k \(9\.8 GB\)$/);
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
});

test('tries rewrite one function past 80 lines; the model reads whole files up to 300', () => {
  expect(WHOLE_FILE_MAX).toBe(80);
  expect(SHOW_WHOLE_MAX).toBe(300);
});

test('a whole-file reply is recognised when one function was asked for', () => {
  const file = 'import x from "y";\n\nexport function a() {\n  return 1;\n}\n\nexport function b() {\n  return 2;\n}\n\nexport function c() {\n  return 3;\n}\n';
  expect(isWholeFile('export function b() {\n  return 22;\n}\n', file, 'b', 'js')).toBe(false);
  expect(isWholeFile(file.replace('return 2', 'return 22'), file, 'b', 'js')).toBe(true);
  // a new function that calls an existing one is not the whole file
  expect(isWholeFile('export function d() {\n  return a() + 1;\n}\n', file, null, 'js')).toBe(false);
  // a file with one other function: defining it again means the whole file
  const two = 'export function a() {\n  return 1;\n}\n\nexport function b() {\n  return 2;\n}\n';
  expect(isWholeFile(two.replace('return 2', 'return 5'), two, 'b', 'js')).toBe(true);
});
