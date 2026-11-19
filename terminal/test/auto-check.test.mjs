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

test('the checker is a model of its own: the cheapest Claude on the Claude API, the second opinion on a service, else the main one', async () => {
  const { checkerUse } = await import('../src/agent/auto-check.mjs');
  expect(checkerUse({ claude: true, main: 'claude-opus-5-5' })).toEqual({ model: 'claude-haiku-4-5' });
  expect(checkerUse({ claude: true, main: 'claude-haiku-4-5' })).toBe(undefined); // the main one is it already
  const review = { model: 'qwen3:4b', numCtx: 32768 };
  expect(checkerUse({ review })).toBe(review);
  expect(checkerUse({ review: undefined })).toBe(undefined);
  expect(checkerUse({})).toBe(undefined);
});

test('the checker is asked by name; one that cannot answer hands the check to the main model once', async () => {
  const uses = [];
  const ok = await autoCheck({ ...base, use: { model: 'claude-haiku-4-5' }, ask: async (a) => { uses.push(a.use?.model ?? 'main'); return { json: { verdict: 'run', reason: 'fits' } }; } });
  expect([ok.run, ok.by, uses]).toEqual([true, 'claude-haiku-4-5', ['claude-haiku-4-5']]);
  uses.length = 0;
  const handed = await autoCheck({ ...base, use: { model: 'qwen3:4b' }, ask: async (a) => { uses.push(a.use?.model ?? 'main'); if (a.use) throw new Error('model not found'); return { json: { verdict: 'ask', reason: 'not asked for' } }; } });
  expect([handed.run, handed.by, handed.reason, uses]).toEqual([false, null, 'not asked for', ['qwen3:4b', 'main']]);
  // No checker: the main model, and by is null.
  expect((await autoCheck({ ...base, ask: said({ verdict: 'run', reason: 'x' }) })).by).toBe(null);
  // Out of time with the checker: no second try, it asks you.
  const slow = (a) => new Promise((_, no) => a.signal.addEventListener('abort', () => no(new Error('aborted'))));
  expect(await autoCheck({ ...base, use: { model: 'x' }, timeoutMs: 30, ask: slow })).toMatchObject({ run: false, reason: 'the check took too long', failed: true });
});

test('the steps in words: a web search and a page by their words and address', () => {
  expect(stepText('WebSearch', { query: 'left-pad license' })).toBe('Search the web for: left-pad license');
  expect(stepText('WebFetch', { url: 'https://example.org/a' })).toBe('Read this web page: https://example.org/a');
});
