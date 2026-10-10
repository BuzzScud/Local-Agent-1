// A folder of data and long scripts (4 Oct 2026, the owner's picks after a backtest run on their
// service): what a folder says about itself goes with the request, the names the request uses are
// matched against it (and you are asked when the folder does not settle one), a table's outline
// says what its rows hold, a long heredoc script is saved as SCRIPTS/… with the line it stopped at,
// the files a command writes are said and checked, a second look that names nothing asks again,
// and thinking is not cut while steps keep failing.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-data-folders-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { execute, resolvePath } = await import('../src/agent/tools.mjs');
const { folderKind, folderCard, namesInRequest, namesQuestion, requestWords } = await import('../src/agent/folder.mjs');
const { heredocScript, saveScript, failingLine, scriptsDir } = await import('../src/agent/scripts.mjs');
const { pathsNamed, filesMade } = await import('../src/agent/made.mjs');
const { tableProfile, outlineText } = await import('../src/tools/outline.mjs');
const { secondLook, lookFacts } = await import('../src/agent/second-look.mjs');
const { decide } = await import('../src/agent/permissions.mjs');
const { LOOK_NOTE_DATA } = await import('../src/agent/look.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

const model = { ...MODELS[DEFAULT_MODEL], remote: { model: 'big-coder' } };
let dir;
beforeEach(() => {
  process.env.AGENTIC_SCRIPTS_DIR = mkdtempSync(join(tmpdir(), 'agentic-scripts-'));
  dir = mkdtempSync(join(tmpdir(), 'agentic-data-'));
});

// A folder of contract exports like the owner's: one folder a contract, an hourly file in each.
function exportsFolder({ manifest = false } = {}) {
  for (const c of ['CON.F.US.ENQ.Z26', 'CON.F.US.MNQ.Z26', 'CON.F.US.EP.Z26', 'CON.F.US.MES.Z26', 'CON.F.US.NQG.X26']) {
    mkdirSync(join(dir, c));
    writeFileSync(join(dir, c, '1h.csv'), 'ts,open,high,low,close,volume\n2026-09-01T13:00:00Z,1,1,1,1,10\n2026-09-01T14:00:00Z,1,1,1,1,10\n');
  }
  if (manifest) {
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version: 1, provider: 'projectx', columns: ['ts', 'open', 'close'], splice_rule: { front_month: 'highest volume on the day' }, instruments: [
      { contract: 'CON.F.US.ENQ.Z26', display: 'NQZ6 · E-mini NASDAQ-100: December 2026', root: 'ENQ' },
      { contract: 'CON.F.US.EP.Z26', display: 'ESZ6 · E-Mini S&P 500: December 2026', root: 'EP' },
      { contract: 'CON.F.US.MNQ.Z26', display: 'CON.F.US.MNQ.Z26', root: 'MNQ' },
      { contract: 'CON.F.US.MES.Z26', display: 'CON.F.US.MES.Z26', root: 'MES' },
      { contract: 'CON.F.US.NQG.X26', display: 'QGX6 · E-Mini Natural Gas: November 2026', root: 'NQG' },
    ] }, null, 2));
  }
  return dir;
}
const REQUEST = 'can we backtest this on the nq and es data in the folder here : /Users/x/Downloads/projectx ? create a self contained html file';

test('a folder is code, data or other; a small project with two code files is code', () => {
  expect(folderKind(exportsFolder())).toBe('data');
  const code = mkdtempSync(join(tmpdir(), 'agentic-code-'));
  writeFileSync(join(code, 'export.mjs'), 'x'); writeFileSync(join(code, 'export.test.mjs'), 'x'); writeFileSync(join(code, 'trades.json'), '[]');
  expect(folderKind(code)).toBe('code');
  expect(folderKind(mkdtempSync(join(tmpdir(), 'agentic-empty-')))).toBe('other');
});

test("the folder's manifest: plain values, small objects, and an index of its named items", () => {
  const card = folderCard(exportsFolder({ manifest: true }));
  expect(card.files).toEqual(['manifest.json']);
  expect(card.text).toContain('version: 1 · provider: "projectx"');
  expect(card.text).toContain('columns: ts, open, close');
  expect(card.text).toContain('splice_rule: front_month highest volume on the day');
  expect(card.text).toContain('instruments: a list of 5, each with contract, display, root');
  expect(card.text).toContain('CON.F.US.ENQ.Z26 — NQZ6 · E-mini NASDAQ-100: December 2026');
  expect(card.labels.get('CON.F.US.EP.Z26')).toBe('ESZ6 · E-Mini S&P 500: December 2026');
  writeFileSync(join(dir, 'README.md'), '# Exports\nOne folder a contract.\n');
  expect(folderCard(dir).files).toEqual(['README.md', 'manifest.json']);
  expect(folderCard(mkdtempSync(join(tmpdir(), 'agentic-none-')))).toBeNull();
});

test('names in the request: settled by the manifest, near ones named apart; unclear without it', () => {
  expect(requestWords(REQUEST)).toEqual(['nq', 'es']); // no paths, no common words
  exportsFolder({ manifest: true });
  const settled = namesInRequest(REQUEST, dir, { labels: folderCard(dir).labels });
  expect(settled.unclear).toEqual([]);
  expect(settled.matched).toEqual([{ word: 'nq', to: 'ENQ' }, { word: 'es', to: 'EP' }]);
  expect(settled.note).toContain('"nq" → ENQ: CON.F.US.ENQ.Z26 (NQZ6 · E-mini NASDAQ-100: December 2026). Near it, not the same:');
  expect(settled.note).toContain('MNQ: CON.F.US.MNQ.Z26');
  const loose = namesInRequest(REQUEST, dir);
  expect(loose.unclear.map((u) => u.word)).toEqual(['nq', 'es']);
  const q = namesQuestion(loose.unclear[0]);
  expect(q.question).toMatch(/^Your request says "nq"\. In this folder that could be /);
  expect(q.options.at(-1)).toBe('All of them');
  expect(namesQuestion(loose.unclear[1]).question).toBe('Your request says "es". The closest name in this folder is MES. Is that the one?');
});

test('a table outline says what its rows hold: range, usual step, gaps, rows a month, the thin share', () => {
  const rows = ['2025-10-01T17:00:00Z,1', '2025-11-14T15:00:00Z,1'];
  for (let d = 1; d <= 20; d++) for (let h = 13; h < 20; h++) rows.push(`2026-06-${String(d).padStart(2, '0')}T${h}:00:00Z,${1000 + d}`);
  const csv = `ts,volume\n${rows.join('\n')}\n`;
  const p = tableProfile(csv, 'bars.csv');
  expect(p).toContain('What the rows hold (worked out from all 142):');
  expect(p).toContain('ts: 2025-10-01 17:00 → 2026-06-20 19:00; usual step 1h');
  expect(p).toContain('longest gaps 199d after 2025-11-14 15:00, 44d after 2025-10-01 17:00');
  expect(p).toContain('rows by month: 2025-10 1 · 2025-11 1 · 2026-06 140');
  expect(outlineText(csv.repeat(1), 'bars.csv')).toContain('rows by month');
  const thin = tableProfile(`ts,volume\n${Array.from({ length: 30 }, (_, i) => `2026-06-01T${String(i % 24).padStart(2, '0')}:00:00Z,${i < 10 ? 1 : 900}`).join('\n')}`, 'v.csv');
  expect(thin).toContain('volume 1 … 900 (median 900; 33% of rows under a tenth of it)');
  // JSON lines with a header line: the records are profiled, the header said apart.
  const nd = [JSON.stringify({ meta: { version: 1 } }), ...Array.from({ length: 5 }, (_, i) => JSON.stringify({ ts: `2026-06-01T1${i}:00:00Z`, close: 10 + i }))].join('\n');
  expect(tableProfile(nd, 'b.ndjson')).toContain('close 10 … 14 (median 12)');
  expect(outlineText(`${nd}\n`.repeat(200).trim(), 'b.ndjson')).toContain('a header line with meta');
});

test('a long heredoc script is saved as SCRIPTS/…; its failing line comes back; the file runs and edits', async () => {
  const body = ['import json', ...Array.from({ length: 41 }, (_, i) => `x${i} = ${i}`), 'print("=== MNQ ===")', 'res = "x".get("A")'].join('\n');
  const command = `python3 - <<'PYEOF'\n${body}\nPYEOF`;
  expect(heredocScript(command)).toMatchObject({ interp: 'python3', ext: 'py' });
  expect(heredocScript("cat > a.txt <<'EOF'\nhi\nEOF")).toBeNull(); // writing a file is not a script
  expect(saveScript(`python3 - <<'E'\nprint(1)\nE`, dir)).toBeNull(); // short: not saved
  const env = { cwd: dir, permissionsNow: () => ({ mode: 'auto' }) };
  const r = await execute('Bash', { command }, {}, env);
  expect(r.error).toBe(true);
  expect(r.saved.name).toBe('SCRIPTS/1-script.py');
  expect(r.text).toContain("AttributeError: 'str' object has no attribute 'get'");
  expect(r.text).toContain('Line 44 of SCRIPTS/1-script.py, where it stopped:\n  42 | x40 = 40\n  43 | print("=== MNQ ===")\n→ 44 | res = "x".get("A")');
  expect(r.text).toContain('(The script is saved as SCRIPTS/1-script.py, 44 lines. To change it, Edit SCRIPTS/1-script.py, then run `python3 SCRIPTS/1-script.py`. Do not send the whole script again.)');
  expect(readdirSync(scriptsDir())).toEqual(['1-script.py']);
  // The same script again is not saved twice.
  expect((await execute('Bash', { command }, {}, env)).text).toContain('This is the script saved before as SCRIPTS/1-script.py');
  // SCRIPTS/… is a path like the project's own: inside, and not one of the app's own files.
  const at = resolvePath(dir, 'SCRIPTS/1-script.py');
  expect(at).toMatchObject({ inside: true, scripts: true, abs: join(scriptsDir(), '1-script.py') });
  expect(decide('Edit', { path: 'SCRIPTS/1-script.py' }, { mode: 'bypass', inside: true, rel: 'SCRIPTS/1-script.py' }).decision).toBe('allow');
  writeFileSync(at.abs, readFileSync(at.abs, 'utf8').replace('res = "x".get("A")', 'print("ok")'));
  const again = await execute('Bash', { command: 'python3 SCRIPTS/1-script.py' }, {}, env);
  expect(again.error).toBe(false);
  expect(again.text).toBe('=== MNQ ===\nok');
  // A traceback that names the file says it as SCRIPTS/…, with the line.
  writeFileSync(at.abs, 'x = 1\nraise ValueError("bad")\n');
  const bad = await execute('Bash', { command: 'python3 SCRIPTS/1-script.py' }, {}, env);
  expect(bad.text).toContain('File "SCRIPTS/1-script.py", line 2');
  expect(bad.text).not.toContain(scriptsDir());
  expect(bad.text).toContain('→ 2 | raise ValueError("bad")');
  // A longer path that is not there, ending in SCRIPTS/…, means that saved file.
  expect(resolvePath(dir, '/elsewhere/worktrees/x/SCRIPTS/1-script.py')).toMatchObject({ inside: true, scripts: true, rel: 'SCRIPTS/1-script.py', abs: at.abs });
  expect(resolvePath(dir, 'other/SCRIPTS/1-script.py').abs).toBe(at.abs);
  expect(resolvePath(dir, '/elsewhere/SCRIPTS/no-such.py').scripts).toBeUndefined();
  // A project with a SCRIPTS folder of its own keeps it.
  mkdirSync(join(dir, 'SCRIPTS'));
  expect(resolvePath(dir, 'SCRIPTS/1-script.py').abs).toBe(join(dir, 'SCRIPTS', '1-script.py'));
  expect(failingLine('Error at x', { cwd: dir })).toBe('');
});

test('the files a command wrote: named in its words (quoted, with spaces) or new at the top of a folder', async () => {
  expect(pathsNamed(`python3 x.py > "out dir/report.html"; cp a.csv ~/Desktop/b.csv`, { cwd: '/p', home: '/h' })).toEqual(['/p/out dir/report.html', '/p/x.py', '/p/a.csv', '/h/Desktop/b.csv']);
  const since = Date.now();
  mkdirSync(join(dir, 'out dir'));
  writeFileSync(join(dir, 'out dir', 'report.html'), '<p>x</p>');
  writeFileSync(join(dir, 'top.csv'), 'a\n');
  const made = filesMade('python3 x.py > "out dir/report.html"', { since, cwd: dir, home: '/h', dirs: [dir] });
  expect(made.map((f) => f.abs).sort()).toEqual([join(dir, 'out dir', 'report.html'), join(dir, 'top.csv')]);
});

// 7 Oct 2026: a page another session wrote on the Desktop while a command ran was said to be the command's.
test('on the Desktop, a new file is the command\'s only when the command, its output or its script names it', () => {
  const desk = mkdtempSync(join(tmpdir(), 'agentic-desk-'));
  const since = Date.now();
  writeFileSync(join(dir, 'make_page.py'), "from pathlib import Path\n(Path.home() / 'Desktop' / 'es-report.html').write_text('<p>es</p>')\n");
  utimesSync(join(dir, 'make_page.py'), new Date(since - 60_000), new Date(since - 60_000)); // written before the command
  for (const n of ['es-report.html', 'other-session-review.html', 'printed.csv', 'summary.html']) writeFileSync(join(desk, n), 'x');
  const at = (command, more = {}) => filesMade(command, { since, cwd: dir, home: '/h', dirs: [dir, desk], shared: [desk], ...more }).map((f) => f.abs.split('/').pop()).sort();
  expect(at('python3 make_page.py')).toEqual(['es-report.html']); // its script names it
  expect(at('python3 make_page.py', { said: 'saved printed.csv' })).toEqual(['es-report.html', 'printed.csv']); // its output does
  expect(at("python3 -c \"name = 'summary'; open(f'{name}.html', 'w')\"")).toEqual(['summary.html']); // its name without the ending
  expect(at('npm run build')).toEqual([]); // nothing names another session's page
  // A folder that is not shared keeps every new file at its top.
  expect(filesMade('npm run build', { since, cwd: dir, home: '/h', dirs: [desk] }).length).toBe(4);
});

// A run on a scripted model in the exports folder: what went with the request, what was asked.
async function run(request, replies, { answer = null, extra = {} } = {}) {
  const fake = await startFakeServer(replies, { delayMs: 0 });
  const asked = [];
  try {
    const a = new Agent({ url: fake.url, model, cwd: dir, system: systemPrompt({ cwd: dir, git: 'none' }), memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, way: 'model', hooks: [],
      ask: async (req) => { asked.push(req); return req.kind === 'names' && answer ? { choice: 'answer', text: answer } : { choice: 'yes' }; }, ...extra });
    const notes = [];
    a.on('note', (n) => notes.push(n.text));
    await a.send(request);
    const sent = fake.requests[0].messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    return { a, asked, notes, sent, tools: a.messages.filter((m) => m.role === 'tool' && !m.opening).map((m) => String(m.content)) };
  } finally { fake.close(); }
}

test("with a manifest, the folder's own words and the names go with the request, and nothing is asked", async () => {
  exportsFolder({ manifest: true });
  const r = await run(REQUEST, [{ text: 'I will use ENQ and EP.' }]);
  expect(r.asked.filter((q) => q.kind === 'names')).toEqual([]);
  expect(r.sent).toContain('What this folder says about itself (manifest.json; Read the file for the rest):');
  expect(r.sent).toContain('"nq" → ENQ: CON.F.US.ENQ.Z26');
  expect(r.notes).toContain("Read the folder's manifest.json · names in your request: nq → ENQ, es → EP");
  // The second request in the same folder: the names again, not the card.
  const fake = await startFakeServer([{ text: 'ok' }], { delayMs: 0 });
  try {
    r.a.url = fake.url;
    await r.a.send('and the es data only?');
    const second = fake.requests[0].messages.filter((m) => m.role === 'user').at(-1).content;
    expect(second).toContain('"es" → EP');
    expect(second).not.toContain('What this folder says about itself');
  } finally { fake.close(); }
});

test('without one, an unclear name is asked about once, and the answer goes to the model', async () => {
  exportsFolder();
  const r = await run('backtest the nq data please', [{ text: 'Using ENQ.' }], { answer: 'ENQ' });
  const q = r.asked.filter((x) => x.kind === 'names');
  expect(q).toHaveLength(1);
  expect(q[0].args.question).toContain('Your request says "nq"');
  expect(r.sent).toContain('The user says "nq" means ENQ (CON.F.US.ENQ.Z26).');
});

test('a page a command wrote is said in its result and goes to the second look; a saved script may be edited at once', async () => {
  exportsFolder();
  const body = Array.from({ length: 45 }, (_, i) => `v${i} = ${i}`).join('\n');
  const r = await run('make a report page from the es data', [
    { tool: { name: 'Bash', args: { command: `python3 - <<'PYEOF'\n${body}\nopen('report.html', 'w').write('<p>es</p>')\nPYEOF` } } },
    { tool: { name: 'Edit', args: { path: 'SCRIPTS/1-script.py', old_text: 'v0 = 0', new_text: 'v0 = 1' } } },
    { text: 'The page is report.html.' },
  ]);
  expect(r.tools[0]).toContain(`(This command wrote ${join(dir, 'report.html')} (9 bytes).)`);
  expect(r.tools[0]).toContain('The script is saved as SCRIPTS/1-script.py');
  expect(r.tools[1]).toContain('Updated SCRIPTS/1-script.py');
  expect(readFileSync(join(scriptsDir(), '1-script.py'), 'utf8')).toContain('v0 = 1');
  expect(r.a.madePages()).toEqual(['report.html']);
  expect(lookFacts(r.a.turn)).toContain(`Files its commands wrote: ${join(dir, 'report.html')}.`);
});

test('a data folder gets its own Look first words', async () => {
  exportsFolder();
  const r = await run('backtest the es data', [{ text: 'ok' }], { answer: 'MES', extra: {} });
  expect(r.a.turn.folder).toBeTruthy();
  r.a.look = '15';
  const fake = await startFakeServer([{ text: 'ok' }], { delayMs: 0 });
  try { r.a.url = fake.url; await r.a.send('now the nq data'); expect(r.a.turn.look.notes).toBe(LOOK_NOTE_DATA); } finally { fake.close(); }
});

test('a second look that finds the answer wrong but names nothing is asked again; still nothing, it says so', async () => {
  const answers = (...rs) => { let i = 0; return async () => ({ json: rs[i++] }); };
  const named = await secondLook({ ask: answers({ verdict: 'wrong', problems: [] }, { verdict: 'wrong', problems: ['The chart says WRONG in green.'] }), answer: 'done' });
  expect(named).toMatchObject({ ok: false, problems: ['The chart says WRONG in green.'] });
  const none = await secondLook({ ask: answers({ verdict: 'wrong', problems: [] }, { verdict: 'wrong', problems: [] }), answer: 'done' });
  expect(none).toMatchObject({ failed: true, reason: 'the check thought the answer may not hold, but named nothing, twice' });
  expect(await secondLook({ ask: answers({ verdict: 'wrong', problems: [] }, { verdict: 'ok', problems: [] }), answer: 'done' })).toMatchObject({ ok: true });
});

test('thinking is not cut at half the time while steps keep failing', () => {
  const a = new Agent({ url: 'http://127.0.0.1:9', model, cwd: dir, system: 's', memory: false, flows: false, thinkBudgetSecs: 10 });
  a.thinking = true;
  a.requestStarted = Date.now() - 6000;
  a.turn = { errorsInRow: 2 };
  expect(a.steppedDown()).toBe(false);
  a.turn.errorsInRow = 0;
  expect(a.steppedDown()).toBe(true);
});
