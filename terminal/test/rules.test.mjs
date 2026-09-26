// The bug-fixing rules (terminal/rules/bug-fixing.md): read, sorted by kind,
// and carried into the prompt and the fix path.
import { test, expect } from 'bun:test';
import { RULES, parseRules, sortBug, kindText } from '../src/agent/rules.mjs';
import { systemPrompt, SESSION_MARK } from '../src/agent/prompt.mjs';

test('the rules file loads: nine steps every time and ten kinds', () => {
  expect(RULES.error).toBeUndefined();
  expect(RULES.always.split('\n').filter((l) => /^\d+\./.test(l)).length).toBe(9);
  expect(RULES.kinds.map((k) => k.name)).toEqual(['Crash', 'Wrong value', 'Layout', 'Data', 'Speed', 'Flaky', 'Time & date', 'Only there', 'Used to work', 'Security']);
  for (const k of RULES.kinds) {
    expect(k.words.length).toBeGreaterThan(3);
    expect(k.steps.split('\n').map((l) => l[0])).toEqual(['1', '3', '4', '5', '6', '7', '8', '9']);
  }
  expect(RULES.kinds.filter((k) => !k.testsSeeIt).map((k) => k.name)).toEqual(['Layout', 'Data', 'Speed', 'Flaky', 'Only there']);
  expect(RULES.kinds.find((k) => k.name === 'Flaky').runs).toBe(5);
});

test('a bug is sorted into its kind by the words it uses', () => {
  const kindOf = (t) => sortBug(t)?.name ?? null;
  expect(kindOf('the symbol search dropdown is hidden behind the EMA legend on the price chart, fix it')).toBe('Layout');
  expect(kindOf('TypeError when I click save, fix it')).toBe('Crash');
  expect(kindOf('the total is wrong, it should be 42')).toBe('Wrong value');
  expect(kindOf('the test fails sometimes, fix it')).toBe('Flaky');
  expect(kindOf('it works on my Mac but not on the server')).toBe('Only there');
  expect(kindOf('the export used to work before the update')).toBe('Used to work');
  expect(kindOf('the trades show the wrong day after midnight UTC')).toBe('Time & date');
  expect(kindOf('fix the bug')).toBe(null);
});

test('the every-time steps are in the shared part of the prompt; a kind brings its own steps', () => {
  const p = systemPrompt({ cwd: '/tmp', git: 'test', tests: null });
  expect(p.slice(0, p.indexOf(SESSION_MARK))).toContain(`Fixing a bug\n${RULES.always}`);
  const layout = RULES.kinds.find((k) => k.name === 'Layout');
  expect(kindText(layout)).toStartWith('How to fix a Layout bug (something covered; main tool: a browser check):\n1. See it:');
});

test('a kind with "Tests see it: no" and its runs come from the file', () => {
  const r = parseRules('# x\n\n## Every time\n\n1. a\n\n## Steps for each kind\n\n### 1 · Odd\n\n- Words: odd, very odd\n- Looks like: odd\n- Main tool: eyes\n- Tests see it: no\n- Runs of the check: 3\n\n1. See it: look.\n3. Find it: search.\n');
  expect(r.always).toBe('1. a');
  expect(r.kinds[0]).toMatchObject({ num: 1, name: 'Odd', testsSeeIt: false, runs: 3, words: ['odd', 'very odd'] });
  expect(sortBug('this is very odd', r.kinds).score).toBe(3);
});
