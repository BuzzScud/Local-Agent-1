// hearth's tools with hearth's key (20 Nov 2026, the owner: "can we add the ability to switch to a hearth api key here? …
// if we use the api, does it automatically have its tools?", picked "Add it, and bring hearth's tools"). hearth's API
// (HEARTH_ADDRESS, an hk_ key) is the model only: hearth's own tools are its MCP server at /mcp on the same site, which
// takes a sign-in (hearth's docs/mcp.md, "Apps that sign in"), not the hk_ key. So the first switch to hearth offers to
// add that server here as an MCP server you sign in to (mcp-auth.mjs), saved like one added with /mcp; "Never" is kept.
import { HEARTH_ADDRESS } from '../../../models/index.mjs';
import { serverOf } from './mcp-store.mjs';
import { readyRemote, remotesOf } from './remote-form.mjs';
import { keysOf, savedKeyId } from './claude-keys.mjs';

export const HEARTH_TOOLS_NAME = 'hearth';
// The hearth your key is for: its saved address (/remote hearth's More), else hearth's own.
export const hearthAddressOf = (settings) => settings?.remotes?.hearth?.address || HEARTH_ADDRESS;
// The same site as the API: https://employee.hearth.monster/door/v1 → https://employee.hearth.monster/mcp
export const hearthMcpUrl = (address = HEARTH_ADDRESS) => { try { return `${new URL(address).origin}/mcp`; } catch { return null; } };

const siteOf = (url) => { try { const u = new URL(url); return `${u.host}${u.pathname.replace(/\/+$/, '')}`; } catch { return null; } };
// The server of yours that is hearth's /mcp (by its address, whatever you named it), or null.
export function hearthServerIn(servers = [], address = HEARTH_ADDRESS) {
  const want = siteOf(hearthMcpUrl(address));
  return servers.find((s) => s?.runs === 'address' && want && siteOf(s.url) === want) ?? null;
}
// The server to save: hearth's /mcp, signed in to. A name of yours already "hearth" (another server) gets "hearth-tools".
export function hearthToolsServer(servers = [], address = HEARTH_ADDRESS) {
  const taken = servers.some((s) => s?.name === HEARTH_TOOLS_NAME);
  return serverOf(taken ? `${HEARTH_TOOLS_NAME}-tools` : HEARTH_TOOLS_NAME, { url: hearthMcpUrl(address), auth: 'oauth' }, { from: 'you' });
}
// For the window's account box (window/ui.html): hearth's key as saved (never the key: its last four), whether this
// window runs on it, its tools' server as the MCP hub has it now, and the Claude API's saved key to come back to.
// source: the model's remote source; hub: the window's MCP hub (or null).
export function hearthAccount({ settings = {}, source = null, hub = null } = {}) {
  const h = remotesOf(settings).hearth;
  const cfgs = hub ? [...hub.servers.values()].map((s) => ({ ...s.cfg, state: s.state, count: s.tools?.length ?? 0 })) : [];
  const t = hearthServerIn(cfgs, hearthAddressOf(settings));
  const ks = keysOf(settings), id = savedKeyId(settings);
  const c = ks.find((k) => k.id === id) ?? null;
  return {
    on: source === 'hearth',
    hearth: readyRemote(h) ? { end: h.keyEnd ?? '' } : null,
    tools: t ? { name: t.name, state: t.state ?? 'off', count: t.count } : null,
    claude: id ? { name: c?.name ?? '', end: c?.end ?? settings.remotes?.claude?.keyEnd ?? '' } : null,
  };
}
// Whether a switch to hearth asks about its tools: not when they are here already, nor after "Never".
export const offerHearthTools = ({ servers = [], settings = {}, address = hearthAddressOf(settings) } = {}) => settings?.hearthTools !== 'never' && !hearthServerIn(servers, address);
