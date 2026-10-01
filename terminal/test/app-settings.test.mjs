// /settings: the commands kept out of the / menu, in one grouped menu (the
// real app in a pseudo-terminal, see app.test.mjs), and `coding hub [tab]`.
import { test, expect } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit, quitTyped } from './app-setup.mjs';
import { COMMANDS, SETTINGS, IN_SETTINGS, matchCommands } from '../src/app/commands.mjs';
import { helpData } from '../src/app/help.mjs';

const CLI = join(import.meta.dir, '..', 'src', 'cli.jsx');
const down = (n) => Array.from({ length: n }, () => [{ key: 'down' }, { sleep: 60 }]).flat();

test('the / menu holds 18 commands and /settings the other 18; every one is still a command, and the Help page lists both parts', () => {
  const menu = matchCommands('/').map((c) => c.name);
  expect(menu).toEqual(['help', 'clear', 'compact', 'btw', 'effort', 'mode', 'math', 'design', 'rewind', 'resume', 'model', 'start', 'stop', 'remote', 'test', 'morning', 'settings', 'exit']);
  expect([...IN_SETTINGS]).toEqual(['permissions', 'meters', 'mouse', 'autostart', 'helpers', 'hooks', 'rules', 'instructions', 'memory', 'web', 'weights', 'docs', 'arena', 'tests', 'stats', 'doctor', 'init', 'update']);
  expect(SETTINGS.map((g) => g.group)).toEqual(['Setup', 'Pages · the hub in the browser', 'Tools']);
  for (const n of IN_SETTINGS) {
    expect(COMMANDS.some((c) => c.name === n)).toBe(true); // typed in full it still runs
    expect(menu).not.toContain(n);
  }
  expect(menu.length + IN_SETTINGS.size).toBe(COMMANDS.length); // nothing lost, nothing in both
  expect(matchCommands('/doc')).toEqual([]); // half a hidden name finds nothing
  expect(matchCommands('/se').map((c) => c.name)).toEqual(['settings']);
  expect(matchCommands('/te').map((c) => c.name)).toEqual(['test', 'remote']); // /tests (the record) is in /settings; remote holds "te"
  const h = helpData();
  expect(h.commands.filter((c) => c.settings).map((c) => c.name).sort()).toEqual([...IN_SETTINGS].sort());
  expect(h.settings.flatMap((g) => g.names)).toEqual([...IN_SETTINGS]);
});

test('/settings: three groups, a value on every row, enter runs the row (Stats), Status bar opens its own menu, esc closes, and the hidden names still run typed in full', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' },
    { type: '/se' }, { wait: 'Everything else in one menu' }, { key: 'enter' }, { wait: 'Everything not in the / menu' }, { sleep: 200 }, { snapshot: 'menu' },
    ...down(14), { sleep: 150 }, { snapshot: 'stats' }, { key: 'enter' }, { wait: 'writing speed' },
    { type: '/settings' }, { key: 'enter' }, { wait: 'Everything not in the / menu' }, { sleep: 150 }, { key: 'down' }, { sleep: 100 }, { key: 'enter' }, { wait: 'Kept for next time' }, { sleep: 150 }, { snapshot: 'meters' }, { key: 'esc' }, { wait: 'Kept the status bar as off' },
    { type: '/settings' }, { key: 'enter' }, { wait: 'Everything not in the / menu' }, { sleep: 150 }, { key: 'up' }, { sleep: 100 }, { snapshot: 'wrapped' }, { key: 'esc' }, { sleep: 300 }, { snapshot: 'closed' },
    { type: '/doctor' }, { sleep: 250 }, { snapshot: 'typed' }, { key: 'enter' }, { wait: 'free memory' },
    { type: '/do' }, { key: 'enter' }, { wait: 'Unknown command /do' },
    ...quitTyped,
  ] });
  await fake.close();
  // Only the menu's own box (the start page above it is drawn with │ too).
  const all = r.snapshots.menu.split('\n');
  const top = all.findIndex((l) => /^│ Settings\s/.test(l));
  const m = all.slice(top, top + all.slice(top).findIndex((l) => l.startsWith('╰')) + 1).join('\n');
  for (const g of ['Setup', 'Pages · the hub in the browser', 'Tools']) expect(m).toContain(`│ ${g}`);
  expect(m).toMatch(/❯ Permissions\s+0 saved · ask first\s+what runs without asking, what never runs/); // the first row of Setup
  expect(m).toMatch(/Status bar\s+off\s+model, speed and memory under the prompt/);
  expect(m).toMatch(/Mouse\s+off\s+drag to highlight text in the prompt box/);
  expect(m).toMatch(/Model at start\s+off · \/start loads it\s+load the model as a window opens/);
  expect(m).toMatch(/Helpers\s+\d of 4 on\s/);
  expect(m).toMatch(/Hooks\s+all run: App decides\s+the app's checks, while the model decides/);
  expect(m).toMatch(/Test record\s+no runs yet\s/); // a fresh home has no test record
  expect(m).toMatch(/Arena\s+\d+ tests? · \d+ runs?\s/);
  expect(m).toMatch(/Update\s+\d+\.\d+\.\d+ · nothing new\s/);
  // every row has something in its value column: no blank cell
  const rows = m.split('\n').filter((l) => /^│ [❯ ] \S/.test(l));
  expect(rows).toHaveLength(18);
  expect(m).toMatch(/Web\s+no search · pages on\s+search the web and read pages/);
  for (const l of rows) expect(l).toMatch(/^│ [❯ ] \S[\w ]*?\s{2,}\S.*\s{3,}\S/);
  expect(r.snapshots.stats).toMatch(/❯ Stats\s/);
  expect(r.snapshots.meters).toMatch(/2\. Off.*✔ in use/);
  expect(r.snapshots.wrapped).toMatch(/❯ Update\s/); // ↑ from the top wraps to the last row
  expect(r.snapshots.closed).not.toContain('Everything not in the / menu');
  expect(r.snapshots.typed).not.toMatch(/^\s{2}\/doctor\s/m); // no menu under a hidden name…
  expect(r.text).toContain('Doctor'); // …and enter still runs it
  expect(r.text).toContain('Unknown command /do. /settings has the ones not in the / menu, and /help lists them all.');
}, T);

test('/settings in the smallest window (80 × 24): the gaps drop and the whole menu shows, title to last row', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, cols: 80, rows: 24, args: ['--url', fake.url, '--no-flows'], steps: [
    // 18 rows at this height (Model at start, 30 Sep 2026): the line under the title goes, the title joins the
    // first group's line, and the key hint goes too; every row still shows, title to last row
    { wait: '? for shortcuts' }, { type: '/settings' }, { key: 'enter' }, { wait: 'Update' }, { sleep: 300 }, { snapshot: 'menu' }, { key: 'esc' }, { sleep: 300 },
    // with the status bar on there is one line less: the last heading (Tools) goes too, the menu's top edge stays
    { type: '/meters on' }, { key: 'enter' }, { wait: 'Status bar on' },
    { type: '/settings' }, { key: 'enter' }, { wait: 'Test record' }, { sleep: 300 }, { snapshot: 'bar' }, { key: 'esc' }, { sleep: 300 },
    ...quit,
  ] });
  await fake.close();
  const screen = r.snapshots.menu.trimEnd().split('\n').slice(-24).join('\n');
  expect(screen).toMatch(/│ Settings\s/);
  expect(screen).toMatch(/Update\s/);
  expect(screen).toMatch(/Model at start\s/);
  expect(screen).not.toMatch(/│\s+│\n│ Setup/); // no blank line before a group at this height
  expect(screen).toMatch(/╭─+╮\n│ Settings\s/); // its top edge is on screen
  const vb = r.terms.bar.buffer.active; // the window as it is, 24 rows
  const bar = Array.from({ length: 24 }, (_, i) => vb.getLine(vb.baseY + i)?.translateToString(true) ?? '').join('\n');
  expect(bar).toMatch(/╭─+╮\n│ Settings · Setup\s+│/);
  expect(bar).toMatch(/Update\s/);
  expect(bar).toMatch(/Test record .*\n│ {3}Stats\s/); // no Tools heading at this height
  expect(bar).toMatch(/ctx .* of 32k/); // the status bar under it
}, T);

// `coding hub <tab>` prints the hub's address with its tab, then waits for ctrl+c.
function hubLine(args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn('bun', [CLI, ...args], { env: { ...process.env, ...env, AGENTIC_NO_OPEN: '1', AGENTIC_HUB_PORT: '0', AGENTIC_NO_UPDATE: '1' } });
    let out = '';
    const done = (v) => { clearTimeout(t); p.kill('SIGINT'); resolve(v); };
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`no hub line: ${out}`)); }, 15_000);
    p.stdout.on('data', (d) => { out += d; const m = /\?tab=(\w+)/.exec(out); if (m) done(m[1]); });
    p.on('exit', (code) => { if (code) reject(new Error(`exit ${code}: ${out}`)); });
  });
}

test('coding hub [tab]: --help lists it once instead of six words; each tab opens, the old words still work, an unknown tab says which exist', async () => {
  const { env } = setup();
  const help = spawnSync('bun', [CLI, '--help'], { encoding: 'utf8', env: { ...process.env, ...env } }).stdout;
  expect(help).toContain('coding hub [tab]');
  for (const w of ['weights', 'docs', 'arena', 'tests', 'instructions', 'battle', 'memory']) expect(help).not.toMatch(new RegExp(`^  coding ${w}\\s`, 'm'));
  expect(await hubLine(['hub', 'arena'], env)).toBe('arena');
  expect(await hubLine(['hub', 'tests'], env)).toBe('arena'); // the Tests tab is the Arena now (with the record up)
  expect(await hubLine(['hub', 'builder'], env)).toBe('builder');
  expect(await hubLine(['hub', 'docs'], env)).toBe('harness');
  expect(await hubLine(['hub', 'Battle'], env)).toBe('arena'); // and so is the Battle tab
  expect(await hubLine(['tests'], env)).toBe('arena'); // the old word
  expect(await hubLine(['memory'], env)).toBe('memory');
  const bad = spawnSync('bun', [CLI, 'hub', 'notes'], { encoding: 'utf8', env: { ...process.env, ...env } });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toContain('coding hub: no tab called notes. Tabs: weights, docs, harness, structure, flow, arena, tests, builder, battle, memory, instructions, help.');
  const noModel = spawnSync('bun', [CLI, 'hub'], { encoding: 'utf8', env: { ...process.env, ...env } }); // weights is the default, and this home has no model file
  expect(noModel.status).toBe(1);
  expect(noModel.stderr).toContain('open another tab (coding hub docs)');
}, T);
