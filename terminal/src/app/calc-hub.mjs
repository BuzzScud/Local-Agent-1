// The hub's Calculator tab (8 Oct 2026, the owner: "add it to the agentic coder commands, under the hub (/help)
// command, so we can use it here in the hub"): the calculator link (web/calc-link.mjs) live, where it runs
// (inside the web, or its own background service: "turned on and off here"), the login it signs in with, and the
// reports it filed. It reads the link through its socket; with nothing running it, what the link last saved.
// 9 Oct 2026 (the owner's picks, "2 · Chain"): the log told as a story and the last 24 hours as stretches
// (web/calc-story.mjs), this Mac's start (a restart is why a link inside the web stops), and a short status for the
// hub's top bar. A first login saved on a Mac, with no place picked yet, starts the link as its own background
// service ("Its own background service": always on, it starts with the Mac).
//   GET  /calc.json                          the link's status (or its saved reports and events), where it runs, the login (no password)
//   GET  /calc/brief.json                    a few words for the hub's top bar: set up or not, live or not
//   POST /calc/where     { where }           'web' | 'service' (the LaunchAgent on or off)
//   POST /calc/login     { url, user, pass } saved to the web settings (0600); the link starts over with it
//   POST /calc/reconnect · /calc/signin      Reconnect now · Sign in again
import { spawnSync } from 'node:child_process';
import { loadSettings, saveSettings } from '../web/config.mjs';
import { askLink, linkWhere, savedState } from '../web/calc-link.mjs';
import { storyOf, dayOf } from '../web/calc-story.mjs';
import { setWhere, serviceState, launchctl, programNow } from '../web/calc-cmd.mjs';

const noStore = { 'cache-control': 'no-store' };
const json = (body, status = 200) => Response.json(body, { status, headers: noStore });
const bad = (error, status = 400) => json({ error }, status);
// A page of this hub only (another site in the browser cannot post here).
const fromHere = (req, url) => { const o = req.headers.get('origin'); return !o || o === url.origin; };
// When this Mac started (macOS: kern.boottime), read once: it does not change while the hub runs.
export function bootTime({ run = (a) => spawnSync('sysctl', a, { encoding: 'utf8' }) } = {}) {
  if (process.platform !== 'darwin') return null;
  const sec = /sec = (\d+)/.exec(run(['-n', 'kern.boottime']).stdout ?? '')?.[1];
  return sec ? Number(sec) * 1000 : null;
}
const toneOf = (st) => (st === 'live' ? 'ok' : ['waiting', 'connecting', 'signing-in'].includes(st) ? 'warn' : 'bad');

export function calcHub({ run = launchctl, program = programNow, boot = bootTime, now = () => Date.now() } = {}) {
  let bootAt;
  const booted = () => (bootAt === undefined ? (bootAt = boot()) : bootAt);
  async function view() {
    const calc = loadSettings().calc;
    const link = await askLink('/status');
    const saved = link ? null : savedState(undefined, now());
    const s = link ?? saved;
    const t = now();
    const events = [...(s.events ?? [])].reverse();
    return {
      where: linkWhere(calc), service: serviceState({ run }),
      login: { url: calc.url, user: calc.user, hasPass: Boolean(calc.pass) },
      link, saved, now: t, bootAt: booted(),
      story: storyOf(events, { now: t, bootAt: booted() }),
      day: dayOf(events, { now: t, bootAt: booted(), aliveAt: s.aliveAt ?? null, running: Boolean(link) }),
    };
  }
  async function brief() {
    const calc = loadSettings().calc;
    const link = await askLink('/status');
    const set = Boolean(calc.url && calc.user && calc.pass);
    if (!link) return { set, running: false, tone: 'bad', words: set ? 'not running' : 'no login saved' };
    return { set, running: true, state: link.state, tone: toneOf(link.state), words: link.state === 'live' ? 'live' : link.state === 'login-wrong' ? 'signed out (wrong password)' : link.words.toLowerCase() };
  }
  async function route(req, url) {
    if (url.pathname === '/calc.json' && req.method === 'GET') return json(await view());
    if (url.pathname === '/calc/brief.json' && req.method === 'GET') return json(await brief());
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
      // The first login on a Mac, no place picked yet: its own background service, so it runs whatever runs the web.
      if (!calc.link && next.url && next.user && next.pass && process.platform === 'darwin') {
        setWhere('service', { run, program: typeof program === 'function' ? program() : program });
      }
      await askLink('/reload', { method: 'POST' });
      return json(await view());
    }
    if (url.pathname === '/calc/reconnect' || url.pathname === '/calc/signin') {
      const st = await askLink(`/${url.pathname.slice(6)}`, { method: 'POST' });
      if (!st) return bad('the calculator link is not running: start it as its own background service', 409);
      return json(await view());
    }
    return bad('no such action', 404);
  }
  return { route };
}
