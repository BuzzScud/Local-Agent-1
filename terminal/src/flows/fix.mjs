// Fix: run the tests, find the code the failure points at, try corrected
// versions in the scratch copy until the tests pass, then show the diff.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Scratch } from './scratch.mjs';
import { readResults, failureDigest, assertionDetail } from './results.mjs';
import { projectFiles, sourcesFromFailure, filesInText, pickFile, fileHints, isTestFile, EDITABLE } from './localize.mjs';
import { excerpts, linkedFiles, searchTerms } from './excerpts.mjs';
import { WHOLE_FILE_MAX, SHOW_WHOLE_MAX, functionNames, functionAtLine, findFunction, isWholeFile, splice, langFor } from './units.mjs';
import { tryUntilPass } from './tries.mjs';
import { fence, complete } from './llm.mjs';
import { applyChange } from './apply.mjs';
import { BLOCKS_FORMAT, parseBlocks, applyBlocks, guardChange } from './blocks.mjs';
import { existsSync } from 'node:fs';
import { sortBug, kindText } from '../agent/rules.mjs';
import { canPageCheck, pageCheckFirst, spotsText } from './pagecheck.mjs';
import { diffLines } from '../tools/edit.mjs';

const SYSTEM = 'You are an expert programmer fixing a bug. Reply with only the requested code in one fenced code block, nothing else.';

// A command the request says must pass ("this check fails now: `node check.mjs`").
// It scores the tries instead of the project's whole test suite.
const RUNNER = /^(?:node|bun|deno|npm|npx|pnpm|yarn|python3?|pytest|go test|cargo test|make|sh|bash|zsh|\.\/)(?:\s|$)|^\.\/\S/;
export function checkInText(task) {
  if (!/\b(pass|fail|check|test)/i.test(task)) return null;
  for (const m of task.matchAll(/`([^`\n]+)`/g)) { const c = m[1].trim(); if (RUNNER.test(c)) return c; }
  return null;
}

export async function fixFlow(ctx, task) {
  const { cwd } = ctx;
  let check = checkInText(task);
  // The bug's kind (terminal/rules/bug-fixing.md): its steps go with every try,
  // and a kind the test suite cannot see needs a check: the one the request
  // names, or (a bug on a page) one Agentic Coder makes first in a browser.
  const kind = sortBug(task);
  if (kind) ctx.note(`This looks like a ${kind.name} bug (${kind.looks}), so it follows the ${kind.name} steps.`, 'dim');
  const unseen = Boolean(kind && !check && !kind.testsSeeIt);
  const checkFirst = unseen && canPageCheck(kind) && (process.env.AGENTIC_CHECK_FIRST ?? process.env.BONSAI_CHECK_FIRST) !== 'off';
  if (unseen && !checkFirst) return { handled: false, stepByStep: true, why: `the test suite can't see a ${kind.name} bug (it needs ${kind.tool})` };
  // With every try go the steps for its kind of bug, and what the memory
  // holds about this request (what worked here, what did not).
  const how = `${kind ? `\n\n${kindText(kind)}` : ''}${ctx.memory ? `\n\n(${ctx.memory})` : ''}`;
  if (!checkFirst && !(check ?? ctx.testCmd)) return { handled: false, why: 'no test command' };
  const first = checkFirst ? ['Open the page in a browser', 'See the bug there', 'Your OK on the check'] : [check ? `Run ${check}` : 'Run the tests'];
  const plan = ctx.plan([...first, 'Find the code', `Try fixes (up to ${ctx.maxTries})`, 'Apply the fix']);
  const step = (i) => plan.step(first.length - 1 + i); // 1 = find the code, 2 = try fixes, 3 = apply
  const scratch = new Scratch(cwd);
  try {
    plan.step(0);
    // Check first: the browser finds what covers what and why, and the check
    // it writes must fail today. You see it before anything else happens.
    let made = null;
    if (checkFirst) {
      made = await pageCheckFirst(ctx, task, { scratch, files: projectFiles(cwd), plan });
      if (!made.ok) return { handled: false, stepByStep: true, why: made.why };
      plan.step(2);
      ctx.note(`The check: ${made.words}`, 'dim');
      const d = diffLines('', made.text);
      const answer = await ctx.ask({ id: `test_${Date.now()}`, name: 'Test', args: { path: made.rel }, prepared: { rel: made.rel, before: '', after: made.text, ...d, created: true }, label: 'Test', arg: made.rel });
      if (answer.choice === 'no') {
        ctx.tool('Test', made.rel, { kind: 'declined', feedback: answer.feedback }, true);
        return { handled: true, done: false, declined: true, summary: 'You did not approve the check, so nothing was changed. Say what it should check instead.' };
      }
      // Approved: the check joins your project now, so it is there whichever way the fix is found.
      mkdirSync(dirname(join(cwd, made.rel)), { recursive: true });
      writeFileSync(join(cwd, made.rel), made.text);
      ctx.tool('Test', made.rel, { kind: 'diff', path: made.rel, created: true, hunk: d.hunk, additions: d.additions, removals: d.removals, lines: made.text.split('\n').length });
      check = made.cmd;
    }
    const testCmd = check ?? ctx.testCmd;
    const base = made?.run ?? await scratch.run(testCmd, { signal: ctx.signal, timeoutMs: ctx.testTimeoutMs });
    const baseRes = readResults(base.out, base.code);
    const stopped = base.timedOut ? [`(stopped after ${Math.round(base.ms / 1000)} s, before it finished)`] : [];
    if (!made) ctx.tool('Bash', testCmd, { kind: 'bash', code: base.code, lines: [...base.out.trimEnd().split('\n').slice(-40), ...stopped], ms: base.ms }, !baseRes.ok);
    // A run cut off by the time limit says nothing about the bug: what it
    // printed so far is not the list of what fails.
    if (base.timedOut && !ctx.signal?.aborted) return { handled: false, why: `${testCmd} did not finish in ${Math.round(base.ms / 1000)} s, so it cannot show what is wrong` };
    // Nothing fails: the bug is not covered by a test, so reproduce it first.
    if (baseRes.ok) return { handled: false, why: 'tests pass', next: 'change' };

    step(1);
    const files = projectFiles(cwd);
    // The check named in the request is how the fix is scored, not the file to
    // fix; the model reads it like a failing test.
    const checkWords = (check ?? '').split(/\s+/).map((w) => w.replace(/^\.\//, ''));
    const isCheck = (rel) => isTestFile(rel) || checkWords.includes(rel);
    const found = sourcesFromFailure(cwd, base.out, files);
    const sources = found.sources.filter((f) => !isCheck(f));
    const tests = [...files.filter((f) => checkWords.includes(f)), ...found.tests];
    const named = filesInText(cwd, task).filter((f) => !isCheck(f));
    const pickable = files.filter((f) => !isCheck(f));
    // A check Agentic Coder made comes with the lines that set the layers: the first of them is where to look.
    let target = named[0] ?? made?.files.find((f) => !isCheck(f)) ?? sources[0] ?? await pickFile({ url: ctx.url, model: ctx.model, slot: ctx.slot, cwd, task: made ? `${task}\n${made.report}` : task, files: pickable, exts: EDITABLE, signal: ctx.signal });
    if (!target || !EDITABLE.test(target)) return { handled: false, why: 'could not tell which file to fix' };
    const original = readFileSync(join(cwd, target), 'utf8');

    // Whole file when small; otherwise one function: the one the failure
    // points at, or the one the model picks from the file's functions. A page
    // or stylesheet, or code too big for either, is shown in parts.
    const lang = langFor(target);
    const lineCount = original.split('\n').length;
    let unit = null;
    let inParts = !lang || Boolean(made);
    if (!made && lang && lineCount > WHOLE_FILE_MAX) {
      const line = Number(new RegExp(`${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`).exec(base.out)?.[1] ?? 0);
      unit = line ? functionAtLine(original, line, lang) : null;
      if (!unit) unit = await pickFunction(ctx, { target, original, lang, task, digest: failureDigest(base.out) });
      if (!unit && lineCount > SHOW_WHOLE_MAX) inParts = true;
    }
    if (!inParts) ctx.tool('Read', target, { kind: 'read', lines: lineCount, total: lineCount, content: original });
    // The model reads the whole file up to SHOW_WHOLE_MAX lines, even when it
    // only rewrites one function.
    const showAll = !unit || lineCount <= SHOW_WHOLE_MAX;
    const shown = showAll ? original : original.split('\n').slice(unit.start, unit.end + 1).join('\n');
    const focus = unit ? `\nOnly the function ${unit.name} (lines ${unit.start + 1}-${unit.end + 1}) needs to change.` : '';
    const merge = (code) => (unit && !isWholeFile(code, original, unit.name, lang) ? splice(original, unit, code) : code);
    // A check Agentic Coder made is not shown to the tries: what it found is in the digest.
    const testText = made ? '' : tests.slice(0, 2).map((t) => fence(t, readFileSync(join(cwd, t), 'utf8').slice(0, 6000))).join('\n\n');
    const digest = made ? `${failureDigest(base.out)}\n\n${made.report}` : failureDigest(base.out);
    const want = unit ? `the complete corrected function ${unit.name}` : `the complete corrected ${target}`;

    step(2);
    // A flaky bug's named check must pass several runs in a row ("Runs of the check").
    const runs = check ? kind?.runs ?? 1 : 1;
    const checkRun = async () => {
      let run, r;
      for (let i = 0; i < runs; i++) {
        run = await scratch.run(testCmd, { signal: ctx.signal, timeoutMs: ctx.testTimeoutMs });
        if (run.timedOut) return { ok: false, score: 0, why: `${testCmd} did not finish in time`, detail: '', out: run.out, summary: '' };
        r = readResults(run.out, run.code);
        if (!r.ok) break;
      }
      const ok = r.ok && (baseRes.total === null || r.total === null || r.total >= baseRes.total);
      // A check that could not run (its ERROR line) says so: the change broke what it looks at.
      const could = /^ERROR .+$/m.exec(run.out)?.[0];
      return { ok, score: r.passed ?? 0, why: r.failing.length ? `still failing: ${r.failing.slice(0, 3).join('; ')}` : could ?? 'tests still fail', detail: assertionDetail(run.out) || (could ?? ''), out: run.out, summary: made ? `${check} passes` : runs > 1 ? `passes ${runs} runs in a row` : `passes all ${r.total ?? ''} tests`.replace('  ', ' ') };
    };
    // Edit blocks from a reply, into the scratch copy; never the tests or the check.
    const applyReply = (reply) => {
      // A reply that also touches the tests keeps its changes to the source.
      const all = parseBlocks(reply);
      const blocks = all.filter((b) => !isCheck(b.path));
      if (all.length && !blocks.length) return { error: 'the tests may not be changed' };
      const r = applyBlocks(blocks, (rel) => scratch.read(rel));
      if (r.error) return { error: r.error };
      for (const [rel, text] of r.files) { const g = guardChange(rel, scratch.read(rel), text, task); if (g) return { error: g }; }
      for (const [rel, text] of r.files) scratch.write(rel, text);
      return { files: [...r.files].map(([rel, text]) => ({ abs: scratch.path(rel), text })), texts: r.files, undo: () => { for (const rel of r.files.keys()) scratch.restore(rel); } };
    };
    const tryAgain = (last) => (last ? `\n\nYour previous try was wrong. It was:\n${last.code.slice(0, 2500)}\nand ${check ? 'the check' : 'the tests'} still failed:\n${last.detail || last.why}\nDo something different this time.` : '');
    const failText = check ? `This check fails: ${check}` : 'The tests fail:';

    let result;
    let texts = null;
    if (inParts) {
      // The file, the stylesheets a page loads, and the next
      // likeliest files: searched for the strings the model names.
      const searchIn = [...new Set([...(made?.files ?? []), target, ...linkedFiles(cwd, target, files), ...fileHints(cwd, task, pickable, { exts: EDITABLE, max: 3 }).code])].filter((f) => !isCheck(f)).slice(0, 6);
      // With a check Agentic Coder made, the browser already named the two layers and
      // the lines that set them: those lines are shown, nothing is guessed.
      const L = made?.pair.layers;
      const terms = made ? [...new Set([L?.a?.sel, L?.c?.sel, made.pair.covered, made.pair.by].filter(Boolean).map((t) => t.split(/\s+/).pop()))].slice(0, 6) : await searchTerms(ctx, { task, digest, files: searchIn });
      const parts = made?.spots.length ? { text: spotsText(cwd, made.spots), hits: made.spots.length } : excerpts(cwd, searchIn, terms);
      ctx.tool('Search', terms.join(', ') || '(no terms)', { kind: 'search', count: parts.hits, content: parts.text });
      if (!parts.text) return { handled: false, stepByStep: Boolean(made), why: `could not find the part of ${target} the request is about` };
      result = await tryUntilPass(ctx, {
        label: 'Trying fixes', max: ctx.maxTries, system: 'You are an expert programmer fixing a bug. Reply with edit blocks only, nothing else.', maxTokens: 2000, raw: true,
        prompt: ({ last }) => `${failText}\n${digest}\n\n${testText}\n\nThe parts of the project that mention ${terms.map((t) => `"${t}"`).join(', ')}:\n\n${parts.text}\n\nTask: ${task}${how}\nFix it by changing lines shown above (do not change the tests). Copy OLD lines exactly as shown. ${BLOCKS_FORMAT}${tryAgain(last)}`,
        apply: applyReply,
        check: checkRun,
      });
      if (!result.ok && made && !ctx.signal?.aborted) {
        // The check and what the browser found go along, step by step.
        ctx.carry?.({ check, note: `A check that shows the bug is in the project now: \`${check}\`. It fails today; run it after your change.\n${made.report}` });
        return { handled: false, stepByStep: true, why: `none of the ${result.marks.length} tries made the check pass${result.best?.why ? ` (the closest: ${result.best.why})` : ''}` };
      }
      if (!result.ok) {
        ctx.note(`None of the ${result.marks.length} tries made ${check ?? 'the tests'} pass${result.best?.why ? ` (the closest: ${result.best.why})` : ''}. Nothing was changed. Try naming the file or the part of it to change.`, 'warn');
        return { handled: true, done: false, summary: `I could not find a fix that makes ${check ? 'the check' : 'the tests'} pass; nothing was changed.` };
      }
      texts = result.applied.texts;
    } else {
      result = await tryUntilPass(ctx, {
        label: 'Trying fixes',
        max: ctx.maxTries,
        // Rewriting one function three times without success: the bug is probably wider (see below).
        stopEarly: ({ attempt }) => Boolean(unit) && attempt >= 3,
        system: SYSTEM,
        prompt: ({ last }) => `The tests fail:\n${digest}\n\n${testText}\n\n${fence(showAll ? target : `${target} (function ${unit.name})`, shown)}${focus}\n\nTask: ${task}${how}\nFix the bug in ${target} (do not change the tests). Reply with ${want}.${last ? `\n\nYour previous try was wrong. It was:\n\`\`\`\n${last.code.slice(0, 2500)}\n\`\`\`\nand the tests still failed:\n${last.detail || last.why}\nDo something different this time.` : ''}`,
        apply: (code) => {
          const text = merge(code);
          scratch.write(target, text);
          return { files: [{ abs: join(scratch.dir, target), text }], undo: () => scratch.restore(target), text };
        },
        check: checkRun,
      });
      // Wider: the bug may sit in more than one place (two functions, or two
      // files). Tries as edit blocks over the whole file, still in the scratch copy.
      if (!result.ok && lineCount <= SHOW_WHOLE_MAX && !ctx.signal?.aborted) {
        const wider = await tryUntilPass(ctx, {
          label: 'Trying wider fixes', max: 3, system: 'You are an expert programmer fixing a bug. Reply with edit blocks only, nothing else.', maxTokens: 3000, raw: true,
          prompt: ({ last }) => `The tests fail:\n${digest}\n\n${testText}\n\n${fence(target, original)}\n\nTask: ${task}${how}\nFix the bug in ${target} (do not change the tests). It may need changes in more than one place. ${BLOCKS_FORMAT}${last ? `\n\nYour previous try was wrong. It was:\n${last.code.slice(0, 2500)}\nand the tests still failed:\n${last.detail || last.why}\nDo something different this time.` : ''}`,
          apply: applyReply,
          check: checkRun,
        });
        if (wider.ok) { result = wider; texts = wider.applied.texts; }
        else if (unit) {
          // Neither one function nor edit blocks over the file: the step-by-step way may still do it.
          return { handled: false, why: `none of the ${result.marks.length} tries that changed only ${unit.name}, nor ${wider.marks.length} wider tries, made the tests pass${wider.best?.why ? ` (the closest: ${wider.best.why})` : ''}` };
        }
      }
    }
    if (!result.ok) {
      ctx.note(`None of the ${result.marks.length} tries made the tests pass${result.best?.why ? ` (the closest: ${result.best.why})` : ''}. Nothing was changed. Try describing the bug in more detail.`, 'warn');
      return { handled: true, done: false, summary: 'I could not find a fix that makes the tests pass; nothing was changed.' };
    }

    step(3);
    const changes = texts
      ? [...texts].map(([rel, after]) => ({ rel, before: existsSync(join(cwd, rel)) ? readFileSync(join(cwd, rel), 'utf8') : null, after })).filter((c) => c.before !== c.after)
      : [{ rel: target, before: original, after: merge(result.code) }];
    const applied = await applyChange(ctx, changes);
    if (!applied.ok) return { handled: true, done: false, declined: true, summary: applied.feedback ? `Nothing was changed. You said: ${applied.feedback}` : 'You said no to the fix; nothing was changed.' };
    const final = await ctx.runReal(testCmd);
    plan.done();
    const first = changes[0] ?? { rel: target, before: original, after: original };
    return { handled: true, done: final.ok, summary: `${ctx.describe ? await ctx.describe(first.rel, first.before ?? '', first.after) : ''}Fixed ${changes.map((c) => c.rel).join(', ') || target}${final.ok ? (check ? `; ${check} passes` : `; all ${final.total ?? ''} tests pass`.replace('  ', ' ')) : `; but ${check ?? 'the tests'} ${check ? 'fails' : 'fail'} in your project, see above`}.${made ? ` The check stays in your project (${made.rel}), so this cannot come back unseen.` : ''}` };
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
