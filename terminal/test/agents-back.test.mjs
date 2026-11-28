// Agents as Claude Code's work (28 Nov 2026, the owner: "fable deployed sub agents to help it, i want hearth to do the same"): each
// helper agent has a name and is kept when it ends, so the Agent tool's agent: <name> sends it back to work with everything it already
// read and did; background: true runs it as a background job (tools/jobs.mjs startAgent): the reply goes on, Jobs lists it, shows its
// steps and stops it, and its report wakes the model when it ends. Against a stand-in server (fake-server.mjs).
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-agents-back-home-'));
process.env.AGENTIC_MEMORY_SAVE ??= 'off';
const { Jobs } = await import('../src/tools/jobs.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { AGENT_TOOL_DEF, agentToolDef } = await import('../src/agent/tools-defs.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');
const { startFakeServer } = await import('./fake-server.mjs');

const dir = () => {
  const d = mkdtempSync(join(tmpdir(), 'agentic-agents-back-'));
  writeFileSync(join(d, 'a.mjs'), 'export const a = 1;\n');
  return d;
};
const until = async (ok, ms = 8000) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25)); return ok(); };
// route: a helper's requests answered by who asks, not by when they come (fake-server.mjs), for agents that work beside the reply.
function agentIn(d, replies, opts = {}) {
  return startFakeServer(replies, opts).then((fake) => {
    const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd: d, system: systemPrompt({ cwd: d, git: 'test' }), thinking: false, ctx: 32768, mode: 'bypass', flows: false, way: 'model', hooks: [], verify: false, subagents: true, ask: async () => ({ choice: 'yes' }) });
    agent.jobs.firstMs = 100;
    return { agent, fake };
  });
}
const chats = (fake) => fake.requests.filter((r) => r.stream && r.messages);
const isHelper = (req) => String(req.messages[0]?.content ?? '').includes('# You are a helper');

test('the Agent tool sends one back by name and runs one in the background; with your helpers or hearth\'s sizes too', () => {
  for (const def of [AGENT_TOOL_DEF, agentToolDef([{ kind: 'reviewer', about: 'reviews' }]), agentToolDef([], { sizes: true })]) {
    expect(def.parameters.properties.background.type).toBe('boolean');
    expect(def.parameters.properties.agent.type).toBe('string');
    expect(def.parameters.required).toEqual(['prompt']);
  }
});

test('a background agent is a job: its steps at each look, its report when it ends, a stop that ends it; a fifth at once is refused', async () => {
  const ended = [];
  const jobs = new Jobs({ onEnd: (j) => ended.push(j) });
  let release;
  const { job } = jobs.startAgent(async (signal, say) => {
    say('⏺ Read(a.mjs)');
    await new Promise((r) => (release = r));
    say('⏺ Search(parse)');
    return { text: 'agent1, the explore helper: its report: found it at a.mjs:1.' };
  }, { description: 'find the parser', name: 'agent1' });
  expect(job).toMatchObject({ id: 'job1', agent: 'agent1', command: 'agent agent1: find the parser', ended: null });
  await until(() => job.out.length > 0);
  expect(jobs.look(job).lines).toEqual(['⏺ Read(a.mjs)']);
  expect(jobs.line(job)).toMatch(/^job1 · running \d+ s · agent agent1: find the parser$/);
  release();
  expect(await until(() => job.ended)).toBeTruthy();
  expect(job).toMatchObject({ code: 0, report: 'agent1, the explore helper: its report: found it at a.mjs:1.' });
  expect(jobs.look(job).lines).toEqual(['⏺ Search(parse)']);
  expect(ended.map((j) => j.id)).toEqual(['job1']);
  // A stop aborts its signal, and it ends as stopped.
  const { job: long } = jobs.startAgent((signal) => new Promise((r) => signal.addEventListener('abort', () => r({ text: 'stopped early', error: true }), { once: true })), { name: 'agent2' });
  await until(() => false, 50);
  expect(jobs.stop(long, 'model')).toBe(true);
  expect(await until(() => long.ended)).toBeTruthy();
  expect(long).toMatchObject({ stopped: 'model', code: 1, report: 'stopped early' });
  // One stopped before its run began ends at once, as stopped.
  const { job: early } = jobs.startAgent(async () => ({ text: 'never' }), { name: 'agent8' });
  jobs.stop(early, 'model');
  expect(await until(() => early.ended)).toBeTruthy();
  expect(early).toMatchObject({ stopped: 'model', code: 1, report: 'It was stopped before it started.' });
  // At most MAX_RUNNING at once, commands and agents together.
  const hold = [];
  for (let i = 0; i < 4; i++) hold.push(jobs.startAgent((signal) => new Promise((r) => signal.addEventListener('abort', () => r({ text: '' }), { once: true })), { name: `agent${i + 3}` }));
  expect(hold.every((x) => x.job)).toBe(true);
  expect(jobs.startAgent(async () => ({ text: '' }), { name: 'agent9' }).error).toContain('background jobs are running already');
  jobs.stopAll();
  expect(await until(() => hold.every((x) => x.job.ended))).toBe(true);
}, 20000);

test('an agent sent back by name goes on from its own conversation: its task, its report, then the new words; an unknown name is refused', async () => {
  const d = dir();
  const { agent, fake } = await agentIn(d, [
    { tool: { name: 'Agent', args: { description: 'find the setting', prompt: 'Find where a is set and report the file and line.', kind: 'explore' } } },
    { text: 'a is set in a.mjs:1.' },
    { tool: { name: 'Agent', args: { agent: 'agent1', prompt: 'Now say what its value is.' } } },
    { text: 'Its value is 1 (a.mjs:1).' },
    { tool: { name: 'Agent', args: { agent: 'agent7', prompt: 'Do it.' } } },
    { text: 'It is 1.' },
  ]);
  await agent.send('use a helper to find a, then ask it its value');
  const all = chats(fake);
  const helpers = all.filter(isHelper);
  expect(helpers.length).toBe(2);
  // The second time, the same helper's own conversation: its task, its report, then the new words, and nothing of the user's.
  const back = helpers[1].messages;
  // (A message may carry the app's own mode note after it.)
  expect(back.filter((m) => m.role === 'user').map((m) => String(m.content).split('\n')[0])).toEqual(['Find where a is set and report the file and line.', 'Now say what its value is.']);
  expect(back.some((m) => m.role === 'assistant' && m.content === 'a is set in a.mjs:1.')).toBe(true);
  expect(JSON.stringify(back)).not.toContain('use a helper to find a');
  // What came back to the conversation: each report under its name, with how to send it back; an unknown name, refused.
  const results = all.filter((q) => !isHelper(q)).at(-1).messages.filter((m) => m.role === 'tool').map((m) => m.content);
  expect(results[0]).toContain("The explore helper's report");
  expect(results[0]).toContain('(It is agent1: send it back with the Agent tool\'s agent: "agent1" and a new prompt');
  expect(results[1]).toContain('Its value is 1 (a.mjs:1).');
  expect(results[2]).toBe('There is no agent "agent7" to send back. Yours: agent1.');
  await fake.close();
  rmSync(d, { recursive: true, force: true });
});

test('a background agent: the reply goes on, Jobs shows it, and its report wakes the model when it ends', async () => {
  const d = dir();
  const { agent, fake } = await agentIn(d, [
    { tool: { name: 'Agent', args: { description: 'look at a', prompt: 'Report what a.mjs exports.', kind: 'explore', background: true } } },
    { text: 'I sent an agent to look at a.mjs.' },
    { text: 'The agent found that a.mjs exports a.' },
  ], { route: (req) => (isHelper(req) ? { text: 'a.mjs exports a (a.mjs:1).' } : null) });
  const waits = [];
  agent.on('jobs-waiting', (e) => waits.push(e));
  await agent.send('look at a.mjs in the background');
  const first = chats(fake).filter((q) => !isHelper(q));
  const said = first.at(-1).messages.filter((m) => m.role === 'tool').map((m) => m.content);
  expect(said[0]).toMatch(/^agent1 works in the background as job1: you will be told when it ends, with its report\./);
  expect(await until(() => waits.length === 1)).toBe(true);
  const job = agent.jobs.get('job1');
  expect(job).toMatchObject({ agent: 'agent1', code: 0 });
  expect(job.report).toContain('a.mjs exports a (a.mjs:1).');
  const w = agent.jobWake();
  expect(w.shown).toBe('job1 ended');
  expect(w.text).toMatch(/^\(From Agentic Coder, not the user: background agent agent1 \(job1\) ended after \d+ s\. agent1's report \(explore, \d+ steps?, \d+ s\):\n/);
  expect(w.text).toContain('A background agent you started finished after your last reply. Check what it says it found before you act on it');
  await agent.send(w.text, { shown: w.shown, wake: true });
  expect(chats(fake).at(-1).messages.at(-1).content).toContain('background agent agent1 (job1) ended');
  // Kept: it can be sent back once it has ended.
  expect(agent.agentName({ agent: 'agent1' })).toMatchObject({ name: 'agent1' });
  await fake.close();
  rmSync(d, { recursive: true, force: true });
});
