// Slash commands shown in the menu when you type "/".
export const COMMANDS = [
  { name: 'help', desc: 'Open the Help page in the browser: every command, key and setting' },
  { name: 'calc', desc: 'The calculator link: one connection to your calculator that reconnects, signs in again and files sign-in problems; alone: open it in the hub · on|off runs it as its own background service', arg: '[on|off|reconnect|status]' },
  { name: 'clear', desc: 'Start a new conversation: clears the screen and what the model remembers of this one, back in the folder you started in' },
  { name: 'compact', desc: 'Summarize the conversation to free memory', arg: '[what to keep]' },
  { name: 'btw', desc: 'Ask a quick side question without interrupting the main conversation: on a remote, the lowest model there answers when it is ready', arg: '[question]' },
  { name: 'agents', desc: 'Take a request through spec, plan, test-first build, verify, review and ship on a live agent tree; alone: open it', arg: '[request|demo|resume|stop]' },
  // picker: typed alone, the command opens a menu of its choices (like Claude Code's)
  { name: 'effort', desc: 'Effort, search and limits in one panel: thinking, embedder, reranker, context, tries, steps', arg: '[low|medium|high]', picker: true },
  { name: 'mode', desc: 'Pick the mode: auto, manual, accept edits, plan or bypass permissions (shift+tab)', arg: '[auto|manual|edits|plan|bypass]', picker: true },
  { name: 'permissions', desc: 'What runs without asking, what never runs, which files always ask, and the start-up mode', arg: '[allow|never|protect|remove|mode|forget|test]' },
  { name: 'math', desc: 'Ask with the math notes (~/Desktop/MATH); alone: list its topics', arg: '[question]' },
  { name: 'design', desc: 'Ask with the design examples; alone: the folder and what is on · on|off, check on|off, ask on|off (look before it checks), sets all|<set,set>, style auto|opus|fable|mix, studio [on|off] (the UI pieces)', arg: '[request|on|off|check|ask|sets|style|studio]' },
  { name: 'init', desc: 'Write an AGENTS.md with notes about this project' },
  { name: 'memory', desc: 'What Agentic Coder remembers about you and this project; undo takes the last save back', arg: '[undo|open]' },
  { name: 'instructions', desc: 'Edit the instructions and prompt files (AGENTS, TOOLS, SKILLS.md) in the hub' },
  { name: 'rules', desc: 'What the model reads at every start, numbered; add, switch off or remove a rule', arg: '[add|off|on|remove|always|open]' },
  { name: 'helpers', desc: 'The context helpers (Scout, Medic, Oracle, Sentry): what comes along with a request before the first step; switch one on or off', arg: '[on|off] [number|name|all]' },
  { name: 'hooks', desc: "The app's checks (empty reply, tests after a change, done check…) as hooks: which run while the model decides (/effort's Who decides); switch one on or off; lean switches them all off (the model checks its own work, like Claude Code), full brings them back", arg: '[on|off] [number|name|all] | lean | full' },
  { name: 'rewind', desc: 'Put the files and the conversation back to before one of your messages (esc twice)' },
  { name: 'resume', desc: 'Pick up an earlier conversation in this folder; a number opens the one the start page numbers so', arg: '[n]', picker: true },
  { name: 'model', desc: 'Pick the model and its effort' },
  { name: 'profiles', desc: 'Profiles: a server, a model and its settings by name; give each AI, task type, category and skill one, and a change reaches the next request, mid-task too' },
  // The model is off when a window opens (the user's pick, 30 Sep 2026): /start loads it, /stop gives its memory back.
  { name: 'start', desc: "Load the model (ctrl+t too): it takes the Mac's memory until /stop or you quit" },
  { name: 'stop', desc: 'Unload the model and give its memory back to the Mac (ctrl+t too); /start loads it again' },
  { name: 'subagents', desc: 'The helper models, one per job (pictures, side jobs, code search, a second opinion, UI design): opens /profiles on its AIs group' },
  // On the Claude API only (8 Oct 2026): what is left of the month's spend cap, today, and the limits each minute.
  { name: 'usage', desc: 'What the Claude API has left: this month against your spend cap, today’s dollars, and the limits each minute (r asks Anthropic now)' },
  { name: 'remote', desc: 'Where the model runs: this Mac, the Claude API, your other computer or another service; Connect checks it first', arg: '[claude|computer|service|here]', picker: true },
  { name: 'jumptomac', desc: 'Jump this window to your other Mac: its sessions open here, shown on both screens, and ctrl+b there comes back here (that Mac needs coding door on; alone: a box of your saved Macs, online or not)', arg: '[mac]', picker: true },
  { name: 'loop', desc: 'Send a message again by itself, every so often or until its job is done: /loop test 5m, /loop debug, /loop web 30m <what to read>, /loop 10m <message>; alone: this window’s loops', arg: '[debug|test|web] [10m] [message]' },
  { name: 'loops', desc: 'Open the loop board in this window: a card per loop that says what it is doing, and a box to tell it what to do' },
  { name: 'web', desc: 'What the model may do on the web: search with Brave Search or Tavily (your API key), read pages (each site asks first), and Claude’s own web tools on the Claude API; Test checks the key', picker: true },
  { name: 'mcp', desc: 'Your MCP servers: tools from programs on this Mac and services on the internet (GitHub, a database, your own scripts); add one, Test it, switch its tools on or off and mark the ones that only read; each tool asks before its first use' },
  { name: 'jobs', desc: 'The commands the model runs in the background (a dev server, a long test run): each one, how long it has run, its last lines; /jobs stop <id|all> stops them', arg: '[stop <id|all>]' },
  { name: 'home', desc: 'The start page as the Menu (one list of conversations and actions) or the Launcher (the bot); alone: the other one', arg: '[menu|launcher]' },
  { name: 'stats', desc: 'Speed, memory and context used' },
  { name: 'meters', desc: 'Show or hide the status bar under the prompt', arg: '[on|off]', picker: true },
  { name: 'autostart', desc: 'Load the model as soon as a window opens (on), or only when you type /start (off, the default)', arg: '[on|off]', picker: true },
  { name: 'mouse', desc: 'Drag to highlight the text you are typing in the prompt box (copied at once, delete removes it); click the model’s label in the footer to start or stop it', arg: '[on|off]', picker: true },
  { name: 'steps', desc: 'How a reply’s steps show: grouped (each stretch of work is one box; a click or ctrl+o opens it), open (every step) or words (only what the model says); alone: the next one', arg: '[grouped|open|words]' },
  { name: 'bot', desc: 'The bot over the prompt box: hide it (it waves and dives into the box) or show it again (it pops back out); alone: the other one', arg: '[hide|show]' },
  { name: 'doctor', desc: 'Check the model, the server and this Mac' },
  { name: 'weights', desc: "See the models' weights in the browser (the hub)" },
  { name: 'docs', desc: 'Open the hub on the harness and structure diagrams and every Agentic Coder page' },
  { name: 'arena', desc: 'Open the hub on the Arena: run a test on one model, or battle two with it (the New 28, Work 28, Practice 28, tests you make, the checks), one model at a time' },
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
    { name: 'autostart', label: 'Model at start', note: 'load the model as a window opens, or wait for /start' },
    { name: 'helpers', label: 'Helpers', note: 'what comes along with each request' },
    { name: 'hooks', label: 'Hooks', note: "the app's checks, while the model decides" },
    { name: 'rules', label: 'Rules', note: 'what the model reads at every start' },
    { name: 'instructions', label: 'Instructions', note: 'instructions and prompt files, in the browser' },
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

// On an Ollama service /profiles takes the place of /start and /stop (they load and unload the model
// on this Mac), so the / menu holds 17 there, within the 18 that fit an 80 × 24 window (until 8 Oct 2026
// /subagents had that row). Each still works typed in full.
const SERVICE_ONLY = new Set([]);
// Typed only (2 Oct 2026): /agents took /morning's row in the / menu, which holds 18 at 80 × 24, and
// /settings is as full; /morning still runs typed in full, and /help lists it.
// /subagents too (8 Oct 2026): /profiles took its row; typed, it opens /profiles on its AIs group.
// /home too (8 Oct 2026): the Menu or the Launcher as the start page.
export const TYPED_ONLY = new Set(['morning', 'subagents', 'home']);
// On a remote only (8 Oct 2026): profiles are servers and models on /remote, so on this Mac's own model
// /profiles is not in the menu (typed in full it says so).
const REMOTE_MENU = new Set(['profiles']);
// On the Claude API only (8 Oct 2026): /usage reads what Anthropic sends with its replies; typed in full
// on another model it says so.
const CLAUDE_MENU = new Set(['usage']);
// In the / menu where it fits (3 Oct 2026, the owner: "i dont see the new command?"; it had been
// typed only, so nothing showed it, not even /jump): listed in the whole menu in a window with room
// for one more row than the 18 an 80 × 24 window holds, and found in any window once its name is typed.
// /loop and /loops (3 Oct 2026) follow it the same way, and /mcp after them (the owner's pick: typed in
// full, like /jumptomac; the hub's Help page lists it), in this order: a window with one free row
// shows /jumptomac, with four all of them.
// /jobs (3 Oct 2026): the background commands, listed and stopped.
// /calc (8 Oct 2026, the owner: "add it to the agentic coder commands, under the hub (/help) command") last:
// in a window with room it is the row under /help, and typing /c finds it anywhere.
// /bot (9 Oct 2026): hides or shows the bot over the prompt box (bot-layer.jsx); last, so it goes first.
// /steps (9 Oct 2026): how a reply's steps show (rail.jsx groupWork); after /bot.
export const WHEN_ROOM = new Set(['jumptomac', 'loop', 'loops', 'mcp', 'jobs', 'calc', 'bot', 'steps']);
const MAC_ONLY = new Set(['start', 'stop']);
// /btw works only where another model, or a second lane, can take the question while the main one
// works: on a remote (3 Oct 2026, the owner's pick), or a server given with --url --slots 2. On
// this Mac's own model it is not in the menu; typed in full it says where it works.
export const REMOTE_ONLY = new Set(['btw']);

// The / menu: every command but the ones /settings holds. service: on an Ollama service now.
// room: the rows the menu may take in this window (18 at 80 × 24). side: a side question can be
// taken here (a remote, or a server with a second lane). claude: on the Claude API now (/usage).
export function matchCommands(value, { service = false, room = 18, side = false, remote = false, claude = false } = {}) {
  const m = /^\/(\S*)$/.exec(value);
  if (!m) return [];
  const q = m[1].toLowerCase();
  const all = COMMANDS.filter((c) => !IN_SETTINGS.has(c.name) && !TYPED_ONLY.has(c.name) && !(service ? MAC_ONLY : SERVICE_ONLY).has(c.name) && (side || !REMOTE_ONLY.has(c.name)) && (remote || !REMOTE_MENU.has(c.name)) && (claude || !CLAUDE_MENU.has(c.name)));
  // Too many for the window: the when-there-is-room ones go, the last of them first.
  const free = room - all.filter((c) => !WHEN_ROOM.has(c.name)).length;
  const kept = new Set([...WHEN_ROOM].slice(0, Math.max(0, free)));
  const shown = q || all.length <= room ? all : all.filter((c) => !WHEN_ROOM.has(c.name) || kept.has(c.name));
  return shown.filter((c) => c.name.startsWith(q)).concat(shown.filter((c) => !c.name.startsWith(q) && c.name.includes(q)));
}
