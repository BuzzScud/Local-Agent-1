// Fix: run the tests, find the code the failure points at, try corrected
// versions in the scratch copy until the tests pass, then show the diff.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Scratch } from './scratch.mjs';
import { readResults, failureDigest, assertionDetail } from './results.mjs';
import { projectFiles, sourcesFromFailure, filesInText, pickFile, isTestFile } from './localize.mjs';
import { WHOLE_FILE_MAX, SHOW_WHOLE_MAX, functionNames, functionAtLine, findFunction, isWholeFile, splice, langFor } from './units.mjs';
import { tryUntilPass } from './tries.mjs';
import { fence, complete } from './llm.mjs';
import { applyChange } from './apply.mjs';

const SYSTEM = 'You are an expert programmer fixing a bug. Reply with only the requested code in one fenced code block, nothing else.';

export async function fixFlow(ctx, task) {
  const { cwd, testCmd } = ctx;
  if (!testCmd) return { handled: false, why: 'no test command' };
  const plan = ctx.plan(['Run the tests', 'Find the code', `Try fixes (up to ${ctx.maxTries})`, 'Apply the fix']);
  const scratch = new Scratch(cwd);
  try {
    plan.step(0);
    const base = await scratch.run(testCmd, { signal: ctx.signal });
    const baseRes = readResults(base.out, base.code);
    ctx.tool('Bash', testCmd, { kind: 'bash', code: base.code, lines: base.out.trimEnd().split('\n').slice(-40), ms: base.ms }, !baseRes.ok);
    // Nothing fails: the bug is not covered by a test, so reproduce it first.
    if (baseRes.ok) return { handled: false, why: 'tests pass', next: 'change' };

    plan.step(1);
    const files = projectFiles(cwd);
    const { sources, tests } = sourcesFromFailure(cwd, base.out, files);
    const named = filesInText(cwd, task).filter((f) => !isTestFile(f));
    let target = named[0] ?? sources[0] ?? await pickFile({ url: ctx.url, model: ctx.model, slot: ctx.slot, cwd, task, files, signal: ctx.signal });
    if (!target || !langFor(target)) return { handled: false, why: 'could not tell which file to fix' };
    const original = readFileSync(join(cwd, target), 'utf8');
    ctx.tool('Read', target, { kind: 'read', lines: original.split('\n').length, total: original.split('\n').length, content: original });

    // Whole file when small; otherwise one function: the one the failure
    // points at, or the one the model picks from the file's functions.
    const lang = langFor(target);
    const lineCount = original.split('\n').length;
    let unit = null;
    if (lineCount > WHOLE_FILE_MAX) {
      const line = Number(new RegExp(`${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`).exec(base.out)?.[1] ?? 0);
      unit = line ? functionAtLine(original, line, lang) : null;
      if (!unit) unit = await pickFunction(ctx, { target, original, lang, task, digest: failureDigest(base.out) });
      if (!unit && lineCount > SHOW_WHOLE_MAX) return { handled: false, why: `${target} is big and the failure does not point inside a function` };
    }
    // The model reads the whole file up to SHOW_WHOLE_MAX lines, even when it
    // only rewrites one function.
    const showAll = !unit || lineCount <= SHOW_WHOLE_MAX;
    const shown = showAll ? original : original.split('\n').slice(unit.start, unit.end + 1).join('\n');
    const focus = unit ? `\nOnly the function ${unit.name} (lines ${unit.start + 1}-${unit.end + 1}) needs to change.` : '';
    const merge = (code) => (unit && !isWholeFile(code, original, unit.name, lang) ? splice(original, unit, code) : code);
    const testText = tests.slice(0, 2).map((t) => fence(t, readFileSync(join(cwd, t), 'utf8').slice(0, 6000))).join('\n\n');
    const digest = failureDigest(base.out);
    const want = unit ? `the complete corrected function ${unit.name}` : `the complete corrected ${target}`;

    plan.step(2);
    const result = await tryUntilPass(ctx, {
      label: 'Trying fixes',
      max: ctx.maxTries,
      system: SYSTEM,
      prompt: ({ last }) => `The tests fail:\n${digest}\n\n${testText}\n\n${fence(showAll ? target : `${target} (function ${unit.name})`, shown)}${focus}\n\nTask: ${task}\nFix the bug in ${target} (do not change the tests). Reply with ${want}.${last ? `\n\nYour previous try was wrong. It was:\n\`\`\`\n${last.code.slice(0, 2500)}\n\`\`\`\nand the tests still failed:\n${last.detail || last.why}\nDo something different this time.` : ''}`,
      apply: (code) => {
        const text = merge(code);
        scratch.write(target, text);
        return { files: [{ abs: join(scratch.dir, target), text }], undo: () => scratch.restore(target), text };
      },
      check: async () => {
        const run = await scratch.run(testCmd, { signal: ctx.signal });
        const r = readResults(run.out, run.code);
        const ok = r.ok && (baseRes.total === null || r.total === null || r.total >= baseRes.total);
        return { ok, score: r.passed ?? 0, why: r.failing.length ? `still failing: ${r.failing.slice(0, 3).join('; ')}` : 'tests still fail', detail: assertionDetail(run.out), out: run.out, summary: `passes all ${r.total ?? ''} tests`.replace('  ', ' ') };
      },
    });
    if (!result.ok && unit) {
      // Rewriting only one function was not enough: the fix probably needs
      // more than one place, which the step-by-step way can do.
      return { handled: false, why: `none of the ${result.marks.length} tries that changed only ${unit.name} made the tests pass${result.best?.why ? ` (the closest: ${result.best.why})` : ''}` };
    }
    if (!result.ok) {
      ctx.note(`None of the ${result.marks.length} tries made the tests pass${result.best?.why ? ` (the closest: ${result.best.why})` : ''}. Nothing was changed. Try describing the bug in more detail.`, 'warn');
      return { handled: true, done: false, summary: 'I could not find a fix that makes the tests pass; nothing was changed.' };
    }

    plan.step(3);
    const after = merge(result.code);
    const applied = await applyChange(ctx, [{ rel: target, before: original, after }]);
    if (!applied.ok) return { handled: true, done: false, declined: true, summary: 'You said no to the fix; nothing was changed.' };
    const final = await ctx.runReal(testCmd);
    plan.done();
    return { handled: true, done: final.ok, summary: `${ctx.describe ? await ctx.describe(target, original, after) : ''}Fixed ${target}${final.ok ? `; all ${final.total ?? ''} tests pass`.replace('  ', ' ') : '; but the tests fail in your project, see above'}.` };
  } finally {
    scratch.dispose();
  }
}

// The failure does not point inside a function: the model picks the one to fix.
async function pickFunction(ctx, { target, original, lang, task, digest }) {
  const names = functionNames(original, lang);
  if (!names.length) return null;
  const r = await complete({ url: ctx.url, model: ctx.model, slot: ctx.slot, signal: ctx.signal, temperature: 0, maxTokens: 60,
    system: 'You choose which function has the bug.',
    user: `The tests fail:\n${digest}\n\nTask: ${task}\nFunctions in ${target}: ${names.join(', ')}\nWhich function has the bug?`,
    schema: { type: 'object', properties: { function: { type: 'string', enum: names } }, required: ['function'] } });
  const f = r.json?.function;
  const range = f ? findFunction(original, f, lang) : null;
  return range ? { name: f, ...range } : null;
}
