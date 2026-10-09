// Everything /help shows, in one place: the terminal's /help panel, the Help
// tab of the hub (help.html reads it as /help.json) and `coding --help` all
// come from these lists, so they never disagree. Plain data, no screen code.
import { COMMANDS, SETTINGS, IN_SETTINGS, TYPED_ONLY } from './commands.mjs';

export const VERSION = '0.1.0';

// What each mode does (the /mode menu, its note, and the Help page).
// permissions.mjs is what actually decides.
export const MODE_OPTIONS = [
  { id: 'auto', label: 'Auto', recommended: true, note: 'Agentic Coder decides: clear steps run, the model checks the rest, risky ones ask' },
  { id: 'ask', label: 'Manual', note: 'Always asks before making changes' },
  { id: 'edits', label: 'Accept edits', note: 'Automatically accepts file edits; commands still ask' },
  { id: 'plan', label: 'Plan', note: 'Reads and searches, then replies with a plan' },
  { id: 'bypass', label: 'Bypass permissions', note: 'Never asks; blocked commands and the project fence still hold. On the Claude API, Agentic Coder may work on itself' },
];

// Keys, grouped the way you meet them. [keys, what they do]
export const KEYS = [
  { group: 'The prompt', rows: [
    ['enter', 'send'],
    ['\\ then enter', 'a new line instead of sending'],
    ['↑ ↓', 'earlier prompts (on the first or last row of the box; inside a long prompt they move a row)'],
    ['/', 'the command list; keep typing to narrow it, enter or tab to pick'],
    ['@', 'attach a file: type part of its name and pick it (a picture is shown to the model, a PDF gives its text)'],
    ['cmd+v', 'paste text; text copied off this window (one of your messages, the prompt box) comes back as you wrote it, without the line breaks, indents, padding and │ edges the screen drew (ctrl+z: as copied)'],
    ['ctrl+v', 'attach the picture on the clipboard (a screenshot copied with ctrl+shift+cmd+4) as [Image #1]'],
    ['drag a file in', 'any file or folder dragged into the window becomes a chip at once ([Image #1], [PDF #2], [File #3], [Folder #4]), copied (moving the file afterwards changes nothing), with a card over the prompt box: a small picture of it, its name and what it holds; the model gets its text (Word, Excel, code, CSV), a zip\'s or a folder\'s list, or its name; delete takes a chip away in one piece'],
    ['ctrl+f', 'open what the prompt has attached full size, in Quick Look (← → between several); a click on a card opens that one'],
    ['!', 'run a shell command yourself, e.g. !ls'],
    ['?', 'show or hide the short list of shortcuts (on an empty prompt)'],
    ['ctrl+b', 'send this window to the background: the session keeps running with no window; coding attach opens it again, here or from another Mac (coding door on)'],
  ] },
  { group: 'Moving and deleting in the text', rows: [
    ['← →', 'move one character'],
    ['option + ← →', 'move one word'],
    ['option + click', 'put the cursor on the letter you click (Terminal moves it with arrow keys)'],
    ['ctrl+a · ctrl+e', 'start · end of the line'],
    ['option + a · ctrl+a twice', 'select the whole prompt: delete clears it, typing or a paste replaces it (not copied, so ⌘V pastes over it); in shell mode the ! stays'],
    ['option + delete · ctrl+w', 'delete the word before the cursor'],
    ['ctrl+u', 'delete everything before the cursor on this line'],
    ['ctrl+k', 'delete everything after the cursor on this line'],
    ['shift + ← →', 'select, a character at a time (with option: a word at a time)'],
    ['shift + ↑ ↓', 'select a line up or down; past the first or last line it reaches the start or end, so from the end shift+↑ selects everything'],
    ['click · drag · double click', 'put the cursor there · highlight · take the word (hold fn for Terminal’s own highlight; /mouse off gives the mouse back to Terminal); a click on the model’s label in the footer starts or stops it'],
    ['drag over the conversation', 'Terminal’s own highlight, as in Claude Code: the pointer resting on the text, a click on it or a scroll gives Terminal the mouse; ⌘C copies; any key or paste gives it back to the box'],
    ['ctrl+t', 'start or stop the model on this Mac: the footer’s label says which, and how much memory it holds; on a remote model, open the model list'],
    ['(selecting)', 'selected text is copied to the clipboard at once: “copied N chars to clipboard” (not the whole prompt selected with option + a)'],
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
    ['/btw question', 'a quick side question: answered in a panel from the conversation so far, never added to it. Only on a remote (/remote): the lowest model there answers when the service has it ready, else the main one, and the panel says who answered; asked while the main model writes on a service that takes one request at a time, it answers when that reply ends. Off on this Mac’s own model'],
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
    ['space · type', 'in Agentic Coder’s question: tick a choice (several may be ticked) · write your own answer in its last row'],
    ['← → · tab', 'in Agentic Coder’s questions: the next or the last question; the answers are kept until Submit'],
    ['shift+tab', 'in an edit question: yes, and don’t ask again for edits'],
  ] },
  { group: 'Everywhere', rows: [
    ['shift+tab', 'switch mode: manual → accept edits → plan → auto (bypass only from /mode)'],
    ['ctrl+c twice · ctrl+d', 'quit (ctrl+d on an empty prompt)'],
    ['ctrl+p', 'compact now: summarize the conversation to free context, as /compact'],
    ['ctrl+r', 'a second opinion on the last change now: the Second opinion’s model (/profiles) reads it, and what it finds goes into the prompt'],
  ] },
];

// The models for the setup line, from the model list (passed in, so Help itself imports no models): the default first.
export const setupModels = (all, defaultId) => [all[defaultId], ...Object.values(all).filter((m) => m.id !== defaultId)].filter(Boolean).map((m) => ({ id: m.id, name: m.name }));

// `coding …` from a terminal. lingerMins: how long a model left by a closed window stays loaded.
// models: the ones in /model ({ id, name }, the default first), for the setup line.
function cliRows(lingerMins = 30, models = []) {
  const others = models.slice(1);
  return {
    usage: [
      ['coding', 'start in the current folder'],
      ['coding "fix the tests"', 'start and send a first prompt'],
      ['coding -p "question"', 'answer once and exit (changes are refused unless --yes; commands you allowed in /permissions run)'],
      ['coding -p --agents "request"', "the request through /agents' six stages with no screen: the first answer to each question; --yes allows the stop list"],
      ['coding -c', 'continue the last conversation in this folder'],
      ['coding connect [address]', 'terminal only: use a model on another machine or an API (asks for the address and key, checks them, saves them); nothing is downloaded'],
      ['coding setup', 'download the model and runtime (if missing) and check them'],
      [`coding setup --model ${others[0]?.id ?? '<id>'}`, `the same for another model in /model${others.length ? ` (${others.map((m) => `${m.id}: ${m.name}`).join(', ')})` : ''}`],
      ['coding stop', `free the memory of a model no window uses (one left by a window that crashed stays loaded up to ${lingerMins} min)`],
      ['coding serve', 'this machine’s model for /remote on another machine, behind an API key (--local: for an SSH tunnel; --port, --ctx, --model, --https cert key, --new-key)'],
      ['coding --bg ["prompt"]', 'start in the background, with no window (a prompt is worked on at once); ctrl+b in any window sends it there too'],
      ['coding sessions [mac]', 'what runs in the background on this Mac, or on another Mac through its door'],
      ['coding attach [name]', 'open a background session in this window (ctrl+b leaves it running); coding attach <mac> opens one on another Mac or starts one there, in a folder you pick; that Mac shows it in a window too, and a lost link comes back by itself'],
      ['coding door on|off', 'let your other Macs open the sessions here, over Tailscale only, with a key (type it in Terminal; after a restart a Terminal window opens to start it again; start starts it, new-key makes a new key)'],
      ['coding loops', 'the loop board of a coding window, in another terminal: a card per loop made with /loop (what it is doing now, its last run, its next, your last note), what happened, and a box to tell it what to do. Typing always goes in the box; ^N new, ^R run now, ^P pause, ^S stop, ^O rules, ^X start over, ^B undo, ^G whole run; esc closes it and the loops go on. /loops in the app shows the same board in its own window'],
      ['coding hub [tab]', 'the hub in the browser (ctrl+c here closes it), on a tab: weights (the default), docs, arena (tests opens it on the record), builder (the Arena with the Test builder open over it), remote (the models on the services saved with /remote), memory, instructions, help'],
      ['coding memory-review', 'read the day’s conversations again and tidy the memory (--install runs it at night, --status says if it would run now)'],
      ['coding morning', 'the morning brief on your repos, opened in the browser (--plain: no model)'],
    ],
    options: [
      ['--effort low|medium|high', 'how much the model thinks before it acts (default: low = answers straight away)'],
      ['--think / --no-think', 'the old names: --effort medium / --effort low'],
      ['--ctx 16k|32k|64k|128k', 'memory size (default: 32k, or 16k when memory is short; /effort saves one)'],
      ['--mode auto|manual|edits|plan|bypass', 'start in this permission mode'],
      ['--yes', 'with -p: allow edits and commands without asking (your /permissions never-list still holds)'],
      ['--url http://host:port', 'use a llama-server that is already running'],
      ['--local', 'use the model on this Mac even when /remote is on'],
      ['--start', 'load the model as the window opens (otherwise it is off until you type /start; /autostart on does this every time)'],
      ['--folder <path>', 'work in this folder, not the one coding was typed in (typed in the home folder, coding asks which folder)'],
      ['--no-flows', 'always work step by step (skip the focused fix/change/rename paths)'],
      ['--way model', "the model decides, like Claude Code: no sorting or reading ahead, its own tools. next-step, tests, stuck, said-done, look-first and real-files start on; /hooks switches the rest (--way app: as before; /effort's Who decides row keeps it)"],
      ['-v, --version', 'print the version'],
      ['-h, --help', 'this help'],
    ],
  };
}

// The text `coding --help` prints.
export function cliHelpText({ version, modelName, lingerMins, models = [] }) {
  const { usage, options } = cliRows(lingerMins, models);
  const pad = (rows) => rows.map(([a, b]) => `  ${a.padEnd(26)}${b}`).join('\n');
  return `coding ${version} — a coding agent in your terminal, running ${modelName} on this Mac (or on another machine: /remote)\n\nUsage\n${pad(usage)}\n\nOptions\n${pad(options)}\n`;
}

// Where Agentic Coder keeps things. [where, what]
const PLACES = [
  ['~/.agentic-coder/models', 'the model files (coding setup puts them there)'],
  ['~/.agentic-coder/settings.json', 'your choices that are kept: effort, the status bar, the mouse, the model'],
  ['~/.agentic-coder/trust.json', 'the folders you said yes to in the safety check'],
  ['Keychain · agentic-coder-remote', 'each /remote service’s API key (the Claude API, your other computer, another service), and the web search service’s key /web uses (settings.json keeps only their last 4 characters)'],
  ['~/.agentic-coder/background', 'the sessions running with no window (coding sessions lists them; only you can open the folder)'],
  ['~/.agentic-coder/loops', 'the loops of each open window, written for their board (coding loops); a window’s folder goes when the window closes'],
  ['~/.agentic-coder/door.key', 'the key coding door asks your other Macs for (readable by you only)'],
  ['~/.agentic-coder/logs/sessions.log', 'what the background sessions did: started, a window joined or left (and from which Mac), ended'],
  ['~/.agentic-coder/serve.key', 'the API key coding serve asks other machines for (readable by you only)'],
  ['~/.agentic-coder/mcp.json', 'your MCP servers (/mcp), for every folder: each one’s command or address, its sandbox, and your marks on its tools (off, and “reads”). Never a key: the Keychain holds those, under mcp-<server>'],
  ['.agentic/mcp.json', 'a project’s own MCP servers: never started before you said yes to that very file, and asked about again when it changes; the model cannot change it without asking'],
  ['~/.agentic-coder/hooks.json', 'your own hooks (/hooks), for every folder: commands of yours run before or after a step, when you send a message, when a reply ends, when it asks you, and when a window opens or closes, in Claude Code’s layout (copy one over as it is)'],
  ['.agentic/hooks.json', 'a project’s own hooks: never run before you said yes to that very file in /hooks (kept in ~/.agentic-coder/hooks-state.json), and asked about again when it changes; the model cannot change it'],
  ['~/.agentic-coder/logs/mcp-<server>.log', 'what an MCP server printed, and when it started, stopped or changed its tools'],
  ['Keychain · mcp-<server>-signin', 'an MCP server you signed in to: the app’s registration with it and its tokens, refreshed by themselves; /mcp’s o takes them away'],
  ['~/.agentic-coder/permissions.json', 'what you saved with /permissions, by folder: commands that run without asking or never run, protected files, the start-up mode'],
  ['~/.agentic-coder/sessions', 'saved conversations, for coding -c and /resume'],
  ['~/.agentic-coder/logs', 'the model server and update logs'],
  ['AGENTS.md or CLAUDE.md', "your rules for Agentic Coder, read at the start from the working folder and every folder above it, up to your home folder (/init writes one). Nothing else is read as rules"],
  ['.agentic/settings.json', 'this folder only: mode, effort, and "memory": false to turn the memory off here'],
  ['.agentic/memory', 'what Agentic Coder remembers about this project: one small file per fact in facts/, kept out of git; edit or delete them freely'],
  ['~/.agentic/memory', 'what Agentic Coder remembers about you: how you like to work; it follows you into every project'],
  ['.agentic/notes.md', 'the older notes file: its lines are carried over into the memory the first time; it is not read as rules any more'],
  ['docs/private/design examples', 'the design cards that come with a request to make or restyle a page, one folder per set (your picks, your rules, opus, fable, public systems), plus look cards (calm, dense, bold, dark) that restyle any kind; read-only to the model as DESIGN/'],
];

// How Agentic Coder keeps you safe, in plain words.
const SAFETY = [
  'The first time you start Agentic Coder in a folder it asks whether you trust it. Nothing there is read before you say yes.',
  'It asks before every edit and before commands that change things, unless you switch the mode. A git commit and a git push always ask (a push in Bypass on Claude runs); a push you say yes to may reach GitHub.',
  'Some commands are always refused: deleting folders wholesale, sudo, a force push, resetting git, stopping other programs or services.',
  'Files like .env, keys and .git always ask before a change, even in Accept edits and Auto.',
  '/permissions adds your own rules on top (commands that run without asking, commands that never run, more protected files). They never lift the ones above.',
  'Commands run fenced in: they cannot read your home folder beyond the project, signal other programs, reach services already running, or open a connection off this Mac.',
  'Everything runs on this Mac. Nothing you type is sent anywhere, unless you turn on /remote: then your prompts, your code and the files it reads go to the machine you named, and it says so when it switches.',
  'MCP servers (/mcp) give the model tools from outside the app: a program on this Mac, or a service. A program runs behind the same fence as the model’s commands, with the internet and local services opened only as you set them for that server. Each tool asks before its first use (Mcp(server:tool) in /permissions); “reads” is your own mark, never the server’s word; a tool that changes after you allowed it asks again; what a tool returns is marked as data, never instructions; a project’s own servers wait for your yes.',
  'The web: a search sends its words to the search service you picked in /web, and a page is read from its site. Each asks first (a site once, if you say so); a redirect to another site is not followed. What comes back is marked as data, never instructions.',
];

export const TIPS = [
  'Say what you want in one or two sentences, and name the file when you know it: “add a --json flag to export.mjs”.',
  'Agentic Coder asks when something is unclear, often with answers to pick. Answer with the number, or type your own answer.',
  'Under your request a dim line says where it went: “Sorted as: change · shortcut”. If that is not what you meant, press esc and say it differently.',
  'Low effort is fastest and fine for most work. Try Medium or High for a tricky bug.',
  'Use Plan mode to see a plan before anything changes, then switch mode and say go.',
  '/permissions shows what runs without asking, what never runs and which files always ask. Pick "always allow" when it asks about a command and it is saved for the folder; /permissions test npm test says what a command would do without running it.',
  'Agentic Coder learns as it works: after a task it shows what it would remember and asks (enter saves, esc skips), and a fact comes back when a request fits it. When the window closes it reads the conversation again and asks about anything new at the next start; a fact you skip is not offered again. Test prompts (the Arena’s, the design runs’) teach it nothing. “/update memory” or “remember that …” saves at once.',
  '/memory shows what it keeps and how it did in the last 7 days, /memory undo takes the last save back, /memory open shows every fact in the browser.',
  '/rules lists what the model reads at every start, numbered: /rules add <text> adds a rule, /rules off 3 switches one off (/rules on 3 brings it back), /rules always 16 makes a note a rule. Up to 20 rules.',
  '/helpers lists the four context helpers, numbered, by codename: 1 Scout reads the files you name, 2 Medic brings the failing tests and the changes, 3 Oracle finds code by meaning, 4 Sentry runs the light checks. /helpers off 3 or /helpers off oracle switches one off (its old name, rag, works too), /helpers on oracle brings it back, /helpers off all turns them all off. They are kept in settings.json; AGENTIC_HELPERS, when set, decides instead.',
  'A fact earns trust when the task passed its check after it was used, and loses it when the task failed or you corrected Agentic Coder. One that keeps failing is taken out of use.',
  '/compact frees memory in a long conversation; /clear starts fresh.',
  'Your math notes in ~/Desktop/MATH are used only when you ask with /math.',
  'Ask for a page, a screen or a restyle and the closest design card comes with it (the "design examples" folder), and once the page is saved a browser check sends back what is broken (a page that scrolls sideways, text that overlaps or is too faint, script errors) and, on a model on another machine that can see, a look at a picture of it sends back what looks off; then it opens and asks you: Looks good (and whether to keep it as one of your picks), or Check it for me (/design ask off: it checks and sends back by itself; /design polish off: it asks before any check; /design plan off: no six-line plan before writing; /design learn off: Looks good keeps nothing). /design lists the cards; /design off, /design check off and /design sets opus,fable change what comes; /design style opus, fable or mix picks whose cards win (mix: Opus and Fable take turns); words such as "minimal", "compact", "playful" or "dark" in a request bring that look; /design <request> brings the cards to any request. /design update downloads the newest free UI libraries (HyperUI, Flowbite, shadcn/ui for React projects), 68 brand looks and Anthropic\'s design skills into the studio\'s library, in your colours and each checked in a browser; /design library lists them; "like Linear" in a request, or /design look linear, builds that page in a brand\'s colours and type (/design look off: your own).',
];

// Everything the Help page shows, for /help.json.
export function helpData({ version = '', modelName = '', effort = [], lingerMins = 30, models = [] } = {}) {
  return {
    version, modelName,
    commands: COMMANDS.map((c) => ({ name: c.name, arg: c.arg ?? '', desc: c.desc, menu: !!c.picker, settings: IN_SETTINGS.has(c.name), typed: TYPED_ONLY.has(c.name) })),
    settings: SETTINGS.map((g) => ({ group: g.group, names: g.rows.map((r) => r.name) })),
    keys: KEYS,
    cli: cliRows(lingerMins, models),
    modes: MODE_OPTIONS,
    effort: effort.map((l) => ({ id: l.id, label: l.label, note: l.note ?? '' })),
    places: PLACES,
    safety: SAFETY,
    tips: TIPS,
  };
}
