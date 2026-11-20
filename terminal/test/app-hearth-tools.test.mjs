// hearth's key and hearth's tools in the real window (20 Nov 2026, the owner: "can we add the ability to switch to a hearth
// api key here? … if we use the api, does it automatically have its tools? or do we need to still connect to the mcp
// server?", picked "Add it, and bring hearth's tools"). A stand-in hearth on one address, as the real one: its door
// (/door/v1, the model: a stand-in Ollama behind it) and its /mcp with hearth's sign-in under /mcp/oauth. /remote hearth
// switches to it; the question asks about its tools, since the key is the model only; yes signs in (the stand-in
// "browser" says yes), saves the server, and its tools are there. Then "Never ask" is kept, and /remote hearth tools
// still works.
import { test, expect } from 'bun:test';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { T, setup, ON_REMOTE } from './app-setup.mjs';
import { fakeOllama } from './fake-ollama.mjs';
import { startFakeMcp } from './fake-mcp.mjs';

const flat = (text) => text.replace(/\s+/g, ' ');

// One site: /door/… to the stand-in model server (the door's prefix taken off), the rest to the stand-in MCP server.
function oneSite(modelUrl, mcpUrl) {
  const mcpBase = new URL(mcpUrl).origin;
  const server = Bun.serve({ port: 0, idleTimeout: 0, async fetch(req) {
    const u = new URL(req.url);
    const to = u.pathname.startsWith('/door') ? `${modelUrl}${u.pathname.slice('/door'.length)}${u.search}` : `${mcpBase}${u.pathname}${u.search}`;
    const headers = new Headers(req.headers); headers.delete('host');
    const r = await fetch(to, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(), redirect: 'manual' });
    if (to.startsWith(modelUrl)) return new Response(r.body, { status: r.status, headers: r.headers });
    // The stand-in MCP server names its own address in its sign-in details and its 401: the site's, as hearth's would.
    const out = new Headers(r.headers);
    for (const [k, v] of r.headers) if (v.includes(mcpBase)) out.set(k, v.replaceAll(mcpBase, site.url));
    if (!/json/.test(r.headers.get('content-type') ?? '')) return new Response(r.body, { status: r.status, headers: out });
    const text = (await r.text()).replaceAll(mcpBase, site.url);
    out.delete('content-length');
    return new Response(text, { status: r.status, headers: out });
  } });
  const site = { url: `http://127.0.0.1:${server.port}`, close: () => server.stop(true) };
  return site;
}

test('/remote hearth asks about hearth\'s tools; yes signs in and they join; Never ask is kept; /remote hearth tools still adds them', async () => {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(home, { recursive: true });
  const svc = await fakeOllama();
  const mcp = await startFakeMcp({ oauth: true, oauthAt: '/mcp/oauth', resourceAt: '/mcp/oauth/resource', era: 'modern' });
  const site = oneSite(svc.url, mcp.url);
  const service = { source: 'openai', address: svc.url, port: null, connect: 'http', kind: 'openai', model: 'coder:30b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  const hearth = { source: 'hearth', address: `${site.url}/door/v1`, port: null, connect: 'http', kind: 'openai', model: 'coder:30b', context: 0, key: true, keyEnd: '6789', keyId: 'hearth' };
  const start = () => writeFileSync(join(home, 'settings.json'), JSON.stringify({ remote: { ...service, use: true }, remotes: { openai: service, hearth } }));
  start();
  writeFileSync(join(home, 'remote-keys.json'), JSON.stringify({ hearth: 'hk_test0123456789abcdef' }));
  const keys = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_SIGNIN_FOLLOW: '1' };
  try {
    const r = await runInPty({ cwd, env: { ...env, ...keys }, args: ['--no-flows'], cols: 140, rows: 44, timeoutMs: 120_000, steps: [
      { wait: ON_REMOTE, ms: 25_000 }, { sleep: 800 },
      // a new home has no Main saved, so the switch does not ask which windows
      { type: '/remote hearth' }, { key: 'enter' }, { wait: 'Bring hearth’s own tools too?', ms: 20_000 }, { sleep: 300 }, { snapshot: 'asked' },
      { type: '1' }, { wait: 'Signed in to hearth', ms: 30_000 }, { sleep: 1500 }, { snapshot: 'signed' },
      { type: '/mcp' }, { key: 'enter' }, { wait: 'connected', ms: 15_000 }, { sleep: 400 }, { snapshot: 'list' }, { key: 'esc' }, { sleep: 300 },
      { key: 'ctrl+c' }, { sleep: 300 }, { key: 'ctrl+c' },
    ] });
    expect(flat(r.snapshots.asked)).toContain('hearth’s key brings its model only. Bring hearth’s own tools too?');
    expect(flat(r.snapshots.asked)).toContain('a sign-in in your browser, where you pick Read or Change');
    expect(flat(r.snapshots.asked)).toContain('Sign in and add them');
    expect(flat(r.snapshots.signed)).toContain('Signed in to hearth: its tools join at your next message');
    expect(flat(r.snapshots.list)).toMatch(/hearth .*connected/);
    // saved as a server you sign in to, at hearth's /mcp on the same site as its key
    const saved = JSON.parse(readFileSync(join(home, 'mcp.json'), 'utf8')).servers;
    expect(saved.hearth).toMatchObject({ url: `${site.url}/mcp`, auth: 'oauth' });
    expect(mcp.signin.asked.length).toBe(1);

    // Again, from the start: Never ask is kept; /remote hearth tools still adds them
    writeFileSync(join(home, 'mcp.json'), JSON.stringify({ servers: {} }));
    start();
    const r2 = await runInPty({ cwd, env: { ...env, ...keys }, args: ['--no-flows'], cols: 140, rows: 44, timeoutMs: 120_000, steps: [
      { wait: ON_REMOTE, ms: 25_000 }, { sleep: 800 },
      { type: '/remote hearth' }, { key: 'enter' }, { wait: 'Bring hearth’s own tools too?', ms: 20_000 }, { sleep: 300 },
      { type: '3' }, { wait: 'Not asked again', ms: 10_000 }, { sleep: 300 },
      { type: '/remote hearth tools' }, { key: 'enter' }, { wait: /Signed in to hearth|already/, ms: 30_000 }, { sleep: 500 }, { snapshot: 'manual' },
      { key: 'ctrl+c' }, { sleep: 300 }, { key: 'ctrl+c' },
    ] });
    expect(flat(r2.snapshots.manual)).toMatch(/Signed in to hearth|hearth’s tools are here already/);
    expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).hearthTools).toBe('never');
    expect(JSON.parse(readFileSync(join(home, 'mcp.json'), 'utf8')).servers.hearth).toMatchObject({ url: `${site.url}/mcp`, auth: 'oauth' });
  } finally {
    site.close();
    await mcp.close?.();
    await svc.close?.();
  }
}, T * 4);
