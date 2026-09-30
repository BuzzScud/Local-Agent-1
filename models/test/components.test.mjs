// UI component battle (models/evals/bench/design/components.mjs, ▶ Run tests → UI component
// battle): part 1's card pick against a small design folder of its own, the rule that says the
// folder is working, the command parts 2 and 3 start, and the results page with its blind vote,
// from runs saved the way run.mjs saves them. No model.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-components-'));
const DESIGN = join(HOME, 'design examples');
const DOCS = join(HOME, 'docs');
const RECORD = join(HOME, 'record.jsonl');
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
// A design folder of three cards: the rules (always), a widget example, a report (the fallback).
for (const [file, text] of [
  ['your rules/rules.md', '# Rules\n- For: every page\n- Always: yes\n\n## Do\nOne file.\n'],
  ['opus/widget.md', '# Widget\n- For: a small card or widget\n- Words: widget, data card, notification card, media player\n\n## Look\nRounded.\n'],
  ['opus/report.md', '# Report\n- For: a report\n- Words: report\n- Default: yes\n\n## Look\nPlain.\n'],
]) { mkdirSync(join(DESIGN, file, '..'), { recursive: true }); writeFileSync(join(DESIGN, file), text); }
mkdirSync(join(DOCS, 'tests'), { recursive: true });
process.env.AGENTIC_DESIGN_DIR = DESIGN;
const { cardPick, pickWords, RESULTS, PAGE, RULE } = await import('../evals/bench/design/components.mjs');
const { modelSummary, buildBattlePage } = await import('../evals/bench/design/components-page.mjs');
const { readSet } = await import('../evals/bench/design/run.mjs');
const { runCommand, runTestById, componentLines, countLines, findRunTest, runCatalog } = await import('../evals/run-tests.mjs');

const run = (extra, env = {}) => new Promise((ok) => {
  const child = spawn(NODE, [join(REPO, 'models/evals/bench/design/components.mjs'), ...extra], { cwd: REPO, env: { ...process.env, AGENTIC_DESIGN_DIR: DESIGN, AGENTIC_TEST_RECORD: RECORD, AGENTIC_HOME: HOME, ...env } });
  let text = '';
  child.stdout.on('data', (d) => { text += d; }); child.stderr.on('data', (d) => { text += d; });
  child.on('exit', (code) => ok({ code, text }));
});

const REQS = readSet('components');
// One model's runs as run.mjs saves them: problems per request with the folder on and off.
function saved(model, name, { on, off, cards = true, skip = [] }) {
  const dir = join(HOME, 'models', `${model}-folder`, 'results', RESULTS('2026-09-30'));
  const runs = [];
  for (const [arm, probs] of [['full', on], ['today', off]]) REQS.forEach((p, i) => {
    if (skip.includes(`${arm}|${i}`)) return;
    const keep = join(dir, arm, p.id);
    mkdirSync(keep, { recursive: true });
    const made = probs[i] != null;
    if (made) writeFileSync(join(keep, `${p.id}.html`), `<!doctype html><title>${p.id}</title><script>document.title='x'</script><p>${model} ${arm}</p>`);
    runs.push({ at: '2026-09-30T15:00:00.000Z', code: 'abc1234', model, name, effort: 'high', arm, page: p.id, title: p.name, secs: 100 + i, reason: made ? 'done' : 'time',
      file: made ? `models/${model}-folder/results/${RESULTS('2026-09-30')}/${arm}/${p.id}/${p.id}.html` : null,
      problems: made ? Array.from({ length: probs[i] }, (_, n) => `problem ${n + 1}`) : null, shots: {}, layoutNotes: [],
      cards: arm === 'full' && cards ? 'Design examples: your rules/rules + opus/widget (≈120 tokens).' : null });
  });
  writeFileSync(join(dir, 'runs.json'), JSON.stringify(runs));
  writeFileSync(join(dir, 'pick.json'), JSON.stringify({ folder: [{ set: 'your rules', cards: 1 }, { set: 'opus', cards: 2 }], picks: REQS.map((p) => cardPick(p)) }));
  return { dir, runs };
}

test('the list is the three component requests, each with a page name of its own', () => {
  expect(REQS.map((p) => p.id)).toEqual(['data-card', 'notification', 'media-player']);
  expect(REQS.map((p) => p.file)).toEqual(['data-card.html', 'notification.html', 'media-player.html']);
  expect(REQS.every((p) => p.prompt.length > 200 && p.name)).toBe(true);
});

test('part 1: a request passes when it is a page request and an example card fits its words', () => {
  const picks = REQS.map((p) => cardPick(p));
  for (const k of picks) expect(k).toMatchObject({ page: true, rules: ['your rules/rules'], example: 'opus/widget', fits: true, look: null, pass: true, sent: ['your rules/rules', 'opus/widget'] });
  expect(pickWords(picks[0])).toMatch(/^your rules\/rules \+ opus\/widget · [\d,]+ characters$/);
  // A page request none of the cards' words fit gets the fallback card: carried, but not a pass.
  const other = cardPick({ id: 'x', prompt: 'Create a self-contained HTML file for a pricing table with three plans.' });
  expect(other).toMatchObject({ page: true, example: 'opus/report', fits: false, pass: false });
  expect(pickWords(other)).toContain('the fallback card: none fits its words');
  // Not a page request: nothing goes along.
  const code = cardPick({ id: 'y', prompt: 'Fix the off-by-one bug in the parser function in parse.py.' });
  expect(code).toMatchObject({ page: false, pass: false });
  expect(pickWords(code)).toBe('not seen as a page request, so no cards go along');
});

test('the rule: a fitting card for every request, carried on every folder-on run, and no more layout problems with the folder on', () => {
  const picks = REQS.map((p) => cardPick(p));
  const good = saved('gemma', 'Gemma 4 12B QAT', { on: [0, 1, 0], off: [2, 1, 0] });
  expect(modelSummary({ picks, runs: good.runs, requests: REQS })).toMatchObject({ on: { runs: 3, made: 3, clean: 2, problems: 1, carried: 3 }, off: { runs: 3, clean: 1, problems: 3, carried: 0 }, both: 3, onBoth: 1, offBoth: 3, working: true });
  // More problems with the folder on: not working.
  const worse = saved('worse', 'Worse', { on: [2, 1, 0], off: [0, 1, 0] });
  expect(modelSummary({ picks, runs: worse.runs, requests: REQS })).toMatchObject({ noWorse: false, working: false });
  // A folder-on run without its cards: not working, whatever the pages look like.
  const bare = saved('bare', 'Bare', { on: [0, 0, 0], off: [1, 1, 1], cards: false });
  expect(modelSummary({ picks, runs: bare.runs, requests: REQS })).toMatchObject({ carriedAll: false, noWorse: true, working: false });
  // A page that was not made is left out of the problem count on both sides.
  const cut = saved('cut', 'Cut', { on: [0, null, 0], off: [1, 5, 0] });
  expect(modelSummary({ picks, runs: cut.runs, requests: REQS })).toMatchObject({ on: { made: 2, clean: 2 }, both: 2, onBoth: 0, offBoth: 1, working: true });
  // A card pick that failed: not working.
  expect(modelSummary({ picks: picks.map((k, i) => (i ? k : { ...k, pass: false })), runs: good.runs, requests: REQS }).working).toBe(false);
});

test('the page: the verdict, the card pick, and a blind vote whose pictures name no model', () => {
  const g = saved('gemma', 'Gemma 4 12B QAT', { on: [0, 1, 0], off: [2, 1, 0] });
  const q = saved('qwen', 'Qwen3.5 9B', { on: [0, 0, 0], off: [0, 3, null] });
  const html = buildBattlePage({ dirs: [g.dir, q.dir], date: '2026-09-30', requests: REQS, rule: RULE });
  expect(html).toContain('<title>UI component battle</title>');
  expect(html).toContain('<b>Gemma 4 12B QAT</b>: the folder is working.');
  expect(html).toContain('the folder-on pages have 1 layout problem against 3 with it off');
  expect(html).toContain('<b>Qwen3.5 9B</b>: the folder is working.');
  expect(html).toContain('carried, the same cards');
  for (const id of ['verdict', 'pick', 'battle', 'before', 'problems', 'how']) expect(html).toContain(`<section id="${id}"`);
  const data = JSON.parse(/<script type="application\/json" id="data">(.*?)<\/script>/s.exec(html)[1]);
  expect(data.models.map((m) => m.id)).toEqual(['gemma', 'qwen']);
  // A battle for every request both built with the folder on; before/after where a model has both sides.
  expect(data.battle.map((p) => p.req)).toEqual(['data-card', 'notification', 'media-player']);
  for (const p of data.battle) expect(p.sides.map((k) => k.split('|')[0]).sort()).toEqual(['gemma', 'qwen']);
  expect(data.before).toHaveLength(6);
  expect(data.runs['qwen|media-player|off']).toMatchObject({ made: false, problems: null, time: true });
  expect(data.runs['gemma|notification|on']).toMatchObject({ made: true, problems: 1, cards: ['your rules/rules', 'opus/widget'] });
  // The page a model made rides along for "Try it live", and cannot close the data block early.
  expect(data.runs['gemma|data-card|on'].html).toContain("<script>document.title='x'</script>");
  expect(html.split('</script>')).toHaveLength(3);
  // Which side a model is on changes from request to request, and stays put from build to build.
  expect(buildBattlePage({ dirs: [g.dir, q.dir], date: '2026-09-30', requests: REQS, rule: RULE })).toBe(html);
  // Nothing in the static page says which picture is whose: the names come from the vote.
  const body = /<div id="battle-body"><\/div>/.test(html);
  expect(body).toBe(true);
  // One model alone: the page says the battle needs the other.
  const one = buildBattlePage({ dirs: [q.dir], date: '2026-09-30', requests: REQS, rule: RULE });
  expect(one).toContain('needs both models: run the test on Gemma too');
  expect(JSON.parse(/id="data">(.*?)<\/script>/s.exec(one)[1]).battle).toEqual([]);
  expect(buildBattlePage({ dirs: [], date: '2026-09-30', requests: REQS, rule: RULE })).toBe(null);
});

test('the hub can run it: one model a run, three lines a request, thinking as asked', () => {
  const models = ['gemma', 'qwen'];
  const t = runTestById('components');
  expect(t).toMatchObject({ name: 'UI component battle', model: true, think: true });
  expect(componentLines()).toBe(REQS.length * 3);
  const c = runCommand('components', { model: 'qwen', think: true, models });
  expect(c.argv).toEqual(['models/evals/bench/design/components.mjs', '--model', 'qwen', '--think', 'on']);
  expect(c.total).toBe(9);
  expect(runCommand('components', { model: 'gemma', models }).argv.slice(-2)).toEqual(['--think', 'off']);
  expect(runCatalog(models).find((x) => x.id === 'components').total).toBe(9);
  expect(findRunTest('components')?.id).toBe('components');
  expect(findRunTest('ui component battle')?.id).toBe('components');
  expect(countLines(t, ['PASS card pick · data-card · your rules/rules + opus/widget', 'loading the model…', '[1/6] full · data-card … 2:10 · data-card.html · 0 layout problems', 'PASS folder on · data-card · 0 layout problems · 2:10', 'FAIL folder off · data-card · 2 layout problems · 1:40'], 9)).toEqual({ done: 3, passed: 2, total: 9 });
  expect(new RegExp(t.record.name).test('UI component battle')).toBe(true);
});

test('--dry: the card pick, then the one run of both parts, the folder on first', async () => {
  const r = await run(['--model', 'qwen', '--think', 'on', '--dry']);
  expect(r.code).toBe(0);
  const lines = r.text.trim().split('\n');
  expect(lines[0]).toBe('UI component battle on Qwen3.5 9B, thinking at High: 3 requests, three parts');
  expect(lines.filter((l) => l.startsWith('PASS card pick · '))).toHaveLength(3);
  expect(lines.at(-1)).toMatch(/^parts 2 and 3: .*models\/evals\/bench\/design\/run\.mjs --model qwen --set components --arms full,today --pages data-card,notification,media-player --effort high --minutes 10 --out /);
  const picked = await run(['--model', 'gemma', '--only', '2', '--order', 'off,on', '--minutes', '6', '--dry']);
  expect(picked.text).toMatch(/--arms today,full --pages notification --effort low --minutes 6 /);
  expect((await run(['--model', 'gemma', '--order', 'on,on', '--dry'])).code).toBe(2);
  expect((await run(['--model', 'gemma', '--only', '9', '--dry'])).code).toBe(2);
  // No design folder: it refuses before anything else.
  const none = await run(['--model', 'gemma', '--dry'], { AGENTIC_DESIGN_DIR: join(HOME, 'nowhere') });
  expect(none.code).toBe(6); expect(none.text).toContain('the "design examples" folder is missing or empty');
});

test('--page-only: the page of a day again, in the DOCS folder', async () => {
  const home = join(HOME, 'repo');
  const dir = join(home, 'models', 'qwen3.5-9b', 'results', RESULTS('2026-09-30'));
  mkdirSync(dir, { recursive: true });
  const q = saved('qwen', 'Qwen3.5 9B', { on: [0, 0, 0], off: [0, 3, 1] });
  writeFileSync(join(dir, 'runs.json'), readFileSync(join(q.dir, 'runs.json')));
  writeFileSync(join(dir, 'pick.json'), readFileSync(join(q.dir, 'pick.json')));
  const r = await run(['--page-only', '--date', '2026-09-30'], { AGENTIC_REPO: home, AGENTIC_DOCS: DOCS });
  expect(r.text.trim()).toBe(`results page: ${PAGE('2026-09-30')}`);
  expect(readFileSync(join(DOCS, PAGE('2026-09-30')), 'utf8')).toContain('<b>Qwen3.5 9B</b>: the folder is working.');
  expect((await run(['--page-only', '--date', '2026-01-01'], { AGENTIC_REPO: home, AGENTIC_DOCS: DOCS })).text.trim()).toBe('nothing saved for that date yet');
});
