// The tools server (Agentic Coder Web): the calculator's tools as an MCP server over HTTP, one
// JSON-RPC message a POST, answered as JSON (MCP's streamable HTTP, with no stream of its own).
//   /mcp            for API keys: Agentic Coder ("url" + "auth": "key"), Claude Code, any MCP app
//   /mcp/run/<tok>  for this server's own runs (their mcp.json names it; loopback only)
import { CALC_TOOLS, runCalcTool } from '../tools/calculator.mjs';

const SERVER = { name: 'agentic-coder-web', version: '0.1.0' };
// The eras this server speaks; a client asking for a newer one is answered with the newest here.
const ERAS = ['2025-11-25', '2025-06-18', '2025-03-26'];

const rpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// calc(): { url, formulas } for this request's tools.
export async function handleMcp(req, { calc, onCall = () => {} }) {
  if (req.method === 'GET') return new Response('This MCP server sends no stream: POST JSON-RPC to it.', { status: 405, headers: { allow: 'POST' } });
  if (req.method === 'DELETE') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  let msg;
  try { msg = await req.json(); } catch { return Response.json(rpcError(null, -32700, 'not JSON'), { status: 400 }); }
  const one = async (m) => {
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return m?.id !== undefined ? rpcError(m.id ?? null, -32600, 'not a JSON-RPC request') : null;
    if (m.id === undefined) return null; // a notification: nothing to answer
    if (m.method === 'initialize') {
      const asked = String(m.params?.protocolVersion ?? '');
      return rpc(m.id, { protocolVersion: ERAS.includes(asked) ? asked : ERAS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: "The user's calculator: use calculate for any arithmetic or formula instead of working it out yourself." });
    }
    if (m.method === 'ping') return rpc(m.id, {});
    if (m.method === 'tools/list') return rpc(m.id, { tools: CALC_TOOLS });
    if (m.method === 'tools/call') {
      const name = m.params?.name;
      if (!CALC_TOOLS.some((t) => t.name === name)) return rpcError(m.id, -32602, `no tool called ${name}`);
      try {
        const out = await runCalcTool(name, m.params?.arguments ?? {}, calc());
        onCall(name, out);
        return rpc(m.id, { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: out?.ok === false });
      } catch (e) { return rpc(m.id, { content: [{ type: 'text', text: e.message }], isError: true }); }
    }
    if (m.method === 'resources/list') return rpc(m.id, { resources: [] });
    if (m.method === 'prompts/list') return rpc(m.id, { prompts: [] });
    return rpcError(m.id, -32601, `no method ${m.method}`);
  };
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map(one))).filter(Boolean);
    return out.length ? Response.json(out) : new Response(null, { status: 202 });
  }
  const out = await one(msg);
  return out ? Response.json(out) : new Response(null, { status: 202 });
}
