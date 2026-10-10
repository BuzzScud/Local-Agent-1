// Background commands (tools/jobs.mjs; Bash with background: true, the Jobs tool) and a command's
// own time limit: a job keeps running while the model works; its end is told with the next step,
// or, once the reply is over, as a message of its own; one it stopped is not news.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Jobs, MAX_RUNNING, capLines, took } from '../src/tools/jobs.mjs';
import { execute, parseArgs, secsOf, toolSchemas, MAX_TIMEOUT_SECS } from '../src/agent/tools.mjs';
import { decide } from '../src/agent/permissions.mjs';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'agentic-jobs-'));
const until = async (ok, ms = 8000) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25)); return ok(); };

test('a job runs in the background: its first lines, what is new at each look, its end', async () => {
  const ended = [];
  const jobs = new Jobs({ onEnd: (j) => ended.push(j), firstMs: 300 });
  const { job } = await jobs.start('echo one; sleep 0.6; echo two; exit 3', { cwd: tmpdir(), sandbox: false });
  expect(job.id).toBe('job1');
  expect(job.ended).toBe(null);
  expect(jobs.look(job).lines).toEqual(['one']);
  expect(jobs.look(job).lines).toEqual([]);
  expect(await until(() => job.ended)).toBeTruthy();
  expect(job.code).toBe(3);
  expect(ended).toEqual([job]);
  expect(jobs.look(job).lines).toEqual(['two']);
  expect(jobs.line(job)).toMatch(/^job1 · ended, exit code 3 after \d+ s · echo one; sleep 0\.6/);
  expect(jobs.get('job1')).toBe(job);
  expect(jobs.get('1')).toBe(job);
  expect(jobs.get(1)).toBe(job);
  expect(jobs.get('Job 1')).toBe(job);
  expect(jobs.get('job9')).toBe(null);
});

test('a stop ends the job and all it started; a fifth at once is refused; stopAll ends the rest', async () => {
  const ended = [];
  const jobs = new Jobs({ onEnd: (j) => ended.push(j), firstMs: 50 });
  const started = [];
  for (let i = 0; i < MAX_RUNNING; i++) started.push((await jobs.start('sleep 30 & sleep 30; wait', { cwd: tmpdir(), sandbox: false })).job);
  const fifth = await jobs.start('sleep 30', { cwd: tmpdir(), sandbox: false });
  expect(fifth.error).toContain(`${MAX_RUNNING} background jobs are running already`);
  expect(fifth.error).toContain('job1, job2, job3, job4');
  expect(jobs.stop(started[0], 'model')).toBe(true);
  expect(await until(() => started[0].ended)).toBeTruthy();
  expect(started[0].stopped).toBe('model');
  expect(jobs.line(started[0])).toMatch(/^job1 · stopped after/);
  expect(jobs.stop(started[0])).toBe(false); // not running
  jobs.stopAll();
  expect(await until(() => started.every((j) => j.ended))).toBeTruthy();
  expect(started.slice(1).every((j) => j.stopped === 'quit')).toBe(true);
  expect(jobs.running()).toEqual([]);
});

test('the lines of a look: colours out, a long one cut in the middle; times in words', () => {
  expect(capLines('\x1b[32mok\x1b[0m\nnext\n')).toEqual(['ok', 'next']);
  expect(capLines('')).toEqual([]);
  const many = Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n');
  const cut = capLines(many, 10);
  expect(cut).toEqual(['l0', 'l1', 'l2', 'l3', 'l4', '… 90 lines not shown …', 'l95', 'l96', 'l97', 'l98', 'l99']);
  expect(took(4000)).toBe('4 s');
  expect(took(130_000)).toBe('2 min 10 s');
  expect(took(3_900_000)).toBe('1 h 5 min');
});

test("a command's own time limit: seconds, Claude Code's milliseconds, at most 600", () => {
  expect(secsOf(30)).toBe(30);
  expect(secsOf('45')).toBe(45);
  expect(secsOf(300000)).toBe(300);
  expect(secsOf(900)).toBe(MAX_TIMEOUT_SECS); // seconds past the cap, not 0.9 s
  expect(secsOf(3_600_000)).toBe(MAX_TIMEOUT_SECS);
  expect(secsOf(0)).toBe(null);
  expect(secsOf('soon')).toBe(null);
  expect(secsOf(undefined)).toBe(null);
  const bash = toolSchemas('app').find((t) => t.function.name === 'Bash').function;
  expect(Object.keys(bash.parameters.properties)).toEqual(['command', 'description', 'timeout', 'background']);
  // The Jobs tool is on both ways, right after the app's own tools, so the list never moves.
  for (const way of ['app', 'model']) expect(toolSchemas(way).map((t) => t.function.name)).toContain('Jobs');
  expect(decide('Jobs', { id: 'job1', stop: true }, { mode: 'plan', allowedPrefixes: new Set(), inside: true, cwd: tmpdir() }).decision).toBe('allow');
});

test('Bash timeout stops a command sooner and says how to ask for longer', async () => {
  const r = await execute('Bash', { command: 'sleep 5', timeout: 1 }, {}, { cwd: tmpdir(), bash: { timeoutMs: 120_000, maxLines: 80 } });
  expect(r.view.timedOut).toBe(true);
  expect(r.view.after).toBe('1 s');
  expect(r.text).toContain('(stopped after 1 s; for longer, send timeout (up to 600 seconds), or background: true');
});

test('Bash background and the Jobs tool: started, looked at, listed, stopped; one that ends at once is a plain command', async () => {
  const d = dir();
  const jobs = new Jobs({ firstMs: 400 });
  const env = { cwd: d, jobs, bash: { maxLines: 80 } };
  const r = await execute('Bash', { command: 'echo ready; sleep 30', background: true }, {}, env);
  expect(r.error).toBeFalsy();
  expect(r.text).toContain('Started in the background as job1. It keeps running while you work');
  expect(r.text).toContain('Its first lines:\nready');
  expect(r.view).toEqual({ kind: 'job', what: 'Running in the background as job1', lines: ['ready'] });
  const look = await execute('Jobs', { id: 'job1' }, {}, env);
  expect(look.text).toMatch(/^job1 · running \d+ s · echo ready; sleep 30\nNo new output since you last looked\./);
  const list = await execute('Jobs', {}, {}, env);
  expect(list.text).toMatch(/^job1 · running/);
  const none = await execute('Jobs', { id: 'job7' }, {}, env);
  expect(none.error).toBe(true);
  expect(none.text).toContain('There is no background job "job7"');
  const stop = await execute('Jobs', { id: 'job1', stop: 'true' }, {}, env);
  expect(stop.text).toMatch(/^Stopped job1 \(echo ready; sleep 30\) after \d+ s\. Its last lines:\nready/);
  expect(jobs.get('job1').ended).toBeTruthy();
  const again = await execute('Jobs', { id: 'job1', stop: true }, {}, env);
  expect(again.text).toMatch(/^job1 · stopped after .*: it is not running\./);
  // Claude Code's name for it, and a command that ends before the first moment is over.
  const sent = parseArgs('Bash', JSON.stringify({ command: 'echo fast; exit 2', run_in_background: true })).args;
  expect(sent.background).toBe(true);
  const quick = await execute('Bash', sent, {}, env);
  expect(quick.view.kind).toBe('bash');
  expect(quick.error).toBe(true);
  expect(quick.text).toContain('fast\n(exit code 2)\n(it ended at once, so it is not running in the background)');
  // No jobs here (a place that has none): said so.
  const no = await execute('Bash', { command: 'sleep 1', background: true }, {}, { cwd: d });
  expect(no.error).toBe(true);
  expect(no.text).toContain('Background jobs are not available here');
  jobs.stopAll({ now: true });
  rmSync(d, { recursive: true, force: true });
});

function agentIn(d, replies) {
  return startFakeServer(replies).then((fake) => {
    const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd: d, system: systemPrompt({ cwd: d, git: 'test' }), thinking: false, ctx: 32768, mode: 'bypass', flows: false, way: 'model', hooks: [], verify: false, ask: async () => ({ choice: 'yes' }) });
    agent.jobs.firstMs = 100;
    return { agent, fake };
  });
}
const toolResults = (fake, n) => fake.requests.filter((r) => r.stream && r.messages)[n].messages.filter((m) => m.role === 'tool');

test('a job that ends during the reply is told with the next step', async () => {
  const d = dir();
  writeFileSync(join(d, 'package.json'), '{"name":"x"}\n');
  const { agent, fake } = await agentIn(d, [
    { tool: { name: 'Bash', args: { command: 'sleep 0.6; echo built-ok', background: true } } },
    { tool: { name: 'Bash', args: { command: 'sleep 1.5; echo waited' } } },
    { text: 'The build finished.' },
  ]);
  const waits = [];
  agent.on('jobs-waiting', (e) => waits.push(e));
  await agent.send('Start the build in the background, then wait a moment.');
  await fake.close();
  const second = toolResults(fake, 2).at(-1).content;
  expect(second).toContain('waited');
  expect(second).toMatch(/\(Meanwhile: background job job1 \(sleep 0\.6; echo built-ok\) ended by itself: exit code 0 after \d+ s\. Its last lines:\nbuilt-ok\)/);
  await new Promise((r) => setTimeout(r, 50));
  expect(waits).toEqual([]); // told already: nothing to wake for
  expect(agent.jobNews).toEqual([]);
  rmSync(d, { recursive: true, force: true });
});

test('a job that ends after the reply wakes the model with its end; one it stopped, or of a cleared conversation, does not', async () => {
  const d = dir();
  writeFileSync(join(d, 'package.json'), '{"name":"x"}\n');
  const { agent, fake } = await agentIn(d, [
    { tool: { name: 'Bash', args: { command: 'sleep 0.5; echo tests-passed', background: true } } },
    { text: 'Started the tests in the background.' },
    { text: 'The tests passed.' },
    { tool: { name: 'Bash', args: { command: 'sleep 30', background: true } } },
    { tool: { name: 'Jobs', args: { id: 'job2', stop: true } } },
    { text: 'Stopped it.' },
  ]);
  const waits = [];
  agent.on('jobs-waiting', (e) => waits.push(e));
  const notes = [];
  agent.on('note', (n) => notes.push(n.text));
  await agent.send('Run the tests in the background.');
  expect(await until(() => waits.length === 1)).toBe(true);
  expect(notes.some((t) => /^job1 ended, exit code 0 after \d+ s: sleep 0\.5; echo tests-passed$/.test(t))).toBe(true);
  const w = agent.jobWake();
  expect(w.shown).toBe('job1 ended');
  expect(w.text).toMatch(/^\(From Agentic Coder, not the user: background job job1 \(sleep 0\.5; echo tests-passed\) ended by itself: exit code 0 after \d+ s\. Its last lines:\ntests-passed\)\nA background job you started ended after your last reply\. Carry on/);
  expect(agent.jobWake()).toBe(null); // told once
  await agent.send(w.text, { shown: w.shown, wake: true });
  // Stopped by the model: a line in its result, no news, no wake.
  await agent.send('Start a long one, then stop it.');
  await new Promise((r) => setTimeout(r, 300));
  expect(waits.length).toBe(1);
  expect(agent.jobNews).toEqual([]);
  // A job of a conversation that was cleared: its end is only a line.
  const { job } = await agent.jobs.start('sleep 0.4', { cwd: d, sandbox: false, firstMs: 10 });
  agent.reset();
  expect(await until(() => job.ended)).toBeTruthy();
  await new Promise((r) => setTimeout(r, 50));
  expect(waits.length).toBe(1);
  expect(notes.some((t) => /^job3 ended, exit code 0/.test(t))).toBe(true);
  await fake.close();
  rmSync(d, { recursive: true, force: true });
});

test('jobs that ended while nothing ran ride with your next message', async () => {
  const d = dir();
  const { agent, fake } = await agentIn(d, [{ text: 'Noted.' }]);
  agent.on('jobs-waiting', () => {}); // nobody wakes it (the app is busy elsewhere)
  const { job } = await agent.jobs.start('echo from-before', { cwd: d, sandbox: false, firstMs: 10 });
  expect(await until(() => job.ended)).toBeTruthy();
  expect(agent.jobNews.length).toBe(1);
  await agent.send('Hello there, what happened?');
  await fake.close();
  const user = fake.requests.filter((r) => r.stream && r.messages)[0].messages.filter((m) => m.role === 'user').at(-1).content;
  expect(user).toMatch(/^Hello there, what happened\?\n\n\(Meanwhile: background job job1 \(echo from-before\) ended by itself: exit code 0/);
  rmSync(d, { recursive: true, force: true });
});

test('a wait the model chose ends early when you write; any other command runs on; Esc is "stopped by you", no error', async () => {
  const { waitsFirst } = await import('../src/agent/tools.mjs');
  expect(['sleep 115; grep -E x run.log', 'sleep 60 && tail run.log', 'sleep 30', 'sleep 2m; echo ok'].map(waitsFirst)).toEqual([true, true, true, true]);
  expect(['bun run test', 'echo a; sleep 5', 'sleep 5 || echo no', 'sleep $(cat n)'].map(waitsFirst)).toEqual([false, false, false, false]);
  const d = dir();
  const heardIn = (ms) => { const ac = new AbortController(); setTimeout(() => ac.abort(), ms); return ac.signal; };
  const t0 = Date.now();
  const r = await execute('Bash', { command: 'sleep 20; echo late' }, {}, { cwd: d, bash: { maxLines: 80 }, heard: heardIn(300) });
  expect(Date.now() - t0).toBeLessThan(5000);
  expect(r.error).toBeFalsy();
  expect(r.view.heard).toBe(true);
  expect(r.text).toMatch(/^\(The wait ended early, after \d+ s: the user sent a message, which comes with this result\. The rest of the command did not run/);
  // Not a wait: a message of yours does not stop it.
  const run = await execute('Bash', { command: 'echo start; sleep 0.6; echo built' }, {}, { cwd: d, bash: { maxLines: 80 }, heard: heardIn(100) });
  expect([run.error, run.text]).toEqual([false, 'start\nbuilt']);
  // Esc (the turn's signal): stopped by you, which is not the command failing.
  const esc = await execute('Bash', { command: 'sleep 20' }, {}, { cwd: d, bash: { maxLines: 80 }, signal: heardIn(300) });
  expect([esc.error, esc.view.stopped]).toEqual([undefined, true]);
  expect(esc.text).toMatch(/^\(Stopped by the user after \d+ s\.\)$/);
  rmSync(d, { recursive: true, force: true });
}, 15_000);

test('Jobs with wait: until the job ends, until you write, or until the seconds are up', async () => {
  const d = dir();
  const jobs = new Jobs({ firstMs: 100 });
  const env = { cwd: d, jobs, bash: { maxLines: 80 } };
  await execute('Bash', { command: 'sleep 0.8; echo done-here', background: true }, {}, env);
  const t0 = Date.now();
  const ended = await execute('Jobs', { id: 'job1', wait: 30 }, {}, env);
  expect(Date.now() - t0).toBeLessThan(5000);
  expect(ended.text).toMatch(/^\(Waited \d+ s: it ended\.\)\njob1 · ended, exit code 0 after \d+ s · sleep 0\.8; echo done-here\nNew output since you last looked:\ndone-here/);
  expect(ended.view.what).toMatch(/^job1 · ended/);
  await execute('Bash', { command: 'sleep 30', background: true }, {}, env);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 300);
  const heard = await execute('Jobs', { id: 'job2', wait: 30 }, {}, { ...env, heard: ac.signal });
  expect(heard.text).toMatch(/^\(Waited \d+ s: the user sent a message, which comes with this result; answer it first\.\)\njob2 · running/);
  const up = await execute('Jobs', { id: 'job2', wait: 1 }, {}, env);
  expect(up.text).toMatch(/^\(Waited 1 s: it is still running\.\)\njob2 · running/);
  expect(toolSchemas({ way: 'model' }).find((t) => t.function?.name === 'Jobs' || t.name === 'Jobs')).toBeTruthy();
  jobs.stopAll({ now: true });
  rmSync(d, { recursive: true, force: true });
}, 15_000);

test('a message typed while it works goes with its next step, and the wait it was in ends early for it', async () => {
  const { steerable } = await import('../src/app/app-common.mjs');
  expect([steerable('eta?'), steerable('/model'), steerable('look at [Image #1]'), steerable('  '), steerable(null)]).toEqual([true, false, false, false, false]);
  const d = dir();
  writeFileSync(join(d, 'package.json'), '{"name":"x"}\n');
  const fake = await startFakeServer([
    { tool: { name: 'Bash', args: { command: 'sleep 20; grep -c pass run.log' } } },
    { text: 'About two more minutes.' },
  ]);
  let queued = null;
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd: d, system: systemPrompt({ cwd: d, git: 'test' }), thinking: false, ctx: 32768, mode: 'bypass', flows: false, way: 'model', hooks: [], verify: false, ask: async () => ({ choice: 'yes' }),
    steering: () => { const q = queued; queued = null; return steerable(q) ? [q] : []; }, waiting: () => steerable(queued) });
  const steered = [];
  agent.on('steered', (e) => steered.push(...e.notes));
  setTimeout(() => { queued = 'eta?'; agent.heard(); }, 500);
  const t0 = Date.now();
  await agent.send('Wait for the test run, then tell me how it went.');
  await fake.close();
  expect(Date.now() - t0).toBeLessThan(10_000);
  const result = toolResults(fake, 1).at(-1).content;
  expect(result).toContain('(The wait ended early, after');
  expect(result).toContain('(A note from the user, sent while you worked: eta?)');
  expect(steered).toEqual(['eta?']);
  expect(queued).toBe(null);
  rmSync(d, { recursive: true, force: true });
}, 20_000);
