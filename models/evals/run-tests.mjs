// The tests the Arena and `/test` know by name (the hub's Arena tab, models/evals/battle/), one model
// at a time: what each is, the command it runs (from the repo's top), how the page counts its
// progress from the lines it prints, and how its line in the test record is found. The Battle
// arena's runner starts them (models/evals/battle/runner.mjs): it holds the memory the way a battle
// does, so an Agentic Coder window lets go of its model while a test runs, and a run keeps going
// when the window closes. A test that needs no model (the unit tests, the repo check) runs the same
// way, without the hold.
//   model   true: it runs on the model picked (gemma, qwen); false: it takes none
//   memory  a check with no model of /model that still loads a big one of its own (the ConstantKV
//           check): the bytes it needs free. The runner holds the memory for it the way it does
//           for a model, so an Agentic Coder window lets go of its model first
//   total   how many items a full run has (PASS/FAIL lines counted by `count`); null: no count
//   think   it can run with thinking on (the tab's Thinking switch, key T): at High, the one level
//           Gemma and Qwen have besides Low; off (Low) is the default, the way a battle runs.
//           A model test without it never thinks (the sorting check: a sort writes nothing; the
//           two-at-once speed check writes with thinking off), or sets its own (Thinking old vs
//           new always runs at High)
//   pick    One practice task: which of the Practice 28 (a number, or a copy of yours like 18b).
//           One of my tests (pick.own): which test of your own, by its number
//   own     My tests: its total is how many tests of your own there are (made in the hub's Test
//           builder tab); 'easy' | 'medium' | 'hard': only the tests of that level
//   set     it is one of the Arena's sets (the Practice 28, the Work 28, the New 28, your own tests,
//           all or one level of them): the Arena runs those test by test, on one model or as battles;
//           this entry is how Terminal runs the whole set on one model, and how its line in the
//           record is found
//   lines   UI component battle: its total is three lines a request in its list (a list you add to)
//   stop    the signal the Stop button sends first: each runner then saves what it has
//   record  its line in the test record: kind, a name pattern, and whether it is a full run (its
//           effort, low or high, tells a run with thinking from one without)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMetas, practiceList, LEVELS } from './battle/store.mjs';

// The UI component battle's requests (bench/design/components.json): each prints four lines, a
// card pick, a page with the design folder on, one with it off and one with the design studio
// on. null: the list is not here.
// Read from the repo each time: beside this file, or, inside the built app, in the repo the
// launcher names (AGENTIC_REPO).
const COMPONENTS = ['bench', 'design', 'components.json'];
export function componentLines() {
  for (const dir of [dirname(fileURLToPath(import.meta.url)), process.env.AGENTIC_REPO ? join(process.env.AGENTIC_REPO, 'models', 'evals') : null]) {
    try { if (dir) return JSON.parse(readFileSync(join(dir, ...COMPONENTS), 'utf8')).length * 4; } catch { /* not there: the next place */ }
  }
  return null;
}
// How many items a run of `t` has: counted now where the list can change.
const totalOf = (t) => (t.own ? ownCount(undefined, t.own === true ? null : t.own) : t.pick?.own ? Math.min(1, ownCount()) : t.lines ? t.lines() : t.total);

// run.mjs's words for thinking: on at High (Gemma and Qwen have no Medium), or off.
const thinkRun = (think) => (think ? ['--think', 'on', '--effort', 'high'] : ['--think', 'off']);

export const RUN_TESTS = [
  { id: 'practice28', name: 'Practice 28', set: 'practice', what: 'the 28 practice tasks, each with its own check', model: true, think: true, total: 28, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/bench/run.mjs', args: (m, n, think) => ['--model', m, ...thinkRun(think), '--set', '28'],
    stop: 'SIGTERM', record: { kind: 'tasks', name: '^The 28 practice tasks', part: false } },
  { id: 'task', name: 'One practice task', what: 'one of the Practice 28 as the Arena keeps it (an edit or a copy of yours made there counts), 10 minutes at most: pick it by name', model: true, think: true, total: 1, count: '^(PASS|FAIL|NONE)\\s', pick: { default: '10', prefix: 'Practice test ' },
    script: 'models/evals/battle/run-set.mjs', args: (m, only, think) => ['--model', m, '--set', 'practice', '--only', only, ...(think ? ['--think', 'on'] : [])],
    stop: 'SIGTERM', record: { kind: 'sets', name: '^Practice test ', part: true } },
  { id: 'requests', name: 'Real requests', what: '28 everyday requests in throwaway folders: where each goes, and that blocked commands stay blocked', model: true, think: true, total: 28, count: '^(OK|FAIL)\\s+#\\d+',
    script: 'models/evals/bench/words/real.mjs', args: (m, n, think) => ['--model', m, ...(think ? ['--think', 'on'] : [])],
    stop: 'SIGTERM', record: { kind: 'requests', name: '^The 28 real requests$', part: false } },
  { id: 'long', name: 'Long task', what: 'one long, read-heavy question: where the time goes and what it reads twice (stops by itself at 20 min)', model: true, think: true, total: null, minutes: 20,
    script: 'models/evals/tools/long-task.mjs', args: (m, n, think) => ['--model', m, '--effort', think ? 'high' : 'low', '--minutes', '20', '--record'],
    stop: 'SIGINT', record: { kind: 'other', name: '^Long task', part: false } },
  { id: 'work28', name: 'Work 28', set: 'work28', what: 'the Battle set about your own work, on this model alone', model: true, think: true, total: 28, count: '^(PASS|FAIL|NONE)\\s',
    script: 'models/evals/battle/run-set.mjs', args: (m, n, think) => ['--model', m, '--set', 'work28', ...(think ? ['--think', 'on'] : [])],
    stop: 'SIGTERM', record: { kind: 'sets', name: '^The Work 28', part: false } },
  { id: 'new28', name: 'New 28', set: 'new28', what: 'the Battle’s New 28 set, on this model alone', model: true, think: true, total: 28, count: '^(PASS|FAIL|NONE)\\s',
    script: 'models/evals/battle/run-set.mjs', args: (m, n, think) => ['--model', m, '--set', 'new28', ...(think ? ['--think', 'on'] : [])],
    stop: 'SIGTERM', record: { kind: 'sets', name: '^The New 28', part: false } },
  { id: 'mine', name: 'My tests', set: 'mine', what: 'every test of your own (made in the Test builder), one after another: each stops at its level’s time (Easy 5, Medium 10, Hard 20 minutes; 10 with no level) and is worth its level’s points (1, 2, 3)', model: true, think: true, total: null, own: true, count: '^(PASS|FAIL|NONE)\\s',
    script: 'models/evals/battle/run-set.mjs', args: (m, n, think) => ['--model', m, '--set', 'mine', ...(think ? ['--think', 'on'] : [])],
    stop: 'SIGTERM', record: { kind: 'sets', name: '^My tests(,| \\()', part: false } },
  ...Object.entries(LEVELS).map(([level, L]) => ({ id: `mine-${level}`, name: `My tests · ${L.name}`, set: 'mine', level, what: `your ${L.name} tests (the Test builder sets a test’s level): ${L.points} point${L.points === 1 ? '' : 's'} each, each stopped at ${L.minutes} minutes unless it has its own limit`, model: true, think: true, total: null, own: level, count: '^(PASS|FAIL|NONE)\\s',
    script: 'models/evals/battle/run-set.mjs', args: (m, n, think) => ['--model', m, '--set', 'mine', '--level', level, ...(think ? ['--think', 'on'] : [])],
    stop: 'SIGTERM', record: { kind: 'sets', name: `^My tests · ${L.name}`, part: false } })),
  { id: 'mytest', name: 'One of my tests', what: 'one test of your own, by its number (the Test builder’s Save and run picks it for you): it stops at its level’s time', model: true, think: true, total: 1, count: '^(PASS|FAIL|NONE)\\s', pick: { default: null, own: true, prefix: 'My test ' },
    script: 'models/evals/battle/run-set.mjs', args: (m, only, think) => ['--model', m, '--set', 'mine', '--only', only, ...(think ? ['--think', 'on'] : [])],
    stop: 'SIGTERM', record: { kind: 'sets', name: '^My test \\d', part: true } },
  { id: 'sorting', name: 'Sorting check', what: 'how the model sorts 85 requests into a kind (question, fix, change, rename, other): right answers and seconds a sort, with a results page', model: true, think: false, total: 82, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/sort-check.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Sorting check$', part: false } },
  { id: 'done', name: 'Done check', what: 'three jobs where Qwen said “done” and it was not true (a dead button, “Done” with nothing written, a contrast claim), run again with thinking at High and the page check on: whether you are still left with a false “done”, with a results page', model: true, think: false, total: 3, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/done-check.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Done check$', part: false } },
  { id: 'twoatonce', name: 'Two at once', what: 'whether two tries at once, one on each of the server’s two slots, write more a second than one after the other; it passes at ×1.25, with a results page', model: true, think: false, total: 3, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/two-at-once.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Two at once$', part: false } },
  { id: 'remote', name: 'Remote check', what: '/remote and coding serve with the real model, both on this Mac: serve starts behind a new key, Agentic Coder uses it as a remote (llama.cpp, then OpenAI-compatible) for an answer and a file read, a wrong key is refused, a window there shares it, serve stops cleanly; 11 checks, with a results page', model: true, think: false, total: 11, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/remote-check.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Remote check$', part: false } },
  { id: 'vision', name: 'Vision check', what: 'pictures and PDFs with the real model and its vision add-on: @hello.png, a picture dragged in from another folder, a PDF’s text, a picture it looks at by itself (Read), a scanned page, without the add-on (it says so), and the window turning vision on at the first picture; 8 checks, with a results page', model: true, think: false, total: 8, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/vision-check.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Vision check$', part: false } },
  { id: 'picturetokens', name: 'Picture tokens', what: 'whether the model reads the text on four pictures at the size the app gives a picture (Qwen: at least 1024 tokens), and at the engine’s own size beside it: right answers, tokens and seconds, with a results page', model: true, think: false, total: 8, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/picture-tokens.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Picture tokens$', part: false } },
  { id: 'web', name: 'Web check', what: 'WebFetch and WebSearch with the real model: a page, a long page, a page that moves to another site, a search then its page (a stand-in search service), a real page (example.com), a page that tells it to ignore its instructions, and the window asking before it reads a site; 7 checks, with a results page', model: true, think: false, total: 7, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/web-check.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Web check$', part: false } },
  { id: 'subagent', name: 'Subagent check', what: 'helpers (the Agent tool) with the real model and Who decides on Model: an explore helper finds a function on the server’s side slot while the conversation keeps its place, a read-only helper changes nothing, a general one makes a change, and esc stops one in the window; 5 checks, with a results page', model: true, think: false, total: 5, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/agents-check.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Subagent check$', part: false } },
  { id: 'autoscreen', name: 'Auto & Screen check', what: 'Auto mode and the Screen tool with the real model: 16 steps with the request each came from, 8 that fit and 8 risky or not asked for (the risky ones must all ask, 6 of the fitting ones must run), then looking at a note open in TextEdit, a window that is not open, and a question about a file (no look at the screen); 19 checks, with a results page', model: true, think: false, total: 19, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/auto-screen-check.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Auto & Screen check$', part: false } },
  { id: 'rulesfile', name: 'Rules file old vs new', what: 'the short AGENTS.md against the long one it replaced (30 Sep): 10 questions about working in this repo with each, the seconds the model takes to read its instructions, and one small real task on a copy of the repo; it holds when the new one gets as many right, starts faster and does the task in no more time, with a results page', model: true, think: false, total: 22, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/rules-file-check.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Rules file old vs new$', part: false } },
  { id: 'skills', name: 'Skills check', what: 'a skill from SKILLS.md with the real model: the example “Write a test” on three test-writing tasks, each without and with it, and once without its words (only the skills list can lead to it); it holds when the skill passes as many and takes at most 25% more time, with a results page', model: true, think: false, total: 7, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/skills-check.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Skills check$', part: false } },
  { id: 'lookfirst', name: 'Look first check', what: 'Look first (/effort) with the real model at Effort High: four questions whose answers need more than one file, each with Look first off and on (30 s); it holds when at least as many answers are right and it takes at most 60 s more a question, with a results page', model: true, think: false, total: 8, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/look-check.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Look first check$', part: false } },
  { id: 'habits', name: 'Tool habits check', what: 'the four tool lines TOOLS.md got on 30 Sep, with the real model: one task for each (just the test file, search first, prove it before done, open the fitting skill), with the lines from before and with TOOLS.md now; it holds when the new lines show more of the habits and as many tasks are right, with a results page', model: true, think: false, total: 8, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/habits-check.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Tool habits check$', part: false } },
  { id: 'agents', name: 'Agents check', what: '/agents with the real model: three change tasks on a small shop, each as a plain request and through the six stages (spec, plan, test-first build, verify, review, ship); it holds when /agents passes at least one and as many as the plain request, and every one it passes has a test. The time is shown, not judged', model: true, think: false, total: 6, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/agents-ab.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Agents check$', part: false } },
  { id: 'prompt', name: 'Prompt old vs new', what: 'the Practice 28 twice: with the prompt from before 30 Sep (no Work habits) and with today’s; it holds when the new one passes as many and takes at most 10% longer, with a results page', model: true, think: true, total: 56, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/prompt-ab.mjs', args: (m, n, think) => ['--model', m, '--think', think ? 'on' : 'off'],
    stop: 'SIGTERM', record: { kind: 'tasks', name: '^Prompt old vs new$', part: false } },
  { id: 'thinking', name: 'Thinking old vs new', what: 'the Practice 28 twice at High: every try thinking (before 30 Sep), then think when it pays with the step-down past half a task’s time; it holds when the new way passes as many and takes at least 15% less time, with a results page', model: true, think: false, total: 56, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/think-ab.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'tasks', name: '^Thinking old vs new$', part: false } },
  { id: 'way', name: 'Who decides: App vs Model', what: 'the Practice 28 twice: the app deciding (word rules sort, it reads ahead and checks, as before), then the model deciding (no sorting, its own tools, several calls a reply, the checks off), like Claude Code; it holds when the model passes as many and takes at most 25% more time, with a results page', model: true, think: true, total: 56, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/way-ab.mjs', args: (m, n, think) => ['--model', m, '--think', think ? 'on' : 'off'],
    stop: 'SIGTERM', record: { kind: 'tasks', name: '^Who decides: App vs Model$', part: false } },
  { id: 'big', name: 'Big-model mode: off vs on', what: 'the Practice 28 twice on the model /remote uses on a service (an Ollama, 30B+ with tools): with the settings a small model gets, then in big-model mode (80 steps, 12 tries, 160 lines of output, Read 400 lines whole; the app still decides); it holds when the mode passes as many and takes at most 25% more time, with a results page', model: false, total: 56, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/big-ab.mjs', args: () => [],
    stop: 'SIGTERM', record: { kind: 'tasks', name: '^Big-model mode: off vs on$', part: false } },
  { id: 'remote-rules', name: 'Instructions: local vs remote', what: 'the model /remote uses on a service plays the Practice 28 and the 10 hard tasks three ways: with the local instructions (terminal/rules), the remote ones (terminal/rules/remote: HARNESS.md, fourteen guides, four skills) and the remote ones with their skills off; the app decides on every side; the remote set holds when it passes as many on each set and takes at most 25% more time, with a results page', model: false, total: 114, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/remote-rules-ab.mjs', args: () => [],
    stop: 'SIGTERM', record: { kind: 'tasks', name: '^Instructions: local vs remote$', part: false } },
  { id: 'hard', name: 'Hard practice tasks', what: 'the 10 hard tasks (30–39: several files, exact edge cases, a spec to follow, a vague request with two causes, a slow import, a question to trace) on the model /remote uses on a service, with the remote instructions, with a results page', model: false, total: 10, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/remote-rules-ab.mjs', args: () => ['--sides', 'remote', '--set', 'hard'],
    stop: 'SIGTERM', record: { kind: 'tasks', name: '^Hard practice tasks$', part: false } },
  { id: 'components', name: 'UI component battle', what: 'your UI component requests in four parts: which design cards and studio pieces each one gets (no model), the pages built with the design folder on, again with it off, and with the design studio on; run it on both models for the battle, with a results page and blind votes', model: true, think: true, total: null, lines: componentLines, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/bench/design/components.mjs', args: (m, n, think) => ['--model', m, '--think', think ? 'on' : 'off'],
    stop: 'SIGTERM', record: { kind: 'other', name: '^UI component battle$', part: false } },
  { id: 'edited', name: 'Edited copy vs original', what: 'this model’s edited copy (the Weights tab’s Save the copy) against the model itself, one after the other: six fixed questions and one for each word your edits change, side by side, with a results page (it needs a copy of this model saved)', model: true, think: false, total: null, count: '^(PASS|FAIL|ASKED)\\s',
    script: 'models/evals/tools/edited-check.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Edited copy vs original$', part: false } },
  { id: 'modelcheck', name: 'New model check', what: 'what a model added to /model does with the app’s own requests, through the app’s client: it loads (and the memory it takes), its chat template takes the app’s request at every thinking level, a plain answer, a tool call with thinking off and at each level with its thinking kept apart, the thinking cap, its other tool-call format, and its reading and writing speed; with a results page', model: true, think: false, total: null, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/model-check.mjs', args: (m) => ['--model', m],
    stop: 'SIGTERM', record: { kind: 'other', name: '^New model check$', part: false } },
  { id: 'unit', name: 'Unit tests', what: 'bun test over both parts, with the stand-in model (no real one loads)', model: false, total: null,
    script: 'models/evals/tools/run-suite.mjs', args: () => [],
    stop: 'SIGTERM', record: { kind: 'suite', name: '^Unit tests', part: false } },
  { id: 'check', name: 'Repo check', what: 'is anything in the repo that should not be: secrets, packages, where the code connects (the fast one: no model files, no unit tests)', model: false, total: null,
    script: 'models/evals/tools/check.mjs', args: () => ['--fast'],
    stop: 'SIGTERM', record: { kind: 'check', name: '^Repo check', part: false } },
  { id: 'reader', name: 'Weights reader check', what: 'the Weights tab reads every model file on this Mac exactly as llama.cpp does: a few matrices of every storage type each file keeps, weight for weight, with a results page (the first run fetches llama.cpp’s reader through uv)', model: false, total: null, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/reader-check.mjs', args: () => [],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Weights reader check$', part: false } },
  { id: 'studio', name: 'Design studio check', what: 'every piece in your design studio (docs/private/design studio) built the way the app builds it and opened in headless Chrome: on a desktop, a phone and in dark mode, every button clicked, theme colours only, under its size, found by its own name; no model, with a results page and a live gallery of the pieces beside them', model: false, total: null, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/bench/design/studio-check.mjs', args: () => [],
    stop: 'SIGTERM', record: { kind: 'other', name: '^Design studio check$', part: false } },
  { id: 'constantkv', name: 'ConstantKV check', what: 'Bonsai 2 27B ConstantKV, a copy of Bonsai whose attention memory stays the same size at any length (its own MLX runtime, not in /model): it loads and answers, reads 40+ tokens a second up to 16k, holds 64k tokens at 12.5 GB or less, and gives the app’s real tool calls on 2 of 3 tries. It needs about 12.5 GB free, so an Agentic Coder window lets go of its model first; 20–40 minutes, with a results page', model: false, memory: 12.5e9, total: 4, count: '^(PASS|FAIL)\\s',
    script: 'models/evals/tools/constantkv-check.mjs', args: () => [],
    stop: 'SIGTERM', record: { kind: 'other', name: '^ConstantKV check$', part: false } },
];

export const runTestById = (id) => RUN_TESTS.find((t) => t.id === id) ?? null;

// The words /test takes for a test: its id, or a name as you would say it ("practice 28", "work28",
// "unit tests"). null when nothing matches.
export function findRunTest(words) {
  const w = String(words ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!w) return null;
  const hit = (t) => [t.id, t.name, t.name.replace(/\s+tests?$/i, '')].map((x) => x.toLowerCase().replace(/[^a-z0-9]+/g, ''));
  return RUN_TESTS.find((t) => hit(t).includes(w)) ?? RUN_TESTS.find((t) => hit(t).some((x) => x.startsWith(w))) ?? null;
}

// The Practice 28 as the Arena keeps them (~/.agentic-coder/battle/tests/): each by its number,
// with your copies after it (18, 18b, 18c). Before the arena ever started: the originals in the repo.
//   key: '18b' (what you pick), only: 'p18b' (run-set.mjs's --only), title, copy: a copy of yours
export function practiceChoices(home) {
  let ts = listMetas(home).filter((t) => t.suite === 'practice');
  if (!ts.length) ts = practiceList();
  return ts.sort((a, b) => a.n - b.n || String(a.variant ?? '').localeCompare(String(b.variant ?? '')))
    .map((t) => ({ key: `${t.n}${t.variant ?? ''}`, only: /^(p\d+[b-z]?)-/.exec(t.id)?.[1] ?? t.id, title: t.title, copy: Boolean(t.copyOf) }));
}
// How many tests of your own there are (the Test builder's, the Arena's My tests); level: only that level's.
export const ownCount = (home, level = null) => listMetas(home).filter((t) => t.suite === 'mine' && (!level || t.level === level)).length;
// Your own tests as "One of my tests" picks them: by number, oldest first.
//   key: '3' (what you pick), only: its folder (run-set.mjs's --only), title (with its level)
export function ownChoices(home) {
  return listMetas(home).filter((t) => t.suite === 'mine').sort((a, b) => (a.n ?? 1e9) - (b.n ?? 1e9) || String(a.created).localeCompare(String(b.created)))
    .map((t) => ({ key: String(t.n ?? t.id), only: t.id, title: `${t.title}${LEVELS[t.level] ? ` · ${LEVELS[t.level].name}` : ''}`, copy: false }));
}
// The test of yours `n` names: its number (3, '3'), or its whole folder name. null: no such one.
export function ownChoice(n, home) {
  const all = ownChoices(home);
  if (n == null || n === '') return all[0] ?? null;
  const key = String(n).trim();
  return all.find((c) => c.key === key || c.only === key) ?? null;
}
// The practice test `n` names: 12, '12', '18b', 'p18b' or its whole folder name. null: no such one.
export function practiceChoice(n, home) {
  const key = String(n ?? '').trim().toLowerCase().split('-')[0].replace(/^p/, '').replace(/^0+(?=\d)/, '');
  return practiceChoices(home).find((c) => c.key === key) ?? null;
}

// The command a run starts: [script, ...args], checked. A test that takes a model needs one of
// `models` (the ids in the registry); one that takes none ignores it. `n` names the practice test of
// "One practice task" (12, or a copy like 18b); `think` turns thinking on where the test can take it
// (else it is off). `total` is how many tests the run has, where the list can change (My tests).
// The rows the Tests page's control panel may change for a run (/effort's rows; their ranges are
// checked again where they are used, terminal/src/app/limits.mjs testLimits). Named choices are ids.
const PANEL_ROWS = { way: 'choice', embedder: 'choice', retriever: 'choice', reranker: 'choice', context: 'number', thinking: 'number', tries: 'number', steps: 'number', rulesRoom: 'number', upFront: 'number', outputLines: 'number', timeoutSecs: 'number', trimAt: 'number', summarizeAt: 'number', look: 'choice' };
export function cleanSettings(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const [k, kind] of Object.entries(PANEL_ROWS)) {
    const x = v[k];
    if (kind === 'choice' ? typeof x === 'string' && /^[a-z0-9][a-z0-9.-]{0,40}$/i.test(x) : typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1e6) out[k] = x;
  }
  return Object.keys(out).length ? out : null;
}

export function runCommand(id, { model = null, n = null, think = false, models = [], settings = null } = {}) {
  const t = runTestById(id);
  if (!t) throw new Error(`no test "${id}"`);
  if (t.model && !models.includes(model)) throw new Error(`pick a model to run ${t.name} on (${models.join(' or ')})`);
  let pickArg = null;
  let key = null;
  if (t.pick?.own) {
    const c = ownChoice(n);
    if (!c) throw new Error(ownCount() ? `${t.name}: no test of yours numbered "${n}"` : 'you have no tests of your own yet: the Test builder (in the Arena) makes one');
    key = c.key; pickArg = c.only;
  } else if (t.pick) {
    const c = practiceChoice(n == null || n === '' ? t.pick.default : n);
    if (!c) throw new Error(`${t.name}: no practice test "${n}" (1 to 28, or a copy of yours like 18b)`);
    key = c.key; pickArg = c.only;
  }
  const total = totalOf(t);
  if (t.own && !total) throw new Error(t.own === true ? 'you have no tests of your own yet: the Test builder (in the Arena) makes one' : `you have no ${LEVELS[t.own].name} tests yet: the Test builder (in the Arena) sets a test’s level`);
  const on = Boolean(t.think && think);
  // The control panel's changed rows reach the run as AGENTIC_TEST_SETTINGS (a test with no model takes none).
  const set = t.model ? cleanSettings(settings) : null;
  return { test: t, n: key, think: on, total, settings: set, env: set ? { AGENTIC_TEST_SETTINGS: JSON.stringify(set) } : {}, argv: [t.script, ...t.args(t.model ? model : null, pickArg, on)] };
}

// What the page needs to show them (no functions): the list, with each one's command as text,
// thinking off (`command`) and on (`commandThink`, for a test that can take it). One practice task
// brings the tests it can pick (`choices`); My tests, how many there are now (`total`).
export function runCatalog(models = []) {
  const choices = practiceChoices(), own = ownChoices();
  const first = (t) => (t.pick.own ? own[0]?.only ?? 'm-your-test' : practiceChoice(t.pick.default)?.only ?? choices[0]?.only);
  const text = (t, think) => Object.fromEntries((t.model ? models : [null]).map((m) => [m ?? 'none', ['node', t.script, ...t.args(m, t.pick ? first(t) : null, think)].join(' ')]));
  return RUN_TESTS.map((t) => ({
    id: t.id, name: t.name, what: t.what, model: t.model, think: Boolean(t.think), total: totalOf(t), count: t.count ?? null, minutes: t.minutes ?? null, pick: t.pick ?? null, record: t.record,
    ...(t.pick ? { choices: t.pick.own ? own : choices } : {}), ...(t.own || t.pick?.own ? { own: true } : {}), ...(typeof t.own === 'string' ? { level: t.own } : {}),
    command: text(t, false), ...(t.think ? { commandThink: text(t, true) } : {}),
  }));
}

// Progress from the lines a run printed so far: { done, passed, total }. `total`: the run's own
// (My tests, counted when it started), else the test's.
export function countLines(t, lines, total = t.total) {
  if (!t.count) return { done: null, passed: null, total };
  const re = new RegExp(t.count);
  const hits = lines.filter((l) => re.test(l));
  return { done: hits.length, passed: hits.filter((l) => /^(PASS|OK)\b/.test(l)).length, total };
}
