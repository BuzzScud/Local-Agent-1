// Saving on its own (src/agent/lessons.mjs): what the model is shown, what
// of its answer is kept, and what is refused because the turns do not bear
// it out.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveLessons, savePrompt, lessonText, worthSaving, knownAlready, fromTask, saveLine, writtenBefore, seedMemory, saysHow, MAX_FACTS } from '../src/agent/lessons.mjs';
import { memoryDirs, applyChanges, readFacts, readState, undoLast } from '../src/agent/facts.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';
import { FakeEmbedder } from './fake-embedder.mjs';

const model = MODELS[DEFAULT_MODEL];
const place = () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-lessons-'));
  const repo = join(home, 'work', 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(join(repo, 'legend.js'), 'export const z = 0;\n');
  return { home, repo, ...memoryDirs(repo, home) };
};
const turn = (o) => ({ at: '2026-09-26T20:00:00.000Z', request: 'fix it', kind: 'fix', reason: 'done', outcome: 'done', files: [], check: null, tries: [], findings: [], asked: [], warnings: [], summary: null, recalled: [], ...o });
const passed = Object.freeze(turn({ request: 'the symbol list is hidden behind the legend, fix it', outcome: 'passed', files: ['legend.js'], check: { cmd: 'node desks/chart/tools/e2e/symmenu-layer.mjs', ok: true }, tries: [{ label: 'Fix', marks: '✗✗✓', summary: 'try 3 passed', failed: false }], findings: ['So the cause: the legend sits above the menu.'] }));
const stuck = Object.freeze(turn({ request: 'explain legend.js', kind: 'question', reason: 'stuck', outcome: 'stuck', warnings: ['It kept repeating the same step, so it stopped.'], corrected: 'no, I asked about the legend' }));
const save = async (answer, o = {}) => {
  const where = o.where ?? place();
  const fake = await startFakeServer([{ text: JSON.stringify(answer) }]);
  const out = await saveLessons({ url: fake.url, model, cwd: where.repo, home: where.home, lessons: o.lessons ?? [{ ...passed }], messages: o.messages ?? [{ role: 'user', content: 'the symbol list is hidden behind the legend, fix it' }, { role: 'assistant', content: 'Fixed in legend.js; the check passes.' }], today: '2026-09-26', embedder: o.embedder ?? null, ...o.more });
  await fake.close();
  return { out, fake, ...where };
};

test('what the model is shown: each turn with its result, what is saved with its id, and the rules', () => {
  expect(lessonText(passed, 0)).toBe('Turn 1 (fix): "the symbol list is hidden behind the legend, fix it" → the check passed\n  changed: legend.js\n  check: node desks/chart/tools/e2e/symmenu-layer.mjs → passed\n  tries: Fix ✗✗✓ (try 3 passed)\n  it found: So the cause: the legend sits above the menu.');
  expect(lessonText(stuck, 1)).toBe('Turn 2 (question): "explain legend.js" → Agentic Coder got STUCK\n  trouble: It kept repeating the same step, so it stopped.\n  then the user CORRECTED it: "no, I asked about the legend"');
  const p = savePrompt({ lessons: [passed], conversation: 'User: fix it', saved: [{ id: 'tests-run', kind: 'project', text: 'Tests run with bun.' }, { id: 'w', kind: 'worked', text: 'Worked: lowering the z-index.' }], today: '2026-09-26' });
  expect(p.system).toContain(`Save at most ${MAX_FACTS} facts`);
  expect(p.system).toContain('Today is 2026-09-26.');
  expect(p.user).toContain('Saved already:\n- [tests-run] (project) Tests run with bun.\n- [w] (worked) Worked: lowering the z-index.');
  expect(p.user).toContain('Jobs done before:\n- Worked: lowering the z-index.');
  expect(p.user).toContain('What happened:\nTurn 1 (fix)');
});

test('when there is something to learn: a result, a correction, or the user saying how they want things', () => {
  expect(worthSaving([turn({ request: 'what does export.mjs do?', kind: 'question' })])).toBe(false);
  expect(worthSaving([passed])).toBe(true);
  expect(worthSaving([{ ...passed, saved: true }])).toBe(false);
  expect(worthSaving([turn({ corrected: 'no, wrong file' })])).toBe(true);
  expect(worthSaving([turn({ request: 'from now on explain things simply', kind: 'other' })])).toBe(true);
  expect(worthSaving([])).toBe(false);
});

test('a save: each fact goes to its memory, says where it came from, and the turns are marked as saved', async () => {
  const lessons = [{ ...passed }, { ...stuck }];
  const { out, you, project, fake } = await save({ add: [
    { kind: 'worked', text: 'Worked: the symbol list showed again after lowering the legend\'s z-index in legend.js.', turn: 1 },
    { kind: 'you', text: 'Answer the question that was asked before explaining anything else.', turn: 2 },
    { kind: 'mistake', text: 'Reading legend.js again gives nothing new; ask the user what they mean.', turn: 2 },
  ], drop: [] }, { lessons });
  expect(out.added.map((f) => [f.kind, f.from])).toEqual([['you', 'the task "explain legend.js"'], ['worked', 'the task "the symbol list is hidden behind the legend, fix it"'], ['mistake', 'the task "explain legend.js"']]);
  expect(readFacts(you).map((f) => f.kind)).toEqual(['you']);
  expect(readFacts(project).map((f) => f.kind).sort()).toEqual(['mistake', 'worked']);
  expect(lessons.every((l) => l.saved)).toBe(true);
  expect(saveLine(out)).toBe('Memory: 3 saved · "Answer the question that was asked before explaining anything else." · /memory shows it, /memory undo takes it back');
  // asked on one focused request, with the forced shape
  expect(fake.requests).toHaveLength(1);
  expect(fake.requests[0].response_format.type).toBe('json_schema');
  // and the whole save can be taken back
  expect(undoLast(project).did).toHaveLength(2);
  expect(readFacts(project)).toEqual([]);
});

test('refused, because the turns do not bear it out: a "worked" with no passed check, a "failed" with no failure, a recipe for a job done once', async () => {
  const talk = turn({ request: 'what does legend.js do?', kind: 'question' });
  const { out, project } = await save({ add: [
    { kind: 'worked', text: 'Worked: lowering the z-index in legend.js fixed the symbol list.', turn: 1 },
    { kind: 'failed', text: 'Failed: raising the menu above the legend in legend.js.', turn: 1 },
    { kind: 'recipe', text: 'Fix a layer bug in the chart.', steps: ['find the layer', 'lower it'], turn: 1 },
    { kind: 'project', text: 'The legend is drawn in legend.js.', turn: 1 },
    { kind: 'project', text: 'The colours are set in src/theme/made-up.css.', turn: 1 }, // a path the model made up
  ], drop: [] }, { lessons: [talk] });
  expect(out.refused.map((r) => r.why)).toEqual(['no check passed in these turns', 'nothing failed in these turns', 'this job was not done twice yet', 'names a file that is not in the project']);
  expect(readFacts(project).map((f) => f.text)).toEqual(['The legend is drawn in legend.js.']);
  expect(saveLine({ added: [], replaced: [], retired: [] })).toBe('');
});

test('a recipe is saved the second time a job passes; a fact in other words is a repeat; more than five are cut', async () => {
  const where = place();
  applyChanges(where.project, { add: [{ kind: 'worked', text: 'Worked: the legend showed again after lowering its z-index in legend.js.' }] });
  const { out, project } = await save({ add: [
    { kind: 'recipe', text: 'Fix a layer that hides another in the chart.', steps: ['find which layer is on top', 'lower its z-index in legend.js', 'run the named check'], turn: 1 },
    { kind: 'worked', text: 'The legend symbols menu showed after the z-index of the legend went down.', turn: 1 }, // the saved fact, in other words
    ...Array.from({ length: 6 }, (_, i) => ({ kind: 'project', text: `Deploy step ${i + 1} goes through the ssh server named in the notes.`, turn: 1 })),
  ], drop: [] }, { where, embedder: new FakeEmbedder() });
  expect(out.added.map((f) => f.kind)).toContain('recipe');
  expect(readFacts(project).find((f) => f.kind === 'recipe').steps).toEqual(['find which layer is on top', 'lower its z-index in legend.js', 'run the named check']);
  expect(out.refused.some((r) => r.why.startsWith('saved already, in other words'))).toBe(true);
  expect(out.added.length + out.refused.length).toBeLessThanOrEqual(MAX_FACTS);
});

test('a fact a turn showed to be wrong is replaced or dropped, and it is in the log', async () => {
  const where = place();
  const [a, b] = applyChanges(where.project, { add: [{ kind: 'project', text: 'The tests run with npm test in this project.' }, { kind: 'failed', text: 'Failed: lowering the legend in legend.js did nothing.' }] }).added;
  const { out, project } = await save({ add: [{ kind: 'project', text: 'The tests run with node --test in this project.', replaces: a.id, turn: 1 }], drop: [{ id: b.id, why: 'turn 1 shows it works' }, { id: 'no-such-fact', why: 'x' }] }, { where });
  expect(out.replaced.map((r) => [r.old.text, r.fact.text])).toEqual([['The tests run with npm test in this project.', 'The tests run with node --test in this project.']]);
  expect(out.retired.map((f) => f.id)).toEqual([b.id]);
  expect(readFacts(project).map((f) => f.text)).toEqual(['The tests run with node --test in this project.']);
  expect(readFacts(project, { retired: true }).map((f) => f.retired.replace(/^\S+ · /, '')).sort()).toEqual(['replaced by: The tests run with node --test in this project.', 'turn 1 shows it works']);
});

test('an answer that is not what was asked for saves nothing and breaks nothing; being stopped is passed on', async () => {
  const bad = await save('sorry, I cannot');
  expect([bad.out.added, bad.out.refused]).toEqual([[], []]);
  const odd = await save({ add: [{ kind: 'nonsense', text: 'Something of no known kind at all.' }], drop: [] });
  expect([odd.out.added, odd.out.refused.map((r) => r.why)]).toEqual([[], ['not a kind of fact']]);
  const where = place();
  const fake = await startFakeServer([{ text: '{"add":[],"drop":[]}' }], { delayMs: 50 });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 20);
  const lessons = [{ ...passed }];
  await expect(saveLessons({ url: fake.url, model, cwd: where.repo, home: where.home, lessons, signal: ac.signal })).rejects.toThrow();
  await fake.close();
  expect(lessons[0].saved).toBeUndefined(); // still to be saved, next time
});

test('first use in a project: earlier conversations and test runs are read once, as what was done before', async () => {
  const where = place();
  const sessionsDir = join(where.home, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, '2026-09-25.json'), JSON.stringify({ messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'always explain things simply' }, { role: 'assistant', content: 'I will.' }, { role: 'user', content: '[The user interrupted you.]' }] }));
  writeFileSync(join(where.repo, 'AGENTS.md'), `${'rule. '.repeat(1100)}THE TAIL: deploys go through ssh.`);
  const w = writtenBefore(where.repo, { sessionsDir, record: [{ name: 'The 28 practice tasks', result: 'pass', passed: 28, total: 28, note: '1,929 s' }] });
  expect(w.turns.map((t) => [t.request, t.outcome])).toEqual([['always explain things simply', 'done'], ['The 28 practice tasks (1,929 s)', 'passed']]);
  expect(w.text).toContain('User: always explain things simply');
  expect(w.text).toContain('THE TAIL: deploys go through ssh.');
  const fake = await startFakeServer([{ text: JSON.stringify({ add: [{ kind: 'you', text: 'Explain things simply, in plain words.', turn: 1 }, { kind: 'worked', text: 'Worked: all 28 practice tasks passed on this code.', turn: 2 }], drop: [] }) }]);
  const out = await seedMemory({ url: fake.url, model, cwd: where.repo, home: where.home, sessionsDir, record: [{ name: 'The 28 practice tasks', result: 'pass', passed: 28, total: 28 }], today: '2026-09-26' });
  expect(out.added.map((f) => [f.kind, f.from])).toEqual([['you', 'what was done here before'], ['worked', 'what was done here before']]);
  expect(JSON.stringify(fake.requests[0])).toContain('What was done here before Agentic Coder had a memory');
  expect(readState(where.project).seeded).toBe('2026-09-26');
  // once: the second start reads nothing and asks nothing
  expect(await seedMemory({ url: fake.url, model, cwd: where.repo, home: where.home, sessionsDir, today: '2026-09-27' })).toBe(null);
  await fake.close();
  expect(fake.requests).toHaveLength(1);
});

test('a turn that taught nothing new starts no save: it went well on what the memory already held', () => {
  const where = place();
  applyChanges(where.project, { add: [{ kind: 'worked', text: 'Worked: lowering the legend in legend.js showed the symbol list.', from: fromTask('the symbol list is hidden behind the legend, fix it') }] });
  const at = { cwd: where.repo, home: where.home };
  const used = [{ id: 'x', dir: where.project, text: 'a fact' }];
  // a saved fact was used and the task passed: known
  expect(knownAlready({ ...passed, tries: [], recalled: used }, at)).toBe(true);
  // no fact was used, but a fact was saved from this very request before: known
  expect(knownAlready({ ...passed, tries: [] }, at)).toBe(true);
  expect(knownAlready(turn({ request: 'a request the memory never saw', outcome: 'passed' }), at)).toBe(false);
  // anything that went wrong on the way is worth a save, whatever was used
  expect(knownAlready({ ...passed, recalled: used }, at)).toBe(false); // its tries failed twice before one passed
  expect(knownAlready({ ...stuck, recalled: used }, at)).toBe(false);
  expect(knownAlready(turn({ outcome: 'failed', recalled: used }), at)).toBe(false);
  expect(knownAlready(turn({ outcome: 'passed', recalled: used, corrected: 'no, wrong file' }), at)).toBe(false);
  expect(knownAlready(turn({ outcome: 'done', recalled: used, request: 'from now on explain things simply' }), at)).toBe(false);
  // and such a turn is not worth a save
  expect(worthSaving([{ ...passed, known: true }])).toBe(false);
  expect(worthSaving([{ ...passed, known: true }, { ...passed }])).toBe(true);
});

test('an instruction about this one task is not the user saying how they like things done', () => {
  for (const t of ["Which port does this project's server listen on, and where is that set? Don't change any files.", 'explain the export, no code changes', 'fix the bug but do not touch the tests', 'make sure the tests pass', 'add a flag without changing the output']) expect([t, saysHow(t)]).toEqual([t, false]);
  for (const t of ['always run the tests before you say done', 'from now on, explain simply', "don't ask me so many questions", 'I prefer tabs', 'never use rm -rf', 'next time show me the diff first', 'please stop using emojis']) expect([t, saysHow(t)]).toEqual([t, true]);
});
