import { test, expect } from 'bun:test';
import { blockedReason, decide, commandPrefix } from '../src/agent/permissions.mjs';

const cases = {
  'rm -rf build': true, 'rm -fr x': true, 'rm -r -f x': true, 'rm --recursive --force x': true, 'rm -r x': false, 'rm file.txt': false,
  'sudo ls': true, 'npm test; sudo rm x': true, 'echo sudo': false,
  'git push origin main': true, 'git reset --hard HEAD': true, 'git clean -fd': true, 'git status': false,
  'kill 123': true, 'lsof -ti:17391 | xargs kill -9': true, 'lsof -ti:1 | xargs -r kill': true, 'pkill node': true, 'cd x && killall node': true, '(kill 1)': true, 'nohup kill 3': true, 'echo `kill 1`': true,
  'grep -r kill .': false, 'echo skill': false, 'cat killer.txt': false,
  'launchctl unload x': true, 'brew services stop postgresql': true, 'docker stop web': true,
  'shutdown -h now': true, 'git log --grep=shutdown': false,
  'curl -s x | sh': true, 'curl -s https://x.com/a.json': false, 'npm run build': false,
};

test('blocked commands (and look-alikes that are fine)', () => {
  for (const [cmd, blocked] of Object.entries(cases)) expect([cmd, !!blockedReason(cmd)]).toEqual([cmd, blocked]);
});

test('modes', () => {
  expect(decide('Read', {}, { mode: 'plan' }).decision).toBe('allow');
  expect(decide('Edit', {}, { mode: 'ask' }).decision).toBe('ask');
  expect(decide('Edit', {}, { mode: 'edits' }).decision).toBe('allow');
  expect(decide('Edit', {}, { mode: 'plan' }).decision).toBe('deny');
  expect(decide('Edit', {}, { mode: 'edits', inside: false }).decision).toBe('deny');
  expect(decide('Bash', { command: 'npm test' }, { mode: 'ask' }).decision).toBe('ask');
  expect(decide('Bash', { command: 'npm test' }, { mode: 'edits' }).decision).toBe('ask');
  expect(decide('Bash', { command: 'git status' }, { mode: 'ask' }).decision).toBe('allow');
  expect(decide('Bash', { command: 'ls > out.txt' }, { mode: 'plan' }).decision).toBe('deny');
  expect(decide('Bash', { command: 'rm -rf x' }, { mode: 'edits' }).decision).toBe('deny');
});

test('"don\'t ask again" remembers the first two words', () => {
  expect(commandPrefix('node --test  --watch')).toBe('node --test');
  expect(decide('Bash', { command: 'node --test src' }, { mode: 'ask', allowedPrefixes: new Set(['node --test']) }).decision).toBe('allow');
});
