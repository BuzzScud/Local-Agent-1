// The hub's Harness tab: one harness, and every model in /model beside the
// others. Nothing on it is typed in by hand: each time the tab opens it reads
// the model list and each settings card, the limits in use, the app's own
// memory sizing, and the newest test the models have in common (the test
// record). A model added to the list shows up here by itself.
//   /harness        the page, drawn here (harness.html holds its styles and its tab keys)
//   /harness.json   the same facts as data
// Every model gets the same card and the same rows, in the same order: the
// page compares them piece against piece, so nothing about one is drawn differently.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import shell from './harness.html' with { type: 'text' };
import { MODELS, DEFAULT_MODEL, MODELS_DIR, needBytes, kvBytesPerToken, hasDraft, sideBySide } from '../../../models/index.mjs';
import { TOOL_DEFS } from '../agent/tools.mjs';
import { loadSettings } from './store.mjs';
import { readLimits } from './limits.mjs';

// What the tab shows, as data. `models` and `record` can be given (a test's own).
export function harnessData(cwd, { models = Object.values(MODELS), settings = loadSettings(cwd), record } = {}) {
  const inUse = models.some((m) => m.id === settings.model) ? settings.model : (models.some((m) => m.id === DEFAULT_MODEL) ? DEFAULT_MODEL : models[0]?.id);
  const limits = readLimits(settings, models.find((m) => m.id === inUse) ?? models[0]);
  // Context "auto" starts at 32k (16k when memory is short): sized as 32k here.
  const ctx = limits.context || 32768;
  const side = record ?? sideBySide(models.map((m) => m.id));
  return {
    made: new Date().toISOString(),
    settings: { model: inUse, effort: settings.effort ?? null, context: ctx, auto: !limits.context, thinkingCap: limits.thinking, steps: limits.steps, tries: limits.tries },
    tools: TOOL_DEFS.map((t) => t.name),
    run: side.run ? { name: side.run.name, at: side.run.at, effort: side.run.effort, ctx: side.run.ctx, thinking: side.run.thinking, limitMins: side.run.limitMins, tasks: side.run.tasks } : null,
    models: models.map((m) => {
      const onMac = existsSync(join(MODELS_DIR, m.file));
      const run = side.run?.models[m.id] ?? null;
      return {
        id: m.id, name: m.name, by: m.by ?? '',
        tags: [m.id === DEFAULT_MODEL ? 'default' : '', m.id === inUse ? 'in use now' : '', onMac ? '' : 'not on this Mac'].filter(Boolean),
        fileGB: +(m.bytes / 1e9).toFixed(2),
        helper: m.draft ? (m.draft.inFile ? { where: 'inside the model file', extraGB: 0 } : { where: 'a separate file', extraGB: +(m.draft.bytes / 1e9).toFixed(2) }) : null,
        kbPerToken: +(kvBytesPerToken(m) / 1000).toFixed(1),
        // The number /effort shows beside Context: what a start takes out of the free memory.
        needGB: +(needBytes(m, ctx, { draft: hasDraft(m) }) / 1e9).toFixed(1),
        sampling: m.sampling ?? null, thinkingSampling: m.thinkingSampling ?? null,
        levels: (m.thinkingLevels ?? []).map((l) => l.label ?? l.id), thinkingBudget: m.thinkingBudget ?? null, maxCtx: m.maxCtx ?? null,
        read: m.measured?.read ?? null,
        // Writing speed from the run they share (the same tasks and settings) when there is one; else the card's own speed test.
        write: run?.write ?? m.measured?.write ?? null, writeFrom: run?.write ? 'run' : (m.measured?.write ? 'card' : null),
        sort: side.sort?.[m.id] ?? null,
        watch: m.watch ?? [],
        run,
      };
    }),
  };
}

// ── the page ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Number(n).toLocaleString('en-US');
const mins = (s) => `${Math.round(s / 60)} min`;
const clock = (s) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`);
const mss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const k = (n) => `${Math.round(n / 1024)}k`;
const samp = (s) => (s ? `${Number(s.temperature).toFixed(1)} · ${s.top_p} · ${s.top_k}` : null);
const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a.join(''));
const NONE = '<span class="none">not run yet</span>';

// Who does a part: one colour each, everywhere on the page.
const WHO = { m: 'model', h: 'harness', u: 'you' };
const dot = (w) => `<i class="dot ${WHO[w]}"></i>`;
const who = (ws, note = {}) => `<span class="who">${ws.map((w) => `<span>${dot(w)}${WHO[w]}${note[w] ? ` <em>${note[w]}</em>` : ''}</span>`).join('')}</span>`;
const LEGEND = `<p class="legend"><span>${dot('m')}the model, the brain (writes the words and code)</span><span>${dot('h')}the harness (the code around it)</span><span>${dot('u')}you</span></p>`;

const STEPS = [
  { name: 'You ask', who: ['u'], text: 'You type a request and press Enter.' },
  { name: 'It sorts', who: ['h', 'm'], note: { m: 'sometimes' }, text: 'Word rules pick the kind: rename, fix, change, several files, question or step by step. The model is asked only when no rule fits.' },
  { name: 'It works', who: ['m', 'h'], text: 'Fix and change take a shortcut built for them. Rename needs no model at all. Everything else goes step by step.' },
  { name: 'It checks', who: ['u', 'h', 'm'], text: 'Before any change it asks for your OK. Afterwards it runs the project’s tests and checks that every part of your request was done.' },
  { name: 'Done', who: ['m', 'h'], text: 'The model writes a sentence on what changed. The harness adds the files it touched and how many tests pass.' },
];
// The tools as the page names them; one added to the app shows under its own name.
const TOOL_WORDS = { TodoWrite: 'a to-do list', Ask: 'a question to you' };

export function harnessPage(d) {
  const M = d.models, S = d.settings, run = d.run;
  const T = run?.tasks.length ?? 0;
  const ran = M.filter((m) => m.run);
  const tools = d.tools.map((t) => TOOL_WORDS[t] ?? t);
  const at = `${k(S.context)}${S.auto ? ' (auto)' : ''}`;
  const tags = (m) => m.tags.map((t) => `<span class="tag${t === 'in use now' ? ' live' : ''}">${t}</span>`).join('');

  // The one that is strictly best in a row gets the mark; a tie marks no one.
  const bestOf = (dir, val) => {
    if (!dir || !val) return null;
    const v = M.map(val); if (v.some((x) => x == null)) return null;
    const top = dir === 'low' ? Math.min(...v) : Math.max(...v);
    return v.filter((x) => x === top).length === 1 ? M[v.indexOf(top)].id : null;
  };
  // A row: [label, which way is good (words), what to show, 'low' | 'high' | null, the number to compare].
  const R = {
    passed: ['Tasks passed', `of ${T} · higher = better`, (m) => (m.run ? `<b>${m.run.passed}</b> of ${T}` : NONE), 'high', (m) => m.run?.passed],
    time: [`Time for the ${T} tasks`, 'lower = faster', (m) => (m.run ? `<b>${mins(m.run.secs)}</b>` : NONE), 'low', (m) => m.run?.secs],
    typical: ['A typical task', 'the middle one · lower = faster', (m) => (m.run ? `<b>${clock(m.run.median)}</b>` : NONE), 'low', (m) => m.run?.median],
    read: ['Reading speed', 'tokens a second · higher = faster', (m) => (m.read ? `<b>${m.read}</b>` : '<span class="none">not measured</span>'), 'high', (m) => m.read],
    write: ['Writing speed', `tokens a second · higher = faster${M.some((m) => m.writeFrom === 'card') ? ' · from each one’s speed test' : ''}`, (m) => (m.write ? `<b>${m.write}</b>` : '<span class="none">not measured</span>'), 'high', (m) => m.write],
    mem: [`Memory a start takes at ${at}`, 'GB · lower = better', (m) => `<b>${m.needGB.toFixed(1)}</b> GB`, 'low', (m) => m.needGB],
    think: ['Thinking it used', `tokens over the ${T} tasks`, (m) => (m.run ? `<b>${num(m.run.thinkTokens)}</b>` : NONE), null],
    calls: ['Times it was asked', `model calls over the ${T} tasks`, (m) => (m.run ? `<b>${num(m.run.modelCalls)}</b>` : NONE), null],
    sampling: ['Its maker’s settings', 'temperature · top-p · top-k', (m) => samp(m.sampling) ?? '<span class="none">the engine’s own</span>', null],
  };
  // Rows that need the shared run are left out while there is none, so no card shows a line of blanks.
  const shown = (rows) => rows.filter((r) => run || ![R.passed, R.time, R.typical, R.think, R.calls].includes(r));
  // The pair: every model in the same card, row for row.
  const pair = (rows, title) => {
    const rs = shown(rows);
    return `<h4 class="pairtitle">${title}</h4><div class="pair" style="--rows:${rs.length};--models:${M.length}">${M.map((m) => `<article class="mc" data-model="${esc(m.id)}">
      <header><b>${esc(m.name)}</b><span class="tags">${tags(m)}</span></header>
      ${rs.map(([label, dir, show, better, val]) => `<div class="row"><span class="k">${label}<small>${dir}</small></span><span class="v${bestOf(better, val) === m.id ? ' best' : ''}">${show(m)}</span></div>`).join('')}
    </article>`).join('')}</div>`;
  };
  // The same rows as a table, one column a model.
  const grid = (cls, head, rows) => `<table class="grid ${cls}"><thead><tr><th>${head}</th>${M.map((m) => `<th>${esc(m.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, dir, show, better, val]) => { const b = bestOf(better, val); return `<tr><th>${label}${dir ? `<small>${dir}</small>` : ''}</th>${M.map((m) => `<td${b === m.id ? ' class="best"' : ''}>${show(m)}</td>`).join('')}</tr>`; }).join('')}</tbody></table>`;

  // ── 1 · the flow
  const steps = `<div class="steps">${STEPS.map((s, i) => `<section class="card step"><h3><span class="n">${i + 1}</span>${s.name}</h3><p>${s.text}</p>${who(s.who, s.note)}</section>${i < STEPS.length - 1 ? '<i class="arr">→</i>' : ''}`).join('')}</div>`;
  const sameLine = `<p class="sameline"><b>The same whichever model is loaded:</b> the ${STEPS.length} steps · the ${tools.length} tools · the 3 safety gates · ${S.steps} steps and ${S.tries} tries at most · your OK before any change. Only one model is loaded at a time on this Mac; <code>/model</code> swaps them.</p>`;
  const flow = `<h2>One request, from start to done</h2><p class="lead">The coloured dots show who does each part. The model only writes. The harness decides what gets written to your files, and when.</p>${LEGEND}${steps}${sameLine}${pair([R.passed, R.time, R.read, R.write, R.mem], M.length > 1 ? `The model in steps 2 to ${STEPS.length} is one of these ${M.length === 2 ? 'two' : M.length}` : `The model in steps 2 to ${STEPS.length}`)}`;

  // ── 2 · step 3
  const li = (w, b, rest) => `<li class="${WHO[w]}">${dot(w)}<span><b>${b}</b> ${rest}</span></li>`;
  const step3 = `<h2>Inside step 3: how the work gets done</h2><p class="lead">Two ways, picked by the sorting step. Both are the same whichever model is loaded.</p>${LEGEND}
  <div class="two"><section class="card"><h3>The shortcut, for fix and change</h3>
    <p class="sub">The model never edits your files. It writes tests and drafts, and the harness keeps only what passes.</p>
    <ol class="chain">
      ${li('m', 'The model writes a test', 'that should fail today and pass once the work is done. For a fix, the project’s own failing test does this job.')}
      ${li('m', 'The model drafts two versions', 'of the change.')}
      ${li('h', 'The harness picks the test the drafts agree with.', 'If no draft passes any test, it stops trusting the tests and goes step by step.')}
      ${li('m', 'The model tries changes until one passes that test:', `up to ${S.tries} tries, each checked by the harness.`)}
      ${li('u', 'You OK it.', '“Before I change anything: change convert.mjs (+1 −1). Go ahead?”')}
      ${li('h', 'The harness writes the change', 'and runs the tests again. A change that removed something you didn’t ask to remove is sent back.')}
    </ol></section>
  <section class="card"><h3>Step by step, for everything else</h3>
    <p class="sub">The model asks for one tool at a time. The harness decides whether it runs.</p>
    <ol class="chain arrows">
      ${li('m', 'The model picks one tool:', `${tools.slice(0, -1).join(', ')}, or ${tools.at(-1)}.`)}
      ${li('h', '3 safety gates.', 'Blocked words (rm -rf, sudo, git push). Your OK. A fence that keeps commands inside the project.')}
      ${li('h', 'The harness runs it', 'and hands the result back to the model.')}
    </ol>
    <p class="round">Round and round, <b>up to ${S.steps} steps</b>. It ends when the model answers instead of asking for a tool. It stops itself if it <b>repeats the same step</b> or hits <b>5 errors in a row</b>.</p></section></div>
  ${pair([R.write, R.think, R.calls, R.sampling], 'What differs at this step')}`;

  // ── 3 · differences
  const diff = grid('diff', 'What differs', [
    ['Made by', '', (m) => esc(m.by) || '—'],
    ['Model file', 'GB on disk', (m) => `${m.fileGB} GB`],
    ['Speed helper', 'guesses the next words', (m) => (m.helper ? (m.helper.extraGB ? `${m.helper.where} (${m.helper.extraGB} GB)` : m.helper.where) : 'none')],
    ['Memory each token takes', 'KB · lower = better', (m) => `${m.kbPerToken} KB`, 'low', (m) => m.kbPerToken],
    [R.mem[0], R.mem[1], (m) => `${m.needGB.toFixed(1)} GB`, 'low', (m) => m.needGB],
    [R.read[0], R.read[1], (m) => m.read ?? 'not measured', 'high', (m) => m.read],
    [R.write[0], R.write[1], (m) => m.write ?? 'not measured', 'high', (m) => m.write],
    ['Its maker’s settings', 'temperature · top-p · top-k', (m) => samp(m.sampling) ?? 'the engine’s own'],
    ['The same, while thinking', 'temperature · top-p · top-k', (m) => samp(m.thinkingSampling) ?? 'the engine’s own'],
    ['Sorting check', 'requests sorted right · higher = better', (m) => (m.sort ? `${m.sort.right} of ${m.sort.total}` : 'not run yet'), 'high', (m) => m.sort?.right],
    ['In /model', '', (m) => m.tags.join(' · ') || 'listed'],
  ]);
  const levels = M[0]?.levels ?? [];
  const budgets = [...new Set(M.map((m) => m.thinkingBudget).filter(Boolean))];
  const longest = [...new Set(M.map((m) => m.maxCtx).filter(Boolean))];
  const SAME = [
    [`The ${STEPS.length} steps`, 'ask, sort, work, check, done'],
    [`The ${tools.length} tools`, tools.join(', ')],
    ['The 3 safety gates', 'blocked words, your OK, the fence around the project'],
    ['The limits', `${S.steps} steps, ${S.tries} tries, stops on a repeated step or 5 errors in a row`],
    ['Thinking', `${levels.join(' or ') || 'on or off'}; a reply thinks up to ${num(S.thinkingCap)} tokens${budgets.length === 1 && budgets[0] !== S.thinkingCap ? ` (your setting; ${num(budgets[0])} as it comes)` : ''}`],
    ['Conversation size', `${at} now${longest.length === 1 ? `; up to ${k(longest[0])}` : ''}`],
  ];
  const differences = `<h2>Where the models differ, and where they don’t</h2><p class="lead">The harness is one set of code. These are the only places the model changes anything. The better number in a row is bold.</p>
  <div class="two wideLeft"><div>${diff}</div><div class="stack">
    <section class="card"><h3>The same for ${M.length === 2 ? 'both' : 'every model'}</h3><dl class="same">${SAME.map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl></section>
    <section class="card"><h3>Where a model plugs in</h3>
      <div class="plug"><div><small>same</small><b>The harness</b><span>every screen, tool and check</span></div><i>→</i><div><small>same</small><b>One door</b><span>the only way to the model side</span></div><i>→</i><div><small>same</small><b>The engine</b><span>your build of llama.cpp</span></div><i>→</i><div class="m"><small>the brain</small><b>${M.map((m) => esc(m.name)).join('<br>or ')}</b><span>one loaded at a time</span></div></div>
      <p class="sub">A model is one settings card and two lines in the model list. One added there shows up on this tab by itself.</p></section>
  </div></div>`;

  // ── 4 · results
  let results;
  if (!run) {
    results = `<h2>The same tasks on every model</h2><p class="lead">Each task is graded by a check the model never sees.</p>
    <section class="card empty"><h3>No test yet that ${M.length === 2 ? 'both models' : 'every model'} ran</h3><p class="sub">Run the same test on each model from the Tests tab (▶ Run tests), with the same settings. The newest one they have in common shows here, task by task.</p></section>`;
  } else {
    const cell = (m, t) => { const r = m.run.tasks[t.id]; const fastest = r.pass && M.every((o) => o === m || !o.run.tasks[t.id].pass || r.secs < o.run.tasks[t.id].secs); return `<td class="${r.pass ? 'ok' : 'no'}${fastest ? ' best' : ''}"><span class="mark">${r.pass ? 'pass' : 'fail'}</span><span class="t">${mss(r.secs)}</span></td>`; };
    const block = (ts) => `<table class="grid tasks"><thead><tr><th>#</th><th>Task</th>${M.map((m) => `<th>${esc(m.name.split(' ')[0])}<small>min:sec</small></th>`).join('')}</tr></thead><tbody>${ts.map((t) => `<tr><td class="num">${t.n || ''}</td><th>${esc(t.title)}</th>${M.map((m) => cell(m, t)).join('')}</tr>`).join('')}</tbody></table>`;
    const half = Math.ceil(T / 2);
    const when = new Date(run.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const setup = `thinking ${run.thinking ? 'on' : 'off'}${run.effort ? ` (${run.effort[0].toUpperCase()}${run.effort.slice(1)})` : ''}${run.ctx ? `, ${k(run.ctx)}` : ''}`;
    // The verdict, worked out from the run: who was faster, who passed more, what each missed.
    const byTime = [...ran].sort((a, b) => a.run.secs - b.run.secs), fast = byTime[0], slow = byTime.at(-1);
    const byPass = [...ran].sort((a, b) => b.run.passed - a.run.passed), top = byPass[0], low = byPass.at(-1);
    const short = (m) => esc(m.name.split(' ')[0]);
    const missed = (m) => { const f = run.tasks.filter((t) => !m.run.tasks[t.id].pass); if (!f.length) return ''; const timed = f.filter((t) => m.run.tasks[t.id].why === 'time'); return `${short(m)} missed ${list(f.map((t) => `task ${t.n || t.id}`))}${timed.length === f.length ? `: ${run.limitMins ? `the ${run.limitMins}-minute limit` : 'out of time'}, not wrong code` : ''}.`; };
    const tie = top.run.passed === low.run.passed;
    const clear = fast !== slow && fast === top && !tie;
    const rowsV = [
      ['Faster', fast === slow ? `<b>${short(fast)}: ${mins(fast.run.secs)}</b> for the ${T} tasks.` : `<b>${short(fast)}, about ${(slow.run.secs / fast.run.secs).toFixed(1)}×.</b> ${mins(fast.run.secs)} against ${mins(slow.run.secs)} for the same ${T} tasks. It thought for ${num(fast.run.thinkTokens)} tokens, ${short(slow)} for ${num(slow.run.thinkTokens)}.`],
      ['Passes more', `${tie ? `<b>The same: ${top.run.passed} of ${T} each.</b>` : `<b>${short(top)}, by ${top.run.passed - low.run.passed}.</b> ${top.run.passed} against ${low.run.passed}.`} ${ran.map(missed).filter(Boolean).join(' ')}`],
      ...(M.some((m) => m.watch.length) ? [['Watch', M.filter((m) => m.watch.length).map((m) => `<b>${short(m)}:</b> ${m.watch.map(esc).join(' ')}`).join(' ') + ` Nothing in the ${T} tasks catches that.`]] : []),
      ['Not tested', `This is one run: ${setup}. Other settings, and page and design work, have not been run on ${M.length === 2 ? 'both' : 'every model'}.`],
      ['So', fast === slow ? 'One model has run this so far.' : clear ? `<b>${short(fast)} for small fixes and features a test can check.</b>${fast.watch.length ? ' Read its “done” yourself where no test can.' : ''}` : tie ? `<b>${short(fast)} when speed matters;</b> they pass the same.` : `<b>No clear winner:</b> ${short(fast)} is faster, ${short(top)} passes more.`],
    ];
    results = `<h2>The same ${T} tasks on ${M.length === 2 ? 'both' : 'every model'}</h2><p class="lead">Each task is graded by a check the model never sees.</p>
    <div class="two wideLeft res"><div><div class="two tasksTwo">${block(run.tasks.slice(0, half))}${block(run.tasks.slice(half))}</div>
      <p class="foot">${esc(run.name)}, ${when}: ${setup}${run.limitMins ? `, ${run.limitMins} minutes a task at most` : ''}. The fastest pass in each row is bold.</p></div>
    <div class="stack"><section class="card"><h3>The totals</h3>${grid('cmp', '', [R.passed, R.time, R.typical])}</section>
      <section class="card verdict"><h3>Which model, when</h3><dl>${rowsV.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl></section></div></div>`;
  }

  // ── 5 · more like Opus 5.5
  const either = M.length > 1 ? 'with either model' : '';
  const OPUS = [
    ['1 · Gets a task', 'You type a request.', 'has', 'has it'],
    ['2 · Thinking at the top setting', `High turns thinking on, up to ${num(S.thinkingCap)} tokens a reply.`, 'done', 'built 28 Sep'],
    ['2 · Room for up to 1 million tokens', `${at} is your setting.${longest.length === 1 ? ` Every model here can go to ${k(longest[0])}.` : ''}`, 'done', 'built 28 Sep'],
    ['2 · A sealed box, safety checks on', 'The fence, blocked words, your OK and your saved /permissions rules.', 'has', 'has it'],
    ['3 · Think, use one tool, read, repeat', `The same loop, up to ${S.steps} steps, plus a shortcut Opus doesn’t have.`, 'has', 'has it'],
    ['4 · Graded by hidden tests', 'The guard: the harness stops trusting a test that no draft can pass.', 'done', 'built 29 Sep'],
    ['5 · Each test run 5 times', run ? `Not yet: the ${T} tasks above were run once on each model.` : 'Not yet: no test has been run on every model.', 'open', 'still open'],
    ['Memory · old parts squeezed', 'When nearly full, the model writes its notes and carries on.', 'has', 'has it'],
    ['When it stops', `It answers, goes in circles, hits ${S.steps} steps, or you press Esc.`, 'has', 'has it'],
    ['Safety net · a backup model', 'None. Only one model fits in this Mac’s memory at a time.', 'skip', 'skip'],
    ['Watchers on every turn', 'None. They would need a second model reading every step.', 'skip', 'skip'],
    ['Teams of agents', 'One model, one step at a time. Two answers at once gained nothing here.', 'skip', 'skip'],
  ];
  const FOUR = [
    ['Score it the way Opus is scored', 'open', 'partly', run ? `The ${T} tasks have been run once on each model. Five runs a task is still to do.` : 'No test has been run on every model yet.'],
    ['A grader the model can’t bend', 'done', 'built', `The guard is in the harness, so it covers ${list(M.map((m) => esc(m.name.split(' ')[0])))} alike.`],
    ['Turn thinking up', 'done', 'built', `High is there for every model.${run?.thinking ? ` The run on the Results tab used it: ${ran.map((m) => `${esc(m.name.split(' ')[0])} ${m.run.passed} of ${T}`).join(', ')}.` : ''}`],
    ['More room to remember', 'done', 'built', `${at} is in use.${M.length === 2 && M[0].kbPerToken !== M[1].kbPerToken ? ` A token costs ${esc(M[0].name.split(' ')[0])} ${M[0].kbPerToken} KB and ${esc(M[1].name.split(' ')[0])} ${M[1].kbPerToken} KB.` : ''}`],
  ];
  const opus = `<h2>More like Opus 5.5: what has been copied</h2><p class="lead">Each row of the Opus 5.5 picture, next to what this harness does today. It is the same for every model, because all of it lives in the harness.</p>
  <div class="two wideLeft"><div><table class="grid opus"><thead><tr><th>Opus 5.5</th><th>This harness today${either ? `, ${either}` : ''}</th><th>Status</th></tr></thead><tbody>${OPUS.map(([a, b, c, label]) => `<tr><th>${a}</th><td>${b}</td><td><span class="st ${c}">${label}</span></td></tr>`).join('')}</tbody></table></div>
  <div class="stack"><section class="card"><h3>The four worth copying: where they stand</h3><ol class="four">${FOUR.map(([a, c, label, b], i) => `<li><span class="n">${i + 1}</span><div><b>${a}</b> <span class="st ${c}">${label}</span><p>${b}</p></div></li>`).join('')}</ol></section></div></div>`;

  const TABS = [['flow', 'The flow', flow], ['step3', 'Step 3', step3], ['differences', 'Differences', differences], ['results', 'Results', results], ['opus', 'More like Opus 5.5', opus]];
  const body = `<div class="top"><h1>The harness</h1><span class="dateline">one set of steps, whichever model is the brain</span><span class="grow"></span><span class="chips">${M.map((m) => `<span class="chip">${dot('m')}${esc(m.name)}${tags(m)}</span>`).join('')}</span></div>
  <nav role="tablist">${TABS.map(([id, name], i) => `<button role="tab" data-v="${id}" aria-selected="${i === 0}">${i + 1} · ${name}</button>`).join('')}</nav>
  ${TABS.map(([id, , html], i) => `<section class="view" data-v="${id}"${i ? ' hidden' : ''}>${html}</section>`).join('\n')}`;
  return shell.replace('<!--harness-->', () => body);
}

const noStore = { 'cache-control': 'no-store' };
export function harnessRoute(url, cwd) {
  if (url.pathname === '/harness.json') return Response.json(harnessData(cwd), { headers: noStore });
  if (url.pathname === '/harness') return new Response(harnessPage(harnessData(cwd)), { headers: { 'content-type': 'text/html; charset=utf-8', ...noStore } });
  return null;
}
