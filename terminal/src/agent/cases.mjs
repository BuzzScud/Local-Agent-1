// The request's cases, each shown by a test (4 Oct 2026, the owner's pick after the model shootout: four big
// models on a service each wrote plainRead, tested the forms it had built, saw its tests pass and said done,
// while forms the request listed (head -N, tail -N, a pipe, $( ), two files) were never tried: 4, 3, 2 and 0
// parts of 6). The main model writes its plan as the cases, each with an example in backticks (CASES_ASK);
// before its answer stands, every case's example must appear in a test file changed in the message, else it
// goes back twice with the cases still untested, and after that a line names them (agent.mjs, hook 'cases').

// What the model is asked for, with the step that made its first change. The examples are of no task the
// benches set (a first version used task 40's own head -4 and cat | head, which told the models the answer).
export const CASES_ASK = '(Before more changes: write your plan with TodoWrite as the cases this request names, one item each, with an example in backticks and what it should give. For example: `slugify("Hello World")` → "hello-world". Every form the request lists is its own case, and so is each one that must stay as it is (`slugify("")` → "", unchanged). Each case will need a test that tries its example before you are done.)';
export const CASES_FIX = '(Your plan has no examples. Write it again with TodoWrite: one case an item, each with an example in backticks and what it should give, as in `slugify("Hello World")` → "hello-world".)';

// A test file, by its path: in a test folder, or named *.test.*, *.spec.*, *_test.*, test_*.
export const isTestPath = (rel) => /(^|\/)(tests?|__tests__|spec)\//i.test(rel) || /[._-](test|spec)\.[a-z]+$/i.test(rel) || /(^|\/)test_[\w-]+\.[a-z]+$/i.test(rel);

// The plan's cases, { text, example }: on each line of an item, the part in backticks (up to an arrow), or
// with none, what comes before each arrow ("cat FILE → Read FILE, head -N FILE → Read FILE" is two cases,
// "head -n 5 FILE or head -5 FILE → …" two more). Only what looks like code counts: its first word a command
// or a call, not a phrase ("pipe/redirect → runs as typed" is no example).
const ARROW = /\s*(?:→|->|=>)\s*/;
// A command in lower case (cat, head, ls) or a call (slugify(…), a.b(…)); a step of the plan starts with a capital.
// A sentence is no example ("agent.mjs step function output for a mapped plain read."): its test could never be found.
const PROSE = /\b(the|an?|for|with|of|that|when|should|function|output|returns?|in|on|as|by|from|is|to|and|or)\b/gi;
const codeLike = (ex) => { const w = ex.split(/\s+/); return w.length <= 10 && (/^[a-z_$][a-z0-9_.$-]*$/.test(w[0]) || /^[\w.$]+\(/.test(w[0])) && !/[a-z]\.$/i.test(ex) && (ex.replace(/"[^"]*"|'[^']*'/g, '').match(PROSE)?.length ?? 0) < 2; };
export function casesOf(todos = []) {
  const out = [];
  const add = (text, example) => {
    const ex = example.trim().replace(/^[A-Z][\w ]{0,20}:\s+/, '').replace(/^["'`]+|["'`]+$/g, '').trim();
    if (ex.length >= 2 && codeLike(ex) && !out.some((c) => c.example === ex)) out.push({ text, example: ex });
  };
  for (const t of todos ?? []) {
    for (const raw of String(t?.text ?? '').split('\n')) {
      const line = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, '');
      const tick = /`([^`]+)`/.exec(line);
      if (tick) { add(line, tick[1].split(ARROW)[0]); continue; }
      const segs = line.split(ARROW);
      for (let i = 0; i < segs.length - 1; i++) {
        const left = i === 0 ? segs[0] : segs[i].split(/[,;]\s+/).at(-1);
        for (const alt of left.split(/\s+or\s+/)) add(line, alt);
      }
    }
  }
  return out;
}

// The cases a call of their own listed (agent.mjs listCases): what the request asks for (cases) and what
// it says must stay as it is (unchanged), each { example, expect }; those that look like code. MAX_CASES
// in each half: at 20 in all, a request that named some thirty forms lost the last ten, the ones that
// must stay as typed, and every one of eight runs failed that part (4 Oct 2026).
export const MAX_CASES = 25;
// request: an example that calls a function the request names with more arguments than the request gives it
// is left out (5 Oct 2026: asked for plainRead(command, cwd), a list came back as plainRead('cat', ['file.txt'],
// '/home/user'), and the model built and tested that made-up form: 1 part of 6).
export function casesFromList(list, unchanged = [], request = '') {
  const params = (name) => { const m = new RegExp(`(?:^|[^\\w.$])${name.replace(/[.$]/g, '\\$&')}\\(([^()]*)\\)`).exec(request); return m ? (m[1].trim() ? m[1].split(',').length : 0) : null; };
  const madeUp = (example) => {
    const m = /^([\w.$]+)\(([\s\S]*)\)\s*$/.exec(example);
    if (!m) return false;
    const want = params(m[1]);
    if (want == null) return false;
    // its arguments, counted at the top level: commas inside quotes and brackets are not between arguments
    let depth = 0, quote = '', n = m[2].trim() ? 1 : 0;
    for (const ch of m[2]) {
      if (quote) { if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      else if (ch === ',' && depth === 0) n++;
    }
    return n > want;
  };
  const out = [];
  for (const c of [...(Array.isArray(list) ? list.slice(0, MAX_CASES) : []), ...(Array.isArray(unchanged) ? unchanged.slice(0, MAX_CASES) : [])]) {
    const example = String(c?.example ?? '').trim().replace(/^`+|`+$/g, '').split(ARROW)[0].trim();
    const expect = String(c?.expect ?? '').trim();
    // What it gives is said in words: a data shape the list made up ({ name: 'Read', args: ['notes.txt', '-3'] }
    // for "the last N lines, with the right offset") is left to the request (5 Oct 2026: tail read the first lines, twice).
    const gives = !expect || /[{}[\]]/.test(expect) ? 'what the request says for this form' : expect;
    // exact: a listed example is concrete, so a test must use it as written (`cat nonexistent.txt` was passed
    // as tried by a test of a file that is there, and a missing file stayed mapped in both runs).
    if (example.length >= 2 && codeLike(example) && !madeUp(example) && !out.some((x) => x.example === example)) out.push({ text: `\`${example}\` → ${gives}`, example, exact: true });
  }
  return out;
}
// What the request spells out that no listed case uses: a flag (-c, -rn) or a shell sign standing by itself
// (&&, ;, |, >, $( ). A case each, found in a test by the flag as a word, or the sign inside a quoted string
// (stringsOf: `if (a && b)` is the test's own code, not a command it tries)
// (5 Oct 2026: asked for "; or &&", the list came back with the ";" alone, twice, and "&&" is the form all
// eight runs of the night before got wrong; asking the model again for what was missing found nothing).
export function gapCases(request, cases, max = 8) {
  const text = String(request ?? '');
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const used = cases.map((c) => c.example).join('\n');
  const out = [];
  const add = (token, probe, sign) => { if (out.length < max && !out.some((c) => c.example === token)) out.push({ text: `\`${token}\` → the request names it and no case above uses it: add a test that does`, example: token, ...(probe ? { probe } : {}), ...(sign ? { sign } : {}) }); };
  for (const m of text.matchAll(/(?<![\w-])-{1,2}[a-z][a-z-]*(?![\w-])/g)) {
    const flag = `(?<![\\w-])${esc(m[0])}(?![\\w-])`;
    if (!new RegExp(flag).test(used)) add(m[0], flag);
  }
  for (const m of text.matchAll(/(?<=^|[\s(])(&&|\|\||;|\||>>?|<|\$\()(?=$|[\s,.)])/g)) {
    if (!used.includes(m[1])) add(m[1], null, m[1]);
  }
  return out;
}
// One case more in the message's list, unless its example is there already.
export const addCase = (turn, c) => { if (!(turn.cases ??= []).some((x) => x.example === c.example)) turn.cases.push(c); };
// What the model is told: the list, and that each needs a test.
export const casesTold = (cases) => `(The request's cases, as Agentic Coder lists them; before your answer stands, each needs a test that uses its example as written:\n${cases.map((c, i) => `${i + 1}. ${c.text}`).join('\n')}\nPut them in your plan and add a test for each. What each gives is said loosely here: take the exact shape of a result from the request and the code, not from this list. If a case is wrong, say so in one line.)`;

// A pattern that finds the example in a test however its names and numbers were chosen: the command (the
// first word) and its flags stay as they are, with any number for a number (-4 is any -N); every other word
// (a file, a folder, a quoted pattern) is any one word, and there are as many words as the example has, so
// `cat FILE1 FILE2` is not tried by a test of one file, nor `ls DIR` by `ls` alone (4 Oct 2026: both passed
// as tried). A chain, a pipe or a redirect is its left side, its sign and a word after it, whatever the word.
const WORD = `[^\\s'"\\x60,)]+`;
const ANY = `["'\\x60]?${WORD}["'\\x60]?`; // a word, in quotes or not (find src -name '*.mjs')
export function caseProbe(example) {
  const spaced = String(example).replace(/("[^"]*"|'[^']*')|(\|\||&&|[|;<>])/g, (all, quoted, op) => (quoted ? quoted : ` ${op} `));
  const words = spaced.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A number, or N, M or K standing for one (tail -N); a quote of either kind.
  const literal = (w) => (/^-?[NMK]$/.test(w) ? `${w.startsWith('-') ? '-' : ''}\\d+` : esc(w).replace(/\d+/g, '\\d+').replace(/,/g, ',\\s*').replace(/["']/g, `["'\\x60]`));
  // A call may take more arguments in the test than in the example: plainRead('ls') is tried by
  // plainRead('ls', cwd) (4 Oct 2026: Qwen3.6 was sent back twice for a case its tests did try).
  const more = (re) => re.replace(/\\\)$/, '(?:\\s*,[^)]*)?\\)');
  // A call with plain arguments (add(2, 3)): its own text, spaces as they come.
  if (/^[\w.$]+\([^'"\x60]*$/.test(words[0] ?? '')) return new RegExp(more(words.slice(0, 8).map(literal).join('\\s*')));
  const OP = /^(\|\||&&|[|;<>])$/;
  const parts = [];
  for (const [i, w] of words.slice(0, 8).entries()) {
    if (OP.test(w)) { parts.push({ re: esc(w), op: true }, { re: ANY }); break; }
    if (i === 0 && !/^["']/.test(w)) parts.push({ re: /^[\w.$]+\(/.test(w) ? more(literal(w)) : literal(w) });
    else if (/^\$\(/.test(w)) parts.push({ re: `\\$\\(${WORD}` });
    else if (/^-\D/.test(w) || /^-?\d+$/.test(w) || /^[NMK]$/.test(w)) parts.push({ re: literal(w) });
    else if (/^["']/.test(w)) parts.push({ re: `(?:"[^"]*"|'[^']*'|${ANY})`, word: true });
    else parts.push({ re: ANY, word: true });
  }
  // The example's last word ends the command: `grep -rn tax` is not tried by `grep -rn tax src`.
  const end = parts.length > 1 && parts.at(-1).word ? `(?![^\\s'"\\x60,)])(?!["'\\x60]?\\s+[^\\s'"\\x60,)])` : '';
  return new RegExp(`${parts.map((x, i) => (i ? `${x.op || parts[i - 1].op ? '\\s*' : '\\s+'}${x.re}` : x.re)).join('')}${end}`);
}

// The cases whose example no changed test file tries.
// The text of a file's string literals ('…', "…", `…`), each as it stands between its quotes.
function stringsOf(text) {
  const out = [];
  const t = String(text ?? '');
  for (let i = 0; i < t.length; i++) {
    const q = t[i];
    if (q !== '"' && q !== "'" && q !== '`') continue;
    let j = i + 1, s = '';
    while (j < t.length && t[j] !== q && (q === '`' || t[j] !== '\n')) { if (t[j] === '\\' && j + 1 < t.length) { s += t[j + 1]; j += 2; } else s += t[j++]; }
    if (t[j] === q) out.push(s);
    i = j;
  }
  return out;
}
// As written: quotes of any kind alike, spaces as one.
const asWritten = (x) => String(x).replace(/["'\x60]/g, "'").replace(/\s+/g, ' ').trim();
export function untested(cases, testText) {
  let strings = null, whole = null;
  const lits = () => (strings ??= stringsOf(testText));
  const uses = (example) => { const ex = asWritten(example); return lits().some((x) => asWritten(x).includes(ex)) || (whole ??= asWritten(testText)).includes(ex); };
  return cases.filter((c) => (c.sign ? !lits().some((x) => x.includes(c.sign)) : c.exact ? !uses(c.example) : !(c.probe ? new RegExp(c.probe) : caseProbe(c.example)).test(testText)));
}

// What goes back: the cases still without a test, a line each.
export const casesBack = (missing) => `These cases have no test yet: no test file changed in this message uses the example as it is written.\n${missing.map((c, i) => `${i + 1}. ${c.text}`).join('\n')}\nAdd a test for each one that feeds in just that example (make the files or folders it names in the test's own folder), run the tests, then answer. If one cannot be tested, say why in one line.`;

// Case review (agent.mjs reviewCases, the hook 'case-review'; 5 Oct 2026, the owner's pick). With the list
// complete and every case tested, runs still missed parts: the model's own tests held the same slip as its code
// (tail read from the top, and its test expected that), so they passed. Before the answer stands, once a message,
// a call of its own reads the changed code against each case: what the code gives for the example, worked
// through by hand, then whether that is what the request says. The ones that read wrong go back once, marked
// as a read that can be wrong, to be checked by running them.
export const REVIEW_MAX = 40; // the cases one review reads
export const REVIEW_CODE = 24_000; // characters of code it is given (past that, the message's changes instead)
export const REVIEW_SYSTEM = 'You review code against the cases a request specifies. Judge only from the request and the code. Follow the code as written; do not assume it is right.';
export const reviewAsk = ({ request, code, cases }) => `Request:\n${String(request).slice(0, 6000)}\n\nThe code as it is now:\n${code}\n\nCases (an example, then what the request says for it):\n${cases.map((c, i) => `${i + 1}. ${c.text}`).join('\n')}\n\nFor each case, in order:\n- says: what the request says this example must give, in the request's own words.\n- gives: follow the code by hand with the example (which branch runs, what each index, count and offset comes to) and say in one line what the code gives. Where the result depends on a file or other data, take a small one (a file of 12 lines, say) and work the numbers through. Where the case needs a check (a file that is not there, a sign or a flag to turn away), name the line that makes that check; if no line makes it, the code does not.\n- ok: true when gives is what says asks for, false when it is not.`;
export const REVIEW_SCHEMA = (n) => ({ type: 'object', properties: { reviews: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, says: { type: 'string' }, gives: { type: 'string' }, ok: { type: 'boolean' } }, required: ['n', 'says', 'gives', 'ok'] }, maxItems: n } }, required: ['reviews'] });
// A sign the request spells out (gapCases) as an example a review can follow: two of the listed examples joined
// by it, or one sent to a file or put inside $( ).
export function signSample(sign, examples = []) {
  const [a = 'cat notes.txt', b = 'ls'] = examples.filter((x) => /^[a-z]/.test(x) && !/[|;&<>$]/.test(x));
  if (sign === '$(') return `${a.split(/\s+/)[0]} $(echo ${a.split(/\s+/).at(-1)})`;
  if (/^(>>?|<)$/.test(sign)) return `${a} ${sign} out.txt`;
  return `${a} ${sign} ${b}`;
}
// The cases a review read as wrong: { example, text, gives }, eight at most, each once.
export function reviewWrong(reviews, cases) {
  const out = [];
  for (const r of Array.isArray(reviews) ? reviews : []) {
    const c = cases[Number(r?.n) - 1];
    if (!c || r.ok !== false || out.some((x) => x.example === c.example)) continue;
    out.push({ example: c.example, text: c.text, gives: String(r.gives ?? '').replace(/\s+/g, ' ').trim().slice(0, 200), says: String(r.says ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) });
    if (out.length === 8) break;
  }
  return out;
}
export const reviewBack = (wrong, of) => `(A fresh read of your code against the request's cases thinks ${wrong.length} of the ${of} come out wrong. It read the code and did not run it, so it can be wrong:\n${wrong.map((w, i) => `${i + 1}. ${w.text}${w.says ? `\n   the request: ${w.says}` : ''}\n   as read, the code gives: ${w.gives}`).join('\n')}\nCheck each one by running it: a test that expects what the request says, or a short command. Fix what is real, run the tests, then answer; when one is fine as it is, say so in one line.)`;
