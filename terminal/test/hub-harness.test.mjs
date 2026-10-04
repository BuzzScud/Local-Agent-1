// The hub's Harness tab (src/app/harness-hub.mjs, harness.html): built into
// the hub, drawn from the model list each time it opens, and every model in
// the same card with the same rows.
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWeightsServer } from '../src/app/weights.mjs';
import { harnessData, harnessPage } from '../src/app/harness-hub.mjs';
import { sortLine } from '../src/flows/words.mjs';
import { toolDefs } from '../src/agent/tools.mjs';

// Two made-up settings cards and a run they share: nothing here depends on the models on this Mac.
const card = (id, name, more = {}) => ({ folder: id, id, name, file: `${id}.gguf`, bytes: 6.7e9, attnLayers: 8, kvHeads: 1, headDim: 512, maxCtx: 262144, slots: 2, thinkingLevels: [{ id: 'low', label: 'Low', effort: null }, { id: 'high', label: 'High', effort: 'high' }], thinkingBudget: 4096,
  sampling: { temperature: 1, top_p: 0.95, top_k: 64 }, thinkingSampling: { temperature: 1, top_p: 0.95, top_k: 64 }, measured: { read: 120, write: 17 }, by: 'A maker', ...more });
const CARDS = [card('alpha', 'Alpha 12B'), card('beta', 'Beta 9B <b>', { kvHeads: 2, measured: { read: 190, write: 18 }, draft: { inFile: true, file: 'beta.gguf', bytes: 0, computeBytes: 0, nMax: 1 }, watch: ['Said "done" when it was not.'] })];
const TASKS = [{ id: '1-json-flag', n: 1, title: 'Add a --json flag' }, { id: '21-bigfile', n: 21, title: 'Fix a big file' }, { id: '28-python', n: 28, title: 'A Python change' }];
const ran = (passes, secs, more = {}) => ({ at: '2026-09-30T11:00:00.000Z', page: '', passed: passes.filter(Boolean).length, secs: secs.reduce((a, b) => a + b, 0), median: [...secs].sort((a, b) => a - b)[1], thinkTokens: 5000, modelCalls: 20, write: 15,
  tasks: Object.fromEntries(TASKS.map((t, i) => [t.id, { pass: passes[i], secs: secs[i], why: passes[i] ? '' : 'time' }])), ...more });
const RECORD = { run: { name: 'Prompt old vs new', at: '2026-09-30T11:00:00.000Z', effort: 'high', ctx: 32768, thinking: true, limitMins: 15, reps: 1, tasks: TASKS, models: { alpha: ran([true, false, true], [300, 880, 620]), beta: ran([true, true, true], [200, 340, 360], { thinkTokens: 2000, write: 16.4 }) } },
  sort: { alpha: { right: 81, total: 82 }, beta: { right: 80, total: 82 } } };
const SETTINGS = { model: 'beta', effort: 'high', limits: { context: 65536, thinking: 8192 } };
// One model's card in the page: its rows, as [label, value] with the tags dropped.
const cardsOf = (html) => [...html.matchAll(/<article class="mc" data-model="([^"]+)">([\s\S]*?)<\/article>/g)].map(([, id, body]) => ({ id, rows: [...body.matchAll(/<span class="k">([\s\S]*?)<\/span><span class="v( best)?">([\s\S]*?)<\/span><\/div>/g)].map((m) => ({ label: m[1], best: Boolean(m[2]), value: m[3].replace(/<[^>]+>/g, '') })) }));

test('the hub has a built-in Harness tab: the page is served with its five tabs, every model in /model on it, nothing loaded from outside', async () => {
  const s = startWeightsServer({ path: null, docsDir: null, port: 0, cwd: mkdtempSync(join(tmpdir(), 'agentic-harness-')) });
  try {
    const base = s.url.replace(/\/$/, '');
    const hub = await (await fetch(base + '/')).text();
    expect(hub).toContain('<button data-tab="harness">Harness</button>');
    expect(hub).toContain("if (tab === 'harness' && !page) return show('/harness'");
    expect(hub).toMatch(/const builtIn = [^\n]*t === 'harness'/); // it opens before the DOCS folder is read, and without one
    const r = await fetch(base + '/harness');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(r.headers.get('cache-control')).toBe('no-store'); // read again each time the tab opens
    const page = await r.text();
    expect(page).toContain('<meta charset="utf-8">');
    expect([...page.matchAll(/<button role="tab"/g)].length).toBe(5);
    expect(page).not.toContain('<!--harness-->');
    expect(page).not.toMatch(/(?:src|href)="https?:/);
    expect(page).not.toMatch(/url\(\s*['"]?https?:/);
    const data = await (await fetch(base + '/harness.json')).json();
    expect(data.models.length).toBeGreaterThan(1);
    for (const m of data.models) { expect(page).toContain(`data-model="${m.id}"`); expect(m).toMatchObject({ by: expect.any(String), read: expect.any(Number), kbPerToken: expect.any(Number), needGB: expect.any(Number) }); }
    expect(data.models.filter((m) => m.tags.includes('default'))).toHaveLength(1);
    expect(data.tools).toEqual(['Read', 'List', 'Search', 'Edit', 'Write', 'Bash', 'TodoWrite', 'Ask', 'Jobs']);
    const help = await (await fetch(base + '/help')).text();
    expect(help).toContain("['Harness', 'how a request travels through Agentic Coder, and every model in /model");
  } finally { s.stop(); }
});

test('what the tab shows is read, not typed: the model in use, the limits in use, memory sized at the context in use, speeds, the run they share', () => {
  const d = harnessData(null, { models: CARDS, settings: SETTINGS, record: RECORD });
  expect(d.settings).toMatchObject({ model: 'beta', context: 65536, auto: false, thinkingCap: 8192, steps: 40, tries: 8 });
  expect(d.models.map((m) => m.tags)).toEqual([['not on this Mac'], ['in use now', 'not on this Mac']]); // neither is the registry's default, and neither file is here
  expect(d.models[0]).toMatchObject({ id: 'alpha', by: 'A maker', fileGB: 6.7, helper: null, kbPerToken: 8.7, read: 120, write: 15, writeFrom: 'run', sort: { right: 81, total: 82 }, watch: [] });
  expect(d.models[1]).toMatchObject({ helper: { where: 'inside the model file', extraGB: 0 }, kbPerToken: 17.4, write: 16.4, watch: ['Said "done" when it was not.'] });
  expect(d.models[1].needGB).toBeGreaterThan(d.models[0].needGB); // twice the memory a token at the same context
  expect(d.run).toMatchObject({ name: 'Prompt old vs new', thinking: true, limitMins: 15 });
  // Context on auto is sized as 32k; a setting that names no listed model falls back to the first.
  const auto = harnessData(null, { models: CARDS, settings: { model: 'gone' }, record: { run: null, sort: {} } });
  expect(auto.settings).toMatchObject({ model: 'alpha', context: 32768, auto: true, thinkingCap: 4096 });
  expect(auto.models[0]).toMatchObject({ write: 17, writeFrom: 'card', sort: null, run: null });
  expect(auto.models[0].needGB).toBeLessThan(d.models[0].needGB);
});

test('every model gets the same card: the same rows in the same order on every tab, the better one marked, and names are never read as markup', () => {
  const page = harnessPage(harnessData(null, { models: CARDS, settings: SETTINGS, record: RECORD }));
  const cards = cardsOf(page);
  expect(cards.map((c) => c.id)).toEqual(['alpha', 'beta', 'alpha', 'beta']); // the flow tab's pair, then step 3's
  for (let i = 0; i < cards.length; i += 2) expect(cards[i].rows.map((r) => r.label)).toEqual(cards[i + 1].rows.map((r) => r.label));
  expect(cards[0].rows.map((r) => r.value)).toEqual(['2 of 3', '30 min', '120', '15', expect.stringMatching(/^\d+\.\d GB$/)]);
  expect(cards[1].rows.map((r) => r.value)).toEqual(['3 of 3', '15 min', '190', '16.4', expect.stringMatching(/^\d+\.\d GB$/)]);
  expect(cards[1].rows.map((r) => r.best)).toEqual([true, true, true, true, false]); // Beta: more passed, faster; its tokens cost twice the memory
  expect(cards[0].rows[4].best).toBe(true);
  expect(page).toContain('Beta 9B &lt;b&gt;'); expect(page).not.toContain('Beta 9B <b>');
  // The Differences and Results tables: one column a model, in the same order.
  for (const cls of ['diff', 'cmp', 'tasks']) expect(page).toMatch(new RegExp(`<table class="grid ${cls}">(<colgroup>.*?</colgroup>)?<thead><tr><th>(<span[^>]*>)?[^<]*(</span>)?</th>(<th>#?[^<]*</th>)?<th data-model="alpha">Alpha`));
  // A task's row keeps that order: Alpha's cell, then Beta's. Every model's column is one width (a <col> each).
  expect(page).toContain('<th>Fix a big file</th><td data-model="alpha" class="no"><span class="mark">fail</span><span class="t">14:40</span></td><td data-model="beta" class="ok best"><span class="mark">pass</span><span class="t">5:40</span></td>');
  expect(page).toContain('<colgroup><col class="cn"><col><col class="cm" data-model="alpha"><col class="cm" data-model="beta"></colgroup>');
  expect(page).toContain('81 of 82'); expect(page).toContain('80 of 82');
});

test('the verdict is worked out from the run: who was faster, who passed more, what was missed and why, and what to watch', () => {
  const page = harnessPage(harnessData(null, { models: CARDS, settings: SETTINGS, record: RECORD }));
  const verdict = /<section class="card verdict when-all">([\s\S]*?)<\/section>/.exec(page)[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  expect(verdict).toContain('Faster Beta, about 2.0×. 15 min against 30 min for the same 3 tasks.');
  expect(verdict).toContain('Passes more Beta, by 1. 3 against 2. Alpha missed task 21: the 15-minute limit, not wrong code.');
  expect(verdict).toContain('Watch Beta: Said &quot;done&quot; when it was not.');
  expect(verdict).toContain('thinking on (High), 32k');
  expect(verdict).toContain('So Beta for small fixes and features a test can check.');
  // A tie in passes and no watch note: no winner is made up.
  const even = structuredClone(RECORD); even.run.models.alpha = ran([true, true, true], [300, 880, 620]);
  const tie = harnessPage(harnessData(null, { models: [CARDS[0], { ...CARDS[1], watch: [] }], settings: SETTINGS, record: even }));
  expect(tie).toContain('The same: 3 of 3 each.'); expect(tie).not.toContain('<dt>Watch</dt>'); expect(tie).toContain('they pass the same');
  // A miss that was not the clock is not excused as one.
  const wrong = structuredClone(RECORD); wrong.run.models.alpha.tasks['21-bigfile'].why = 'tests still fail';
  const w = harnessPage(harnessData(null, { models: CARDS, settings: SETTINGS, record: wrong }));
  expect(w).toContain('Alpha missed task 21.'); expect(w).not.toContain('not wrong code');
  // The slower model passing more: no winner is named.
  const split = structuredClone(RECORD); split.run.models.alpha = ran([true, true, true], [300, 880, 620]); split.run.models.beta = ran([true, false, true], [200, 340, 360]);
  const sp = harnessPage(harnessData(null, { models: CARDS, settings: SETTINGS, record: split }));
  expect(sp).toContain('<b>No clear winner:</b> Beta is faster, Alpha passes more.');
  // A quick failure is never the bold one: the slower pass is.
  expect(sp).toContain('<th>Fix a big file</th><td data-model="alpha" class="ok best"><span class="mark">pass</span><span class="t">14:40</span></td><td data-model="beta" class="no"><span class="mark">fail</span><span class="t">5:40</span></td>');
  // The same number on both sides marks neither as better.
  const level = cardsOf(harnessPage(harnessData(null, { models: [CARDS[0], { ...CARDS[1], measured: { read: 120, write: 18 } }], settings: SETTINGS, record: RECORD })));
  expect([level[0].rows[2], level[1].rows[2]]).toEqual([{ label: expect.stringContaining('Reading speed'), best: false, value: '120' }, { label: expect.stringContaining('Reading speed'), best: false, value: '120' }]);
});

test('the words on the page follow the code: the sorter’s own kinds, the tools by name, the limits in use, how often the run was repeated', () => {
  const page = harnessPage(harnessData(null, { models: CARDS, settings: { ...SETTINGS, limits: { ...SETTINGS.limits, steps: 60, tries: 12 } }, record: RECORD }));
  // The kinds are the ones the line under a request names (flows/words.mjs).
  const kinds = ['rename', 'fix', 'change', 'question', 'other'].map((k) => /^Sorted as: (\w+)/.exec(sortLine(k))[1]);
  expect(page).toContain(`Word rules pick the kind: ${kinds.slice(0, -1).join(', ')} or ${kinds.at(-1)}.`);
  // The tools of the way in use (App here), Jobs among them since 3 Oct 2026.
  for (const t of toolDefs('app')) expect(page).toContain(t.name === 'TodoWrite' ? 'a to-do list' : t.name === 'Ask' ? 'a question to you' : t.name);
  expect(page).toContain(`the ${toolDefs('app').length} tools`);
  expect(page).toContain('up to 60 steps'); expect(page).toContain('up to 12 tries'); expect(page).toContain('60 steps and 12 tries at most');
  expect(page).not.toContain('40 steps'); expect(page).not.toContain('8 tries');
  expect(page).toContain('Not yet: the 3 tasks on the Results tab were run once on each model.');
  const five = structuredClone(RECORD); five.run.reps = 5;
  const p5 = harnessPage(harnessData(null, { models: CARDS, settings: SETTINGS, record: five }));
  expect(p5).toContain('were run 5 times on each model.'); expect(p5).not.toContain('still open');
  // What comes from the record is text, never markup.
  const odd = structuredClone(RECORD); odd.run.effort = '<i>x'; odd.run.name = 'A <b>run'; odd.run.tasks[0].title = '<script>';
  const o = harnessPage(harnessData(null, { models: CARDS, settings: SETTINGS, record: odd }));
  expect(o).toContain('(&lt;i&gt;x)'); expect(o).toContain('A &lt;b&gt;run'); expect(o).toContain('&lt;script&gt;'); expect(o).not.toContain('<i>x'); expect(o).not.toContain('<th><script>');
});

test('three models, or two that share a first word: every one still gets the same card and column, and each is told apart by name', () => {
  const third = card('gamma', 'Alpha 27B', { measured: { read: 61, write: 13 } });
  const rec = structuredClone(RECORD); rec.run.models.gamma = ran([true, true, false], [400, 500, 880]); rec.sort.gamma = null;
  const page = harnessPage(harnessData(null, { models: [...CARDS, third], settings: SETTINGS, record: rec }));
  const cards = cardsOf(page);
  expect(cards.map((c) => c.id)).toEqual(['alpha', 'beta', 'gamma', 'alpha', 'beta', 'gamma']);
  for (const c of cards.slice(0, 3)) expect(c.rows.map((r) => r.label)).toEqual(cards[0].rows.map((r) => r.label));
  expect(page).toContain('--models:3'); expect(page).toContain('class="two wideLeft res many"');
  expect(page).toContain('<col class="cm" data-model="alpha"><col class="cm" data-model="beta"><col class="cm" data-model="gamma"></colgroup>');
  // "Alpha 12B" and "Alpha 27B" share a first word, so the task tables use their whole names; Beta keeps its short one.
  expect(page).toContain('<th data-model="alpha">Alpha 12B<small>min:sec</small></th><th data-model="beta">Beta<small>min:sec</small></th><th data-model="gamma">Alpha 27B<small>min:sec</small></th>');
  expect(page).toContain('one of these 3'); expect(page).toContain('The same for every model'); expect(page).toContain('aria-pressed="true">All 3</button>');
  // A tie at the top marks no one: Beta and Alpha 27B both read fastest at 190? No: only Beta does.
  expect(cards[1].rows[2]).toMatchObject({ value: '190', best: true });
  expect(harnessPage(harnessData(null, { models: CARDS, settings: SETTINGS, record: RECORD }))).not.toContain('res many');
});

test('before the models share a run the tab says so: no blank rows, the speeds come from each card, and the Results tab says what to do', () => {
  const page = harnessPage(harnessData(null, { models: CARDS, settings: SETTINGS, record: { run: null, sort: {} } }));
  const cards = cardsOf(page);
  expect(cards[0].rows.map((r) => r.label.replace(/<small>.*/, ''))).toEqual(['Reading speed', 'Writing speed', 'Memory a start takes at 64k']);
  expect(cards[0].rows[2].label).toContain('the model alone, before the search models');
  expect(cards[0].rows.map((r) => r.value).slice(0, 2)).toEqual(['120', '17']);
  expect(page).toContain('from each one’s speed test');
  expect(page).toContain('No test yet that both models ran');
  expect(page).not.toContain('class="grid tasks"');
  expect(page).toContain('not run yet'); // the Sorting check, in Differences
  // One model alone still draws: one card, one column.
  const one = harnessPage(harnessData(null, { models: [CARDS[0]], settings: { model: 'alpha' }, record: { run: null, sort: {} } }));
  expect(cardsOf(one).map((c) => c.id)).toEqual(['alpha', 'alpha']);
  // …and with nothing to choose between, its name is no button and no words wait to be swapped.
  expect(one).not.toContain('data-pick='); expect(one).not.toContain('class="sw" data-both="one set of steps');
});

test('a model added after the run: Results shows the run the others share, names who has not run it, and how to; levels that differ get their own row', () => {
  // Gamma has a Medium level the others lack, and no run.
  const gamma = card('gamma', 'Gamma 7B', { measured: { read: 184, write: 15 }, thinkingLevels: [{ id: 'low', label: 'Low', effort: null }, { id: 'medium', label: 'Medium', effort: 'medium' }, { id: 'high', label: 'High', effort: 'high' }] });
  const d = harnessData(null, { models: [...CARDS, gamma], settings: SETTINGS, record: RECORD });
  expect(d.models.map((m) => Boolean(m.run))).toEqual([true, true, false]);
  const page = harnessPage(d);
  // The task tables: only the two that ran it.
  expect(page).toContain('<col class="cm" data-model="alpha"><col class="cm" data-model="beta"></colgroup>');
  expect(page).not.toContain('<col class="cm" data-model="gamma">');
  expect(page).not.toContain('class="two wideLeft res many"');
  expect(page).toContain('The same 3 tasks on Alpha and Beta');
  // Who is not in it, and how to add them: once for all, and in Gamma's own view.
  expect(page).toContain('<h3>Not in this run</h3><p class="sub">Gamma 7B has not run it yet. Run “Prompt old vs new” on it from the Arena (Who runs it), with the same settings: thinking on (High), 32k.</p>');
  expect(page).toMatch(/data-only="gamma" hidden><h3>How Gamma 7B did<\/h3><dl><div><dt>Not run yet<\/dt>/);
  // The totals keep every column; the best is marked among the ones that ran.
  expect(page).toMatch(/Tasks passed[\s\S]*?not run yet/);
  expect(page).toContain('on each of Alpha and Beta');
  // Three columns in the narrow totals card: the shortest names (as the Arena writes them), so none breaks mid-word.
  expect(page).toContain('<table class="grid cmp"><thead><tr><th></th><th data-model="alpha">Alpha</th><th data-model="beta">Beta</th><th data-model="gamma">Gamma</th>');
  // Low · Medium · High is not the same for every model any more: a row of its own, out of "The same for…".
  expect(page).toContain('Effort levels');
  expect(page).toContain('Low · Medium · High');
  expect(page).toContain('<dt>Thinking</dt><dd>A reply thinks up to 8,192 tokens');
  expect(page).toContain('This harness today, with any model');
  // Two models with the same levels: no extra row, the levels stay in "The same for both".
  const two = harnessPage(harnessData(null, { models: CARDS, settings: SETTINGS, record: RECORD }));
  expect(two).not.toContain('Effort levels'); expect(two).toContain('<dt>Thinking</dt><dd>Low or High; a reply thinks'); expect(two).toContain('with either model');
});

test('a click on a model’s name shows the harness with that model alone: the names are buttons, and everything that is one model’s says whose it is', () => {
  const page = harnessPage(harnessData(null, { models: CARDS, settings: SETTINGS, record: RECORD }));
  // The buttons: one that shows every model (lit to start with), then one a model, with the names the words will use.
  const picks = [...page.matchAll(/<button type="button" class="chip" data-pick="([^"]*)"(?: data-name="([^"]*)" data-short="([^"]*)")? aria-pressed="(true|false)">/g)].map((m) => m.slice(1));
  expect(picks).toEqual([['', undefined, undefined, 'true'], ['alpha', 'Alpha 12B', 'Alpha', 'false'], ['beta', 'Beta 9B &lt;b&gt;', 'Beta', 'false']]);
  expect(page).toContain('>Both</button>');
  // Every card, header cell, cell and column of a model carries its id, as many for one model as for the other.
  const count = (id) => [...page.matchAll(new RegExp(`<(article|th|td|col)[^>]* data-model="${id}"`, 'g'))].length;
  expect(count('alpha')).toBeGreaterThan(20); expect(count('alpha')).toBe(count('beta'));
  // No model's number sits in a cell that does not say whose it is.
  expect([...page.matchAll(/<td(?! data-model)[^>]*>(?:<span class="mark">|\d+ of \d+<)/g)]).toHaveLength(0);
  // The words that change: what they say with every model, and with one ({short} and {name} are filled in by the page).
  const words = Object.fromEntries([...page.matchAll(/<span class="sw" data-both="([^"]*)" data-one="([^"]*)">([^<]*)<\/span>/g)].map((m) => { expect(m[3]).toBe(m[1]); return [m[1], m[2]]; }));
  expect(words).toMatchObject({ 'The model': '{short}', 'the model': '{short}', model: '{short}', 'one set of steps, whichever model is the brain': 'with {name} as the brain',
    'The model writes two tests': '{short} writes two tests', 'What differs': 'What it brings', 'The same 3 tasks on both': '{name} on the 3 tasks', 'This harness today, with either model': 'This harness today, with {name}' });
  for (const one of Object.values(words)) expect(one).not.toMatch(/\bboth\b|the models|either model/i);
  // How each did on its own, hidden until it is picked; the comparison shows only with every model.
  const alone = Object.fromEntries([...page.matchAll(/<section class="card verdict" data-only="(\w+)" hidden>([\s\S]*?)<\/section>/g)].map((m) => [m[1], m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')]));
  expect(alone.alpha).toContain('How Alpha 12B did Passed 2 of 3. It missed task 21: the 15-minute limit, not wrong code. Time 30 min for the 3 tasks. A typical task took 10 min 20 s. Beside the other About 2.0× slower than Beta, and it passed 1 fewer.');
  expect(alone.alpha).not.toContain('Watch');
  expect(alone.beta).toContain('How Beta 9B &lt;b&gt; did Passed 3 of 3. It missed nothing. Time 15 min for the 3 tasks. A typical task took 5 min 40 s. Beside the other About 2.0× faster than Alpha, and it passed 1 more. Watch Said &quot;done&quot; when it was not.');
  expect(page).toContain('<section class="card verdict when-all"><h3>Which model, when</h3>');
  expect(page).toMatch(/<b class="when-all">Alpha 12B<br>or Beta 9B &lt;b&gt;<\/b><b data-only="alpha" hidden>Alpha 12B<\/b><b data-only="beta" hidden>/);
  // The page's script does the swap, keeps the pick in the address and remembers it.
  for (const bit of ["chips.forEach((c) => c.addEventListener('click', () => pick(c.dataset.pick, true)));", "el.hidden = Boolean(picked) && el.dataset.model !== picked", "localStorage.setItem('harness-model', picked)", "'#' + t.dataset.v + (picked ? '/' + picked : '')"]) expect(page).toContain(bit);
});
