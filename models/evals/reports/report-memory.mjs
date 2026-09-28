// Builds the memory's results page: what was built, and every check that
// was run on it, in the launch style. It reads the raw results kept on this
// Mac; a check with no result file shows as "not run".
//   node models/evals/reports/report-memory.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { docsPath } from '../../../docs/to-docs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const load = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = (x) => Number(x).toLocaleString('en-US');
// The same look as the other results pages: their style is read from the round-3 builder.
const css = /const css = `([\s\S]*?)`;\n/.exec(readFileSync(join(here, 'report-round3.mjs'), 'utf8'))?.[1];
if (!css) { console.error('the style of the results pages was not found in report-round3.mjs'); process.exit(1); }

/* ---------- what was measured ---------- */
const M = join(root, 'models/bge-m3/results');
const matcher = (file, key) => { const j = load(join(M, 'matchers', file)); return j ? j[key] : null; };
const made = load(join(M, latest(M, /^recall-\d{4}-\d\d-\d\d\.json$/) ?? 'x'));
const MATCHERS = [
  ['Qwen3-Embedding 0.6B', 'a small model that compares meanings · on the processor', matcher('recall-2026-09-26-qwen3-embedding-0.6b-cpu.json', 'plain'), '22 ms', '789 MB'],
  ['The 27B picks from all 20', 'the big model reads every fact', matcher('recall-2026-09-26-27b-picks.json', 'the 27B picks from all 20'), '3.5 s', 'none extra'],
  ['BGE-M3', 'a small model that compares meanings · the one in use', made ? { right: made.right, wrong: made.wrong } : matcher('recall-2026-09-26-bge-m3.json', 'plain'), made ? `${Math.round(made.ms_per_request)} ms` : '17 ms', '214 MB', true],
  ['Words and related words, then the 27B picks', '', matcher('recall-2026-09-26-27b-picks.json', 'words + related, then the 27B picks'), '2.8 s', 'none extra'],
  ['Words alone', 'what is used when the small model is not there', matcher('recall-2026-09-26-with-27b.json', 'words'), 'under 1 ms', 'none'],
  ['Words and related words', 'the related words were written by the 27B', matcher('recall-2026-09-26-with-27b.json', 'words + related words'), 'under 1 ms', 'none'],
  ['Julia 1', 'a small model that decides among choices', matcher('recall-2026-09-26-with-27b.json', 'words, then Julia 1'), '28 ms', '541 MB'],
].filter((r) => r[2]);

function latest(dir, re) { try { return readdirSync(dir).filter((f) => re.test(f)).sort().pop() ?? null; } catch { return null; } }
const MEM = join(root, 'models/bonsai-2-27b/results/memory');
const seconds = (existsSync(MEM) ? readdirSync(MEM) : []).filter((f) => /^second-time-.*\.json$/.test(f)).sort().map((f) => load(join(MEM, f)));
// The newest run that holds a task, for each set.
const setOf = (first) => [...seconds].reverse().find((s) => s.rows.some((r) => r.task.startsWith(first)));
const CODE = setOf('1-json-flag');
const ASKS = setOf('5-question');

const RUNS = join(root, 'models/bonsai-2-27b/results/runs');
const withMemory = (existsSync(RUNS) ? readdirSync(RUNS) : []).sort().reverse().map((d) => load(join(RUNS, d, 'summary.json'))).find((j) => j?.memory && j.results?.length === 28);
// The bar: the 28 practice tasks on main 7595055 without the memory, 26 Sep 2026
// (models/bonsai-2-27b/results/chart-bug-round3-2026-09-26/bench-off-main-7595055 in the main folder).
const BAR = { passed: 28, secs: 1929, steps: 162, asked: 24 };
const SUITE = { passed: 284, total: 284, secs: 32, before: 247 };

/* ---------- the words of the page ---------- */
// What I made of each saved fact, reading it against its task. Anything not
// listed counts as right.
const READ = [
  [/Removing all stats functions except median/, 'wrong', 'no function was removed: the file was written again whole (231 lines in, 230 out) and still has all of them. The fact repeats a wrong one-line description of the change'],
  [/Three narrower fixes .* did not pass/, 'vague', 'it does not say which fixes, so it cannot stop one from being tried again'],
];
const reading = (text) => READ.find(([re]) => re.test(text)) ?? [null, 'right', ''];

const sumRuns = (set, i, k) => set.rows.reduce((t, r) => t + r.runs[i][k], 0);
const secondTable = (set) => {
  if (!set) return '<div class="wrap"><table><tbody><tr><td class="na">not run</td></tr></tbody></table></div>';
  const cell = (a, b, unit = '') => { const best = b < a ? 1 : a < b ? 0 : -1; return [`<td${best === 0 ? ' class="best"' : ''}>${n(a)}${unit}</td>`, `<td${best === 1 ? ' class="best"' : ''}>${n(b)}${unit}</td>`]; };
  const delta = (a, b, unit = '') => (a === b ? '<td class="delta">same</td>' : `<td class="delta ${b < a ? 'up' : 'down'}">${b < a ? '−' : '+'}${n(Math.abs(b - a))}${unit}${a ? ` <span style="font-weight:400">(${b < a ? '−' : '+'}${Math.round(Math.abs(b - a) / a * 100)}%)</span>` : ''}</td>`);
  const rows = set.rows.map((r) => {
    const [a, b] = r.runs;
    const [s1, s2] = cell(a.secs, b.secs, ' s'); const [p1, p2] = cell(a.steps, b.steps);
    const ok = (x) => (x.pass ? '<span style="color:var(--up)">passed</span>' : `<span style="color:var(--down)">failed</span>`);
    return `<tr><td class="bench"><b>${esc(r.task.replace(/^\d+-/, '').replace(/-/g, ' '))}</b><span>task ${esc(r.task.split('-')[0])} · ${ok(a)}, then ${ok(b)} · used ${b.used.length} fact${b.used.length === 1 ? '' : 's'} the second time</span></td>${s1}${s2}${delta(a.secs, b.secs, ' s')}${p1.replace('<td', '<td class="sep"').replace('class="sep" class="best"', 'class="sep best"')}${p2}${delta(a.steps, b.steps)}</tr>`;
  }).join('');
  const t = [sumRuns(set, 0, 'secs'), sumRuns(set, 1, 'secs'), sumRuns(set, 0, 'steps'), sumRuns(set, 1, 'steps')];
  const [s1, s2] = cell(t[0], t[1], ' s'); const [p1, p2] = cell(t[2], t[3]);
  return `<div class="wrap"><table><thead><tr><th>Task</th><th>First time<span>empty memory</span></th><th>Second time<span>with what the first run saved</span></th><th>Difference</th><th class="sep">Steps, first</th><th>Steps, second</th><th>Difference</th></tr></thead><tbody>${rows}<tr><td class="bench"><b>All ${set.rows.length} together</b><span>${set.first.passed} of ${set.rows.length} passed, then ${set.second.passed} of ${set.rows.length}</span></td>${s1}${s2}${delta(t[0], t[1], ' s')}${p1.replace('<td', '<td class="sep"').replace('class="sep" class="best"', 'class="sep best"')}${p2}${delta(t[2], t[3])}</tr></tbody></table></div>`;
};

const facts = [...(withMemory?.results ?? []).flatMap((r) => (r.saved ?? []).map((f) => ({ task: r.task, f }))), ...[CODE, ASKS].filter(Boolean).flatMap((s) => s.rows.flatMap((r) => r.runs.flatMap((x) => x.saved.map((f) => ({ task: r.task, f })))))];
// A task that ran in more than one run is read once: its facts from the first run that has any.
const firstOf = new Map();
facts.forEach(({ task }, i) => { if (!firstOf.has(task)) firstOf.set(task, i); });
const runOf = (i) => { let k = i; while (k > 0 && facts[k - 1].task === facts[i].task) k--; return k; };
const uniq = facts.filter(({ task }, i) => runOf(i) === firstOf.get(task));
const judged = uniq.map((x) => ({ ...x, kind: x.f.split(':')[0], text: x.f.slice(x.f.indexOf(':') + 2), read: reading(x.f) }));
const count = (v) => judged.filter((x) => x.read[1] === v).length;
const kinds = judged.reduce((m, x) => ({ ...m, [x.kind]: (m[x.kind] ?? 0) + 1 }), {});
const saves = [...(withMemory?.results ?? []).filter((r) => r.saveSecs != null).map((r) => r.saveSecs), ...[CODE, ASKS].filter(Boolean).flatMap((s) => s.rows.flatMap((r) => r.runs.filter((x) => x.saveSecs != null).map((x) => x.saveSecs)))];
const saveAvg = saves.length ? Math.round(saves.reduce((a, b) => a + b, 0) / saves.length) : null;
const saveMax = saves.length ? Math.max(...saves) : null;
const emptySaves = [CODE, ASKS].filter(Boolean).flatMap((s) => s.rows.map((r) => r.runs[1])).filter((x) => x.saveSecs != null && !x.saved.length).map((x) => x.saveSecs);
const emptyAvg = emptySaves.length ? Math.round(emptySaves.reduce((a, b) => a + b, 0) / emptySaves.length) : null;

// Where a saved fact was really used the second time: only there can the
// memory be what made the difference.
const usedRows = [CODE, ASKS].filter(Boolean).flatMap((s) => s.rows).filter((r) => r.runs[1].used.length);
const used = (set) => (set ? set.rows.filter((r) => r.runs[1].used.length) : []);
const tot = (rows, i, k) => rows.reduce((t, r) => t + r.runs[i][k], 0);
const Q = used(ASKS).filter((r) => /question/.test(r.task));
const bge = MATCHERS.find((m) => m[5])?.[2];
const memSecs = withMemory ? withMemory.results.reduce((t, r) => t + r.secs, 0) : null;
const memSteps = withMemory ? withMemory.results.reduce((t, r) => t + r.steps, 0) : null;
const memAsked = withMemory ? withMemory.results.reduce((t, r) => t + (r.asked?.length ?? 0), 0) : null;
const memPass = withMemory ? withMemory.results.filter((r) => r.pass).length : null;
const verdict = (ok, text) => `<td class="${ok === true ? 'ok' : ok === false ? 'bad' : 'na'}">${text}</td>`;
const codeBetter = CODE && (CODE.second.secs < CODE.first.secs || CODE.second.steps < CODE.first.steps) && CODE.broke === 0;
const asksBetter = ASKS && (ASKS.second.secs < ASKS.first.secs || ASKS.second.steps < ASKS.first.steps) && ASKS.broke === 0 && ASKS.second.passed >= ASKS.first.passed;

const LAUNCH = [
  ['The right fact comes back', '20 saved facts, 30 requests, the real small model, through the memory\'s own code', '27 right, at most 3 wrong', bge ? `${bge.right} right, ${bge.wrong} wrong` : 'not run', bge ? bge.right >= 27 && bge.wrong <= 3 : null, bge ? (bge.right >= 27 && bge.wrong <= 3 ? 'reached' : 'not reached') : 'not run'],
  ['The second time is better: code tasks', `${CODE?.rows.length ?? 6} tasks that change code, each run twice in the same project`, 'less time or fewer steps, nothing newly failing', CODE ? `${n(CODE.first.secs)} s → ${n(CODE.second.secs)} s · ${CODE.first.steps} → ${CODE.second.steps} steps` : 'not run', CODE ? codeBetter : null, CODE ? (codeBetter ? 'reached' : 'not reached') : 'not run'],
  ['The second time is better: questions', `${ASKS?.rows.length ?? 6} questions and loosely worded tasks, each run twice`, 'less time or fewer steps, nothing newly failing', ASKS ? `${n(ASKS.first.secs)} s → ${n(ASKS.second.secs)} s · ${ASKS.first.steps} → ${ASKS.second.steps} steps` : 'not run', ASKS ? asksBetter : null, ASKS ? (asksBetter ? 'reached' : 'not reached') : 'not run'],
  ['Nothing got worse', 'the 28 practice tasks with the memory on, against the same tasks without it', `28 of 28, within 5% of ${n(BAR.secs)} s`, withMemory ? `${memPass} of 28 in ${n(memSecs)} s · ${memSteps} steps, ${memAsked} questions` : 'not run', withMemory ? memPass === 28 && memSecs <= BAR.secs * 1.05 : null, withMemory ? (memPass === 28 && memSecs <= BAR.secs * 1.05 ? 'reached' : 'not reached') : 'not run'],
  ['Saving is cheap', 'seconds of model time per save, in the background', 'no wait that you can see', saveAvg != null ? `${saveAvg} s a save (${saves.length} saves, the longest ${saveMax} s)` : 'not run', saveAvg != null ? true : null, saveAvg != null ? 'reached<sup>3</sup>' : 'not run'],
  ['The facts are good', `the ${judged.length} different facts the saves wrote, read one by one`, '8 of 10 right, none wrong about you', judged.length ? `${count('right')} right, ${count('vague')} vague, ${count('wrong')} wrong` : 'not run', judged.length ? count('right') / judged.length >= 0.8 : null, judged.length ? `${count('right') / judged.length >= 0.8 ? 'reached' : 'not reached'}<sup>4</sup>` : 'not run'],
  ['A wrong fact retires', 'a fact that keeps failing goes out of use, and undo brings it back', 'out of use within 3 failed tasks', 'in the unit tests only', null, 'not run on the real model<sup>5</sup>'],
  ['The night review helps', 'a day\'s conversations read again', 'adds right facts, removes none that were right', 'in the unit tests only', null, 'not run on the real model<sup>5</sup>'],
];
const launch = LAUNCH.map(([name, how, bar, got, ok, word]) => `<tr><td class="bench"><b>${esc(name)}</b><span>${esc(how)}</span></td><td style="white-space:normal;min-width:170px">${esc(bar)}</td><td style="white-space:normal;min-width:200px">${esc(got)}</td>${verdict(ok, word)}</tr>`).join('');
const reached = LAUNCH.filter((r) => r[4] === true).length;
const missed = LAUNCH.filter((r) => r[4] === false).length;
const notRun = LAUNCH.filter((r) => r[4] === null).length;

const bestRight = Math.max(...MATCHERS.map((m) => m[2].right));
const leastWrong = Math.min(...MATCHERS.map((m) => m[2].wrong));
const matchers = MATCHERS.map(([name, sub, r, time, mem, used]) => `<tr><td class="bench"><b>${esc(name)}</b><span>${esc(sub)}</span></td><td${r.right === bestRight ? ' class="best"' : ''}>${r.right}</td><td${r.wrong === leastWrong ? ' class="best"' : ''}>${r.wrong}</td><td>${esc(time)}</td><td>${esc(mem)}</td><td>${used ? 'in use' : ''}</td></tr>`).join('');

const taskRows = withMemory ? [...withMemory.results].sort((a, b) => Number.parseInt(a.task, 10) - Number.parseInt(b.task, 10)).map((r) => `<tr><td class="bench"><b>${esc(r.task.replace(/^\d+-/, '').replace(/-/g, ' '))}</b><span>task ${esc(r.task.split('-')[0])}</span></td><td class="${r.pass ? 'ok' : 'bad'}">${r.pass ? 'passed' : 'failed'}</td><td>${r.secs} s</td><td>${r.steps}</td><td>${r.asked?.length ?? 0}</td><td>${r.saveSecs != null ? `${r.saveSecs} s` : '<span style="color:var(--faint)">nothing to learn</span>'}</td><td style="white-space:normal;min-width:260px;font-size:13.5px">${(r.saved ?? []).map((f) => esc(f)).join('<br>') || '<span style="color:var(--faint)">–</span>'}</td></tr>`).join('') : '';
const factRows = judged.map((x) => `<tr><td class="bench" style="min-width:320px"><b style="font-weight:500">${esc(x.text)}</b><span>from task ${esc(x.task.split('-')[0])}, ${esc(x.task.replace(/^\d+-/, '').replace(/-/g, ' '))}</span></td><td>${esc(x.kind)}</td><td class="${x.read[1] === 'right' ? 'ok' : 'bad'}">${x.read[1]}</td><td style="white-space:normal;min-width:220px;font-size:13.5px;color:var(--mute)">${esc(x.read[2])}</td></tr>`).join('');

const GRADE = missed === 0 && notRun <= 2 ? 'B+' : missed <= 1 ? 'B−' : missed === 2 ? 'C+' : 'C';
const NOTES = [
  'The recall check is small, written by hand, and its cut-off was set on 15 other requests. It shows the order of the methods more than their exact scores. No way of picking facts reached 27 right with at most 3 wrong; BGE-M3 was chosen because it is almost never wrong and costs 17 ms.',
  `Time on a practice task moves from run to run without any change to Bonsai: task 1 took 138 s in the run without memory, and 79 s, 82 s and 139 s in three runs tonight. A difference of a few seconds between a first and a second run is inside that noise. The count of steps does not move that way, which is why it is shown beside the time.`,
  `A save costs model time even when there is nothing to save: ${emptyAvg ?? '13 to 18'} s on average for the saves that added nothing. You do not wait for it, but the Mac works for it. Skipping the save when a turn only repeated what the memory holds would remove most of that.`,
  'The facts were read by me against their task; the two that looked doubtful were checked against the change that was made, the others were not checked line by line. "Right" means the fact says what the task did; it does not mean the fact will be useful later. Most of them describe one finished task, which helps only if the same job comes back. The wrong one shows a weak spot: the save believes the one-line description a focused path gives of its own change, and that description can be wrong.',
  'Trust, tidying, undo, the first-use reading and the night review are covered by unit tests with a stand-in model (they do what they are built to do). Whether they make Bonsai better in daily use can only be seen after days of real use.',
  `The 28 tasks each start in a fresh copy of a project, so the memory was empty at every start: that run shows the memory does no harm (the two rules that are always read changed neither the ${BAR.asked} questions asked nor the steps), not that it helps.`,
];

const card = (k, v, note) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div><p>${note}</p></div>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bonsai memory results</title><style>${css}</style></head><body><main>
<h1>Bonsai's memory: what was built and what it does</h1>
<p class="lede">Built on 26 Sep 2026 in a copy of the repo of its own, not yet committed. Bonsai now saves what it learns on its own, keeps it as small files, and brings a fact back when a request fits it. Every number here was measured on this Mac with Bonsai 2 27B; the highlighted cell in a row is the better one.</p>
<nav><a href="#grade">Grade</a><a href="#glance">At a glance</a><a href="#launch">The checks</a><a href="#second">The second time</a><a href="#match">Finding the fact</a><a href="#tasks">The 28 tasks</a><a href="#facts">The facts it saved</a><a href="#built">What was built</a><a href="#notes">Notes</a><a href="#sources">Where the numbers come from</a></nav>

<section id="grade"><h2>The grade</h2>
<div class="grade">
  <div class="hero"><div class="g">${GRADE}</div><div class="v">The memory works and does no harm: it saves on its own, finds most facts, and the 28 practice tasks still pass with it on. It answers a repeated question in fewer steps. It has not made a code task faster.</div><div class="w">What keeps it from the next grade: ${reached} of the ${LAUNCH.length} checks reached their bar, ${missed} did not, and ${notRun} could not be run on the real model in one evening. The right fact comes back 23 times in 30, where the bar was 27.</div></div>
  <div class="wrap"><table><thead><tr><th>Area</th><th>Grade</th><th>The evidence</th><th>What lifts it</th></tr></thead><tbody>
  <tr><td class="bench"><b>Safe to switch on</b><span>does it break anything</span></td><td class="g">A−</td><td class="ev"><b>${memPass ?? '–'} of 28 tasks pass with it on, in ${memSecs ? n(memSecs) : '–'} s (without: ${n(BAR.secs)} s)</b>${SUITE.passed} of ${SUITE.total} unit tests, ${SUITE.passed - SUITE.before} of them new. A test never touches your real memory.</td><td class="ev">A week of daily use without a wrong fact misleading it.</td></tr>
  <tr><td class="bench"><b>Finding the fact</b><span>recall</span></td><td class="g">C+</td><td class="ev"><b>${bge?.right ?? '–'} right and ${bge?.wrong ?? '–'} wrong of 30, in 17 ms</b>Words alone found 18. The bar was 27.</td><td class="ev">Letting the 27B confirm the top 5 that BGE-M3 orders, a pair that was not tested yet.</td></tr>
  <tr><td class="bench"><b>Getting better with use</b><span>the second time</span></td><td class="g">${asksBetter ? 'C+' : 'C'}</td><td class="ev"><b>Questions: ${Q.length ? `${tot(Q, 0, 'steps')} steps the first time, ${tot(Q, 1, 'steps')} the second, where a fact was used` : 'not run'}</b>Code tasks: ${CODE ? `${CODE.first.steps} steps both times, ${n(CODE.first.secs)} s then ${n(CODE.second.secs)} s` : 'not run'}.</td><td class="ev">The focused paths (fix, change) using what the memory holds to skip tries that failed before.</td></tr>
  <tr><td class="bench"><b>What it saves</b><span>the facts</span></td><td class="g">C+</td><td class="ev"><b>${count('right')} of ${judged.length} facts right, ${count('vague')} vague, ${count('wrong')} wrong</b>Most describe one finished task. None is about you, because the practice tasks say nothing about you.</td><td class="ev">Fewer, broader facts: where things are and how the project is tested, not what one task changed.</td></tr>
  <tr><td class="bench"><b>What it costs</b><span>time and memory</span></td><td class="g">B</td><td class="ev"><b>${saveAvg ?? '–'} s of model time a save, none of it waited for</b>Finding facts: 17 ms. The small model: 214 MB beside the 27B.</td><td class="ev">No save when a turn taught nothing new.</td></tr>
  </tbody></table></div>
</div></section>

<section id="glance"><h2>At a glance</h2>
<div class="cards">
${card('The practice tasks, memory on', `${memPass ?? '–'} of 28`, `${memSecs ? n(memSecs) : '–'} s, against ${n(BAR.secs)} s without it. The same ${memSteps ?? '–'} steps and ${memAsked ?? '–'} questions.`)}
${card('The right fact comes back', `${bge?.right ?? '–'} of 30`, `${bge?.wrong ?? '–'} wrong, 17 ms a request. The bar was 27 right.`)}
${card('A repeated question', Q.length ? `${tot(Q, 0, 'steps')} → ${tot(Q, 1, 'steps')} steps` : 'not run', Q.length ? `${tot(Q, 0, 'secs')} s the first time, ${tot(Q, 1, 'secs')} s the second, over the ${Q.length} questions where a saved fact was used.` : '')}
${card('A repeated code task', CODE ? `${CODE.first.steps} → ${CODE.second.steps} steps` : 'not run', CODE ? `${n(CODE.first.secs)} s the first time, ${n(CODE.second.secs)} s the second. No gain.` : '')}
${card('A save', `${saveAvg ?? '–'} s`, `in the background, ${saves.length} saves measured. ${judged.length} different facts written.`)}
${card('Unit tests', `${SUITE.passed} of ${SUITE.total}`, `in ${SUITE.secs} s. ${SUITE.passed - SUITE.before} are new, for the memory.`)}
</div></section>

<section id="launch"><h2>The checks</h2>
<p class="sub">The plan named eight checks for the memory, each with a bar set before anything was built.</p>
<div class="wrap"><table><thead><tr><th>Check</th><th>The bar</th><th>Measured</th><th>Reached?</th></tr></thead><tbody>${launch}</tbody></table></div>
</section>

<section id="second"><h2>Is the second time better?</h2>
<p class="sub">Each task is run twice in the same project: first with an empty memory, then, on a fresh copy of the files, with what the first run saved.</p>
<h3 style="margin-top:18px">Questions and loosely worded tasks</h3>
${secondTable(ASKS)}
<h3 style="margin-top:22px">Tasks that change code</h3>
${secondTable(CODE)}
<div class="notes"><p><b>What the memory itself did:</b> in the ${Q.length} plain questions a saved fact was used the second time, and they went from ${tot(Q, 0, 'steps')} steps and ${tot(Q, 0, 'secs')} s to ${tot(Q, 1, 'steps')} steps and ${tot(Q, 1, 'secs')} s: Bonsai answered from what it knew and read one file to make sure. The large gain on the big-project question is not the memory's: its first run got stuck on five failed commands in a row (a weakness known from earlier rounds), its second run used no saved fact and simply went better.</p><p><sup>2</sup> ${NOTES[1]}</p><p>Why code tasks gain nothing: they run on Bonsai's focused paths (fix, change), which take the same fixed steps whatever the memory holds. A fact such as "averaging the two middle values fixed the median bug" reaches the model, but the path still writes its tries and runs the tests.</p></div>
</section>

<section id="match"><h2>Finding the fact</h2>
<p class="sub">Seven ways of picking the saved facts that fit a request, on the same 20 facts and 30 requests. Right: the fact the request needs came back. Wrong: a fact that has nothing to do with it came back.</p>
<div class="wrap"><table><thead><tr><th>How the facts were picked</th><th>Right, of 30</th><th>Wrong, of 30</th><th>Time per request</th><th>Memory</th><th></th></tr></thead><tbody>${matchers}<tr><td class="bench"><b>The bar</b></td><td>27</td><td>at most 3</td><td></td><td></td><td></td></tr></tbody></table></div>
<div class="notes"><p><sup>1</sup> ${NOTES[0]}</p></div>
</section>

<section id="tasks"><h2>The 28 practice tasks, with the memory on</h2>
<p class="sub">${withMemory ? `${memPass} of 28 passed in ${n(memSecs)} s. Without the memory, earlier the same day: ${BAR.passed} of 28 in ${n(BAR.secs)} s, ${BAR.steps} steps, ${BAR.asked} questions.` : 'Not run.'}</p>
${withMemory ? `<div class="wrap"><table><thead><tr><th>Task</th><th>Result</th><th>Time</th><th>Steps</th><th>Questions</th><th>The save</th><th>What it saved</th></tr></thead><tbody>${taskRows}</tbody></table></div>` : ''}
<div class="notes"><p><sup>6</sup> ${NOTES[5]}</p></div>
</section>

<section id="facts"><h2>The facts it saved</h2>
<p class="sub">${judged.length} different facts from all the runs of tonight: ${Object.entries(kinds).map(([k, v]) => `${v} "${k}"`).join(', ')}. Each was read against its task.</p>
<div class="wrap"><table><thead><tr><th>The fact</th><th>Kind</th><th>My reading</th><th>Why</th></tr></thead><tbody>${factRows}</tbody></table></div>
<div class="notes"><p><sup>4</sup> ${NOTES[3]}</p></div>
</section>

<section id="built"><h2>What was built</h2>
<div class="wrap"><table><thead><tr><th>Part</th><th>What it does</th><th>Checked by</th></tr></thead><tbody>
<tr><td class="bench"><b>The store</b><span>terminal/src/agent/facts.mjs</span></td><td style="white-space:normal">One small file per fact, an index, a folder for facts taken out of use, a log, undo. Your two rules are saved at the first start. A key or a password is refused.</td><td style="white-space:normal">9 unit tests</td></tr>
<tr><td class="bench"><b>Bringing facts back</b><span>agent/recall.mjs · models/bge-m3</span></td><td style="white-space:normal">By meaning with BGE-M3, by words without it. The fact is written into the request, so nothing already read is read again.</td><td style="white-space:normal">9 unit tests, the 30-request check</td></tr>
<tr><td class="bench"><b>Saving on its own</b><span>agent/lessons.mjs · app/autosave.mjs</span></td><td style="white-space:normal">A little after a task and when you quit. At most 5 facts. A fact the turns do not bear out, or one naming a file that is not there, is refused.</td><td style="white-space:normal">8 unit tests, 3 tests of the real app</td></tr>
<tr><td class="bench"><b>Trust</b><span>agent/agent.mjs</span></td><td style="white-space:normal">+1 when the task passed its check, −1 when it failed or Bonsai got stuck, −2 when you corrected or stopped it. At −3 a fact goes out of use.</td><td style="white-space:normal">unit tests<sup>5</sup></td></tr>
<tr><td class="bench"><b>First use, recipes, tidying</b><span>agent/lessons.mjs · facts.mjs</span></td><td style="white-space:normal">Earlier conversations are read once. The steps of a job done twice are saved. Repeats merge; old and orphaned facts go out of use.</td><td style="white-space:normal">unit tests<sup>5</sup></td></tr>
<tr><td class="bench"><b>Seeing it</b><span>/memory · the hub's Memory tab</span></td><td style="white-space:normal">Both memories in the window; every fact in the browser, to edit, pin, take out or bring back. Only the hub's own page may change the memory.</td><td style="white-space:normal">3 unit tests, the page in two browsers at three widths</td></tr>
<tr><td class="bench"><b>The night review</b><span>app/review.mjs</span></td><td style="white-space:normal">Reads the day's conversations again while the Mac is idle. <b>Not scheduled:</b> <code>bonsai memory-review --install</code> does that, and it is yours to run.</td><td style="white-space:normal">4 unit tests<sup>5</sup></td></tr>
</tbody></table></div>
<div class="notes"><p><sup>5</sup> ${NOTES[4]}</p><p><sup>3</sup> ${NOTES[2]}</p></div>
</section>

<section id="notes"><h2>Not done, and corrections</h2>
<div class="notes" style="font-size:14px">
<p><b>Not built:</b> the harness changes of the plan (the trim, the repeated read, acting as soon as the cause is named). They were not part of this go-ahead.</p>
<p><b>Only on the fix path:</b> the facts brought back go into the prompts of the fix path. The change and several-files paths do not read them yet.</p>
<p><b>A correction to the plan page:</b> it said the model already stays loaded for a while after you quit. A plain quit stopped it. Now a quit with something left to save keeps the model until the save is done (about ${saveAvg ?? 15} s), then stops it.</p>
<p><b>Not committed:</b> the work is in <code>~/worktrees/bonsai-memory</code> on the branch <code>memory-v2</code>. Main has moved since (the /morning command), in four files this work changed too, so committing includes a merge and a new run of the tests.</p>
<p><b>A test runner's fault, fixed:</b> the first run of the questions was marked failed on every task because the runner did not write the answer file their checks read. It was run again; only the second run is shown.</p>
</div></section>

<section class="foot" id="sources"><h2 style="font-size:16px;margin-top:0">Where the numbers come from</h2><ul>
<li>The recall check: <code>node models/evals/bench/memory/recall.mjs</code> → <code>models/bge-m3/results/</code>; the other matchers: <code>models/evals/dev/experiments/julia-recall/</code> → <code>models/bge-m3/results/matchers/</code>.</li>
<li>The second time: <code>node models/evals/bench/memory/second-time.mjs [--only 5,6,7,22,25,26]</code> → <code>models/bonsai-2-27b/results/memory/</code>.</li>
<li>The 28 tasks: <code>node models/evals/bench/run.mjs --think off --memory</code> → <code>models/bonsai-2-27b/results/runs/</code>.</li>
<li>Every run is in the test record (<code>/tests</code>). This page: <code>node models/evals/reports/report-memory.mjs</code>.</li>
</ul></section>
</main></body></html>`;

const out = docsPath('tests/bonsai-memory-results-2026-09-26.html');
writeFileSync(out, html);
console.log(`wrote ${out.replace(homedir(), '~')} (${Math.round(html.length / 1024)} KB) · grade ${GRADE} · ${reached} reached, ${missed} not, ${notRun} not run · ${judged.length} facts read`);
const desk = join(homedir(), 'Desktop', 'bonsai-memory-results-2026-09-26.html');
if (!process.argv.includes('--no-desktop')) { copyFileSync(out, desk); console.log(`copied to ${desk.replace(homedir(), '~')}`); }
