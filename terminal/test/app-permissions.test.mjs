// /permissions in the real app (a pseudo-terminal, see app.test.mjs) and in
// `coding -p`: the "always allow" choice, a protected file in Auto-edit, the
// saved start-up mode, a rules file that cannot be read, the picker, and the
// never-list under --yes. The model is the scripted fake.
import { test, expect } from 'bun:test';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

const bash = (command) => ({ tool: { name: 'Bash', args: { command, description: 'x' } } });
const write = (path, content) => ({ tool: { name: 'Write', args: { path, content } } });
const saveRules = (base, rules) => writeFileSync(join(base, 'home', 'permissions.json'), JSON.stringify(rules));

test('"always allow" saves the rule for this folder: it runs now, is not asked again, and holds in the next window', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([bash('node --test'), { text: 'The tests pass.' }, bash('node --test'), { text: 'Again, and no question.' }]);
  // A second question would stall the run until it timed out: nothing answers it.
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'run the tests' }, { key: 'enter' },
    { wait: 'Do you want to proceed?' }, { sleep: 200 }, { snapshot: 'ask' }, { type: '3' },
    { wait: 'The tests pass.' }, { type: 'again' }, { key: 'enter' }, { wait: 'Again, and no question.' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.ask).toContain("2. Yes, and don't ask again for node --test this session");
  expect(r.snapshots.ask).toContain('3. Yes, and always allow node --test in this folder');
  expect(r.text).toContain('Saved for this folder: "node --test" runs without asking.');
  const saved = JSON.parse(readFileSync(join(base, 'home', 'permissions.json'), 'utf8'));
  expect(saved).toEqual({ folders: { [realpathSync(cwd)]: { allow: ['node --test'] } } });
  const fake2 = await startFakeServer([bash('node --test'), { text: 'Next window, no question.' }]);
  await runInPty({ cwd, env, args: ['--url', fake2.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'run the tests' }, { key: 'enter' }, { wait: 'Next window, no question.' }, ...quit,
  ] });
  await fake2.close();
  expect(JSON.stringify(fake2.requests)).not.toContain('The user said no');
}, T * 2);

test('Auto-edit: a protected file asks with only yes and no, and says why; no leaves it unwritten', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([write('notes.md', '# Notes\n'), write('.env', 'API_URL=http://localhost:3000\n'), { text: 'Left it.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows', '--mode', 'edits'], steps: [
    { wait: '? for shortcuts' }, { type: 'add the files' }, { key: 'enter' },
    { wait: 'Go ahead?' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'Do you want to create .env?' }, { sleep: 200 }, { snapshot: 'env' }, { key: 'esc' }, { sleep: 600 },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.env).toContain('Protected: .env always asks before a change, even in Auto-edit.');
  expect(r.snapshots.env).toMatch(/1\. Yes\s/);
  expect(r.snapshots.env).toMatch(/2\. No, and tell Agentic Coder/);
  expect(r.snapshots.env).not.toContain('allow all edits');
  expect(existsSync(join(cwd, 'notes.md'))).toBe(true);
  expect(existsSync(join(cwd, '.env'))).toBe(false);
}, T);

test('a start-up mode saved with /permissions: the next window starts in it and says so; a rules file that cannot be read turns them off, says so, and is left as it was', async () => {
  const { cwd, env, base } = setup();
  saveRules(base, { folders: { [realpathSync(cwd)]: { mode: 'edits' } } });
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [{ wait: '? for shortcuts' }, { sleep: 400 }, { snapshot: 'start' }, ...quit] });
  expect(r.snapshots.start).toContain('auto-edit (/permissions)');
  expect(r.snapshots.start).toContain('⏵⏵ accept edits on');
  writeFileSync(join(base, 'home', 'permissions.json'), '{ "folders": ');
  const r2 = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [{ wait: '? for shortcuts' }, { wait: 'cannot be read' }, { sleep: 300 }, { snapshot: 'start' }, ...quit] });
  await fake.close();
  expect(r2.snapshots.start).toContain('permissions.json cannot be read');
  expect(r2.snapshots.start).not.toContain('accept edits on'); // the saved mode is off with the rest
  expect(readFileSync(join(base, 'home', 'permissions.json'), 'utf8')).toBe('{ "folders": ');
}, T * 2);

test('/permissions: five rows with what they hold, enter opens a list, test says why without running it, mode switches now and is kept', async () => {
  const { cwd, env, base } = setup();
  saveRules(base, { everywhere: { never: ['npm publish'] }, folders: { [realpathSync(cwd)]: { allow: ['node --test'] } } });
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/permissions' }, { key: 'enter' }, { wait: 'Each row opens' }, { sleep: 200 }, { snapshot: 'picker' },
    { key: 'down' }, { sleep: 100 }, { key: 'enter' }, { wait: 'Runs without asking ·' }, { sleep: 200 }, { snapshot: 'allow' },
    { type: '/permissions test npm publish --tag beta' }, { key: 'enter' }, { wait: 'Nothing was run.' }, { sleep: 200 }, { snapshot: 'test' },
    { type: '/permissions mode' }, { key: 'enter' }, { wait: 'saved for this folder' }, { sleep: 200 }, { snapshot: 'modes' }, { type: '3' },
    { wait: 'Start-up mode: plan' }, { sleep: 300 }, { snapshot: 'plan' },
    ...quit,
  ] });
  await fake.close();
  const p = r.snapshots.picker;
  expect(p).toMatch(/❯ Start-up mode\s+ask first · not saved\s/);
  expect(p).toMatch(/Runs without asking\s+1 saved\s/);
  expect(p).toMatch(/Never runs\s+12 fixed · 1 yours\s/);
  expect(p).toMatch(/Protected files\s+11 built in · 0 yours\s/);
  expect(p).toMatch(/Trusted folders\s+1 trusted\s/);
  expect(r.snapshots.allow).toMatch(/1\s+node --test\s+this folder/);
  expect(r.snapshots.test).toContain('REFUSED blocked by your rule "npm publish" (/permissions)');
  expect(r.snapshots.modes).toMatch(/4\. Not saved.*✔ in use/);
  expect(r.snapshots.plan).toContain('⏸ plan mode on');
  const saved = JSON.parse(readFileSync(join(base, 'home', 'permissions.json'), 'utf8'));
  expect(saved.folders[realpathSync(cwd)].mode).toBe('plan');
}, T);

test('coding -p: your never-list holds under --yes, and a command you allowed runs without --yes', async () => {
  const { cwd, env, base } = setup();
  saveRules(base, { everywhere: { never: ['npm publish'] }, folders: { [realpathSync(cwd)]: { allow: ['node --test'] } } });
  const fake = await startFakeServer([bash('npm publish --access public'), { text: 'Publishing was refused.' }]);
  const r = await runInPty({ cwd, env, args: ['-p', 'publish it', '--yes', '--url', fake.url, '--no-flows'], steps: [{ wait: 'Publishing was refused.' }, { sleep: 300 }] });
  await fake.close();
  expect(JSON.stringify(fake.requests)).toContain('blocked by your rule \\"npm publish\\" (/permissions)');
  expect(r.code).toBe(0);
  const fake2 = await startFakeServer([bash('node --test'), { text: 'Ran the tests.' }]);
  const r2 = await runInPty({ cwd, env, args: ['-p', 'run the tests', '--url', fake2.url, '--no-flows'], steps: [{ wait: 'Ran the tests.' }, { sleep: 300 }] });
  await fake2.close();
  const sent = JSON.stringify(fake2.requests);
  expect(sent).not.toContain('The user said no');
  expect(sent).toMatch(/pass \d/); // the test output reached the model
  expect(r2.code).toBe(0);
}, T * 2);
