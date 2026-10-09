// What the start says (start-notes.jsx, 9 Oct 2026): the mode the last window left, where the model runs and
// where the helpers run. Before, three notes under the start page, a paragraph each; the owner's picks from four
// designs drawn by the real app: "2 · In the page" (the Menu shows them in its own rows: Model, Mode in red with
// "kept from the last window", Helpers), one line under the Launcher, and one line for a /remote once the page
// has gone. The footer's tip stays.
import { test, expect } from 'bun:test';
import React from 'react';
import { renderToString } from 'ink';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HomePage, homeItems, itemAt, actionsOf } from '../src/app/home-looks.jsx';
import { startLine, remoteNote, helpersWords } from '../src/app/start-notes.jsx';
import { runInPty } from './pty.mjs';
import { T, setup, quit, ON_REMOTE } from './app-setup.mjs';
import { startFakeAnthropic } from './fake-anthropic.mjs';

const h = React.createElement;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const cells = (s) => [...s].length;
const draw = (props, cols) => strip(renderToString(h(HomePage, props), { columns: cols })).split('\n');
const flat = (t) => t.replace(/\s+/g, ' ');
const NOW = new Date(2026, 9, 9, 13, 10).getTime();
const HELPERS = [
  { label: '/btw and Side jobs', model: 'llama3.2:3b', where: 'service' },
  { label: 'Pictures', model: 'llava:latest', where: 'service' },
  { label: 'Code search', model: 'embeddinggemma:latest', where: 'service' },
  { label: 'Second opinion', model: 'laguna-xs-2.1:q8_0', where: 'service' },
  { label: 'UI design · checks', model: 'Qwen3.6:35B-A3B', where: 'service' },
];
// As the owner's window said it: Bypass from the last window, the Claude API answering in 408 ms, five helpers on the service.
const SAID = {
  mode: { kind: 'mode', mode: 'bypass', word: 'bypass permissions' },
  remote: { kind: 'remote', name: 'claude-opus-5-5 · api.anthropic.com', model: 'claude-opus-5-5', label: 'api.anthropic.com', claude: true, where: 'Claude API', ms: 408, helpers: HELPERS },
};
const START = {
  model: 'claude-opus-5-5 · api.anthropic.com', cwd: '~', notes: ['AGENTS.md', 'memory'], now: NOW, local: false,
  mode: 'bypass permissions', modeId: 'bypass', said: SAID,
  recent: Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, title: `Conversation ${i + 1}`, updated: new Date(NOW - (i + 1) * 3600e3).toISOString(), turns: 2 })),
};

test('the Menu says it in its own rows: the model and how fast it answered, the mode kept from the last window in red, the helpers with /profiles', () => {
  const rows = actionsOf(START);
  expect(rows.find((a) => a.id === 'model')).toMatchObject({ label: 'Model · Claude API · 408 ms', key: '/model' });
  expect(rows.find((a) => a.id === 'model').does).toContain('your prompts and files go to the Claude API');
  expect(rows.find((a) => a.id === 'mode')).toMatchObject({ label: 'Mode · bypass permissions', after: ' · kept from the last window', key: 'shift+tab', tone: 203 });
  expect(rows.find((a) => a.id === 'helpers')).toMatchObject({ label: 'Helpers · 5 models on the service', key: '/profiles' });
  expect(rows.map((a) => a.id)).toEqual(['new', 'model', 'mode', 'helpers', 'resume', 'settings', 'look']);
  // nothing said yet (or a start on this Mac): the rows as they were
  const plain = actionsOf({ ...START, said: null, modeId: 'ask', mode: 'manual' });
  expect(plain.find((a) => a.id === 'model').label).toBe('Switch model');
  expect(plain.find((a) => a.id === 'mode')).toMatchObject({ label: 'Mode · manual', after: '' });
  expect(plain.find((a) => a.id === 'mode').tone).toBeUndefined();
  expect(plain.some((a) => a.id === 'helpers')).toBe(false);
  // shift+tab moved on: the mode is no longer the one kept, so it no longer says so
  expect(actionsOf({ ...START, modeId: 'auto', mode: 'auto' }).find((a) => a.id === 'mode')).toMatchObject({ label: 'Mode · auto', after: '' });
  // helpers on more than one server
  expect(helpersWords([...HELPERS.slice(0, 2), { label: 'Pictures', model: 'x', where: 'Claude API' }])).toBe('3 models elsewhere');
});

test('the Menu with those rows fits every window, never wider than it, and Helpers is an item: a click on it is found, enter opens /profiles', () => {
  for (const [cols, room] of [[149, 41], [120, 50], [100, 21], [80, 17]]) {
    const lines = draw({ start: { ...START, room }, width: cols }, cols);
    expect(lines.length).toBe(room);
    for (const l of lines) expect(cells(l.trimEnd())).toBeLessThanOrEqual(cols);
    const text = lines.join('\n');
    expect(text).toContain('Model · Claude API · 408 ms');
    expect(text).toContain('Mode · bypass permissions · kept from the last window');
    expect(text).toContain('Helpers · 5 models on the service');
    const items = homeItems({ ...START, room }, cols);
    const helpers = items.find((it) => it.key === 'act:helpers');
    expect(helpers).toBeTruthy();
    expect(helpers.does).toBe('opens /profiles: which model each helper uses');
    const r = helpers.rects[0];
    expect(itemAt(items, r.row, r.from + 6)?.key).toBe('act:helpers');
    expect(lines[r.row]).toContain('Helpers ·');
  }
});

test('the Launcher\'s one line: whole in a wide window, losing words from the right in a narrow one, never wider than it', () => {
  const text = (w) => startLine(SAID, w).map((p) => p.map((x) => x.t).join('')).join('  ·  ');
  expect(text(149)).toBe('⏵⏵ bypass, kept from the last window  ·  claude-opus-5-5 on the Claude API, 408 ms  ·  5 helper models on the service');
  expect(text(120)).toBe('⏵⏵ bypass, from the last window  ·  claude-opus-5-5 on the Claude API, 408 ms  ·  5 helper models on the service');
  expect(text(100)).toBe('⏵⏵ bypass  ·  claude-opus-5-5 on the Claude API, 408 ms  ·  5 helper models on the service');
  expect(text(80)).toBe('⏵⏵ bypass  ·  claude-opus-5-5 on the Claude API');
  for (const w of [149, 120, 100, 90, 80, 70]) expect(cells(text(w))).toBeLessThanOrEqual(w - 4);
  // the bypass in its red, the rest grey
  expect(startLine(SAID, 149)[0][0]).toMatchObject({ t: '⏵⏵ bypass', c: 'ansi256(203)' });
  // only what was said: a start on this Mac in Bypass, a service at an address
  expect(startLine({ mode: SAID.mode }, 149).map((p) => p.map((x) => x.t).join('')).join('')).toBe('⏵⏵ bypass, kept from the last window');
  const svc = { remote: { ...SAID.remote, name: 'coder:30b · 127.0.0.1:8080', model: 'coder:30b', label: '127.0.0.1:8080', claude: false, where: 'OpenAI-compatible', ms: 12, helpers: [] } };
  expect(startLine(svc, 149).map((p) => p.map((x) => x.t).join('')).join('')).toBe('coder:30b on 127.0.0.1:8080, 12 ms');
});

test('a /remote once the page has gone: one line, where there were two paragraphs', () => {
  const line = remoteNote(SAID.remote);
  expect(line).toBe('On the remote: claude-opus-5-5 · api.anthropic.com · Claude API · answered in 408 ms · 5 helpers stay on the service');
  expect(cells(`· ${line}`)).toBeLessThanOrEqual(120); // with its mark, one line in the owner's smallest window (120 columns)
  expect(line).toMatch(ON_REMOTE);
  expect(remoteNote({ ...SAID.remote, helpers: [] })).toBe('On the remote: claude-opus-5-5 · api.anthropic.com · Claude API · answered in 408 ms');
});

// The owner's files, shape for shape: the Claude API in use, the helpers' profiles on a service (at an address
// nothing answers on: only where they are is read), Bypass kept from the last window.
function ownerHome(base, claudeUrl) {
  const cl = { source: 'claude', address: claudeUrl, port: null, connect: 'http', kind: 'claude', model: 'claude-opus-5-5', context: 0, key: true, keyEnd: '6789', keyId: 'claude' };
  const svc = { source: 'openai', address: 'http://127.0.0.1:9', port: null, connect: 'http', kind: 'openai', model: 'tiny:3b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ lastMode: 'bypass', homeLook: 'menu', remote: { ...cl, use: true }, remotes: { claude: cl, openai: svc } }));
  const server = (r) => ({ kind: r.kind, source: r.source, address: r.address, port: null, connect: r.connect, keyId: r.keyId });
  const profiles = {
    Main: { server: server(cl), model: 'claude-opus-5-5', backup: null, spillAfter: 30 },
    Fast: { server: server(svc), model: 'tiny:3b', backup: 'Main', spillAfter: 0 },
    Vision: { server: server(svc), model: 'llava:latest', backup: 'Main', spillAfter: 0 },
  };
  writeFileSync(join(base, 'home', 'profiles.json'), JSON.stringify({ profiles, uses: { 'ai:main': 'Main', 'ai:side': 'Fast', 'ai:btw': 'Fast', 'ai:pictures': 'Vision' } }));
}
const KEY = 'test-anthropic-key-0123456789';
const ENV = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: KEY, ANTHROPIC_API_KEY: '', AGENTIC_LAST_MODE: 'on' };

test('the real window on the Menu: the rows say it and nothing is under the page; Helpers opens /profiles; the Launcher has the one line, kept above your first message', async () => {
  for (const look of ['menu', 'launcher']) {
    const { cwd, env, base } = setup();
    const claude = await startFakeAnthropic([{ text: 'Answered by the Claude API.' }], { key: KEY });
    ownerHome(base, claude.url);
    const steps = look === 'menu'
      ? [{ wait: 'Model · Claude API · ', ms: 25_000 }, { sleep: 800 }, { snapshot: 'start' },
        { key: 'tab' }, { sleep: 200 }, { key: 'down' }, { sleep: 120 }, { key: 'down' }, { sleep: 120 }, { key: 'down' }, { sleep: 200 }, { snapshot: 'picked' },
        { key: 'enter' }, { wait: 'A profile is a server', ms: 10_000 }, { sleep: 300 }, { snapshot: 'profiles' }, { key: 'esc' }, { sleep: 300 }]
      : [{ wait: ON_REMOTE, ms: 25_000 }, { sleep: 800 }, { snapshot: 'start' },
        { type: 'hello' }, { key: 'enter' }, { wait: 'Answered by the Claude API.', ms: 20_000 }, { sleep: 800 }, { snapshot: 'after' }];
    const r = await runInPty({ cwd, cols: 149, rows: 50, env: { ...env, ...ENV, AGENTIC_HOME_LOOK: look }, args: ['--no-flows'], timeoutMs: 90_000, steps: [...steps, ...quit] });
    await claude.close();
    const s = r.snapshots;
    // no paragraph of the start anywhere
    for (const old of ['Started in bypass permissions', 'On the remote:', 'The helpers keep their own profiles']) expect(r.text).not.toContain(old);
    if (look === 'menu') {
      expect(s.start).toMatch(/Model · Claude API · \d+ ms\s+\/model/);
      expect(s.start).toMatch(/Mode · bypass permissions · kept from the last window\s+shift\+tab/);
      expect(s.start).toMatch(/Helpers · 2 models on the service\s+\/profiles/);
      // under the page: its last row, a blank row, the prompt box
      const lines = s.start.split('\n');
      const box = lines.findLastIndex((l) => l.startsWith('╭'));
      expect(lines[box - 2]).toContain('tab to pick from this page');
      expect(lines[box - 1].trim()).toBe('');
      expect(s.picked).toMatch(/❯\s+Helpers · 2 models on the service/);
      expect(s.picked).toContain('↵ opens /profiles: which model each helper uses');
      expect(s.profiles).toContain('A profile is a server, a model and its settings by name.');
    } else {
      expect(flat(s.start)).toMatch(/⏵⏵ bypass, kept from the last window · claude-opus-5-5 on the Claude API, \d+ ms · 2 helper models on the service/);
      // printed with the page above your first message
      expect(flat(s.after)).toMatch(/claude-opus-5-5 on the Claude API, \d+ ms · 2 helper models on the service.*› hello/);
    }
  }
}, T * 3);
