// Claude Code's MultiEdit and NotebookEdit (the owner's pick, 19 Nov 2026): several changes to one file in
// one call, all or none; one cell of a notebook replaced, inserted or deleted. Both run as Edits.
// A scripted stand-in is the model (fake-server.mjs).
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';

process.env.AGENTIC_HOME = mkdtempSync(join(tmpdir(), 'agentic-cc-tools-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');
const { notebookChange } = await import('../src/agent/tools-notebook.mjs');

const model = MODELS[DEFAULT_MODEL];
const project = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-cc-tools-'))); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };
const call = (name, args) => ({ tool: { name, args } });
const NB = `${JSON.stringify({ cells: [
  { cell_type: 'markdown', metadata: {}, source: ['# Sales\n', 'By month'] },
  { cell_type: 'code', execution_count: 3, metadata: {}, outputs: [{ output_type: 'stream', name: 'stdout', text: ['12\n'] }], source: ['total = sum(rows)\n', 'print(total)'] },
], metadata: { kernelspec: { name: 'python3' } }, nbformat: 4, nbformat_minor: 5 }, null, 1)}\n`;

async function run(replies, { files = {}, mode = 'bypass' } = {}) {
  const cwd = project();
  for (const [f, t] of Object.entries(files)) writeFileSync(join(cwd, f), t);
  const fake = await startFakeServer(replies);
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, flows: false, verify: false, confirmPlan: false, way: 'model', mode, ask: async () => ({ choice: 'yes' }) });
  await agent.send('do the thing');
  await fake.close();
  const sent = fake.requests.filter((r) => r.stream);
  const results = agent.messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
  return { cwd, sent, results, agent };
}

test('notebookChange: replace keeps the cell\'s kind and drops old outputs; insert and delete; only path lists the cells; a cell not there says how many', () => {
  const rep = notebookChange(NB, { cell: 1, source: 'print(len(rows))' });
  const after = JSON.parse(rep.after);
  expect(rep.said).toBe('Replaced cell 1 (code)');
  expect(after.cells[1]).toMatchObject({ cell_type: 'code', source: ['print(len(rows))'], outputs: [], execution_count: null });
  expect(after.metadata).toEqual({ kernelspec: { name: 'python3' } });
  expect(rep.after.endsWith('\n')).toBe(true);
  expect(rep.after.split('\n')[1]).toBe(' "cells": [');
  const ins = JSON.parse(notebookChange(NB, { mode: 'insert', cell: 0, cell_type: 'markdown', source: 'Intro\nline two' }).after);
  expect(ins.cells.map((c) => c.cell_type)).toEqual(['markdown', 'markdown', 'code']);
  expect(ins.cells[0].source).toEqual(['Intro\n', 'line two']);
  expect(JSON.parse(notebookChange(NB, { mode: 'insert', source: 'x = 1' }).after).cells.at(-1)).toMatchObject({ cell_type: 'code', source: ['x = 1'], outputs: [] });
  expect(JSON.parse(notebookChange(NB, { mode: 'delete', cell: 0 }).after).cells.map((c) => c.cell_type)).toEqual(['code']);
  expect(notebookChange(NB, {}).list).toBe('2 cells:\n0 · markdown · # Sales\n1 · code · total = sum(rows)');
  expect(notebookChange(NB, { cell: 5, source: 'x' }).error).toStartWith('There is no cell 5: the notebook has 2 (0 to 1).');
  expect(notebookChange(NB, { cell: 0 }).error).toBe('replace needs source: the cell\'s new text.');
  expect(notebookChange('not json', { cell: 0, source: 'x' }).error).toBe('This file is not a notebook: its text is not JSON.');
});

test('MultiEdit: every change goes in, in order, each seeing the one before', async () => {
  const { cwd, results } = await run([call('MultiEdit', { path: 'notes.txt', edits: [{ old_text: 'alpha', new_text: 'beta' }, { old_text: 'beta two', new_text: 'gamma two' }] }), { text: 'Done.' }], { files: { 'notes.txt': 'alpha two\nkeep\n' } });
  expect(readFileSync(join(cwd, 'notes.txt'), 'utf8')).toBe('gamma two\nkeep\n');
  expect(results[0]).toStartWith('All 2 changes went in.');
});

test('MultiEdit: one change that does not fit changes nothing, and says which', async () => {
  const { cwd, results } = await run([call('MultiEdit', { path: 'notes.txt', edits: [{ old_text: 'alpha', new_text: 'beta' }, { old_text: 'not in the file', new_text: 'x' }] }), { text: 'Stopped.' }], { files: { 'notes.txt': 'alpha two\nkeep\n' } });
  expect(readFileSync(join(cwd, 'notes.txt'), 'utf8')).toBe('alpha two\nkeep\n');
  expect(results[0]).toStartWith('Change 2 of 2 does not fit, so nothing was changed:');
});

test('MultiEdit in plan mode is refused as an Edit is', async () => {
  const { cwd, results } = await run([call('MultiEdit', { path: 'notes.txt', edits: [{ old_text: 'alpha', new_text: 'beta' }] }), { text: 'Planned.' }], { files: { 'notes.txt': 'alpha\n' }, mode: 'plan' });
  expect(readFileSync(join(cwd, 'notes.txt'), 'utf8')).toBe('alpha\n');
  expect(results[0]).toStartWith('Change 1 of 1:');
});

test('NotebookEdit: a cell replaced through an Edit; only path lists the cells; offered only where there is a notebook', async () => {
  const { cwd, results, sent } = await run([call('NotebookEdit', { path: 'sales.ipynb' }), call('NotebookEdit', { path: 'sales.ipynb', cell: 1, source: 'print(len(rows))' }), { text: 'Changed.' }], { files: { 'sales.ipynb': NB } });
  expect(results[0]).toBe('sales.ipynb: 2 cells:\n0 · markdown · # Sales\n1 · code · total = sum(rows)');
  expect(results[1]).toStartWith('Replaced cell 1 (code) of sales.ipynb.');
  expect(JSON.parse(readFileSync(join(cwd, 'sales.ipynb'), 'utf8')).cells[1].source).toEqual(['print(len(rows))']);
  const names = sent[0].tools.map((t) => t.function.name);
  expect(names).toContain('NotebookEdit');
  expect(names).toContain('MultiEdit');
  const plain = await run([{ text: 'Hi.' }]);
  expect(plain.sent[0].tools.map((t) => t.function.name)).not.toContain('NotebookEdit');
});
