// Slash commands shown in the menu when you type "/".
export const COMMANDS = [
  { name: 'help', desc: 'Show commands and keys' },
  { name: 'clear', desc: 'Start a new conversation (the screen keeps its history)' },
  { name: 'compact', desc: 'Summarize the conversation to free memory', arg: '[what to keep]' },
  { name: 'layout', desc: 'Switch layout: classic or live (ctrl+l)', arg: '[classic|live]' },
  { name: 'effort', desc: 'Effort: off, medium or high (also in /model)', arg: '[off|medium|high]' },
  { name: 'mode', desc: 'ask first, auto-edit or plan (shift+tab)', arg: '[ask|edits|plan]' },
  { name: 'init', desc: 'Write an AGENTS.md with notes about this project' },
  { name: 'resume', desc: 'Pick up an earlier conversation in this folder' },
  { name: 'model', desc: 'Pick the model and its effort' },
  { name: 'stats', desc: 'Speed, memory and context used' },
  { name: 'meters', desc: 'Show or hide the status bar under the prompt', arg: '[on|off]' },
  { name: 'doctor', desc: 'Check the model, the server and this Mac' },
  { name: 'exit', desc: 'Quit Bonsai Code' },
];

export function matchCommands(value) {
  const m = /^\/(\S*)$/.exec(value);
  if (!m) return [];
  const q = m[1].toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(q)).concat(COMMANDS.filter((c) => !c.name.startsWith(q) && c.name.includes(q)));
}
