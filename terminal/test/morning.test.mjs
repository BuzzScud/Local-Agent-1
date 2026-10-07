// The morning brief (/morning, coding morning): reading repos, picking what
// earns a line, checking the model's words against the facts, the page with
// its calendar, the saved history — and /morning end to end in the app.
import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gather, dayWindow } from '../src/morning/gather.mjs';
import { pick } from '../src/morning/sort.mjs';
import { checkWords, digest, plainWords, schemaFor, writeWords } from '../src/morning/words.mjs';
import { buildDay, pageHtml, writeBrief } from '../src/morning/render.mjs';
import { matchCommands, COMMANDS } from '../src/app/commands.mjs';
import { helpData } from '../src/app/help.mjs';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'agentic-morning-'));
const baseConfig = (dir, over = {}) => ({ name: 'Christian', scan: [dir], maxDepth: 3, exclude: [], emails: ['me@example.com'], ciOwners: [], deploy: {}, testRecords: {}, ignoreUntracked: ['.venv'], ignoreDirty: [], out: join(dir, 'out', 'morning-brief.html'), history: join(dir, 'history'), ...over });

// A git repo with commits at the given local times
function makeRepo(dir, dates, email = 'me@example.com') {
  mkdirSync(dir, { recursive: true });
  const g = (args, env = {}) => execFileSync('git', ['-C', dir, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', ...env }, stdio: 'pipe' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', email]);
  g(['config', 'user.name', 'Me']);
  g(['config', 'commit.gpgsign', 'false']);
  dates.forEach((date, i) => {
    writeFileSync(join(dir, `f${i}.txt`), `line ${i}\n`);
    g(['add', '.']);
    g(['commit', '-q', '-m', `feat(app): Change number ${i}`], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  });
  return g;
}

// Facts as gather() returns them, for the day Sat 26 Sep 2026 in New York
const project = (over = {}) => ({
  name: 'app', path: '~/x/app', remote: { owner: 'me', repo: 'app', web: 'https://github.com/me/app' }, fetched: true,
  defaultBranch: 'main', branch: 'main', ahead: 0, behind: 0, lastCommit: null, stashes: 0,
  dirty: { count: 0, tracked: 0, untracked: 0, files: [], newest: null }, worktrees: [],
  commits: [
    { hash: 'a1', time: '2026-09-26T14:10:00.000Z', mine: true, subject: 'feat(app): The list sorts by date', adds: 40, dels: 3, pushed: true },
    { hash: 'a2', time: '2026-09-26T19:45:00.000Z', mine: true, subject: 'fix: The header fits on a phone [skip ci]', adds: 5, dels: 5, pushed: true },
  ],
  ci: null, github: null, deploy: null, tests: null, ...over,
});
const facts = (projects = [project()], over = {}) => ({
  generated: '2026-09-27T02:00:00.000Z', timeZone: 'America/New_York',
  day: { start: '2026-09-26T04:00:00.000Z', end: '2026-09-27T04:00:00.000Z', isToday: true },
  user: 'me', name: 'Christian', projects, ...over,
});

test('the day drawn: after noon today, before noon yesterday, or a given date', () => {
  expect(dayWindow('auto', new Date(2026, 8, 26, 22, 0)).start).toEqual(new Date(2026, 8, 26));
  expect(dayWindow('auto', new Date(2026, 8, 27, 8, 0)).start).toEqual(new Date(2026, 8, 26));
  expect(dayWindow('2026-08-28').start).toEqual(new Date(2026, 7, 28));
});

test('gather reads a repo: the day\'s own commits, uncommitted files (venv noise left out), worktrees', async () => {
  const dir = tmp();
  const g = makeRepo(join(dir, 'proj'), ['2026-09-26T09:15:00Z', '2026-09-26T13:40:00Z', '2026-09-25T23:00:00Z'] /* bun test runs in UTC; git reads the Z */);
  writeFileSync(join(dir, 'proj', 'f0.txt'), 'changed\n');
  mkdirSync(join(dir, 'proj', '.venv'));
  writeFileSync(join(dir, 'proj', '.venv', 'x'), '');
  g(['worktree', 'add', '-q', '-b', 'side', join(dir, 'side')]);
  const f = await gather({ config: baseConfig(dir), day: '2026-09-26', fetch: false });
  const p = f.projects.find((x) => x.name === 'proj');
  expect(p.commits.map((c) => c.subject)).toEqual(['feat(app): Change number 0', 'feat(app): Change number 1']);
  expect(p.commits.every((c) => c.mine && !c.pushed)).toBe(true);
  expect(p.dirty).toMatchObject({ count: 1, tracked: 1, untracked: 0 });
  expect(p.worktrees).toHaveLength(1);
  expect(p.worktrees[0]).toMatchObject({ branch: 'side', merged: true });
  expect(f.projects.filter((x) => x.name === 'side')).toHaveLength(0); // the worktree is not a second project
  expect(f.name).toBe('Christian');
});

test('pick: what is not live, a red CI, commits only here, a failing suite and old uncommitted work need attention', () => {
  const f = facts([project({
    ahead: 2,
    deploy: { label: 'example.com', reachable: true, live: 'aaaa1111', deployedAt: '2026-09-25T10:00:00.000Z', compare: 'https://github.com/me/app/compare/aaaa1111...main',
      waiting: [{ hash: 'c3', time: '2026-09-26T23:30:00.000Z', subject: 'Newer' }, { hash: 'c2', time: '2026-09-26T21:00:00.000Z', subject: 'Older' }] },
    ci: { headRun: { sha: 'c3c3c3c3', name: 'CI', conclusion: 'failure', url: 'https://github.com/me/app/actions/runs/1', created: '2026-09-26T23:40:00.000Z' } },
    tests: { lastSuite: { at: '2026-09-26T23:00:00.000Z', passed: 240, total: 247, result: 'fail' } },
    github: { pulls: [], issues: [{ number: 1, title: 'Health check failed', by: 'github-actions[bot]', created: '2026-07-03T00:00:00Z', updated: '2026-09-26T12:00:00Z', url: 'https://github.com/me/app/issues/1' }] },
    dirty: { count: 3, tracked: 3, untracked: 0, files: [], newest: '2026-09-26T10:00:00.000Z' },
  })]);
  const p = pick(f);
  expect(p.attention.map((x) => x.title)).toEqual([
    '2 app commits not live', 'CI failed on app\'s main', '2 app commits only on this Mac', 'app\'s unit tests: 240 of 247', '3 uncommitted changes in app',
  ]);
  expect(p.attention[0]).toMatchObject({ id: 'A1', href: 'https://github.com/me/app/compare/aaaa1111...main' });
  expect(p.attention[0].text).toBe('Main is 2 commits ahead of example.com [[on GitHub]], the oldest from 5 PM.');
  expect(p.resolved.map((x) => x.title)).toEqual(['All 2 of the day\'s app commits are on GitHub']);
});

test('pick: a caught-up deploy, green CI and a passing suite are resolved; recent or known-kept uncommitted work is left out', () => {
  const f = facts([project({
    deploy: { label: 'example.com', reachable: true, live: 'aaaa1111', deployedAt: '2026-09-25T23:10:39.000Z', waiting: [], compare: null },
    ci: { headRun: { sha: 'aaaa1111', name: 'CI', conclusion: 'success', url: 'https://github.com/me/app/actions/runs/2', created: '2026-09-26T20:00:00.000Z' } },
    tests: { lastSuite: { at: '2026-09-27T00:51:58.770Z', passed: 247, total: 247, secs: 38, result: 'pass' } },
    dirty: { count: 1, tracked: 1, untracked: 0, files: [], newest: '2026-09-27T01:50:00.000Z' },
    worktrees: [{ path: '~/wt/fork', branch: 'fork', exists: true, merged: true, dirty: { tracked: 4, newest: '2026-09-25T19:34:00.000Z' } }],
  })]);
  const p = pick(f, { ignoreDirty: ['~/wt/fork'] });
  expect(p.attention).toEqual([]);
  expect(p.resolved.map((x) => x.title)).toEqual(['Everything on app\'s main is live', 'CI passed on app\'s main', 'app\'s unit tests passed, 247 of 247', 'All 2 of the day\'s app commits are on GitHub']);
  expect(p.resolved[0]).toMatchObject({ sourceHref: 'https://example.com', text: 'example.com moved to main\'s newest commit at 7:10 PM Friday [[on example.com]].' });
  // The same worktree without the ignore line is an attention item
  expect(pick(f).attention.map((x) => x.title)).toEqual(['4 uncommitted changes in app\'s fork worktree']);
});

test('the words check: good words pass; a time or number not in the facts, a lost link phrase, a scolding word or a long title are swapped for plain wording', () => {
  const f = facts([project({ deploy: { label: 'example.com', reachable: true, live: 'aaaa1111', deployedAt: '2026-09-26T23:10:00.000Z', waiting: [], compare: null } })]);
  const p = pick(f);
  const good = {
    headline: 'A two-commit day in app, Christian, bookended at 10:10 AM and 3:45 PM.',
    acts: ['The list learned to sort by date at 10:10 AM.', 'Quiet through the afternoon until 3:45 PM, when the header was fixed for phones.', 'Quiet.'],
    attention: [],
    resolved: [{ id: 'R1', title: 'app is live on its newest commit', text: 'The site took main\'s newest commit at 7:10 PM [[on example.com]].' }, { id: 'R2', title: 'Both commits of the day are pushed', text: 'Each one is on GitHub, the last from 3:45 PM.' }],
  };
  const ok = checkWords(good, f, p);
  expect(ok.swaps).toEqual([]);
  expect(ok.words.by).toBe('coding');
  expect(ok.words.resolved[1].text).toBe('Each one is [[on GitHub]], the last from 3:45 PM.'); // the phrase got its brackets back
  expect(ok.words.resolved[0]).toMatchObject({ href: 'https://github.com/me/app/commit/aaaa1111', sourceHref: 'https://example.com' });

  const bad = checkWords({
    ...good,
    headline: 'Christian, 5 commits landed by 11:30 AM.',
    acts: ['You still need to push.', good.acts[1], good.acts[2]],
    resolved: [{ id: 'R1', title: 'The site now runs the very newest commit that main has', text: 'The site is up to date.' }, good.resolved[1]],
  }, f, p);
  const plain = plainWords(f, p);
  expect(bad.swaps.map((x) => x.field)).toEqual(['headline', 'act 1', 'R1 title', 'R1 text']);
  expect(bad.swaps[0].why).toBe('the time 11:30 AM is not in the facts');
  expect(bad.words.headline).toBe(plain.headline);
  expect(bad.words.acts[0].text).toBe(plain.acts[0].text);
  expect(bad.words.resolved[0]).toMatchObject({ title: plain.resolved[0].title, text: plain.resolved[0].text });
});

test('the model is asked once, in a forced JSON shape naming every item; a failed call falls back to plain words', async () => {
  const f = facts([project({ ahead: 1 })]);
  const p = pick(f);
  const schema = schemaFor(p);
  expect(schema.properties.attention).toMatchObject({ minItems: 1, maxItems: 1 });
  expect(schema.properties.attention.items.properties.id.enum).toEqual(['A1']);
  expect(schemaFor({ attention: [], resolved: [] }).properties.resolved).toEqual({ type: 'array', maxItems: 0 });
  const text = digest(f, p);
  expect(text).toContain('- 10:10 AM · app · The list sorts by date');
  expect(text).toContain('- 3:45 PM · app · The header fits on a phone');
  expect(text).toContain('6 PM onward:\n- none');

  let asked = null;
  const r = await writeWords({ facts: f, picks: p, url: 'http://x', model: {}, complete: async (a) => { asked = a; return { json: { headline: 'Two commits in app, Christian.', acts: ['Sorting by date at 10:10 AM.', 'The header fix at 3:45 PM.', 'Quiet.'], attention: [{ id: 'A1', title: 'One commit only on this Mac', text: 'main is 1 commit ahead of GitHub, so nothing else holds a copy.' }], resolved: [{ id: 'R1', title: 'The day is on GitHub', text: 'Each one is [[on GitHub]], the last from 3:45 PM.' }] }, secs: 3 }; } });
  expect(asked.schema).toEqual(schemaFor(p));
  expect(asked.user).toBe(text);
  expect(r.words.headline).toBe('Two commits in app, Christian.');
  expect(r.swaps).toEqual([]);

  const failed = await writeWords({ facts: f, picks: p, url: 'http://x', model: {}, complete: async () => { throw new Error('fetch failed'); } });
  expect(failed).toMatchObject({ error: 'fetch failed', words: plainWords(f, p) });
});

test('the page escapes what it was given, keeps only https links, and draws the day from the facts', () => {
  const f = facts();
  const words = { ...plainWords(f, pick(f)), headline: '<img src=x onerror=alert(1)> Christian', resolved: [{ title: 'x', text: 'see [[here]]', href: 'javascript:alert(1)' }] };
  const day = buildDay(f, words);
  expect(day.html).not.toContain('<img');
  expect(day.html).toContain('&lt;img src=x onerror=alert(1)&gt; Christian');
  expect(day.html).not.toContain('javascript:');
  expect(day.html).toContain('see here');
  expect((day.html.match(/<circle /g) ?? []).length).toBe(2); // two commits far apart → two dots
  expect(day).toMatchObject({ key: '2026-09-26', label: 'Saturday · September 26 2026', short: 'Sep 26', shape: 'NORMAL', commits: 2 });
  const page = pageHtml([day]);
  expect(page).toContain('<meta charset="utf-8">');
  expect(page).toContain('font/woff2;base64,d09GMg'); // the embedded Fraunces file ("wOF2")
  expect(page).not.toMatch(/https?:\/\/(fonts\.|cdn)/);
});

test('history: each day is saved, a second run of the same day keeps the first under earlier/, and the page\'s calendar holds every day', () => {
  const dir = tmp();
  const config = baseConfig(dir);
  const sat = facts();
  const fri = facts([project({ commits: [{ hash: 'f1', time: '2026-09-25T15:00:00.000Z', mine: true, subject: 'Friday work', adds: 1, dels: 0, pushed: true }] })], { generated: '2026-09-26T01:00:00.000Z', day: { start: '2026-09-25T04:00:00.000Z', end: '2026-09-26T04:00:00.000Z', isToday: false } });
  writeBrief({ config, facts: fri, words: plainWords(fri, pick(fri)) });
  writeBrief({ config, facts: sat, words: plainWords(sat, pick(sat)) });
  const again = { ...sat, generated: '2026-09-27T03:00:00.000Z' };
  const r = writeBrief({ config, facts: again, words: plainWords(again, pick(again)) });
  expect(r.days).toEqual(['2026-09-25', '2026-09-26']);
  expect(readdirSync(join(dir, 'history', '2026-09-26', 'earlier'))).toEqual(['2026-09-27T02-00-00-000Z']);
  expect(JSON.parse(readFileSync(join(dir, 'history', '2026-09-26', 'facts.json'), 'utf8')).generated).toBe('2026-09-27T03:00:00.000Z');
  const page = readFileSync(config.out, 'utf8');
  expect(page).toContain('<template id="d-2026-09-25">');
  expect(page).toContain('"key":"2026-09-26","label":"Saturday · September 26 2026","short":"Sep 26"');
  expect(page).toContain('2 mornings saved · ← → step through them');
  expect(readFileSync(join(dir, 'history', '2026-09-25', 'brief.html'), 'utf8')).not.toContain('<script');
  // Rebuilt from the history alone
  expect(writeBrief({ config }).days).toEqual(['2026-09-25', '2026-09-26']);
});

test('/morning is a command typed in full (since 2 Oct 2026 /agents has its row in the / menu)', () => {
  expect(matchCommands('/mor')).toEqual([]);
  expect(COMMANDS.some((c) => c.name === 'morning')).toBe(true);
  expect(helpData().commands.find((c) => c.name === 'morning')).toMatchObject({ typed: true });
});

test('/morning today in the app: reads the repos, the model writes the words, the page lands with the day in its calendar', async () => {
  const { cwd, env, base } = setup();
  const dir = join(base, 'morning');
  // Two commits a moment ago (in any time zone, still "today" for the app)
  makeRepo(join(dir, 'repos', 'proj'), [new Date(Date.now() - 120_000).toISOString(), new Date(Date.now() - 60_000).toISOString()]);
  const config = baseConfig(join(dir, 'repos'), { out: join(dir, 'morning-brief.html'), history: join(dir, 'history') });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  const reply = { headline: 'Two small commits in proj, Christian, just after midnight.', acts: ['Two changes to proj just after midnight.', 'Quiet all afternoon.', 'Quiet in the evening.'], attention: [], resolved: [] };
  const fake = await startFakeServer([{ text: JSON.stringify(reply) }]);
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_NO_OPEN: '1', REPO_MORNING_CONFIG: join(dir, 'config.json') }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/morning today' }, { key: 'enter' },
    { wait: 'Morning brief for' }, ...quit,
  ] });
  await fake.close();
  const flat = r.text.replace(/\s+/g, ' '); // the note is long enough to wrap
  expect(flat).toContain('Read 1 repo in');
  expect(flat).toContain('Agentic Coder wrote the words, all checked against the facts');
  expect(flat).toContain('1 day in the calendar');
  const asked = fake.requests.find((x) => x.response_format);
  expect(asked.response_format.json_schema.schema.required).toEqual(['headline', 'acts', 'attention', 'resolved']);
  const page = readFileSync(join(dir, 'morning-brief.html'), 'utf8');
  expect(page).toContain('Two small commits in proj, Christian, just after midnight.');
  expect(page).toContain('drawn as terrain: 2 commits');
  expect(existsSync(join(dir, 'history'))).toBe(true);
}, T);
