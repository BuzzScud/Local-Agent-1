// End-to-end, the real app in a pseudo-terminal (see app.test.mjs).
// Here: the hub pages opened from the window, and the edited weights.
import { test, expect } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';

// The model on this Mac in these tests is the default one (its file, name and size).
const D = MODELS[DEFAULT_MODEL];
const DN = D.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // its name inside a pattern
const DGB = `${(D.bytes / 1e9).toFixed(1)} GB`;

test('/settings → Weights starts the viewer inside the window: the note names the page, and it serves the model while the app runs', async () => {
  const { cwd, env, base } = setup();
  mkdirSync(join(base, 'home', 'models'), { recursive: true });
  writeFileSync(join(base, 'home', 'models', D.file), 'stand-in'); // 8 bytes
  const fake = await startFakeServer([]);
  let served = null;
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_NO_OPEN: '1' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/settings' }, { key: 'enter' }, { wait: 'Everything not in the / menu' },
    ...Array.from({ length: 9 }, () => [{ key: 'down' }, { sleep: 60 }]).flat(), { sleep: 200 }, { snapshot: 'menu' }, { key: 'enter' },
    { wait: 'opened in the browser at http://127.0.0.1:' },
    { fn: async ({ text }) => { const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)[0]; served = { facts: await (await fetch(url + 'model.json')).json(), page: await (await fetch(url + 'weights')).text(), hub: await (await fetch(url)).text(), bytes: await (await fetch(url + 'model', { headers: { Range: 'bytes=0-4' } })).text() }; } },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.menu).toMatch(new RegExp(`❯ Weights\\s+${DN} · 0\\.00 GB\\s+each model's weights`)); // the row names the model whose file is here
  expect(r.text).toContain(`Weights of ${D.name} opened in the browser at http://127.0.0.1:`); // the models whose files are on this Mac
  expect(served.facts).toEqual({ name: D.file, size: 8 });
  expect(served.page).toContain('<title>Agentic Coder Weights</title>');
  expect(served.hub).toContain('<title>Agentic Coder Hub</title>');
  expect(served.bytes).toBe('stand');
}, T);

test('/docs opens the hub on the harness page and says how many pages the DOCS folder holds', async () => {
  const { cwd, env, base } = setup();
  mkdirSync(join(base, 'home', 'models'), { recursive: true });
  writeFileSync(join(base, 'home', 'models', 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf'), 'stand-in');
  const docs = join(base, 'agentic-coder DOCS'); mkdirSync(docs);
  writeFileSync(join(docs, 'agentic-coder-harness-flow-v2.html'), '<!doctype html><title>Agentic Coder harness v2</title><p>flow');
  writeFileSync(join(docs, 'agentic-coder-structure-v4.html'), '<!doctype html><title>Agentic Coder structure v4</title><p>tree');
  const fake = await startFakeServer([]);
  let served = null;
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_NO_OPEN: '1', AGENTIC_DOCS: docs }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/docs' }, { key: 'enter' },
    { wait: 'Docs opened in the browser at http://127.0.0.1:' },
    { fn: async ({ text }) => { const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)[0]; served = { list: await (await fetch(url + 'docs.json')).json(), page: await (await fetch(url + 'docs/agentic-coder-harness-flow-v2.html')).text(), hub: await (await fetch(url + '?tab=harness')).text() }; } },
    ...quit,
  ] });
  await fake.close();
  expect(r.text).toContain('?tab=harness · 2 pages from');
  expect(r.text.replace(/\s+/g, ' ')).toContain('harness: Agentic Coder harness v2 · structure: Agentic Coder structure v4'); // the longer name wraps the note
  expect(served.list.pinned.harness.file).toBe('agentic-coder-harness-flow-v2.html');
  expect(served.page).toContain('flow');
  expect(served.hub).toContain('<title>Agentic Coder Hub</title>');
}, T);

test('/tests opens the Arena on the test record and says how many runs it holds and the latest', async () => {
  const { cwd, env, base } = setup();
  mkdirSync(join(base, 'home', 'tests'), { recursive: true });
  writeFileSync(join(base, 'home', 'tests', 'record.jsonl'), [
    { id: 'a', at: '2026-09-25T21:09:27.000Z', kind: 'tasks', name: 'The 28 practice tasks', code: 'abc1234', passed: 28, total: 28, secs: 1974, result: 'pass' },
    { id: 'b', at: '2026-09-26T22:57:43.000Z', kind: 'bug', name: 'The chart bug', code: 'def5678', effort: 'high', passed: 0, total: 1, secs: 1500, result: 'fail' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const fake = await startFakeServer([]);
  let served = null;
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_NO_OPEN: '1' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/tests' }, { key: 'enter' },
    { wait: 'The test record opened in the browser at http://127.0.0.1:' },
    { fn: async ({ text }) => { const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)[0]; served = { data: await (await fetch(url + 'tests.json')).json(), page: await (await fetch(url + 'tests')).text() }; } },
    ...quit,
  ] });
  await fake.close();
  expect(r.text.replace(/\s+/g, ' ')).toContain('?tab=arena&record=1 · 2 runs recorded, the latest: The chart bug (0 of 1)');
  expect(served.data.rows.map((x) => x.id)).toEqual(['b', 'a']);
  expect(served.page).toContain('<title>Agentic Coder test record</title>');
}, T);

test('/help: a box in the middle says the Help page opened in the browser; the page has every command, key and setting', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  let served = null;
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_NO_OPEN: '1' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/help' }, { key: 'enter' }, { wait: 'esc or enter to close' }, { sleep: 200 }, { snapshot: 'box' },
    { fn: async ({ text }) => { const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)[0]; served = { data: await (await fetch(url + 'help.json')).json(), page: await (await fetch(url + 'help')).text(), hub: await (await fetch(url + '?tab=help')).text() }; } },
    { key: 'esc' }, { sleep: 300 }, { snapshot: 'closed' },
    // any other key closes it too, and still reaches the prompt
    { type: '/help' }, { key: 'enter' }, { wait: 'esc or enter to close' }, { sleep: 200 }, { type: 'x' }, { sleep: 300 }, { snapshot: 'typed' },
    // and so does a paste (a bracketed paste, as the terminal sends it)
    { key: 'backspace' }, { type: '/help' }, { key: 'enter' }, { wait: 'esc or enter to close' }, { sleep: 200 }, { key: '\x1b[200~pasted words\x1b[201~' }, { sleep: 300 }, { snapshot: 'pasted' },
    ...quit,
  ] });
  await fake.close();
  const box = r.snapshots.box.split('\n');
  const title = box.findIndex((l) => l.includes('Agentic Coder help'));
  expect(title).toBeGreaterThan(0);
  expect(r.snapshots.box).toContain('Opened a help page in your browser');
  expect(r.snapshots.box).toMatch(/http:\/\/127\.0\.0\.1:\d+\/\?tab=help/);
  expect(r.snapshots.box).not.toContain('/compact'); // no command list in the terminal any more
  expect(r.snapshots.box).not.toContain(':8757/'); // a test's hub never takes the real hub's address
  // in the middle: centred across, and between the conversation and the prompt box
  const top = box.findIndex((l) => l.indexOf('╭') > 4); // the prompt box starts at the left edge
  expect(top).toBeGreaterThan(box.findIndex((l) => l.includes('This folder')));
  expect(top).toBeLessThan(title);
  expect(top).toBeLessThan(box.findLastIndex((l) => l.startsWith('╭'))); // above the prompt box
  const left = box[top].indexOf('╭'), right = 155 - 1 - box[top].lastIndexOf('╮'); // the pty is 155 wide; the snapshot drops trailing spaces
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  expect(r.snapshots.closed).not.toContain('esc or enter to close');
  expect(r.snapshots.typed).not.toContain('esc or enter to close');
  expect(r.snapshots.typed).toMatch(/> x/);
  expect(r.snapshots.pasted).not.toContain('esc or enter to close');
  expect(r.snapshots.pasted).toMatch(/> pasted words/);
  const { COMMANDS } = await import('../src/app/commands.mjs');
  expect(served.data.commands.map((c) => c.name)).toEqual(COMMANDS.map((c) => c.name)); // every command, from the same list
  expect(served.data.commands.filter((c) => c.menu).map((c) => c.name)).toEqual(['effort', 'mode', 'remote', 'web', 'meters', 'mouse']);
  expect(served.data.keys.flatMap((g) => g.rows.map(([k]) => k))).toContain('shift + ← →');
  expect(served.data.modes.map((m) => m.id)).toEqual(['ask', 'edits', 'plan']);
  expect(served.data.effort.map((l) => l.id)).toEqual(['low', 'high']); // the default model: no Medium
  expect(served.page).toContain('<title>Agentic Coder Help</title>');
  expect(served.hub).toContain('data-tab="help"');
}, T);

test('edited weights: the badge points at /model, the picker lists the copy, and picking it tries the switch in place', async () => {
  const { cwd, env, base } = setup();
  // A saved edited copy: its manifest and both stand-in files.
  const models = join(base, 'home', 'models'); mkdirSync(models, { recursive: true });
  writeFileSync(join(models, 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf'), 'stand-in');
  writeFileSync(join(models, 'gemma-4-12B-it-qat-UD-Q4_K_XL-edited.gguf'), 'stand-in-edited');
  writeFileSync(join(models, 'edited.json'), JSON.stringify({ base: 'gemma', file: 'gemma-4-12B-it-qat-UD-Q4_K_XL-edited.gguf', saved: '2026-09-26T14:32:00.000Z', edits: [{ op: 'scale', tensor: 'blk.12.ffn_up.weight', row: 3072, k: 0.5 }] }));
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Recent activity' }, { sleep: 400 }, { snapshot: 'badge' },
    { type: '/model' }, { sleep: 300 }, { key: 'enter' }, { sleep: 500 }, { snapshot: 'picker' },
    // the edited copy is listed last, after every model, and ↓ stops at the
    // end of the list, so 4 presses reach it however many models there are.
    // (No import of the models here: loading them fixes HOME before
    // settings.test sets AGENTIC_HOME in a full run.)
    ...[1, 2, 3, 4].flatMap(() => [{ key: 'down' }, { sleep: 150 }]), { key: 'enter' },
    { wait: 'Could not switch' }, { sleep: 300 }, { snapshot: 'after' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.badge).toContain('✱ edited weights ready · /model to switch');
  expect(r.snapshots.picker).toContain('Gemma 4 12B QAT · edited');
  expect(r.snapshots.picker).toContain('1 edit · saved');
  expect(r.snapshots.picker).toContain('✔ in use'); // still on the original here
  // No llama-server in this stand-in home: the switch fails cleanly with a
  // note, which proves the picker really tried it in place (no app restart).
  expect(r.text).toContain('Could not switch:');
  expect(r.snapshots.after).toContain('✱ on edited weights (1 edit)');
}, T);

test('edited weights, one copy per model: the picker lists each after the models, and picking the second model\'s copy is that model edited', async () => {
  const { cwd, env, base } = setup();
  const models = join(base, 'home', 'models'); mkdirSync(models, { recursive: true });
  for (const [id, file, edits] of [['gemma', 'gemma-4-12B-it-qat-UD-Q4_K_XL', 1], ['qwen', 'Qwen3.5-9B-MTP-UD-Q5_K_XL', 2]]) {
    writeFileSync(join(models, `${file}.gguf`), 'stand-in'); writeFileSync(join(models, `${file}-edited.gguf`), 'stand-in-edited');
    writeFileSync(join(models, `edited-${id}.json`), JSON.stringify({ base: id, file: `${file}-edited.gguf`, saved: '2026-09-30T14:32:00.000Z', edits: Array.from({ length: edits }, (_, i) => ({ op: 'scale', tensor: 'blk.0.ffn_up.weight', row: i, k: 0.5 })) }));
  }
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Recent activity' }, { sleep: 400 }, { snapshot: 'badge' },
    { type: '/model' }, { sleep: 300 }, { key: 'enter' }, { sleep: 500 }, { snapshot: 'picker' },
    // the copies come after every model, in the models' order: the last row is the second model's
    ...[1, 2, 3, 4, 5].flatMap(() => [{ key: 'down' }, { sleep: 150 }]), { key: 'enter' },
    { wait: 'Could not switch' }, { sleep: 300 }, { snapshot: 'after' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.badge).toContain('✱ edited weights ready · /model to switch');
  // each row: the name, then (after a gap, whatever the name's length) its size and what it is
  const rows = r.snapshots.picker.split('\n').filter((l) => /GB · /.test(l)).map((l) => l.replace(/[❯│]/g, '').trim().split(/\s{2,}/).slice(0, 2).map((x) => x.replace(/saved .*/, 'saved')));
  expect(rows).toEqual([['Gemma 4 12B QAT', '6.7 GB · on this Mac'], ['Qwen3.5 9B', '6.9 GB · on this Mac'], ['Gemma 4 12B QAT · edited', '0.0 GB · 1 edit · saved'], ['Qwen3.5 9B · edited', '0.0 GB · 2 edits · saved']]);
  expect(r.snapshots.picker).toContain('1 edit · saved'); expect(r.snapshots.picker).toContain('2 edits · saved');
  expect(r.text).toContain('Could not switch:');
  expect(r.snapshots.after).toContain('✱ on edited weights (2 edits)'); // Qwen's copy, with Qwen's two edits
}, T);


test('/instructions opens a working editor in the hub without a downloaded model', async () => {
 const {cwd, env} = setup(); const fake = await startFakeServer([]); let data;
 try {
  const r = await runInPty({cwd,env:{...env,AGENTIC_NO_OPEN:'1'},args:['--url',fake.url,'--no-flows'],steps:[
   {wait:'? for shortcuts'}, {type:'/instructions'}, {key:'enter'}, {wait:'Instructions opened at http://127.0.0.1:'},
   {fn:async ({text}) => { const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)[0]; data = await (await fetch(url+'instructions.json')).json(); }}, ...quit,
  ]});
  expect(r.text).toContain('?tab=instructions'); expect(data.sections.general).toContain('evidence'); expect(data.sections.planning).toContain('success checks');
 } finally { await fake.close(); }
}, T);
