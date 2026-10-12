// The menu under the prompt (App.jsx): the slash commands, an MCP server's prompts after /server:, its
// resources after @server:, and the project's files after @. Moved here word for word: the App's names are
// read from self, and the few made in the render just before (perm and the rest stay in App.jsx) are given.
import { matchCommands } from './commands.mjs';
import { heldRows, MENU_ROWS } from './screen.jsx';
import { START_BIG } from './start.jsx';
import { mentionAt } from './edit-input.mjs';
import { walk } from '../tools/fs.mjs';

export function promptMenu(self, { inputMode, claudeModel, offerList, filesRef }) {
  const { input, holdRef, rows, items, measure, model, remoteRef, opts, agent, mcpHub, mcpLists, cwd } = self;
  let menu = null;
  // The rows the / menu may take: 18 as ever, and more in a window with room for them (the box, the
  // footer and their gaps take 5; the box's edge is the window's last line). Under the start page while
  // it is still live, the rows it can give up and still show its bot (2 + START_BIG and its blank line;
  // start.room, below, shrinks it to fit).
  const fits = holdRef.current ? (rows ?? 40) - 7 - heldRows(items, measure.current) - 2 - START_BIG : (rows ?? 24) - 5;
  const room = Math.max(MENU_ROWS, Number.isFinite(fits) ? fits : 0);
  const cmds = inputMode === 'prompt' ? matchCommands(input.value, { service: Boolean(model.remote?.ollama && remoteRef.current.conn?.info?.ollama), room, side: Boolean(model.remote) || (Boolean(opts.url) && agent.slots?.side !== undefined), remote: Boolean(model.remote), claude: Boolean(claudeModel) }) : [];
  if (cmds.length) menu = { kind: 'slash', rows: room, pad: Math.max(14, ...cmds.map((c) => c.name.length + 3)), items: cmds.map((c) => ({ label: `/${c.name}`, desc: c.desc, value: c.name, takesArg: !!c.arg, picker: !!c.picker })) };
  // /shop: lists that MCP server's prompts (typed in full they run: /shop:review-pr 57).
  const slashServer = inputMode === 'prompt' && mcpHub ? /^\/([A-Za-z0-9][A-Za-z0-9-]{0,31}):(\S*)$/.exec(input.value) : null;
  if (!menu && slashServer && mcpHub.offers().prompts.includes(slashServer[1])) {
    const q = slashServer[2].toLowerCase();
    const list = offerList('prompts', slashServer[1]).filter((p) => p.name.toLowerCase().includes(q));
    if (list.length) menu = { kind: 'slash', rows: room, pad: Math.max(14, ...list.map((p) => slashServer[1].length + p.name.length + 4)), items: list.map((p) => ({ label: `/${slashServer[1]}:${p.name}`, desc: `${p.description ?? p.title ?? 'a prompt of this server'}${p.arguments?.length ? ` · ${p.arguments.map((a) => `${a.name}${a.required ? '' : '?'}`).join(' ')}` : ''}`, value: `${slashServer[1]}:${p.name}`, takesArg: Boolean(p.arguments?.length) })) };
  }
  const at = mentionAt(input);
  // @shop: lists that MCP server's resources; @sh offers the servers that have them.
  const offers = mcpHub && at ? mcpHub.offers().resources : [];
  const atServer = at ? /^([A-Za-z0-9][A-Za-z0-9-]{0,31}):(.*)$/.exec(at.query) : null;
  if (!menu && atServer && offers.includes(atServer[1])) {
    const q = atServer[2].toLowerCase();
    const list = offerList('resources', atServer[1]).filter((r) => `${r.uri} ${r.name ?? ''}`.toLowerCase().includes(q)).slice(0, 50);
    const lw = Math.min(60, Math.max(16, ...list.map((r) => atServer[1].length + String(r.uri).length + 4)));
    menu = { kind: 'files', pad: lw, at, items: list.length ? list.map((r) => ({ label: `@${atServer[1]}:${r.uri}`, desc: r.name ?? r.title ?? '', value: `${atServer[1]}:${r.uri}` })) : [{ label: `@${atServer[1]}:`, desc: mcpLists.current.resources[atServer[1]] === null ? 'loading its resources…' : 'it lists no resource that matches', value: `${atServer[1]}:` }] };
  }
  if (!menu && at && !atServer) for (const s of offers.filter((n) => n.toLowerCase().startsWith(at.query.toLowerCase()))) (menu ??= { kind: 'files', pad: 20, at, items: [] }).items.push({ label: `@${s}:`, desc: `the resources of your MCP server ${s}`, value: `${s}:`, open: true });
  if (!menu && at) {
    if (!filesRef.current) { filesRef.current = []; let n = 0; for (const f of walk(cwd)) { if (!f.dir) filesRef.current.push(f.path); if (++n > 5000) break; } }
    const q = at.query.toLowerCase();
    const hits = filesRef.current.filter((f) => f.toLowerCase().includes(q)).sort((a, b) => (a.toLowerCase().startsWith(q) ? 0 : 1) - (b.toLowerCase().startsWith(q) ? 0 : 1) || a.length - b.length).slice(0, 50);
    if (hits.length) menu = { kind: 'files', pad: 0, at, items: hits.map((f) => ({ label: `@${f}`, value: f })) };
  }
  return menu;
}
