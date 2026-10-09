// The window's back end in parts (app-slash.mjs, app-panels.mjs, app-keys.mjs): each slash command
// has one group to run it, and the parts put together give the App the same names as before.
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME = mkdtempSync(join(tmpdir(), 'slash-parts-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const app = join(import.meta.dir, '..', 'src', 'app');
const GROUPS = ['session', 'setup', 'design', 'panels', 'model', 'tools', 'window'];
const lists = await Promise.all(GROUPS.map(async (g) => {
  const m = await import(join(app, `slash-${g}.mjs`));
  return Object.values(m).find(Array.isArray);
}));

test('no slash command is in two groups', () => {
  const all = lists.flat();
  expect(all.filter((c, i) => all.indexOf(c) !== i)).toEqual([]);
});

test('every command in the / menu and in /settings has a group that runs it', async () => {
  const { COMMANDS, IN_SETTINGS } = await import(join(app, 'commands.mjs'));
  const all = new Set(lists.flat());
  const names = [...COMMANDS.map((c) => c.name), ...IN_SETTINGS];
  expect(names.filter((n) => !all.has(n))).toEqual([]);
});

test('a command no group has is not run by a group: it goes on to the unknown-command note', async () => {
  const { slashPart } = await import(join(app, 'app-slash.mjs'));
  const said = [];
  const self = { agent: { busy: false }, mcpHub: null, push: (m) => said.push(m.text) };
  await slashPart(self).runSlashFn('/nosuchcommand');
  expect(said).toEqual(['Unknown command /nosuchcommand. /settings has the ones not in the / menu, and /help lists them all.']);
});

test('a group runs its own command: /help opens the Help page', async () => {
  const { slashPart } = await import(join(app, 'app-slash.mjs'));
  const opened = [];
  const self = { agent: { busy: false }, openHub: (tab) => { opened.push(tab); return null; }, setPopup: () => {} };
  await slashPart(self).runSlashFn('/help');
  expect(opened).toEqual(['help']);
});

test('the panels put together give the App every name it had, each a function', async () => {
  const { panelsPart } = await import(join(app, 'app-panels.mjs'));
  const p = panelsPart({});
  expect(Object.keys(p).length).toBe(34);
  expect(Object.entries(p).filter(([, v]) => typeof v !== 'function').map(([k]) => k)).toEqual([]);
});

test("onKey's panel keys are one function each", async () => {
  const { pickerKeysPart } = await import(join(app, 'keys-pickers.mjs'));
  const k = pickerKeysPart({});
  expect(Object.keys(k)).toEqual(['permKeys', 'btwKeys', 'serviceKeys', 'modelKeys', 'formKeys', 'limitsKeys', 'choiceKeys', 'rewindKeys']);
});
