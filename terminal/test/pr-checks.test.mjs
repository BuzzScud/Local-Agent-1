// coding pr (terminal/src/app/pr-checks.mjs) on a stand-in Gitea: the evening of 19 Nov 2026 played again, when a pull
// request sat Not ready for hours while its card said "phone failure" and phone had passed on every run.
import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { remoteOf, partOf, failLines, partsOn, makeApi, readPr, verdicts, prText, guard, watch, MIN_EVERY } from '../src/app/pr-checks.mjs';

const PARTS = ['tests1', 'tests2', 'tests3', 'tests4', 'tests', 'web', 'phone', 'practice'];
const GAP = 108; // a run's id is its number + 108, as on the forge that evening

// A log as the forge gives it: a timestamp before each line, ::error:: with %0A for new lines.
const logOf = (name, error) => [
  '2026-11-20T03:15:58.6109809Z bun test v1.2.23',
  `2026-11-20T03:15:58.6109809Z ::error::src/shared/test/${error}%0A%0A      at <anonymous> (/workspace/x.test.mjs:76:31)`,
  `2026-11-20T03:15:58.6110491Z (fail) ${name} [3.00ms]`,
  `2026-11-20T03:17:01.3260962Z (fail) ${name} [3.00ms]`,
  '2026-11-20T03:17:01.3260962Z  612 pass',
].join('\n');

const SIZE = 'the first download stays small: the chat\'s code and the shell, not the whole app';
const WORDS = 'the Tools hub ships to customers without staff words';
const RANDOM = 'a run keeps who marked each answer and the run it continues';

// commits oldest first; each: its run number and the parts that failed, with the test and the error
const COMMITS = [
  { sha: 'a'.repeat(40), run: 2347, fail: { tests4: [SIZE, 'customer-split.test.mjs:91:19: error: expect(received).toBeLessThan(expected): Expected: < 200%0AReceived: 200.11'] } },
  { sha: 'b'.repeat(40), run: 2348, fail: { tests3: [RANDOM, 'compareintraining.test.mjs:76:31: error: expect(received).toBe(expected)'], tests4: [SIZE, 'customer-split.test.mjs:91:19: Received: 200.11'] } },
  { sha: 'c'.repeat(40), run: 2349, fail: { tests4: [WORDS, 'toolshub.test.mjs:179:19: error: expect(received).not.toMatch(expected)'] } },
  { sha: 'd'.repeat(40), run: 2351, fail: {} },
];

const forge = ({ commits = COMMITS, head = commits.at(-1).sha, pending = {}, open = [] } = {}) => {
  const seen = [];
  const state = { commits, head, pending, open, closed: false };
  const statusesOf = (c) => {
    const out = [];
    let id = c.run * 100;
    for (const [i, part] of PARTS.entries()) {
      out.push({ id: id++, context: `change / ${part} (pull_request)`, status: 'pending', target_url: `/o/r/actions/runs/${c.run}/jobs/${i}`, created_at: '2026-11-20T03:00:00Z' });
      if (state.pending[c.sha]?.includes(part)) continue;
      const failed = c.fail[part] || (part === 'tests' && Object.keys(c.fail).length);
      out.push({ id: id++, context: `change / ${part} (pull_request)`, status: failed ? 'failure' : part === 'practice' ? 'skipped' : 'success', target_url: `/o/r/actions/runs/${c.run}/jobs/${i}`, created_at: '2026-11-20T03:10:00Z' });
    }
    return out.reverse();
  };
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(req) {
      const u = new URL(req.url);
      seen.push(u.pathname + u.search);
      if (req.headers.get('authorization') !== 'token k') return new Response('no', { status: 401 });
      const p = u.pathname.replace('/api/v1/repos/o/r/', '');
      const json = (v) => Response.json(v);
      if (p === 'pulls/7') return json({ number: 7, title: 'one menu in the box', state: state.closed ? 'closed' : 'open', merged: false, head: { ref: 'box-one-menu', sha: state.head }, labels: [{ name: 'factory-ready' }], mergeable: true });
      if (p === 'pulls/7/commits') return json(state.closed ? [] : [...state.commits].reverse().map((c) => ({ sha: c.sha, commit: { message: `commit ${c.sha.slice(0, 1)}\n\nbody` } })));
      if (p === 'pulls') return json(state.open);
      let m = p.match(/^commits\/(\w+)\/statuses$/);
      if (m) { const c = state.commits.find((x) => x.sha === m[1]); return json(c ? statusesOf(c) : []); }
      m = p.match(/^actions\/runs\/(\d+)$/);
      if (m) return json({ id: Number(m[1]), run_number: Number(m[1]) - GAP });
      m = p.match(/^actions\/runs\/(\d+)\/jobs$/);
      if (m) { const run = Number(m[1]) - GAP; return json({ jobs: PARTS.map((name, i) => ({ id: run * 10 + i, name })) }); }
      m = p.match(/^actions\/jobs\/(\d+)\/logs$/);
      if (m) {
        const run = Math.floor(Number(m[1]) / 10);
        const part = PARTS[Number(m[1]) % 10];
        const c = state.commits.find((x) => x.run === run);
        const f = c?.fail[part];
        return new Response(f ? logOf(f[0], f[1]) : part === 'tests' ? 'tests4 failed, so this fails' : 'all fine');
      }
      return new Response('not here', { status: 404 });
    },
  });
  const api = makeApi({ base: `http://127.0.0.1:${server.port}`, owner: 'o', repo: 'r', token: 'k' });
  return { api, server, seen, state };
};
const servers = [];
afterAll(() => { for (const s of servers) s.stop(true); });
const text0 = (read) => prText(read);
const stand = (o) => { const f = forge(o); servers.push(f.server); return f; };

test('the forge is read from the folder\'s own remote; a check\'s part from its status', () => {
  expect(remoteOf('https://git.example.org/team/app.git')).toEqual({ base: 'https://git.example.org', owner: 'team', repo: 'app' });
  expect(remoteOf('https://me@git.example.org/team/app')).toEqual({ base: 'https://git.example.org', owner: 'team', repo: 'app' });
  expect(remoteOf('git@git.example.org:team/app.git')).toEqual({ base: 'https://git.example.org', owner: 'team', repo: 'app' });
  expect(remoteOf('/a/local/folder')).toBe(null);
  expect(partOf('change / tests1 (pull_request)')).toBe('tests1');
  expect(partOf('ci / build')).toBe('build');
});

test('a log\'s failed tests by name, and its errors with the new lines read', () => {
  const f = failLines(logOf(SIZE, 'customer-split.test.mjs:91:19: Expected: < 200%0AReceived: 200.11'));
  expect(f.names).toEqual([SIZE]);
  expect(f.errors[0]).toBe('src/shared/test/customer-split.test.mjs:91:19: Expected: < 200 · Received: 200.11');
  expect(failLines('FAILED tests/test_x.py::test_it - assert 1 == 2').names).toEqual(['tests/test_x.py::test_it - assert 1 == 2']);
});

test('each part\'s newest state on a commit, whatever order the statuses come in', () => {
  const p = partsOn([{ id: 1, context: 'c / web (pull_request)', status: 'pending' }, { id: 2, context: 'c / web (pull_request)', status: 'success' }]);
  expect(p.get('web').state).toBe('success');
});

test('the evening played again: phone passed every run, the real failures were tests4\'s, tests3\'s was once', async () => {
  const { api } = stand({ head: COMMITS[2].sha, commits: COMMITS.slice(0, 3) });
  const read = await readPr(api, 7);
  expect(read.runs.map((r) => r.sha[0])).toEqual(['c', 'b', 'a']);
  const v = Object.fromEntries(verdicts(read).map((p) => [p.part, p]));
  expect(v.phone).toMatchObject({ now: 'success', passed: 3, finished: 3, tests: [] });
  expect(v.tests4.now).toBe('failure');
  expect(v.tests4.tests.find((t) => t.name === WORDS)).toMatchObject({ verdict: 'real', onNewest: true, runs: 1 });
  expect(v.tests4.tests.find((t) => t.name === SIZE)).toMatchObject({ verdict: 'fixed', runs: 2 });
  expect(text0(read)).toContain(`fixed  ${SIZE} (failed 2 runs, not since)`);
  expect(v.tests3.tests[0]).toMatchObject({ name: RANDOM, verdict: 'once', runs: 1 });
  const text = prText(read);
  expect(text.indexOf('tests1 ')).toBeLessThan(text.indexOf('phone '));
  expect(text).toContain('✓ phone      success · passed 3 of 3 finished runs');
  expect(text).toContain(`REAL   ${WORDS} (failed 1 run, on the newest)`);
  expect(text).toContain(`once   ${RANDOM} (failed 1 run, not since: random, or fixed)`);
  expect(text).toContain('› src/shared/test/toolshub.test.mjs:179:19');
  expect(text).toContain('To fix: tests4.');
  expect(text).toContain('A part that passed on every run is not what blocks it');
});

test('green on the newest commit says so; the newest with no checks yet is said too', async () => {
  const { api, state } = stand();
  expect(prText(await readPr(api, 7))).toContain('Every part passed on the newest commit.');
  state.commits = [...COMMITS, { sha: 'e'.repeat(40), run: 2352, fail: {} }];
  state.head = 'e'.repeat(40);
  state.pending['e'.repeat(40)] = PARTS;
  const t = prText(await readPr(api, 7));
  expect(t).toContain('Nothing has failed on the newest commit; some parts are still running');
});

test('a closed pull request lists no commits: its last one is read', async () => {
  const { api, state } = stand();
  state.closed = true;
  const read = await readPr(api, 7);
  expect(read.runs.map((r) => r.sha[0])).toEqual(['d']);
  expect(prText(read)).toContain('closed · box-one-menu');
});

test('the forge\'s lists are asked for a page at a time, never whole', async () => {
  const { api, seen } = stand();
  await readPr(api, 7);
  for (const s of seen.filter((x) => /\/(commits|statuses|jobs)(\?|$)/.test(x) && !x.includes('/logs'))) expect(s).toContain('page=1');
});

const sh = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); return r.stdout.trim(); };
const repos = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-guard-'));
  const origin = join(dir, 'origin.git');
  sh(dir, 'init', '-q', '--bare', origin);
  const a = join(dir, 'a');
  sh(dir, 'clone', '-q', origin, a);
  for (const r of [a]) { sh(r, 'config', 'user.email', 't@example.org'); sh(r, 'config', 'user.name', 't'); }
  writeFileSync(join(a, 'f.txt'), 'one\n');
  sh(a, 'add', 'f.txt'); sh(a, 'commit', '-q', '-m', 'one'); sh(a, 'push', '-q', 'origin', 'HEAD:box-one-menu');
  const b = join(dir, 'b');
  sh(dir, 'clone', '-q', '-b', 'box-one-menu', origin, b);
  sh(b, 'config', 'user.email', 't@example.org'); sh(b, 'config', 'user.name', 't');
  return { a, b };
};
const commit = (r, text) => { writeFileSync(join(r, 'f.txt'), text); sh(r, 'commit', '-q', '-am', text); };

test('guard: nothing to push, then OK, then held by an open release train, then refused when the branch moved', async () => {
  const { a, b } = repos();
  const { api, state } = stand();
  expect((await guard({ cwd: b, api, n: 7 })).why).toContain('Nothing to push');
  commit(b, 'fix\n');
  const ok = await guard({ cwd: b, api, n: 7, hold: ['ship/'] });
  expect(ok).toMatchObject({ ok: true, branch: 'box-one-menu' });
  expect(ok.why).toBe('OK to push to box-one-menu: git push origin HEAD:box-one-menu');
  state.open = [{ number: 9, head: { ref: 'ship/2026-11-20' } }];
  const held = await guard({ cwd: b, api, n: 7, hold: ['ship/'] });
  expect(held.ok).toBe(false);
  expect(held.why).toContain('Hold the push: #9 (ship/2026-11-20) is open');
  state.open = [];
  commit(a, 'run the checks again\n');
  sh(a, 'push', '-q', 'origin', 'HEAD:box-one-menu');
  const moved = await guard({ cwd: b, api, n: 7 });
  expect(moved.ok).toBe(false);
  expect(moved.why).toContain('has commits this copy lacks');
  expect(moved.why).toContain('Never force');
});

test('watch: never looks more often than a minute, says each part as it ends, and ends ready', async () => {
  const { api, state } = stand();
  const head = COMMITS.at(-1).sha;
  state.pending[head] = ['tests', 'phone'];
  const gaps = [];
  const said = [];
  const w = await watch({ api, n: 7, need: ['tests', 'web', 'phone'], every: 5, say: (t) => said.push(t), sleep: async (s) => { gaps.push(s); state.pending[head] = gaps.length === 1 ? ['phone'] : []; } });
  expect(gaps).toEqual([MIN_EVERY, MIN_EVERY]);
  expect(w).toEqual({ code: 0, why: `Ready: tests, web, phone passed on ${head.slice(0, 8)}.` });
  expect(said).toContain('✓ phone success');
  expect(said.filter((s) => s.includes('web')).length).toBe(1);
});

test('watch: a needed part that fails ends it with why; a commit that moves ends it too', async () => {
  const { api, state } = stand({ commits: COMMITS.slice(0, 3), head: COMMITS[2].sha });
  const bad = await watch({ api, n: 7, need: ['tests4'], sleep: async () => {} });
  expect(bad.code).toBe(1);
  expect(bad.why).toContain(`tests4 failed: ${WORDS}`);
  expect(bad.why).toContain('toolshub.test.mjs:179:19');
  state.pending[COMMITS[2].sha] = PARTS;
  const moved = await watch({ api, n: 7, sleep: async () => { state.head = COMMITS[1].sha; } });
  expect(moved.code).toBe(2);
});

test('watch: out of time says what is still running', async () => {
  const { api, state } = stand();
  state.pending[COMMITS.at(-1).sha] = ['phone'];
  let t = 0;
  const w = await watch({ api, n: 7, need: ['phone'], minutes: 2, now: () => t, sleep: async (s) => { t += s * 1000; } });
  expect(w).toEqual({ code: 3, why: 'Still running after 2 min: phone.' });
});
