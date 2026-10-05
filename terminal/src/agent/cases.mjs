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
const codeLike = (ex) => { const w = ex.split(/\s+/); return w.length <= 10 && (/^[a-z_$][a-z0-9_.$-]*$/.test(w[0]) || /^[\w.$]+\(/.test(w[0])); };
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

// The cases a call of their own listed ({ example, expect }, agent.mjs listCases): those that look like code.
export const MAX_CASES = 20;
export function casesFromList(list) {
  const out = [];
  for (const c of Array.isArray(list) ? list.slice(0, MAX_CASES) : []) {
    const example = String(c?.example ?? '').trim().replace(/^`+|`+$/g, '').split(ARROW)[0].trim();
    const expect = String(c?.expect ?? '').trim();
    if (example.length >= 2 && codeLike(example) && !out.some((x) => x.example === example)) out.push({ text: `\`${example}\` → ${expect}`, example });
  }
  return out;
}
// One case more in the message's list, unless its example is there already.
export const addCase = (turn, c) => { if (!(turn.cases ??= []).some((x) => x.example === c.example)) turn.cases.push(c); };
// What the model is told: the list, and that each needs a test.
export const casesTold = (cases) => `(The request's cases, as Agentic Coder lists them; before your answer stands, each needs a test that tries its example:\n${cases.map((c, i) => `${i + 1}. ${c.text}`).join('\n')}\nPut them in your plan and add a test for each. If one is wrong, say so in one line.)`;

// A pattern that finds the example in a test however its names and numbers were chosen: the command (the
// first word, and the first after | ; && < >) and its flags stay as they are, with any number for a number
// (-4 is any -N); every other word (a file, a folder, a quoted pattern) is any word.
export function caseProbe(example) {
  const spaced = String(example).replace(/("[^"]*"|'[^']*')|(\|\||&&|[|;<>])/g, (all, quoted, op) => (quoted ? quoted : ` ${op} `));
  const words = spaced.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A number, or N, M or K standing for one (tail -N); a quote of either kind.
  const literal = (w) => (/^-?[NMK]$/.test(w) ? `${w.startsWith('-') ? '-' : ''}\\d+` : esc(w).replace(/\d+/g, '\\d+').replace(/,/g, ',\\s*').replace(/["']/g, `["'\\x60]`));
  let command = true;
  const parts = words.slice(0, 8).map((w) => {
    if (/^(\|\||&&|[|;<>])$/.test(w)) { command = true; return esc(w); }
    if (command && !/^["']/.test(w)) { command = false; return literal(w); }
    command = false;
    if (/^-\D/.test(w) || /^-?\d+$/.test(w) || /^[NMK]$/.test(w)) return literal(w);
    return '\\S+';
  });
  return new RegExp(parts.join('\\s*'));
}

// The cases whose example no changed test file tries.
export const untested = (cases, testText) => cases.filter((c) => !caseProbe(c.example).test(testText));

// What goes back: the cases still without a test, a line each.
export const casesBack = (missing) => `These cases from your plan have no test yet (no test file changed in this message tries their example):\n${missing.map((c, i) => `${i + 1}. ${c.text}`).join('\n')}\nAdd a test for each one, run the tests, then answer. If one cannot be tested, say why in one line.`;
