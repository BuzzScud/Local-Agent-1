// Check first for a bug on a page (src/flows/pagecheck.mjs): how the page is
// opened, what the browser's findings become, and the whole path against the
// scripted model with a real browser.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { RULES } from '../src/agent/rules.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { canPageCheck, findBrowser, serveFromChecks, serveFromPackage, waysToOpen, groupPairs, layersText, findSpots, spotsText, checkPath, stepsText } from '../src/flows/pagecheck.mjs';
import { checkScript, probeScript } from '../src/flows/pagescripts.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const project = (files) => {
  const d = join(mkdtempSync(join(tmpdir(), 'bonsai-page-')), 'project');
  for (const [rel, text] of Object.entries(files)) { mkdirSync(join(d, rel, '..'), { recursive: true }); writeFileSync(join(d, rel), text); }
  return d;
};

test('only a kind whose main tool is a browser check gets a check made first', () => {
  expect(RULES.kinds.filter(canPageCheck).map((k) => k.name)).toEqual(['Layout']);
  expect(canPageCheck(null)).toBe(false);
});

test('the server to start is read from the comments of the project\'s own page checks', () => {
  const cwd = project({
    'desk/index.html': '<p>hi</p>',
    'desk/tools/devserver.py': 'import os\nPORT = int(os.environ.get("DEV_PORT") or "8790")\n',
    'desk/tools/e2e/a.mjs': "// Runs against the OFFLINE dev desk:\n//\n//     python3 tools/devserver.py                      # in desk, leave it running\n//     node tools/e2e/a.mjs [chromium|webkit] [url]\nimport { webkit } from 'playwright';\n",
    'desk/tools/e2e/b.mjs': "// DEV_PORT=8878 DEV_STATE=/tmp/x.json python3 tools/devserver.py\n// node tools/e2e/b.mjs\nimport { webkit } from 'playwright';\n",
    'desk/tools/e2e/unit.mjs': "// python3 tools/other.py\nimport assert from 'node:assert';\n", // no browser: not a page check
  });
  const files = ['desk/index.html', 'desk/tools/devserver.py', 'desk/tools/e2e/a.mjs', 'desk/tools/e2e/b.mjs', 'desk/tools/e2e/unit.mjs'];
  const way = serveFromChecks(cwd, files.filter((f) => /e2e\/[ab]/.test(f)));
  expect(way.serve).toEqual({ cmd: 'python3 tools/devserver.py', dir: 'desk', portEnv: 'DEV_PORT' });
  expect(way.url).toBe('/');
  const ways = waysToOpen(cwd, 'desk/index.html', files);
  expect(ways.map((w) => (w.serve ? w.serve.cmd : `files:${w.files}`))).toEqual(['python3 tools/devserver.py', 'files:desk']);
  expect(ways.at(-1).url).toBe('/index.html');
  // The project's own word comes first.
  mkdirSync(join(cwd, '.bonsai'));
  writeFileSync(join(cwd, '.bonsai', 'settings.json'), JSON.stringify({ page: { serve: 'node server.mjs', in: 'desk', port: 'PORT', url: '/app/' } }));
  expect(waysToOpen(cwd, 'desk/index.html', files)[0]).toMatchObject({ serve: { cmd: 'node server.mjs', dir: 'desk', portEnv: 'PORT' }, url: '/app/' });
});

test('a dev script serves only its package\'s own front page', () => {
  const cwd = project({ 'package.json': JSON.stringify({ scripts: { dev: 'vite' } }), 'index.html': '', 'docs/guide.html': '', 'site/package.json': JSON.stringify({ scripts: { start: 'node server.js' } }), 'site/public/index.html': '' });
  expect(serveFromPackage(cwd, 'index.html').serve).toEqual({ cmd: 'npx vite --port {port} --strictPort', dir: '.' });
  expect(serveFromPackage(cwd, 'site/public/index.html').serve).toEqual({ cmd: 'npm run start', dir: 'site', portEnv: 'PORT' });
  expect(serveFromPackage(cwd, 'docs/guide.html')).toBe(null);
});

test('the browser is looked for from the page up', () => {
  const cwd = project({ 'node_modules/playwright/package.json': '{}', 'a/b/page.html': '' });
  expect(findBrowser(cwd, 'a/b/page.html')).toBe('.');
  expect(findBrowser(project({ 'page.html': '' }), 'page.html')).toBe(null);
});

const who = (sel, z, rules = [], position = 'absolute') => ({ sel, id: sel.startsWith('#') ? sel.slice(1) : '', classes: sel.startsWith('.') ? [sel.slice(1)] : [], z, position, group: `z-index: ${z}`, rules });
const layers = { shared: '.wrap', a: who('.bar', '2', [{ selector: '.bar', value: '2', sheet: '/style.css' }]), c: who('.legend', '2', [{ selector: '.legend', value: '2', sheet: '/style.css' }]), own: who('#results', '50'), top: who('.legend-row', 'auto', [], 'static'), levelA: 2, levelC: 2, cLater: true };
const found = (by, byText, points) => ({ covered: '#results', coveredText: 'Apple Apricot', fresh: true, coveredBefore: false, by, byText, byBefore: true, points, x: 20, y: 50, layers });

test('what covers something is grouped by its layer, and the report says why in plain words', () => {
  const pairs = groupPairs([found('.legend-row', 'Price 12.00', 4), found('.legend', 'Price 12.00 Stock 4', 9)], ['legend']);
  expect(pairs.length).toBe(1);
  expect(pairs[0]).toMatchObject({ covered: '#results', by: '.legend', byText: 'Price 12.00 Stock 4', points: 13, byBefore: true });
  const text = layersText(pairs[0]);
  expect(text).toContain('#results sits inside .bar, and .legend is its own layer.');
  expect(text).toContain('The browser compares .bar with .legend (both inside .wrap)');
  expect(text).toContain('Same layer: the one later in the page is drawn on top, and that is .legend.');
  expect(text).toContain('The z-index 50 of #results only counts inside .bar.');
  expect(text).toContain('raise the z-index of .bar above 2, or lower the z-index of .legend below 2');
  // A higher layer wins whatever the order.
  expect(layersText({ ...pairs[0], layers: { ...layers, c: who('.legend', '9'), levelC: 9 } })).toContain('.legend is on the higher layer, so it is drawn on top.');
});

test('the lines that set the two layers are found: a one-line rule and a rule over several lines', () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'bonsai-page-')), 'project');
  cpSync(join(import.meta.dir, 'fixture-page'), cwd, { recursive: true });
  const spots = findSpots(cwd, ['index.html', 'style.css', 'package.json'], 'index.html', groupPairs([found('.legend', 'Price', 3)])[0]);
  expect(spots.map((s) => `${s.for} ${s.rel}:${s.line}`)).toEqual(['.bar style.css:3', '.legend style.css:10']);
  const shown = spotsText(cwd, spots, 1);
  expect(shown).toBe('style.css (lines 2-4):\n```\n.wrap { position: relative; height: 400px; }\n.bar { position: absolute; left: 0; right: 0; top: 0; z-index: 2; height: 40px; }\n#search { margin: 8px; width: 220px; }\n```\n\nstyle.css (lines 9-11):\n```\n  position: absolute;\n  z-index: 2;\n  top: 44px;\n```');
});

test('the check goes with the project\'s own page checks, or in a checks folder beside the page', () => {
  const cwd = project({ 'desk/index.html': '', 'desk/tools/e2e/a.mjs': '', 'desk/tools/e2e/sym-menu-on-top.mjs': '' });
  expect(checkPath(cwd, 'desk/index.html', ['desk/tools/e2e/a.mjs'], '#sym-menu')).toBe('desk/tools/e2e/sym-menu-on-top-2.mjs');
  expect(checkPath(cwd, 'desk/index.html', [], '.side > ul:nth-of-type(2)')).toBe('desk/checks/side-ul-nth-of-type-2-on-top.mjs');
  expect(stepsText([])).toBe('opening the page');
  expect(stepsText([{ do: 'click', on: '#a' }, { do: 'type', on: '#b', text: 'GC' }, { do: 'press', on: '#b', text: 'Enter' }])).toBe('click #a, then type "GC" in #b, then press Enter');
});

test('both scripts are valid JavaScript', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bonsai-page-'));
  writeFileSync(join(dir, 'probe.mjs'), probeScript());
  writeFileSync(join(dir, 'check.mjs'), checkScript({ spec: { browser: '.', engines: ['webkit'], size: { width: 800, height: 600 }, files: '.', url: '/index.html', waitFor: [], steps: [], covered: '#a', by: '.b', keep: true }, up: '..', head: ['one', 'two'] }));
  for (const f of ['probe.mjs', 'check.mjs']) expect([f, spawnSync('node', ['--check', join(dir, f)], { encoding: 'utf8' }).stderr]).toEqual([f, '']);
  expect(readFileSync(join(dir, 'check.mjs'), 'utf8')).toStartWith('// one\n// two\nimport');
});

// The whole path needs a real browser: Playwright from a project on this Mac,
// copied into the test project (the fence lets a command read its own
// project, not another one's node_modules).
const PW = [join(homedir(), 'Desktop', 'MAIN2026', 'node_modules')].find((d) => existsSync(join(d, 'playwright', 'package.json')) && existsSync(join(d, 'playwright-core', 'package.json')));
function pageProject() {
  const cwd = join(mkdtempSync(join(tmpdir(), 'bonsai-page-')), 'project');
  cpSync(join(import.meta.dir, 'fixture-page'), cwd, { recursive: true });
  for (const name of ['playwright', 'playwright-core']) {
    mkdirSync(join(cwd, 'node_modules'), { recursive: true });
    if (spawnSync('cp', ['-cR', join(PW, name), join(cwd, 'node_modules', name)]).status !== 0) cpSync(join(PW, name), join(cwd, 'node_modules', name), { recursive: true });
  }
  return cwd;
}
async function run(cwd, prompt, replies, { answer = 'yes' } = {}) {
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'ask', maxTries: 2, checkIns: null,
    ask: async (req) => { events.push({ type: 'ask', name: req.name, req }); return { choice: typeof answer === 'function' ? answer(req) : answer }; } });
  for (const t of ['assistant', 'tool', 'note', 'tries-done', 'route']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reason = await agent.send(prompt);
  await fake.close();
  return { reason, events, agent, fake };
}
const REQUEST = 'In index.html the search list is hidden behind the legend when I type in the search box, fix it';
const STEPS = { text: JSON.stringify({ steps: [{ do: 'type', on: '#search', text: 'ap' }] }) };
const PAIR = { text: JSON.stringify({ pair: '1' }) };
const edit = (from, to) => ({ text: `### style.css\n<<<<<<< OLD\n${from}\n=======\n${to}\n>>>>>>> NEW` });
const BAR = '.bar { position: absolute; left: 0; right: 0; top: 0; z-index: 2; height: 40px; }';

test.skipIf(!PW)('a layout bug: the browser finds what covers what, the check fails, you approve it, the fix is scored by it', async () => {
  const cwd = pageProject();
  const { reason, events, fake } = await run(cwd, REQUEST, [STEPS, PAIR, edit(BAR, BAR.replace('z-index: 2', 'z-index: 1')), edit(BAR, BAR.replace('z-index: 2', 'z-index: 3')), { text: 'Raises the bar above the legend.' }]);
  expect(reason).toBe('done');
  // The page opened as plain files, the steps were done, the covered pair was found.
  const browser = events.filter((e) => e.type === 'tool' && e.label === 'Browser');
  expect(browser.map((e) => e.arg)).toEqual(['open index.html (its folder as plain files)', 'type "ap" in #search']);
  expect(browser[1].view.lines[0]).toStartWith('#results is covered by .legend');
  // You saw the check before anything was changed, then each changed file.
  expect(events.filter((e) => e.type === 'ask').map((e) => e.name)).toEqual(['Test', 'Edit']);
  expect(events.find((e) => e.type === 'ask').req.prepared.rel).toBe('checks/results-on-top.mjs');
  // The tries read what the browser found, and the lines that set the layers.
  const tries = fake.requests.filter((r) => r.stream && /This check fails: node checks\/results-on-top\.mjs/.test(r.messages.at(-1).content));
  expect(tries.length).toBe(2);
  expect(tries[0].messages.at(-1).content).toContain('Same layer: the one later in the page is drawn on top, and that is .legend.');
  expect(tries[0].messages.at(-1).content).toContain('style.css:3');
  expect(tries[0].messages.at(-1).content).toContain('style.css:10');
  expect(tries[0].messages.at(-1).content).not.toContain('const SPEC'); // the check's own code is not shown
  expect(events.find((e) => e.type === 'tries-done').marks).toEqual(['✗', '✓']);
  expect(readFileSync(join(cwd, 'style.css'), 'utf8')).toContain('.bar { position: absolute; left: 0; right: 0; top: 0; z-index: 3; height: 40px; }');
  // The check stays, and passes in the project itself.
  expect(existsSync(join(cwd, 'checks', 'results-on-top.mjs'))).toBe(true);
  expect(events.at(-1).text ?? events.findLast((e) => e.type === 'assistant').text).toMatch(/Fixed style\.css; node checks\/results-on-top\.mjs passes\. The check stays in your project \(checks\/results-on-top\.mjs\)/);
}, 120_000);

test.skipIf(!PW)('a fix that hides the covering thing does not pass, and with no passing try the check and the findings go on step by step', async () => {
  const cwd = pageProject();
  const LEGEND = '  z-index: 2;\n  top: 44px;';
  const { reason, events, fake } = await run(cwd, REQUEST, [STEPS, PAIR,
    edit(LEGEND, '  z-index: 2;\n  display: none;\n  top: 44px;'), // the legend is gone: the check cannot run
    edit(LEGEND, '  z-index: 0;\n  top: 44px;'), // the legend is under the chart: no longer seen
    { text: 'I could not find it.' }]);
  expect(reason).toBe('done');
  expect(events.find((e) => e.type === 'tries-done').marks).toEqual(['✗', '✗']);
  expect(readFileSync(join(cwd, 'style.css'), 'utf8')).toContain('  z-index: 2;\n  top: 44px;');
  expect(events.some((e) => e.type === 'note' && /none of the 2 tries made the check pass.*working step by step instead/.test(e.text))).toBe(true);
  // The approved check is in the project, and the loop is told about it and about what the browser found.
  expect(existsSync(join(cwd, 'checks', 'results-on-top.mjs'))).toBe(true);
  const loop = fake.requests.filter((r) => r.stream).at(-1).messages.find((m) => m.role === 'user' && /A check that shows the bug is in the project now/.test(m.content));
  expect(loop.content).toContain('`node checks/results-on-top.mjs`');
  expect(loop.content).toContain('raise the z-index of .bar above 2');
}, 120_000);

test.skipIf(!PW)('not approving the check changes nothing', async () => {
  const cwd = pageProject();
  const { reason, events } = await run(cwd, REQUEST, [STEPS, PAIR], { answer: 'no' });
  expect(reason).toBe('declined');
  expect(existsSync(join(cwd, 'checks'))).toBe(false);
  expect(events.findLast((e) => e.type === 'assistant').text).toBe('You did not approve the check, so nothing was changed. Say what it should check instead.');
}, 120_000);

test('a project with no browser works step by step, as before', async () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'bonsai-page-')), 'project');
  cpSync(join(import.meta.dir, 'fixture-page'), cwd, { recursive: true });
  const { reason, events } = await run(cwd, REQUEST, [{ text: 'The legend covers the list.' }]);
  expect(reason).toBe('done');
  expect(events.some((e) => e.type === 'note' && /there is no browser to check index\.html with \(Playwright is not installed in this project\); working step by step instead/.test(e.text))).toBe(true);
});
