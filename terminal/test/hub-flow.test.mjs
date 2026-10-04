// The hub's Flow tab (src/app/flow-hub.mjs, flow.html): built into the hub, drawn
// from the model list and the newest test the models share each time it opens,
// every model with the same parts; the steps it shares with the Harness tab
// (src/app/steps.mjs); and the dated copy scripts/flow-page.mjs saves.
import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { startWeightsServer } from '../src/app/weights.mjs';
import { flowData, flowPage, PATHS } from '../src/app/flow-hub.mjs';
import { harnessData, harnessPage } from '../src/app/harness-hub.mjs';
import { STEPS, STAGES, stepsOf } from '../src/app/steps.mjs';

// Made-up settings cards and a run they share: nothing here depends on the models on this Mac.
const card = (id, name, more = {}) => ({ folder: `${id}-folder`, id, name, file: `${id}.gguf`, bytes: 6.7e9, attnLayers: 8, kvHeads: 1, headDim: 512, maxCtx: 262144, slots: 2, thinkingLevels: [{ id: 'low', label: 'Low', effort: null }, { id: 'high', label: 'High', effort: 'high' }], thinkingBudget: 4096,
  sampling: { temperature: 1, top_p: 0.95, top_k: 64 }, thinkingSampling: { temperature: 1, top_p: 0.95, top_k: 64 }, measured: { read: 120, write: 17 }, by: 'A maker', ...more });
const CARDS = [card('alpha', 'Alpha 12B'), card('beta', 'Beta 9B <b>', { measured: { read: 190, write: 18 } })];
const TASKS = [{ id: '2-fix-bug', n: 2, title: 'Fix the bug' }, { id: '7-question', n: 7, title: 'A question' }, { id: '8-rename', n: 8, title: 'Rename a method' }, { id: '12-feature', n: 12, title: 'Add a feature' }, { id: '19-multifile', n: 19, title: 'Across 3 files' }];
const t = (pass, secs, path, more = {}) => ({ pass, secs, why: pass ? '' : 'time', think: 100, calls: 2, path, thenLoop: false, ...more });
const ran = (tasks, more = {}) => { const all = Object.values(tasks); return { at: '2026-09-30T11:00:00.000Z', page: '', passed: all.filter((x) => x.pass).length, secs: all.reduce((n, x) => n + x.secs, 0), median: 49, thinkTokens: 500, modelCalls: 10, write: 15, tasks, ...more }; };
const steps = (secs) => ({ request: 'The tests fail. Fix <it>.', sorted: 'fix · shortcut', tries: [{ label: 'Trying fixes', marks: '✓', secs }], asked: [{ question: 'Before I change anything: change stats.mjs (+3 −0). Go ahead? Say yes, or tell me what to do instead.', answer: 'yes' }], changed: [{ path: 'stats.mjs', add: 3, del: 0, created: false, test: false }], check: { cmd: 'node --test', ok: true } });
const RUNS = {
  alpha: ran({ '2-fix-bug': t(true, 49, 'fix'), '7-question': t(true, 5, 'loop'), '8-rename': t(true, 0, 'rename'), '12-feature': t(true, 525, 'change', { thenLoop: true }), '19-multifile': t(false, 880, 'multi') }),
  beta: ran({ '2-fix-bug': t(true, 23, 'fix'), '7-question': t(true, 13, 'loop'), '8-rename': t(true, 0, 'rename'), '12-feature': t(true, 101, 'change'), '19-multifile': t(true, 797, 'multi', { thenLoop: true }) }, { write: 16.4 }),
};
const RUN = { name: 'Prompt old vs new', at: '2026-09-30T11:00:00.000Z', effort: 'high', ctx: 32768, thinking: true, limitMins: 15, reps: 1, tasks: TASKS };
const RECORD = { run: { ...RUN, models: RUNS, example: { task: '2-fix-bug', request: 'The tests fail. Fix <it>.', memory: false, models: { alpha: steps(46), beta: steps(21) } } }, sort: { alpha: { right: 81, total: 82 }, beta: { right: 80, total: 82 } } };
const SETTINGS = { model: 'beta', effort: 'high', limits: { context: 65536, thinking: 8192 } };
const NONE = { run: null, sort: {} };
const count = (html, what) => (what instanceof RegExp ? (html.match(what) ?? []).length : html.split(what).length - 1);
// The page without its styles and its script: what a reader sees.
const seen = (html) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script>[\s\S]*?<\/script>/, '');
// One model's twin rows where every model is drawn: [name, value, marked the better one].
const twins = (html, id) => [...html.matchAll(new RegExp(`<g class="tw(?: sm)?( best)?" data-model="${id}">.*?<text class="twn"[^>]*>([^<]*)</text><text class="twv"[^>]*>([^<]*)</text></g>`, 'g'))].map((m) => ({ name: m[2], value: m[3], best: Boolean(m[1]) }));

test('the hub has a built-in Flow page, in the Structure tab: the page is drawn when it opens, with its eight tabs, every model in /model on it, nothing loaded from outside', async () => {
  const s = startWeightsServer({ path: null, docsDir: null, port: 0, cwd: mkdtempSync(join(tmpdir(), 'agentic-flow-')) });
  try {
    const base = s.url.replace(/\/$/, '');
    const hub = await (await fetch(base + '/')).text();
    // Flow is one of the Structure tab's two pages, picked from the menu under that tab (a second click, or its caret); it is no tab of its own.
    expect(hub).not.toContain('data-tab="flow"');
    expect(hub).toContain('<button data-tab="structure" aria-haspopup="menu" aria-expanded="false" title="Structure and Flow: click again for the menu">Structure<i class="caret" aria-hidden="true"></i></button>');
    expect(hub).toMatch(/<div class="menu" id="menu" role="menu" aria-label="Page of the Structure tab" hidden><button type="button" role="menuitemradio" data-view="structure" aria-checked="true">.*<b>Structure<\/b>.*<button type="button" role="menuitemradio" data-view="flow" aria-checked="false">.*<b>Flow<\/b>/);
    expect(hub).toContain("if (tab === 'structure' && view === 'flow') return show('/flow'");
    expect(hub).toContain("if (tab === 'flow') { tab = 'structure'; view = 'flow'; }"); // an old address and `coding hub flow` open it there
    expect(hub).toMatch(/const builtIn = [^\n]*t === 'flow' \|\| \(t === 'structure' && view === 'flow'\)/); // it opens before the DOCS folder is read, and without one
    const r = await fetch(base + '/flow');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(r.headers.get('cache-control')).toBe('no-store'); // read again each time the tab opens
    const page = await r.text();
    expect(page).toContain('<meta charset="utf-8">');
    expect(count(page, '<button role="tab"')).toBe(8);
    expect(page).not.toContain('<!--flow-->');
    expect(page).toContain('aria-label="Agentic Coder: you talk to the terminal (part 1)');
    expect(page).not.toMatch(/(?:src|href)="https?:/);
    expect(page).not.toMatch(/url\(\s*['"]?https?:/);
    expect(seen(page)).not.toMatch(/undefined|NaN|\[object/);
    const data = await (await fetch(base + '/flow.json')).json();
    expect(data.models.length).toBeGreaterThan(1);
    for (const m of data.models) { expect(page).toContain(`data-model="${m.id}"`); expect(page).toContain(`data-pick="${m.id}"`); expect(data.folders[m.id]).toEqual(expect.any(String)); }
    if (data.paths) expect(data.paths.map((p) => p.id)).toEqual(PATHS);
    const help = await (await fetch(base + '/help')).text();
    expect(help).toContain("['Structure', 'two pages behind one tab, picked with the switch beside it. Structure: where every part of Agentic Coder lives (the tab opens on it). Flow: how Agentic Coder works, as a flow diagram in eight tabs");
    expect(help).toContain('every model in /model drawn into it');
    expect(help).not.toContain("['Flow',");
  } finally { s.stop(); }
});

test('what the tab shows is read from the run, not typed: the path each task took, how each model did on it, and one real task step by step', () => {
  const d = flowData(null, { models: CARDS, settings: SETTINGS, record: RECORD });
  expect(d.settings).toMatchObject({ model: 'beta', steps: 40, tries: 8 });
  expect(d.folders).toEqual({ alpha: 'alpha-folder', beta: 'beta-folder' });
  expect(d.paths.map((p) => p.id)).toEqual(['rename', 'fix', 'change', 'multi', 'loop']);
  const by = Object.fromEntries(d.paths.map((p) => [p.id, p.models]));
  expect(by.fix).toEqual({ alpha: { n: 1, passed: 1, secs: 49, thenLoop: 0 }, beta: { n: 1, passed: 1, secs: 23, thenLoop: 0 } });
  expect(by.change.alpha).toEqual({ n: 1, passed: 1, secs: 525, thenLoop: 1 });
  expect(by.multi).toEqual({ alpha: { n: 1, passed: 0, secs: 880, thenLoop: 0 }, beta: { n: 1, passed: 1, secs: 797, thenLoop: 1 } });
  expect(by.rename.beta).toEqual({ n: 1, passed: 1, secs: 0, thenLoop: 0 });
  expect(d.samePath).toBe(5);
  // Every path's tasks add up to the run's own totals.
  for (const m of d.models) { expect(d.paths.reduce((n, p) => n + p.models[m.id].passed, 0)).toBe(m.run.passed); expect(d.paths.reduce((n, p) => n + p.models[m.id].secs, 0)).toBe(m.run.secs); expect(d.paths.reduce((n, p) => n + p.models[m.id].n, 0)).toBe(TASKS.length); }
  expect(d.example).toMatchObject({ task: '2-fix-bug', n: 2, memory: false, models: { alpha: { sorted: 'fix · shortcut', pass: true, secs: 49, calls: 2 }, beta: { secs: 23 } } });
  // The example needs every model's steps: one missing, and there is none.
  expect(flowData(null, { models: CARDS, settings: SETTINGS, record: { ...RECORD, run: { ...RECORD.run, example: { ...RECORD.run.example, models: { alpha: steps(46) } } } } }).example).toBe(null);
  // A task the models took down different paths is counted on each model's own path, and the tab says so.
  const split = flowData(null, { models: CARDS, settings: SETTINGS, record: { ...RECORD, run: { ...RECORD.run, models: { ...RUNS, beta: ran({ ...RUNS.beta.tasks, '2-fix-bug': t(true, 23, 'loop') }) } } } });
  expect(split.samePath).toBe(4);
  expect(Object.fromEntries(split.paths.map((p) => [p.id, [p.models.alpha.n, p.models.beta.n]]))).toMatchObject({ fix: [1, 0], loop: [1, 2] });
  const page = seen(flowPage(split));
  expect(page).toContain('the models took the same path on 4 of the 5 tasks');
  expect(twins(page, 'beta').map((x) => x.value)).toContain('none in this run');
  expect(page).not.toContain('Fix<tspan class="cn">'); // no one count for a lane the models disagree on
});

test('every model gets the same parts: its own box, the same rows in the same places, the better one marked, and names are never read as markup', () => {
  const page = seen(flowPage(flowData(null, { models: CARDS, settings: SETTINGS, record: RECORD })));
  const a = twins(page, 'alpha'), b = twins(page, 'beta');
  expect(a.length).toBeGreaterThan(8);
  expect(a.length).toBe(b.length);
  expect(new Set(a.map((x) => x.name))).toEqual(new Set(['Alpha'])); expect(new Set(b.map((x) => x.name))).toEqual(new Set(['Beta']));
  for (const id of ['alpha', 'beta']) expect(count(page, `data-model="${id}"`)).toBe(count(page, 'data-model="alpha"'));
  for (const id of ['alpha', 'beta']) expect(count(page, `data-only="${id}"`)).toBe(count(page, 'data-only="alpha"'));
  expect(count(page, 'data-only="alpha"')).toBeGreaterThan(8); // each model alone: its box, its example row, its twin rows
  expect(count(page, 'data-only="')).toBe(count(page, /data-only="[^"]*" hidden/g)); // drawn, and out of sight until its model is picked
  // The numbers, in the order the tabs are drawn: sorting, the loop, the five lanes and the loop's two, the bench.
  expect(a.map((x) => x.value)).toEqual(['81 of 82 sorted right', 'writes 15 tokens a second', '1 of 1 · no model', '1 of 1 · 49 s', 'counted under Fix', '1 of 1 · 9 min', '0 of 1 · 15 min', '1 of 1 · 5 s', '1 of 3 tasks', '4 of 5 passed · 24 min']);
  expect(b.map((x) => x.value)).toEqual(['80 of 82 sorted right', 'writes 16.4 tokens a second', '1 of 1 · no model', '1 of 1 · 23 s', 'counted under Fix', '1 of 1 · 2 min', '1 of 1 · 13 min', '1 of 1 · 13 s', '1 of 3 tasks', '5 of 5 passed · 16 min']);
  expect(a.map((x) => x.best)).toEqual([true, false, false, false, false, false, false, true, false, false]); // more sorted right; the quicker on the loop
  expect(b.map((x) => x.best)).toEqual([false, true, false, true, false, true, true, false, false, true]); // level on passes: the quicker one; on several files: the one that passed
  // Each model's box in the big picture, with its tag, and its row of the example.
  expect(page).toMatch(/<g class="node mdl" data-model="alpha"><rect[^>]*\/><text class="h"[^>]*>Alpha 12B<\/text><text class="s dim"[^>]*>not on this Mac<\/text><text class="s "[^>]*>6\.7 GB file<\/text><text class="s "[^>]*>reads 120 · writes 15<\/text>/);
  expect(page).toMatch(/<g class="node mdl live" data-model="beta"><rect[^>]*\/><text class="h"[^>]*>Beta 9B &lt;b&gt;<\/text><text class="s live"[^>]*>in use now · not on this Mac<\/text>/);
  for (const words of ['A REAL REQUEST · TASK 2 OF THE 5 BOTH RAN ON 30 SEP', '“The tests fail. Fix &lt;it&gt;.”', 'sorted as: fix', 'takes the shortcut', 'skipped: the request', 'off in a test run, so', 'Trying fixes ✓', '46 s, in a scratch copy', '21 s, in a scratch copy', 'your OK: stats.mjs +3 −0', 'node --test passes', 'passed in 49 s', 'passed in 23 s', '2 model calls'])
    expect(page).toContain(words);
  expect(page).not.toContain('Beta 9B <b>'); expect(page).not.toContain('Fix <it>');
  expect(page).toContain('both went down the same path on all 5 tasks');
  expect(page).toContain('Fix<tspan class="cn"> · 1 of the 5 tasks</tspan>');
  // The limits and the tools are the app's own.
  expect(page).toContain('up to 40 steps a request'); expect(page).toContain('up to 8, in a scratch copy'); expect(page).toContain('>9 tools<');
  // The names at the top are buttons: all of them first, then one a model, as on the Harness tab.
  expect(page).toMatch(/<button type="button" class="chip" data-pick="" aria-pressed="true">Both<\/button><button type="button" class="chip" data-pick="alpha" data-name="Alpha 12B" data-short="Alpha" aria-pressed="false">/);
  expect(page).toContain('data-name="Beta 9B &lt;b&gt;" data-short="Beta"');
  expect(page).toContain('data-both="Every model in /model has its own box" data-one="{name} is the model drawn here"');
  expect(page).not.toMatch(/undefined|NaN|\[object/);
});

test('with no run in common the drawings stay and say what to run; a run from before the paths were kept shows its totals only', () => {
  const d = flowData(null, { models: CARDS, settings: SETTINGS, record: NONE });
  expect(d).toMatchObject({ run: null, paths: null, samePath: null, example: null });
  const page = seen(flowPage(d));
  expect(count(page, '<button role="tab"')).toBe(8);
  expect(page).toContain('No test yet that both models ran. Run the same test on each model from the Arena, with the same settings.');
  expect(twins(page, 'alpha').map((x) => x.value)).toEqual(['writes 17 tokens a second']); // the card's own speed test; no run, no lane numbers
  expect(page).not.toContain('A REAL REQUEST');
  expect(page).not.toMatch(/undefined|NaN|\[object|not run yet/);
  // One model has a Sorting check, the other not yet.
  expect(twins(seen(flowPage(flowData(null, { models: CARDS, settings: SETTINGS, record: { run: null, sort: { alpha: { right: 81, total: 82 }, beta: null } } }))), 'beta')[0].value).toBe('not run yet');
  // An older run: tasks with no path.
  const bare = (tasks) => Object.fromEntries(Object.entries(tasks).map(([id, x]) => [id, { ...x, path: null, thenLoop: false }]));
  const old = flowData(null, { models: CARDS, settings: SETTINGS, record: { run: { ...RUN, models: { alpha: ran(bare(RUNS.alpha.tasks)), beta: ran(bare(RUNS.beta.tasks)) }, example: null }, sort: {} } });
  expect(old).toMatchObject({ paths: null, samePath: null, example: null });
  const oldPage = seen(flowPage(old));
  expect(twins(oldPage, 'alpha').map((x) => x.value)).toEqual(['writes 15 tokens a second', '4 of 5 passed · 24 min']);
  expect(oldPage).toContain('from before the paths were kept');
  expect(oldPage).toContain('No task of the run of 30 Sep fits as an example here');
  expect(oldPage).not.toMatch(/undefined|NaN|\[object/);
});

test('one model alone has no buttons and nothing to swap; a third model gets the same parts as the others', () => {
  const one = seen(flowPage(flowData(null, { models: [CARDS[0]], settings: { model: 'alpha' }, record: { run: { ...RUN, models: { alpha: RUNS.alpha }, example: { ...RECORD.run.example, models: { alpha: steps(46) } } }, sort: {} } })));
  expect(one).not.toContain('data-pick'); expect(one).not.toContain('data-only'); expect(one).not.toContain('when-all'); expect(one).not.toContain('class="sw"');
  expect(one).toContain('<span class="chip"><i class="dot"></i>Alpha 12B');
  expect(twins(one, 'alpha').map((x) => x.best).some(Boolean)).toBe(false); // no one to be better than
  expect(one).toContain('A REAL REQUEST · TASK 2 OF THE 5 ON 30 SEP');
  expect(one).not.toMatch(/undefined|NaN|\[object/);
  const three = [...CARDS, card('gamma', 'Gamma 7B')];
  const d = flowData(null, { models: three, settings: SETTINGS, record: { run: { ...RUN, models: { ...RUNS, gamma: ran(RUNS.beta.tasks) }, example: { ...RECORD.run.example, models: { alpha: steps(46), beta: steps(21), gamma: steps(30) } } }, sort: {} } });
  const page = seen(flowPage(d));
  expect(page).toContain('aria-pressed="true">All 3</button>');
  const n = twins(page, 'alpha').length;
  expect(n).toBeGreaterThan(8);
  for (const id of ['beta', 'gamma']) { expect(twins(page, id).length).toBe(n); expect(count(page, `data-model="${id}"`)).toBe(count(page, 'data-model="alpha"')); expect(count(page, `data-only="${id}"`)).toBe(count(page, 'data-only="alpha"')); }
  expect(page).toContain('every model went down the same path on all 5 tasks');
  expect(page).not.toMatch(/undefined|NaN|\[object/);
});

test('one list of steps for the hub: the Flow tab draws all of them, the Harness tab tells them as its stages, and the two cannot disagree', () => {
  const stages = STAGES.map((g) => g.id);
  expect(new Set(stages).size).toBe(stages.length);
  for (const s of STEPS) expect(stages).toContain(s.stage);
  for (const g of STAGES) {
    expect(stepsOf(g.id).length).toBeGreaterThan(0);
    // A stage says "the model" exactly when one of its steps can call the model.
    expect(g.who.includes('m')).toBe(stepsOf(g.id).some((s) => s.model));
  }
  // The steps keep the order of their stages: no stage is split around another.
  expect(STEPS.map((s) => stages.indexOf(s.stage))).toEqual([...STEPS.map((s) => stages.indexOf(s.stage))].sort((x, y) => x - y));
  const flow = seen(flowPage(flowData(null, { models: CARDS, settings: SETTINGS, record: RECORD })));
  const harness = seen(harnessPage(harnessData(null, { models: CARDS, settings: SETTINGS, record: RECORD })));
  STEPS.forEach((s, i) => expect(flow).toContain(`>${i + 1} · ${s.name}</text>`));
  expect(count(flow, '<g class="stage">')).toBe(STAGES.length);
  STAGES.forEach((g, i) => { expect(flow).toMatch(new RegExp(`<g class="stage"><path[^>]*/><text[^>]*>${g.name}</text></g>`)); expect(harness).toContain(`<h3><span class="n">${i + 1}</span>${g.name}</h3>`); });
  expect(count(harness, '<section class="card step">')).toBe(STAGES.length);
  // Each page says how its count meets the other's, from the same list.
  expect(harness).toContain(`The Flow page, beside Structure, draws these ${STAGES.length} as ${STEPS.length} steps: “It sorts” is Sort and Ask; “It works” is Recall and Work.`);
  expect(flow).toContain(`${STEPS.length} steps from your Enter key to “done”. The line over them is the Harness tab’s ${STAGES.length}: “It sorts” is Sort and Ask; “It works” is Recall and Work.`);
  // The amber dot on a step's box: the steps that can call the model, no others, each on its own box.
  STEPS.forEach((s, i) => expect(flow.match(new RegExp(`<g class="node [^"]*"><rect[^>]*/><text class="h"[^>]*>${i + 1} · ${s.name}</text>.*?</g>`))[0].includes('<circle class="dotm"')).toBe(s.model));
  expect(count(flow.match(/<svg[^>]*aria-label="The \d+ steps[\s\S]*?<\/svg>/)[0].split('A REAL REQUEST')[0], '<circle class="dotm"')).toBe(STEPS.filter((s) => s.model).length);
});

test('scripts/flow-page.mjs saves a dated copy of the tab: one file that stands alone and names no folder of this Mac', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-flow-')), out = join(dir, 'flow.html');
  // A throwaway home: no test record, so the copy is the drawings without a run's numbers.
  const r = spawnSync(process.execPath, [join(import.meta.dir, '..', 'scripts', 'flow-page.mjs'), out], { encoding: 'utf8', env: { ...process.env, AGENTIC_HOME: join(dir, 'home') } });
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
  const page = readFileSync(out, 'utf8');
  expect(page).toContain('<meta charset="utf-8">');
  expect(page).toMatch(/ · saved \d{1,2} \w{3} \d{4}<\/span>/);
  expect(count(page, '<button role="tab"')).toBe(8);
  expect(page).not.toMatch(/(?:src|href)="https?:/);
  expect(page).not.toContain(homedir());
  expect(page).not.toContain('fetch(');
});
