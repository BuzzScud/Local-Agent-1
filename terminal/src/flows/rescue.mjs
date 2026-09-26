// When every try fails only because EXISTING tests expect the old behaviour
// (a new field changes an expected value — task 28's class), the flows used
// to give up to the slower step-by-step way, whose edits may touch tests.
// Now one more round does it here: the model updates only the stale expected
// values, in test files only. Guards: the approved new test must survive, no
// test may disappear (test counts may not drop), source files are off
// limits, and every edited test file still goes to you for an OK before
// anything is written to your project.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tryUntilPass } from './tries.mjs';
import { parseBlocks, applyBlocks, BLOCKS_FORMAT } from './blocks.mjs';
import { readResults, failureDigest, assertionDetail } from './results.mjs';
import { excerpts } from './excerpts.mjs';
import { isTestFile } from './localize.mjs';

// Test titles in a file: test('x') / it('x') / def test_x.
export function testTitles(text) {
  return [...new Set([...(text ?? '').matchAll(/(?:^|[^\w.])(?:test|it)\(\s*(["'`])(.+?)\1|^\s*def\s+(test_\w+)/gm)]
    .map((m) => m[2] ?? m[3]).filter(Boolean))];
}

// The rescue applies only when every failing test is an OLD one: the new,
// approved test passes (so the change does what the task asks), and only the
// old expectations are stale.
export function onlyOldTestsFail(failing, newTitles) {
  if (!failing.length) return false;
  return failing.every((f) => !newTitles.some((t) => f.includes(t) || t.includes(f)));
}

// ctx + { scratch, task, tp, testText, testOriginal, files, cmds, applyBest }.
// applyBest re-applies the best failed try (and the approved test) in the
// scratch copy and returns an undo, or null when it cannot.
// Returns { ok, texts } — texts: rel → new text of each edited test file,
// left applied in the scratch copy; on failure everything is undone.
export async function rescueTests(ctx, { scratch, task, tp, testText, testOriginal, files, cmds, applyBest }) {
  const undo = applyBest();
  if (!undo) return { ok: false };
  const giveUp = () => { undo(); return { ok: false }; };
  // What fails with the best change in place.
  const runs = [];
  for (const cmd of cmds) runs.push(await scratch.run(cmd, { signal: ctx.signal }));
  if (ctx.signal?.aborted) return giveUp();
  const rs = runs.map((r) => readResults(r.out, r.code));
  if (rs.every((r) => r.ok)) return giveUp(); // nothing failing after all
  const failing = [...new Set(rs.flatMap((r) => r.failing))];
  const newTitles = testTitles(testText).filter((t) => !testTitles(testOriginal).includes(t));
  if (!onlyOldTestsFail(failing, newTitles)) return giveUp();

  // The test files that hold the failing tests (match on the last name part:
  // runners print "suite > name").
  const names = failing.map((f) => f.split('>').pop().trim()).filter(Boolean);
  const testFiles = files.filter((rel) => isTestFile(rel) || rel === tp.rel).filter((rel) => {
    try { const t = readFileSync(join(scratch.dir, rel), 'utf8'); return names.some((n) => t.includes(n)); } catch { return false; }
  }).slice(0, 4);
  if (!testFiles.length) return giveUp();
  ctx.note?.('The change passes its new test; only existing tests expect the old behaviour. Updating those tests — each edit still needs your OK.', 'dim');

  const out = runs.map((r) => r.out).join('\n');
  const digest = `${failureDigest(out, 40)}\n${assertionDetail(out)}`.trim();
  const shown = excerpts(scratch.dir, testFiles, names, { around: 6, maxLines: 120 });
  const bestNote = 'The source change is already made and is right by its new test; do not repeat or undo it.';
  const result = await tryUntilPass(ctx, {
    label: 'Updating existing tests', max: 2, system: 'You update stale tests after a correct code change.', raw: true, maxTokens: 2000,
    prompt: ({ last }) => `Task: ${task}\n\n${bestNote}\nThese EXISTING tests still expect the old behaviour:\n${digest.slice(0, 2500)}\n\nThe failing tests (excerpts):\n${shown.text.slice(0, 6000)}\n\nUpdate ONLY the stale expected values in the test files shown, so they match what the task asks. Do not delete a test, do not weaken what a test checks beyond the task${newTitles.length ? `, do not change the new test ${newTitles.map((t) => `"${t}"`).join(', ')}` : ''}, and do not touch source files. ${BLOCKS_FORMAT}${last ? `\n\nYour previous try was wrong: ${last.why}` : ''}`,
    apply: (reply) => {
      const r = applyBlocks(parseBlocks(reply), (rel) => { try { return readFileSync(join(scratch.dir, rel), 'utf8'); } catch { return null; } });
      if (r.error) return { error: r.error };
      for (const [rel] of r.files) {
        if (!isTestFile(rel) && rel !== tp.rel) return { error: `${rel} is not a test file; only the stale tests may change here` };
        if (!existsSync(join(scratch.dir, rel))) return { error: `${rel} does not exist; only existing tests may be updated` };
      }
      const before = new Map([...r.files.keys()].map((rel) => [rel, readFileSync(join(scratch.dir, rel), 'utf8')]));
      for (const [rel, text] of r.files) scratch.write(rel, text);
      return { texts: r.files, files: [...r.files].map(([rel, text]) => ({ abs: scratch.path(rel), text })), undo: () => { for (const [rel, t] of before) scratch.write(rel, t); } };
    },
    check: async () => {
      const again = [];
      for (const cmd of cmds) again.push(await scratch.run(cmd, { signal: ctx.signal }));
      const rs2 = again.map((r) => readResults(r.out, r.code));
      const green = rs2.every((r) => r.ok);
      // No test may disappear: counts may not drop below the failing run's.
      const kept = rs2.every((r, i) => r.total === null || rs[i].total === null || r.total >= rs[i].total);
      let stillNew = true;
      try { const t = readFileSync(join(scratch.dir, tp.rel), 'utf8'); stillNew = newTitles.every((n) => t.includes(n)); } catch { stillNew = false; }
      const failing2 = rs2.flatMap((r) => r.failing);
      const why = !green ? `still failing: ${failing2.slice(0, 3).join('; ') || 'the tests still fail'}` : !kept ? 'a test disappeared' : 'the new test was removed';
      return { ok: green && kept && stillNew, why, summary: 'existing tests updated' };
    },
  });
  if (!result.ok) return giveUp();
  return { ok: true, texts: result.applied?.texts ?? result.texts };
}
