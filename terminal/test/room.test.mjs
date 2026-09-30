// How much of your rules and of the files a question names is read first:
// /effort's Rules room and Up-front reading rows (30 Sep 2026). 0 = auto, a share of the Context.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rulesRoomFor, upFrontFor } from '../src/agent/room.mjs';
import { notesRoom } from '../src/agent/prompt.mjs';
import { Agent } from '../src/agent/agent.mjs';
import { LIMITS, defaultLimits, readLimits, limitsToSave, moveLimit, showLimit, limitNote, applyLimits } from '../src/app/limits.mjs';
import { MODELS } from '../../models/index.mjs';

const model = Object.values(MODELS)[0];
const row = (id) => LIMITS.find((l) => l.id === id);

test('the auto amounts are a share of the Context: rules never under 12,000, files 45,000 at 32k', () => {
  const at = [16384, 32768, 65536, 131072];
  expect(at.map(rulesRoomFor)).toEqual([12000, 12000, 18000, 36000]);
  expect(at.map(upFrontFor)).toEqual([22000, 45000, 90000, 180000]);
  expect(notesRoom()).toBe(12000); // the context is unknown: 32k
  expect(notesRoom(131072)).toBe(36000);
});

test('the two rows start on auto, are not saved until moved, and keep to their steps', () => {
  const d = defaultLimits(model);
  expect([d.rulesRoom, d.upFront]).toEqual([0, 0]);
  for (const id of ['rulesRoom', 'upFront']) expect(row(id).steps(model)).toContain(0);
  expect(limitsToSave(d, model)).toEqual({});
  const v = readLimits({ limits: { rulesRoom: 18000, upFront: 'lots' } }, model);
  expect(v.rulesRoom).toBe(18000);
  expect(v.upFront).toBe(0); // not a number: left on auto
  expect(readLimits({ limits: { upFront: 9_999_999 } }, model).upFront).toBe(0); // past the last step
  expect(limitsToSave(v, model)).toEqual({ rulesRoom: 18000 });
  // one step at a time, auto at the bottom, as Context does
  const up = moveLimit(d, 'rulesRoom', 1, model);
  expect(up.rulesRoom).toBe(6000);
  expect(moveLimit(up, 'rulesRoom', -1, model).rulesRoom).toBe(0);
});

test('each row says what it comes to and what it costs, following the Context while on auto', () => {
  expect(showLimit('rulesRoom', 0)).toBe('auto');
  expect(showLimit('rulesRoom', 12000)).toBe('12,000 chars');
  expect(showLimit('upFront', 45000)).toBe('45,000 chars');
  const env = (values, ctxNow) => ({ model, values, ctxNow });
  expect(limitNote('rulesRoom', env({ ...defaultLimits(model), context: 0 }, 16384))).toMatch(/^follows Context: 12,000 chars · AGENTS\.md \/ CLAUDE\.md: ~\d+ s to read at start, once$/);
  expect(limitNote('rulesRoom', env({ ...defaultLimits(model), context: 131072 }))).toContain('follows Context: 36,000 chars');
  expect(limitNote('upFront', env({ ...defaultLimits(model), context: 0 }, 16384))).toContain('follows Context: 22,000 chars');
  // a moved value names itself, and a window it would fill half of says so
  expect(limitNote('upFront', env({ ...defaultLimits(model), context: 16384, upFront: 90000 }))).toMatch(/^⚠ over half the window: raise Context first · files a question names/);
  expect(limitNote('upFront', env({ ...defaultLimits(model), context: 131072, upFront: 90000 }))).not.toContain('⚠');
});

test('the agent reads the rows: auto follows its context, a moved value is used as it is', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-room-'));
  const a = new Agent({ url: 'http://127.0.0.1:9', model, cwd, ctx: 65536, system: 'x' });
  a.emit = () => {};
  applyLimits(a, defaultLimits(model));
  expect([a.notesRoomNow, a.upFrontNow]).toEqual([18000, 90000]);
  a.ctx = 16384;
  expect([a.notesRoomNow, a.upFrontNow]).toEqual([12000, 22000]);
  applyLimits(a, { ...defaultLimits(model), rulesRoom: 6000, upFront: 11000 });
  expect([a.notesRoomNow, a.upFrontNow]).toEqual([6000, 11000]);
});

test('a bigger Context reads the rules again once, before the first message, and only when the amount changed', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-room-'));
  const long = `# Rules\n\n${Array.from({ length: 160 }, (_, i) => `Rule ${i}: keep line ${i} short and say the real thing plainly.`).join('\n')}\n\n## The last section\nEND-OF-THE-RULES`;
  writeFileSync(join(cwd, 'AGENTS.md'), long);
  expect(long.length).toBeGreaterThan(9000);
  const a = new Agent({ url: 'http://127.0.0.1:9', model, cwd, ctx: 16384, system: 'x' });
  a.emit = () => {};
  a.notesRoomUsed = 6000; // what the start built the system prompt with
  applyLimits(a, { ...defaultLimits(model), rulesRoom: 6000 });
  expect(a.messages[0].content).toBe('x'); // nothing changed, nothing rebuilt
  applyLimits(a, { ...defaultLimits(model), rulesRoom: 18000 });
  expect(a.notesRoomUsed).toBe(18000);
  expect(a.messages[0].content).toContain('END-OF-THE-RULES');
  a.messages[0] = { role: 'system', content: 'kept' };
  a.syncRules(); // the same amount again: left alone
  expect(a.messages[0].content).toBe('kept');
  const b = new Agent({ url: 'http://127.0.0.1:9', model, cwd, ctx: 16384, system: 'y' });
  b.emit = () => {};
  b.syncRules(); // a start that never said what it built with (a test, a script): left alone
  expect(b.messages[0].content).toBe('y');
});

test('a question that names a file reads it whole up to Up-front reading, else its outline and the lines that match', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-room-'));
  const lines = Array.from({ length: 300 }, (_, i) => `export const value${i} = ${i}; // ${'x'.repeat(70)}`);
  writeFileSync(join(cwd, 'big.mjs'), lines.join('\n'));
  const size = lines.join('\n').length;
  const read = async (upFront) => {
    const a = new Agent({ url: 'http://127.0.0.1:9', model, cwd, ctx: 32768, system: 'x' });
    a.emit = () => {};
    a.upFront = upFront;
    const before = a.messages.length;
    await a.prefetch('what does big.mjs do?');
    return a.messages.slice(before).filter((m) => m.role === 'tool').map((m) => m.content.length).reduce((s, n) => s + n, 0);
  };
  expect(size).toBeGreaterThan(20000);
  expect(await read(45000)).toBeGreaterThanOrEqual(size);
  expect(await read(11000)).toBeLessThan(size);
});
