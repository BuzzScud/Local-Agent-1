// Trigger words, quick layer (no model): hundreds of requests built around
// words that steer the sorting (create, add, fix, test, API, story, notes,
// rename, delete, push, sudo, greetings, odd inputs). Checks where each goes
// against where it should, and that nothing throws.
//   node evals/words/sweep.mjs [--json out.json]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { routeByRules } from '../../src/flows/index.mjs';

// Where a request should go: 'question' | 'other' (step by step) | 'fix' |
// 'change' | 'rename' | 'model' (unclear: the model sorts it) | 'any'.
const cases = [];
const add = (text, want, group) => cases.push({ text, want, group });

for (const g of ['hello', 'hi', 'hey', 'thanks', 'thank you', 'ok', 'good morning', 'hello bonsai', 'Hi there!', 'THANKS!!']) add(g, 'question', 'greeting');
for (const doc of ['STORY.txt', 'notes.md', 'README.md', 'the README', 'a text file', 'NOTES.md', 'summary.txt', 'poem.md', 'data.csv']) {
  for (const verb of ['create', 'write', 'add', 'make', 'update', 'CREATE']) add(`${verb} ${doc} with a few lines`, 'other', 'writing');
}
for (const prose of ['a short story', 'a poem', 'a letter to my landlord', 'an email to the team', 'some notes about the API', 'a blog article', 'a summary of the project']) {
  add(`write ${prose}`, 'other', 'writing');
  add(`can you write ${prose}?`, 'other', 'writing');
}
add('CREATE A TXT FILE AND NAME IT "TEST" . ADD A SHORT STORY INSIDE AND ADD IT TO MY DESKTOP WHEN YOU ARE DONE', 'other', 'writing');
add('add notes about the API to NOTES.md', 'other', 'writing');
for (const f of ['utils.js', 'helpers.py', 'TEST', 'a new file named config.json']) add(`create a new file called ${f}`, 'other', 'new file');
add('make a file and call it notes', 'other', 'new file');
for (const q of ['What does the API do?', 'which function handles tax?', 'where is the port set?', 'explain the tests', 'how does export.mjs work?', 'why is it slow?', 'is there an API key in this project?', 'does the test pass?', "Which port does it use? Don't change any files."]) add(q, 'question', 'question');
for (const c of ['add a --json flag to export.mjs', 'add a currency option to formatMoney() in money.mjs', 'implement pagination in list.mjs', 'add a test for median', 'Add titleCase(text) to strings.mjs', 'update the parser to accept dates', 'refactor the API handler in server.mjs', 'write a function that parses dates']) add(c, 'change', 'code change');
for (const f of ['The tests fail. Fix the bug.', 'fix the bug in the csv parser', 'the build is broken', 'it crashes on empty input', "the login doesn't work", 'fix the failing test']) add(f, 'fix', 'fix');
for (const [a, b] of [['calcTotal', 'totalPrice'], ['MAX_ITEMS', 'ITEM_LIMIT'], ['getUser', 'fetchUser']]) add(`rename ${a} to ${b} everywhere`, 'rename', 'rename');
// Renames of words that are also keywords or everywhere in code: never a blind rename.
add('rename export.mjs to exporter.mjs', 'not-rename-keyword', 'risky rename');
add('rename test to check', 'any', 'risky rename');
add('rename the variable i to index', 'rename', 'risky rename');
for (const d of ['run sudo rm -rf / to clean up', 'delete the logs folder', 'kill the node server', 'commit and push to github', 'git reset --hard', 'remove all node_modules', 'drop the database']) add(d, 'any', 'dangerous words');
for (const odd of ['', '   ', 'TEST', 'test', 'api', 'API', '🙂', '???', '/model', '!ls', 'a'.repeat(5000), 'error '.repeat(400), 'fix', 'add', 'create', '“smart quotes” and ‘apostrophes’', 'rename', 'rename x', 'story']) add(odd, 'any', 'odd input');

export function sweep() {
const rows = cases.map((c) => {
  let got; let error = null;
  try { const r = routeByRules(c.text); got = r ? r.kind : 'model'; if (r?.kind === 'rename') got += `:${r.from}->${r.to}`; } catch (e) { error = String(e.message ?? e); got = 'ERROR'; }
  const kind = got.split(':')[0];
  const ok = !error && (c.want === 'any' || kind === c.want || (c.want === 'not-rename-keyword' ? !/^rename:(export|import|function|const|let|var|class|return)->/.test(got) : false));
  return { ...c, text: c.text.length > 120 ? `${c.text.slice(0, 117)}…` : c.text, got, ok, error };
});
const bad = rows.filter((r) => !r.ok);
const byGroup = {};
for (const r of rows) { const g = byGroup[r.group] ??= { total: 0, ok: 0 }; g.total++; if (r.ok) g.ok++; }
return { at: new Date().toISOString(), total: rows.length, ok: rows.length - bad.length, byGroup, bad, rows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
const out = sweep();
const { byGroup, bad } = out;
const i = process.argv.indexOf('--json');
if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(out, null, 1));
console.log(`${out.ok} of ${out.total} went where they should`);
for (const [g, v] of Object.entries(byGroup)) console.log(`  ${g.padEnd(16)} ${v.ok}/${v.total}`);
for (const b of bad) console.log(`  ✗ ${b.group}: "${b.text.slice(0, 70)}" → ${b.got} (want ${b.want})${b.error ? ` ERROR ${b.error}` : ''}`);
}
