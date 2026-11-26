// Agentic Coder working on itself (permissions.mjs isSelf: Bypass permissions on the Claude API, the
// owner's pick 8 Oct 2026): its own files open with a copy kept first, the push and stopping its own
// processes run, the App tool is allowed; the door's files, the never-list and the destructive
// commands still hold. Outside self, Bypass is as before.
import { test, expect } from 'bun:test';
import { blockedReason, decide, judge, isOwnOpen, isSelf, ownLockedBy, OWN_LOCKED, selfLockedBy, SELF_LOCKED, permissionsTable } from '../src/agent/permissions.mjs';

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
  expect(blockedReason('git push origin main')).toBeNull(); // a plain push asks instead (8 Oct 2026)
  expect(blockedReason('git push -f origin main')).toContain('force push');
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
  expect(d('Bash', { command: 'git push origin main' }, { self: false })).toBe('ask');
  expect(d('App', { action: 'restart' }, { self: false })).toBe('deny');
  expect(decide('App', { action: 'restart' }, ctx({ self: false })).reason).toContain('only in Bypass permissions on the Claude API or on hearth');
  // self means nothing without Bypass
  expect(d('Write', { path: '.agentic/settings.json' }, { mode: 'auto', rel: '.agentic/settings.json' })).not.toBe('allow');
  expect(d('Bash', { command: 'git push origin main' }, { mode: 'auto' })).toBe('ask');
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
  expect(plain).toContain('| git push (only when the user asks; a force push is refused) | asks first, every time');
  // self is a Bypass thing: asked for in Auto it changes nothing
  expect(permissionsTable({ mode: 'auto', self: true })).not.toContain('The App tool');
});

// 25 Nov 2026, the owner: "we need it to just access everything … i need it to be able to do everything alone"; of four
// permissions offered they picked "Own settings + App tool" and "SSH config + certificates", and left the push and
// stopping processes as they are.
test('own on hearth: Bypass there opens the app\'s own files and the App tool, and nothing else that self opens', () => {
  expect(isOwnOpen('bypass', { hearth: true })).toBe(true);
  expect([isOwnOpen('auto', { hearth: true }), isOwnOpen('bypass', { hearth: false }), isOwnOpen('bypass', undefined), isOwnOpen('bypass', { kind: 'claude' })]).toEqual([false, false, false, false]);
  const own = { self: false, own: true };
  const w = judge('Write', { path: '.agentic/settings.json' }, ctx({ ...own, rel: '.agentic/settings.json' }));
  expect(w).toMatchObject({ decision: 'allow', self: true }); // self: a copy is kept first (agent-step.mjs keepOwnCopy)
  expect(w.why).toBe("Bypass on hearth: Agentic Coder's own file (.agentic/settings.json) may change; a copy is kept first");
  expect(d('Bash', { command: 'cp x .agentic-coder/settings.json' }, own)).toBe('allow');
  expect(judge('App', { action: 'command', command: '/mode auto' }, ctx(own))).toMatchObject({ decision: 'allow', self: true, why: 'Bypass on hearth: the app may drive itself' });
  // the door's two files stay shut
  expect(d('Write', { path: '.agentic-coder/door.key' }, { ...own, rel: '.agentic-coder/door.key' })).toBe('deny');
  expect(d('Bash', { command: 'cp x .agentic-coder/trust.json' }, own)).toBe('deny');
  // and so do the own files that could lift the limits the owner kept: a hook runs outside the fence, the rules hold
  // their never-list, an MCP server is a program of its own. With self (Claude) they are open, as before.
  expect(OWN_LOCKED).toEqual(['door.key', 'trust.json', 'hooks.json', 'hooks-state.json', 'permissions.json', 'mcp.json', 'mcp-state.json']);
  expect([ownLockedBy('.agentic-coder/hooks.json'), ownLockedBy('.agentic/mcp.json'), ownLockedBy('.agentic-coder/settings.json'), ownLockedBy('.agentic-coder/skills/x.md')]).toEqual(['hooks.json', 'mcp.json', null, null]);
  for (const f of ['.agentic-coder/hooks.json', '.agentic-coder/permissions.json', '.agentic-coder/mcp.json', '.agentic/hooks.json', '.agentic/mcp.json']) {
    const no = decide('Write', { path: f }, ctx({ ...own, rel: f }));
    expect([f, no.decision]).toEqual([f, 'deny']);
    expect(no.reason).toContain('could lift the limits you work under here');
    expect([f, d('Write', { path: f }, { rel: f })]).toEqual([f, 'allow']); // self
  }
  expect(decide('Bash', { command: 'cp x .agentic-coder/hooks.json' }, ctx(own)).reason).toContain('it names hooks.json, one of the files that could lift the limits');
  expect(d('Bash', { command: 'cp x .agentic-coder/hooks.json' })).toBe('allow'); // self
  for (const f of ['.agentic-coder/settings.json', '.agentic-coder/skills/deploy.md', '.agentic-coder/rules/remote/NOTES.md', '.agentic/settings.json']) expect([f, d('Write', { path: f }, { ...own, rel: f })]).toEqual([f, 'allow']);
  // what self opens and own does not: a push still asks, stopping processes and a force push stay blocked
  expect(decide('Bash', { command: 'git push origin main' }, ctx(own))).toMatchObject({ decision: 'ask', once: true });
  expect(decide('Bash', { command: 'pkill -f agentic-coder' }, ctx(own)).reason).toContain('stopping processes');
  expect(decide('Bash', { command: 'git push -f origin main' }, ctx(own)).reason).toContain('force push');
  for (const c of ['rm -rf build', 'sudo ls', 'cat ~/.ssh/id_rsa']) expect(d('Bash', { command: c }, own)).toBe('deny');
  expect(d('Bash', { command: 'npm publish' }, { ...own, rules: { never: ['npm publish'] } })).toBe('deny');
  // own means nothing without Bypass
  expect(d('Write', { path: '.agentic/settings.json' }, { ...own, mode: 'auto', rel: '.agentic/settings.json' })).not.toBe('allow');
  expect(d('App', { action: 'restart' }, { ...own, mode: 'auto' })).toBe('deny');
  const t = permissionsTable({ mode: 'bypass', own: true });
  expect(t).toContain("on hearth: Agentic Coder's own settings and the App tool are open (a git push still asks, and what already runs is never stopped)");
  expect(t).toContain('The App tool: a slash command (not /permissions, /hooks or /mcp), a setting, a restart on new code');
  expect(t).toContain('its own files are open to you here');
  expect(t).toContain('only its hooks, the permission rules, the MCP servers, door.key and trust.json stay locked');
  expect(t).toContain('stopping processes could stop your running servers'); // still on the blocked list
  expect(permissionsTable({ mode: 'bypass' })).not.toContain('The App tool');
});
