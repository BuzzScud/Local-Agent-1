// Agentic Coder working on itself (permissions.mjs isSelf: Bypass permissions on the Claude API, the
// owner's pick 8 Oct 2026): its own files open with a copy kept first, the push and stopping its own
// processes run, the App tool is allowed; the door's files, the never-list and the destructive
// commands still hold. Outside self, Bypass is as before.
import { test, expect } from 'bun:test';
import { blockedReason, decide, judge, isSelf, selfLockedBy, SELF_LOCKED, permissionsTable } from '../src/agent/permissions.mjs';

const ctx = (extra = {}) => ({ mode: 'bypass', cwd: '/p', inside: true, self: true, ...extra });
const d = (name, args, extra) => decide(name, args, ctx(extra)).decision;

test('isSelf: Bypass on the Claude API only; selfLockedBy names the door\'s two files', () => {
  expect(isSelf('bypass', 'claude')).toBe(true);
  expect([isSelf('auto', 'claude'), isSelf('bypass', 'openai'), isSelf('bypass', undefined), isSelf('ask', 'claude')]).toEqual([false, false, false, false]);
  expect(SELF_LOCKED).toEqual(['door.key', 'trust.json']);
  expect(selfLockedBy('.agentic-coder/door.key')).toBe('door.key');
  expect(selfLockedBy(['.agentic-coder/trust.json', '/Users/x/.agentic-coder/trust.json'])).toBe('trust.json');
  expect(selfLockedBy('.agentic-coder/settings.json')).toBeNull();
});

test('blockedReason: the push and stopping processes lift in self; the rest hold', () => {
  expect(blockedReason('git push origin main', { self: true })).toBeNull();
  expect(blockedReason('pkill -f agentic', { self: true })).toBeNull();
  expect(blockedReason('git push origin main')).toContain('sends your code off this Mac');
  expect(blockedReason('kill 123')).toContain('stopping processes');
  for (const c of ['rm -rf build', 'sudo ls', 'git reset --hard HEAD', 'shutdown -h now']) expect(blockedReason(c, { self: true })).not.toBeNull();
});

test('judge in self: own files, the push, its own processes and the App tool run; door.key, secrets and the never-list stay shut', () => {
  const own = judge('Write', { path: '.agentic/settings.json' }, ctx({ rel: '.agentic/settings.json' }));
  expect(own).toMatchObject({ decision: 'allow', self: true });
  expect(own.why).toContain('a copy is kept first');
  expect(d('Edit', { path: '.agentic/hooks.json' }, { rel: '.agentic/hooks.json' })).toBe('allow');
  expect(d('Bash', { command: 'cp x .agentic-coder/permissions.json' })).toBe('allow');
  expect(d('Bash', { command: 'git push origin main' })).toBe('allow');
  expect(d('Bash', { command: 'pkill -f agentic-coder' })).toBe('allow');
  expect(judge('App', { action: 'command', command: '/mode auto' }, ctx())).toMatchObject({ decision: 'allow', self: true });
  // what still holds
  expect(decide('Write', { path: '.agentic-coder/door.key' }, ctx({ rel: '.agentic-coder/door.key' }))).toMatchObject({ decision: 'deny' });
  expect(decide('Write', { path: '.agentic-coder/door.key' }, ctx({ rel: '.agentic-coder/door.key' })).reason).toContain("door's own file");
  expect(d('Bash', { command: 'cp x .agentic-coder/trust.json' })).toBe('deny');
  for (const c of ['rm -rf build', 'sudo ls', 'cat ~/.ssh/id_rsa']) expect(d('Bash', { command: c })).toBe('deny');
  expect(d('Bash', { command: 'npm publish' }, { rules: { never: ['npm publish'] } })).toBe('deny');
});

test('outside self nothing opens: Bypass on a local model, or self asked for in another mode', () => {
  expect(d('Write', { path: '.agentic/settings.json' }, { self: false, rel: '.agentic/settings.json' })).toBe('deny');
  expect(d('Bash', { command: 'git push origin main' }, { self: false })).toBe('deny');
  expect(d('App', { action: 'restart' }, { self: false })).toBe('deny');
  expect(decide('App', { action: 'restart' }, ctx({ self: false })).reason).toContain('only in Bypass permissions on the Claude API');
  // self means nothing without Bypass
  expect(d('Write', { path: '.agentic/settings.json' }, { mode: 'auto', rel: '.agentic/settings.json' })).not.toBe('allow');
  expect(d('Bash', { command: 'git push origin main' }, { mode: 'auto' })).toBe('deny');
  expect(d('App', { action: 'restart' }, { mode: 'auto' })).toBe('deny');
});

test('permissionsTable in self says what opens, and the blocked list no longer names the push or kill', () => {
  const t = permissionsTable({ mode: 'bypass', self: true });
  expect(t).toContain('Agentic Coder may work on itself');
  expect(t).toContain('The App tool: a slash command, a setting, a restart on new code');
  expect(t).toContain('only door.key and trust.json stay locked');
  expect(t).not.toContain('sends your code off this Mac');
  expect(t).not.toContain('stopping processes could stop');
  const plain = permissionsTable({ mode: 'bypass' });
  expect(plain).not.toContain('The App tool');
  expect(plain).toContain('sends your code off this Mac');
  // self is a Bypass thing: asked for in Auto it changes nothing
  expect(permissionsTable({ mode: 'auto', self: true })).not.toContain('The App tool');
});
