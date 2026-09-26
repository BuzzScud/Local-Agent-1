// Slash commands shown in the menu when you type "/".
export const COMMANDS = [
  { name: 'help', desc: 'Commands and keys here, and the full Help page in the browser' },
  { name: 'clear', desc: 'Start a new conversation (the screen keeps its history)' },
  { name: 'compact', desc: 'Summarize the conversation to free memory', arg: '[what to keep]' },
  // picker: typed alone, the command opens a menu of its choices (like Claude Code's)
  { name: 'effort', desc: 'Pick the effort: low, medium or high (also in /model)', arg: '[low|medium|high]', picker: true },
  { name: 'mode', desc: 'Pick the mode: ask first, auto-edit or plan (shift+tab)', arg: '[ask|edits|plan]', picker: true },
  { name: 'math', desc: 'Ask with the math notes (~/Desktop/MATH); alone: list its topics', arg: '[question]' },
  { name: 'init', desc: 'Write an AGENTS.md with notes about this project' },
  { name: 'memory', desc: 'What Bonsai remembers here and where; say "update memory" to add' },
  { name: 'resume', desc: 'Pick up an earlier conversation in this folder' },
  { name: 'model', desc: 'Pick the model and its effort' },
  { name: 'stats', desc: 'Speed, memory and context used' },
  { name: 'meters', desc: 'Show or hide the status bar under the prompt', arg: '[on|off]', picker: true },
  { name: 'doctor', desc: 'Check the model, the server and this Mac' },
  { name: 'weights', desc: "See the model's weights in the browser (the hub)" },
  { name: 'docs', desc: 'Open the hub on the harness and structure diagrams and every Bonsai page' },
  { name: 'exit', desc: 'Quit Bonsai Code' },
];

export function matchCommands(value) {
  const m = /^\/(\S*)$/.exec(value);
  if (!m) return [];
  const q = m[1].toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(q)).concat(COMMANDS.filter((c) => !c.name.startsWith(q) && c.name.includes(q)));
}
