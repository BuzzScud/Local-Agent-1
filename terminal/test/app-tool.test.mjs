// The App tool (agent/tools.mjs appTool): Agentic Coder drives itself while it works on itself
// (permissions.mjs isSelf). A slash command runs as typed and its notes come back; a setting is read
// or set through the window's bridge; restart hands over to the bridge and says the turn restarted.
// Outside self, or with no window (a helper, headless), it refuses and says so.
import { test, expect } from 'bun:test';
import { execute, APP_NOT, APP_TOOL_DEF, toolSchemas, display } from '../src/agent/tools.mjs';

const calls = [];
const bridge = {
  command: async (line) => { calls.push(['command', line]); return { notes: [`Mode: Auto`, ''] }; },
  setting: async (key, value) => { calls.push(['setting', key, value]); return value === undefined ? { value: key ? 'high' : { effort: 'high' } } : { was: 'high', value, note: 'Saved to settings.json; a restart picks it up.' }; },
  restart: async (reason) => { calls.push(['restart', reason]); return { ok: true }; },
};
const env = (over = {}) => ({ cwd: '/p', app: bridge, permissionsNow: () => ({ mode: 'bypass', self: true }), ...over });
const run = (args, e = env()) => execute('App', args, {}, e);

test('a slash command runs as the user would type it, and the notes the screen showed come back', async () => {
  calls.length = 0;
  const r = await run({ action: 'command', command: '/mode auto' });
  expect(r.error).toBeUndefined();
  expect(r.text).toBe('Mode: Auto');
  expect(r.view).toEqual({ kind: 'app', what: '/mode auto', lines: ['Mode: Auto'] });
  expect(calls).toEqual([['command', '/mode auto']]);
  // one that would end or replace this conversation is refused, with what to do instead
  for (const c of ['/exit', '/clear', '/resume', '/rewind']) expect((await run({ action: 'command', command: c })).error).toBe(true);
  expect((await run({ action: 'command', command: '/update' })).text).toContain('use action restart');
  expect((await run({ action: 'command', command: 'mode auto' })).text).toContain('starting with /');
  expect(APP_NOT.has('exit')).toBe(true);
});

test('a setting is read (one key, or all) or set through the bridge, and the answer says what changed', async () => {
  calls.length = 0;
  expect((await run({ action: 'setting', key: 'effort' })).text).toBe('effort = "high"');
  expect((await run({ action: 'setting' })).text).toContain('"effort": "high"');
  const set = await run({ action: 'setting', key: 'effort', value: 'low' });
  expect(set.text).toBe('effort was "high", now "low". Saved to settings.json; a restart picks it up.');
  expect(calls.at(-1)).toEqual(['setting', 'effort', 'low']);
});

test('restart hands the reason to the bridge, says the conversation is picked back up, and marks the turn restarted', async () => {
  calls.length = 0;
  const r = await run({ action: 'restart', reason: 'the new permissions row, tests pass' });
  expect(r.restarted).toBe(true);
  expect(r.text).toContain('picked back up');
  expect(calls).toEqual([['restart', 'the new permissions row, tests pass']]);
  const no = await run({ action: 'restart' }, env({ app: { ...bridge, restart: async () => ({ error: 'This window was not started by the coding command' }) } }));
  expect(no.error).toBe(true);
  expect(no.text).toContain('not started by the coding command');
  expect((await run({ action: 'dance' })).text).toContain('action must be command, setting or restart');
});

test('outside self, or with no window to drive, the tool refuses and says so', async () => {
  const off = await run({ action: 'command', command: '/mode auto' }, env({ permissionsNow: () => ({ mode: 'bypass', self: false }) }));
  expect(off.error).toBe(true);
  expect(off.text).toContain('Bypass permissions on the Claude API');
  const alone = await run({ action: 'command', command: '/mode auto' }, env({ app: null }));
  expect(alone.error).toBe(true);
  expect(alone.text).toContain('no window to drive');
});

test('the tool is offered only in self; its label names what it does', () => {
  const names = (o) => toolSchemas('app', null, o).map((t) => t.function?.name ?? t.name);
  expect(names({ self: true })).toContain('App');
  expect(names({ self: false })).not.toContain('App');
  expect(names({})).not.toContain('App');
  expect(APP_TOOL_DEF.name).toBe('App');
  expect(display('App', { action: 'command', command: '/hooks lean' })).toEqual({ label: 'App', arg: '/hooks lean' });
  expect(display('App', { action: 'setting', key: 'effort', value: 'low' })).toEqual({ label: 'App', arg: 'setting effort = "low"' });
  expect(display('App', { action: 'restart' })).toEqual({ label: 'App', arg: 'restart on the new code' });
});
