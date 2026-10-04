// Your own hooks (agent/user-hooks.mjs; /hooks, hooks-form.mjs): Claude Code's layout read and
// written, the answers a hook gives (exit 0, exit 2, JSON), a project's file only after a yes,
// and whole conversations on a scripted model with a hook at each moment.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHooks, hooksBlock, readUserHooks, writeUserHooks, readProjectHooks, answerProjectHooks, matches, toolInput, runHook, readOutcome, UserHooks, EVENTS } from '../src/agent/user-hooks.mjs';
import { openHooksList, hookListRows, openHookForm, moveHookRow, toHook, hookWarning, testHookForm, hookFormRows, rowWindow } from '../src/app/hooks-form.mjs';
import { protectedBy, ownBy } from '../src/agent/permissions.mjs';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const dir = (p = 'agentic-hooks-') => mkdtempSync(join(tmpdir(), p));
const CLAUDE_FILE = { hooks: {
  PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check.sh' }] }, { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'guard.sh', timeout: 5 }] }],
  PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'prettier --write', off: true }] }],
  Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
  SomethingElse: [{ hooks: [{ type: 'command', command: 'ignored' }] }],
} };

test("Claude Code's layout is read, alone or inside { hooks }, and written back the same", () => {
  const r = parseHooks(JSON.stringify(CLAUDE_FILE));
  expect(r.list).toEqual([
    { event: 'PreToolUse', matcher: 'Bash', command: 'check.sh' },
    { event: 'PreToolUse', matcher: 'Edit|Write', command: 'guard.sh', timeout: 5 },
    { event: 'PostToolUse', matcher: 'Edit|Write', command: 'prettier --write', off: true },
    { event: 'Stop', matcher: '', command: 'say done' },
  ]);
  expect(parseHooks(JSON.stringify(CLAUDE_FILE.hooks)).list).toEqual(r.list);
  const back = hooksBlock(r.list);
  expect(back.PreToolUse).toEqual(CLAUDE_FILE.hooks.PreToolUse.map((g) => ({ ...g, hooks: g.hooks.map((h) => ({ type: 'command', ...h })) })));
  expect(back.Stop).toEqual([{ hooks: [{ type: 'command', command: 'say done' }] }]);
  expect(parseHooks('{not json').error).toMatch(/^it is not JSON/);
  expect(EVENTS.map((e) => e.id)).toEqual(['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'Notification', 'SessionStart', 'SessionEnd']);
  // Yours: written next to what else the file held.
  const home = dir();
  writeFileSync(join(home, 'hooks.json'), JSON.stringify({ note: 'mine', hooks: {} }));
  writeUserHooks(r.list, home);
  const saved = JSON.parse(readFileSync(join(home, 'hooks.json'), 'utf8'));
  expect(saved.note).toBe('mine');
  expect(readUserHooks(home).list).toEqual(r.list);
  writeFileSync(join(home, 'hooks.json'), '[');
  expect(readUserHooks(home).error).toMatch(/hooks\.json cannot be used: it is not JSON/);
  rmSync(home, { recursive: true });
});

test("matchers: a pattern over the whole name, the tool's Claude Code names too; what a hook is told", () => {
  expect(matches('', 'Bash')).toBe(true);
  expect(matches('*', 'Read')).toBe(true);
  expect(matches('Edit|Write', 'Write')).toBe(true);
  expect(matches('Edit', 'EditX')).toBe(false);
  expect(matches('Grep', 'Search')).toBe(true);
  expect(matches('Glob', 'List')).toBe(true);
  expect(matches('Task', 'Agent')).toBe(true);
  expect(matches('mcp__shop__.*', 'mcp__shop__get_ticket')).toBe(true);
  expect(matches('(', '(')).toBe(true); // not a pattern: the name itself
  expect(toolInput('Edit', { path: 'src/a.js', old_text: 'x', new_text: 'y' }, '/p')).toEqual({ path: 'src/a.js', old_text: 'x', new_text: 'y', file_path: '/p/src/a.js', old_string: 'x', new_string: 'y' });
  expect(toolInput('Bash', { command: 'ls', background: true })).toEqual({ command: 'ls', background: true, run_in_background: true });
});

test('what a hook answers: exit 0, exit 2 with stderr, JSON decisions, context, an error, out of time', async () => {
  const cwd = dir();
  const run = (command, event = 'PreToolUse', timeout) => runHook({ event, command, ...(timeout ? { timeout } : {}) }, { hook_event_name: event, tool_name: 'Bash', tool_input: { command: 'rm -rf x' } }, { cwd });
  const read = await run('cat > input.json; echo ok');
  expect(read.code).toBe(0);
  expect(JSON.parse(readFileSync(join(cwd, 'input.json'), 'utf8')).tool_input.command).toBe('rm -rf x');
  expect(readOutcome('PreToolUse', read)).toEqual({ allow: false, ask: false, reason: '', context: 'ok' });
  expect(readOutcome('PreToolUse', await run('echo "no rm here" >&2; exit 2'))).toEqual({ block: true, reason: 'no rm here' });
  expect(readOutcome('PreToolUse', await run(`echo '{"decision":"block","reason":"not today"}'`))).toEqual({ block: true, reason: 'not today' });
  expect(readOutcome('PreToolUse', await run(`echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"denied by policy"}}'`))).toEqual({ block: true, reason: 'denied by policy' });
  expect(readOutcome('PreToolUse', await run(`echo '{"hookSpecificOutput":{"permissionDecision":"allow"}}'`)).allow).toBe(true);
  expect(readOutcome('PreToolUse', await run(`echo '{"hookSpecificOutput":{"permissionDecision":"ask","permissionDecisionReason":"check it"}}'`))).toMatchObject({ ask: true, reason: 'check it' });
  expect(readOutcome('UserPromptSubmit', await run(`echo '{"hookSpecificOutput":{"additionalContext":"today is Friday"}}'`, 'UserPromptSubmit')).context).toBe('today is Friday');
  expect(readOutcome('PreToolUse', await run('echo broken >&2; exit 3'))).toEqual({ error: 'it exited with code 3: broken' });
  const slow = await run('sleep 5', 'PreToolUse', 1);
  expect(slow.timedOut).toBe(true);
  expect(readOutcome('PreToolUse', slow)).toEqual({ error: 'it ran out of time' });
  rmSync(cwd, { recursive: true });
});

test("a project's own hooks run only after a yes to that very file; a change asks again; never holds", () => {
  const home = dir();
  const cwd = dir();
  expect(readProjectHooks(cwd, home)).toBe(null);
  mkdirSync(join(cwd, '.agentic'));
  writeFileSync(join(cwd, '.agentic', 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo theirs' }] }] } }));
  const p = readProjectHooks(cwd, home);
  expect(p.answer).toBe(null);
  expect(p.list).toEqual([{ event: 'Stop', matcher: '', command: 'echo theirs' }]);
  expect(new UserHooks({ cwd, home }).has('Stop')).toBe(false);
  answerProjectHooks(cwd, p.print, 'yes', home);
  const h = new UserHooks({ cwd, home });
  expect(h.has('Stop')).toBe(true);
  expect(h.list[0].project).toBe(true);
  writeFileSync(join(cwd, '.agentic', 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'curl evil' }] }] } }));
  const changed = readProjectHooks(cwd, home);
  expect(changed).toMatchObject({ answer: null, changed: true });
  expect(h.reload().has('Stop')).toBe(false);
  answerProjectHooks(cwd, changed.print, 'never', home);
  writeFileSync(join(cwd, '.agentic', 'hooks.json'), JSON.stringify({ hooks: {} }));
  expect(readProjectHooks(cwd, home).answer).toBe('never');
  // The model may never write either hooks file.
  expect(protectedBy('.agentic/hooks.json')).toBeTruthy();
  expect(ownBy('.agentic/hooks.json')).toBeTruthy();
  rmSync(home, { recursive: true });
  rmSync(cwd, { recursive: true });
});

test('/hooks: the list (yours, + Add, the checks), the form, a test run and the hook it keeps', async () => {
  const home = dir();
  const cwd = dir();
  writeUserHooks([{ event: 'PreToolUse', matcher: 'Bash', command: 'echo hi' }], home);
  const hooks = new UserHooks({ cwd, home });
  const pk = openHooksList({ hooks, checks: new Set(['tests']), way: 'model' });
  const rows = hookListRows(pk);
  expect(rows.slice(0, 3).map((r) => r.id)).toEqual(['yours:0', 'add', 'check:empty']);
  expect(rows.filter((r) => r.check).length).toBeGreaterThan(10);
  expect(rowWindow(rows, 0, 5)).toMatchObject({ start: 0, above: 0 });
  expect(rowWindow(rows, rows.length - 1, 5).below).toBe(0);
  let f = openHookForm(pk);
  expect(hookFormRows(f).map((r) => r.id)).toEqual(['event', 'matcher', 'command', 'timeout', 'test', 'save']);
  expect(hookWarning(f).text).toContain('Write the command');
  f = { ...f, values: { ...f.values, matcher: 'Edit|(', command: 'echo stop >&2; exit 2' } };
  expect(hookWarning(f).tone).toBe('error');
  f = { ...f, values: { ...f.values, matcher: 'Bash' } };
  expect(hookWarning(f)).toBe(null);
  const t = await testHookForm(f, { cwd });
  expect(t.ok).toBe(true);
  expect(t.lines[0]).toMatch(/^✔ exit 2 in \d+ ms: it would stop the step, saying: stop$/);
  const stop = moveHookRow(f, 'event', 3);
  expect(stop.values.event).toBe('Stop');
  expect(hookFormRows(stop).map((r) => r.id)).not.toContain('matcher');
  expect(toHook(stop)).toEqual({ event: 'Stop', matcher: '', command: 'echo stop >&2; exit 2' });
  expect(toHook(moveHookRow(f, 'timeout', 1))).toEqual({ event: 'PreToolUse', matcher: 'Bash', command: 'echo stop >&2; exit 2', timeout: 120 });
  const ctx = await testHookForm({ ...f, values: { ...f.values, event: 'UserPromptSubmit', command: 'echo "it is Friday"' } }, { cwd });
  expect(ctx.lines).toEqual([expect.stringMatching(/^✔ exit 0 in \d+ ms: it would let it go on$/), 'goes with the message: it is Friday']);
  rmSync(home, { recursive: true });
  rmSync(cwd, { recursive: true });
});

// ---- whole conversations --------------------------------------------------------------------------

async function withHooks(list, replies, { mode = 'bypass', answer = 'yes' } = {}) {
  const home = dir();
  const cwd = dir();
  writeFileSync(join(cwd, 'notes.txt'), 'alpha\nbeta\n');
  writeUserHooks(list, home);
  const fake = await startFakeServer(replies);
  const notes = [];
  const asked = [];
  const userHooks = new UserHooks({ cwd, home, onNote: (t) => notes.push(t) });
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, ctx: 32768, mode, flows: false, way: 'model', hooks: [], verify: false, userHooks,
    ask: async (req) => { asked.push(req.name); return { choice: answer }; } });
  const tools = [];
  agent.on('tool', (e) => tools.push(e));
  agent.on('note', (e) => notes.push(e.text));
  const chats = () => fake.requests.filter((r) => r.stream && r.messages);
  const done = () => { fake.close(); rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); };
  return { agent, fake, cwd, notes, asked, tools, chats, done };
}

test('before a step: exit 2 stops it and the model is told why; allow skips the question', async () => {
  const w = await withHooks([{ event: 'PreToolUse', matcher: 'Bash', command: 'grep -q "rm -rf" && { echo "rm -rf is not allowed here" >&2; exit 2; } || exit 0' }], [
    { tool: { name: 'Bash', args: { command: 'rm -rf build' } } },
    { tool: { name: 'Bash', args: { command: 'echo fine' } } },
    { text: 'Done.' },
  ]);
  await w.agent.send('Clean up.');
  expect(w.tools.map((t) => `${t.name}${t.error ? ' ✗' : ''}`)).toEqual(['Bash ✗', 'Bash']);
  expect(w.tools[0].view).toEqual({ kind: 'denied', message: 'your hook: rm -rf is not allowed here' });
  expect(w.chats()[1].messages.at(-1).content).toBe("A hook of the user's stopped this Bash: rm -rf is not allowed here. Do something else, or ask the user.");
  w.done();
  // Manual mode with "no" to every question: a hook's allow runs it without asking.
  const a = await withHooks([{ event: 'PreToolUse', matcher: 'Bash', command: `echo '{"hookSpecificOutput":{"permissionDecision":"allow"}}'` }], [
    { tool: { name: 'Bash', args: { command: 'touch made.txt' } } },
    { text: 'Done.' },
  ], { mode: 'ask', answer: 'no' });
  await a.agent.send('Make a file.');
  expect(a.asked).toEqual([]);
  expect(existsSync(join(a.cwd, 'made.txt'))).toBe(true);
  a.done();
});

test('after a step: a formatter that changes the edited file is said with its lines, and the next Edit lands', async () => {
  const w = await withHooks([
    { event: 'PostToolUse', matcher: 'Edit|Write', command: `f=$(sed -n 's/.*"file_path":"\\([^"]*\\)".*/\\1/p'); printf '%s\\n' "$(cat "$f")" "formatted" > "$f.tmp" && mv "$f.tmp" "$f"` },
    { event: 'PostToolUse', matcher: 'Bash', command: 'echo "remember to run the tests" >&2; exit 2' },
  ], [
    { tool: { name: 'Read', args: { path: 'notes.txt' } } },
    { tool: { name: 'Edit', args: { path: 'notes.txt', old_text: 'alpha', new_text: 'ALPHA' } } },
    { tool: { name: 'Edit', args: { path: 'notes.txt', old_text: 'formatted', new_text: 'FORMATTED' } } },
    { tool: { name: 'Bash', args: { command: 'echo built' } } },
    { text: 'Done.' },
  ]);
  await w.agent.send('Capitalise alpha in notes.txt.');
  expect(w.tools.map((t) => `${t.name}${t.error ? ' ✗' : ''}`)).toEqual(['Read', 'Edit', 'Edit', 'Bash']);
  const afterEdit = w.chats()[2].messages.at(-1).content;
  expect(afterEdit).toContain("(A hook of the user's changed notes.txt after this Edit; this counts as reading it:");
  expect(afterEdit).toMatch(/Line 3 now reads[^\n]*:\n3: formatted/);
  const afterBash = w.chats()[4].messages.at(-1).content;
  expect(afterBash).toContain("(A hook of the user's says: remember to run the tests)");
  // The formatter ran after each Edit: the second one's line is its own.
  expect(readFileSync(join(w.cwd, 'notes.txt'), 'utf8')).toBe('ALPHA\nbeta\nFORMATTED\nformatted\n');
  w.done();
});

test('your message: exit 2 keeps it from being sent; what a hook prints goes with it, as does the start', async () => {
  const w = await withHooks([
    { event: 'UserPromptSubmit', command: 'grep -q secret && { echo "that has a secret in it" >&2; exit 2; } || echo "the user is on the night shift"' },
    { event: 'SessionStart', command: 'echo "branch: main"' },
  ], [{ text: 'Hello.' }]);
  expect(await w.agent.send('here is my secret key')).toBe('blocked');
  expect(w.chats().length).toBe(0);
  expect(w.notes).toContain('Your hook stopped this message, so it was not sent: that has a secret in it');
  await w.agent.startSession('startup');
  await w.agent.send('Hi there, what can you do?');
  const sent = w.chats()[0].messages.filter((m) => m.role === 'user').at(-1).content;
  expect(sent).toBe("Hi there, what can you do?\n\n(From the user's hook: the user is on the night shift)\n\n(From the user's hook at the start: branch: main)");
  w.done();
});

test('a reply that ends: a Stop hook sends it back once with what it says; a question pings a Notification hook', async () => {
  const w = await withHooks([
    { event: 'Stop', command: 'if [ -f stopped-once ]; then exit 0; fi; touch stopped-once; echo "the changelog is not updated" >&2; exit 2' },
    { event: 'Notification', command: 'cat > pinged.json' },
  ], [
    { text: 'All done.' },
    { tool: { name: 'Write', args: { path: 'CHANGELOG.md', content: '- changed\n' } } },
    { text: 'Updated the changelog too.' },
  ], { mode: 'ask' });
  await w.agent.send('Finish the release notes.');
  expect(w.notes).toContain('Your stop hook sent it back: the changelog is not updated');
  const back = w.chats()[1].messages.filter((m) => m.role === 'user').at(-1).content;
  expect(back).toContain("A hook of the user's says the work is not done: the changelog is not updated. Carry on, then report.");
  expect(existsSync(join(w.cwd, 'CHANGELOG.md'))).toBe(true);
  expect(w.asked).toEqual(['Write']);
  await new Promise((r) => setTimeout(r, 300));
  expect(JSON.parse(readFileSync(join(w.cwd, 'pinged.json'), 'utf8'))).toMatchObject({ hook_event_name: 'Notification', message: 'Agentic Coder needs your permission to use Write' });
  w.done();
});
