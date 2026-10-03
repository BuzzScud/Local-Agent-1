// End-to-end, the real app in a pseudo-terminal (see app.test.mjs).
// Here: /btw, a side question answered in a panel on the side lane while the
// main job goes on, like Claude Code's.
import { test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit, quitTyped } from './app-setup.mjs';

const isSide = (j) => String(j.messages?.[0]?.content ?? '').startsWith('This is a side question');
const story = `Once upon a time ${'the tests ran and ran, '.repeat(70)}The end.`;

test('/btw mid-reply: answered in the panel on the side lane, esc closes it without stopping the main job, nothing enters the conversation', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: story }, { text: 'You are welcome.' }], { delayMs: 25, route: (j) => (isSide(j) ? { text: '**A guess:** about one more minute.' } : null) });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows', '--slots', '2'], steps: [
    { wait: 'Welcome' },
    { type: 'tell me a story' }, { key: 'enter' }, { wait: 'Once upon a time' },
    { type: '/btw ' }, { wait: '[question]' }, { snapshot: 'hint' },
    { type: 'eta?' }, { key: 'enter' },
    // has: a snapshot in the middle of a redraw holds half a screen (pty.mjs); these are asked of it below
    { wait: 'about one more minute' }, { sleep: 150 }, { snapshot: 'panel', has: ['/btw eta?', 'about one more minute', 'Esc to close', 'esc to interrupt'] },
    { key: 'esc' }, { sleep: 200 }, { snapshot: 'closed', has: ['? for shortcuts'] },
    { wait: 'The end.', ms: 20_000 }, { waitGone: 'esc to interrupt', ms: 20_000 },
    { type: 'thanks' }, { key: 'enter' }, { wait: 'You are welcome.' },
    ...quit,
  ], timeoutMs: 60_000 });
  await fake.close();
  // the prompt showed the argument's hint after "/btw "
  expect(r.snapshots.hint).toContain('/btw  [question]');
  // the panel: the question, the answer, its keys; the main job still working above it
  expect(r.snapshots.panel).toContain('/btw eta?');
  expect(r.snapshots.panel).toContain('A guess: about one more minute.');
  expect(r.snapshots.panel).toContain('c to copy · f to send to main · Esc to close');
  expect(r.snapshots.panel).toContain('esc to interrupt');
  expect(r.snapshots.panel).not.toContain('? for shortcuts'); // in the prompt box's place
  // esc closed the panel only: the prompt box is back and the reply went on to its end
  expect(r.snapshots.closed).toContain('? for shortcuts');
  expect(r.snapshots.closed).not.toContain('Esc to close');
  expect(r.text).not.toContain('Interrupted');
  // the side request: the side lane, no tools, the conversation so far and the question
  const side = fake.requests.filter(isSide);
  expect(side).toHaveLength(1);
  expect(side[0].id_slot).toBe(1);
  expect(side[0].tools).toBeUndefined();
  expect(side[0].messages[1].content).toContain('User: tell me a story');
  expect(side[0].messages[1].content).toContain('still working on the last request');
  expect(side[0].messages[1].content).toEndWith('The side question: eta?');
  // the main conversation never saw it
  const last = JSON.stringify(fake.requests.filter((j) => !isSide(j)).at(-1).messages);
  expect(last).toContain('thanks');
  expect(last).not.toContain('eta?');
  expect(last).not.toContain('one more minute');
}, T);

test('/btw when idle: c copies the answer, f sends the question and answer with the next message', async () => {
  const { cwd, env, base } = setup();
  const clip = join(base, 'clipboard.txt');
  const fake = await startFakeServer([{ text: 'Hi.' }, { text: 'Noted.' }], { route: (j) => (isSide(j) ? { text: 'You asked me to say hi.' } : null) });
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_CLIPBOARD: clip }, args: ['--url', fake.url, '--no-flows', '--slots', '2'], steps: [
    { wait: 'Welcome' },
    { type: 'say hi' }, { key: 'enter' }, { wait: 'Hi.' }, { waitGone: 'esc to interrupt' },
    { type: '/btw what did I ask?' }, { key: 'enter' }, { wait: 'f to send to main' },
    { type: 'c' }, { wait: 'copied the answer' },
    { type: 'f' }, { wait: 'go to Agentic Coder with your next message' },
    { type: 'carry on' }, { key: 'enter' }, { wait: 'Noted.' },
    ...quit,
  ] });
  await fake.close();
  expect(readFileSync(clip, 'utf8')).toBe('You asked me to say hi.');
  expect(fake.requests.filter(isSide)[0].messages[1].content).toContain('Right now Agentic Coder is idle');
  const last = fake.requests.filter((j) => !isSide(j)).at(-1).messages.at(-1).content;
  expect(last).toContain('the user asked a side question with /btw');
  expect(last).toContain('Question: what did I ask?');
  expect(last).toContain('Answer: You asked me to say hi.');
  expect(last).toEndWith('carry on');
  expect(r.text).not.toContain('Unknown command');
}, T);

test("a question from the main job wins the panel's place; the answer comes back after it", async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { text: `Let me think about it. ${'Still thinking. '.repeat(40)}`, tool: { name: 'Bash', args: { command: 'touch made-by-btw-test.txt', description: 'Make a file' } } },
    { text: 'Made it.' },
  ], { delayMs: 25, route: (j) => (isSide(j) ? { text: 'It is about to make a file.' } : null) });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows', '--slots', '2'], steps: [
    { wait: 'Welcome' },
    { type: 'make the file' }, { key: 'enter' }, { wait: 'Let me think' },
    { type: '/btw what now?' }, { key: 'enter' }, { wait: 'about to make a file' },
    { wait: 'Do you want to proceed?', ms: 20_000 }, { sleep: 150 }, { snapshot: 'asked' },
    { key: 'enter' }, { wait: 'Made it.' }, { sleep: 300 }, { snapshot: 'back' },
    { key: 'esc' }, { wait: '? for shortcuts' },
    ...quit,
  ], timeoutMs: 60_000 });
  await fake.close();
  expect(r.snapshots.asked).toContain('Your /btw answer is kept');
  expect(r.snapshots.asked).not.toContain('Esc to close');
  expect(r.snapshots.back).toContain('It is about to make a file.');
  expect(r.snapshots.back).toContain('f to send to main');
  expect(existsSync(join(cwd, 'made-by-btw-test.txt'))).toBe(true);
}, T);

test('/btw says so and sends nothing when there is no room, no side lane, or no question', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  // a pool too small for a side question next to the conversation
  const small = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows', '--slots', '2', '--ctx', '2048'], steps: [
    { wait: 'Welcome' }, { type: '/btw eta?' }, { key: 'enter' }, { wait: 'No room for a side question right now' }, { snapshot: 'noroom' },
    { key: 'esc' }, { sleep: 200 }, { type: '/btw' }, { key: 'enter' }, { wait: 'Ask the question after it' },
    ...quitTyped,
  ] });
  // a server given with --url and one lane
  const single = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' }, { type: '/btw eta?' }, { key: 'enter' }, { wait: 'has a single lane' },
    ...quit,
  ] });
  await fake.close();
  expect(fake.requests.filter(isSide)).toHaveLength(0);
  expect(small.snapshots.noroom).toContain('No room for a side question right now');
  expect(small.snapshots.noroom).toContain('Esc to close');
  expect(small.text).toContain('Ask the question after it: /btw what are you doing right now?');
  expect(single.text).toContain('with --url, add --slots 2');
}, T);
