// The choices a permission question offers (screen.jsx draws them, app-panels.mjs answers them), as plain
// values: no React, no Ink, so the app's logic and its tests load them without the screen.
import { askOptions } from './app-ask.mjs';

// prefix: the rule "don't ask again" would remember (null: none can, the
// command's words cannot be trusted); saveRule: what "always allow" would save
// for this folder (/permissions), when the app can save one.
export function permissionOptions(req, prefix, saveRule = null) {
  const yes = { label: 'Yes', choice: 'yes' };
  const no = { label: 'No, and tell Agentic Coder what to do differently (esc)', choice: 'no' };
  // A question: its choices, each with what it means (about), then the row you type into (app-ask.mjs);
  // esc stops (the hint line says so). The model's questions after the first are the box's tabs.
  if (req.name === 'Ask') return askOptions(req.args);
  // A git commit asks every time (permissions.mjs), so it has no "don't ask again".
  if (req.name === 'Bash') return req.once || !prefix ? [yes, no] : [yes, { label: `Yes, and don't ask again for ${prefix} this session`, choice: 'always' }, ...(saveRule ? [{ label: `Yes, and always allow ${saveRule} in this folder`, choice: 'save' }] : []), no];
  if (req.name === 'Test') return [{ label: 'Yes, use this test', choice: 'yes' }, { label: 'No, and tell Agentic Coder what the test should check (esc)', choice: 'no' }];
  // The web: "don't ask again" for this site (or for searches) this session; "always" saves the rule for this folder.
  if (req.name === 'WebSearch' || req.name === 'WebFetch') {
    const what = req.name === 'WebSearch' ? 'web searches' : String(req.rule ?? '').replace(/^WebFetch\((.*)\)$/, '$1');
    return req.rule ? [yes, { label: `Yes, and don't ask again for ${what} this session`, choice: 'always' }, { label: `Yes, and always allow ${what} in this folder`, choice: 'save' }, no] : [yes, no];
  }
  // A tool of an MCP server: this once, this session, or saved for this folder (with the tool's fingerprint).
  if (req.name === 'Mcp') {
    const what = `${req.mcp?.server}:${req.mcp?.tool}`;
    return req.rule ? [yes, { label: `Yes, and don't ask again for ${what} this session`, choice: 'always' }, ...(saveRule ? [{ label: `Yes, and always allow ${what} in this folder`, choice: 'save' }] : []), no] : [yes, no];
  }
  // A project's own MCP servers (.agentic/mcp.json): before they may start.
  if (req.name === 'McpProject') return [{ label: `Yes, start ${req.servers.length === 1 ? req.servers[0].name : 'them'} (asked again if .agentic/mcp.json changes)`, choice: 'yes' }, { label: 'Not now (this session)', choice: 'no' }, { label: 'Never for this project', choice: 'never' }];
  // A project's own hooks (.agentic/hooks.json, user-hooks.mjs): before they run, and to stop them.
  if (req.name === 'HooksProject') return req.running
    ? [{ label: 'Stop running them (asked again next time)', choice: 'stop' }, { label: 'Keep them running (esc)', choice: 'no' }]
    : [{ label: 'Yes, run them (asked again if .agentic/hooks.json changes)', choice: 'yes' }, { label: 'Not now (this session)', choice: 'no' }, { label: 'Never for this project', choice: 'never' }];
  // The screen: once per app (the user's pick, 1 Oct 2026): this time, this session, or saved.
  if (req.name === 'Screen') return [{ label: 'This time', choice: 'yes' }, { label: 'For this session', choice: 'always' }, { label: 'Always (saved for this folder)', choice: 'save' }, { label: 'No (esc)', choice: 'no' }];
  // A protected file asks every time (permissions.mjs), so it has no "allow all edits".
  if (req.once) return [yes, no];
  if (req.name === 'Rename') return [yes, { label: 'Yes, and allow all edits this session (shift+tab)', choice: 'always' }, no];
  return [yes, { label: 'Yes, allow all edits this session (shift+tab)', choice: 'always' }, no];
}
