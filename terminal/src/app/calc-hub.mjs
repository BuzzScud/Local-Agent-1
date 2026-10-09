// The hub's Calculator tab (8 Oct 2026, the owner: "add it to the agentic coder commands, under the hub (/help)
// command, so we can use it here in the hub"): the calculator link (web/calc-link.mjs) live, where it runs
// (inside the web, or its own background service: "turned on and off here"), the login it signs in with, and the
// reports it filed. It reads the link through its socket; with nothing running it, what the link last saved.
//   GET  /calc.json                          the link's status (or its saved reports and events), where it runs, the login (no password)
//   POST /calc/where     { where }           'web' | 'service' (the LaunchAgent on or off)
//   POST /calc/login     { url, user, pass } saved to the web settings (0600); the link starts over with it
//   POST /calc/reconnect · /calc/signin      Reconnect now · Sign in again
import { loadSettings, saveSettings } from '../web/config.mjs';
import { askLink, linkWhere, savedState } from '../web/calc-link.mjs';
import { setWhere, serviceState, launchctl, programNow } from '../web/calc-cmd.mjs';

const noStore = { 'cache-control': 'no-store' };
const json = (body, status = 200) => Response.json(body, { status, headers: noStore });
const bad = (error, status = 400) => json({ error }, status);
// A page of this hub only (another site in the browser cannot post here).
const fromHere = (req, url) => { const o = req.headers.get('origin'); return !o || o === url.origin; };

export function calcHub({ run = launchctl, program = programNow } = {}) {
  async function view() {
    const calc = loadSettings().calc;
    const link = await askLink('/status');
    return {
      where: linkWhere(calc), service: serviceState({ run }),
      login: { url: calc.url, user: calc.user, hasPass: Boolean(calc.pass) },
      link, saved: link ? null : savedState(),
    };
  }
  async function route(req, url) {
    if (url.pathname === '/calc.json' && req.method === 'GET') return json(await view());
    if (req.method !== 'POST' || !url.pathname.startsWith('/calc/')) return null;
    if (!fromHere(req, url)) return bad('not from this hub', 403);
    let body;
    try { body = (await req.json()) ?? {}; } catch { body = {}; }
    if (url.pathname === '/calc/where') {
      const r = setWhere(body.where, { run, program: typeof program === 'function' ? program() : program });
      if (!r.ok) return bad(r.error, 409);
      return json(await view());
    }
    if (url.pathname === '/calc/login') {
      const calc = loadSettings().calc;
      const next = { ...calc };
      if (body.url !== undefined) {
        const u = String(body.url ?? '').trim();
        if (u && !/^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(u)) return bad('the calculator is an address like http://host:port');
        next.url = u ? u.replace(/\/+$/, '') : null;
      }
      if (body.user !== undefined) next.user = String(body.user ?? '').trim() || null;
      if (body.pass) next.pass = String(body.pass);
      saveSettings({ calc: next });
      await askLink('/reload', { method: 'POST' });
      return json(await view());
    }
    if (url.pathname === '/calc/reconnect' || url.pathname === '/calc/signin') {
      const st = await askLink(`/${url.pathname.slice(6)}`, { method: 'POST' });
      if (!st) return bad('the calculator link is not running: save a login, and run it inside the web or as its own service', 409);
      return json(await view());
    }
    return bad('no such action', 404);
  }
  return { route };
}
