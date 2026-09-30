// End-to-end, the real app in a pseudo-terminal (see app.test.mjs).
// Here: the memory. Facts come back with a request, /memory shows them and
// takes a save back, and what a task taught is saved after the window closed.
import { test, expect } from 'bun:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { demoReplies } from './demo-script.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { applyChanges, readFacts } from '../src/agent/facts.mjs';

const memories = (base, cwd) => ({ you: join(base, 'memory-about-you'), project: join(cwd, '.agentic', 'memory') });
const isSave = (json) => JSON.stringify(json.messages?.[0] ?? '').includes("You keep Agentic Coder's memory");

test('facts come back with the request that fits them; /memory shows both memories; /memory undo takes the last save back', async () => {
  const { cwd, env, base } = setup();
  const m = memories(base, cwd);
  applyChanges(m.project, { add: [{ kind: 'project', text: 'The flags are read in export.mjs, in main().' }, { kind: 'worked', text: 'Worked: the rows print as JSON once main() checks argv for --json.' }] }, { batch: 'earlier' });
  const fake = await startFakeServer([{ text: 'In main(), from argv.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Recent activity' }, { snapshot: 'welcome' },
    { type: 'where are the flags read in export.mjs?' }, { key: 'enter' }, { wait: 'In main(), from argv.' }, { sleep: 200 }, { snapshot: 'asked' },
    { key: 'ctrlO' }, { wait: 'ctrl+o again opens the one before' }, { key: 'ctrlO' }, { wait: 'The flags are read in export.mjs' }, { sleep: 200 }, { snapshot: 'listed' },
    { type: '/memory' }, { key: 'enter' }, { wait: 'This project · 2 facts' }, { sleep: 200 }, { snapshot: 'panel' },
    { type: '/memory undo' }, { key: 'enter' }, { wait: 'the last save taken back' }, { sleep: 200 }, { snapshot: 'undone' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.welcome).toMatch(/memory/); // the welcome names what the start read
  expect(r.snapshots.asked).toMatch(/┊ 1 note\b[^\n]*\(ctrl\+o\)/); // what came along, in the line under the request
  expect(r.snapshots.asked).toContain('(ctrl+o to expand)');
  // ctrl+o opens the newest fold (the file read); again, the one before: what came along, where from, how close and its size
  expect(r.snapshots.listed).toMatch(/memory\s+The flags are read in export\.mjs, in main\(\)\.\s+(fit \d\.\d\d · )?\d+ tokens/);
  // the model read the fact with the request, and the two rules in its instructions
  const sent = fake.requests.find((q) => q.messages?.some((x) => x.role === 'user' && String(x.content).startsWith('where are the flags read')));
  expect(sent.messages.find((x) => x.role === 'user').content).toContain('(From your memory, saved in earlier conversations here.');
  expect(sent.messages[0].content).toContain('Memory\nAlways\n');
  expect(sent.messages[0].content).toContain('When you are stuck, ask the user what to do instead of guessing or stopping.');
  expect(sent.messages[0].content).toContain('- The flags are read in export.mjs, in main().');
  expect(r.snapshots.panel).toMatch(/About you · 2 facts/);
  expect(r.snapshots.panel).toMatch(/always\s+Before you change anything, say in one plain, simple sentence/);
  expect(r.snapshots.panel).toMatch(/project\s+The flags are read in export\.mjs, in main\(\)\.\s+\(trust 0, used 1\)/);
  expect(r.snapshots.panel).toContain('facts are found by their words');
  expect(r.snapshots.undone).toMatch(/removed\s+The flags are read in export\.mjs/);
  expect(readFacts(m.project)).toEqual([]);
  expect(readFacts(m.project, { retired: true })).toHaveLength(2);
  expect(readFacts(m.you).map((f) => f.always)).toEqual([true, true]); // your rules were not part of that save
}, T);

test('what a task taught is saved after the window closed, and the next start says so', async () => {
  const { cwd, env, base } = setup();
  const m = memories(base, cwd);
  const saved = { add: [{ kind: 'worked', text: 'Worked: export.mjs prints the rows as JSON when argv includes --json.', turn: 1 }, { kind: 'failed', text: 'Failed: nothing failed here, so this must be refused.', turn: 1 }], drop: [] };
  const fake = await startFakeServer(demoReplies, { route: (json) => (isSave(json) ? { text: JSON.stringify(saved) } : null) });
  const on = { ...env, AGENTIC_MEMORY_SAVE: 'on' };
  const first = await runInPty({ cwd, env: on, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'add a --json flag to export.mjs' }, { key: 'enter' },
    { wait: 'Do you want to make this edit' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'export.test.mjs?' }, { sleep: 200 }, { type: '2' },
    { wait: 'Do you want to proceed?' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'tests pass' }, ...quit,
  ] });
  expect(first.code).toBe(0);
  // the save runs on its own after the window is gone
  const jobs = join(base, 'home', 'memory-jobs');
  for (let i = 0; i < 100 && !(existsSync(jobs) && readdirSync(jobs).some((f) => f.endsWith('.done'))); i++) await new Promise((r) => setTimeout(r, 100));
  expect(readdirSync(jobs).filter((f) => f.endsWith('.json'))).toEqual([]);
  const facts = readFacts(m.project);
  expect(facts.map((f) => [f.kind, f.text, f.from])).toEqual([['worked', 'Worked: export.mjs prints the rows as JSON when argv includes --json.', 'the task "add a --json flag to export.mjs"']]);
  const asked = fake.requests.find(isSave);
  expect(asked.messages[1].content).toContain('Turn 1 (change): "add a --json flag to export.mjs" → the check passed');
  expect(asked.messages[1].content).toContain('changed: export.mjs, export.test.mjs');
  const second = await runInPty({ cwd, env: on, args: ['--url', fake.url, '--no-flows'], steps: [{ wait: 'Memory, saved when you last quit: 1 saved' }, { snapshot: 'start' }, ...quit] });
  await fake.close();
  expect(second.snapshots.start).toContain('Worked: export.mjs prints the rows as JSON when argv includes --json.');
  expect(readdirSync(jobs)).toEqual([]); // said once
}, T * 2);

// Asking first (the default, the user's pick on 28 Sep 2026): after a task the
// facts are listed and a Save / Skip menu opens; nothing is written without a
// yes, and closing the window saves nothing on its own.
const task = [
  { wait: '? for shortcuts' }, { type: 'add a --json flag to export.mjs' }, { key: 'enter' },
  { wait: 'Do you want to make this edit' }, { sleep: 200 }, { key: 'enter' },
  { wait: 'export.test.mjs?' }, { sleep: 200 }, { type: '2' },
  { wait: 'Do you want to proceed?' }, { sleep: 200 }, { key: 'enter' },
  { wait: 'tests pass' },
];
const learned = { add: [{ kind: 'worked', text: 'Worked: export.mjs prints the rows as JSON when argv includes --json.', turn: 1 }], drop: [] };

test('asking first: after a task the facts are listed, Save keeps them', async () => {
  const { cwd, env, base } = setup();
  const m = memories(base, cwd);
  const fake = await startFakeServer(demoReplies, { route: (json) => (isSave(json) ? { text: JSON.stringify(learned) } : null) });
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_MEMORY_SAVE: 'ask' }, args: ['--url', fake.url, '--no-flows', '--slots', '2'], timeoutMs: 60_000, steps: [
    ...task, { wait: 'Remember for next time?', ms: 30_000 }, { sleep: 200 }, { snapshot: 'asked' },
    { key: 'enter' }, { wait: 'Memory: 1 saved' }, ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.asked).toContain('Learned in that task · 1 change');
  expect(r.snapshots.asked).toContain('+ Worked: export.mjs prints the rows as JSON when argv includes --json.');
  expect(r.snapshots.asked).toMatch(/❯ 1\. Save\s+read at every start from now on/);
  expect(readFacts(m.project).map((f) => f.text)).toEqual(['Worked: export.mjs prints the rows as JSON when argv includes --json.']);
}, T * 2);

test('asking first: Skip (esc) keeps nothing, and quitting does not save on its own', async () => {
  const { cwd, env, base } = setup();
  const m = memories(base, cwd);
  const fake = await startFakeServer(demoReplies, { route: (json) => (isSave(json) ? { text: JSON.stringify(learned) } : null) });
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_MEMORY_SAVE: 'ask' }, args: ['--url', fake.url, '--no-flows', '--slots', '2'], timeoutMs: 60_000, steps: [
    ...task, { wait: 'Remember for next time?', ms: 30_000 }, { sleep: 200 }, { key: 'esc' }, { wait: 'Not saved' }, ...quit,
  ] });
  await fake.close();
  expect(r.text).toContain('/update memory saves what matters at any time');
  expect(readFacts(m.project)).toEqual([]);
  await new Promise((res) => setTimeout(res, 1500)); // a hand-off would have run by now
  const jobs = join(base, 'home', 'memory-jobs');
  expect(existsSync(jobs) ? readdirSync(jobs) : []).toEqual([]);
}, T * 2);

test('/update memory saves at once (it does not restart the app); /update memory <what> saves that', async () => {
  const { cwd, env, base } = setup();
  const m = memories(base, cwd);
  const fake = await startFakeServer([], { route: (json) => (isSave(json) ? { text: JSON.stringify({ add: [{ kind: 'you', text: 'Tests in this project run with bun test.' }], drop: [] }) } : null) });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/update memory tests here run with bun test' }, { key: 'enter' },
    { wait: 'Saved to memory:' }, { sleep: 200 }, ...quit,
  ] });
  await fake.close();
  expect(r.text).not.toContain('up to date'); // not the app update
  expect(readFacts(m.you).map((f) => f.text)).toContain('Tests in this project run with bun test.');
  expect(JSON.stringify(fake.requests.find(isSave))).toContain('The user now says: update memory: tests here run with bun test');
}, T);

test('"remember that …" saves at once into the new memory, and "memory": false turns all of it off', async () => {
  const { cwd, env, base } = setup();
  const m = memories(base, cwd);
  const fake = await startFakeServer([], { route: (json) => (isSave(json) ? { text: JSON.stringify({ add: [{ kind: 'you', text: 'Pages are delivered as one self-contained HTML file.' }], drop: [] }) } : null) });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'remember that I want pages as one self-contained HTML file' }, { key: 'enter' },
    { wait: 'Saved to memory:' }, { sleep: 200 }, ...quit,
  ] });
  expect(r.text).toContain('• Pages are delivered as one self-contained HTML file.');
  expect(readFacts(m.you).map((f) => f.text)).toContain('Pages are delivered as one self-contained HTML file.');
  expect(JSON.stringify(fake.requests.find(isSave))).toContain('The user now says: remember that I want pages as one self-contained HTML file');
  expect(existsSync(join(cwd, '.bonsai', 'notes.md'))).toBe(false); // not the old notes file
  // off: nothing is read, brought back or saved
  const off = await runInPty({ cwd, env: { ...env, AGENTIC_NO_MEMORY: '1' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'what is a self-contained HTML file?' }, { key: 'enter' }, { wait: 'Done.' },
    { type: '/memory' }, { key: 'enter' }, { wait: 'The memory is off here' }, ...quit,
  ] });
  await fake.close();
  const last = fake.requests.filter((q) => q.messages?.some((x) => x.role === 'user' && String(x.content).startsWith('what is a self-contained'))).at(-1);
  expect(last.messages[0].content).not.toContain('Memory\n');
  expect(last.messages.find((x) => x.role === 'user').content).toBe('what is a self-contained HTML file?');
  expect(off.text).not.toContain('Context ·');
}, T * 2);
