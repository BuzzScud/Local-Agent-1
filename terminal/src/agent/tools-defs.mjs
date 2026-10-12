// The tools a model is offered (tools.mjs): their definitions and schemas, and the names a model
// may use for them instead. Moved from tools.mjs word for word.

const str = (description) => ({ type: 'string', description });
// One choice of an Ask (agent/questions.mjs reads a bare string too).
const choiceDef = { type: 'object', properties: { label: str('A few words'), about: str('What it means for the user, with one example'), recommended: { type: 'boolean' } }, required: ['label'] };
// Read: files up to WHOLE_MAX lines come back whole; longer ones as an outline,
// then PART_DEFAULT lines (at most PART_MAX) from the offset asked for. A big
// model on a service reads more at a time (env.read: big-model mode's whole,
// part and max, models/runtime/remote.mjs).
export const WHOLE_MAX = 150;
export const PART_DEFAULT = 150;
export const PART_MAX = 400;

export const TOOL_DEFS = [
  {
    name: 'Read',
    description: 'Read a text file, a picture (png, jpg…: you see it) or a PDF (its text, page by page). Returns its exact text, ready to copy into Edit. A long file first comes back as a list of its parts with line numbers; then pass find (a word or name) to see the lines around it, or offset (first line, from 1) and limit (number of lines) to read the part you need.',
    parameters: { type: 'object', properties: { path: str('File path, relative to the project folder'), find: str('A word or name: shows the lines of the file around each place it appears'), offset: { type: 'integer' }, limit: { type: 'integer' }, page: { type: 'integer', description: 'For a PDF: that page as a picture (a scan or a figure)' } }, required: ['path'] },
  },
  {
    name: 'List',
    description: 'List files. Without pattern: the entries of one folder. With pattern: every file matching a glob such as "**/*.json" (** means any folder). Skips node_modules and .git.',
    parameters: { type: 'object', properties: { path: str('Folder, default "."'), pattern: str('Optional glob') } },
  },
  {
    name: 'Search',
    description: 'Search file contents with a regular expression. Returns "file:line:text" for up to 50 matches.',
    parameters: { type: 'object', properties: { pattern: str('Regular expression'), path: str('Folder to search, default "."'), glob: str('Optional file filter such as "*.py"') }, required: ['pattern'] },
  },
  {
    name: 'Edit',
    description: 'Change part of an existing file: replaces old_text with new_text. Copy old_text exactly from Read output (without the line numbers). It must appear exactly once, so include a line or two around the change; or pass line (where the one you mean starts), or set replace_all to true to change every occurrence (for renaming). new_text replaces old_text, so it holds the whole new version of those lines. Example: {"path": "src/cart.mjs", "old_text": "  return total;\\n}", "new_text": "  return Math.round(total * 100) / 100;\\n}"}',
    parameters: { type: 'object', properties: { path: str('File path'), old_text: str('Exact text to replace'), new_text: str('Replacement text'), replace_all: { type: 'boolean', description: 'Change every occurrence instead of exactly one' }, line: { type: 'integer', description: 'Only when old_text appears more than once: the line the one you mean starts on, from Read' } }, required: ['path', 'old_text', 'new_text'] },
  },
  {
    name: 'Write',
    description: 'Create a new file. To change an existing file use Edit instead; Write replaces the whole file. A big file (hundreds of lines) does not fit in one reply: Write a short skeleton first, then add one section at a time with Edit. Example: {"path": "notes/todo.md", "content": "# To do\\n- Add the -c flag\\n"}',
    parameters: { type: 'object', properties: { path: str('File path'), content: str('The full file content') }, required: ['path', 'content'] },
  },
  {
    name: 'Bash',
    description: 'Run a shell command (zsh) in the project folder, for example tests, a build, or git status. Stops after 2 minutes unless timeout gives it more seconds (600 at most). Long output is cut. For a dev server, a watcher, or a long run you need not wait for, set background: true: it keeps running while you work, you get its id, Jobs shows what it printed or stops it, and you are told when it ends. Example: {"command": "node --test test/cart.test.mjs", "description": "Run the cart tests"}',
    parameters: { type: 'object', properties: { command: str('The command'), description: str('A few words on what it does'), timeout: { type: 'integer', description: 'Optional: seconds it may run before it is stopped, up to 600' }, background: { type: 'boolean', description: 'Optional: true runs it in the background and answers at once with its id' } }, required: ['command'] },
  },
  {
    name: 'TodoWrite',
    description: 'Write your plan for a task with 3 or more steps. Send the whole list every time; mark each step pending, in_progress or done. Example: {"todos": [{"text": "Add the -c flag to plainRead", "status": "in_progress"}, {"text": "Test it in tools.test.mjs", "status": "pending"}]}',
    parameters: {
      type: 'object',
      properties: { todos: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } }, required: ['text', 'status'] } } },
      required: ['todos'],
    },
  },
  {
    name: 'Ask',
    description: 'Ask the user when the request is unclear and your tools cannot settle it: what a vague request wants, which behaviour they mean, a choice that is theirs. Not for what List, Search or Read can find. Write for someone who does not read code: everyday words, no file paths, commands or code names. Give 2 to 4 choices, each a few words with an about line saying what it means for them and one example. Put the choice you recommend first, with recommended: true. Give each question a header: a tab name of one or two words. Set several: true when they may pick more than one. Up to 4 more questions go in more; they are shown together, a tab each, and the user may also type their own answer. Use this instead of writing questions in your reply. Returns their answers.',
    parameters: { type: 'object', properties: {
      question: str('One plain question'),
      header: str('Its tab name, one or two words, up to 12 letters, such as "Layout"'),
      options: { type: 'array', items: choiceDef, description: '2 to 4 choices' },
      several: { type: 'boolean', description: 'true: they may tick more than one choice' },
      more: { type: 'array', items: { type: 'object', properties: { question: str('One plain question'), header: str('Its tab name, one or two words'), options: { type: 'array', items: choiceDef }, several: { type: 'boolean' } }, required: ['question'] }, description: 'Optional: up to 4 more questions' },
    }, required: ['question'] },
  },
];

// The background commands (Bash with background: true, tools/jobs.mjs): what one printed since the
// last look, the list, or a stop. On every way, so the list of tools never moves.
const JOBS_TOOL_DEF = {
  name: 'Jobs',
  description: 'Your background commands (Bash with background: true). With id: what it printed since you last looked, and whether it still runs; add stop: true to stop it, or wait: seconds to wait until it ends (instead of a Bash sleep): the wait ends early when the user writes. Without id: the list.',
  parameters: { type: 'object', properties: { id: str('The job, such as job1'), stop: { type: 'boolean', description: 'true stops it, and everything it started' }, wait: { type: 'integer', description: 'Optional: up to this many seconds (600 at most), until the job ends or the user writes' } }, required: [] },
};

// The model decides (/effort's Who decides row on Model, agent/way.mjs): what the app did for the
// model before its first step (sort the request, run a focused path, draw the map, search by
// meaning, save to memory at the end) becomes tools it may call, as Claude Code's model calls its
// own. Read also takes several paths: Gemma 4 sends one call a reply and ends its turn (probed
// 30 Sep 2026: told to send two, it still sent one), so one call reads what Qwen asks for in two.
export const MODEL_TOOL_DEFS = [
  {
    name: 'Map',
    description: 'A map of the project: every code file with its line count and the names defined in it (functions, classes, exports), names only; when the project has a code map (docs/map), its top folders with a plain line each first. part: one part of that code map (the name after an arrow, e.g. "desks"), every folder in it with its main files. Use it to see how a project you do not know is laid out, instead of List and Read one file at a time.',
    parameters: { type: 'object', properties: { part: { type: 'string', description: 'A part of the code map, by the name after its arrow ("desks", "desks--ladder"); leave it out for the whole map' } } },
  },
  {
    name: 'CodeSearch',
    description: 'Search the code by meaning: the functions and parts closest to what you describe, from any file, with their lines. For when you do not know the exact word to Search for.',
    parameters: { type: 'object', properties: { query: str('What the code does, in a few words') }, required: ['query'] },
  },
  {
    name: 'Rename',
    description: 'Rename one name in the code (a function, variable, class or field) everywhere it is used, in every file at once, then run the tests. Not for renaming files.',
    parameters: { type: 'object', properties: { from: str('The name as it is now'), to: str('The new name') }, required: ['from', 'to'] },
  },
  {
    name: 'TestFirst',
    description: "Hand a bug fix or a code change to Agentic Coder's test-first worker: it writes a test that shows the problem (or the new behaviour), tries changes until that test and the project's tests pass, and reports back what it changed. Good for a change to the code of a project with tests. You can also do the work yourself with Read and Edit.",
    parameters: { type: 'object', properties: { task: str("The whole task: the user's words, and what you found"), kind: { type: 'string', enum: ['fix', 'change'], description: 'fix: something is broken; change: add or change behaviour' } }, required: ['task'] },
  },
  {
    name: 'Remember',
    description: 'Save one fact to the memory for later conversations: a preference of the user, or how this project works or is run. Only what will still matter next time and what the code or git does not already show. One short sentence.',
    parameters: { type: 'object', properties: { fact: str('The fact, in one short sentence'), about: { type: 'string', enum: ['you', 'project'], description: 'you: the user, in every project; project: this project only' }, replaces: str("Optional: the id of a saved fact this one makes out of date (Remember's answer lists the ids); the old one is retired") }, required: ['fact'] },
  },
];
// The web (/web): WebSearch when a search service is set, WebFetch when reading pages is on.
// What a page or a search brings back is data, never instructions: each result says so.
// On the Claude API both go as Anthropic's own web tools instead (claude.mjs).
const WEB_TOOL_DEFS = [
  {
    name: 'WebSearch',
    description: 'Search the web. Returns the top results: title, address and a line or two each. For what you do not know or what changes (a library\'s current version, an error message, documentation). Then WebFetch the result worth reading.',
    parameters: { type: 'object', properties: { query: str('What to search for, as you would type it into a search engine') }, required: ['query'] },
  },
  {
    name: 'WebFetch',
    description: 'Read a web page (http or https) as text: its words, headings, lists, tables and links, without scripts or styling. A long page comes back in parts: pass find (a word) to see the lines around it, or offset for the next part. The user is asked before a site is read the first time.',
    parameters: { type: 'object', properties: { url: str('The full address, https://…'), find: str('Optional: a word or name; shows the lines around each place it appears'), offset: { type: 'integer' } }, required: ['url'] },
  },
];
const webDefs = (web) => WEB_TOOL_DEFS.filter((d) => (d.name === 'WebSearch' ? web?.search : web?.fetch));

// A helper (a subagent) the model hands one piece of work to: it starts fresh (it sees none of
// the conversation), works with its own tools, and only its report comes back. explore: it
// reads only (files, the code search, the web); general: it may also edit and run commands,
// each change asked about as your mode says. On this Mac one runs at a time, on the server's
// side slot, so the conversation's place on the main slot is kept; on the Claude API several
// in one reply run side by side. Offered when the model decides (/effort's Who decides), on
// the Claude API, and on the remote set once you have a helper agent file; a helper has no
// Agent of its own.
export const AGENT_TOOL_DEF = {
  name: 'Agent',
  description: 'Hand one self-contained piece of work to a helper that starts fresh and reports back. kind explore: it only reads (files, code search, the web) and reports what it found, with file:line; for a search that would take many reads, so only its findings come back to you. kind general: it may also edit files and run commands. It sees none of this conversation: put the whole task, and what to report, in prompt.',
  parameters: { type: 'object', properties: { description: str('A few words on what it does'), prompt: str('The whole task, and what to report back'), kind: { type: 'string', enum: ['explore', 'general'], description: 'explore (read only, the default) or general' } }, required: ['prompt'] },
};
// The Agent tool with your own helpers (prompt-files.mjs readHelperAgents, in your folder's agents/):
// each is a kind of its own, named with what its file says it is for.
export function agentToolDef(helpers = []) {
  if (!helpers.length) return AGENT_TOOL_DEF;
  const kinds = ['explore', 'general', ...helpers.map((h) => h.kind)];
  const own = helpers.map((h) => `- ${h.kind}${h.about ? `: ${h.about}` : ''}`).join('\n');
  return {
    ...AGENT_TOOL_DEF,
    description: `${AGENT_TOOL_DEF.description}\nThe user's own helpers, each a kind of its own with its own instructions; when one fits the work, use its kind:\n${own}`,
    parameters: { ...AGENT_TOOL_DEF.parameters, properties: { ...AGENT_TOOL_DEF.parameters.properties, kind: { type: 'string', enum: kinds, description: `explore (read only, the default), general, or one of the user's own helpers (${helpers.map((h) => h.kind).join(', ')})` } } },
  };
}
// The screen (tools/screen.mjs): a picture of one app's window, or of the whole screen, for a
// model that can look at pictures. It only looks; each app asks once (permissions.mjs).
const SCREEN_TOOL_DEF = {
  name: 'Screen',
  description: "Take a picture of the user's screen to look at: one app's window (app: its name, like Safari, Mail or TextEdit), or the whole screen (no app). It only looks; nothing is clicked or typed. When the user asks about an app, a window or what is on their screen, use this first: other apps' files are outside the project and cannot be read. If that app has no window open, the answer lists the apps that do. The user is asked before you see an app the first time.",
  parameters: { type: 'object', properties: { app: str("Optional: the app whose front window to look at (Safari, TextEdit, Google Chrome…); leave it out for the whole screen") }, required: [] },
};
// Agentic Coder itself (self.mjs; the owner's pick, 8 Oct 2026): offered only when the app works on
// itself (Bypass permissions on the Claude API, permissions.mjs isSelf). command runs a slash command
// as the user would type it; setting reads or changes one key of settings.json; restart starts the
// app again on the code in its repo as it is now (the launcher rebuilds it) and picks this
// conversation back up. Commands that would end or replace the conversation are refused (APP_NOT).
export const APP_TOOL_DEF = {
  name: 'App',
  description: "Agentic Coder itself, the app you run in: drive it as the user would. action command: run a slash command as typed (\"/mode auto\", \"/effort high\", \"/hooks lean\", \"/permissions allow npm test\", \"/rules\", \"/helpers off 2\"); its answer comes back as the notes the screen showed. action setting: with key alone, that key's value from the app's settings.json (no key: every key); with value too, set it (a JSON value: true, \"low\", 3) and say what changed. action restart: after you changed the app's own code and its tests pass, start the app again on that code (it is built first, in about a second) and pick this conversation back up; a build that fails leaves the last good version running and the conversation says so. Available only while the user runs Agentic Coder in Bypass permissions on the Claude API.",
  parameters: { type: 'object', properties: {
    action: { type: 'string', enum: ['command', 'setting', 'restart'], description: 'command, setting or restart' },
    command: str('For command: the slash command as the user would type it, starting with /'),
    key: str('For setting: the key in settings.json (dotted for a nested one: remote.kind); none lists them all'),
    value: { description: 'For setting: the new value, as JSON (a string, number, true/false, a list or an object). Left out: read only' },
    reason: str('For restart: one line on what changed and which test passed; shown to the user'),
  }, required: ['action'] },
};
// Slash commands the App tool never runs: they end, replace or rewind the conversation it runs in,
// or wait for a key of the user's. restart is the App tool's own action.
export const APP_NOT = new Set(['clear', 'exit', 'quit', 'compact', 'resume', 'rewind', 'update', 'agents', 'loop', 'loops', 'jumptomac', 'btw', 'math', 'design', 'init', 'morning', 'test', 'start', 'stop']);
// The tools an explore helper is given (the others are left out of its list and refused).
export const EXPLORE_TOOLS = new Set(['Read', 'List', 'Search', 'Map', 'CodeSearch', 'WebFetch', 'WebSearch', 'TodoWrite']);

// Read as the model sees it on Model: a path, or several paths at once.
const READ_MANY = {
  ...TOOL_DEFS[0],
  description: `${TOOL_DEFS[0].description} To read several files at once, pass paths (a list) instead of path.`,
  parameters: { ...TOOL_DEFS[0].parameters, properties: { ...TOOL_DEFS[0].parameters.properties, paths: { type: 'array', items: { type: 'string' }, description: 'Several file paths, read one after the other in this one call' } }, required: [] },
};
// The tools of a way: 'app' (the default, as before) or 'model' (the tools above join them).
// web: { search, fetch } (/web): the web tools join them.
// agents: the Agent tool joins them (a helper's own list never has it); helpers: your own helper agents in it.
// screen: the Screen tool joins them (a model that can look at pictures, on a Mac).
// self: the App tool joins them (the app works on itself, permissions.mjs isSelf).
export const toolDefs = (way = 'app', web = null, { agents = false, screen = false, helpers = [], self = false } = {}) => [...(way === 'model' ? [READ_MANY, ...TOOL_DEFS.slice(1), ...MODEL_TOOL_DEFS] : TOOL_DEFS), JOBS_TOOL_DEF, ...webDefs(web), ...(screen ? [SCREEN_TOOL_DEF] : []), ...(agents ? [agentToolDef(helpers)] : []), ...(self ? [APP_TOOL_DEF] : [])];
export const toolSchemas = (way = 'app', web = null, opts = {}) => toolDefs(way, web, opts).map((d) => ({ type: 'function', function: d }));

// Other agents' names for a tool here that takes the same arguments (Claude Code's Glob, Grep and
// LS): a big model trained on them calls Glob, and on 2 Oct 2026 was told "There is no tool called
// Glob" twice in one task. The call runs as the tool here; a name this way has is never changed.
// gpt-oss calls the tools it was trained with (4 Oct 2026: gpt-oss:120b called repo_browser.print_tree
// five times, was told five times there is no such tool, and was stopped before it read a file), and
// may put "functions." before a name.
// It also calls them without the prefix (open_file, print_tree, exec), and changes files with
// apply_patch (agent.mjs applyPatch runs it as Edits and Writes).
const OLD_NAME_ALIASES = { Glob: 'List', Grep: 'Search', LS: 'List', print_tree: 'List', open_file: 'Read', search: 'Search', exec: 'Bash', apply_patch: 'apply_patch' };
// Fewer steps lost (6 Oct 2026): Qwen3.6 on the service called RunCommand {"command": "npm test"} and
// was told "There is no tool called". The other common names for the same tools come with it, and a
// name that differs only in case ("bash", "READ") is the tool it names. AGENTIC_STEPS=old: as before
// (the Fewer steps check, models/evals/tools/steps-ab.mjs, runs both).
export const oldSteps = (env = process.env) => env.AGENTIC_STEPS === 'old';
const TOOL_NAME_ALIASES = {
  ...OLD_NAME_ALIASES,
  RunCommand: 'Bash', run_command: 'Bash', run_shell_command: 'Bash', execute_command: 'Bash', shell: 'Bash', terminal: 'Bash',
  read_file: 'Read', write_file: 'Write', create_file: 'Write', edit_file: 'Edit', list_dir: 'List', list_directory: 'List', list_files: 'List',
};
export const toolNameOf = (name, way = 'app') => {
  const names = oldSteps() ? OLD_NAME_ALIASES : TOOL_NAME_ALIASES;
  const bare = String(name ?? '').replace(/^(?:functions|repo_browser|container)\./, '');
  const n = defOf(name, way) || !(defOf(bare, way) || names[bare]) ? name : bare;
  if (names[n] && !defOf(n, way)) return names[n];
  if (defOf(n, way) || oldSteps()) return n;
  // Its own spelling of one of those names ("ReadFile", "run-command"), and any name for running a command
  // (Qwen3.6 on the service, 6 Oct 2026: run_commands, Run_commands, run_bash, each a step lost).
  const flat = n.toLowerCase().replace(/[^a-z]/g, '');
  return toolDefs(way).find((d) => d.name.toLowerCase() === flat)?.name ?? Object.entries(names).find(([k]) => k.toLowerCase().replace(/[^a-z]/g, '') === flat)?.[1]
    ?? (SHELL_NAME.test(flat) && defOf('Bash', way) ? 'Bash' : n);
};
const SHELL_NAME = /^(?:run|exec|execute)?(?:shell|bash|terminal|command|commands|cmd|cli)(?:command|commands)?$/;

// A tool's definition, on either way (Read's own takes paths only on Model).
export const defOf = (name, way = 'app') => [...toolDefs(way), ...WEB_TOOL_DEFS, SCREEN_TOOL_DEF, AGENT_TOOL_DEF, APP_TOOL_DEF].find((d) => d.name === name);
