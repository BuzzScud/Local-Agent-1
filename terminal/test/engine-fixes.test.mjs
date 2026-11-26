import './test-env.mjs';
import { test, expect } from 'bun:test';
import { stepMeaning, filesWithLinesShown } from '../src/agent/questions.mjs';
import { ChecksPart } from '../src/agent/agent-checks.mjs';

// Agentic Coder as hearth's engine (26 Nov 2026, the owner: "build option 1"), the three fixes its measured runs on hearth called for
// (the Agentic Coder vs hearth page): repeats caught by what a search looks for, no self check-ins when it works alone, and lines a
// command printed count as read for the second look.

const bash = (command) => JSON.stringify({ command });

test('a search is the same step whatever its flags, folders or the echo after it', () => {
  const a = stepMeaning('Bash', bash('grep -rn "FORGE_STEPS" deploy/k8s/hearth-portals.yaml'));
  expect(a).toBe('search:forge_steps');
  expect(stepMeaning('Bash', bash('grep -rn "FORGE_STEPS" deploy/ 2>/dev/null; echo "exit: $?"'))).toBe(a);
  expect(stepMeaning('Bash', bash('rg -n \'FORGE_STEPS\' --glob "*.mjs" .'))).toBe(a);
  expect(stepMeaning('Bash', bash('grep -rn "FORGE_STEPS\\|FORGE_MINUTES" .'))).toBe('search:forge_minutes,forge_steps');
});

test('anything that is not a search keeps its own words', () => {
  expect(stepMeaning('Bash', bash('npm test'))).toBe(null);
  expect(stepMeaning('Bash', bash('grep FORGE_STEPS deploy'))).toBe(null); // no quoted words: the command's own words decide
  expect(stepMeaning('Read', JSON.stringify({ path: 'a.mjs' }))).toBe(null);
  expect(stepMeaning('Bash', '{not json')).toBe(null);
});

test('the files whose lines a command printed, as grep -n and rg print them', () => {
  expect(filesWithLinesShown('deploy/k8s/hearth-portals.yaml:108:        - { name: FORGE_MINUTES, value: "20" }\n./shared/modes.mjs:25-export')).toEqual(['deploy/k8s/hearth-portals.yaml', 'shared/modes.mjs']);
  expect(filesWithLinesShown('exit: 1\nno matches')).toEqual([]);
});

test('no "am I on the right track?" check-in while it works alone; one when someone can answer', async () => {
  const asked = [];
  const make = (alone) => Object.assign(Object.create(ChecksPart.prototype), {
    turn: { changed: false, looked: [], since: Date.now() - 10 * 60_000, asked: [] },
    checkIns: { steps: 1, secs: 1 },
    aloneOn: () => alone,
    emit: () => {},
    ask: async (q) => (asked.push(q.kind), { text: '' }),
  });
  const call = { name: 'Read', args: JSON.stringify({ path: 'a.mjs' }) };
  expect(await make(true).checkIn(call)).toBe(null);
  expect(asked).toEqual([]);
  await make(false).checkIn(call);
  expect(asked).toEqual(['checkin']);
});
