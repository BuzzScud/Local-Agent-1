// /helpers: the four context helpers, numbered and by codename (Scout, Medic,
// Oracle, Sentry), on or off, kept in settings.json; AGENTIC_HELPERS decides when it is set. The words first,
// then the real app in a pseudo-terminal (see app.test.mjs).
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { helpersFrom, changeHelpers, helperRows, HELPER_INFO } from '../src/app/helpers.mjs';
import { codenameOf, helpersOn } from '../src/agent/helpers.mjs';
import React from 'react';
import { renderToString } from 'ink';
import { Item } from '../src/app/screen.jsx';
import { COMMANDS } from '../src/app/commands.mjs';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

const all = () => new Set(['named', 'tests', 'rag', 'lsp']);

test('which are on: AGENTIC_HELPERS when set, else what /helpers saved, else all four', () => {
  expect([...helpersFrom({}, {})]).toEqual(['named', 'tests', 'rag', 'lsp']);
  expect([...helpersFrom({ helpers: ['tests', 'lsp'] }, {})]).toEqual(['tests', 'lsp']);
  expect([...helpersFrom({ helpers: [] }, {})]).toEqual([]);
  expect([...helpersFrom({ helpers: ['tests'] }, { AGENTIC_HELPERS: 'rag' })]).toEqual(['rag']);
  expect([...helpersFrom({}, { AGENTIC_HELPERS: 'off' })]).toEqual([]);
  // The codenames work wherever the ids do.
  expect([...helpersFrom({}, { AGENTIC_HELPERS: 'Scout,oracle' })]).toEqual(['named', 'rag']);
  expect([...helpersOn(['medic', 'lsp', 'nope'])]).toEqual(['tests', 'lsp']);
});

test('codenames: each kind of item on the Helpers line by the helper that brought it; anything else as it is', () => {
  expect(HELPER_INFO.map((h) => h.code)).toEqual(['Scout', 'Medic', 'Oracle', 'Sentry']);
  expect(['file', 'tests', 'changes', 'code', 'uses', 'rag', 'memory'].map(codenameOf)).toEqual(['Scout', 'Medic', 'Medic', 'Oracle', 'Sentry', 'Oracle', 'memory']);
});

test('/helpers off 3, off oracle, on rag, off all: by number, codename or name; a helper already so, or none named, says so', () => {
  const env = {};
  const a = changeHelpers(all(), 'off', '3', env);
  expect(a).toMatchObject({ changed: true, text: 'Oracle off: the next message uses it. Kept for next time (settings.json).' });
  expect([...a.on]).toEqual(['named', 'tests', 'lsp']);
  expect([...changeHelpers(a.on, 'on', 'rag', env).on]).toEqual(['named', 'tests', 'rag', 'lsp']);
  expect([...changeHelpers(a.on, 'on', 'Oracle', env).on]).toEqual(['named', 'tests', 'rag', 'lsp']);
  expect([...changeHelpers(all(), 'off', 'medic', env).on]).toEqual(['named', 'rag', 'lsp']);
  expect(changeHelpers(a.on, 'off', 'code by meaning', env)).toMatchObject({ changed: false, text: 'Oracle is already off.' });
  expect(changeHelpers(all(), 'off', 'ghost', env)).toMatchObject({ tone: 'warn', text: 'There is no helper "ghost": the four are 1 Scout, 2 Medic, 3 Oracle, 4 Sentry.' });
  expect(changeHelpers(all(), 'off', 'all', env)).toMatchObject({ changed: true, text: 'All four helpers off: the next message uses them. Kept for next time (settings.json).' });
  expect(changeHelpers(all(), 'off', '7', env).tone).toBe('warn');
  expect(changeHelpers(all(), 'off', '', env).text).toBe('Say which one: /helpers off 3, /helpers off oracle, /helpers off all.');
  expect(changeHelpers(all(), 'maybe', '1', env).tone).toBe('warn');
  // Set where the app started, AGENTIC_HELPERS decides: nothing changes, and it says why.
  const set = changeHelpers(all(), 'off', '1', { AGENTIC_HELPERS: 'all' });
  expect(set.changed).toBeUndefined();
  expect(set.text).toStartWith('AGENTIC_HELPERS=all is set where Agentic Coder started, so it decides');
});

test('the panel: one row a helper, on or off, its codename in bold, with what it brought to the last request', () => {
  const rows = helperRows(new Set(['named', 'tests', 'lsp']), [{ from: 'file', text: 'a.mjs', tokens: 640 }, { from: 'tests', text: 'npm test', tokens: 300 }, { from: 'changes', text: 'git diff', tokens: 900 }]);
  const left = (r) => (Array.isArray(r[0]) ? r[0].map((p) => p[0]).join('') : r[0]);
  expect(rows.map(left)).toEqual(['1  on   SCOUT   Files you name', '2  on   MEDIC   Tests and changes', '3  off  ORACLE  Code by meaning', '4  on   SENTRY  Light checks', '']);
  expect(rows.slice(0, 4).map((r) => r[0].filter((p) => p[1]).map((p) => p[0].trim()))).toEqual([['SCOUT'], ['MEDIC'], ['ORACLE'], ['SENTRY']]);
  expect(rows[0][1]).toBe(`${HELPER_INFO[0].what} · last request: 1 item, 640 tokens`);
  expect(rows[1][1]).toEndWith(' · last request: 2 items, 1.2k tokens');
  expect(rows[2][1]).toBe(HELPER_INFO[2].what);
  expect(COMMANDS.find((c) => c.name === 'helpers')).toMatchObject({ arg: '[on|off] [number|name|all]' });
  // /effort's Embedder Off: Oracle, on, says it finds nothing; off, nothing to say
  expect(helperRows(new Set(['rag']), [], { ragPaused: true })[2][1]).toContain('paused: Embedder is Off in /effort');
  expect(helperRows(new Set(['named']), [], { ragPaused: true })[2][1]).not.toContain('paused');
  expect(helperRows(new Set(['rag']))[2][1]).not.toContain('paused');
});

test('on screen: the Helpers line lists each item under its codename, the panel pads the bold codename cell like any other', () => {
  const strip = (t) => t.replace(/\x1b\[[0-9;]*m/g, '');
  const draw = (it) => strip(renderToString(React.createElement(Item, { it, width: 120 }), { columns: 120 }));
  const line = draw({ type: 'context', title: 'Helpers', open: true, tokens: 900, how: 'meaning', items: [
    { from: 'tests', text: 'bun test · 2 failing', tokens: 300 }, { from: 'changes', text: 'git diff · 1 changed file', tokens: 400 },
    { from: 'code', text: 'src/fs.mjs · readAll', close: 0.71, tokens: 150 }, { from: 'uses', text: 'readAll', tokens: 50 }] });
  expect(line).toMatch(/Medic\s+bun test · 2 failing/);
  expect(line).toMatch(/Medic\s+git diff · 1 changed file/);
  expect(line).toMatch(/Oracle\s+src\/fs\.mjs · readAll\s+fit 0\.71 · 150 tokens/);
  expect(line).toMatch(/Sentry\s+readAll/);
  // Another context line (the memory's) keeps its own words.
  expect(draw({ type: 'context', title: 'Context', open: true, tokens: 20, items: [{ from: 'memory', text: 'a fact', tokens: 20 }] })).toMatch(/memory\s+a fact/);
  const panel = draw({ type: 'panel', title: 'Helpers', pad: 35, rows: helperRows(all()) }).split('\n');
  expect(panel[1]).toBe(`${'1  on   SCOUT   Files you name'.padEnd(35)}${HELPER_INFO[0].what}`);
  expect(panel[4]).toBe(`${'4  on   SENTRY  Light checks'.padEnd(35)}${HELPER_INFO[3].what}`);
});

test('/helpers in the app: the four listed, one switched off and kept in settings.json, all switched off', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([]);
  const was = process.env.AGENTIC_HELPERS;
  delete process.env.AGENTIC_HELPERS; // the tests set it (test-env.mjs); here /helpers decides
  let r;
  try {
    r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
      { wait: 'Welcome' },
      { type: '/helpers' }, { key: 'enter' }, { wait: 'Light checks' }, { sleep: 150 }, { snapshot: 'list' },
      { type: '/helpers off oracle' }, { key: 'enter' }, { wait: 'Kept for next time' }, { sleep: 100 },
      { type: '/helpers' }, { key: 'enter' }, { wait: '3 of 4 on' }, { sleep: 150 }, { snapshot: 'after' },
      { type: '/helpers off all' }, { key: 'enter' }, { wait: 'All four helpers off' },
      ...quit,
    ] });
  } finally { if (was === undefined) delete process.env.AGENTIC_HELPERS; else process.env.AGENTIC_HELPERS = was; }
  await fake.close();
  expect(r.snapshots.list).toContain('Helpers · 4 of 4 on · what comes along with a request before the first step');
  expect(r.snapshots.list).toMatch(/1\s+on\s+SCOUT\s+Files you name\s+read whole before the first step \(Read first\)/);
  expect(r.snapshots.list).toMatch(/4\s+on\s+SENTRY\s+Light checks\s+a syntax check after every edit/);
  expect(r.text).toContain('Oracle off: the next message uses it. Kept for next time (settings.json).');
  expect(r.snapshots.after).toMatch(/3\s+off\s+ORACLE\s+Code by meaning/);
  expect(JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8')).helpers).toEqual([]);
}, T);

test('/helpers with AGENTIC_HELPERS set: it says that the variable decides, and changes nothing', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_HELPERS: 'named' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' },
    { type: '/helpers' }, { key: 'enter' }, { wait: 'Light checks' }, { sleep: 150 }, { snapshot: 'list' },
    { type: '/helpers on 3' }, { key: 'enter' }, { wait: 'so it decides' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.list).toContain('Helpers · 1 of 4 on');
  expect(r.snapshots.list).toContain('AGENTIC_HELPERS=named decides');
  expect(r.text).toContain('AGENTIC_HELPERS=named is set where Agentic Coder started, so it decides which helpers are on.');
}, T);
