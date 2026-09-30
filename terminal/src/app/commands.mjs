// Slash commands shown in the menu when you type "/".
export const COMMANDS = [
  { name: 'help', desc: 'Open the Help page in the browser: every command, key and setting' },
  { name: 'clear', desc: 'Start a new conversation: clears the screen and what the model remembers of this one, back in the folder you started in' },
  { name: 'compact', desc: 'Summarize the conversation to free memory', arg: '[what to keep]' },
  { name: 'btw', desc: 'Ask a quick side question without interrupting the main conversation', arg: '[question]' },
  // picker: typed alone, the command opens a menu of its choices (like Claude Code's)
  { name: 'effort', desc: 'Effort, search and limits in one panel: thinking, embedder, reranker, context, tries, steps', arg: '[low|medium|high]', picker: true },
  { name: 'mode', desc: 'Pick the mode: ask first, auto-edit or plan (shift+tab)', arg: '[ask|edits|plan]', picker: true },
  { name: 'permissions', desc: 'What runs without asking, what never runs, which files always ask, and the start-up mode', arg: '[allow|never|protect|remove|mode|forget|test]' },
  { name: 'math', desc: 'Ask with the math notes (~/Desktop/MATH); alone: list its topics', arg: '[question]' },
  { name: 'design', desc: 'Ask with the design examples; alone: the folder and what is on · on|off, check on|off, sets all|<set,set>, style auto|opus|fable|mix', arg: '[request|on|off|check|sets|style]' },
  { name: 'init', desc: 'Write an AGENTS.md with notes about this project' },
  { name: 'memory', desc: 'What Agentic Coder remembers about you and this project; undo takes the last save back', arg: '[undo|open]' },
  { name: 'instructions', desc: 'Edit general and planning instructions in the hub; saves apply to the next task' },
  { name: 'rules', desc: 'What the model reads at every start, numbered; add, switch off or remove a rule', arg: '[add|off|on|remove|always|open]' },
  { name: 'helpers', desc: 'The context helpers (Scout, Medic, Oracle, Sentry): what comes along with a request before the first step; switch one on or off', arg: '[on|off] [number|name|all]' },
  { name: 'hooks', desc: "The app's checks (empty reply, tests after a change, done check…) as hooks: which run while the model decides (/effort's Who decides); switch one on or off", arg: '[on|off] [number|name|all]' },
  { name: 'rewind', desc: 'Put the files and the conversation back to before one of your messages (esc twice)' },
  { name: 'resume', desc: 'Pick up an earlier conversation in this folder' },
  { name: 'model', desc: 'Pick the model and its effort' },
  { name: 'remote', desc: 'Use a model on another machine or the Claude API: address, API key, http/https or an SSH tunnel, the kind of server; Test checks it', arg: '[on|off]', picker: true },
  { name: 'web', desc: 'What the model may do on the web: search with Brave Search or Tavily (your API key), read pages (each site asks first), and Claude’s own web tools on the Claude API; Test checks the key', picker: true },
  { name: 'stats', desc: 'Speed, memory and context used' },
  { name: 'meters', desc: 'Show or hide the status bar under the prompt', arg: '[on|off]', picker: true },
  { name: 'mouse', desc: 'Drag to highlight the text you are typing in the prompt box: copied at once, delete removes it', arg: '[on|off]', picker: true },
  { name: 'doctor', desc: 'Check the model, the server and this Mac' },
  { name: 'weights', desc: "See the models' weights in the browser (the hub)" },
  { name: 'docs', desc: 'Open the hub on the harness and structure diagrams and every Agentic Coder page' },
  { name: 'arena', desc: 'Open the hub on the Arena: run a test on one model, or battle Gemma and Qwen with it (the New 28, Work 28, Practice 28, tests you make, the checks), one model at a time' },
  { name: 'test', desc: 'Pick a test in the Arena for this model: press Run there, watch it live (it keeps going if you close this)', arg: '[name|task number]' },
  { name: 'tests', desc: 'Open the Arena on the test record: every test run and its result' },
  { name: 'morning', desc: 'The morning brief on your repos: the day drawn, what needs you, what closed', arg: '[today|yesterday|date]' },
  { name: 'update', desc: 'Restart on new Agentic Coder code, keeping this conversation · /update memory saves to memory now', arg: '[memory]' },
  { name: 'settings', desc: 'Everything else in one menu: status bar, helpers, rules, instructions, memory, the hub pages and the tools' },
  { name: 'exit', desc: 'Quit Agentic Coder' },
];

// /settings: the commands kept out of the / menu, in three groups. Enter on a
// row runs the command; each one still works typed in full (/doctor), and
// /help lists them with the rest.
export const SETTINGS = [
  { group: 'Setup', rows: [
    { name: 'permissions', label: 'Permissions', note: 'what runs without asking, what never runs' },
    { name: 'meters', label: 'Status bar', note: 'model, speed and memory under the prompt' },
    { name: 'mouse', label: 'Mouse', note: 'drag to highlight text in the prompt box' },
    { name: 'helpers', label: 'Helpers', note: 'what comes along with each request' },
    { name: 'hooks', label: 'Hooks', note: "the app's checks, while the model decides" },
    { name: 'rules', label: 'Rules', note: 'what the model reads at every start' },
    { name: 'instructions', label: 'Instructions', note: 'general and planning, edited in the browser' },
    { name: 'memory', label: 'Memory', note: 'what it remembers about you and this project' },
    { name: 'web', label: 'Web', note: 'search the web and read pages' },
  ] },
  { group: 'Pages · the hub in the browser', rows: [
    { name: 'weights', label: 'Weights', note: "each model's weights, alone or side by side" },
    { name: 'docs', label: 'Docs', note: 'the diagrams and every Agentic Coder page' },
    { name: 'arena', label: 'Arena', note: 'run a test on one model, or battle two' },
    { name: 'tests', label: 'Test record', note: 'every test run and its result, in the Arena' },
  ] },
  { group: 'Tools', rows: [
    { name: 'stats', label: 'Stats', note: 'speed, memory and context used' },
    { name: 'doctor', label: 'Doctor', note: 'check the model, the server and this Mac' },
    { name: 'init', label: 'Init', note: 'write an AGENTS.md for this project' },
    { name: 'update', label: 'Update', note: 'restart on new code, keep this conversation' },
  ] },
];
export const IN_SETTINGS = new Set(SETTINGS.flatMap((g) => g.rows.map((r) => r.name)));

// The / menu: every command but the ones /settings holds.
export function matchCommands(value) {
  const m = /^\/(\S*)$/.exec(value);
  if (!m) return [];
  const q = m[1].toLowerCase();
  const shown = COMMANDS.filter((c) => !IN_SETTINGS.has(c.name));
  return shown.filter((c) => c.name.startsWith(q)).concat(shown.filter((c) => !c.name.startsWith(q) && c.name.includes(q)));
}
