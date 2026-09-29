// Terminal behaviour that the model's speed shapes: the system prompt keeps a
// shared start (so the models part can save the warm-up), and how much of a
// file a try rewrites.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemPrompt, SESSION_MARK, projectNotes, fitSections } from '../src/agent/prompt.mjs';
import { WHOLE_FILE_MAX, SHOW_WHOLE_MAX, isWholeFile } from '../src/flows/units.mjs';

test('the instructions start the same in every project and on every day (so the warm-up can be saved)', () => {
  const a = systemPrompt({ cwd: '/tmp/a', git: 'main, clean', date: new Date('2026-09-25'), tests: 'node --test' });
  const b = systemPrompt({ cwd: '/tmp/b', git: 'none', date: new Date('2027-01-02'), tests: null, notes: 'Use tabs.' });
  const shared = (s) => s.slice(0, s.indexOf(SESSION_MARK));
  expect(shared(a).length).toBeGreaterThan(1000);
  expect(shared(a)).toBe(shared(b));
  expect(a.slice(a.indexOf(SESSION_MARK))).toContain('Today: 2026-09-25');
  expect(b.slice(b.indexOf(SESSION_MARK))).toContain('Use tabs.');
});

test('a private .bonsai/notes.md is read alongside AGENTS.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-notes-'));
  writeFileSync(join(dir, 'AGENTS.md'), 'Run the tests with npm test.');
  mkdirSync(join(dir, '.bonsai'), { recursive: true });
  writeFileSync(join(dir, '.bonsai', 'notes.md'), 'The deploy password lives in 1Password.');
  const n = projectNotes(dir);
  expect(n.files.some((p) => p.endsWith('AGENTS.md'))).toBe(true);
  expect(n.files.some((p) => p.endsWith('.bonsai/notes.md'))).toBe(true);
  expect(n.text).toContain('npm test');
  expect(n.text).toContain('1Password');
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

test('a notes file too long for what is left is cut at a heading, never mid-sentence, and says what it left out', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-notes-home-'));
  const proj = join(home, 'proj');
  mkdirSync(proj);
  writeFileSync(join(proj, 'AGENTS.md'), `# Working here\n\n${'Keep each change small and test it. '.repeat(154).trim()}`); // leaves ~400 of 6,000
  writeFileSync(join(home, 'AGENTS.md'), `# Local context\n\nRead MEMORY.md for resumes.\n\n# Other sessions may be working here too\n\nSeveral sessions run at once, and the owner's own work may be uncommitted.\n${'- Never run git stash in a shared folder; it wipes other work.\n'.repeat(10)}`);
  const n = projectNotes(proj, 6000, { memory: false, home });
  expect(n.text).toContain('From ~/proj/AGENTS.md:\n# Working here');
  expect(n.text).toContain('From ~/AGENTS.md (part of it, to fit; left out: "Other sessions may be working here too"):\n# Local context\n\nRead MEMORY.md for resumes.');
  expect(n.text).not.toContain('Several sessions'); // no half section
  expect(n.text.length).toBeLessThanOrEqual(6000);
  // No room at all for the home file: it is named, not cut.
  const tight = projectNotes(proj, 5700, { memory: false, home });
  expect(tight.text).toContain('(Left out to fit: ~/AGENTS.md.)');
  expect(tight.text).not.toContain('Local context');
  expect(tight.files).toHaveLength(2); // both are still listed as found
});

test('sections: a "#" inside a code block is not a heading; a first section too long gives whole paragraphs, then whole lines', () => {
  const md = '# Setup\n\nRun it:\n```sh\n# not a heading\nnpm test\n```\n\n# Style\n\nTabs.';
  expect(fitSections(md, 1000)).toEqual({ text: md, left: [] });
  expect(fitSections(md, 60)).toEqual({ text: '# Setup\n\nRun it:\n```sh\n# not a heading\nnpm test\n```', left: ['Style'] });
  expect(fitSections('# A\n\nOne paragraph here.\n\nA second one that is a lot longer than the room.', 30)).toEqual({ text: '# A\n\nOne paragraph here.', left: [] });
  expect(fitSections('Line one is short.\nLine two is quite a bit longer than that.', 25)).toEqual({ text: 'Line one is short.', left: [] });
  expect(fitSections('A single line that never fits anywhere.', 10)).toEqual({ text: '', left: [] });
  // never a heading on its own
  expect(fitSections('# Local context\n\nFor work involving the resumes, read MEMORY.md first.', 30)).toEqual({ text: '', left: ['Local context'] });
});
