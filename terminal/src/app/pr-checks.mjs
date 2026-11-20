// coding pr: a Gitea (or Forgejo) pull request's checks, read the way a person who has to make it ready reads them
// (the owner's pick, 19 Nov 2026: "A · Full", after a pull request sat Not ready all evening while its card said
// "phone failure" and phone had passed on every one of ~20 runs).
//
//   coding pr <n>                    every run on the pull request's newest commits, a line a part: how it is on the
//                                    newest commit, how many runs it passed, and the failed tests by name, each said
//                                    as real (fails on the newest commit), fixed (failed on several runs, gone
//                                    from newer ones) or once (failed one run, gone since: random, or fixed)
//   coding pr guard <n> [--hold p]   before a push, in the same command (coding pr guard 12 && git push …): the
//                                    branch fetched, this copy has everything on it (so the push needs no force), and
//                                    no open pull request whose branch starts with p (a release train at its checks)
//   coding pr watch <n> [--need a,b] [--every s] [--for m]
//                                    looks every 60 s or more (a forge's task list is heavy; a tighter loop helped one
//                                    run out of memory) and ends when the needed parts pass (0), one fails (1, with
//                                    why), the newest commit moves (2) or time runs out (3)
//
// Where it reads from: the folder's own git remote (origin), its certificate from git's http.sslCAInfo for that
// address, and the key from git's credential helper (the Keychain on a Mac), held in memory for the call and never
// printed. Nothing about one forge is written here, so the repo names no private address.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (cwd, args, input) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', input, timeout: 60_000 });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};

// origin → { base: the forge's address, owner, repo }, from an https remote (owner/repo after the address, .git or
// not) or an ssh one (git@<address>:owner/repo).
export const remoteOf = (url) => {
  const u = String(url ?? '').trim();
  let m = u.match(/^(https?):\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (m) return { base: `${m[1]}://${m[2]}`, owner: m[3], repo: m[4] };
  m = u.match(/^(?:ssh:\/\/)?(?:[^@]+@)?([^:/]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? { base: `https://${m[1]}`, owner: m[2], repo: m[3] } : null;
};

// The forge's API for this folder: get(path) → JSON (or text with raw), against /api/v1/repos/<owner>/<repo>/.
const forgeOf = (cwd) => {
  const url = git(cwd, ['remote', 'get-url', 'origin']).out;
  const where = remoteOf(url);
  if (!where) return { error: `This folder's origin (${url || 'none'}) is not a forge address coding pr can read.` };
  const host = where.base.replace(/^https?:\/\//, '');
  const cred = git(cwd, ['credential', 'fill'], `protocol=${where.base.split(':')[0]}\nhost=${host}\n\n`);
  const token = cred.out.match(/^password=(.*)$/m)?.[1];
  if (!token) return { error: `No key for ${host} in git's credential helper: sign in once with git (a push asks), then try again.` };
  const caFile = git(cwd, ['config', '--get-urlmatch', 'http.sslCAInfo', `${where.base}/`]).out;
  return { ...where, api: makeApi({ base: where.base, owner: where.owner, repo: where.repo, token, ca: caFile ? readFileSync(caFile, 'utf8') : null }) };
};

export const makeApi = ({ base, owner, repo, token, ca = null }) => async (path, { raw = false } = {}) => {
  const r = await fetch(`${base}/api/v1/repos/${owner}/${repo}/${path}`, { headers: { authorization: `token ${token}`, accept: raw ? 'text/plain' : 'application/json' }, ...(ca ? { tls: { ca } } : {}), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${path.split('?')[0]}: the forge answered ${r.status}`);
  return raw ? r.text() : r.json();
};

// A check's name in a status: "change / tests1 (pull_request)" → tests1.
export const partOf = (context) => String(context).replace(/\s*\([^)]*\)\s*$/, '').split(' / ').pop().trim();
const runNumberOf = (target) => Number(String(target ?? '').match(/\/actions\/runs\/(\d+)/)?.[1]) || null;
const jobIndexOf = (target) => Number(String(target ?? '').match(/\/jobs\/(\d+)/)?.[1] ?? 99);

// Each part's newest state on one commit, from its statuses (newest first; every state change is a status).
export const partsOn = (statuses) => {
  const out = new Map();
  for (const s of [...statuses].sort((a, b) => (b.id ?? 0) - (a.id ?? 0) || String(b.created_at).localeCompare(String(a.created_at)))) {
    const part = partOf(s.context);
    if (!out.has(part)) out.set(part, { part, state: s.status ?? s.state, run: runNumberOf(s.target_url), order: jobIndexOf(s.target_url), at: s.updated_at ?? s.created_at });
  }
  return out;
};

// The lines of a log that say why: bun's and node's "(fail) name", GitHub-style ::error:: lines (%0A is a new line),
// pytest's FAILED. The test's name is the key a failure is matched by across runs.
export const failLines = (log) => {
  const names = [];
  const errors = [];
  for (const raw of String(log ?? '').split('\n')) {
    const line = raw.replace(/^\S*\d{4}-\d\d-\d\dT[\d:.]+Z\s*/, '').trimEnd();
    const fail = line.match(/^\s*(?:\(fail\)|✗|FAILED)\s+(.+?)(?:\s+\[[\d.]+m?s\])?$/);
    if (fail && !names.includes(fail[1])) names.push(fail[1]);
    else if (line.startsWith('::error')) {
      const e = line.replace(/^::error[^:]*::/, '').split('%0A').map((x) => x.trim()).filter((x) => x && !x.startsWith('at ')).slice(0, 3).join(' · ').slice(0, 300);
      if (!errors.includes(e)) errors.push(e);
    }
  }
  return { names, errors: errors.slice(0, 6) };
};

// A run's number (in its address) → its id (the API's): ids run ahead of numbers by a gap that only grows, so a guess
// from the gap at that number moves onto it in a step or two.
const runIdOf = async (api, number) => {
  let id = number;
  for (let i = 0; i < 6; i++) {
    const r = await api(`actions/runs/${id}`).catch(() => null);
    if (!r?.run_number) { id += 1; continue; }
    if (r.run_number === number) return id;
    id += number - r.run_number;
  }
  return null;
};

const jobsOf = async (api, number) => {
  const id = await runIdOf(api, number);
  return id ? ((await api(`actions/runs/${id}/jobs?limit=50&page=1`).catch(() => null))?.jobs ?? []) : [];
};

// The pull request and its newest commits' checks (up to `commits` of them, newest first), with the failed tests of
// each failed part read from its log.
// A closed pull request's commits, which the forge no longer lists: the line of its own commits from the ref the forge
// keeps for it (first parents, so a merge of the base branch brings none of the base's).
const localLine = (cwd, n, count) => {
  if (!cwd || !git(cwd, ['fetch', '-q', 'origin', `refs/pull/${n}/head`]).ok) return [];
  return git(cwd, ['rev-list', '--first-parent', '-n', String(count), 'FETCH_HEAD']).out.split('\n').filter(Boolean).map((sha) => ({ sha }));
};

export const readPr = async (api, n, { commits = 12, cwd = null } = {}) => {
  const pr = await api(`pulls/${n}`);
  let list = await api(`pulls/${n}/commits?limit=50&page=1`);
  if (!list.length) list = localLine(cwd, n, commits);
  // newest first, as the forge lists them; with neither, its last commit stands in
  const shas = (list.length ? list : [{ sha: pr.head?.sha }]).map((c) => ({ sha: c.sha, title: String(c.commit?.message ?? '').split('\n')[0], at: c.created ?? c.commit?.author?.date })).slice(0, commits);
  const runs = [];
  for (const c of shas) {
    const parts = partsOn(await api(`commits/${c.sha}/statuses?limit=50&page=1`));
    if (!parts.size) continue;
    const failed = [...parts.values()].filter((p) => p.state === 'failure' || p.state === 'error');
    let jobs = [];
    if (failed.length && failed[0].run) jobs = await jobsOf(api, failed[0].run);
    for (const p of failed) {
      const job = jobs.find((j) => j.name === p.part);
      p.why = job ? failLines(await api(`actions/jobs/${job.id}/logs`, { raw: true }).catch(() => '')) : { names: [], errors: [] };
    }
    runs.push({ ...c, parts });
  }
  return { pr: { number: pr.number, title: pr.title, state: pr.merged ? 'merged' : pr.state, branch: pr.head?.ref, head: pr.head?.sha, labels: (pr.labels ?? []).map((l) => l.name), mergeable: pr.mergeable }, runs };
};

const PASS = new Set(['success', 'skipped']);
// Per part: its state on the newest commit that has checks, how many finished runs it passed, and each failed test's
// verdict: real (fails on the newest commit, or nothing newer shows it gone), fixed (failed on several runs, gone from
// newer ones: a newer run of its part passed or failed on other tests only) or once (the same after one failure: random,
// or fixed).
export const verdicts = ({ runs }) => {
  const newest = runs[0];
  // in the order the workflow lists its jobs
  const order = new Map(runs.flatMap((r) => [...r.parts.values()].map((p) => [p.part, p.order])).reverse());
  const parts = [...order.keys()].sort((a, b) => order.get(a) - order.get(b));
  return parts.map((part) => {
    const seen = runs.map((r) => r.parts.get(part)).filter(Boolean);
    const done = seen.filter((p) => p.state !== 'pending');
    const now = newest?.parts.get(part)?.state ?? 'none';
    const tests = new Map();
    for (const [i, p] of seen.entries()) for (const name of p.why?.names ?? []) {
      const t = tests.get(name) ?? { name, runs: 0, onNewest: false, errors: p.why.errors };
      t.runs += 1;
      if (i === 0 && runs[0].parts.get(part) === p) t.onNewest = true;
      tests.set(name, t);
    }
    // gone since: a newer finished run of this part that passed, or failed naming other tests
    const goneSince = (name) => {
      const last = seen.findIndex((q) => q.why?.names.includes(name));
      return seen.slice(0, last).some((p) => PASS.has(p.state) || (p.why?.names.length && !p.why.names.includes(name)));
    };
    return {
      part, now,
      passed: done.filter((p) => PASS.has(p.state)).length, finished: done.length,
      tests: [...tests.values()].map((t) => ({ ...t, verdict: t.onNewest || !goneSince(t.name) ? 'real' : t.runs > 1 ? 'fixed' : 'once' })),
      errors: newest?.parts.get(part)?.why?.errors ?? [],
    };
  });
};

const MARK = { success: '✓', skipped: '–', failure: '✗', error: '✗', pending: '…', none: ' ' };
export const prText = (read) => {
  const { pr, runs } = read;
  const v = verdicts(read);
  const lines = [`#${pr.number} ${pr.title}`, `${pr.state} · ${pr.branch} · newest ${String(pr.head).slice(0, 8)}${pr.labels.length ? ` · ${pr.labels.join(', ')}` : ''}${pr.mergeable === false ? ' · does not merge cleanly' : ''}`];
  if (!runs.length) return [...lines, 'No checks have run on its newest commits.'].join('\n');
  if (runs[0].sha !== pr.head) lines.push(`The newest commit has no checks yet; below is ${runs[0].sha.slice(0, 8)}.`);
  lines.push(`${runs.length} commit${runs.length === 1 ? '' : 's'} with checks read, newest first.`, '');
  for (const p of v) {
    lines.push(`${MARK[p.now] ?? '?'} ${p.part.padEnd(10)} ${p.now === 'none' ? 'not on the newest' : p.now} · passed ${p.passed} of ${p.finished} finished run${p.finished === 1 ? '' : 's'}`);
    for (const t of p.tests) lines.push(`    ${(t.verdict === 'real' ? 'REAL' : t.verdict).padEnd(5)}  ${t.name} (failed ${t.runs} run${t.runs === 1 ? '' : 's'}${t.verdict === 'once' ? ', not since: random, or fixed' : t.verdict === 'fixed' ? ', not since' : t.onNewest ? ', on the newest' : ''})`);
    if (p.now === 'failure' || p.now === 'error') {
      for (const e of p.errors.slice(0, 3)) lines.push(`    › ${e}`);
      if (!p.tests.length && !p.errors.length) lines.push('    no failed test named in its log: a part under it failed, or the job itself broke (read its log)');
    }
  }
  const real = v.filter((p) => p.tests.some((t) => t.verdict === 'real'));
  const red = v.filter((p) => p.now === 'failure' || p.now === 'error');
  lines.push('', red.length ? `To fix: ${real.length ? real.map((p) => p.part).join(', ') : red.map((p) => p.part).join(', ')}. A part that passed on every run is not what blocks it, whatever a summary says.`
    : v.some((p) => p.now === 'pending') ? 'Nothing has failed on the newest commit; some parts are still running (coding pr watch waits for them).'
      : 'Every part passed on the newest commit.');
  return lines.join('\n');
};

// Before a push: true only when it can go as a plain push.
export const guard = async ({ cwd, api, n, hold = [] }) => {
  const pr = await api(`pulls/${n}`);
  const branch = pr.head?.ref;
  if (pr.merged || pr.state !== 'open') return { ok: false, why: `#${n} is ${pr.merged ? 'merged' : pr.state}: nothing to push to.` };
  const fetched = git(cwd, ['fetch', '-q', 'origin', branch]);
  if (!fetched.ok) return { ok: false, why: `git fetch origin ${branch} failed: ${fetched.err.split('\n')[0]}` };
  const theirs = git(cwd, ['rev-parse', 'FETCH_HEAD']).out;
  if (!git(cwd, ['merge-base', '--is-ancestor', theirs, 'HEAD']).ok) return { ok: false, why: `${branch} has commits this copy lacks (${theirs.slice(0, 8)}): git merge FETCH_HEAD first, then try again. Never force a push over them.` };
  if (git(cwd, ['rev-parse', 'HEAD']).out === theirs) return { ok: false, why: `Nothing to push: this copy is ${branch} as it is.` };
  if (hold.length) {
    const open = await api('pulls?state=open&limit=50&page=1');
    const held = open.filter((p) => hold.some((h) => String(p.head?.ref ?? '').startsWith(h)));
    if (held.length) return { ok: false, why: `Hold the push: ${held.map((p) => `#${p.number} (${p.head.ref})`).join(', ')} is open and a push now would queue its checks behind yours. Try again once it closes.` };
  }
  return { ok: true, branch, why: `OK to push to ${branch}: git push origin HEAD:${branch}` };
};

export const MIN_EVERY = 60;
// Wait for the newest commit's checks. sleep is given in tests; the command never looks more often than MIN_EVERY.
export const watch = async ({ api, n, need = [], every = MIN_EVERY, minutes = 60, sleep = (s) => new Promise((r) => setTimeout(r, s * 1000)), say = () => {}, now = () => Date.now() }) => {
  const gap = Math.max(MIN_EVERY, Number(every) || MIN_EVERY);
  const until = now() + minutes * 60_000;
  const first = (await api(`pulls/${n}`)).head?.sha;
  const told = new Set();
  for (;;) {
    const head = (await api(`pulls/${n}`)).head?.sha;
    if (head !== first) return { code: 2, why: `The newest commit moved (${String(first).slice(0, 8)} → ${String(head).slice(0, 8)}): watch it again.` };
    const parts = partsOn(await api(`commits/${head}/statuses?limit=50&page=1`));
    for (const p of parts.values()) if (p.state !== 'pending' && !told.has(p.part)) { told.add(p.part); say(`${MARK[p.state] ?? '?'} ${p.part} ${p.state}`); }
    const wanted = need.length ? need : [...parts.keys()];
    const bad = wanted.map((w) => parts.get(w)).filter((p) => p && (p.state === 'failure' || p.state === 'error'));
    if (bad.length) {
      const jobs = bad[0].run ? await jobsOf(api, bad[0].run) : [];
      const why = [];
      for (const p of bad) {
        const job = jobs.find((j) => j.name === p.part);
        const f = job ? failLines(await api(`actions/jobs/${job.id}/logs`, { raw: true }).catch(() => '')) : { names: [], errors: [] };
        why.push(`${p.part} failed${f.names.length ? `: ${f.names.join('; ')}` : ''}`, ...f.errors.slice(0, 3).map((e) => `  › ${e}`));
      }
      return { code: 1, why: why.join('\n') };
    }
    if (wanted.length && wanted.every((w) => PASS.has(parts.get(w)?.state))) return { code: 0, why: `Ready: ${wanted.join(', ')} passed on ${String(head).slice(0, 8)}.` };
    if (now() >= until) return { code: 3, why: `Still running after ${minutes} min: ${wanted.filter((w) => !PASS.has(parts.get(w)?.state)).join(', ')}.` };
    await sleep(gap);
  }
};

const flag = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const HELP = 'coding pr <number> · coding pr guard <number> [--hold <branch start>] · coding pr watch <number> [--need a,b] [--every 60] [--for 60]';

export async function prCommand(args, { cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`) } = {}) {
  const sub = /^\d+$/.test(args[0] ?? '') ? 'show' : args[0];
  const n = Number(sub === 'show' ? args[0] : args[1]);
  if (!Number.isInteger(n) || n <= 0 || !['show', 'guard', 'watch'].includes(sub)) { out(HELP); return 1; }
  const forge = forgeOf(cwd);
  if (forge.error) { out(forge.error); return 1; }
  try {
    if (sub === 'show') { out(prText(await readPr(forge.api, n, { cwd }))); return 0; }
    if (sub === 'guard') {
      const g = await guard({ cwd, api: forge.api, n, hold: String(flag(args, '--hold') ?? '').split(',').filter(Boolean) });
      out(g.why);
      return g.ok ? 0 : 1;
    }
    const w = await watch({ api: forge.api, n, need: String(flag(args, '--need') ?? '').split(',').filter(Boolean), every: Number(flag(args, '--every')) || MIN_EVERY, minutes: Number(flag(args, '--for')) || 60, say: out });
    out(w.why);
    return w.code;
  } catch (e) {
    out(`coding pr: ${e.message}`);
    return 1;
  }
}
