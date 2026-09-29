// Add or change code, test first: find the file, have the model write a test
// that defines "done" (it must fail on today's code), let you approve it,
// then try versions in the scratch copy until every test passes.
// A project without tests gets a throwaway check instead, kept out of your project.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { Scratch } from './scratch.mjs';
import { readResults, failureDigest, assertionDetail } from './results.mjs';
import { projectFiles, filesInText, pickFile, isTestFile, testsFor, relatedData } from './localize.mjs';
import { WHOLE_FILE_MAX, SHOW_WHOLE_MAX, findFunction, functionNames, isWholeFile, splice, langFor } from './units.mjs';
import { tryUntilPass } from './tries.mjs';
import { complete, fence, SETUP_THINK_CAP } from './llm.mjs';
import { mergeTest } from './testfile.mjs';
import { testWriter, CODE_SYSTEM, stem } from './testfirst.mjs';
import { rescueTests } from './rescue.mjs';
import { applyChange } from './apply.mjs';
import { guardChange } from './blocks.mjs';
import { diffLines } from '../tools/edit.mjs';
import { syntaxError } from '../agent/tools.mjs';

// For source files: no tests or example calls inside them (they run on import).
const SOURCE_ONLY = ' Source code only: no tests, asserts or example calls in the file.';

// Where the new test goes: the source's own test file, a new one beside it,
// or (no tests in the project) a throwaway check in the scratch copy only.
export function testPlan(cwd, target, files, testCmd) {
  const lang = langFor(target);
  const existing = testsFor(cwd, target, files)[0];
  if (testCmd && existing) return { rel: existing, lang, throwaway: false, cmd: testCmd };
  const js = lang === 'js';
  const ext = target.split('.').pop();
  const name = js ? `${stem(target)}.test.${ext === 'ts' || ext === 'tsx' ? ext : 'mjs'}` : `test_${stem(target)}.py`;
  const rel = join(dirname(target), name);
  if (testCmd) return { rel, lang, throwaway: false, cmd: testCmd, created: true };
  // No test setup: a scratch-only check run directly.
  const check = js ? join(dirname(target), 'agentic-check.test.mjs') : join(dirname(target), 'agentic_check.py');
  return { rel: check, lang, throwaway: true, created: true, cmd: js ? `node --test ${check}` : `python3 ${check}` };
}

// No draft passed any of the new tests written for the task, not even with
// the project's older tests left aside: the new tests, not the drafts, are
// probably wrong. (Drafts that pass a new test but break an older one mean
// the older test is stale: the rescue round handles that, so no doubt then.)
// The reason to give up the test-first way, or null.
export function distrustTests(candidates, versions) {
  if (!versions.length || !candidates.length || candidates.some((c) => c.passing?.length || c.passingNew)) return null;
  return `none of the ${versions.length} drafts passed any of the ${candidates.length} tests written for it, so the tests are probably wrong`;
}

// The tests a candidate file adds: test('…') / it('…') in JavaScript, def test_… in Python.
export function newTestNames(text, original = '') {
  const names = (t) => new Set([...t.matchAll(/\b(?:test|it)\s*\(\s*(['"`])(.+?)\1/g)].map((m) => m[2]).concat([...t.matchAll(/\bdef\s+(test_\w+)/g)].map((m) => m[1])));
  const old = names(original);
  return [...names(text)].filter((n) => !old.has(n));
}

// Did the candidate's own new test pass (older tests left aside)? Unknown
// counts as no: a run that did not load, or failures that cannot be named.
export function newTestPassed(rs, fresh, throwaway) {
  if (throwaway || rs[0].ok) return rs[0].ok;
  const failing = rs.flatMap((r) => r.failing);
  return rs[0].total !== null && fresh.length > 0 && failing.length > 0 && !failing.some((f) => fresh.some((n) => f.includes(n)));
}

// hint: the file the planner (src/flows/multi.mjs) already chose, if any.
export async function changeFlow(ctx, task, { hint } = {}) {
  // What the memory holds about this request goes with every draft and try.
  const known = ctx.memory ? `\n\n(${ctx.memory})` : '';
  const { cwd, testCmd } = ctx;
  const plan = ctx.plan(['Find the code', 'Write a test that defines "done"', 'Your OK on the test', `Try changes (up to ${ctx.maxTries})`, 'Apply the change']);
  plan.step(0);
  const files = projectFiles(cwd);
  const named = filesInText(cwd, task).filter((f) => !isTestFile(f) && langFor(f));
  const target = named[0] ?? hint ?? await pickFile({ url: ctx.url, model: ctx.model, slot: ctx.slot, cwd, task, files, signal: ctx.signal , embedder: ctx.embedder });
  if (!target || !langFor(target)) return { handled: false, why: 'could not tell which file to change' };
  const lang = langFor(target);
  const original = readFileSync(join(cwd, target), 'utf8');
  ctx.tool('Read', target, { kind: 'read', lines: original.split('\n').length, total: original.split('\n').length, content: original });

  // Big file: the model picks the function to change, or NEW for a new one.
  let unit = null;
  if (original.split('\n').length > WHOLE_FILE_MAX) {
    const names = functionNames(original, lang);
    const r = await complete({ url: ctx.url, model: ctx.model, slot: ctx.slot, signal: ctx.signal, temperature: 0, maxTokens: 60,
      system: 'You choose which function a task changes.',
      user: `Task: ${task}\nFunctions in ${target}: ${names.join(', ')}\nWhich function must change? Answer NEW if the task needs a new function.`,
      schema: { type: 'object', properties: { function: { type: 'string', enum: [...names, 'NEW'] } }, required: ['function'] } });
    const f = r.json?.function;
    if (!f) return { handled: false, why: 'could not tell which function to change' };
    unit = f === 'NEW' ? { name: null, start: original.split('\n').length, end: original.split('\n').length - 1, isNew: true } : { name: f, ...findFunction(original, f, lang) };
    if (!unit.isNew && unit.start === undefined) return { handled: false, why: `could not find ${f} in ${target}` };
  }

  const tp = testPlan(cwd, target, files, testCmd);
  // Side slots of the model server: one is the usual; two let tests and
  // drafts be written at the same time (see parallel below).
  const [slotA, slotB] = ctx.sideSlots?.length > 1 ? ctx.sideSlots : [ctx.slot, undefined];
  const parallel = slotB !== undefined;
  const scratch = new Scratch(cwd);
  try {
    const baseRun = testCmd && !tp.throwaway ? await scratch.run(testCmd, { signal: ctx.signal }) : null;
    const base = baseRun ? readResults(baseRun.out, baseRun.code) : { ok: true, passed: 0, failed: 0, total: 0, failing: [] };
    const testOriginal = tp.created ? '' : readFileSync(join(cwd, tp.rel), 'utf8');

    // 1. The test that defines "done".
    plan.step(1);
    // The model reads the whole file up to SHOW_WHOLE_MAX lines, even when it
    // only writes one function; past that, just the function (or the top).
    const showAll = original.split('\n').length <= SHOW_WHOLE_MAX;
    const shownSource = showAll ? original : unit && !unit.isNew ? original.split('\n').slice(unit.start, unit.end + 1).join('\n') : `${original.split('\n').slice(0, 60).join('\n')}\n…`;
    const shownLabel = !showAll && unit && !unit.isNew ? `${target} (function ${unit.name})` : target;
    const focus = !unit ? '' : unit.isNew ? `\nThe new function(s) will be added at the end of ${target}.` : `\nOnly the function ${unit.name} (lines ${unit.start + 1}-${unit.end + 1}) needs to change.`;
    const data = relatedData(cwd, [original, testOriginal]).map((d) => fence(d.rel, d.text)).join('\n\n');
    const dataBlock = data ? `\n\nData files it uses:\n${data}` : '';
    // Candidate tests: each must fail on today's code for the right reason.
    const tw = testWriter({ ctx, scratch, tp, task, lang, sources: [{ rel: target, label: shownLabel, text: shownSource }], dataBlock, base, slot: slotA });
    const { candidates } = tw;
    const writeTests = (want, max, label, extra) => tw.writeTests(want, max, label, extra, (fileText, code) => mergeTest(fileText, code, lang));

    // Versions of the code written from the task alone (no test shown); a
    // test that none of them passes probably asks for more than the task.
    const want = unit ? (unit.isNew ? 'only the new function(s), complete' : `the complete new version of the function ${unit.name}`) : `the complete new ${target}`;
    const build = (code) => {
      if (!unit || isWholeFile(code, original, unit.isNew ? null : unit.name, lang)) return code;
      return unit.isNew ? `${original.replace(/\n*$/, '\n')}\n${code.replace(/\n*$/, '\n')}` : splice(original, unit, code);
    };
    const versions = [];
    const draftVersions = (n, slot) => tryUntilPass(ctx, {
      label: 'Drafting versions', max: n, want: n, system: CODE_SYSTEM, temperature: 0.7, slot, from: versions.length + 1, thinkCap: SETUP_THINK_CAP,
      prompt: `${fence(shownLabel, shownSource)}${focus}${dataBlock}\n\nTask: ${task}${known}\n\nReply with ${want}.${SOURCE_ONLY}`,
      // A draft that removes functions the task keeps is no draft (practice task 14).
      apply: (code) => { const text = build(code); const g = guardChange(target, original, text, task); if (g) return { error: g }; return { files: [{ abs: join(scratch.dir, target), text }], text, code, undo: () => {} }; },
      check: async (applied) => { versions.push(applied); return { ok: true, summary: 'drafted' }; },
    });
    // Round one: two tests and two drafts. Writing is the slow part (about 10
    // tokens a second), so more are written only when these disagree. With a
    // second side slot the tests and the drafts are written at the same time.
    const testTry = parallel ? (await Promise.all([writeTests(2, 3), draftVersions(2, slotB)]))[0] : await writeTests(2, 3);
    if (!candidates.length) return { handled: false, why: `could not write a good test for this task (${testTry.best?.why ?? 'no usable test'})` };
    if (!parallel) await draftVersions(2, slotA);
    // Score each test: how many drafts pass it (together with the old tests).
    const runAll = async () => {
      const runs = [await scratch.run(tp.cmd, { signal: ctx.signal })];
      if (!tp.throwaway && tp.cmd !== testCmd && testCmd) runs.push(await scratch.run(testCmd, { signal: ctx.signal }));
      if (tp.throwaway && testCmd) runs.push(await scratch.run(testCmd, { signal: ctx.signal }));
      return runs.map((r) => readResults(r.out, r.code));
    };
    let chosen = null;
    const score = async (list) => {
    for (const c of list) {
      const passing = [];
      const fresh = newTestNames(c.text, testOriginal);
      c.passingNew = 0;
      for (const v of versions) {
        scratch.write(tp.rel, c.text);
        scratch.write(target, v.text);
        const rs = await runAll();
        const kept = tp.throwaway || tp.created || rs[0].total === null || rs[0].total > base.total;
        if (rs.every((r) => r.ok) && kept) passing.push(v);
        if (newTestPassed(rs, fresh, tp.throwaway)) c.passingNew++;
        scratch.restore(target);
        scratch.restore(tp.rel);
      }
      c.passing = passing;
      if (!chosen || passing.length > chosen.passing.length) chosen = c;
    }
    };
    await score(candidates);
    // They agree when every draft passes the chosen test and every test is
    // passed by some draft. Otherwise one more test and two more drafts.
    const agree = () => chosen && chosen.passing.length === versions.length && candidates.every((c) => c.passing.length);
    if (!agree() && !ctx.signal?.aborted) {
      if (parallel) await Promise.all([writeTests(1, 2), draftVersions(2, slotB)]);
      else { await writeTests(1, 2); await draftVersions(2, slotA); }
      chosen = null;
      await score(candidates);
    }
    // No draft passes any test: the tests probably ask for more than the
    // task. One more round of tests, told so.
    if (!chosen.passing.length && versions.length) {
      const before = candidates.length;
      await writeTests(2, 4, 'Writing simpler tests', '\n\nEarlier tests were too strict: they checked things the task does not ask for. Keep to exactly what the task says.');
      await score(candidates.slice(before));
    }
    ctx.emit('tries-done', { label: 'Checked tests against drafts', marks: candidates.map((c) => (c.passing.length ? '✓' : '✗')), summary: `${candidates.length} test${candidates.length === 1 ? '' : 's'}, ${versions.length} draft${versions.length === 1 ? '' : 's'}; the chosen test is passed by ${chosen.passing.length}`, secs: 0 });
    // The guard: no draft passes any of its tests, so the tests are probably
    // what is wrong. Fitting the code to one of them is how practice task 1
    // failed twice (a test expecting 2 rows of 3, then code that returned the
    // first two rows). Step by step works on the real files instead.
    const doubt = distrustTests(candidates, versions);
    if (doubt) return { handled: false, why: doubt };
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
    let result = chosen.passing.length ? { ok: true, code: chosen.passing[0].code, marks: ['✓'] } : await tryUntilPass(ctx, {
      label: 'Trying changes', max: ctx.maxTries, system: CODE_SYSTEM,
      prompt: ({ last }) => `Task: ${task}${known}\n\nThis test describes it and fails today:\n${digest}\n\n${fence(tp.rel, testText)}\n\n${fence(shownLabel, shownSource)}${focus}${dataBlock}\n\nChange ${target} so that every test passes (do not change the tests). Reply with ${want}.${SOURCE_ONLY}${last ? `\n\nYour previous try was wrong. It was:\n\`\`\`\n${last.code.slice(0, 2500)}\n\`\`\`\nand the tests still failed:\n${last.detail || last.why}\nDo something different this time.` : ''}`,
      apply: (code) => {
        const text = build(code);
        const g = guardChange(target, original, text, task);
        if (g) return { error: g };
        scratch.write(target, text);
        return { files: [{ abs: join(scratch.dir, target), text }], undo: () => scratch.restore(target), text };
      },
      check: async () => {
        const rs = await runAll();
        const kept = tp.throwaway || tp.created || rs[0].total === null || rs[0].total > base.total;
        const ok = rs.every((r) => r.ok) && kept;
        const failing = rs.flatMap((r) => r.failing);
        return { ok, score: rs.reduce((s, r) => s + (r.passed ?? 0), 0), why: failing.length ? `still failing: ${failing.slice(0, 3).join('; ')}` : 'the tests still fail', detail: '', summary: `passes ${tp.throwaway ? 'the check' : 'every test'}` };
      },
    });
    if (!result.ok && unit) {
      // Writing only one function was not enough: the change probably needs
      // more than one place, which the step-by-step way can do.
      return { handled: false, why: `none of the ${result.marks.length} tries that ${unit.isNew ? 'only added a new function' : `changed only ${unit.name}`} passed the test${result.best?.why ? ` (the closest: ${result.best.why})` : ''}` };
    }
    // Often the existing tests are what fail (a new field changes an expected
    // value). When the best try passes its new test and only old tests fail,
    // one rescue round may update those stale tests — each edit still asks you.
    let rescue = null;
    if (!result.ok && result.best?.code && !tp.throwaway && testCmd && !ctx.signal?.aborted) {
      rescue = await rescueTests(ctx, { scratch, task, tp, testText, testOriginal, files,
        cmds: [...new Set([tp.cmd, testCmd].filter(Boolean))],
        applyBest: () => { scratch.write(tp.rel, testText); scratch.write(target, build(result.best.code)); return () => { scratch.restore(target); scratch.restore(tp.rel); }; } });
      if (rescue.ok) result = { ok: true, code: result.best.code, marks: result.marks };
    }
    if (!result.ok) {
      return { handled: false, why: `none of the ${result.marks.length} tries passed the test${result.best?.why ? ` (the closest: ${result.best.why})` : ''}` };
    }

    // 4. Apply: the source change (asks, as usual), the approved test, and
    // any rescued test files (each asks too).
    plan.step(4);
    const after = build(result.code);
    const changes = [{ rel: target, before: original, after }];
    if (rescue?.ok) for (const [rel, text] of rescue.texts) changes.push({ rel, before: existsSync(join(cwd, rel)) ? readFileSync(join(cwd, rel), 'utf8') : null, after: text });
    const applied = await applyChange(ctx, changes);
    if (!applied.ok) return { handled: true, done: false, declined: true, summary: 'You said no to the change; nothing was changed.' };
    if (!tp.throwaway && !rescue?.texts?.has(tp.rel)) {
      // Already approved as the test; written without asking again. (A rescued
      // tp.rel was already written by applyChange, with your OK on the diff.)
      const { writeFileSync, mkdirSync } = await import('node:fs');
      mkdirSync(dirname(join(cwd, tp.rel)), { recursive: true });
      writeFileSync(join(cwd, tp.rel), testText);
    }
    const final = testCmd ? await ctx.runReal(testCmd) : { ok: true };
    plan.done();
    return { handled: true, done: final.ok, summary: `${ctx.describe ? await ctx.describe(target, original, after) : ''}Changed ${target}${tp.throwaway ? ' (checked with a throwaway test, not added to your project)' : ` and added a test to ${tp.rel}`}${rescue?.ok ? `; updated stale expected values in ${[...rescue.texts.keys()].join(', ')} (approved)` : ''}${testCmd ? (final.ok ? `; all ${final.total ?? ''} tests pass`.replace('  ', ' ') : '; but the tests fail in your project, see above') : ''}.` };
  } finally {
    scratch.dispose();
  }
}
