// The results page of the skills check (skills-check.mjs), drawn by check-page.mjs
// (Result · The checks · How it was measured).
//   skillsPage({ summary, rows, prev, raw }) → html
import { buildCheckPage, sec } from './check-page.mjs';

const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%`;
const took = (x) => `${Math.abs(Math.round(x * 100))}% ${x > 0 ? 'more' : 'less'} time`;

export function skillsPage({ summary: s, rows, prev = null, raw = [] }) {
  const v = s.verdict;
  const was = prev?.s?.verdict;
  const said = v.holds
    ? `Yes: with the skill ${s.name} passed ${v.on.passed} of ${v.on.n} tasks (without it: ${v.off.passed}) and took ${took(v.slower)} in all, inside the rule.`
    : `No: with the skill ${s.name} passed ${v.on.passed} of ${v.on.n} tasks (without it: ${v.off.passed}) and took ${took(v.slower)} in all; the rule asks for at least as many and at most +25%.`;
  return buildCheckPage({
    title: `Skills check · ${s.name}`, summary: s, rows, prev, raw, first: false,
    passRule: 'with the skill, at least as many tasks pass and at most 25% more time',
    verdict: `${said} Without the skill’s words, the model ${v.opened ? 'opened it from the skills list' : 'did not open it from the skills list'}.`,
    cards: [
      { k: 'Tasks passed without → with the skill', v: `${v.off.passed} → ${v.on.passed} of ${v.on.n}`, sub: was ? `before: ${was.off.passed} → ${was.on.passed}` : 'the same three tasks, one after the other', dir: 'higher is better' },
      { k: 'Time, all three tasks', v: `${sec(v.off.secs)} → ${sec(v.on.secs)}`, sub: `${pct(v.slower)} with the skill${was ? ` · before: ${pct(was.slower)}` : ''}`, dir: 'lower is faster' },
      { k: 'Ran just the new test file', v: `${v.off.one} → ${v.on.one} of ${v.on.n}`, sub: 'the skill’s step 3: not the whole suite', dir: 'higher is better' },
      { k: 'No words: opened from the list', v: v.opened == null ? '—' : v.opened ? 'yes' : 'no', sub: 'Read SKILLS/write-a-test by itself', dir: 'yes is better' },
    ],
    how: [
      `The model: ${s.name}, through <b>coding -p --yes</b> (thinking off, no memory, Who decides: App), in a throwaway home whose engine and model files are links to the ones in ~/.agentic-coder. A first request loads the model and is not counted.`,
      'The skill: “Write a test”, the example terminal/rules/SKILLS.md ships switched off, turned on in a throwaway rules folder (AGENTIC_RULES_DIR). Without skills, the same file as shipped: none on, so the app takes its own path, as today.',
      'The project: a small shop (src/cart.mjs, src/price.mjs) with node --test and one test; a second test file leaves a mark when the whole suite runs, so a run of just one file is told apart. Each run starts from a fresh copy.',
      'A task passes when a new test uses the function asked about, the whole suite passes afterwards (run by the check), and the code under test is unchanged.',
      'The rule, written before the first run: with the skill, at least as many tasks pass as without, and the three take at most 25% more time in all. The seventh run asks without the skill’s words, so only the skills list in the instructions can lead the model to it.',
      `Nothing in ~/.agentic-coder was written but this run’s line in the test record. The Mac’s load at the end: ${s.load}. Code: ${s.code}.`,
    ],
  });
}
