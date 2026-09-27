// Which facts earn a line on the brief, in plain words. Needs attention: it
// would cost something to leave until tomorrow. Resolved: it closed in the
// last day and a half. Everything else is dropped. Each item names its source
// once, as [[the phrase]] that becomes its link. These plain words are what
// the page shows when the model's words are not used.
import { dayOf, myCommits } from './day.mjs';

const RECENT = 36 * 36e5;
const s = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isBot = (login) => /\[bot\]$|^dependabot|^github-actions/i.test(login ?? '');

export function pick(facts, config = {}) {
  const d = dayOf(facts);
  const now = Date.parse(facts.generated);
  const recent = (iso) => iso && now - Date.parse(iso) < RECENT;
  const mine = myCommits(facts);
  const ignoreDirty = (config.ignoreDirty ?? []).map((p) => p.replace(/^~/, ''));
  const quiet = (path) => ignoreDirty.some((p) => path.replace(/^~/, '').startsWith(p));
  const attention = [], resolved = [];
  const add = (list, item) => list.push({ id: `${list === attention ? 'A' : 'R'}${list.length + 1}`, ...item });

  for (const p of facts.projects) {
    const web = p.remote?.web;
    const owner = p.remote?.owner;

    // What is live
    const dep = p.deploy;
    if (dep && !dep.reachable) {
      add(attention, { project: p.name, title: `The live check couldn't reach ${dep.label}`, text: `Asking the server which commit is live got no answer, so what ${dep.label} runs is unknown.` });
    } else if (dep?.waiting?.length) {
      const oldest = dep.waiting.at(-1);
      add(attention, { project: p.name, href: dep.compare, title: `${s(dep.waiting.length, `${p.name} commit`)} not live`,
        text: `Main is ${s(dep.waiting.length, 'commit')} ahead of ${dep.label} [[on GitHub]], the oldest from ${d.when(oldest.time)}.`,
        facts: dep.waiting.slice(0, 4).map((c) => c.subject) });
    } else if (dep?.reachable && dep.waiting && recent(dep.deployedAt)) {
      add(resolved, { project: p.name, href: web && `${web}/commit/${dep.live}`, sourceHref: /^[\w.-]+\.[a-z]{2,}$/i.test(dep.label) ? `https://${dep.label}` : undefined,
        title: `Everything on ${p.name}'s main is live`, text: `${dep.label} moved to main's newest commit at ${d.when(dep.deployedAt)} [[on ${dep.label}]].` });
    }

    // CI on the default branch
    const run = p.ci?.headRun;
    if (run?.conclusion === 'failure') add(attention, { project: p.name, href: run.url, title: `CI failed on ${p.name}'s main`, text: `The ${run.name} run on ${run.sha} failed [[on GitHub]] at ${d.when(run.created)}.` });
    else if (run?.conclusion === 'success' && recent(run.created)) add(resolved, { project: p.name, href: run.url, title: `CI passed on ${p.name}'s main`, text: `The ${run.name} run on ${run.sha} passed [[on GitHub]] at ${d.when(run.created)}.` });

    // Commits only here, or only on GitHub
    if (p.ahead > 0) add(attention, { project: p.name, title: `${s(p.ahead, `${p.name} commit`)} only on this Mac`, text: `${p.branch} is ${s(p.ahead, 'commit')} ahead of GitHub, so nothing else holds a copy.` });
    if (p.behind > 0) add(attention, { project: p.name, href: web && `${web}/commits/${p.branch}`, title: `GitHub has ${s(p.behind, `newer ${p.name} commit`)}`, text: `Someone pushed to ${p.branch} [[on GitHub]] after this copy last pulled.` });

    // The repo's own test record
    const suite = p.tests?.lastSuite;
    if (suite && recent(suite.at)) {
      if (suite.result === 'pass') add(resolved, { project: p.name, title: `${p.name}'s unit tests passed, ${suite.passed} of ${suite.total}`, text: `The full suite ran at ${d.when(suite.at)} [[in the test record]]${suite.secs ? `, in ${Math.round(suite.secs)} seconds` : ''}.` });
      else add(attention, { project: p.name, title: `${p.name}'s unit tests: ${suite.passed} of ${suite.total}`, text: `The full suite failed at ${d.when(suite.at)} [[in the test record]].` });
    }

    // Pull requests and issues someone else opened or moved in the last two days
    for (const kind of ['pulls', 'issues']) {
      for (const x of p.github?.[kind] ?? []) {
        if (isBot(x.by) || x.by === owner || now - Date.parse(x.updated) > 48 * 36e5) continue;
        add(attention, { project: p.name, href: x.url, title: `${kind === 'pulls' ? 'Pull request' : 'Issue'} #${x.number} on ${p.name}`,
          text: `${x.by} opened “${x.title}” [[on GitHub]] ${d.when(x.created)}.` });
      }
    }

    // Uncommitted changes nobody has touched for half a day
    const trees = [{ where: p.name, path: p.path, dirty: p.dirty }, ...p.worktrees.filter((w) => w.exists).map((w) => ({ where: `${p.name}'s ${w.branch ?? 'detached'} worktree`, path: w.path, dirty: w.dirty }))];
    for (const t of trees) {
      if (!t.dirty?.tracked || quiet(t.path) || !t.dirty.newest || now - Date.parse(t.dirty.newest) < 12 * 36e5) continue;
      add(attention, { project: p.name, title: `${s(t.dirty.tracked, 'uncommitted change')} in ${t.where}`, text: `The files there last changed ${d.when(t.dirty.newest)}, and no commit holds them.` });
    }

    // The day's own pushes
    const day = mine.filter((c) => c.project === p.name);
    if (day.length && day.every((c) => c.pushed)) add(resolved, { project: p.name, href: web && `${web}/commits/${p.defaultBranch}`,
      title: day.length === 1 ? `The day's one ${p.name} commit is on GitHub` : `All ${day.length} of the day's ${p.name} commits are on GitHub`,
      text: `Each one is [[on GitHub]], the last from ${d.when(day.at(-1).time)}.` });
  }
  return { attention: attention.slice(0, 6), resolved: resolved.slice(0, 5) };
}
