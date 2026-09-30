// Changing several files at once (an option used in three files, a new
// argument and its callers): the files are planned, a test that defines
// "done" is written and approved (src/flows/testfirst.mjs), then drafts and
// tries describe their changes as edit blocks (src/flows/blocks.mjs) across
// all the files in the scratch copy. Whole files are never rewritten.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Scratch } from './scratch.mjs';
import { readResults, failureDigest } from './results.mjs';
import { projectFiles, filesInText, fileHints, isTestFile, relatedData, testsFor } from './localize.mjs';
import { SHOW_WHOLE_MAX, langFor } from './units.mjs';
import { tryUntilPass } from './tries.mjs';
import { complete, fence, SETUP_THINK_CAP } from './llm.mjs';
import { mergeTest } from './testfile.mjs';
import { testWriter, CODE_SYSTEM } from './testfirst.mjs';
import { rescueTests } from './rescue.mjs';
import { testPlan, distrustTests, newTestNames, newTestPassed } from './change.mjs';
import { applyChange } from './apply.mjs';
import { diffLines } from '../tools/edit.mjs';
import { BLOCKS_FORMAT, parseBlocks, applyBlocks, guardChange } from './blocks.mjs';

const SOURCE_ONLY = ' Source code only: no tests, asserts or example calls in the source files.';
export const MAX_FILES = 4;

// Which files a change touches: the files named in the request, or the
// model's pick from the project map (one to four, the main one first).
export async function planFiles(ctx, task, files) {
  const named = filesInText(ctx.cwd, task).filter((f) => !isTestFile(f) && langFor(f));
  if (named.length) return [...new Set(named)];
  const { code, text } = fileHints(ctx.cwd, task, files);
  if (!code.length) return [];
  if (code.length === 1) return code;
  const r = await complete({ instructions: ctx.instructions, url: ctx.url, model: ctx.model, slot: ctx.slot, signal: ctx.signal, temperature: 0, maxTokens: 160,
    system: 'You choose which files in a project a task changes.',
    user: `Task: ${task}\n\nFiles:\n${text}\n\nWhich files must change to do this task? List every file that needs a change (1 to ${MAX_FILES}), the main one first. A new function goes in the file it belongs with.`,
    schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string', enum: code }, minItems: 1, maxItems: MAX_FILES } }, required: ['files'] } });
  return [...new Set(r.json?.files ?? [])].filter((f) => code.includes(f)).slice(0, MAX_FILES);
}

export async function multiFlow(ctx, task, targets) {
  // What the memory holds about this request goes with every draft and try.
  const known = ctx.memory ? `\n\n(${ctx.memory})` : '';
  const { cwd, testCmd } = ctx;
  const lang = langFor(targets[0]);
  if (!lang || !targets.every((t) => langFor(t) === lang)) return { handled: false, why: 'the files are not all the same language' };
  const plan = ctx.plan([`Read ${targets.length} files`, 'Write a test that defines "done"', 'Your OK on the test', `Try changes (up to ${ctx.maxTries})`, 'Apply the changes']);
  plan.step(0);
  const files = projectFiles(cwd);
  const sources = [];
  for (const rel of targets) {
    const text = readFileSync(join(cwd, rel), 'utf8');
    const lines = text.split('\n').length;
    ctx.tool('Read', rel, { kind: 'read', lines, total: lines, content: text });
    // The tries copy exact lines from what they see, so every file is shown whole.
    if (lines > SHOW_WHOLE_MAX) return { handled: false, why: `${rel} is over ${SHOW_WHOLE_MAX} lines` };
    sources.push({ rel, text });
  }
  // The new test goes with the first of the files that already has tests (else the first file).
  const tp = testPlan(cwd, targets.find((t) => testsFor(cwd, t, files).length) ?? targets[0], files, testCmd);
  const [slotA, slotB] = ctx.sideSlots?.length > 1 ? ctx.sideSlots : [ctx.slot, undefined];
  const parallel = slotB !== undefined;
  const scratch = new Scratch(cwd);
  try {
    const baseRun = testCmd && !tp.throwaway ? await scratch.run(testCmd, { signal: ctx.signal }) : null;
    const base = baseRun ? readResults(baseRun.out, baseRun.code) : { ok: true, passed: 0, failed: 0, total: 0, failing: [] };

    // 1. The test that defines "done".
    plan.step(1);
    const data = relatedData(cwd, sources.map((s) => s.text)).map((d) => fence(d.rel, d.text)).join('\n\n');
    const dataBlock = data ? `\n\nData files they use:\n${data}` : '';
    const tw = testWriter({ ctx, scratch, tp, task, lang, sources, dataBlock, base, slot: slotA });
    const { candidates, testOriginal } = tw;
    const writeTests = (want, max, label, extra, opts) => tw.writeTests(want, max, label, extra, (fileText, code) => mergeTest(fileText, code, lang), opts);

    // Drafts from the task alone: edit blocks over the files, applied to
    // their texts (nothing written until a draft is checked).
    const shownAll = sources.map((s) => fence(s.rel, s.text)).join('\n\n');
    const versions = [];
    // Only the planned files (and files the task names) may change; nothing
    // is quietly removed. (A draft once added a stray test.mjs on the side.)
    const allowed = new Set([...targets, ...filesInText(cwd, task)]);
    const namedNew = new Set((task.match(/[\w./-]+\.[A-Za-z]{1,5}\b/g) ?? []).map((f) => f.replace(/^\.\//, '')));
    const isTest = (rel) => isTestFile(rel) || /(^|\/)tests?\.[mc]?[jt]sx?$/.test(rel);
    const fromBlocks = (reply) => {
      // The test is written in its own step. A reply that also touches the
      // tests keeps its changes to the source: a request that says "add a
      // test for it" made every draft touch the test file, all of them were
      // thrown away whole, and with no draft to compare the tests against a
      // broken test was picked (practice task 28, 1 run in 5).
      const all = parseBlocks(reply);
      const blocks = all.filter((b) => !isTest(b.path));
      if (all.length && !blocks.length) return { error: 'the reply changed only the tests; the source files must change' };
      const r = applyBlocks(blocks, (rel) => scratch.read(rel));
      if (r.error) return { error: r.error };
      for (const [rel, text] of r.files) {
        if (!allowed.has(rel) && !namedNew.has(rel)) return { error: `${rel} is not one of the files to change (${targets.join(', ')})` };
        const g = guardChange(rel, scratch.read(rel), text, task);
        if (g) return { error: g };
      }
      return { files: [...r.files].map(([rel, text]) => ({ abs: scratch.path(rel), text })), texts: r.files, code: reply, undo: () => {} };
    };
    const writeTexts = (texts) => { for (const [rel, text] of texts) scratch.write(rel, text); };
    const restoreTexts = (texts) => { for (const rel of texts.keys()) scratch.restore(rel); };
    const draftVersions = (n, slot, thinkFirst = true) => tryUntilPass(ctx, {
      label: 'Drafting changes', max: n, want: n, system: CODE_SYSTEM, temperature: 0.7, slot, from: versions.length + 1, maxTokens: 3000, raw: true, thinkCap: SETUP_THINK_CAP, thinkFirst,
      prompt: `${shownAll}${dataBlock}\n\nTask: ${task}${known}\n\n${BLOCKS_FORMAT}${SOURCE_ONLY}`,
      apply: fromBlocks,
      check: async (applied) => { versions.push(applied); return { ok: true, summary: 'drafted' }; },
    });
    // Round one: two tests and two drafts; more only when they disagree.
    // Think when it pays (llm.mjs): round one is written without thinking; a miss, or the round
    // after a disagreement, thinks.
    const first = { thinkFirst: false };
    const testTry = parallel ? (await Promise.all([writeTests(2, 3, undefined, undefined, first), draftVersions(2, slotB, false)]))[0] : await writeTests(2, 3, undefined, undefined, first);
    if (!candidates.length) return { handled: false, why: `could not write a good test for this task (${testTry.best?.why ?? 'no usable test'})` };
    if (!parallel) await draftVersions(2, slotA, false);

    const runAll = async () => {
      const runs = [await scratch.run(tp.cmd, { signal: ctx.signal })];
      if (!tp.throwaway && tp.cmd !== testCmd && testCmd) runs.push(await scratch.run(testCmd, { signal: ctx.signal }));
      if (tp.throwaway && testCmd) runs.push(await scratch.run(testCmd, { signal: ctx.signal }));
      return runs.map((r) => readResults(r.out, r.code));
    };
    const kept = (rs) => tp.throwaway || tp.created || rs[0].total === null || rs[0].total > base.total;
    let chosen = null;
    const score = async (list) => {
      for (const c of list) {
        const passing = [];
        const fresh = newTestNames(c.text, testOriginal);
        c.passingNew = 0;
        for (const v of versions) {
          scratch.write(tp.rel, c.text);
          writeTexts(v.texts);
          const rs = await runAll();
          if (rs.every((r) => r.ok) && kept(rs)) passing.push(v);
          if (newTestPassed(rs, fresh, tp.throwaway)) c.passingNew++;
          restoreTexts(v.texts);
          scratch.restore(tp.rel);
        }
        c.passing = passing;
        if (!chosen || passing.length > chosen.passing.length) chosen = c;
      }
    };
    await score(candidates);
    const agree = () => chosen && chosen.passing.length === versions.length && candidates.every((c) => c.passing.length);
    if (!agree() && !ctx.signal?.aborted) {
      if (parallel) await Promise.all([writeTests(1, 2), draftVersions(2, slotB)]);
      else { await writeTests(1, 2); await draftVersions(2, slotA); }
      chosen = null;
      await score(candidates);
    }
    if (!chosen.passing.length && versions.length) {
      const before = candidates.length;
      await writeTests(2, 4, 'Writing simpler tests', '\n\nEarlier tests were too strict: they checked things the task does not ask for. Keep to exactly what the task says.');
      await score(candidates.slice(before));
    }
    ctx.emit('tries-done', { label: 'Checked tests against drafts', marks: candidates.map((c) => (c.passing.length ? '✓' : '✗')), summary: `${candidates.length} test${candidates.length === 1 ? '' : 's'}, ${versions.length} draft${versions.length === 1 ? '' : 's'}; the chosen test is passed by ${chosen.passing.length}`, secs: 0 });
    // The guard (see distrustTests): the tests are probably wrong. `tried`:
    // the one-file path would write the same kind of tests, so straight to step by step.
    const doubt = distrustTests(candidates, versions);
    if (doubt) return { handled: false, tried: true, why: doubt };
    const testText = chosen.text;

    // 2. Your OK on the test.
    plan.step(2);
    const d = diffLines(testOriginal, testText);
    const answer = await ctx.ask({ id: `test_${Date.now()}`, name: 'Test', args: { path: tp.rel }, prepared: { rel: tp.throwaway ? `${tp.rel} (a throwaway check, not added to your project)` : tp.rel, before: testOriginal, after: testText, ...d, created: tp.created }, label: 'Test', arg: tp.rel });
    if (answer.choice === 'no') {
      ctx.tool('Test', tp.rel, { kind: 'declined', feedback: answer.feedback }, true);
      return { handled: true, done: false, declined: true, summary: 'You did not approve the test, so nothing was changed. Say what the test should check instead.' };
    }
    ctx.tool('Test', tp.rel, { kind: 'diff', path: tp.throwaway ? `${tp.rel} (throwaway)` : tp.rel, created: tp.created, hunk: d.hunk, additions: d.additions, removals: d.removals, lines: testText.split('\n').length });

    // 3. A draft that already passes is the answer; otherwise tries against the test.
    plan.step(3);
    scratch.write(tp.rel, testText);
    const failRun = await scratch.run(tp.cmd, { signal: ctx.signal });
    const digest = failureDigest(failRun.out);
    let result = chosen.passing.length ? { ok: true, texts: chosen.passing[0].texts, marks: ['✓'] } : await tryUntilPass(ctx, {
      label: 'Trying changes', max: ctx.maxTries, system: CODE_SYSTEM, maxTokens: 3000, raw: true,
      prompt: ({ last }) => `Task: ${task}${known}\n\nThis test describes it and fails today:\n${digest}\n\n${fence(tp.rel, testText)}\n\n${shownAll}${dataBlock}\n\nChange the source files so that every test passes (do not change the tests). ${BLOCKS_FORMAT}${SOURCE_ONLY}${last ? `\n\nYour previous try was wrong. It was:\n${last.code.slice(0, 2500)}\nand the tests still failed:\n${last.detail || last.why}\nDo something different this time.` : ''}`,
      apply: (reply) => { const a = fromBlocks(reply); if (a.error) return a; writeTexts(a.texts); return { ...a, undo: () => restoreTexts(a.texts) }; },
      check: async () => {
        const rs = await runAll();
        const ok = rs.every((r) => r.ok) && kept(rs);
        const failing = rs.flatMap((r) => r.failing);
        return { ok, score: rs.reduce((s, r) => s + (r.passed ?? 0), 0), why: failing.length ? `still failing: ${failing.slice(0, 3).join('; ')}` : 'the tests still fail', detail: '', summary: `passes ${tp.throwaway ? 'the check' : 'every test'}` };
      },
    });
    // Often the existing tests are what fail (a new field changes an expected
    // value). When the best try passes its new test and only old tests fail,
    // one rescue round may update those stale tests — each edit still asks you.
    let rescue = null;
    if (!result.ok && result.best?.code && !tp.throwaway && testCmd && !ctx.signal?.aborted) {
      let bestApplied = null;
      rescue = await rescueTests(ctx, { scratch, task, tp, testText, testOriginal, files,
        cmds: [...new Set([tp.cmd, testCmd].filter(Boolean))],
        applyBest: () => { const a = fromBlocks(result.best.code); if (a.error) return null; bestApplied = a; writeTexts(a.texts); return () => restoreTexts(a.texts); } });
      if (rescue.ok) result = { ok: true, texts: bestApplied.texts, marks: result.marks };
    }
    if (!result.ok) {
      return { handled: false, tried: true, why: `none of the ${result.marks.length} tries passed the test${result.best?.why ? ` (the closest: ${result.best.why})` : ''}` };
    }

    // 4. Apply: every changed file (asks, as usual), the approved test, and
    // any rescued test files (each asks too).
    plan.step(4);
    const texts = new Map(result.applied?.texts ?? result.texts);
    if (rescue?.ok) for (const [rel, text] of rescue.texts) texts.set(rel, text);
    const changes = [...texts].map(([rel, after]) => ({ rel, before: existsSync(join(cwd, rel)) ? readFileSync(join(cwd, rel), 'utf8') : null, after })).filter((c) => c.before !== c.after);
    const applied = await applyChange(ctx, changes);
    if (!applied.ok) return { handled: true, done: false, declined: true, summary: 'You said no to the change; nothing was changed.' };
    if (!tp.throwaway && !rescue?.texts?.has(tp.rel)) {
      mkdirSync(dirname(join(cwd, tp.rel)), { recursive: true });
      writeFileSync(join(cwd, tp.rel), testText);
    }
    const final = testCmd ? await ctx.runReal(testCmd) : { ok: true };
    plan.done();
    const names = changes.map((c) => c.rel).join(', ');
    return { handled: true, done: final.ok, summary: `${ctx.describe && changes.length ? await ctx.describe(changes[0].rel, changes[0].before ?? '', changes[0].after) : ''}Changed ${names}${tp.throwaway ? ' (checked with a throwaway test, not added to your project)' : ` and added a test to ${tp.rel}`}${rescue?.ok ? `; updated stale expected values in ${[...rescue.texts.keys()].join(', ')} (approved)` : ''}${testCmd ? (final.ok ? `; all ${final.total ?? ''} tests pass`.replace('  ', ' ') : '; but the tests fail in your project, see above') : ''}.` };
  } finally {
    scratch.dispose();
  }
}
