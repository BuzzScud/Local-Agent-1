// /permissions: the saved rules (perm-store.mjs) and the command's words (perms.mjs), on a throwaway home.
import { test, expect, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'agentic-perms-'));
const before = process.env.AGENTIC_HOME;
process.env.AGENTIC_HOME = join(base, 'home');
const { saveTrust, trustedFolders } = await import('../src/app/trust.mjs');
const store = await import('../src/app/perm-store.mjs');
const perms = await import('../src/app/perms.mjs');
const { loadSettings } = await import('../src/app/store.mjs');
afterAll(() => { if (before === undefined) delete process.env.AGENTIC_HOME; else process.env.AGENTIC_HOME = before; rmSync(base, { recursive: true, force: true }); });

const home = join(base, 'home');
const proj = join(base, 'proj');
const other = join(base, 'other');
const sub = join(proj, 'sub');
const stranger = join(base, 'stranger'); // never trusted
for (const d of [proj, other, sub, stranger]) mkdirSync(d, { recursive: true });
beforeEach(() => {
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  saveTrust(proj); saveTrust(other);
});
const say = (cwd, arg, ctx = { mode: 'ask' }) => perms.changePermissions(cwd, arg, ctx);

test('a rule is saved for this folder, listed, refused when it cannot be one, and removed by number', () => {
  const r = say(proj, 'allow npm test');
  expect(r.text).toBe('Saved for this folder: "npm test" runs without asking, with any options.');
  expect(r.changed).toBe(true);
  expect(store.entries(proj, 'allow')).toEqual([{ text: 'npm test', where: 'folder', key: expect.any(String), at: 0, here: true }]);
  expect(say(proj, 'allow npm test').text).toBe('Already saved for this folder: "npm test".');
  expect(say(proj, 'allow').panel.title).toBe('Runs without asking · 1 saved · 0 this session'); // alone, it lists
  for (const [cmd, why] of [['allow git push', /never allowed/], ['allow git commit -m x', /commit always asks/], ['allow ls', /only reads/], ['allow npm test && rm x', /one command/], ['never git push', /already never allowed/], ['protect /etc/x', /named from the project folder/], ['protect *', /every file/]])
    expect([cmd, say(proj, cmd).text]).toEqual([cmd, expect.stringMatching(why)]);
  expect(say(proj, 'allow make').text).toContain('"make *" would cover anything after it.');
  expect(say(proj, 'never npm publish').text).toBe('Saved for this folder: "npm publish" never runs, in any mode.');
  expect(say(proj, 'protect config/prod.*').text).toContain('always asks before a change, even in Auto-edit');
  expect(store.rulesFor(proj)).toEqual({ allow: ['npm test', 'make'], never: ['npm publish'], protect: ['config/prod.*'], broken: null });
  expect(say(proj, 'remove allow 1').text).toBe('Removed "npm test" (this folder).');
  expect(say(proj, 'remove allow 9').text).toBe('There is no allow rule 9: /permissions allow shows them.');
  expect(say(proj, 'remove 1').text).toMatch(/Say which list and which number/);
  expect(store.rulesFor(proj).allow).toEqual(['make']);
});

test('rules follow the folder: inside it yes, beside it no, an untrusted folder none; "everywhere" moves one to all folders', () => {
  say(proj, 'allow npm test'); say(proj, 'never npm publish');
  expect(store.rulesFor(sub).allow).toEqual(['npm test']);          // inside the folder
  expect(store.rulesFor(other).allow).toEqual([]);                  // another project
  expect(store.rulesFor(stranger).allow).toEqual([]);               // not trusted
  expect(store.entries(sub, 'allow')[0].here).toBe(false);          // the folder above, said so in the list
  expect(say(proj, 'everywhere allow 1').text).toBe('"npm test" now applies to every folder, not only this one.');
  expect(store.rulesFor(other).allow).toEqual(['npm test']);
  expect(store.rulesFor(stranger).allow).toEqual(['npm test']);     // everywhere means everywhere
  expect(say(proj, 'everywhere allow 1').text).toBe('"npm test" already applies to every folder.');
  expect(say(other, 'allow npm test').text).toBe('Already saved for every folder: "npm test".');
  const file = JSON.parse(readFileSync(join(home, 'permissions.json'), 'utf8'));
  expect(file.everywhere).toEqual({ allow: ['npm test'] });
  expect(Object.values(file.folders)).toEqual([{ never: ['npm publish'] }]);
  expect(Object.keys(file.folders)[0]).toContain('proj');           // by the folder's real path
});

test('the file is written whole (no leftovers), tidied when a list empties, and a file it cannot read is never written over', () => {
  say(proj, 'allow npm test');
  expect(readdirSync(home).sort()).toEqual(['permissions.json', 'trust.json']);
  say(proj, 'remove allow 1');
  expect(JSON.parse(readFileSync(join(home, 'permissions.json'), 'utf8'))).toEqual({});
  // a hand-edit with a typo: nothing applies, nothing is overwritten, and it says so
  writeFileSync(join(home, 'permissions.json'), '{ "everywhere": { "allow": ["npm test"], } ');
  const broken = store.rulesFor(proj);
  expect(broken.allow).toEqual([]);
  expect(broken.broken).toBeTruthy();
  const r = say(proj, 'allow make');
  expect(r.tone).toBe('warn');
  expect(r.text).toMatch(/permissions\.json cannot be read .*Fix or delete it/);
  expect(readFileSync(join(home, 'permissions.json'), 'utf8')).toBe('{ "everywhere": { "allow": ["npm test"], } ');
  expect(perms.section('allow', proj).rows[0][0]).toMatch(/cannot be read/);
  // an empty file is fine; junk inside a list is dropped; a list holds 40 at most
  writeFileSync(join(home, 'permissions.json'), '');
  expect(store.readState().broken).toBe(null);
  writeFileSync(join(home, 'permissions.json'), JSON.stringify({ everywhere: { allow: ['npm test', 5, '', ' npm test ', null, 'make'] , mode: 'sideways' } }));
  expect(store.rulesFor(proj).allow).toEqual(['npm test', 'make']);
  expect(store.startModeFor(proj)).toBe(null);
  rmSync(join(home, 'permissions.json'));
  for (let i = 0; i < 40; i++) expect(store.addRule(proj, 'never', `tool${i} run`).ok).toBe(true);
  expect(store.addRule(proj, 'never', 'one more').error).toMatch(/list is full \(40 rules\)/);
});

test('rules for a folder never reach a folder whose name only starts the same (proj and proj-old)', () => {
  const old = join(base, 'proj-old');
  mkdirSync(old, { recursive: true });
  saveTrust(old);
  say(proj, 'allow npm test');
  expect(store.rulesFor(old).allow).toEqual([]);
  expect(store.rulesFor(proj).allow).toEqual(['npm test']);
});

test('the start-up mode is saved for a folder or everywhere, the folder wins, reset takes it away, and loadSettings reads it', () => {
  const r = say(proj, 'mode edits', { mode: 'ask' });
  expect(r).toEqual({ text: 'Start-up mode: auto-edit for this folder, and on now. Auto-edit still asks before commands, and protected files still ask.', mode: 'edits', changed: true });
  expect(store.startModeFor(proj)).toMatchObject({ mode: 'edits', where: 'folder', here: true });
  expect(loadSettings(proj).mode).toBe('edits');
  expect(loadSettings(other).mode).toBeUndefined();
  say(other, 'mode plan everywhere');
  expect(loadSettings(other).mode).toBe('plan');
  expect(loadSettings(proj).mode).toBe('edits');                    // its own folder's wins
  expect(loadSettings(stranger).mode).toBe('plan');                 // everywhere reaches it
  expect(say(proj, 'mode reset').text).toMatch(/is gone: it starts in ask first/);
  expect(loadSettings(proj).mode).toBe('plan');                     // back to the everywhere one
  expect(say(proj, 'mode sideways').tone).toBe('warn');
  expect(say(proj, 'mode')).toEqual({ open: 'mode' });
  expect(say(proj, '')).toEqual({ open: 'panel' });
  expect(say(proj, 'bogus').text).toMatch(/Unknown: \/permissions bogus/);
});

test('the panels number the lists, say where each rule applies, and the picker rows carry live values', () => {
  say(proj, 'allow npm test'); say(proj, 'allow bun run test'); say(proj, 'never npm publish'); say(proj, 'protect config/prod.*'); say(proj, 'everywhere allow 2');
  const allow = perms.section('allow', proj, { session: new Set(['node --test']) });
  expect(allow.title).toBe('Runs without asking · 2 saved · 1 this session');
  expect(allow.rows.slice(0, 2)).toEqual([['1', 'bun run test  every folder'], ['2', 'npm test      this folder']]);
  expect(allow.rows.find((r) => r[0] === 'now')[1]).toContain('node --test');
  const never = perms.section('never', proj);
  expect(never.title).toMatch(/^Never runs · 12 fixed · 1 yours$/);
  expect(never.rows.map((r) => r[1]).filter(Boolean)).toContain('git push sends your code off this Mac');
  expect(never.rows.map((r) => r[1])).toContain('a git commit always asks first');
  expect(perms.section('protect', proj).rows.map((r) => r[0]).find((t) => t.startsWith('Built in:'))).toContain('.env  .env.*');
  const folders = perms.section('folders', proj);
  expect(folders.title).toBe('Trusted folders · 2');
  expect(folders.rows.some((r) => r[1]?.includes('← you are in it'))).toBe(true);
  expect(perms.summary(proj, { session: new Set(['a b']) })).toEqual({ mode: 'ask first · not saved', allow: '2 saved · 1 this session', never: '12 fixed · 1 yours', protect: '11 built in · 1 yours', folders: '2 trusted' });
  expect(perms.settingsValue(proj)).toBe('4 saved · ask first');
  expect(perms.settingsValue(other)).toBe('1 saved · ask first');
});

test('a trusted folder can be forgotten by number; its rules stop applying until it is trusted again', () => {
  say(proj, 'allow npm test');
  const list = trustedFolders();
  const n = list.findIndex((f) => f.path.endsWith('proj')) + 1;
  const r = say(proj, `forget ${n}`);
  expect(r.text).toMatch(/Forgot .*proj: the safety check asks again the next time Agentic Coder starts there\. This window keeps working until you leave it\./);
  expect(store.rulesFor(proj).allow).toEqual([]);
  saveTrust(proj);
  expect(store.rulesFor(proj).allow).toEqual(['npm test']);          // trusted again: they are back
  expect(say(proj, 'forget 9').tone).toBe('warn');
  expect(say(proj, 'forget x').tone).toBe('warn');
});

test('/permissions test runs the real check and says why, part by part, and runs nothing', () => {
  say(proj, 'allow npm test'); say(proj, 'never npm publish'); say(proj, 'protect config/prod.*');
  const run = (arg, mode = 'ask', session = new Set()) => say(proj, `test ${arg}`, { mode, session }).panel;
  let p = run('npm test && ./scripts/deploy.sh');
  expect(p.title).toBe('Try a command');
  expect(p.rows).toEqual([['', 'npm test && ./scripts/deploy.sh'], ['ASKS', '"./scripts/deploy.sh" is not covered by any rule'], ['part 1', 'npm test   runs · your saved rule "npm test"'], ['part 2', './scripts/deploy.sh   asks · no rule covers it'], ['in ask first mode, this folder\'s rules and this session\'s. Nothing was run.']]);
  expect(run('npm test -- foo').rows.slice(0, 2)).toEqual([['', 'npm test -- foo'], ['RUNS', 'every part is covered: "npm test" (saved)']]);
  expect(run('git commit -m x').rows[1]).toEqual(['ASKS', 'a commit always asks']);
  expect(run('git push').rows[1]).toEqual(['REFUSED', 'blocked: git push sends your code off this Mac']);
  expect(run('npm publish --tag x').rows[1]).toEqual(['REFUSED', 'blocked by your rule "npm publish" (/permissions)']);
  expect(run('ls').rows[1]).toEqual(['RUNS', 'it only reads']);
  expect(run('ls\nrm notes.txt').rows[1][0]).toBe('ASKS');
  expect(run('bun run test', 'ask', new Set(['bun run test'])).rows[1]).toEqual(['RUNS', 'every part is covered: "bun run test" (this session)']);
  expect(run('npm test', 'plan').rows[1]).toEqual(['REFUSED', 'plan mode is on, so only read-only commands may run']);
  expect(run('edit .env', 'edits').rows.slice(0, 2)).toEqual([['', 'edit .env'], ['ASKS', 'it is a protected file (.env); protected files always ask']]);
  expect(run('edit config/prod.json', 'edits').rows[1][0]).toBe('ASKS');
  expect(run('edit src/app.js', 'edits').rows[1]).toEqual(['RUNS', 'Auto-edit is on']);
  expect(run('edit src/app.js', 'ask').rows[1]).toEqual(['ASKS', 'Ask first is on']);
  expect(run('edit ../secrets.txt', 'edits').rows[1]).toEqual(['REFUSED', 'that file is outside the project folder']);
  expect(say(proj, 'test').tone).toBe('warn');
});
