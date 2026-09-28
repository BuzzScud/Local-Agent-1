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

const memories = (base, cwd) => ({ you: join(base, 'memory-about-you'), project: join(cwd, '.bonsai', 'memory') });
const isSave = (json) => JSON.stringify(json.messages?.[0] ?? '').includes("You keep Bonsai's memory");

test('facts come back with the request that fits them; /memory shows both memories; /memory undo takes the last save back', async () => {
  const { cwd, env, base } = setup();
  const m = memories(base, cwd);
  applyChanges(m.project, { add: [{ kind: 'project', text: 'The flags are read in export.mjs, in main().' }, { kind: 'worked', text: 'Worked: the rows print as JSON once main() checks argv for --json.' }] }, { batch: 'earlier' });
  const fake = await startFakeServer([{ text: 'In main(), from argv.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome to Bonsai Code' }, { snapshot: 'welcome' },
    { type: 'where are the flags read in export.mjs?' }, { key: 'enter' }, { wait: 'In main(), from argv.' }, { sleep: 200 }, { snapshot: 'asked' },
    { type: '/memory' }, { key: 'enter' }, { wait: 'This project · 2 facts' }, { sleep: 200 }, { snapshot: 'panel' },
    { type: '/memory undo' }, { key: 'enter' }, { wait: 'the last save taken back' }, { sleep: 200 }, { snapshot: 'undone' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.welcome).toMatch(/memory/); // the welcome names what the start read
  expect(r.snapshots.asked).toContain('From memory: "The flags are read in export.mjs, in main()."');
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
  const on = { ...env, BONSAI_MEMORY_SAVE: 'on' };
  const first = await runInPty({ cwd, env: on, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome to Bonsai Code' }, { type: 'add a --json flag to export.mjs' }, { key: 'enter' },
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

test('"remember that …" saves at once into the new memory, and "memory": false turns all of it off', async () => {
  const { cwd, env, base } = setup();
  const m = memories(base, cwd);
  const fake = await startFakeServer([], { route: (json) => (isSave(json) ? { text: JSON.stringify({ add: [{ kind: 'you', text: 'Pages are delivered as one self-contained HTML file.' }], drop: [] }) } : null) });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome to Bonsai Code' }, { type: 'remember that I want pages as one self-contained HTML file' }, { key: 'enter' },
    { wait: 'Saved to memory:' }, { sleep: 200 }, ...quit,
  ] });
  expect(r.text).toContain('• Pages are delivered as one self-contained HTML file.');
  expect(readFacts(m.you).map((f) => f.text)).toContain('Pages are delivered as one self-contained HTML file.');
  expect(JSON.stringify(fake.requests.find(isSave))).toContain('The user now says: remember that I want pages as one self-contained HTML file');
  expect(existsSync(join(cwd, '.bonsai', 'notes.md'))).toBe(false); // not the old notes file
  // off: nothing is read, brought back or saved
  const off = await runInPty({ cwd, env: { ...env, BONSAI_NO_MEMORY: '1' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome to Bonsai Code' }, { type: 'what is a self-contained HTML file?' }, { key: 'enter' }, { wait: 'Done.' },
    { type: '/memory' }, { key: 'enter' }, { wait: 'The memory is off here' }, ...quit,
  ] });
  await fake.close();
  const last = fake.requests.filter((q) => q.messages?.some((x) => x.role === 'user' && String(x.content).startsWith('what is a self-contained'))).at(-1);
  expect(last.messages[0].content).not.toContain('Memory\n');
  expect(last.messages.find((x) => x.role === 'user').content).toBe('what is a self-contained HTML file?');
  expect(off.text).not.toContain('From memory:');
}, T * 2);
