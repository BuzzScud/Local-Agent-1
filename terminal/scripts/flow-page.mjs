// Draws the flow-diagram page: one self-contained HTML file, 8 tabs, hand-drawn inline SVG.
//   bun terminal/scripts/flow-page.mjs                   writes src/app/flow.html, the hub's Flow tab (built into the app)
//   bun terminal/scripts/flow-page.mjs <file.html>       writes a dated copy for cli docs/ (adds the date to the header)
// The boxes and arrows are drawn from terminal/README.md and models/README.md; when
// how the app works changes, change the drawing here and run it again.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

class Fig {
  constructor(id, W, H, top = 0) { this.id = id; this.W = W; this.H = H; this.top = top; this.p = []; }
  // A box: bold title + muted sub lines, centred. dot = "can call the model".
  box(x, y, w, h, { k = '', t, s = [], dot = false, mono = false } = {}) {
    const subs = arr(s), total = 15 + 13.5 * subs.length, y0 = y + (h - total) / 2;
    let out = `<g class="node ${k}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9"/>`;
    out += `<text class="h${mono ? ' m' : ''}" x="${x + w / 2}" y="${(y0 + 11).toFixed(1)}" text-anchor="middle">${esc(t)}</text>`;
    subs.forEach((l, i) => { out += `<text class="s" x="${x + w / 2}" y="${(y0 + 15 + 13.5 * i + 10).toFixed(1)}" text-anchor="middle">${esc(l)}</text>`; });
    if (dot) out += `<circle class="dotm" cx="${x + w - 11}" cy="${y + 11}" r="4.6"/>`;
    this.p.push(out + '</g>');
  }
  group(x, y, w, h, label, k = '') {
    this.p.push(`<g class="grp ${k}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14"/><text x="${x + 16}" y="${y + 22}">${esc(label)}</text></g>`);
  }
  // Polyline arrow. opts: label, lp [x,y], a (anchor), m (amber), d (dashed), both, line (no head)
  arrow(pts, { label, lp, a = 'middle', m = false, d = false, both = false, line = false } = {}) {
    const dd = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0]} ${q[1]}`).join(' ');
    const cls = `ar${m ? ' m' : ''}${d ? ' d' : ''}`;
    const mk = m ? `am-${this.id}` : `ah-${this.id}`;
    let out = `<path class="${cls}" d="${dd}"${line ? '' : ` marker-end="url(#${mk})"`}${both ? ` marker-start="url(#${mk})"` : ''}/>`;
    if (label) out += this.lab(lp, label, a, m);
    this.p.push(out);
  }
  lab([x, y], text, a = 'middle', m = false) {
    return arr(text).map((l, i) => `<text class="lab${m ? ' am' : ''}" x="${x}" y="${y + 13 * i}" text-anchor="${a}">${esc(l)}</text>`).join('');
  }
  text(x, y, text, { a = 'start', k = 's' } = {}) {
    this.p.push(arr(text).map((l, i) => `<text class="${k}" x="${x}" y="${y + 15 * i}" text-anchor="${a}">${esc(l)}</text>`).join(''));
  }
  raw(s) { this.p.push(s); }
  render(aria) {
    const i = this.id;
    return `<svg viewBox="0 ${this.top} ${this.W} ${this.H - this.top}" role="img" aria-label="${esc(aria)}" preserveAspectRatio="xMidYMid meet">` +
      `<defs><marker id="ah-${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="mk" d="M0 1 L10 5 L0 9 z"/></marker>` +
      `<marker id="am-${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="mk m" d="M0 1 L10 5 L0 9 z"/></marker></defs>` +
      this.p.join('') + '</svg>';
  }
}

/* ───────────── 1 · Big picture ───────────── */
const f1 = new Fig('f1', 1280, 560);
f1.box(230, 6, 1030, 40, { k: 'ghost', t: 'Test bench (models/evals): runs the terminal’s agent with no screen, using a model, and grades the result \u2192 tab 7' });
f1.box(20, 110, 120, 72, { k: 'you', t: 'You', s: ['in Terminal, or via', 'Agentic Coder.app'] });
f1.box(20, 300, 120, 80, { k: '', t: 'coding', s: ['launcher: rebuilds', 'if the code changed'], mono: true });
f1.group(200, 64, 630, 370, 'PART 1 · THE TERMINAL  (terminal/)', 't1');
f1.box(216, 110, 120, 72, { k: 't1', t: 'Screen', s: ['Ink · keys', '/ commands'] });
f1.box(400, 110, 120, 72, { k: 't1', t: 'Sort & ask', s: ['rules first', 'then a question'], dot: true });
f1.box(596, 98, 218, 72, { k: 't1', t: 'Focused paths', s: ['rename · fix · change', 'several files'], dot: true });
f1.box(596, 196, 218, 72, { k: 't1', t: 'Step-by-step loop', s: ['send → run one tool →', 'result back → repeat'], dot: true });
f1.box(596, 318, 218, 72, { k: 't1', t: '8 tools', s: ['Read · List · Search · Edit', 'Write · Bash · TodoWrite · Ask'] });
f1.box(216, 318, 304, 72, { k: 't1', t: 'Memory', s: ['facts about you and the project', 'saved after a task, found by meaning'], dot: true });
f1.group(930, 64, 330, 370, 'PART 2 · THE MODELS  (models/)', 't2');
f1.box(950, 98, 290, 64, { k: 't2', t: 'models/index.mjs', s: ['the one door between the parts'], mono: true });
f1.box(950, 196, 290, 72, { k: 't2', t: 'llama-server', s: ['starts, shares and stops it;', 'picks a context that fits the Mac'] });
f1.box(950, 306, 138, 96, { k: 't2', t: 'Gemma 4 12B', s: ['default · 6.7 GB', 'answers, writes code', '/model swaps to', 'Qwen3.5 9B'] });
f1.box(1102, 306, 138, 96, { k: 't2', t: 'BGE-M3', s: ['small model that', 'finds memory facts', 'by meaning'] });
f1.box(596, 470, 218, 64, { k: 'you', t: 'Your project folder', s: ['the only place it works'] });
// flows
f1.arrow([[140, 136], [216, 136]], { label: 'prompt', lp: [178, 128] });
f1.arrow([[216, 158], [140, 158]], { label: 'answer', lp: [178, 173] });
f1.arrow([[336, 146], [400, 146]], { label: 'request', lp: [368, 138] });
f1.arrow([[520, 126], [596, 126]], { label: 'most', lp: [558, 118] });
f1.arrow([[490, 182], [490, 232], [596, 232]], { label: 'the rest', lp: [482, 208], a: 'end' });
f1.arrow([[705, 170], [705, 196]], { d: true, label: 'can’t finish', lp: [713, 187], a: 'start' });
f1.arrow([[705, 268], [705, 318]], { label: 'asks you first', lp: [713, 297], a: 'start' });
f1.arrow([[705, 390], [705, 470]], { both: true, label: 'reads · edits · runs', lp: [713, 448], a: 'start' });
f1.arrow([[276, 182], [276, 318]], { d: true, label: 'saves after a task', lp: [284, 256], a: 'start' });
f1.arrow([[430, 318], [430, 182]], { label: 'facts that fit', lp: [438, 290], a: 'start' });
f1.arrow([[814, 122], [950, 122]], { m: true, label: ['asks the', 'model; reply', 'streams back'], lp: [882, 84] });
f1.arrow([[814, 232], [880, 232], [880, 148], [950, 148]], { m: true });
f1.arrow([[1095, 162], [1095, 196]], { m: true });
f1.arrow([[1019, 268], [1019, 306]], { m: true, label: 'chat', lp: [1027, 292], a: 'start' });
f1.arrow([[1171, 268], [1171, 306]], { m: true, label: 'embeddings', lp: [1179, 292], a: 'start' });
f1.arrow([[140, 326], [200, 326]], { label: 'starts', lp: [170, 318] });
f1.arrow([[200, 356], [140, 356]], { d: true, label: '/update', lp: [170, 372] });

/* ───────────── 2 · One request ───────────── */
const f2 = new Fig('f2', 1280, 400, 10);
const st = [
  ['1 · Type', ['enter sends', '@file · !cmd · /cmd'], false, 'you'],
  ['2 · Sort', ['rules first; the model', 'only if none fits'], true, 't1'],
  ['3 · Ask', ['2–3 answers to pick,', 'or type a line'], true, 't1'],
  ['4 · Recall', ['facts that fit are', 'written into it'], false, 't1'],
  ['5 · Work', ['a focused path, or', 'the step-by-step loop'], true, 't1'],
  ['6 · Check', ['diff vs your request;', 'sent back once if', 'a part is missing'], true, 't1'],
  ['7 · Show', ['“Worked for 41s”;', 'memory saves later'], false, 'you'],
];
st.forEach(([t, s, dot, k], i) => f2.box(20 + i * 180, 20, 146, 92, { k, t, s, dot }));
for (let i = 0; i < 6; i++) f2.arrow([[166 + i * 180, 66], [200 + i * 180, 66]]);
f2.arrow([[770, 112], [770, 152], [453, 152], [453, 112]], { d: true, label: 'the model can ask again mid-task', lp: [611, 170] });
f2.arrow([[960, 112], [960, 196], [850, 196], [850, 112]], { d: true, label: 'sent back once', lp: [905, 214] });
f2.text(20, 268, 'FOR EXAMPLE, YOU TYPE \u201cfix the failing date test\u201d', { k: 'gl' });
[['as you typed it'], ['a rule fits: \u201cfix\u201d', 'no model needed'], ['skipped: the request', 'is clear enough'], ['one saved fact about', 'this project fits'], ['runs the tests, finds', 'the file, tries in a', 'scratch copy'], ['the diff matches', 'the request'], ['Worked for 41s;', 'the fact scores +1']].forEach((s, i) => {
  f2.box(20 + i * 180, 284, 146, 76, { k: 'ghost', t: ['You', 'Sorted as: fix', 'Ask', 'Recall', 'Work', 'Check', 'Show'][i], s });
});

const f2b = new Fig('f2b', 1280, 500);
const dest = [
  ['Short reply, no tools', 'thanks · praise · “I need help with something”'],
  ['Carries on the last turn', 'a short line that continues it: “why”, “can you add it to my desktop?”'],
  ['Question', 'answered from code already read; Edit and Write are turned away'],
  ['Rename', 'every whole-word use, one diff, one question · no model'],
  ['Fix · Change · Several files', 'the focused paths (tab 5)'],
  ['Step by step (the loop)', 'plain commands (“run the tests”, “commit and push”), a page or file with no code named'],
  ['Ask first', 'a bare “fix the bug” with nothing failing, or a lone word like “api” → a question before anything runs'],
];
const dy = (i) => 20 + i * 68;
dest.forEach(([t, s], i) => f2b.box(660, dy(i), 600, 56, { k: i === 5 ? 't1' : i === 6 ? 'ghost' : '', t, s }));
f2b.box(20, 200, 150, 64, { k: 'you', t: 'Your request' });
f2b.box(250, 200, 190, 64, { k: 't1', t: 'Rules first', s: ['words and shortcuts', '101 test requests guard them'] });
f2b.box(250, 340, 190, 64, { k: 't1', t: 'The model', s: ['a forced-JSON reply,', 'only when no rule fits'], dot: true });
f2b.arrow([[170, 232], [250, 232]]);
f2b.arrow([[345, 264], [345, 340]], { label: 'no rule fits', lp: [353, 306], a: 'start' });
f2b.arrow([[440, 232], [600, 232]], { line: true, label: 'a rule fits', lp: [520, 224] });
f2b.arrow([[440, 372], [600, 372], [600, 232]], { line: true });
f2b.raw(`<path class="ar" d="M600 48 L600 ${dy(6) + 28}"/>`);
dest.forEach((_, i) => f2b.arrow([[600, dy(i) + 28], [660, dy(i) + 28]]));
f2b.text(20, 470, 'The verdict shows in dim text under your request, for example', { k: 's' });
f2b.text(20, 486, 'Sorted as: change · shortcut', { k: 's m' });

/* ───────────── 3 · The loop ───────────── */
const f3 = new Fig('f3', 1280, 560, 34);
f3.box(20, 50, 230, 72, { k: 't1', t: 'Send', s: ['conversation + tool list +', 'recalled facts → model'], dot: true });
f3.box(310, 50, 230, 72, { k: 't1', t: 'Stream the reply', s: ['thinking, text or a tool call,', 'shown live on the Screen'] });
f3.box(600, 50, 230, 72, { k: 't1', t: 'Wants a tool?', s: ['one tool at a time'] });
f3.box(890, 50, 230, 72, { k: 'you', t: 'Final answer', s: ['then the check before', '\u201cdone\u201d (step 6, tab 2)'] });
f3.box(600, 210, 230, 72, { k: 't1', t: 'Permission gate', s: ['edit or command: Yes · Yes for', 'this session · No, and say what'] });
f3.box(310, 210, 230, 72, { k: 't1', t: 'Run the tool', s: ['Read · List · Search · Edit', 'Write · Bash · TodoWrite · Ask'] });
f3.box(20, 210, 230, 72, { k: 't1', t: 'Result comes back', s: ['folded on screen (ctrl+o opens it)', 'and added to the conversation'] });
f3.box(600, 340, 230, 84, { k: 'bad', t: 'Refused', s: ['rm -rf · sudo · git push · reset --hard', 'kill · pipe-to-shell · outside project'] });
f3.arrow([[250, 86], [310, 86]], { m: true, label: 'streams', lp: [280, 78] });
f3.arrow([[540, 86], [600, 86]]);
f3.arrow([[830, 86], [890, 86]], { label: 'no', lp: [860, 78] });
f3.arrow([[715, 122], [715, 210]], { label: 'yes', lp: [723, 170], a: 'start' });
f3.arrow([[600, 246], [540, 246]], { label: 'allowed', lp: [570, 238] });
f3.arrow([[310, 246], [250, 246]]);
f3.arrow([[135, 210], [135, 122]], { d: true, label: 'next step', lp: [143, 170], a: 'start' });
f3.arrow([[715, 282], [715, 340]], { label: 'blocked', lp: [723, 316], a: 'start' });
f3.arrow([[600, 382], [135, 382], [135, 282]], { d: true, label: 'the refusal comes back as the result', lp: [370, 374] });
// guards panel
f3.group(880, 170, 380, 250, 'GUARDS INSIDE THE LOOP', 't1');
f3.text(898, 214, [
  'Repeated steps and looping output are stopped.',
  'A tool call written as text, or inside the',
  'thinking, is caught and run properly.',
  '“Announce, then stop” gets a nudge to act.',
  'An edit that would break a file that parsed',
  'before is refused.',
  'Edits match despite indent slips and one-',
  'character typos (one clear place only).',
  'Read: small files whole; long ones as an',
  'outline plus the lines that match.',
  'A question changes nothing; commands run in',
  'a throwaway copy of the project.',
]);
// when memory fills
f3.group(20, 450, 800, 100, 'WHEN THE CONVERSATION FILLS THE MEMORY', '');
f3.box(36, 484, 230, 52, { k: '', t: 'Nearly full', s: ['from 70% a line says so'] });
f3.box(306, 484, 230, 52, { k: 't1', t: 'The model writes its notes', s: ['inside the conversation it holds'], dot: true });
f3.box(576, 484, 230, 52, { k: 't1', t: 'Carries on', s: ['from request + notes + files list'] });
f3.arrow([[266, 510], [306, 510]]);
f3.arrow([[536, 510], [576, 510]]);

/* ───────────── 4 · Focused paths ───────────── */
const f4 = new Fig('f4', 1280, 550, 16);
const lanes = [
  ['Rename', 'e.g. “rename test to check”', [
    ['Find every use', ['whole word, in code', 'no model'], false],
    ['One diff', ['all the places at once'], false],
    ['One question', ['you say yes or no'], false]]],
  ['Fix', 'the tests fail', [
    ['Run the tests', ['see what fails'], false],
    ['Find the file', ['where the failure lives'], false],
    ['3 focused tries', ['on one function, in a', 'scratch copy; each told', 'what the last got wrong'], true],
    ['3 wider tries', ['as edit blocks'], true]]],
  ['Fix, check first', 'a page bug tests miss', [
    ['Open the page', ['project’s own browser', '(Playwright)'], false],
    ['What covers what', ['model picks the steps;', 'browser finds the layers'], true],
    ['Check fails today', ['you approve it;', 'it stays in the project'], false],
    ['Tries scored by it', ['hiding the thing', 'doesn’t pass'], true]]],
  ['Change', 'add or change something', [
    ['Test first', ['2 tests, 2 drafts, cross-', 'checked; you approve'], true],
    ['Tries', ['in a scratch copy'], true],
    ['Apply', ['the test passes'], false]]],
  ['Several files', 'a change that spans files', [
    ['Plan the files', ['from the project map'], true],
    ['One test', ['for the whole change'], false],
    ['Edit blocks', ['across all the files'], true],
    ['Guards', ['only planned files change;', 'nothing quietly removed'], false]]],
];
lanes.forEach(([name, when, steps], r) => {
  const y = 30 + r * 104;
  f4.box(20, y, 178, 76, { k: 't1', t: name, s: arr(when).length ? [when] : [] });
  steps.forEach(([t, s, dot], c) => {
    const x = 250 + c * 200;
    f4.box(x, y + 6, 160, 64, { k: '', t, s, dot });
  });
  f4.arrow([[198, y + 38], [250, y + 38]]);
  for (let c = 0; c < steps.length - 1; c++) f4.arrow([[410 + c * 200, y + 38], [450 + c * 200, y + 38]]);
  const lastX = 250 + (steps.length - 1) * 200 + 160;
  f4.arrow([[lastX, y + 38], [1060, y + 38]], { d: true, ...(r === 0 ? { label: 'can’t finish →', lp: [(lastX + 1060) / 2, y + 30] } : {}) });
});
f4.box(1060, 30, 200, 500, { k: 't1', t: 'Step by step', s: ['the loop (tab 4)', 'anything a focused', 'path can\u2019t finish', 'goes here', '--no-flows always', 'starts here'] });

/* ───────────── 5 · Memory ───────────── */
const f5 = new Fig('f5', 1280, 545, 30);
f5.text(20, 88, 'SAVE', { k: 'gl' });
f5.text(20, 268, 'STORE', { k: 'gl' });
f5.text(20, 434, 'BRING BACK', { k: 'gl' });
f5.box(200, 50, 210, 80, { k: '', t: 'A task ends', s: ['or you quit, or you say', '“remember that …”'] });
f5.box(470, 50, 220, 80, { k: 't1', t: 'Pick up to 5 facts', s: ['in the background, on the', 'side slot; stops if you type'], dot: true });
f5.box(750, 50, 270, 80, { k: 'bad', t: 'Refuse the bad ones', s: ['not borne out by the turns,', 'names a file that isn’t there,', 'looks like a key or password'] });
f5.arrow([[410, 90], [470, 90]]);
f5.arrow([[690, 90], [750, 90]]);
f5.group(200, 190, 840, 132, 'MEMORY STORE  ·  one small file per fact, an index, a retired/ folder, a log', 't1');
f5.box(220, 226, 240, 80, { k: 'ghost', t: 'Claude Code’s notes', s: ['read where they are,', 'never changed'] });
f5.box(486, 226, 260, 80, { k: 't1', t: 'About you', s: ['~/.agentic/memory', 'follows you into every project'] });
f5.box(772, 226, 250, 80, { k: 't1', t: 'About the project', s: ['<project>/.agentic/memory', 'kept out of git'] });
f5.arrow([[885, 130], [885, 190]], { label: 'facts', lp: [893, 164], a: 'start' });
f5.box(1080, 226, 180, 80, { k: 'ghost', t: 'Once a day', s: ['repeats merge; unused', '30 days → retired/'] });
f5.arrow([[1080, 266], [1040, 266]], { d: true });
f5.box(200, 388, 200, 84, { k: '', t: 'At every start', s: ['“always” rules and one', 'line per fact are read'] });
f5.box(450, 388, 240, 84, { k: 't1', t: 'With a request', s: ['facts that fit are found by', 'meaning (BGE-M3) or by', 'shared words'] });
f5.box(740, 388, 240, 84, { k: 't1', t: 'Written into the request', s: ['so nothing already read', 'is read again'] });
f5.box(1030, 388, 230, 84, { k: '', t: 'The result decides', s: ['passed +1 · failed/stuck −1', 'you corrected −2; at −3', 'the fact is taken out of use'] });
f5.arrow([[300, 322], [300, 388]], { label: 'read', lp: [308, 360], a: 'start' });
f5.arrow([[570, 322], [570, 388]], { label: 'fits', lp: [578, 360], a: 'start' });
f5.arrow([[400, 430], [450, 430]]);
f5.arrow([[690, 430], [740, 430]]);
f5.arrow([[980, 430], [1030, 430]]);
f5.arrow([[1130, 388], [1130, 322], [1040, 322]], { d: true, label: 'score', lp: [1138, 355], a: 'start' });
f5.text(20, 520, ['Nothing is ever deleted: taken-out facts go to retired/. Pinned facts stay in use.', 'coding memory-review reads the day\u2019s conversations again at night, only if you schedule it.'], { k: 's' });

/* ───────────── 6 · Test bench ───────────── */
const f6 = new Fig('f6', 1280, 375, 40);
f6.box(20, 60, 170, 90, { k: 'ghost', t: 'A practice task', s: ['28 of them: questions,', 'renames, fixes, features,', 'a real-sized project'] });
f6.box(240, 60, 170, 90, { k: '', t: 'Throwaway copy', s: ['of the project; the', 'real one is never touched'] });
f6.box(460, 60, 190, 90, { k: 't2', t: 'Own llama-server', s: ['starts with the model', 'under test'] });
f6.box(700, 60, 200, 90, { k: 't1', t: 'The agent, no screen', s: ['runs the task headless;', 'everything auto-approved;', 'questions get scripted answers'], dot: true });
f6.box(945, 60, 145, 90, { k: '', t: 'The check', s: ['each task has one;', 'passes or fails'] });
f6.box(1140, 60, 120, 90, { k: 'you', t: 'Report page', s: ['written to', 'the repo\'s', 'cli docs/'] });
[[190, 240], [410, 460], [650, 700], [900, 945], [1090, 1140]].forEach(([a, b]) => f6.arrow([[a, 105], [b, 105]]));
f6.text(20, 190, 'Each check is proven first: it must fail on the untouched project and pass with the reference answer (tools/verify-tasks.sh).', { k: 's' });
f6.group(20, 226, 1240, 130, 'OTHER RUNS USE THE SAME RUNNER', '');
f6.box(40, 262, 280, 76, { k: '', t: '28 real requests', s: ['trigger words and blocked commands,', 'in three kinds of folder'] });
f6.box(350, 262, 280, 76, { k: '', t: 'Speed · soak · re-read', s: ['engine settings, long conversations,', 'cold starts, what is read again'] });
f6.box(660, 262, 280, 76, { k: '', t: 'Overnight run', s: ['all of the above,', 'with a morning report'] });
f6.box(970, 262, 270, 76, { k: 'ghost', t: 'One model at a time', s: ['a 16 GB Mac fits one,', 'so runs wait for each other'] });

/* ───────────── page ───────────── */
const dated = Boolean(process.argv[2]);
const out = process.argv[2] ?? join(import.meta.dir, '..', 'src', 'app', 'flow.html');
const legend = `<p class="legend"><span><i class="dotm"></i> can call the model</span><span><i class="ln m"></i> talks to the model</span><span><i class="ln d"></i> falls back, repeats or comes back</span></p>`;
const tabs = [
  { id: 'big', name: 'Big picture', h: 'Two parts joined by one door', p: 'You type in a terminal. The terminal decides how to do the job and calls the model only when it has to. Everything stays on this Mac.', fig: f1.render('Agentic Coder: you talk to the terminal (part 1); the terminal reaches the local model only through models/index.mjs (part 2); tools touch only your project folder.'), cap: 'The terminal never reads a model’s settings directly; it goes through one file, models/index.mjs. Replies stream back along the same arrows. `/update` exits the app with code 75, and the launcher rebuilds and restarts it in the same window.' },
  { id: 'req', name: 'One request', h: 'What happens to one request', p: 'Seven steps from your Enter key to “done”, then where the sorting step sends it.', fig: f2.render('The seven steps a request takes from typing to done, with an example under each.'), cap: 'Only some steps use the model (amber dot). Recall and the final show are plain code. Step 2 is drawn out on the next tab.' },
  { id: 'sort', name: 'Sorting', h: 'Step 2 in detail: where a request goes', p: 'Rules look at your words first. The model is asked only when no rule fits.', fig: f2b.render('Sorting: rules decide first; the model decides only when no rule fits; seven possible destinations.'), cap: 'Under your request a dim line says where it went, for example Sorted as: change \u00b7 shortcut. A rule change that moves any of the 101 test requests to another path fails the sort test.' },
  { id: 'loop', name: 'The loop', h: 'The step-by-step loop', p: 'When no shortcut fits, the model works one tool at a time, and you approve each edit or command.', fig: f3.render('The agent loop: send, stream, permission gate, run one tool, result back, repeat; guards and the memory-full path.'), cap: 'Built for small local models: one tool at a time, plain-text reads, edits that forgive small slips. Always blocked in every mode: rm -rf, sudo, git push, git reset --hard, git clean -f, kill, stopping services, piping the internet into a shell.' },
  { id: 'paths', name: 'Focused paths', h: 'Focused paths: fixed recipes for common jobs', p: 'A recipe leaves the small model less to guess. Anything a recipe can’t finish drops to the loop.', fig: f4.render('Five focused paths, each a short chain of steps that falls back to the step-by-step loop.'), cap: 'Tries happen in a scratch copy of the project, not in your own files. Each lane ends by dropping to the step-by-step loop when it can\u2019t finish.' },
  { id: 'mem', name: 'Memory', h: 'Memory: the model stays the same, what it knows changes', p: 'Facts about you and each project are saved after tasks, brought back when they fit, and scored by how the next task went.', fig: f5.render('Memory lifecycle: save up to five facts after a task, keep them in two stores, bring back the ones that fit, score them by the result.'), cap: 'Turn it off with `"memory": false` in settings.json, or stop only the auto-saving with `AGENTIC_MEMORY_SAVE=off`. `/memory` shows both memories; `/memory undo` takes the last save back.' },
  { id: 'bench', name: 'Test bench', h: 'The test bench: how a model gets graded', p: 'The same agent, run with no screen, on throwaway copies, then checked.', fig: f6.render('Test bench: practice task, throwaway copy, own llama-server, headless agent, check, report page.'), cap: 'This is how Gemma was measured against the old 27B. A new model is tested the same way: `node models/evals/bench/run.mjs --model <id>`.' },
  { id: 'where', name: 'Where it lives', h: 'Where things live', p: 'The code is in one repo; what the app builds and remembers is in two hidden folders in your home.', fig: '', cap: '' },
];

const where = `
<div class="cols">
 <div class="card"><h3>In the repo <code>~/Desktop/agentic-coder</code></h3>
<pre>agentic-coder/
├─ <b>terminal/</b>            part 1 · the agent you talk to
│  ├─ src/               cli · app (screen) · agent (loop) · flows · tools · ui · morning
│  ├─ test/  scripts/   unit tests, keys-in-a-real-terminal tests, report builders
│  └─ app/               Agentic Coder.app launcher, the <code>coding</code> script, icon
├─ <b>models/</b>              part 2 · the models and the bench
│  ├─ index.mjs          the one door
│  ├─ runtime/           llama-server, memory fit, warm-up, setup
│  ├─ gemma-4-12b/       in use by default
│  ├─ qwen3.5-9b/        a second model to try
│  ├─ bonsai-2-27b/      retired, kept as a recipe
│  ├─ bge-m3/            finds memory facts by meaning
│  └─ evals/             the test bench
├─ <b>cli docs/</b>            every diagram, report and test page (mirrored to docs/)
└─ Agentic Coder.app     double-click: pick a folder, opens Terminal running coding</pre></div>
 <div class="card"><h3>On this Mac, outside the repo</h3>
<pre><b>~/.local/bin/coding</b>          the launcher you type
<b>~/.agentic-coder/</b>
├─ app/agentic-coder     the built one-file app
├─ models/  engine/      model files and the llama.cpp engine
├─ sessions/  history    saved conversations
├─ maps/                 project maps
├─ logs/  servers/       update log, running servers
└─ settings.json  trust.json
<b>~/.agentic/memory</b>         what it remembers about you
<b>&lt;project&gt;/.agentic/memory</b>  what it remembers about a project</pre>
 <p class="note">Model files are downloaded once with <code>coding setup</code>. Nothing here is sent anywhere: the model runs on this Mac.</p></div>
</div>`;

const css = `
:root{--bg:#fbfaf7;--fg:#1d1d1f;--mut:#63636a;--line:#c9c6bd;--card:#fff;--arrow:#5d5d63;
--t1:#2f5fd0;--t1bg:#eaf0fd;--t2:#1c8558;--t2bg:#e4f5ec;--model:#b45309;--bad:#b3261e;--badbg:#fdeceb;--chip:#efece4}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececee;--mut:#a3a3ab;--line:#3a3a41;--card:#1e1e22;--arrow:#a3a3ab;
--t1:#7fa3ff;--t1bg:#1b2440;--t2:#4fc38d;--t2bg:#13332a;--model:#f4a35c;--bad:#ff8b82;--badbg:#3a1e1c;--chip:#232327}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{max-width:1560px;margin:0 auto;padding:18px 24px 24px}
header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
h1{font-size:21px;margin:0;font-weight:680;letter-spacing:-.01em}
.dateline{color:var(--mut);font-size:13px}
nav{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 10px}
nav button{font:inherit;font-size:14px;padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
nav button[aria-selected=true]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
nav button:focus-visible{outline:2px solid var(--t1);outline-offset:2px}
section h2{font-size:18px;margin:0 0 2px;font-weight:650}
section>p.lead{margin:0 0 8px;color:var(--mut);max-width:1100px}
svg{display:block;width:100%;height:auto;max-height:calc(100vh - 270px);min-height:300px}
.sub{font-weight:650;margin:14px 0 4px;font-size:15px}
figure{margin:0}
.legend{display:flex;gap:22px;flex-wrap:wrap;margin:6px 0 2px;font-size:12.5px;color:var(--mut)}
.legend i{display:inline-block;vertical-align:middle;margin-right:6px}
i.dotm{width:9px;height:9px;border-radius:50%;background:var(--model)}
i.ln{width:26px;height:0;border-top:2px solid var(--arrow)}
i.ln.m{border-top-color:var(--model)}
i.ln.d{border-top-style:dashed}
.cap{margin:4px 0 0;color:var(--mut);font-size:13px;max-width:1200px}
code,.m{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.cap code,.note code,h3 code{font-size:.92em;background:var(--chip);padding:1px 5px;border-radius:5px}
/* svg parts */
.node rect{fill:var(--card);stroke:var(--line);stroke-width:1.3}
.node.t1 rect{fill:var(--t1bg);stroke:var(--t1)}
.node.t2 rect{fill:var(--t2bg);stroke:var(--t2)}
.node.you rect{stroke:var(--fg);stroke-width:1.6}
.node.ghost rect{fill:transparent;stroke-dasharray:5 4;stroke:var(--mut)}
.node.bad rect{fill:var(--badbg);stroke:var(--bad)}
text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
text.h{font-size:13.5px;font-weight:650;fill:var(--fg)}
text.s{font-size:11.5px;fill:var(--mut)}
text.m,text.h.m{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
text.gl{font-size:12px;font-weight:700;letter-spacing:.08em;fill:var(--mut)}
text.lab{font-size:11.5px;fill:var(--fg);paint-order:stroke;stroke:var(--bg);stroke-width:4px;stroke-linejoin:round}
text.lab.am{fill:var(--model)}
.grp rect{fill:none;stroke:var(--line);stroke-width:1.3}
.grp.t1 rect{stroke:var(--t1);opacity:.7}.grp.t1 text{fill:var(--t1)}
.grp.t2 rect{stroke:var(--t2);opacity:.7}.grp.t2 text{fill:var(--t2)}
.grp text{font-size:12px;font-weight:700;letter-spacing:.06em;fill:var(--mut)}
.ar{fill:none;stroke:var(--arrow);stroke-width:1.6}
.ar.d{stroke-dasharray:5 4}
.ar.m{stroke:var(--model)}
.mk{fill:var(--arrow)}.mk.m{fill:var(--model)}
circle.dotm{fill:var(--model)}
/* where */
.cols{display:grid;grid-template-columns:1.25fr 1fr;gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 18px}
.card h3{margin:0 0 8px;font-size:15px}
pre{margin:0;font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow-x:auto}
.note{color:var(--mut);font-size:13px;margin:10px 0 0}
@media (max-width:1000px){.cols{grid-template-columns:1fr}svg{min-width:900px}figure{overflow-x:auto}}
[hidden]{display:none!important}
`;

const body = tabs.map((t, i) => `
<section id="${t.id}" role="tabpanel" aria-labelledby="tab-${t.id}"${i ? ' hidden' : ''}>
 <h2>${esc(t.h)}</h2><p class="lead">${esc(t.p)}</p>
 ${t.id === 'where' ? where : `<figure>${t.fig}</figure>${legend}<p class="cap">${esc(t.cap).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`}
</section>`).join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agentic Coder flow diagram</title>
<style>${css}</style></head>
<body><main>
<header><h1>Agentic Coder: how it works</h1><span class="dateline">a coding agent in your terminal, running a model on this Mac${dated ? ' · 29 Sep 2026' : ''}</span></header>
<nav role="tablist">${tabs.map((t, i) => `<button role="tab" id="tab-${t.id}" aria-controls="${t.id}" aria-selected="${i ? 'false' : 'true'}" data-t="${t.id}">${i + 1} · ${esc(t.name)}</button>`).join('')}</nav>
${body}
</main>
<script>
(function(){
  var tabs=[].slice.call(document.querySelectorAll('nav button'));
  function show(id){
    if(!document.getElementById(id)) id=tabs[0].dataset.t;
    tabs.forEach(function(b){b.setAttribute('aria-selected',String(b.dataset.t===id));});
    [].slice.call(document.querySelectorAll('section')).forEach(function(s){s.hidden=s.id!==id;});
    try{history.replaceState(null,'','#'+id);}catch(e){}
  }
  tabs.forEach(function(b){b.addEventListener('click',function(){show(b.dataset.t);});});
  document.addEventListener('keydown',function(e){
    var i=tabs.findIndex(function(b){return b.getAttribute('aria-selected')==='true';});
    if(e.key==='ArrowRight'&&i<tabs.length-1)show(tabs[i+1].dataset.t);
    if(e.key==='ArrowLeft'&&i>0)show(tabs[i-1].dataset.t);
    var n=parseInt(e.key,10); if(n>=1&&n<=tabs.length)show(tabs[n-1].dataset.t);
  });
  show((location.hash||'').slice(1)||tabs[0].dataset.t);
})();
</script></body></html>`;

writeFileSync(out, html);
console.log('wrote', out, html.length, 'bytes');
