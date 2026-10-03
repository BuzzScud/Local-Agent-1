// The facts for the morning brief: every project repo under the scan folders,
// its worktrees, the day's commits, CI on the default branch, open pull
// requests and issues, what is live, and a repo's own test record.
// Nothing here writes to a repo except `git fetch` (fetch: false skips it).
// The GitHub token comes from git's credential helper, stays in memory and is
// never written anywhere.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { expand } from './config.mjs';

const run = promisify(execFile);
const HOME = homedir();
const tilde = (p) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);
const lines = (s) => (s ?? '').split('\n').filter(Boolean);
const iso = (secs) => new Date(Number(secs) * 1000).toISOString();

async function git(cwd, argv, timeout = 30_000) {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...argv], { maxBuffer: 64 << 20, timeout });
    return stdout;
  } catch {
    return null;
  }
}

// The day drawn: today when run after noon, yesterday before noon (auto)
export function dayWindow(spec = 'auto', now = new Date()) {
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(spec)) {
    const [y, m, dd] = spec.split('-').map(Number);
    d = new Date(y, m - 1, dd);
  } else {
    d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (spec === 'yesterday' || (spec === 'auto' && now.getHours() < 12)) d.setDate(d.getDate() - 1);
  }
  const end = new Date(d);
  end.setDate(end.getDate() + 1);
  return { start: d, end, isToday: now >= d && now < end, now };
}

// Every repo under the scan folders, worktrees grouped under the repo that owns them
export async function discover(config) {
  const found = new Set();
  for (const root of config.scan.map(expand)) {
    if (!existsSync(root)) continue;
    const argv = [root, '-maxdepth', String(config.maxDepth ?? 4),
      '(', '-name', 'node_modules', '-o', '-name', 'Library', '-o', '-name', '.Trash', ')', '-prune',
      '-o', '-name', '.git', '-print'];
    let stdout = '';
    try { ({ stdout } = await run('find', argv, { maxBuffer: 16 << 20, timeout: 60_000 })); } catch (e) { stdout = String(e.stdout ?? ''); }
    for (const line of lines(stdout)) found.add(dirname(line));
  }
  const dirs = [...found].filter((d) => !config.exclude.some((x) => `${d}/`.includes(x)));
  const mains = new Set();
  await Promise.all(dirs.map(async (d) => {
    const common = (await git(d, ['rev-parse', '--path-format=absolute', '--git-common-dir']))?.trim();
    if (common) mains.add(common.endsWith('/.git') ? dirname(common) : d);
  }));
  return [...mains].sort();
}

// ---- GitHub ------------------------------------------------------------------------------
let tokenPromise;
function githubToken() {
  tokenPromise ??= new Promise((resolve) => {
    const p = spawn('git', ['credential', 'fill'], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let out = '';
    const timer = setTimeout(() => { p.kill(); resolve(null); }, 8000);
    p.stdout.on('data', (b) => (out += b));
    p.on('close', () => { clearTimeout(timer); resolve(/^password=(.+)$/m.exec(out)?.[1] ?? null); });
    p.on('error', () => { clearTimeout(timer); resolve(null); });
    p.stdin.end('protocol=https\nhost=github.com\n\n');
  });
  return tokenPromise;
}

async function githubJson(route) {
  const token = await githubToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.github.com${route}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'agentic-coder-morning' },
      signal: AbortSignal.timeout(12_000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function parseGithub(url) {
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url ?? '');
  return m ? { owner: m[1], repo: m[2], web: `https://github.com/${m[1]}/${m[2]}` } : null;
}

// ---- one repo ----------------------------------------------------------------------------
const mtimeOf = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

async function dirtyState(dir, config) {
  const out = await git(dir, ['status', '--porcelain=v1']);
  if (out == null) return null;
  const noise = new Set(config.ignoreUntracked ?? []);
  const entries = lines(out).map((l) => ({ code: l.slice(0, 2), file: l.slice(3).replace(/^"|"$/g, '') }))
    .filter((e) => !(e.code === '??' && e.file.split('/').some((part) => noise.has(part))));
  const newest = Math.max(0, ...entries.map((e) => mtimeOf(join(dir, e.file.split(' -> ').pop()))));
  return {
    count: entries.length,
    tracked: entries.filter((e) => e.code !== '??').length,
    untracked: entries.filter((e) => e.code === '??').length,
    files: entries.slice(0, 8).map((e) => `${e.code.trim() || '?'} ${e.file}`),
    newest: newest ? new Date(newest).toISOString() : null,
  };
}

async function project(dir, day, myEmails, config, doFetch) {
  const url = (await git(dir, ['remote', 'get-url', 'origin']))?.trim().replace(/\/\/[^@/]+@/, '//') ?? null;
  const gh = parseGithub(url);
  const key = gh ? `${gh.owner}/${gh.repo}` : null;
  let fetched = null;
  if (url && doFetch) fetched = (await git(dir, ['fetch', '--quiet', '--no-tags', '--prune', 'origin'], 25_000)) != null;
  const originHead = (await git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']))?.trim();
  const defaultBranch = originHead?.replace(/^origin\//, '') || ((await git(dir, ['rev-parse', '--verify', '-q', 'main'])) ? 'main' : 'master');
  const baseRef = (await git(dir, ['rev-parse', '--verify', '-q', `origin/${defaultBranch}`])) ? `origin/${defaultBranch}` : defaultBranch;
  const branch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() ?? null;
  const ab = (await git(dir, ['rev-list', '--left-right', '--count', '@{u}...HEAD']))?.trim().split(/\s+/).map(Number);
  const [lastHash, lastTime, lastSubject] = ((await git(dir, ['log', '-1', '--format=%H%x1f%ct%x1f%s'])) ?? '').trim().split('\x1f');

  // Worktrees
  const wts = ((await git(dir, ['worktree', 'list', '--porcelain'])) ?? '').split('\n\n').map((block) => {
    const get = (k) => new RegExp(`^${k} (.+)$`, 'm').exec(block)?.[1];
    return { path: get('worktree'), head: get('HEAD'), branch: get('branch')?.replace('refs/heads/', '') ?? null, prunable: /^prunable/m.test(block) };
  }).filter((w) => w.path && w.path !== dir);
  const worktrees = await Promise.all(wts.map(async (w) => {
    const exists = existsSync(w.path);
    const counts = (await git(dir, ['rev-list', '--left-right', '--count', `${baseRef}...${w.head}`]))?.trim().split(/\s+/).map(Number) ?? [0, 0];
    const [t, s] = ((await git(dir, ['log', '-1', '--format=%ct%x1f%s', w.head])) ?? '').trim().split('\x1f');
    const pushed = w.branch ? (await git(dir, ['rev-parse', '--verify', '-q', `origin/${w.branch}`]))?.trim() === w.head : false;
    return {
      path: tilde(w.path), branch: w.branch, head: w.head?.slice(0, 8), exists, prunable: w.prunable,
      behindMain: counts[0], aheadOfMain: counts[1], merged: counts[1] === 0, branchPushed: pushed,
      lastCommit: t ? { time: iso(t), subject: s } : null,
      dirty: exists ? await dirtyState(w.path, config) : null,
    };
  }));

  // The day's commits, on every ref and every worktree HEAD
  const heads = wts.map((w) => w.head).filter(Boolean);
  const pushedSet = new Set(lines(await git(dir, ['log', '--remotes', `--since=${new Date(day.start - 864e5).toISOString()}`, '--format=%H'])));
  const seen = new Set();
  const commits = [];
  // --since-as-filter looks at every commit (plain --since stops at the first older one it
  // meets, and misses commits made after an out-of-order one); the times are checked again below
  const range = [`--since-as-filter=${day.start.toISOString()}`, `--until=${day.end.toISOString()}`];
  const format = ['--format=%x1e%H%x1f%ct%x1f%ae%x1f%s', '--shortstat'];
  const log = (await git(dir, ['log', '--all', ...heads, ...range, ...format])) ?? (await git(dir, ['log', '--all', ...heads, `--since=${day.start.toISOString()}`, range[1], ...format]));
  for (const rec of (log ?? '').split('\x1e').slice(1)) {
    const [head, ...rest] = rec.split('\n');
    const [hash, ct, email, subject] = head.split('\x1f');
    if (seen.has(hash) || ct * 1000 < day.start.getTime() || ct * 1000 >= day.end.getTime()) continue;
    seen.add(hash);
    const stat = rest.join(' ');
    commits.push({
      hash: hash.slice(0, 8), time: iso(ct), mine: myEmails.has(email.toLowerCase()), subject,
      adds: Number(/(\d+) insertion/.exec(stat)?.[1] ?? 0), dels: Number(/(\d+) deletion/.exec(stat)?.[1] ?? 0), pushed: pushedSet.has(hash),
    });
  }
  commits.sort((a, b) => a.time.localeCompare(b.time));

  // CI on the default branch
  let ci = null;
  const owned = gh && config.ciOwners.includes(gh.owner);
  if (owned && existsSync(join(dir, '.github/workflows'))) {
    const headSha = (await git(dir, ['rev-parse', baseRef]))?.trim();
    const headSubject = (await git(dir, ['log', '-1', '--format=%s', baseRef]))?.trim();
    const data = await githubJson(`/repos/${key}/actions/runs?branch=${defaultBranch}&per_page=20`);
    if (data) {
      const pick = (r) => r && { sha: r.head_sha.slice(0, 8), name: r.name, status: r.status, conclusion: r.conclusion, url: r.html_url, created: r.created_at };
      const runs = data.workflow_runs ?? [];
      const main = runs.filter((r) => r.name === 'CI' || r.path?.endsWith('/ci.yml'));
      const pool = main.length ? main : runs;
      ci = {
        headSha: headSha?.slice(0, 8), headSkipsCi: /\[skip ci\]/i.test(headSubject ?? ''),
        headRun: pick(pool.find((r) => r.head_sha === headSha)),
        lastRun: pick(pool.find((r) => r.status === 'completed')),
      };
    }
  }

  // Open pull requests and issues on repos we own
  let github = null;
  if (owned) {
    const [pulls, issues] = await Promise.all([githubJson(`/repos/${key}/pulls?state=open&per_page=20`), githubJson(`/repos/${key}/issues?state=open&per_page=20`)]);
    const item = (x) => ({ number: x.number, title: x.title, by: x.user?.login, created: x.created_at, updated: x.updated_at, url: x.html_url, draft: x.draft ?? false });
    if (pulls || issues) github = { pulls: (pulls ?? []).map(item), issues: (issues ?? []).filter((x) => !x.pull_request).map(item) };
  }

  // What is live: the command prints the server's reflog, newest first ("<sha> HEAD@{<date>}");
  // the live commit is the first sha, and it arrived at the oldest entry of that first run
  let deploy = null;
  const dep = key && config.deploy?.[key];
  if (dep) {
    let live = null, deployedAt = null;
    try {
      const { stdout } = await run('/bin/sh', ['-c', dep.cmd], { timeout: 15_000 });
      for (const l of lines(stdout)) {
        const sha = /[0-9a-f]{40}/.exec(l)?.[0];
        if (!sha) continue;
        live ??= sha;
        if (sha !== live) break;
        deployedAt = /@\{([^}]+)\}/.exec(l)?.[1] ?? deployedAt;
      }
    } catch { /* unreachable server: live stays null */ }
    const known = live && (await git(dir, ['cat-file', '-e', `${live}^{commit}`])) != null;
    const waiting = known ? lines(await git(dir, ['log', '--format=%h%x1f%ct%x1f%s', `${live}..${baseRef}`])).map((l) => {
      const [h, t, s] = l.split('\x1f');
      return { hash: h, time: iso(t), subject: s };
    }) : null;
    deploy = {
      label: dep.label ?? key, reachable: live != null, live: live?.slice(0, 8) ?? null,
      deployedAt: deployedAt && !Number.isNaN(Date.parse(deployedAt)) ? new Date(deployedAt).toISOString() : null,
      waiting, compare: live ? `${gh.web}/compare/${live.slice(0, 12)}...${defaultBranch}` : null,
    };
  }

  // A repo's own test record: the day's rows and the latest full suite
  let tests = null;
  const recordPath = key && config.testRecords?.[key];
  if (recordPath && existsSync(expand(recordPath))) {
    const rows = lines(readFileSync(expand(recordPath), 'utf8')).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    const slim = (r) => r && { at: r.at, kind: r.kind, name: r.name, code: r.code, passed: r.passed, total: r.total, secs: r.secs, result: r.result, note: r.note, part: r.part ?? false };
    const inDay = (r) => new Date(r.at) >= day.start && new Date(r.at) < day.end;
    tests = {
      record: recordPath,
      day: rows.filter(inDay).sort((a, b) => a.at.localeCompare(b.at)).map(slim),
      lastSuite: slim(rows.filter((r) => r.kind === 'suite' && !r.part).sort((a, b) => b.at.localeCompare(a.at))[0]),
    };
  }

  return {
    name: basename(dir), path: tilde(dir), remote: gh ?? (url ? { url } : null), fetched, defaultBranch, branch,
    behind: ab?.[0] ?? null, ahead: ab?.[1] ?? null,
    lastCommit: lastHash ? { hash: lastHash.slice(0, 8), time: iso(lastTime), subject: lastSubject } : null,
    stashes: lines(await git(dir, ['stash', 'list'])).length,
    dirty: await dirtyState(dir, config), worktrees, commits, ci, github, deploy, tests,
  };
}

export async function gather({ config, day = 'auto', fetch: doFetch = true, now = new Date() } = {}) {
  const w = dayWindow(day, now);
  const myEmails = new Set(config.emails.map((e) => e.toLowerCase()));
  const repos = await discover(config);
  for (const d of repos) {
    const e = (await git(d, ['config', 'user.email']))?.trim();
    if (e) myEmails.add(e.toLowerCase());
  }
  const projects = (await Promise.all(repos.map((d) => project(d, w, myEmails, config, doFetch))))
    .sort((a, b) => (b.lastCommit?.time ?? '').localeCompare(a.lastCommit?.time ?? ''));
  const user = (await git(HOME, ['config', '--global', 'user.name']))?.trim() || null;
  return {
    generated: w.now.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    day: { start: w.start.toISOString(), end: w.end.toISOString(), isToday: w.isToday },
    user, name: config.name ?? user,
    projects,
  };
}
