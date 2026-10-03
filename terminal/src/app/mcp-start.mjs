// The MCP hub for a session (3 Oct 2026): the servers of mcp.json (yours, and a project's you said
// yes to) connected through tools/mcp.mjs, with what the store keeps for them (mcp-store.mjs):
// each one's key, the era it spoke last time, its log, and the fingerprint each "always allow" was
// given for. The app and `coding -p` both start here; the practice runs and the tests pass no hub,
// so they measure the same as before. AGENTIC_MCP=off: no hub at all.
import { McpHub } from '../tools/mcp.mjs';
import { serversFor, serverKey, knownEra, rememberEra, mcpLogFile, allowedPrint, rememberAllowed } from './mcp-store.mjs';
import { oauthProvider } from './mcp-auth.mjs';

export const mcpOff = (env = process.env) => /^(off|0|false|no)$/i.test(String(env.AGENTIC_MCP ?? ''));

// { hub, project, broken }: the hub with its servers starting in the background; project: the
// folder's own mcp.json as it is (asked about by the app; never started unasked); broken: why a
// file could not be read. null when MCP is off.
// A server you sign in to gets the sign-in's provider, with nobody there: its kept tokens, refreshed
// by themselves; a sign-in that is needed is only noted (/mcp does it).
export function openMcp(cwd, { auth = (server) => oauthProvider(server) } = {}) {
  if (mcpOff()) return null;
  const hub = new McpHub({ cwd, keyOf: serverKey, era: knownEra, saveEra: rememberEra, logFile: mcpLogFile, auth, allowed: { print: allowedPrint, remember: rememberAllowed } });
  const found = serversFor(cwd);
  hub.configure(found.servers);
  return { hub, project: found.project, broken: found.broken };
}
// The servers as the files have them now, handed to a hub that is running (after /mcp saved, or a
// move to another folder). What the files say: { project, broken }.
export function reloadMcp(hub, cwd) {
  const found = serversFor(cwd);
  hub.moveTo(cwd);
  hub.configure(found.servers);
  return { project: found.project, broken: found.broken };
}
