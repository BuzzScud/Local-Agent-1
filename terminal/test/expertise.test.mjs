// The user's own math notes (src/agent/expertise.mjs): indexed into areas,
// matched by a /math request's words, carried with the request, and reachable
// read-only through MATH/ paths. Built against a small fixture folder, so
// nothing here depends on the real ~/Desktop/MATH.
import { test, expect, beforeAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const FIX = join(tmpdir(), `agentic-math-fixture-${process.pid}`);
const HOME = join(tmpdir(), `agentic-math-home-${process.pid}`);
process.env.AGENTIC_MATH = FIX;
process.env.AGENTIC_HOME = HOME;

// Imported after the env points at the fixture (the module reads it lazily,
// but tests should never look at the real folder even by accident).
const E = await import('../src/agent/expertise.mjs');
const { resolvePath, prepare } = await import('../src/agent/tools.mjs');
const { systemPrompt, SESSION_MARK } = await import('../src/agent/prompt.mjs');

const write = (rel, text) => { mkdirSync(join(FIX, rel, '..'), { recursive: true }); writeFileSync(join(FIX, rel), text); };

beforeAll(() => {
  rmSync(FIX, { recursive: true, force: true });
  write('part_01_foundations/chapter_01_clock_lattice/README.md', '# Chapter 1: Clock Lattice Structure\n\n## Overview\nThe 12-fold clock lattice.\n');
  write('part_01_foundations/chapter_01_clock_lattice/content.md', '## Quadrant folding\nFolding the four quadrants onto one.\n\n### Detail\nMore.\n\n## Phase angles\nAngles around the clock.\n');
  write('part_01_foundations/chapter_02_crystalline_abacus/content.md', '# Crystalline Abacus\n\n## Division by zero\nThe abacus view of division.\n');
  write('part_01_foundations/README.md', '# Part I: Foundations\n\nChapters and navigation.\n');
  write('thesis/THESIS.md', '# The Treatise\n\n## Sixty and the base\nBase sixty everywhere.\n');
  write('thesis/THESIS_BACKUP_BEFORE_UPDATES.md', '# Old copy\n');
  write('thesis/THESIS_COMPLETE.md', '# Old copy too\n');
  write('Primes and the 440 wheel — claim check.html', '<html><body>wheel</body></html>');
});

const fresh = () => E.mathIndex({ fresh: true });

test('the index has one area per chapter, skips backups, and knows the pages by name', () => {
  const idx = fresh();
  const names = idx.areas.map((a) => a.name).sort();
  expect(names).toContain('Clock Lattice Structure');
  expect(names).toContain('Crystalline Abacus');
  const thesis = idx.areas.find((a) => a.key === 'thesis');
  expect(thesis.files.map((f) => f.f)).toEqual(['thesis/THESIS.md']);
  const pages = idx.areas.find((a) => a.key === '.');
  expect(pages.files[0].md).toBe(false);
});

test('a request using an area\'s words matches; everyday coding words never do', () => {
  const idx = fresh();
  expect(E.sortMath('explain the clock lattice', { index: idx }).area.name).toBe('Clock Lattice Structure');
  expect(E.sortMath('what does the crystalline abacus say about division', { index: idx }).area.name).toBe('Crystalline Abacus');
  expect(E.sortMath('fix the clock display bug in the toolbar', { index: idx })).toBe(null);
  expect(E.sortMath('rename getUser to fetchUser', { index: idx })).toBe(null);
  expect(E.sortMath('what is in my math notes', { index: idx }).browse).toBe(true);
  // /math lowers the bar to one word.
  expect(E.sortMath('the abacus', { index: idx })).toBe(null);
  expect(E.sortMath('the abacus', { index: idx, min: 1 }).area.name).toBe('Crystalline Abacus');
});

test('the notes carry the matched section, how to treat them, and where more is', () => {
  const idx = fresh();
  const notes = E.mathNotes(E.sortMath('explain quadrant folding on the clock lattice', { index: idx }), 'explain quadrant folding on the clock lattice');
  expect(notes).toContain('Quadrant folding');
  expect(notes).toContain('Folding the four quadrants');
  expect(notes).not.toContain('Phase angles\nAngles'); // the next section stays out
  expect(notes).toContain('answer from these notes first');
  expect(notes).toContain('standard mathematics says something different');
  expect(notes).toContain('MATH/');
  // A page known only by name is pointed at, not excerpted.
  const page = E.mathNotes(E.sortMath('the primes and the 440 wheel', { index: idx }), 'the primes and the 440 wheel');
  expect(page).toContain('Primes and the 440 wheel');
  expect(page).not.toContain('<html>');
});

test('a pointer, when one is passed, sits in the shared part of the prompt; no catalog (off by default since 2026-09-26)', () => {
  const map = "The user's own mathematics\nThe user keeps their own mathematical framework in a MATH folder (thesis). When a request touches one of its topics, the matching notes come with the request: answer from them first.";
  const p = systemPrompt({ cwd: '/tmp', git: 'test', tests: null, math: map });
  const shared = p.slice(0, p.indexOf(SESSION_MARK));
  expect(shared).toContain("The user's own mathematics");
  expect(shared).toContain('thesis');
  expect(shared).toContain('answer from them first');
  expect(systemPrompt({ cwd: '/tmp', git: 'test', tests: null, math: '' })).not.toContain("The user's own mathematics");
});

test('a file added later is picked up without being asked', () => {
  fresh();
  write('prime/spiral_walk.md', '# The Prime Spiral Walk\n\n## Walking it\nSteps.\n');
  const idx = fresh();
  const m = E.sortMath('show me the prime spiral walk', { index: idx });
  expect(m.area.key).toBe('prime');
  expect(E.mathNotes(m, 'show me the prime spiral walk')).toContain('MATH/prime/spiral_walk.md');
  rmSync(join(FIX, 'prime'), { recursive: true, force: true });
});

test('MATH/ paths read from the folder and are never writable', () => {
  const cwd = join(tmpdir(), `agentic-math-project-${process.pid}`);
  mkdirSync(cwd, { recursive: true });
  const p = resolvePath(cwd, 'MATH/thesis/THESIS.md');
  expect(p.inside).toBe(true);
  expect(p.math).toBe(true);
  expect(p.abs).toBe(join(FIX, 'thesis/THESIS.md'));
  expect(resolvePath(cwd, 'MATH/../secrets.txt').math).toBeUndefined(); // no climbing out
  expect(prepare('Edit', { path: 'MATH/thesis/THESIS.md', old_text: 'a', new_text: 'b' }, { cwd }).error).toContain('read-only');
  expect(prepare('Write', { path: 'MATH/new.md', content: 'x' }, { cwd }).error).toContain('read-only');
  // A project's own MATH folder still wins.
  mkdirSync(join(cwd, 'MATH'), { recursive: true });
  writeFileSync(join(cwd, 'MATH/own.md'), 'ours');
  expect(resolvePath(cwd, 'MATH/own.md').math).toBeUndefined();
  rmSync(cwd, { recursive: true, force: true });
});

// Like Claude Code, Agentic Coder reads nothing beyond the project unless asked: the
// math notes come only with /math. (Matching every request by its words sent
// a notes.html request into the MATH folder on 2026-09-26.)
test('the notes come only with /math: not named in the instructions, never attached to an ordinary request', async () => {
  fresh();
  const { Agent } = await import('../src/agent/agent.mjs');
  const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');
  const { startFakeServer } = await import('./fake-server.mjs');
  const cwd = join(tmpdir(), `agentic-math-plain-${process.pid}`); mkdirSync(cwd, { recursive: true });
  for (const at of [cwd, HOME, join(HOME, '..')]) {
    const sys = systemPrompt({ cwd: at, git: 'test', tests: null });
    expect(sys).not.toMatch(/MATH|own mathematic/); // no pointer to the folder, not even in the home-folder note
  }
  const fake = await startFakeServer([{ text: 'Sure.' }, { text: 'From your notes.' }]);
  const notes = [];
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: false, ctx: 32768, mode: 'ask', flows: false, ask: async () => ({ choice: 'no' }) });
  agent.on('note', (e) => notes.push(e.text));
  // every word here names the fixture's clock-lattice area
  await agent.send('explain quadrant folding on the clock lattice');
  expect(notes.some((t) => t.startsWith('Using the math notes'))).toBe(false);
  expect(JSON.stringify(fake.requests[0].messages)).not.toContain("From the user's own math notes");
  agent.mathForce = true; // what /math sets
  await agent.send('explain quadrant folding on the clock lattice');
  await fake.close();
  expect(notes.some((t) => t.startsWith('Using the math notes: Clock Lattice Structure'))).toBe(true);
  expect(JSON.stringify(fake.requests.at(-1).messages)).toContain("From the user's own math notes");
});
