// The second watched run of 4 Oct 2026 (Qwen3.6 on a service, a page of the math library): a page
// whose 8 sections showed only their headings was called done; its scripts all began with
// HOME=… python3 and none was saved; Python's open('~/…') failed and the model guessed another home;
// a 35 KB file printed with curl came back cut; the reminder quoted "try again"; and WebFetch, which
// it held, was never called. The owner's picks: read every page as a reader sees it and send a mostly
// empty one back once, run a plain curl of a page as WebFetch outside Bypass, and the rest.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-page-read-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent, requestReminder } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { execute, plainFetch } = await import('../src/agent/tools.mjs');
const { readStatic, readPage, emptyOf, pageReadNote, pageReadLine, canRunPages } = await import('../src/agent/page-read.mjs');
const { heredocScript, saveScript, tildeHint, scriptsDir } = await import('../src/agent/scripts.mjs');
const { lookFacts } = await import('../src/agent/second-look.mjs');
const { toolUseFor } = await import('../src/agent/prompt-files.mjs');
const { MODEL_HOOKS } = await import('../src/agent/way.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

const model = MODELS[DEFAULT_MODEL];
let dir;
beforeEach(() => {
  process.env.AGENTIC_SCRIPTS_DIR = mkdtempSync(join(tmpdir(), 'agentic-scripts-'));
  dir = mkdtempSync(join(tmpdir(), 'agentic-pages-'));
});

// The run's page, small: sections with only a heading, the content inside a script.
const EMPTY_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Math</title></head><body>
<section id="core"><h2>Math Core</h2><div class="content"></div></section>
<section id="matrix"><h2>4×4 Matrix Library</h2><div class="content"></div></section>
<section id="api"><h2>API Summary</h2><div class="content"></div></section>
<script>
// normalizeScientificExpression: ^ → **, pi → Math.PI
${Array.from({ length: 110 }, (_, i) => `// formula ${i}: f${i}(x) = ${i + 2} * x + ${i * 3} - g${i}`).join('\n')}
</script></body></html>`;
const FULL = (t) => `<p>${t}: ${'the formula and what each term means. '.repeat(4)}</p>`;

test('read as text: each section shows only its heading, the script is not on screen', () => {
  const r = readStatic(EMPTY_PAGE);
  expect(r.sections.map((s) => [s.title, s.chars])).toEqual([['Math Core', 9], ['4×4 Matrix Library', 18], ['API Summary', 11]]);
  const e = emptyOf({ ...r, bytes: EMPTY_PAGE.length });
  expect(e).toMatchObject({ of: 3, problem: true });
  const read = { ...r, bytes: EMPTY_PAGE.length };
  expect(pageReadNote('~/Desktop/math.html', read, e)).toContain('~/Desktop/math.html was opened and read before your answer: 3 of its 3 sections show only their heading (Math Core, 4×4 Matrix Library, API Summary)');
  expect(pageReadNote('~/Desktop/math.html', read, e)).toContain('A reader sees almost nothing. Put the content in the page\'s own HTML where a reader sees it');
  expect(pageReadLine('math.html', read, e)).toMatch(/^math\.html: 0 of 3 sections show text, 40 characters on screen of 5\.\d KB$/);
  // A page with text in its sections, or a short page with no sections, is fine.
  const full = readStatic(EMPTY_PAGE.replaceAll('<div class="content"></div>', FULL('x')));
  expect(emptyOf({ ...full, bytes: 5000 }).problem).toBe(false);
  expect(emptyOf({ ...readStatic('<p>hi</p>'), bytes: 9 }).problem).toBe(false);
});

test.skipIf(!canRunPages())('on a Mac, the page is opened in WebKit: its scripts run, what they fill counts, and their errors are kept', async () => {
  const was = process.env.AGENTIC_PAGE_READ;
  process.env.AGENTIC_PAGE_READ = 'on';
  try {
    const p = join(dir, 'filled.html');
    writeFileSync(p, `<!doctype html><html><body><section id="a"><h2>Alpha</h2><div class="c"></div></section><section id="b"><h2>Beta</h2><div class="c"></div></section>
<script>document.querySelector('#a .c').innerHTML = '${FULL('a')}';</script><script>missingFunction();</script></body></html>`);
    const r = await readPage(p);
    expect(r.ran).toBe(true);
    expect(r.sections.find((s) => s.id === 'a').chars).toBeGreaterThan(100);
    expect(r.sections.find((s) => s.id === 'b').chars).toBeLessThan(10);
    expect(r.errors.length).toBe(1);
    expect(pageReadNote('filled.html', r, emptyOf(r))).toContain('Its scripts stopped with an error when it opened (1)');
  } finally { process.env.AGENTIC_PAGE_READ = was; }
}, 30_000);

test('a page the message wrote that is mostly empty goes back once, and is read again after its fix', async () => {
  const was = process.env.AGENTIC_PAGE_READ;
  process.env.AGENTIC_PAGE_READ = 'text';
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'math.html', content: EMPTY_PAGE } } },
    { text: 'Done: math.html has every formula.' },
    { tool: { name: 'Edit', args: { path: 'math.html', old_text: '<section id="core"><h2>Math Core</h2><div class="content"></div></section>\n<section id="matrix"><h2>4×4 Matrix Library</h2><div class="content"></div></section>\n<section id="api"><h2>API Summary</h2><div class="content"></div></section>', new_text: `<section id="core"><h2>Math Core</h2>${FULL('core')}</section>\n<section id="matrix"><h2>4×4 Matrix Library</h2>${FULL('matrix')}</section>\n<section id="api"><h2>API Summary</h2>${FULL('api')}</section>` } } },
    { text: 'Filled: math.html shows each formula now.' },
  ]);
  try {
    const a = new Agent({ url: fake.url, model, cwd: dir, system: systemPrompt({ cwd: dir, git: 'none' }), memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, way: 'model', hooks: ['page-read'], ask: async () => ({ choice: 'yes' }) });
    const notes = [];
    a.on('note', (n) => notes.push(n.text));
    await a.send('make a page with all the formulas, math.html');
    const back = fake.requests[2].messages.at(-1).content;
    expect(back).toContain('math.html was opened and read before your answer: 3 of its 3 sections show only their heading');
    expect(notes.some((t) => /^Page check, .*math\.html: 0 of 3 sections show text, .*; sent back to fill it\.$/.test(t))).toBe(true);
    expect(notes.some((t) => /^Page check, .*math\.html: 3 of 3 sections show text/.test(t))).toBe(true);
    expect(fake.remaining()).toBe(0);
    expect(lookFacts(a.turn).some((f) => /^A page it wrote, opened as a reader sees it: .*math\.html: 3 of 3 sections show text/.test(f))).toBe(true);
  } finally { process.env.AGENTIC_PAGE_READ = was; await fake.close(); }
  expect(MODEL_HOOKS).toContain('page-read');
});

test('scripts with settings before them are saved; ~ in a Python string gets a hint; a long output is kept whole', async () => {
  const body = Array.from({ length: 45 }, (_, i) => `v${i} = ${i}`).join('\n');
  expect(heredocScript(`HOME=/Users/x python3 << 'PYEOF'\n${body}\nPYEOF`)).toMatchObject({ interp: 'python3', ext: 'py' });
  expect(heredocScript(`env A=1 B="two words" node <<EOF\nconsole.log(1)\nEOF`)).toMatchObject({ interp: 'node' });
  expect(saveScript(`HOME=/Users/x python3 << 'PYEOF'\n${body}\nPYEOF`, dir).name).toBe('SCRIPTS/1-script.py');
  expect(tildeHint("FileNotFoundError: [Errno 2] No such file or directory: '~/Desktop/math.html'")).toContain("os.path.expanduser('~/…')");
  expect(tildeHint('all fine')).toBe('');
  const env = { cwd: dir, permissionsNow: () => ({ mode: 'bypass' }), bash: { maxLines: 80 } };
  const r = await execute('Bash', { command: 'seq 1 300' }, {}, env);
  expect(r.text).toContain('(The whole output, 300 lines, is saved as SCRIPTS/out-1.txt: Read it with offset and limit, or find, instead of running the command again.)');
  expect(readFileSync(join(scriptsDir(), 'out-1.txt'), 'utf8').trim().split('\n')).toHaveLength(300);
  const tilde = await execute('Bash', { command: `python3 -c "open('~/no-such-file-here.txt')"` }, {}, env);
  expect(tilde.text).toContain('~ is not the home folder inside a Python or Node string');
});

test('the reminder of a short follow-up says the task it stands for', async () => {
  expect(requestReminder('try again', 'analyze the link and save the math')).toBe('(What the user asked: "analyze the link and save the math"; this message, about that: "try again")');
  expect(requestReminder('try again', 'try again')).toBe('(What the user asked, which this message is for: "try again")');
  const fake = await startFakeServer([{ text: 'It was blocked.' }, { text: 'Trying.' }, { text: 'Again.' }]);
  try {
    const a = new Agent({ url: fake.url, model, cwd: dir, system: systemPrompt({ cwd: dir, git: 'none' }), memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, way: 'model', hooks: [], ask: async () => ({ choice: 'yes' }) });
    await a.send('analyze the link and save all of the math to a page');
    await a.send('try again another way');
    expect(a.turn.task).toBe('analyze the link and save all of the math to a page');
    await a.send('write a new page about the weather in Lisbon this week');
    expect(a.turn.task).toBe('write a new page about the weather in Lisbon this week');
  } finally { await fake.close(); }
});

test('a plain curl or wget of a page is told apart from other commands', () => {
  expect(plainFetch('curl -sL --connect-timeout 10 --max-time 20 http://203.0.113.9:60011/index.html 2>&1 | head -50')).toBe('http://203.0.113.9:60011/index.html');
  expect(plainFetch("curl -s 'https://example.com/q?x=1&y=2'")).toBe('https://example.com/q?x=1&y=2');
  expect(plainFetch('wget -qO- https://example.com/p | tail -20')).toBe('https://example.com/p');
  for (const c of ['curl -sL http://h/a > /tmp/a.js', 'curl -X POST -d x=1 http://h/api', 'wget https://e.com/p', 'curl -sL http://h/a | wc -c', 'curl http://a http://b', 'curl -H "Authorization: x" http://h/a']) expect(plainFetch(c)).toBeNull();
});

test('outside Bypass, with reading pages on, a plain curl runs as WebFetch (asked about as WebFetch is)', async () => {
  const fake = await startFakeServer([{ tool: { name: 'Bash', args: { command: 'curl -sL http://203.0.113.9:60011/index.html | head -100' } } }, { text: 'It was not allowed.' }]);
  const asked = [];
  try {
    const a = new Agent({ url: fake.url, model, cwd: dir, system: systemPrompt({ cwd: dir, git: 'none' }), memory: false, flows: false, verify: false, mode: 'ask', confirmPlan: false, way: 'model', hooks: [], web: { fetch: true }, ask: async (req) => { asked.push(req.name); return { choice: 'no' }; } });
    const notes = [];
    a.on('note', (n) => notes.push(n.text));
    await a.send('read that page');
    expect(notes).toContain('A plain fetch of http://203.0.113.9:60011/index.html: run as WebFetch (commands reach the internet only in Bypass).');
    expect(asked).toEqual(['WebFetch']);
    expect(String(a.messages.find((m) => m.role === 'tool' && !m.opening)?.content)).toStartWith('(Run as WebFetch: commands reach the internet only in Bypass permissions.');
  } finally { await fake.close(); }
});

test('the remote instructions name WebFetch while reading pages is on; the local ones are as they were', () => {
  expect(toolUseFor('remote', undefined, { web: true })).toContain('To read a web page, call WebFetch with its address: it is one of your tools.');
  expect(toolUseFor('remote')).not.toContain('call WebFetch');
  expect(toolUseFor('local', undefined, { web: true })).toBe(toolUseFor('local'));
});
