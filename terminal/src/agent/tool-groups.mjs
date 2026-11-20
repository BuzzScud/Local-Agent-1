// Tools on demand (the owner's pick, 19 Nov 2026: "Tools on demand, like hearth"): a model on another
// machine starts with a small set of tools, and a group of the others joins the conversation when it
// asks with MoreTools, as hearth's more_tools does (hearth docs/agent-loop.md, "hearth starts smaller").
// Fewer tools in every request: less to read each step on a small context, and fewer to pick wrong
// from. The list only grows in a conversation, each group added at its end in the order it joined,
// so what went before stays the same, letter for letter, and the server keeps its place.
// Each of the user's MCP servers is a group of its own ("mcp:<server>").
// "toolsOnDemand" in settings.json: "auto" (the default: on for a model on another machine, but not
// the Claude API, where Anthropic's tool search already holds back a big list and a changed list
// costs the whole prompt again), "on" or "off". AGENTIC_TOOLS_ON_DEMAND wins over it.

export const MORE_TOOLS = 'MoreTools';

// The groups of the app's own tools, in one fixed order. A tool in none of them is always offered:
// Agent (helpers) stays in the start set, so a big model hands work off as Claude Code does without
// a step to ask for it first (app-remote.test.mjs, big-model mode).
const TOOL_GROUPS = [
  { id: 'code', about: 'a map of the project, the code search by meaning, renaming a name everywhere, and the test-first worker', tools: ['Map', 'CodeSearch', 'Rename', 'TestFirst'] },
  { id: 'web', about: 'searching the web and reading a web page', tools: ['WebSearch', 'WebFetch'] },
  { id: 'screen', about: "a picture of the user's screen or of one app's window", tools: ['Screen'] },
  { id: 'app', about: 'driving Agentic Coder itself: its slash commands, its settings, a restart', tools: ['App'] },
];
const GROUP_OF = new Map(TOOL_GROUPS.flatMap((g) => g.tools.map((t) => [t, g.id])));
export const MCP_GROUP = 'mcp:';

// Whether tools come on demand: setting "auto" | "on" | "off" (anything else: off, as a test or a
// practice run builds the agent), ep the endpoint (models/runtime/remote.mjs endpointOf).
export function onDemandOf(setting, ep, env = process.env) {
  const v = String(env.AGENTIC_TOOLS_ON_DEMAND ?? setting ?? 'off').toLowerCase();
  if (v === 'on') return true;
  if (v !== 'auto') return false;
  return Boolean(ep?.remote) && ep.kind !== 'claude';
}

// The group a tool is in: one of the app's, mcp:<server> for an MCP tool, or null (always offered).
export const groupOfTool = (name, entries = []) => {
  if (GROUP_OF.has(name)) return GROUP_OF.get(name);
  const e = entries.find((x) => x.name === name);
  return e ? `${MCP_GROUP}${e.server}` : null;
};

// The groups there are to add: the app's that hold a tool on offer (names: every tool it would
// offer), then each MCP server. → [{ id, about, tools: [names] }]
export function groupsOffered(names, entries = []) {
  const have = new Set(names);
  const own = TOOL_GROUPS.map((g) => ({ ...g, tools: g.tools.filter((t) => have.has(t)) })).filter((g) => g.tools.length);
  const servers = [...new Set(entries.map((e) => e.server))];
  return [...own, ...servers.map((s) => {
    const tools = entries.filter((e) => e.server === s).map((e) => e.name);
    return { id: `${MCP_GROUP}${s}`, about: `the user's MCP server "${s}" (${tools.length} tool${tools.length === 1 ? '' : 's'})`, tools };
  })];
}

// The MoreTools tool: every group with what is in it. The same in the whole conversation (it names
// the groups already added too), so adding one changes only the end of the list.
export function moreToolsDef(groups) {
  const lines = groups.map((g) => `- ${g.id}: ${g.about}${g.id.startsWith(MCP_GROUP) ? '' : ` (${g.tools.join(', ')})`}`);
  return { type: 'function', function: {
    name: MORE_TOOLS,
    description: `Add a group of tools to this conversation; they stay for the rest of it. You start with the tools for files, commands, plans and questions; call this when the task needs one of these:\n${lines.join('\n')}\nThe tools are yours from your next step.`,
    parameters: { type: 'object', properties: { group: { type: 'string', enum: groups.map((g) => g.id), description: 'The group to add, by its name in the list' } }, required: ['group'] },
  } };
}

// The tools a request sends: own (the app's tools, as the agent would offer them all), mcp (the MCP
// tools of the joined servers, already worked out), joined (group ids, in the order they joined).
// → the start set, MoreTools, then each joined group's tools in join order; MCP tools last.
export function onDemandTools(own, mcp, joined, groups) {
  const order = new Map(joined.map((id, i) => [id, i]));
  const start = own.filter((t) => !GROUP_OF.has(t.function.name));
  const added = own.filter((t) => order.has(GROUP_OF.get(t.function.name)))
    .sort((a, b) => order.get(GROUP_OF.get(a.function.name)) - order.get(GROUP_OF.get(b.function.name)));
  return [...start, ...(groups.length ? [moreToolsDef(groups)] : []), ...added, ...mcp];
}

// What a MoreTools call answers: { text, joined: the group to add or null, error }.
export function moreToolsAnswer(args, groups, joined) {
  const want = String(args?.group ?? '').trim().toLowerCase().replace(/^mcp__/, MCP_GROUP);
  const g = groups.find((x) => x.id.toLowerCase() === want) ?? groups.find((x) => x.id.toLowerCase() === `${MCP_GROUP}${want}`);
  if (!g) return { text: `There is no group "${args?.group ?? ''}". The groups: ${groups.map((x) => x.id).join(', ') || 'none'}.`, joined: null, error: true };
  const list = g.tools.join(', ');
  if (joined.includes(g.id)) return { text: `${g.id} is already added: ${list}. Call them now.`, joined: null };
  return { text: `Added ${g.id}: ${list}. They are yours from your next step.`, joined: g.id };
}
