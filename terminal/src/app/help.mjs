// Everything /help shows, in one place: the terminal's /help panel, the Help
// tab of the hub (help.html reads it as /help.json) and `coding --help` all
// come from these lists, so they never disagree. Plain data, no screen code.
import { COMMANDS, SETTINGS, IN_SETTINGS } from './commands.mjs';

export const VERSION = '0.1.0';

// What each mode does (the /mode menu, its note, and the Help page).
// permissions.mjs is what actually decides.
export const MODE_OPTIONS = [
  { id: 'ask', label: 'Ask first', note: 'asks before every edit and before commands that change things' },
  { id: 'edits', label: 'Auto-edit', note: 'edits files without asking; still asks before commands' },
  { id: 'plan', label: 'Plan', note: 'only reads and searches, then replies with a plan' },
];

// Keys, grouped the way you meet them. [keys, what they do]
export const KEYS = [
  { group: 'The prompt', rows: [
    ['enter', 'send'],
    ['\\ then enter', 'a new line instead of sending'],
    ['↑ ↓', 'earlier prompts (on the first or last row of the box; inside a long prompt they move a row)'],
    ['/', 'the command list; keep typing to narrow it, enter or tab to pick'],
    ['@', 'attach a file: type part of its name and pick it'],
    ['!', 'run a shell command yourself, e.g. !ls'],
    ['?', 'show or hide the short list of shortcuts (on an empty prompt)'],
  ] },
  { group: 'Moving and deleting in the text', rows: [
    ['← →', 'move one character'],
    ['option + ← →', 'move one word'],
    ['option + click', 'put the cursor on the letter you click (Terminal moves it with arrow keys)'],
    ['ctrl+a · ctrl+e', 'start · end of the line'],
    ['ctrl+a twice', 'select the whole prompt (and copy it)'],
    ['option + delete · ctrl+w', 'delete the word before the cursor'],
    ['ctrl+u', 'delete everything before the cursor on this line'],
    ['ctrl+k', 'delete everything after the cursor on this line'],
    ['shift + ← →', 'select, a character at a time (with option: a word at a time)'],
    ['shift + ↑ ↓', 'select a line up or down; past the first or last line it reaches the start or end, so from the end shift+↑ selects everything'],
    ['(selecting)', 'selected text is copied to the clipboard at once: “copied N chars to clipboard”'],
    ['delete · typing · paste', 'with text selected: remove it · replace it · replace it'],
    ['← → · esc', 'with text selected: jump to its start or end · keep the text, drop the selection'],
    ['esc twice', 'clear the whole prompt; on an empty prompt: /rewind, to put files and the conversation back to before one of your messages'],
    ['ctrl+c', 'clear the whole prompt (on an empty prompt: press twice to quit)'],
    ['ctrl+z · ctrl+y', 'undo · redo the last change: a word typed, a delete, a paste, a clear'],
  ] },
  { group: 'While Agentic Coder works', rows: [
    ['esc', 'stop Agentic Coder; then say what to do instead'],
    ['ctrl+o', 'expand the last long output, summary or Context line; press again for the one before'],
    ['type and enter', 'queue your next message; it sends when Agentic Coder is free'],
    ['/btw question', 'a quick side question: answered in a panel from the conversation so far, never added to it'],
  ] },
  { group: 'The /btw panel', rows: [
    ['↑ ↓', 'scroll a long answer'],
    ['c', 'copy the answer'],
    ['f', 'send the question and answer to Agentic Coder with your next message'],
    ['esc · enter · space', 'close it (while it answers: stop the answer); Agentic Coder keeps working'],
  ] },
  { group: 'Menus and questions', rows: [
    ['↑ ↓ · 1–9', 'choose · pick a numbered option at once'],
    ['enter', 'select'],
    ['esc', 'go back without changing anything'],
    ['shift+tab', 'in an edit question: yes, and don’t ask again for edits'],
  ] },
  { group: 'Everywhere', rows: [
    ['shift+tab', 'switch mode: ask first → auto-edit → plan'],
    ['ctrl+c twice · ctrl+d', 'quit (ctrl+d on an empty prompt)'],
  ] },
];

// `coding …` from a terminal. lingerMins: how long the model stays loaded.
export function cliRows(lingerMins = 30) {
  return {
    usage: [
      ['coding', 'start in the current folder'],
      ['coding "fix the tests"', 'start and send a first prompt'],
      ['coding -p "question"', 'answer once and exit (changes are refused unless --yes; commands you allowed in /permissions run)'],
      ['coding -c', 'continue the last conversation in this folder'],
      ['coding setup', 'download the model and runtime (if missing) and check them'],
      ['coding stop', `free the model's memory now (it stays loaded ${lingerMins} min after you quit)`],
      ['coding hub [tab]', 'the hub in the browser (ctrl+c here closes it), on a tab: weights (the default), docs, tests, battle, memory, instructions, help'],
      ['coding memory-review', 'read the day’s conversations again and tidy the memory (--install runs it at night, --status says if it would run now)'],
      ['coding morning', 'the morning brief on your repos, opened in the browser (--plain: no model)'],
    ],
    options: [
      ['--effort low|medium|high', 'how much the model thinks before it acts (default: low = answers straight away)'],
      ['--think / --no-think', 'the old names: --effort medium / --effort low'],
      ['--ctx 16k|32k|64k|128k', 'memory size (default: 32k, or 16k when memory is short; /effort saves one)'],
      ['--mode ask|edits|plan', 'start in this permission mode'],
      ['--yes', 'with -p: allow edits and commands without asking (your /permissions never-list still holds)'],
      ['--url http://host:port', 'use a llama-server that is already running'],
      ['--no-flows', 'always work step by step (skip the focused fix/change/rename paths)'],
      ['-v, --version', 'print the version'],
      ['-h, --help', 'this help'],
    ],
  };
}

// The text `coding --help` prints.
export function cliHelpText({ version, modelName, lingerMins }) {
  const { usage, options } = cliRows(lingerMins);
  const pad = (rows) => rows.map(([a, b]) => `  ${a.padEnd(26)}${b}`).join('\n');
  return `coding ${version} — a coding agent in your terminal, running ${modelName} on this Mac\n\nUsage\n${pad(usage)}\n\nOptions\n${pad(options)}\n`;
}

// Where Agentic Coder keeps things. [where, what]
export const PLACES = [
  ['~/.agentic-coder/models', 'the model files (coding setup puts them there)'],
  ['~/.agentic-coder/settings.json', 'your choices that are kept: effort, the status bar, the model'],
  ['~/.agentic-coder/trust.json', 'the folders you said yes to in the safety check'],
  ['~/.agentic-coder/permissions.json', 'what you saved with /permissions, by folder: commands that run without asking or never run, protected files, the start-up mode'],
  ['~/.agentic-coder/sessions', 'saved conversations, for coding -c and /resume'],
  ['~/.agentic-coder/logs', 'the model server and update logs'],
  ['AGENTS.md', "a project's notes for Agentic Coder, read at the start (/init writes one)"],
  ['.agentic/settings.json', 'this folder only: mode, effort, and "memory": false to turn the memory off here (.bonsai/ still read)'],
  ['.agentic/memory', 'what Agentic Coder remembers about this project: one small file per fact in facts/, kept out of git; edit or delete them freely'],
  ['~/.agentic/memory', 'what Agentic Coder remembers about you: how you like to work; it follows you into every project'],
  ['.agentic/notes.md', 'the older notes file (.bonsai/notes.md too): its lines are carried over into the memory the first time'],
];

// How Agentic Coder keeps you safe, in plain words.
export const SAFETY = [
  'The first time you start Agentic Coder in a folder it asks whether you trust it. Nothing there is read before you say yes.',
  'It asks before every edit and before commands that change things, unless you switch the mode. A git commit always asks.',
  'Some commands are always refused: deleting folders wholesale, sudo, git push, resetting git, stopping other programs or services.',
  'Files like .env, keys and .git always ask before a change, even in Auto-edit.',
  '/permissions adds your own rules on top (commands that run without asking, commands that never run, more protected files). They never lift the ones above.',
  'Commands run fenced in: they cannot read your home folder beyond the project, signal other programs, or reach services already running.',
  'Everything runs on this Mac. Nothing you type is sent anywhere.',
];

export const TIPS = [
  'Say what you want in one or two sentences, and name the file when you know it: “add a --json flag to export.mjs”.',
  'Agentic Coder asks when something is unclear, often with answers to pick. Answer with the number, or type your own answer.',
  'Under your request a dim line says where it went: “Sorted as: change · shortcut”. If that is not what you meant, press esc and say it differently.',
  'Low effort is fastest and fine for most work. Try Medium or High for a tricky bug.',
  'Use Plan mode to see a plan before anything changes, then switch mode and say go.',
  '/permissions shows what runs without asking, what never runs and which files always ask. Pick "always allow" when it asks about a command and it is saved for the folder; /permissions test npm test says what a command would do without running it.',
  'Agentic Coder learns as it works: after a task it shows what it would remember and asks (enter saves, esc skips), and a fact comes back when a request fits it. “/update memory” or “remember that …” saves at once.',
  '/memory shows what it keeps, /memory undo takes the last save back, /memory open shows every fact in the browser.',
  '/rules lists what the model reads at every start, numbered: /rules add <text> adds a rule, /rules off 3 switches one off (/rules on 3 brings it back), /rules always 16 makes a note a rule. Up to 20 rules.',
  '/helpers lists the four context helpers, numbered, by codename: 1 Scout reads the files you name, 2 Medic brings the failing tests and the changes, 3 Oracle finds code by meaning, 4 Sentry runs the light checks. /helpers off 3 or /helpers off oracle switches one off (its old name, rag, works too), /helpers on oracle brings it back, /helpers off all turns them all off. They are kept in settings.json; AGENTIC_HELPERS, when set, decides instead.',
  'A fact earns trust when the task passed its check after it was used, and loses it when the task failed or you corrected Agentic Coder. One that keeps failing is taken out of use.',
  '/compact frees memory in a long conversation; /clear starts fresh.',
  'Your math notes in ~/Desktop/MATH are used only when you ask with /math.',
];

// Everything the Help page shows, for /help.json.
export function helpData({ version = '', modelName = '', effort = [], lingerMins = 30 } = {}) {
  return {
    version, modelName,
    commands: COMMANDS.map((c) => ({ name: c.name, arg: c.arg ?? '', desc: c.desc, menu: !!c.picker, settings: IN_SETTINGS.has(c.name) })),
    settings: SETTINGS.map((g) => ({ group: g.group, names: g.rows.map((r) => r.name) })),
    keys: KEYS,
    cli: cliRows(lingerMins),
    modes: MODE_OPTIONS,
    effort: effort.map((l) => ({ id: l.id, label: l.label, note: l.note ?? '' })),
    places: PLACES,
    safety: SAFETY,
    tips: TIPS,
  };
}
