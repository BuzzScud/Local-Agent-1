// End-to-end, the real app in a pseudo-terminal (see app.test.mjs).
// Here: the hub pages opened from the window, and the edited weights.
import { test, expect } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

test('/weights starts the viewer inside the window: the note names the page, and it serves the model while the app runs', async () => {
  const { cwd, env, base } = setup();
  mkdirSync(join(base, 'home', 'models'), { recursive: true });
  writeFileSync(join(base, 'home', 'models', 'Ternary-Bonsai-2-27B-PQ2_0.gguf'), 'stand-in'); // 8 bytes
  const fake = await startFakeServer([]);
  let served = null;
  const r = await runInPty({ cwd, env: { ...env, BONSAI_NO_OPEN: '1' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome to Bonsai Code' }, { type: '/wei' }, { sleep: 250 }, { snapshot: 'menu' }, { key: 'enter' },
    { wait: 'opened in the browser at http://127.0.0.1:' },
    { fn: async ({ text }) => { const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)[0]; served = { facts: await (await fetch(url + 'model.json')).json(), page: await (await fetch(url + 'weights')).text(), hub: await (await fetch(url)).text(), bytes: await (await fetch(url + 'model', { headers: { Range: 'bytes=0-4' } })).text() }; } },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.menu).toContain('/weights');
  expect(r.text).toContain('Weights of Ternary-Bonsai-2-27B-PQ2_0.gguf (0.00 GB) opened in the browser at http://127.0.0.1:');
  expect(served.facts).toEqual({ name: 'Ternary-Bonsai-2-27B-PQ2_0.gguf', size: 8 });
  expect(served.page).toContain('<title>Bonsai Weights</title>');
  expect(served.hub).toContain('<title>Bonsai Hub</title>');
  expect(served.bytes).toBe('stand');
}, T);

test('/docs opens the hub on the harness page and says how many pages the DOCS folder holds', async () => {
  const { cwd, env, base } = setup();
  mkdirSync(join(base, 'home', 'models'), { recursive: true });
  writeFileSync(join(base, 'home', 'models', 'Ternary-Bonsai-2-27B-PQ2_0.gguf'), 'stand-in');
  const docs = join(base, 'bonsai-code DOCS'); mkdirSync(docs);
  writeFileSync(join(docs, 'bonsai-harness-flow-v2.html'), '<!doctype html><title>Bonsai harness v2</title><p>flow');
  writeFileSync(join(docs, 'bonsai-code-structure-v4.html'), '<!doctype html><title>Bonsai Code structure v4</title><p>tree');
  const fake = await startFakeServer([]);
  let served = null;
  const r = await runInPty({ cwd, env: { ...env, BONSAI_NO_OPEN: '1', BONSAI_DOCS: docs }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome to Bonsai Code' }, { type: '/docs' }, { key: 'enter' },
    { wait: 'Docs opened in the browser at http://127.0.0.1:' },
    { fn: async ({ text }) => { const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)[0]; served = { list: await (await fetch(url + 'docs.json')).json(), page: await (await fetch(url + 'docs/bonsai-harness-flow-v2.html')).text(), hub: await (await fetch(url + '?tab=harness')).text() }; } },
    ...quit,
  ] });
  await fake.close();
  expect(r.text).toContain('?tab=harness · 2 pages from');
  expect(r.text).toContain('harness: Bonsai harness v2 · structure: Bonsai Code structure v4');
  expect(served.list.pinned.harness.file).toBe('bonsai-harness-flow-v2.html');
  expect(served.page).toContain('flow');
  expect(served.hub).toContain('<title>Bonsai Hub</title>');
}, T);

test('/tests opens the hub on the test record and says how many runs it holds and the latest', async () => {
  const { cwd, env, base } = setup();
  mkdirSync(join(base, 'home', 'tests'), { recursive: true });
  writeFileSync(join(base, 'home', 'tests', 'record.jsonl'), [
    { id: 'a', at: '2026-09-25T21:09:27.000Z', kind: 'tasks', name: 'The 28 practice tasks', code: 'abc1234', passed: 28, total: 28, secs: 1974, result: 'pass' },
    { id: 'b', at: '2026-09-26T22:57:43.000Z', kind: 'bug', name: 'The chart bug', code: 'def5678', effort: 'high', passed: 0, total: 1, secs: 1500, result: 'fail' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const fake = await startFakeServer([]);
  let served = null;
  const r = await runInPty({ cwd, env: { ...env, BONSAI_NO_OPEN: '1' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome to Bonsai Code' }, { type: '/tests' }, { key: 'enter' },
    { wait: 'Tests opened in the browser at http://127.0.0.1:' },
    { fn: async ({ text }) => { const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)[0]; served = { data: await (await fetch(url + 'tests.json')).json(), page: await (await fetch(url + 'tests')).text() }; } },
    ...quit,
  ] });
  await fake.close();
  expect(r.text).toContain('?tab=tests · 2 runs recorded, the latest: The chart bug (0 of 1)');
  expect(served.data.rows.map((x) => x.id)).toEqual(['b', 'a']);
  expect(served.page).toContain('<title>Bonsai test record</title>');
}, T);

test('/help: a box in the middle says the Help page opened in the browser; the page has every command, key and setting', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  let served = null;
  const r = await runInPty({ cwd, env: { ...env, BONSAI_NO_OPEN: '1' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' }, { type: '/help' }, { key: 'enter' }, { wait: 'esc or enter to close' }, { sleep: 200 }, { snapshot: 'box' },
    { fn: async ({ text }) => { const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)[0]; served = { data: await (await fetch(url + 'help.json')).json(), page: await (await fetch(url + 'help')).text(), hub: await (await fetch(url + '?tab=help')).text() }; } },
    { key: 'esc' }, { sleep: 300 }, { snapshot: 'closed' },
    // any other key closes it too, and still reaches the prompt
    { type: '/help' }, { key: 'enter' }, { wait: 'esc or enter to close' }, { sleep: 200 }, { type: 'x' }, { sleep: 300 }, { snapshot: 'typed' },
    ...quit,
  ] });
  await fake.close();
  const box = r.snapshots.box.split('\n');
  const title = box.findIndex((l) => l.includes('Bonsai Code help'));
  expect(title).toBeGreaterThan(0);
  expect(r.snapshots.box).toContain('Opened a help page in your browser');
  expect(r.snapshots.box).toMatch(/http:\/\/127\.0\.0\.1:\d+\/\?tab=help/);
  expect(r.snapshots.box).not.toContain('/compact'); // no command list in the terminal any more
  // in the middle: centred across, and between the conversation and the prompt box
  const top = box.findIndex((l) => l.indexOf('╭') > 4); // the welcome and prompt boxes start at the left edge
  expect(top).toBeGreaterThan(box.findIndex((l) => l.includes('Tips for getting started')));
  expect(top).toBeLessThan(title);
  expect(top).toBeLessThan(box.findLastIndex((l) => l.startsWith('╭'))); // above the prompt box
  const left = box[top].indexOf('╭'), right = 155 - 1 - box[top].lastIndexOf('╮'); // the pty is 155 wide; the snapshot drops trailing spaces
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  expect(r.snapshots.closed).not.toContain('esc or enter to close');
  expect(r.snapshots.typed).not.toContain('esc or enter to close');
  expect(r.snapshots.typed).toMatch(/> x/);
  const { COMMANDS } = await import('../src/app/commands.mjs');
  expect(served.data.commands.map((c) => c.name)).toEqual(COMMANDS.map((c) => c.name)); // every command, from the same list
  expect(served.data.commands.filter((c) => c.menu).map((c) => c.name)).toEqual(['effort', 'mode', 'meters']);
  expect(served.data.keys.flatMap((g) => g.rows.map(([k]) => k))).toContain('shift + ← →');
  expect(served.data.modes.map((m) => m.id)).toEqual(['ask', 'edits', 'plan']);
  expect(served.data.effort.map((l) => l.id)).toEqual(['low', 'medium', 'high']);
  expect(served.page).toContain('<title>Bonsai Help</title>');
  expect(served.hub).toContain('data-tab="help"');
}, T);

test('edited weights: the badge points at /model, the picker lists the copy, and picking it tries the switch in place', async () => {
  const { cwd, env, base } = setup();
  // A saved edited copy: its manifest and both stand-in files.
  const models = join(base, 'home', 'models'); mkdirSync(models, { recursive: true });
  writeFileSync(join(models, 'Ternary-Bonsai-2-27B-PQ2_0.gguf'), 'stand-in');
  writeFileSync(join(models, 'Ternary-Bonsai-2-27B-PQ2_0-edited.gguf'), 'stand-in-edited');
  writeFileSync(join(models, 'edited.json'), JSON.stringify({ base: '27b', file: 'Ternary-Bonsai-2-27B-PQ2_0-edited.gguf', saved: '2026-09-26T14:32:00.000Z', edits: [{ op: 'scale', tensor: 'blk.12.ffn_up.weight', row: 3072, k: 0.5 }] }));
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome to Bonsai Code' }, { sleep: 400 }, { snapshot: 'badge' },
    { type: '/model' }, { sleep: 300 }, { key: 'enter' }, { sleep: 500 }, { snapshot: 'picker' },
    { key: 'down' }, { sleep: 150 }, { key: 'enter' },
    { wait: 'Could not switch' }, { sleep: 300 }, { snapshot: 'after' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.badge).toContain('✱ edited weights ready · /model to switch');
  expect(r.snapshots.picker).toContain('27B · edited');
  expect(r.snapshots.picker).toContain('1 edit · saved');
  expect(r.snapshots.picker).toContain('✔ in use'); // still on the original here
  // No llama-server in this stand-in home: the switch fails cleanly with a
  // note, which proves the picker really tried it in place (no app restart).
  expect(r.text).toContain('Could not switch:');
  expect(r.snapshots.after).toContain('✱ on edited weights (1 edit)');
}, T);
