// /agents' stop list (agents-guards.mjs): which steps ask first, which are turned away, which run.
import { test, expect } from 'bun:test';
import { guardStep, changedLines, checkNumbersChanged, newPackages } from '../src/agent/agents-guards.mjs';

const bash = (command, ctx) => guardStep({ name: 'Bash', args: { command } }, ctx);
const edit = (path, before, old_text, new_text, ctx) => guardStep({ name: 'Edit', args: { path, old_text, new_text }, before }, ctx);
const write = (path, before, content, ctx) => guardStep({ name: 'Write', args: { path, content }, before }, ctx);

test('the poster\'s list: secrets, auth, payments, deploys and migrations ask first', () => {
  expect(guardStep({ name: 'Read', args: { path: '.env' } })).toMatchObject({ key: 'secret', title: 'Secrets' });
  expect(guardStep({ name: 'Read', args: { path: 'config/id_ed25519' } })).toMatchObject({ key: 'secret' });
  expect(bash('cat .env.local | head')).toMatchObject({ key: 'secret' });
  expect(edit('src/auth/login.ts', 'a', 'a', 'b')).toMatchObject({ key: 'auth', title: 'Auth' });
  expect(edit('app/billing.py', 'a', 'a', 'b')).toMatchObject({ key: 'payments' });
  expect(write('.github/workflows/ci.yml', '', 'on: push')).toMatchObject({ key: 'deploys' });
  expect(write('db/migrations/001_users.sql', '', 'create table')).toMatchObject({ key: 'migrations' });
  expect(bash('npx prisma migrate deploy')).toMatchObject({ key: 'migrations' });
  expect(bash('fly deploy --remote-only')).toMatchObject({ key: 'deploys' });
  // names that only look alike run as usual
  expect(edit('src/tokenizer.py', 'a', 'a', 'b')).toBeNull();
  expect(guardStep({ name: 'Read', args: { path: 'src/keys.py' } })).toBeNull();
});

test('auth and payments are told from names that only look alike: the app\'s own sessions, an event subscription, a git checkout (3 Oct 2026)', () => {
  const key = (p) => edit(p, 'a', 'a', 'b')?.key ?? null;
  // signing in, and a signed-in user's session: asks
  for (const p of ['src/auth/session.ts', 'lib/oauth_client.py', 'app/login.jsx', 'server/jwt.mjs', 'users/password_reset.py', 'web/signin.tsx', 'api/sso/callback.js', 'src/auth_utils.py', 'src/user_session.js', 'lib/session_store.py', 'web/session-cookie.ts'])
    expect([p, key(p)]).toEqual([p, 'auth']);
  // money: asks
  for (const p of ['app/billing.py', 'src/payments/charge.ts', 'lib/stripe_client.js', 'shop/checkout.py', 'api/invoice.mjs', 'billing/subscription.py', 'src/paypal/webhook.js', 'app/subscription_billing.py'])
    expect([p, key(p)]).toEqual([p, 'payments']);
  // only the name looks alike: runs as usual (each of these asked before)
  for (const p of ['terminal/src/app/sessions.mjs', 'src/session-host.js', 'terminal/test/sessions.test.mjs', 'lib/events/subscriptions.mjs', 'src/pubsub/subscription.ts', 'src/git/checkout.mjs', 'tools/git-checkout.sh', 'src/git_checkout.py', 'src/repayment.js'])
    expect([p, key(p)]).toEqual([p, null]);
  // and never did
  for (const p of ['src/author.py', 'docs/authoring.md', 'src/logins_chart_notes/readme.md'.replace('logins_chart_notes', 'charts')]) expect([p, key(p)]).toEqual([p, null]);
});

test('new packages: install commands and new names in package.json or requirements ask first; a plain install does not', () => {
  expect(bash('npm install left-pad')).toMatchObject({ key: 'pkg', title: 'New package' });
  expect(bash('pip install numpy')).toMatchObject({ key: 'pkg' });
  expect(bash('bun add zod')).toMatchObject({ key: 'pkg' });
  expect(bash('npm install')).toBeNull();
  expect(bash('pip install -r requirements.txt')).toBeNull();
  expect(write('package.json', '{"dependencies":{"a":"1"}}', '{"dependencies":{"a":"1","b":"2"}}')).toMatchObject({ key: 'pkg', detail: 'It wants to add b to package.json.' });
  expect(newPackages('requirements.txt', 'numpy==2\n', 'numpy==2\nscipy>=1.11\n')).toEqual(['scipy']);
  expect(write('package.json', '{"dependencies":{"a":"1"}}', '{"dependencies":{"a":"2"}}')).toBeNull(); // a version change is not a new package
});

test('deletions: rm and git rm, or a file written empty, ask first', () => {
  expect(bash('rm old_solver.py')).toMatchObject({ key: 'list', title: 'Deletion' });
  expect(bash('git rm -q old.py')).toMatchObject({ key: 'list' });
  expect(write('notes.md', 'some text', '')).toMatchObject({ key: 'list', detail: 'It wants to empty notes.md.' });
  expect(bash('ls -la && grep -rn form .')).toBeNull();
});

test('math guards: a test\'s checking number changed asks first; a new test, or a change elsewhere in it, does not', () => {
  const before = 'def test_solve():\n    assert abs(f(E)) <= 1e-12\n';
  expect(edit('tests/test_kepler.py', before, '1e-12', '1e-6', { math: true })).toMatchObject({ key: 'tol', title: 'Math guard', detail: 'tests/test_kepler.py changes what it checks: 1e-12 → 1e-6.' });
  expect(edit('test/backoff.test.mjs', 'expect(wait).toBe(30000);\n', '30000', '32000', { math: false })).toMatchObject({ key: 'tol', title: 'Test guard' });
  expect(edit('tests/test_kepler.py', before, 'def test_solve', 'def test_solves_e09', {})).toBeNull();
  expect(write('tests/test_new.py', '', 'def test_x():\n    assert f(2) == 4\n')).toBeNull();
  expect(checkNumbersChanged('assert x == 5', 'assert x == 5\nassert y == 6')).toBeNull(); // only added
});

test('a big diff while it builds: over 100 lines or 3 files in one task asks first; allowed once, it goes on', () => {
  const task = { lines: 0, filesTouched: [] };
  const ctx = { stage: 2, task, limits: { lines: 100, files: 3 } };
  expect(write('a.py', '', 'x\n'.repeat(60), ctx)).toBeNull();
  expect(task.lines).toBe(61);
  expect(write('b.py', '', 'y\n'.repeat(50), ctx)).toMatchObject({ key: 'big', title: 'Big diff', detail: 'This task would be at 112 lines in 2 files (the limit: 100 lines, 3 files).' });
  task.allowed = ['big'];
  expect(write('b.py', '', 'y\n'.repeat(50), ctx)).toBeNull();
  const t2 = { lines: 0, filesTouched: ['a', 'b', 'c'] };
  expect(write('d.py', '', 'z', { stage: 2, task: t2 })).toMatchObject({ key: 'big', detail: 'This task would be at 1 lines in 4 files (the limit: 100 lines, 3 files).' });
  expect(changedLines('a\nb\nc', 'a\nB\nc\nd')).toBe(3);
});

test('turned away without asking: an edit in Verify, Review or Ship, and the test a task is making pass', () => {
  expect(edit('src/a.py', 'x', 'x', 'y', { stage: 3 })).toMatchObject({ title: 'This stage only reads', deny: expect.stringContaining('Verify only reads and runs') });
  expect(write('src/a.py', '', 'y', { stage: 5 }).deny).toContain('Ship only reads');
  expect(edit('tests/test_k.py', 'x', 'x', 'y', { stage: 2, cover: 'tests/test_k.py', node: 1 })).toMatchObject({ title: 'The test stays' });
  expect(edit('tests/test_k.py', 'x', 'x', 'y', { stage: 2, cover: 'tests/test_k.py', node: 0, task: { lines: 0 } })).toBeNull(); // RED writes it
});
