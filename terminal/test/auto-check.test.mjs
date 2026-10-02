// Auto mode's check (agent/auto-check.mjs): one short call with your request, the folder
// and the step; a clear "run" lets it run, anything else asks you. The agent's side is in
// perms-agent.test.mjs.
import { test, expect } from 'bun:test';
import { autoCheck, stepText, AUTO_SYSTEM } from '../src/agent/auto-check.mjs';

const said = (json) => async () => ({ json });
const base = { url: 'x', model: {}, request: 'add the left-pad package and use it in format.js', name: 'Bash', args: { command: 'npm install left-pad', description: 'add the package' }, cwd: '/p' };

test('run or ask, in one plain sentence; the call sees only the request, the folder and the step', async () => {
  let call;
  const r = await autoCheck({ ...base, ask: async (a) => { call = a; return { json: { verdict: 'run', reason: 'Installing the package is what you asked for.' } }; } });
  expect(r.run).toBe(true);
  expect(r.reason).toBe('Installing the package is what you asked for');
  expect([call.temperature, call.thinking, call.system]).toEqual([0, false, AUTO_SYSTEM]);
  expect(call.user).toBe("The user's request:\nadd the left-pad package and use it in format.js\n\nThe project folder: /p\n\nThe step:\nRun this command in the project folder:\nnpm install left-pad\n(The assistant says it does: add the package)");
  expect(call.schema.properties.verdict.enum).toEqual(['run', 'ask']);
  const no = await autoCheck({ ...base, ask: said({ verdict: 'ask', reason: '' }) });
  expect([no.run, no.reason]).toEqual([false, 'it needs your say']);
});

test('no clear answer, an error or no answer in time: it asks you', async () => {
  expect(await autoCheck({ ...base, ask: said({ verdict: 'maybe', reason: 'x' }) })).toMatchObject({ run: false, reason: 'the check gave no clear answer', failed: true });
  expect(await autoCheck({ ...base, ask: async () => { throw new Error('500'); } })).toMatchObject({ run: false, reason: 'the check could not be made', failed: true });
  const slow = (a) => new Promise((_, no) => a.signal.addEventListener('abort', () => no(new Error('aborted'))));
  expect(await autoCheck({ ...base, timeoutMs: 30, ask: slow })).toMatchObject({ run: false, reason: 'the check took too long', failed: true });
});

test('stopping the reply stops the check too (it is not read as a no)', async () => {
  const stop = new AbortController();
  const slow = (a) => new Promise((_, no) => a.signal.addEventListener('abort', () => no(new Error('aborted'))));
  const p = autoCheck({ ...base, signal: stop.signal, ask: slow });
  stop.abort();
  await expect(p).rejects.toThrow('aborted');
});

test('the steps in words: a web search and a page by their words and address', () => {
  expect(stepText('WebSearch', { query: 'left-pad license' })).toBe('Search the web for: left-pad license');
  expect(stepText('WebFetch', { url: 'https://example.org/a' })).toBe('Read this web page: https://example.org/a');
});
