// Any file or folder dropped into the window (8 Oct 2026; src/app/attach.mjs, attach-read.mjs,
// src/tools/office.mjs): which paste is a drop, what each kind is, an Excel workbook's rows, a Word
// file's text, a zip's and a folder's list, the chips and cards, what goes to the model (a big one's
// first part and where the rest is), and the model reading what you dropped outside the project and
// nothing else. Pictures and PDFs: attach.test.mjs. The real window: app-vision.test.mjs.
import { test, expect } from 'bun:test';
import { needs } from './needs.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const media = await import('../src/tools/media.mjs');
const O = await import('../src/tools/office.mjs');
const A = await import('../src/app/attach.mjs');
const R = await import('../src/app/attach-read.mjs');
const { droppedFiles, pathsOnly } = await import('../src/agent/images.mjs');
const { expandMentions } = await import('../src/app/app-common.mjs');

const dir = mkdtempSync(join(tmpdir(), 'agentic-attach-files-'));
const fresh = () => ({ n: 0, files: new Map(), info: new Map() });
const esc = (p) => p.replace(/ /g, '\\ ');

// An Excel workbook made by hand: two sheets (one name with &), shared strings (one in two runs),
// a date style, a formula with its saved value, a TRUE, an inline string, a gap row and a gap column.
function workbook(file) {
  const d = mkdtempSync(join(tmpdir(), 'agentic-xlsx-'));
  const put = (rel, text) => { mkdirSync(join(d, rel, '..'), { recursive: true }); writeFileSync(join(d, rel), `<?xml version="1.0"?>${text}`); };
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  put('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  put('xl/workbook.xml', `<workbook ${ns} xmlns:r="${rel}"><sheets><sheet name="Budget &amp; Plan" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  put('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`);
  put('xl/sharedStrings.xml', `<sst ${ns}><si><t>Item</t></si><si><t>Cost</t></si><si><t>Due</t></si><si><r><t>Rent, </t></r><r><t>office</t></r></si><si><t>Paid?</t></si></sst>`);
  put('xl/styles.xml', `<styleSheet ${ns}><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`);
  put('xl/worksheets/sheet1.xml', `<worksheet ${ns}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>4</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>1250.5</v></c><c r="C2" s="1"><v>46304</v></c><c r="D2" t="b"><v>1</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Total</t></is></c><c r="B4"><f>SUM(B2:B3)</f><v>1250.5</v></c></row></sheetData></worksheet>`);
  put('xl/worksheets/sheet2.xml', `<worksheet ${ns}><sheetData><row r="1"><c r="B1" t="str"><v>only B</v></c></row></sheetData></worksheet>`);
  rmSync(file, { force: true }); // zip adds to a file already there
  const r = spawnSync('/usr/bin/zip', ['-qr', file, '.'], { cwd: d });
  if (r.status !== 0) throw new Error('zip failed');
  return file;
}
// A Word file, by macOS's own textutil.
function wordFile(file, text) {
  const txt = `${file}.src.txt`;
  writeFileSync(txt, text);
  const r = spawnSync('/usr/bin/textutil', ['-convert', 'docx', txt, '-output', file]);
  if (r.status !== 0) throw new Error('textutil failed');
  return file;
}

test('a drop is a paste of only paths; words that name a file on the way are not', () => {
  expect(pathsOnly('/Users/me/Desktop/a\\ b.csv ')).toBe(true);
  expect(pathsOnly("'/Users/me/x y.txt' /tmp/z.json")).toBe(true);
  expect(pathsOnly('the bug is in /Users/me/proj/a.js line 4')).toBe(false);
  expect(pathsOnly('   ')).toBe(false);
  const csv = join(dir, 'pick.csv');
  writeFileSync(csv, 'a,b\n');
  // A picture or PDF is found among words as before; any other file only with `any`.
  expect(droppedFiles(`see ${csv}`, dir)).toEqual([]);
  expect(droppedFiles(csv, dir, { any: true })).toEqual([{ raw: csv, path: csv, kind: 'file', sub: 'text' }]);
  expect(droppedFiles(dir, dir, { any: true })[0]).toMatchObject({ kind: 'folder' });
});

test('what each kind is: text by its bytes, Word, Excel, a zip, a folder, a package counted as one file, anything else', () => {
  const k = (name, body) => { const f = join(dir, name); writeFileSync(f, body); return O.fileKind(f); };
  expect(k('notes', 'plain words, no ending')).toEqual({ kind: 'file', sub: 'text' });
  expect(k('page.html', '<p>hi</p>')).toEqual({ kind: 'file', sub: 'text' }); // a web page is code here
  expect(k('blob.bin', Buffer.from([0, 1, 2, 255]))).toEqual({ kind: 'file', sub: 'other' });
  expect(k('ones', Buffer.alloc(300, 1))).toEqual({ kind: 'file', sub: 'other' }); // no NUL, but control characters
  expect(k('film.mp4', 'looks like words')).toEqual({ kind: 'file', sub: 'other' }); // a film is never text
  expect(k('latin.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x6f, 0x6b]))).toEqual({ kind: 'file', sub: 'other' }); // not UTF-8
  expect(k('report.docx', 'x')).toEqual({ kind: 'file', sub: 'doc' });
  expect(k('budget.xlsx', 'x')).toEqual({ kind: 'file', sub: 'sheet' });
  expect(k('a.zip', 'x')).toEqual({ kind: 'file', sub: 'zip' });
  mkdirSync(join(dir, 'Deck.key'), { recursive: true });
  expect(O.fileKind(join(dir, 'Deck.key'))).toEqual({ kind: 'file', sub: 'other' });
  expect(O.fileKind(dir)).toEqual({ kind: 'folder' });
  expect([O.kindLabel('a.docx', 'doc'), O.kindLabel('a.rtf', 'doc'), O.kindLabel('a.xlsx', 'sheet'), O.kindLabel('a.md', 'text'), O.kindLabel('a.csv', 'text'), O.kindLabel('clip.mov', 'other'), O.kindLabel('README', 'text')]).toEqual(['Word', 'RTF', 'Excel', 'Markdown', 'CSV', 'MOV', 'Text']);
});

test('an Excel workbook as rows: shared strings, a date, a formula\'s saved value, TRUE, an inline string, the gaps kept, a comma quoted', () => {
  const file = workbook(join(dir, 'budget.xlsx'));
  expect(O.sheetNames(file)).toEqual(['Budget & Plan', 'Notes']);
  const sheets = O.sheetsOf(file);
  expect(sheets.map((s) => [s.name, s.cols])).toEqual([['Budget & Plan', 4], ['Notes', 2]]);
  expect(sheets[0].rows).toEqual(['Item,Cost,Due,Paid?', '"Rent, office",1250.5,2026-10-09,TRUE', '', 'Total,1250.5']);
  expect(sheets[1].rows).toEqual([',only B']);
  expect(R.sheetsText(file)).toBe('--- sheet "Budget & Plan": 4 rows × 4 columns ---\nItem,Cost,Due,Paid?\n"Rent, office",1250.5,2026-10-09,TRUE\n\nTotal,1250.5\n\n--- sheet "Notes": 1 row × 2 columns ---\n,only B');
  expect(() => O.sheetsOf(join(dir, 'blob.bin'))).toThrow();
});

test('a Word file\'s text by textutil; a zip\'s names; a folder walked in order, node_modules named and not gone into', () => {
  const doc = wordFile(join(dir, 'memo.docx'), 'Quarterly notes\nRevenue up 4%\n');
  expect(O.docText(doc)).toBe('Quarterly notes\nRevenue up 4%\n');
  expect(O.wordCount(O.docText(doc))).toBe(5);
  const zip = join(dir, 'two.zip');
  spawnSync('/usr/bin/zip', ['-q', zip, 'pick.csv', 'notes'], { cwd: dir });
  expect(O.zipNames(zip)).toEqual(['pick.csv', 'notes']);
  const proj = join(dir, 'proj');
  mkdirSync(join(proj, 'src'), { recursive: true });
  mkdirSync(join(proj, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(proj, 'src', 'a.js'), 'console.log(1)\n');
  writeFileSync(join(proj, 'node_modules', 'x', 'i.js'), 'x');
  writeFileSync(join(proj, 'README.md'), '# hi\n');
  const w = O.walkFolder(proj);
  expect([w.files, w.bytes, w.cut]).toEqual([2, 20, false]);
  expect(w.entries.map((e) => e.rel)).toEqual(['node_modules', 'README.md', 'src', 'src/a.js']);
  expect(R.folderList(proj).text).toBe('node_modules/ (not listed)\nREADME.md (5 B)\nsrc/\n  a.js (15 B)');
  expect(O.walkFolder(proj, { max: 2 }).cut).toBe(true);
  expect(O.lineCount(join(proj, 'src', 'a.js'))).toBe(1);
  expect(O.lineCount(join(dir, 'notes'))).toBe(1); // no newline at the end still counts
});

test.skipIf(needs('pictures', media.mediaTool))('a drop of every kind: chips at once, each copied but the folder, cards that say what each holds from Quick Look\'s own thumbnail; words with a path keep it', () => {
  const src = mkdtempSync(join(tmpdir(), 'agentic-drop-'));
  const book = workbook(join(src, 'budget.xlsx'));
  const doc = wordFile(join(src, 'memo.docx'), 'Quarterly notes\nRevenue up 4%\n');
  const csv = join(src, 'data set.csv');
  writeFileSync(csv, 'a,b\n1,2\n3,4\n');
  const film = join(src, 'clip.mov');
  writeFileSync(film, Buffer.alloc(3000, 1));
  const folder = join(dir, 'proj');
  const pasted = fresh();
  const r = A.attachDropped(`${[book, doc, csv, film, folder].map(esc).join(' ')} `, { cwd: src, pasted, dir: join(src, 'att'), id: 'd1' });
  expect(r.failed).toEqual([]);
  expect(r.text).toBe('[File #1] [File #2] [File #3] [File #4] [Folder #5] ');
  expect(r.added.map((a) => A.compactText(a))).toEqual([
    '▣ [File #1] budget.xlsx · Excel · 2 sheets · ' + A.fmtBytes(readFileSync(book).length),
    '▣ [File #2] memo.docx · Word · ~5 words · ' + A.fmtBytes(readFileSync(doc).length),
    '▣ [File #3] data set.csv · CSV · 3 lines · 12 B',
    '▣ [File #4] clip.mov · MOV · 3 KB',
    '▣ [Folder #5] proj · Folder · 2 files · 20 B',
  ]);
  expect(pasted.files.get(3)).toBe(join(src, 'att', 'd1-3.csv'));
  expect(pasted.files.get(5)).toBe(folder); // a folder stays where it is
  expect(pasted.info.get(5).stays).toBe(true);
  expect(r.added[1].thumb.w).toBeGreaterThan(0); // the document's first page
  expect(r.added[4].thumb.icon).toBe(true); // a folder: its icon
  expect(A.cardLines(r.added[0])).toEqual(['[File #1]', 'budget.xlsx', expect.stringMatching(/^Excel · 2 sheets · /), 'ctrl+f: open full size']);
  // The tray lists them by their chips (the token's word gives the kind when nothing was kept).
  expect(A.trayItems('[Folder #5] and [File #9]', { ...pasted, info: new Map() }).map((i) => [i.kind, i.n])).toEqual([['folder', 5]]);
  // Pasted words that name a file on the way: the path stays a path.
  const words = A.attachDropped(`the bug is in ${csv.replace(/ /g, '\\ ')} see`, { cwd: src, pasted, dir: join(src, 'att'), id: 'd1' });
  expect(words.added).toEqual([]);
  expect(pasted.n).toBe(5);
});

test.skipIf(needs('pictures', media.mediaTool))('what the model gets: text numbered, a Word file\'s and a workbook\'s text, a zip\'s and a folder\'s list, a film by name; where each came from; what it may read', () => {
  const src = mkdtempSync(join(tmpdir(), 'agentic-model-'));
  const book = workbook(join(src, 'budget.xlsx'));
  const doc = wordFile(join(src, 'memo.docx'), 'Quarterly notes\nRevenue up 4%\n');
  const csv = join(src, 'data.csv');
  writeFileSync(csv, 'a,b\n1,2\n');
  const zip = join(src, 'two.zip');
  spawnSync('/usr/bin/zip', ['-q', zip, 'data.csv'], { cwd: src });
  const film = join(src, 'clip.mov');
  writeFileSync(film, Buffer.alloc(3000, 1));
  const folder = join(dir, 'proj');
  const pasted = fresh();
  const r = A.attachDropped([book, doc, csv, zip, film, folder].join(' '), { cwd: src, pasted, dir: join(src, 'att'), id: 'm1' });
  const from = new Map([...pasted.info].filter(([, a]) => a.from).map(([n, a]) => [n, a.from]));
  const out = expandMentions(`look at ${r.text}`, src, 10_000, pasted.files, from);
  expect(out.images).toEqual([]);
  expect(out.text).toContain(`<file path="${book}" kind="Excel, 2 sheets">\n--- sheet "Budget & Plan": 4 rows × 4 columns ---\nItem,Cost,Due,Paid?`);
  expect(out.text).toContain(`<file path="${doc}" kind="Word, ~5 words">\nQuarterly notes\nRevenue up 4%\n`);
  expect(out.text).toContain(`<file path="${csv}">\n    1\ta,b\n    2\t1,2\n</file>`);
  expect(out.text).toContain(`<file path="${zip}" kind="zip, 1 file">\ndata.csv\n</file>`);
  expect(out.text).toContain(`([File #5] is ${film}: a MOV file, 3 KB. It is not text, so none of it is shown here; the file is ${join(src, 'att', 'm1-5.mov')}.)`);
  expect(out.text).toContain(`<folder path="${folder}">\nnode_modules/ (not listed)\nREADME.md (5 B)\nsrc/\n  a.js (15 B)\n</folder>`);
  expect(out.text).toContain(`([File #3] is ${csv}, dropped into the window.)`);
  expect(out.text).not.toContain('[Folder #6] is ' + folder + ', dropped'); // a folder's own line says where
  expect(out.attached.map((a) => [a.chip, a.label])).toEqual([[1, 'Excel, 2 sheets'], [2, 'Word, ~5 words'], [3, '2 lines'], [4, 'zip, 1 file'], [5, 'MOV file, 3 KB, not read'], [6, 'folder, 2 files']]);
  expect(out.reads).toEqual([...[1, 2, 3, 4, 5].map((n) => pasted.files.get(n)), folder]);
  // @report.docx in the project: its text, where before a file that is not text was left out.
  const inProject = expandMentions('read @memo.docx', src, 10_000);
  expect(inProject.text).toContain('Revenue up 4%');
  expect(inProject.attached).toEqual([{ path: 'memo.docx', label: 'Word, ~5 words' }]);
});

test('a big one sends its first part and says where the rest is: a log by lines, a Word file\'s text saved beside the attachments', () => {
  const src = mkdtempSync(join(tmpdir(), 'agentic-big-'));
  const log = join(src, 'server.log');
  writeFileSync(log, Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join('\n'));
  const f = R.fileForModel(log, { token: '[File #1]', shown: '~/server.log', maxChars: 100_000 });
  expect(f.label).toBe('5,000 lines');
  expect(f.text).toContain('  400\tline 400\n</file>');
  expect(f.text).not.toContain('  401\tline 401');
  expect(f.text).toContain(`([File #1]: lines 1–400 of 5,000 above. The whole file is ${log}: Read it from line 401 for the rest.)`);
  // Cut shorter by the size a result may have.
  expect(R.fileForModel(log, { token: '[File #1]', maxChars: 200 }).text).toMatch(/lines 1–\d+ of 5,000 above/);
  const doc = wordFile(join(src, 'long.docx'), 'word '.repeat(3000));
  const textDir = join(src, 'texts');
  const d = R.fileForModel(doc, { token: '[File #2]', maxChars: 1000, textDir });
  expect(d.label).toBe('Word, ~3,000 words');
  expect(d.reads).toEqual([doc, join(textDir, 'long.docx.txt')]);
  expect(readFileSync(join(textDir, 'long.docx.txt'), 'utf8')).toBe(O.docText(doc));
  expect(d.text).toContain(`([File #2]: the first 1,000 of 15,001 characters of its text above. All of it is in ${join(textDir, 'long.docx.txt')}: Read it for the rest.)`);
  // Small enough: no file saved, nothing said about a rest.
  const small = R.fileForModel(wordFile(join(src, 'short.docx'), 'hi there'), { token: '[File #3]', textDir });
  expect(small.text).not.toContain('Read it for the rest');
  expect(existsSync(join(textDir, 'short.docx.txt'))).toBe(false);
});

test('the model reads a dropped file where it is, outside the project; it may not change it, and other files outside stay refused', async () => {
  const { Agent } = await import('../src/agent/agent.mjs');
  const { systemPrompt } = await import('../src/agent/prompt.mjs');
  const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');
  const { startFakeServer } = await import('./fake-server.mjs');
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-fence-'));
  writeFileSync(join(cwd, 'a.txt'), 'inside\n');
  const away = mkdtempSync(join(tmpdir(), 'agentic-away-'));
  const dropped = join(away, 'dropped.csv');
  const other = join(away, 'other.csv');
  writeFileSync(dropped, 'secret,of,the,drop\n');
  writeFileSync(other, 'not yours to read\n');
  const folder = join(away, 'folder');
  mkdirSync(folder);
  writeFileSync(join(folder, 'in.txt'), 'in the folder\n');
  const fake = await startFakeServer([
    { tool: { name: 'Read', args: { path: dropped } } },
    { tool: { name: 'Read', args: { path: join(folder, 'in.txt') } } },
    { tool: { name: 'Read', args: { path: other } } },
    { tool: { name: 'Edit', args: { path: dropped, old_text: 'secret', new_text: 'changed' } } },
    { text: 'Done.' },
  ]);
  const tools = [];
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, ctx: 32768, mode: 'edits', flows: false, way: 'model', hooks: [], verify: false, ask: async () => ({ choice: 'yes' }) });
  agent.on('tool', (e) => tools.push(e));
  agent.allowAttached([dropped, folder]);
  try { await agent.send('what is in the file I dropped?'); } finally { await fake.close(); }
  const result = (i) => [tools[i].name, Boolean(tools[i].error)];
  expect([0, 1, 2, 3].map(result)).toEqual([['Read', false], ['Read', false], ['Read', true], ['Edit', true]]);
  expect(readFileSync(dropped, 'utf8')).toBe('secret,of,the,drop\n');
  expect(agent.attachedOpen('Bash', dropped)).toBe(false);
  expect(agent.attachedOpen('List', folder)).toBe(true);
  expect(agent.attachedOpen('Read', `${folder}-not`)).toBe(false); // a neighbour whose name starts the same
}, 30_000);
