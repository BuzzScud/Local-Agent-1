// Slash commands shown in the menu when you type "/".
export const COMMANDS = [
  { name: 'help', desc: 'Open the Help page in the browser: every command, key and setting' },
  { name: 'clear', desc: 'Start a new conversation (the screen keeps its history)' },
  { name: 'compact', desc: 'Summarize the conversation to free memory', arg: '[what to keep]' },
  { name: 'btw', desc: 'Ask a quick side question without interrupting the main conversation', arg: '[question]' },
  // picker: typed alone, the command opens a menu of its choices (like Claude Code's)
  { name: 'effort', desc: 'Pick the effort: low, medium or high (also in /model)', arg: '[low|medium|high]', picker: true },
  { name: 'mode', desc: 'Pick the mode: ask first, auto-edit or plan (shift+tab)', arg: '[ask|edits|plan]', picker: true },
  { name: 'math', desc: 'Ask with the math notes (~/Desktop/MATH); alone: list its topics', arg: '[question]' },
  { name: 'init', desc: 'Write an AGENTS.md with notes about this project' },
  { name: 'memory', desc: 'What Agentic Coder remembers about you and this project; undo takes the last save back', arg: '[undo|open]' },
  { name: 'resume', desc: 'Pick up an earlier conversation in this folder' },
  { name: 'model', desc: 'Pick the model and its effort' },
  { name: 'stats', desc: 'Speed, memory and context used' },
  { name: 'meters', desc: 'Show or hide the status bar under the prompt', arg: '[on|off]', picker: true },
  { name: 'doctor', desc: 'Check the model, the server and this Mac' },
  { name: 'weights', desc: "See the model's weights in the browser (the hub)" },
  { name: 'docs', desc: 'Open the hub on the harness and structure diagrams and every Agentic Coder page' },
  { name: 'tests', desc: 'Open the hub on the test record: every test run and its result' },
  { name: 'morning', desc: 'The morning brief on your repos: the day drawn, what needs you, what closed', arg: '[today|yesterday|date]' },
  { name: 'update', desc: 'Restart on new Agentic Coder code, keeping this conversation · /update memory saves to memory now', arg: '[memory]' },
  { name: 'exit', desc: 'Quit Agentic Coder' },
];

export function matchCommands(value) {
  const m = /^\/(\S*)$/.exec(value);
  if (!m) return [];
  const q = m[1].toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(q)).concat(COMMANDS.filter((c) => !c.name.startsWith(q) && c.name.includes(q)));
}
