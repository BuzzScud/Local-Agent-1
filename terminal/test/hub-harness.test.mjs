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
import { TOOL_DEFS } from '../src/agent/tools.mjs';

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
    expect(data.tools).toEqual(['Read', 'List', 'Search', 'Edit', 'Write', 'Bash', 'TodoWrite', 'Ask']);
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
  for (const cls of ['diff', 'cmp', 'tasks']) expect(page).toMatch(new RegExp(`<table class="grid ${cls}">(<colgroup>.*?</colgroup>)?<thead><tr><th>[^<]*</th>(<th>#?[^<]*</th>)?<th>Alpha`));
  // A task's row keeps that order: Alpha's cell, then Beta's. Every model's column is one width (a <col> each).
  expect(page).toContain('<th>Fix a big file</th><td class="no"><span class="mark">fail</span><span class="t">14:40</span></td><td class="ok best"><span class="mark">pass</span><span class="t">5:40</span></td>');
  expect(page).toContain('<colgroup><col class="cn"><col><col class="cm"><col class="cm"></colgroup>');
  expect(page).toContain('81 of 82'); expect(page).toContain('80 of 82');
});

test('the verdict is worked out from the run: who was faster, who passed more, what was missed and why, and what to watch', () => {
  const page = harnessPage(harnessData(null, { models: CARDS, settings: SETTINGS, record: RECORD }));
  const verdict = /<section class="card verdict">([\s\S]*?)<\/section>/.exec(page)[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
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
  expect(sp).toContain('<th>Fix a big file</th><td class="ok best"><span class="mark">pass</span><span class="t">14:40</span></td><td class="no"><span class="mark">fail</span><span class="t">5:40</span></td>');
  // The same number on both sides marks neither as better.
  const level = cardsOf(harnessPage(harnessData(null, { models: [CARDS[0], { ...CARDS[1], measured: { read: 120, write: 18 } }], settings: SETTINGS, record: RECORD })));
  expect([level[0].rows[2], level[1].rows[2]]).toEqual([{ label: expect.stringContaining('Reading speed'), best: false, value: '120' }, { label: expect.stringContaining('Reading speed'), best: false, value: '120' }]);
});

test('the words on the page follow the code: the sorter’s own kinds, the tools by name, the limits in use, how often the run was repeated', () => {
  const page = harnessPage(harnessData(null, { models: CARDS, settings: { ...SETTINGS, limits: { ...SETTINGS.limits, steps: 60, tries: 12 } }, record: RECORD }));
  // The kinds are the ones the line under a request names (flows/words.mjs).
  const kinds = ['rename', 'fix', 'change', 'question', 'other'].map((k) => /^Sorted as: (\w+)/.exec(sortLine(k))[1]);
  expect(page).toContain(`Word rules pick the kind: ${kinds.slice(0, -1).join(', ')} or ${kinds.at(-1)}.`);
  for (const t of TOOL_DEFS) expect(page).toContain(t.name === 'TodoWrite' ? 'a to-do list' : t.name === 'Ask' ? 'a question to you' : t.name);
  expect(page).toContain(`the ${TOOL_DEFS.length} tools`);
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
  expect(page).toContain('<col class="cm"><col class="cm"><col class="cm"></colgroup>');
  // "Alpha 12B" and "Alpha 27B" share a first word, so the task tables use their whole names; Beta keeps its short one.
  expect(page).toContain('<th>Alpha 12B<small>min:sec</small></th><th>Beta<small>min:sec</small></th><th>Alpha 27B<small>min:sec</small></th>');
  expect(page).toContain('one of these 3'); expect(page).toContain('The same for every model');
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
});
