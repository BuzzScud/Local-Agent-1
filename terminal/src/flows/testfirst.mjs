// The test that defines "done", shared by the change path (one file) and
// the multi-file path: the model writes candidate tests; each must fail on
// today's code for the right reason (the behaviour is missing), not because
// the test itself is broken.
import { basename } from 'node:path';
import { readResults } from './results.mjs';
import { tryUntilPass } from './tries.mjs';
import { fence, SETUP_THINK_CAP } from './llm.mjs';

export const CODE_SYSTEM = 'You are an expert programmer. Reply with only the requested code in one fenced code block, nothing else.';
export const stem = (rel) => basename(rel).replace(/\.[^.]+$/, '');

// sources: [{ rel, text }] shown to the model (the first is the main file).
export function testWriter({ ctx, scratch, tp, task, lang, sources, dataBlock = '', base, slot }) {
  const main = sources[0].rel;
  const relImport = `./${basename(main)}`.replace(/\.ts$/, '.js');
  const others = sources.slice(1).map((s) => `'./${basename(s.rel)}'`.replace(/\.ts'$/, ".js'"));
  const shown = sources.map((s) => fence(s.label ?? s.rel, s.text)).join('\n\n');
  const testOriginal = tp.created ? '' : scratch.read(tp.rel) ?? '';
  const testAsk = tp.throwaway || tp.created
    ? `${shown}${dataBlock}\n\nTask: ${task}\n\nWrite a small test file for this task${lang === 'js' ? ` using node:test and node:assert/strict, importing from '${relImport}'${others.length ? ` (and ${others.join(', ')} if needed)` : ''}` : `, a plain Python script that imports from ${stem(main)}${others.length ? ` (and ${sources.slice(1).map((s) => stem(s.rel)).join(', ')} if needed)` : ''} and uses assert (it is run with python3)`}. It must check what the task asks for. Reply with the complete test file.`
    : `${shown}\n\n${fence(tp.rel, testOriginal)}${dataBlock}\n\nTask: ${task}\n\nWrite ONE new test for this task, in the style of the existing tests. Reply with only the new test (plus any import lines it needs); it is added to the end of ${tp.rel}.`;
  const api = lang === 'python'
    ? '\n\nUse plain Python assert statements only.'
    : '\n\nUse only these node:assert/strict functions: assert.equal, assert.deepEqual, assert.ok, assert.match, assert.throws, assert.rejects (there is no assert.include or assert.contains). To check JSON text, parse it with JSON.parse and compare with assert.deepEqual.';
  const coverage = `${api}\n\nCheck each thing the task asks for with its own assert (for example, if it says "lowercase the rest", include capitals in the middle of a word). Test only what the task asks; do not add requirements it does not mention.`;

  const candidates = [];
  let brokenTests = 0; // tests that could not even load the code
  const validateTest = async (text) => {
    scratch.write(tp.rel, text);
    const run = await scratch.run(tp.cmd, { signal: ctx.signal });
    scratch.restore(tp.rel);
    const r = readResults(run.out, run.code);
    // "Fails because the new thing does not exist yet" is the right kind of
    // failure too (the whole file fails to import). It must not fail because
    // the test itself is broken (assert.include(...), a name nobody
    // imported, a module that does not exist).
    const taskNames = new Set(task.match(/[A-Za-z_$][\w$]*/g) ?? []);
    const missing = lang === 'python' ? /cannot import name|has no attribute/.test(run.out) : /does not provide an export named/.test(run.out);
    const misuse = /\b(assert|expect|test|it|describe|t)\.[\w$]+ is not a function/.test(run.out);
    const undef = (lang === 'python' ? /NameError: name '([\w]+)' is not defined/ : /ReferenceError: ([\w$]+) is not defined/).exec(run.out);
    const crashed = misuse || (undef && !taskNames.has(undef[1])) || (!missing && /Cannot find module|ERR_MODULE_NOT_FOUND|ModuleNotFoundError/.test(run.out));
    const fails = !r.ok;
    const moreTests = tp.throwaway || tp.created || missing || r.total === null || r.total > base.total;
    const oldStillPass = tp.throwaway || tp.created || missing || r.passed === null || r.passed >= base.passed;
    const firstError = (run.out.match(/(AssertionError|Error)[^\n]*/) ?? [''])[0].slice(0, 160);
    if (crashed) brokenTests++;
    return { ok: fails && !crashed && moreTests && oldStillPass, why: !fails ? 'the test already passes on today\'s code, so it does not check the new behaviour' : crashed ? `the test fails for the wrong reason (${firstError})` : !moreTests ? 'no new test was added' : 'it broke existing tests', out: run.out };
  };
  let written = 0;
  const writeTests = (want, max, label = 'Writing tests', extra = '', merge) => tryUntilPass(ctx, {
    label, max, want, system: CODE_SYSTEM, temperature: 0.7, maxTokens: 1200, slot, from: written + 1, thinkCap: SETUP_THINK_CAP,
    // Two tests that cannot even load the code: this is not a job for a test.
    stopEarly: () => brokenTests >= 2 && !candidates.length,
    prompt: ({ best }) => `${testAsk}${coverage}${extra}${best?.why ? `\n\nAn earlier try was no good: ${best.why}` : ''}`,
    apply: (code) => {
      const text = tp.throwaway || tp.created ? code : merge(testOriginal, code);
      return { files: [{ abs: scratch.path(tp.rel), text }], text, undo: () => {} };
    },
    check: async (applied) => {
      written++;
      const v = await validateTest(applied.text);
      if (v.ok) candidates.push({ text: applied.text, out: v.out });
      return { ...v, summary: 'fails on today\'s code, as it should' };
    },
  });
  return { candidates, writeTests, validateTest, testOriginal, brokenTests: () => brokenTests };
}
