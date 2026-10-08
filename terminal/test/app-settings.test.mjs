// /settings: the commands kept out of the / menu, in one grouped menu (the
// real app in a pseudo-terminal, see app.test.mjs), and `coding hub [tab]`.
import { test, expect } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit, quitTyped } from './app-setup.mjs';
import { COMMANDS, SETTINGS, IN_SETTINGS, TYPED_ONLY, WHEN_ROOM, REMOTE_ONLY, matchCommands } from '../src/app/commands.mjs';
import { helpData, cliHelpText, setupModels } from '../src/app/help.mjs';

const CLI = join(import.meta.dir, '..', 'src', 'cli.jsx');
const down = (n) => Array.from({ length: n }, () => [{ key: 'down' }, { sleep: 60 }]).flat();

test('coding setup --model names every other model in /model, from the model list: none is left out when one is added', () => {
  const all = { a: { id: 'a', name: 'Alpha 9B' }, q: { id: 'q', name: 'Qwen 9B' }, k: { id: 'k', name: 'K 7B' }, b: { id: 'b', name: 'B 27B' } };
  const models = setupModels(all, 'q');
  expect(models.map((m) => m.id)).toEqual(['q', 'a', 'k', 'b']); // the default first: it is plain `coding setup`
  const row = helpData({ models }).cli.usage.find(([c]) => c.startsWith('coding setup --model'));
  expect(row).toEqual(['coding setup --model a', 'the same for another model in /model (a: Alpha 9B, k: K 7B, b: B 27B)']);
  expect(cliHelpText({ version: '0', modelName: 'Qwen 9B', lingerMins: 30, models })).toContain('a: Alpha 9B, k: K 7B, b: B 27B');
  expect(helpData().cli.usage.find(([c]) => c.startsWith('coding setup --model'))).toEqual(['coding setup --model <id>', 'the same for another model in /model']);
});

test('the / menu holds 18 commands and /settings the other 18; every one is still a command, and the Help page lists both parts', () => {
  // Where a side question can be taken (a remote, a server with a second lane): the 18, /btw among them.
  const menu = matchCommands('/', { side: true }).map((c) => c.name);
  expect(menu).toEqual(['help', 'clear', 'compact', 'btw', 'agents', 'effort', 'mode', 'math', 'design', 'rewind', 'resume', 'model', 'start', 'stop', 'remote', 'test', 'settings', 'exit']);
  // On this Mac's own model /btw is off (3 Oct 2026, the owner's pick: only on a remote): it leaves
  // the menu, and its row goes to /jumptomac, which fits the 18 there.
  expect([...REMOTE_ONLY]).toEqual(['btw']);
  const here = matchCommands('/').map((c) => c.name);
  expect(here).toEqual(['help', 'clear', 'compact', 'agents', 'effort', 'mode', 'math', 'design', 'rewind', 'resume', 'model', 'start', 'stop', 'remote', 'jumptomac', 'test', 'settings', 'exit']);
  expect(matchCommands('/btw')).toEqual([]);
  expect(matchCommands('/btw', { side: true }).map((c) => c.name)).toEqual(['btw']);
  expect(COMMANDS.some((c) => c.name === 'btw')).toBe(true); // typed in full it runs, and says where it works
  expect([...IN_SETTINGS]).toEqual(['permissions', 'meters', 'mouse', 'autostart', 'helpers', 'hooks', 'rules', 'instructions', 'memory', 'web', 'weights', 'docs', 'arena', 'tests', 'stats', 'doctor', 'init', 'update']);
  expect(SETTINGS.map((g) => g.group)).toEqual(['Setup', 'Pages · the hub in the browser', 'Tools']);
  for (const n of IN_SETTINGS) {
    expect(COMMANDS.some((c) => c.name === n)).toBe(true); // typed in full it still runs
    expect(menu).not.toContain(n);
  }
  // On an Ollama service /subagents takes the place of /start and /stop: 17, so /jumptomac fits as the 18th.
  const onService = matchCommands('/', { service: true, side: true }).map((c) => c.name);
  expect(onService).toEqual(['help', 'clear', 'compact', 'btw', 'agents', 'effort', 'mode', 'math', 'design', 'rewind', 'resume', 'model', 'subagents', 'remote', 'jumptomac', 'test', 'settings', 'exit']); // 18: /jumptomac fits there
  expect(COMMANDS.some((c) => c.name === 'subagents')).toBe(true);
  // /agents took /morning's row (2 Oct 2026): /morning is typed only, and still a command on /help
  expect([...TYPED_ONLY]).toEqual(['morning']);
  // /jumptomac (3 Oct 2026): in the whole menu where a 19th row fits (a window taller than 80 × 24),
  // and in any window once its name is typed; typed only, nobody saw it.
  // /loop and /loops (3 Oct 2026) follow it, in that order, then /mcp and /jobs: one free row shows /jumptomac, five all of them.
  expect([...WHEN_ROOM]).toEqual(['jumptomac', 'loop', 'loops', 'mcp', 'jobs']);
  expect(matchCommands('/', { room: 20 }).map((c) => c.name)).toEqual(['help', 'clear', 'compact', 'agents', 'effort', 'mode', 'math', 'design', 'rewind', 'resume', 'model', 'start', 'stop', 'remote', 'jumptomac', 'loop', 'loops', 'test', 'settings', 'exit']);
  expect(matchCommands('/', { room: 19 }).map((c) => c.name)).not.toContain('loops');
  expect(matchCommands('/', { room: 21 }).map((c) => c.name)).toContain('mcp'); // a fourth free row is /mcp's
  expect(matchCommands('/loop').map((c) => c.name)).toEqual(['loop', 'loops']);
  expect(matchCommands('/mc').map((c) => c.name)).toEqual(['mcp']);
  expect(menu).not.toContain('jumptomac');
  const tall = matchCommands('/', { room: 49, side: true }).map((c) => c.name);
  expect(tall).toEqual(['help', 'clear', 'compact', 'btw', 'agents', 'effort', 'mode', 'math', 'design', 'rewind', 'resume', 'model', 'start', 'stop', 'remote', 'jumptomac', 'loop', 'loops', 'mcp', 'jobs', 'test', 'settings', 'exit']);
  expect(matchCommands('/j').map((c) => c.name)).toEqual(['jumptomac', 'jobs']);
  expect(matchCommands('/jo').map((c) => c.name)).toEqual(['jobs']);
  expect(matchCommands('/jump').map((c) => c.name)).toEqual(['jumptomac']);
  expect(menu.length + IN_SETTINGS.size + 1 + TYPED_ONLY.size + WHEN_ROOM.size).toBe(COMMANDS.length); // nothing lost, nothing in both (+ /subagents, on a service only)
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
    { type: '/se' }, { wait: 'Everything else in one menu' }, { key: 'enter' }, { wait: 'enter opens it' }, { sleep: 200 }, { snapshot: 'menu' },
    ...down(14), { sleep: 150 }, { snapshot: 'stats' }, { key: 'enter' }, { wait: 'writing speed' },
    { type: '/settings' }, { key: 'enter' }, { wait: 'enter opens it' }, { sleep: 150 }, { key: 'down' }, { sleep: 100 }, { key: 'enter' }, { wait: 'Kept for next time' }, { sleep: 150 }, { snapshot: 'meters' }, { key: 'esc' }, { wait: 'Kept the status bar as off' },
    { type: '/settings' }, { key: 'enter' }, { wait: 'enter opens it' }, { sleep: 150 }, { key: 'up' }, { sleep: 100 }, { snapshot: 'wrapped' }, { key: 'esc' }, { sleep: 300 }, { snapshot: 'closed' },
    { type: '/doctor' }, { sleep: 250 }, { snapshot: 'typed' }, { key: 'enter' }, { wait: 'free memory' },
    { type: '/do' }, { key: 'enter' }, { wait: 'Unknown command /do' },
    ...quitTyped,
  ] });
  await fake.close();
  // The menu (7 Oct 2026, "3 · Launcher"): a rule with its name, its line, then name and value in
  // a list, the row you are on in full beside it.
  const all = r.snapshots.menu.split('\n');
  const top = all.findIndex((l) => /^\s{2}── Settings · /.test(l));
  expect(top).toBeGreaterThanOrEqual(0);
  const m = all.slice(top).join('\n');
  expect(m).toContain('Everything not in the / menu. Each still works typed in full, like /doctor.');
  for (const g of ['Setup', 'Pages', 'Tools']) expect(m).toMatch(new RegExp(`^\\s{2}${g}\\s`, 'm'));
  expect(m).toMatch(/❯ Permissions\s+0 saved · manual\s/); // the first row of Setup
  expect(m).toMatch(/^\s{2}Setup\s+│\s+Permissions$/m); // its card beside the list, from the top
  expect(m).toContain('what runs without asking, what never runs');
  expect(m).toMatch(/Status bar\s+off\s/);
  expect(m).toMatch(/Mouse\s+on\s/); // on unless turned off
  expect(m).toMatch(/Model at start\s+off · \/start loads it/);
  expect(m).toMatch(/Helpers\s+\d of 4 on\s/);
  expect(m).toMatch(/Hooks\s+all run: App decides/);
  expect(m).toMatch(/Test record\s+no runs yet\s/); // a fresh home has no test record
  expect(m).toMatch(/Arena\s+\d+ tests? · \d+ runs?\s/);
  expect(m).toMatch(/Update\s+\d+\.\d+\.\d+ · nothing new/);
  expect(m).toMatch(/Web\s+no search · pages on/);
  // every row has something in its value column: no blank cell
  const rows = m.split('\n').filter((l) => /^\s{2}(❯ | {2})[A-Z]/.test(l));
  expect(rows).toHaveLength(18);
  for (const l of rows) expect(l).toMatch(/^\s{2}(❯ | {2})\S[\w ]*?\s{2,}\S/);
  expect(r.snapshots.stats).toMatch(/❯ Stats\s/);
  expect(r.snapshots.meters).toMatch(/2\. Off.*✔ in use/);
  expect(r.snapshots.wrapped).toMatch(/❯ Update\s/); // ↑ from the top wraps to the last row
  expect(r.snapshots.closed).not.toContain('enter opens it');
  expect(r.snapshots.typed).not.toMatch(/^\s{2}\/doctor\s/m); // no menu under a hidden name…
  expect(r.text).toContain('Doctor'); // …and enter still runs it
  expect(r.text).toContain('Unknown command /do. /settings has the ones not in the / menu, and /help lists them all.');
}, T);

test('/settings in the smallest window (80 × 24): the whole menu shows, its rule to the last row', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, cols: 80, rows: 24, args: ['--url', fake.url, '--no-flows'], steps: [
    // 18 rows at this height (Model at start, 30 Sep 2026): every row shows, the rule on top to the last row
    { wait: '? for shortcuts' }, { type: '/settings' }, { key: 'enter' }, { wait: 'Update' }, { sleep: 300 }, { snapshot: 'menu' }, { key: 'esc' }, { sleep: 300 },
    // with the status bar on there is one line less: the menu's own line goes, its rule stays on screen
    { type: '/meters on' }, { key: 'enter' }, { wait: 'Status bar on' },
    { type: '/settings' }, { key: 'enter' }, { wait: 'Test record' }, { sleep: 300 }, { snapshot: 'bar' }, { key: 'esc' }, { sleep: 300 },
    ...quit,
  ] });
  await fake.close();
  const screen = r.snapshots.menu.trimEnd().split('\n').slice(-24).join('\n');
  expect(screen).toMatch(/^\s{2}── Settings · /m); // its top is on screen
  expect(screen).toMatch(/Update\s/);
  expect(screen).toMatch(/Model at start\s/);
  const vb = r.terms.bar.buffer.active; // the window as it is, 24 rows
  const bar = Array.from({ length: 24 }, (_, i) => vb.getLine(vb.baseY + i)?.translateToString(true) ?? '').join('\n');
  expect(bar).toMatch(/^\s{2}── Settings · /m);
  expect(bar).not.toContain('Everything not in the / menu'); // its line goes when the status bar takes one
  expect(bar).toMatch(/Update\s/);
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
  expect(bad.stderr).toContain('coding hub: no tab called notes. Tabs: weights, docs, harness, structure, flow, arena, tests, builder, battle, remote, memory, instructions, help.');
  const noModel = spawnSync('bun', [CLI, 'hub'], { encoding: 'utf8', env: { ...process.env, ...env } }); // weights is the default, and this home has no model file
  expect(noModel.status).toBe(1);
  expect(noModel.stderr).toContain('open another tab (coding hub docs)');
}, T);
