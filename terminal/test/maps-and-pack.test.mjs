// The code maps and the pack of Claude's notes (3 Oct 2026): one shape for both (src/agent/ladder.mjs),
// the pack built from Claude's memory folders and a copy (claude-pack.mjs), a project's docs/map
// (tools/codemap.mjs), and what each model is given of them: the opening read on a service, a step of
// its own on this Mac, Map with a part, Read NOTES/…, and only the notes about the project on a
// service that is not the owner's own (Memory sent).
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-maps-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { buildPack, packView, packState, projectName, sameProject, nowPart, datesIn, findSources } = await import('../src/agent/claude-pack.mjs');
const { fitLines, partsOf, openPart, nearestPart, splitPart, mapRoom, readLadder, PART_CHARS } = await import('../src/agent/ladder.mjs');
const { mapTree, writeMap, checkMap, parseLabels, fileCard, codeLine, lineFor, folderCard, folderHash, labelRequest } = await import('../src/tools/codemap.mjs');
const { recallClaude, notesDir, claudeText } = await import('../src/agent/claude-notes.mjs');
const { mapsRead, openingRead } = await import('../src/agent/opening.mjs');
const { execute, prepare } = await import('../src/agent/tools.mjs');
const { repoMap } = await import('../src/tools/repomap.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL, remoteModel } = await import('../../models/index.mjs');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const note = (name, description, type, body) => `---\nname: ${name}\ndescription: "${description}"\nmetadata:\n  type: ${type}\n---\n\n${body}\n`;
const write = (dir, files) => { mkdirSync(dir, { recursive: true }); for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t); return dir; };
// A long note: an opening, then a part a day from 1 to 30 Sep, each about 400 characters, then How to apply.
const longBody = () => `**Now: the desk runs from MAIN2026/desks/ladder on :17391.** The old copy is frozen.\n\n${Array.from({ length: 30 }, (_, i) => `**Round ${i + 1} (2026-09-${String(i + 1).padStart(2, '0')}):** ${'the fit was changed and measured again with the same tape, '.repeat(6)}`).join('\n\n')}\n\n**How to apply:** change it in desks/ladder and run its tests.`;

// A home folder with Claude Code's memory (this Mac's) and a copy taken on another Mac.
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'agentic-pack-'));
  const home = join(base, 'home');
  const slug = home.replace(/[/.]/g, '-');
  write(join(home, '.claude', 'projects', slug, 'memory'), {
    'MEMORY.md': '- [Plain words](plain-words.md)\n- [Remote harness](remote-harness.md)\n',
    'plain-words.md': note('plain-words', 'Explain in plain words, the result first (this Mac)', 'feedback', 'Lead with the result.'),
    'remote-harness.md': note('remote-harness', 'What was measured on the remote Qwen service', 'project', 'Cache numbers for the service.'),
  });
  write(join(home, '.claude', 'projects', `${slug}-Downloads-MAIN2026-main`, 'memory'), {
    'MEMORY.md': '- [Live port](live-port.md)\n',
    'live-port.md': note('live-port', 'The local Postgres for the distribution work is on port 5434', 'project', 'Port 5434, not 5432.'),
  });
  const copy = join(base, 'Claude memory 2026-10-03', 'originals');
  write(join(copy, '1 home memory'), {
    'MEMORY.md': '# Working style (feedback)\n- [Plain words](plain-words.md) · [Questions in the UI](questions-in-ui.md)\n\n# Equity Orbit (MAIN2026) — deploy & layout\n- [Ladder (START HERE)](ladder-app.md)\n- [Droplet](equity-droplet.md)\n\n# Studies\n- [Fourier](fourier.md)\n',
    'plain-words.md': note('plain-words', 'Explain in plain words (the copy)', 'feedback', 'The copy\'s text.'),
    'questions-in-ui.md': note('questions-in-ui', 'Ask clarifying questions in the question UI, not as text', 'feedback', 'Use the picker. See [[fourier]].'),
    'ladder-app.md': note('ladder-app', 'The Ladder app: the live copy is MAIN2026/desks/ladder', 'project', longBody()),
    'equity-droplet.md': note('equity-droplet', 'Where the site runs and how a deploy is done', 'reference', 'Run the deploy script.'),
    'ollama-secret-keys.md': note('ollama-secret-keys', 'Keys for the service', 'reference', 'none here'),
    'fourier.md': note('fourier', 'Fourier waves made the projection worse', 'project', 'Worse on every symbol.\nThe password is hunter2-secret-123\nMeasured on 1 Oct.'),
    'unlisted-orbit.md': note('unlisted-orbit', 'Orbit droplet layout and the equity orbit deploy folders', 'project', 'Layout notes about the equity orbit.'),
  });
  write(join(copy, '2 MAIN2026 memory'), {
    'MEMORY.md': '# Memory index\n## Webapp perf\n- [Stale chunk](stale-chunk.md)\n## Data\n- [NQU](nqu.md)\n',
    'stale-chunk.md': note('stale-chunk', 'Open tabs die after a deploy: a stale chunk from raw React.lazy', 'project', 'Use lazyWithRetry. See [[nqu]].'),
    'nqu.md': note('nqu', 'Dated futures: NQU2026 fetches NQU26.CME', 'project', 'NQU2026 becomes NQU26.CME.'),
  });
  write(join(copy, '3 project memories', 'Desktop-NEURAL-ENGINE-2'), {
    'MEMORY.md': '# Memory index\n- [Fit noise floor](fit-noise-floor.md)\n',
    'fit-noise-floor.md': note('fit-noise-floor', 'The fit noise-floor meter first voided the +0.79 fits', 'project', 'It voided them.'),
  });
  const skills = join(base, 'Claude skills and tools 2026-10-03');
  write(join(skills, 'originals', '1 your own', 'skills', 'morning'), { 'SKILL.md': '---\nname: morning\ndescription: "The repo morning brief. Use it when the user asks for the brief."\n---\n\n# Morning\n\n## 1 · Gather\n\nRun it.\n\n## 2 · Render\n\nOpen it.\n' });
  writeFileSync(join(skills, 'ALL-SKILLS-AND-TOOLS.md'), '# All\n\n# Part 3 · Built into Claude Code\n\n## Built into Claude Code\n\n### dataviz\n\n> Note added for this copy: only this summary.\n\nUse this skill for any chart.\n\n# Part 4 · My tools\n\n## Files\n\n### Read\n\nReads a file.\n\n### EnterPlanMode\n\nPlans.\n\n### GOOD - Use EnterPlanMode:\n\nAn example.\n\n### Claude Docs · batch\n\nMakes a doc.\n\n# Part 5 · Plugins\n');
  return { base, home, copies: [join(base, 'Claude memory 2026-10-03'), skills], out: join(base, 'agentic', 'claude-pack') };
}

test('a project\'s name from the folder Claude Code named its memory after, or a copy\'s folder', () => {
  expect(projectName('-Users-x-Desktop-MAIN2026', '-Users-x')).toBe('MAIN2026');
  expect(projectName('-Users-x-Downloads-MAIN2026-main', '-Users-x')).toBe('MAIN2026');
  expect(projectName('Desktop-NEURAL-ENGINE-2-')).toBe('NEURAL-ENGINE-2');
  expect(projectName('Desktop-Main-Projects--2-SEP-PROJECT-')).toBe('2-SEP-PROJECT');
  expect(projectName('-Users-x-Desktop-VPN-FOLDER--VPN-JUL-29', '-Users-x')).toBe('VPN-JUL-29');
  expect(sameProject('MAIN2026', '/Users/x/Desktop/MAIN2026-main-2/desks', '/Users/x')).toBe(true);
  expect(sameProject('MAIN2026', '/Users/x/Desktop/agentic-coder', '/Users/x')).toBe(false);
});

test('the pack: every note once, a project\'s with its prefix, this Mac\'s over the copy\'s, secrets out, topics from the lists', () => {
  const f = fixture();
  const r = buildPack({ home: f.home, copies: f.copies, out: f.out });
  const notes = readdirSync(join(f.out, 'notes')).filter((n) => n !== 'MEMORY.md').sort();
  expect(notes).toEqual(['fourier.md', 'ladder-app.md', 'main2026--live-port.md', 'main2026--nqu.md', 'main2026--stale-chunk.md', 'neural-engine-2--fit-noise-floor.md', 'plain-words.md', 'questions-in-ui.md', 'remote-harness.md', 'skill--dataviz.md', 'skill--morning.md', 'unlisted-orbit.md']);
  // Left out whole: a deploy (a server of yours) and keys; a line with a password left out of the note kept.
  expect(r.leftOut.map((x) => x.id).sort()).toEqual(['equity-droplet', 'ollama-secret-keys']);
  expect(readFileSync(join(f.out, 'notes', 'fourier.md'), 'utf8')).not.toContain('hunter2');
  expect(readFileSync(join(f.out, 'notes', 'fourier.md'), 'utf8')).toContain('Measured on 1 Oct.');
  // This Mac's note wins over the copy's of the same name.
  expect(readFileSync(join(f.out, 'notes', 'plain-words.md'), 'utf8')).toContain('this Mac');
  // A project's note says its project, and its links carry the prefix.
  const stale = readFileSync(join(f.out, 'notes', 'main2026--stale-chunk.md'), 'utf8');
  expect(stale).toContain('project: "MAIN2026"');
  expect(stale).toContain('[[main2026--nqu]]');
  // Topics: the home list's headings, MAIN2026's ## headings, a small project with the others.
  const index = JSON.parse(readFileSync(join(f.out, 'pack.json'), 'utf8'));
  const titles = index.topics.map((t) => t.title);
  expect(titles).toContain('Working style (feedback)');
  expect(titles).toContain('MAIN2026 · Webapp perf');
  expect(titles).toContain('NEURAL-ENGINE-2'); // one small project alone keeps its own topic
  // An unlisted note goes to the topic it shares the most words with.
  expect(index.notes['unlisted-orbit'].topic).toBe(index.topics.find((t) => t.title.startsWith('Equity Orbit')).slug);
  // Claude Code's tools: their own sub-headings stay inside, a name with a dot becomes a file name.
  expect(readdirSync(join(f.out, 'reference', 'claude-code-tools')).sort()).toEqual(['Claude-Docs-batch.md', 'EnterPlanMode.md', 'Read.md']);
  expect(readFileSync(join(f.out, 'reference', 'claude-code-tools', 'EnterPlanMode.md'), 'utf8')).toContain('GOOD - Use EnterPlanMode');
  expect(readFileSync(join(f.out, 'notes', 'skill--morning.md'), 'utf8')).toContain('Its main steps (its own headings): 1 · Gather · 2 · Render');
  // MAP.md names every topic's first file, and every file it names is there.
  const map = readFileSync(join(f.out, 'MAP.md'), 'utf8');
  for (const p of partsOf(map)) expect(existsSync(join(f.out, p.file))).toBe(true);
  expect(partsOf(map).length).toBe(index.topics.length + 1);
  // Copies and Claude's folders are only read.
  expect(readdirSync(join(f.copies[0], 'originals', '1 home memory')).length).toBe(8);
});

test('a long note keeps how it stands now (its opening, How to apply, its newest parts) and its whole text in history/', () => {
  const f = fixture();
  buildPack({ home: f.home, copies: f.copies, out: f.out });
  const now = readFileSync(join(f.out, 'notes', 'ladder-app.md'), 'utf8');
  const all = readFileSync(join(f.out, 'history', 'ladder-app.md'), 'utf8');
  expect(now.length).toBeLessThanOrEqual(PART_CHARS);
  expect(all).toContain('Round 1 (2026-09-01)');
  expect(now).toContain('Now: the desk runs from MAIN2026/desks/ladder');
  expect(now).toContain('How to apply:');
  expect(now).toContain('Round 30 (2026-09-30)');
  expect(now.split('Left out here')[0]).not.toContain('Round 1 (2026-09-01)');
  expect(now).toContain('Left out here: Round 1 (2026-09-01)');
  expect(now).toContain('NOTES/history/ladder-app.md');
  expect(now.indexOf('Round 29')).toBeLessThan(now.indexOf('Round 30')); // in the note's own order
  expect(nowPart({ body: 'short', modified: '' }, { id: 'x' })).toBeNull();
  expect(datesIn('on 3 Oct, then Sep 14 and 2026-09-02', 2026)).toEqual([Date.UTC(2026, 8, 2), Date.UTC(2026, 9, 3), Date.UTC(2026, 8, 14)]);
});

test('what a model may see of the pack: all of it here; on a service only the project it works in; never outside the pack', () => {
  const f = fixture();
  buildPack({ home: f.home, copies: f.copies, out: f.out });
  const all = packView(f.out, { sent: 'all', cwd: '/Users/x/Desktop/agentic-coder', home: '/Users/x' });
  expect(all.file('NOTES/notes/plain-words.md')).toContain('Lead with the result.');
  expect(all.file('NOTES/MAP.md')).toContain("Claude Code's own tools");
  expect(all.file('NOTES/reference/claude-code-tools/Read.md')).toContain('Reads a file.');
  expect(all.file('NOTES/notes/../../pack.json')).toBeNull();
  const m26 = packView(f.out, { sent: 'project', cwd: '/Users/x/Desktop/MAIN2026-main-2', home: '/Users/x' });
  const map = m26.map();
  expect(map).toContain('MAIN2026 · Webapp perf');
  expect(map).not.toContain('Working style');
  expect(map).not.toContain("Claude Code's own tools");
  expect(m26.file('NOTES/notes/main2026--stale-chunk.md')).toContain('lazyWithRetry');
  expect(m26.file('NOTES/notes/plain-words.md')).toBeNull();
  // A home note about a project that names this one comes, as the matcher lets it; one about another does not.
  expect(m26.file('NOTES/history/ladder-app.md')).toContain('Round 1 (2026-09-01)');
  expect(m26.file('NOTES/notes/fourier.md')).toBeNull();
  expect(m26.file('NOTES/reference/claude-code-tools/Read.md')).toBeNull();
  const webapp = JSON.parse(readFileSync(join(f.out, 'pack.json'), 'utf8')).topics.find((t) => t.title === 'MAIN2026 · Webapp perf');
  expect(m26.file(`NOTES/${webapp.files[0]}`)).toContain('main2026--stale-chunk');
  // Elsewhere on a service: nothing (no project of the pack).
  expect(packView(f.out, { sent: 'project', cwd: '/Users/x/Desktop/agentic-coder', home: '/Users/x' }).map()).toBeNull();
  expect(packView(f.out, { sent: 'none', cwd: '/Users/x' })).toBeNull();
  // For /memory: how many, when, and whether a note of this Mac is newer than the pack.
  const st = packState(f.out);
  expect(st.notes).toBe(10);
  expect(st.newer).toBe(0);
  const later = (Date.now() + 60000) / 1000;
  utimesSync(join(f.home, '.claude', 'projects', f.home.replace(/[/.]/g, '-'), 'memory', 'plain-words.md'), later, later);
  expect(packState(f.out).newer).toBe(1);
});

test('the matcher reads the pack when there is one, and a service gets only the notes about its project', async () => {
  const f = fixture();
  buildPack({ home: f.home, copies: f.copies, out: f.out });
  expect(notesDir({ home: f.home, pack: f.out })).toBe(join(f.out, 'notes'));
  expect(notesDir({ home: f.home, setting: f.out })).toBe(join(f.out, 'notes'));
  const dir = join(f.out, 'notes');
  const asked = 'What does NQU2026 become in the dated futures?';
  const here = await recallClaude('/Users/x/Desktop/somewhere', asked, { dir, embedder: null, sent: 'all' });
  expect(here.notes.map((n) => n.id)).toContain('main2026--nqu');
  expect(here.notes[0].project).toBe('MAIN2026');
  const away = await recallClaude('/Users/x/Desktop/somewhere', asked, { dir, embedder: null, sent: 'project' });
  expect(away.notes).toEqual([]);
  const inside = await recallClaude('/Users/x/Desktop/MAIN2026-main-2', asked, { dir, embedder: null, sent: 'project' });
  expect(inside.notes.map((n) => n.id)).toContain('main2026--nqu');
  const user = await recallClaude('/Users/x/Desktop/MAIN2026-main-2', 'How should you ask me clarifying questions, in the question UI?', { dir, embedder: null, sent: 'project' });
  expect(user.notes.filter((n) => !n.project && n.type !== 'project')).toEqual([]);
  expect((await recallClaude('/x', asked, { dir, embedder: null, sent: 'none' })).notes).toEqual([]);
  expect(claudeText(here.notes, { pack: true })).toContain('[main2026--nqu] (about the MAIN2026 project)');
  expect(claudeText(here.notes, { pack: true })).toContain('NOTES/notes/');
});

test('the ladder: whole lines to the room, a part by its name and never outside, the part nearest a request', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-ladder-'));
  writeFileSync(join(dir, 'MAP.md'), '# Code map\n\nIntro.\n\n- desks/ — the trading desks: ladder, nfl → desks.md\n- backend/ — the API server and its routes → backend.md\n');
  writeFileSync(join(dir, 'desks.md'), '# desks/\n\n- desks/ladder/fixings.js (300) — prices each CME fixing\n');
  writeFileSync(join(dir, 'backend.md'), '# backend/\n\n- backend/api/routes/ops/healthDeep.js (80) — the deep health check route\n');
  const l = readLadder(dir);
  expect(l.parts.map((p) => p.file)).toEqual(['desks.md', 'backend.md']);
  expect(openPart(dir, 'desks')?.text).toContain('fixings.js');
  expect(openPart(dir, '../MAP')).toBeNull();
  expect(openPart(dir, 'nope')).toBeNull();
  expect(nearestPart(l, 'where is the deep health check route?').part.file).toBe('backend.md');
  expect(nearestPart(l, 'hello there')).toBeNull();
  const long = Array.from({ length: 50 }, (_, i) => `- line ${i} of the map, with some words`).join('\n');
  const fit = fitLines(long, 400);
  expect(fit.length).toBeLessThanOrEqual(400);
  expect(fit).toMatch(/\(… \d+ more lines in MAP\.md\)$/);
  const parts = splitPart('topic', 'A topic', 'Intro', Array.from({ length: 300 }, (_, i) => `- note-${i} — ${'words '.repeat(10)}`));
  expect(parts.length).toBeGreaterThan(1);
  for (const p of parts) expect(p.text.length).toBeLessThanOrEqual(PART_CHARS);
  expect(parts[0].text).toContain(`(1 of ${parts.length}; the next is topic-2.md)`);
  expect(mapRoom(32768)).toEqual({ chars: 3000, part: 0 });
  expect(mapRoom(262144).part).toBe(PART_CHARS);
});

// A small project in git, for the code map.
function project() {
  const root = join(mkdtempSync(join(tmpdir(), 'agentic-codemap-')), 'shop');
  write(join(root, 'src', 'cart'), { 'index.mjs': '// The cart: adds items and totals them.\nexport function total(xs) { return xs.reduce((a, b) => a + b, 0); }\n', 'tax.mjs': '// Tax for a total, by state.\nexport const tax = (t) => t * 0.08;\n' });
  write(join(root, 'src', 'pages'), { 'checkout.jsx': 'export default function Checkout() { return null; }\n' });
  write(join(root, 'test'), { 'cart.test.mjs': "import { total } from '../src/cart/index.mjs';\n" });
  write(root, { 'README.md': '# Shop\n\nA small shop.\n', 'package.json': '{"name":"shop"}\n', '.env': 'KEY=abc\n' });
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'], { cwd: root });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first'], { cwd: root });
  return root;
}

test('the code map: a line per top folder in MAP.md, every folder and its main files in its part, lines kept per content, the check', () => {
  const root = project();
  const tree = mapTree(root);
  expect(tree.files).not.toContain('.env');
  const cart = fileCard(root, 'src/cart/index.mjs');
  const labels = { 'f:src/cart/index.mjs': { h: cart.hash, line: 'adds items to the cart and totals them', by: 'Qwen' }, 'd:src': { h: folderHash(folderCard(root, tree.nodes.get('src'))), line: 'the shop\'s code: the cart and the pages', by: 'checked' } };
  writeMap(root, tree, labels, { name: 'shop', when: new Date('2026-10-03') });
  const map = readFileSync(join(root, 'docs', 'map', 'MAP.md'), 'utf8');
  expect(map).toContain('# Code map · shop');
  expect(map).toContain("- src/ — the shop's code: the cart and the pages ✓ → src.md");
  expect(map).toContain('→ top.md');
  const src = readFileSync(join(root, 'docs', 'map', 'src.md'), 'utf8');
  expect(src).toContain('- src/cart/index.mjs (3) — adds items to the cart and totals them');
  expect(src).toContain('- src/cart/tax.mjs (3) — Tax for a total, by state.'); // from the code
  expect(checkMap(root)).toEqual([]);
  // A line is kept only for the same content.
  expect(lineFor(labels, 'f:src/cart/index.mjs', cart.hash)?.line).toBe('adds items to the cart and totals them');
  expect(lineFor(labels, 'f:src/cart/index.mjs', 'other')).toBeNull();
  // The check: a path that is not in the project, a home folder's path, an address, a part too long.
  writeFileSync(join(root, 'docs', 'map', 'bad.md'), `# bad\n\n- src/cart/gone.mjs (3) — not there\n- src/x/ — on /Users/someone/Desktop at 203.0.113.9\n${'- y\n'.repeat(3000)}`);
  const p = checkMap(root);
  expect(p.some((x) => /gone\.mjs is not in the project/.test(x))).toBe(true);
  expect(p.some((x) => /home folder's path/.test(x))).toBe(true);
  expect(p.some((x) => /address/.test(x))).toBe(true);
  expect(p.some((x) => /over the 7000 of a part/.test(x))).toBe(true);
  // The model's answer: its JSON, the files it was asked about, never a line with a secret.
  expect(parseLabels('```json\n{"folder": "the cart", "files": {"src/cart/index.mjs": "totals", "tax.mjs": "tax by state", "x": "password: hunter2"}}\n```', ['src/cart/index.mjs', 'src/cart/tax.mjs'])).toEqual({ folder: 'the cart', files: { 'src/cart/index.mjs': 'totals', 'src/cart/tax.mjs': 'tax by state' } });
  expect(parseLabels('no json', [])).toBeNull();
  expect(labelRequest(root, tree.nodes.get('src/cart'), [cart], new Map())).toContain('FILE src/cart/index.mjs (3 lines)');
  expect(codeLine({ opening: '', names: ['a', 'b'], lines: 3 })).toBe('defines a, b');
  // Map: the code map's lines first, then the code files.
  const m = repoMap(root, { maxChars: 4500, ladder: true });
  expect(m.ladder).toBe(true);
  expect(m.text).toStartWith('The code map (docs/map/MAP.md');
  expect(repoMap(root, { maxChars: 4500 }).text).not.toContain('docs/map');
});

test('this repo\'s own docs/map is right: every path in it exists, no part over 2,000 tokens, no home path or address', () => {
  if (!existsSync(join(repoRoot, 'docs', 'map', 'MAP.md'))) return;
  expect(checkMap(repoRoot)).toEqual([]);
});

// The agent with a pretend service: what it is given of the maps and the pack.
const local = MODELS[DEFAULT_MODEL];
const service = { ...local, remote: remoteModel({ use: true, source: 'openai', kind: 'openai', address: '203.0.113.5:11434', port: null, connect: 'http', model: 'big-coder', context: 0, key: false, keyEnd: '' }).remote };
function workIn(f) {
  // A MAIN2026 folder (named as a GitHub download is) with a code map.
  const root = join(f.home, 'Desktop', 'MAIN2026-main-2');
  write(join(root, 'desks', 'ladder'), { 'fixings.js': '// Prices each CME fixing.\nexport const fix = 1;\n' });
  write(join(root, 'docs', 'map'), { 'MAP.md': '# Code map · MAIN2026\n\nIntro.\n\n- desks/ — the trading desks → desks.md\n', 'desks.md': '# desks/\n\n- desks/ladder/fixings.js (2) — prices each CME fixing\n' });
  return root;
}

test('a service that is not yours: the opening read has the code map and only this project\'s notes map; Read NOTES/ and Map {part} work within that', async () => {
  const f = fixture();
  buildPack({ home: f.home, copies: f.copies, out: f.out });
  const root = workIn(f);
  const fake = await startFakeServer([], { delayMs: 0 });
  try {
    const a = new Agent({ url: fake.url, model: service, cwd: root, system: systemPrompt({ cwd: root, git: 'g', set: 'remote' }), memory: { home: f.home, recall: false, claude: f.out }, home: f.home, flows: false, verify: false });
    expect(a.notesSent()).toBe('project');
    await a.send('where are the fixings priced?');
    const opening = a.messages.find((m) => m.opening)?.content ?? '';
    expect(opening).toContain('The code map (docs/map/MAP.md');
    expect(opening).toContain('- desks/ — the trading desks → desks.md');
    expect(opening).toContain("The map of Claude's notes (NOTES/MAP.md: only the topics about this project");
    expect(opening).toContain('MAIN2026 · Webapp perf');
    expect(opening).not.toContain('Working style');
    const env = { cwd: root, notes: () => a.notesView() };
    expect((await execute('Read', { path: 'NOTES/notes/main2026--nqu.md' }, null, env)).text).toContain('NQU26.CME');
    const refused = await execute('Read', { path: 'NOTES/notes/plain-words.md' }, null, env);
    expect(refused.error).toBe(true);
    expect(refused.text).toContain('the notes about the user stay on their Mac');
    expect(prepare('Write', { path: 'NOTES/notes/x.md', content: 'x' }, env).error).toContain("Claude's notes");
    const part = await a.runModelTool('Map', { part: 'desks' }, {}, 'm1');
    expect(part.text).toContain('desks/ladder/fixings.js');
    const none = await a.runModelTool('Map', { part: 'nope' }, {}, 'm2');
    expect(none.error).toBe(true);
    expect(none.text).toContain('Its parts: desks');
  } finally { fake.close(); }
});

test('a model on this Mac: every note may come, and the maps come as a step of their own, once', async () => {
  const f = fixture();
  buildPack({ home: f.home, copies: f.copies, out: f.out });
  const root = workIn(f);
  const fake = await startFakeServer([], { delayMs: 0 });
  try {
    const a = new Agent({ url: fake.url, model: local, cwd: root, system: systemPrompt({ cwd: root, git: 'g' }), memory: { home: f.home, recall: false, claude: f.out }, home: f.home, flows: false, verify: false });
    const events = [];
    a.on('tool', (e) => events.push(e));
    expect(a.notesSent()).toBe('all');
    await a.send('where are the fixings priced?');
    const maps = a.messages.filter((m) => m.maps);
    expect(maps).toHaveLength(1);
    expect(maps[0].content).toContain('The code map (docs/map/MAP.md');
    expect(maps[0].content).toContain('Working style (feedback)');
    expect(events.find((e) => e.given && e.label === 'Reading the maps')).toBeTruthy();
    expect(a.messages.some((m) => m.opening)).toBe(false);
    await a.send('and the tax?');
    expect(a.messages.filter((m) => m.maps)).toHaveLength(1);
    // Without a code map and without the notes: no step.
    const bare = join(f.base, 'bare');
    write(bare, { 'a.mjs': 'export const a = 1;\n' });
    const b = new Agent({ url: fake.url, model: local, cwd: bare, system: systemPrompt({ cwd: bare, git: 'g' }), memory: { home: f.home, recall: false }, home: f.home, flows: false, verify: false });
    await b.send('what is a?');
    expect(b.messages.some((m) => m.maps)).toBe(false);
  } finally { fake.close(); }
});

test('mapsRead sizes the maps by the context: the part nearest the request only with a big one', () => {
  const f = fixture();
  const root = workIn(f);
  const small = mapsRead(root, { ctx: 32768, request: 'where are the fixings priced, the CME fixing prices?' });
  expect(small.parts).toHaveLength(1);
  const big = mapsRead(root, { ctx: 262144, request: 'where are the fixings priced, the CME fixing prices?' });
  expect(big.parts[1]).toContain('The part of the code map nearest the request (docs/map/desks.md)');
  expect(mapsRead(join(f.base, 'nothing'), { home: f.home })).toBeNull();
  const r = openingRead(root, { home: f.home, maps: big });
  expect(r.body).toContain('docs/map/desks.md');
});

test('a model\'s answer cut off at its length keeps the pairs it finished', () => {
  const cut = '{\n  "folder": "the run bar",\n  "files": {\n    "src/a.js": "the quota",\n    "src/b.js": "the prefs",\n    "src/c.js": "the edi';
  expect(parseLabels(cut, ['src/a.js', 'src/b.js', 'src/c.js'])).toEqual({ folder: 'the run bar', files: { 'src/a.js': 'the quota', 'src/b.js': 'the prefs' } });
});

test('a docs/map the code map did not make is never touched; of its own only the .md files are replaced', () => {
  const root = project();
  write(join(root, 'docs', 'map'), { 'notes.txt': 'mine', 'MAP.md': '# My own map\n' });
  expect(() => writeMap(root, mapTree(root), {})).toThrow('not a code map this made');
  expect(readFileSync(join(root, 'docs', 'map', 'MAP.md'), 'utf8')).toBe('# My own map\n');
  writeFileSync(join(root, 'docs', 'map', 'MAP.md'), '# Code map · shop\n');
  writeFileSync(join(root, 'docs', 'map', 'old-part.md'), '# gone\n');
  writeMap(root, mapTree(root), {});
  expect(existsSync(join(root, 'docs', 'map', 'old-part.md'))).toBe(false);
  expect(readFileSync(join(root, 'docs', 'map', 'notes.txt'), 'utf8')).toBe('mine');
});

test('bun run codemap lets go of the model on the service when it is done, and asks it to keep the model 5 minutes at most', async () => {
  const { createServer } = await import('node:http');
  const root = project();
  const posts = [];
  const server = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const body = b ? JSON.parse(b) : {};
    if (req.method === 'POST') posts.push({ path: req.url, ...body });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
    if (req.url === '/api/chat') return res.end(JSON.stringify({ message: { content: '{"folder": "the shop\'s code", "files": {}}' }, done: true }));
    res.end(JSON.stringify({ done: true }));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    // Not spawnSync: the pretend service runs in this process and must answer while the map is made.
    const { spawn } = await import('node:child_process');
    const r = await new Promise((ok) => {
      const c = spawn(process.execPath, [join(repoRoot, 'terminal', 'scripts', 'codemap.mjs'), root, '--remote', url, '--model', 'coder:30b', '--jobs', '1'], { env: { ...process.env } });
      let stdout = '';
      c.stdout.on('data', (d) => { stdout += d; });
      c.on('exit', (code) => ok({ stdout, code }));
    });
    expect(r.stdout).toContain('Let go of coder:30b on the service.');
    const chats = posts.filter((p) => p.path === '/api/chat');
    expect(chats.length).toBeGreaterThan(0);
    expect(chats.every((p) => p.keep_alive === '5m')).toBe(true);
    expect(posts.at(-1)).toMatchObject({ path: '/api/generate', model: 'coder:30b', keep_alive: 0 });
    expect(readFileSync(join(root, 'docs', 'map', 'MAP.md'), 'utf8')).toContain("- src/ — the shop's code → src.md");
  } finally { await new Promise((d) => server.close(d)); }
}, 60_000);
