// Which server and model each request goes to, by profile (profiles.mjs; 8 Oct 2026, the owner's
// pick of the full build). The file is read again whenever it changed, at each request, so a change
// made in /profiles, /model, the hub or another window reaches the next request of every window.
// Nothing here runs until a profiles.json exists: before that the window works as it always did.
//   route(q, now)   the conversation's (or a helper agent's) profile for this step: { same } when it is
//                   what runs now, else what to move to ({ url, model, ctx, … }, connected)
//   helper(ai, now) a helper's call (/btw, a summary, a picture, the second opinion…): the `use` that
//                   client.mjs sends to its profile's server and model, or undefined for the conversation's
//   callFor(name)   the extras of one request: its meter's name and its backup (spill), or the backup
//                   itself while the profile cools down after a spill
// Every server is connected once (the window's own is lent to it) and kept until the window closes.
import { statSync } from 'node:fs';
import { connectRemote, ollamaCatalog } from '../../../models/index.mjs';
import { readProfiles, profilesSaved, profileFor, PROFILES_FILE, MAIN_PROFILE } from './profiles.mjs';
import { HELPER_CTX, HELPER_KEEP } from '../agent/helper-models.mjs';

// After a spill the profile's requests go straight to its backup for COOL_MS, then it is tried again.
export { COOL_MS } from '../agent/profile-spill.mjs';
import { COOL_MS } from '../agent/profile-spill.mjs';
// A helper's context on the service when its job has none of its own (HELPER_CTX).
const HELPER_ROOM = 32_768;
export const serverKey = (s) => (s ? `${s.kind}|${String(s.address ?? '').trim()}|${s.port ?? ''}|${s.connect ?? 'http'}` : '');

export class ProfileRouter {
  // settings(): the window's settings (its saved services, for each one's own fields); jobs(): the
  // /subagents jobs today's profiles are made from when there is no file yet; withLimits(model): the
  // model as the window's limits shape it; connect / catalogOf: the tests' stand-ins.
  constructor({ settings, jobs = () => null, withLimits = (m) => m, connect = connectRemote, catalogOf = ollamaCatalog, now = Date.now } = {}) {
    Object.assign(this, { settings, jobs, withLimits, connect, catalogOf, now });
    this.pool = new Map(); // server key → { url, conn, catalog, owned }
    this.cooling = new Map(); // profile → until (ms)
    this.mtime = -1;
    this.cache = null;
    this.waiting = new Map(); // server key → a connect under way
  }

  // Whether profiles decide anything here: a remote in use and a profiles.json saved.
  active() { return Boolean(this.settings()?.remote?.use) && profilesSaved(); }
  // The profiles as the file has them now (read again only when it changed).
  data() {
    let m = 0;
    try { m = statSync(PROFILES_FILE()).mtimeMs; } catch { m = 0; }
    if (m !== this.mtime || !this.cache) { this.mtime = m; this.cache = readProfiles(this.settings(), this.jobs()); }
    return this.cache;
  }
  // The file's time: the window looks at it to follow a change made elsewhere while it is idle.
  stamp() { try { return statSync(PROFILES_FILE()).mtimeMs; } catch { return 0; } }

  // ---- servers ----------------------------------------------------------------------------------

  // The window's own connection: its server is reached through it (no second connection, no second tunnel).
  // A connection the window lent before, to another server, is gone with the window's move (it closes it).
  lend(server, conn) {
    if (!server || !conn) return;
    for (const [k, e] of this.pool) if (!e.owned && k !== serverKey(server)) this.pool.delete(k);
    this.pool.set(serverKey(server), { url: conn.url, conn, catalog: this.pool.get(serverKey(server))?.catalog ?? null, owned: false });
  }
  // A server's full set-up, as connectRemote takes it: what /remote saved for it, then the profile's.
  setupOf(server, model) {
    const saved = Object.values(this.settings()?.remotes ?? {}).find((r) => serverKey(r) === serverKey(server)) ?? {};
    return { ...saved, ...server, model, context: saved.context ?? 0 };
  }
  urlNow(server) {
    const have = this.pool.get(serverKey(server));
    if (have) return have.url;
    this.reach(server).catch(() => {});
    return null;
  }
  // Connected once; a profile's first request waits for it.
  async reach(server, model = null) {
    const k = serverKey(server);
    const have = this.pool.get(k);
    if (have) return have;
    if (!this.waiting.has(k)) {
      this.waiting.set(k, (async () => {
        try {
          const conn = await this.connect(this.setupOf(server, model ?? ''), { serviceSize: true });
          const entry = { url: conn.url, conn, catalog: null, owned: true };
          this.pool.set(k, entry);
          if (conn.info?.ollama) this.catalogOf({ url: conn.url }).then((c) => { entry.catalog = c?.models ?? null; }).catch(() => {});
          return entry;
        } finally { this.waiting.delete(k); }
      })());
    }
    return this.waiting.get(k);
  }
  // What the service says about one of its models (thinking, tools, its context), when it is known.
  entryOf(server, model) { return this.pool.get(serverKey(server))?.catalog?.find((m) => m.id === model) ?? null; }
  setCatalog(server, models) { const e = this.pool.get(serverKey(server)); if (e) e.catalog = models; }

  // ---- the conversation ------------------------------------------------------------------------

  // q: { ai, type, skill }; now: { url, model } of the conversation as it runs. { name, same: true }
  // when the profile is what runs now; else { name, url, model, ctx, conn, vision, server } to move to.
  async route(q, now) {
    const d = this.data();
    const { name } = profileFor(q, d);
    const p = name ? d.profiles[name] : null;
    if (!p?.server || !p.model) return null;
    const have = this.pool.get(serverKey(p.server));
    if (have && have.url === now.url && p.model === now.model) return { name, same: true };
    // Its own connection for this model: the server's address then names it (the conversation's
    // own calls name no model; every helper's call names its own).
    const conn = await this.connect(this.setupOf(p.server, p.model), { serviceSize: true });
    const old = this.pool.get(serverKey(p.server));
    if (old?.owned && old.url !== conn.url) old.conn?.stop?.();
    this.pool.set(serverKey(p.server), { url: conn.url, conn, catalog: old?.catalog ?? null, owned: true });
    return { name, same: false, url: conn.url, conn, model: this.withLimits(conn.model), ctx: conn.ctx, vision: Boolean(conn.vision), server: p.server };
  }

  // ---- helpers ---------------------------------------------------------------------------------

  // The call of a helper (ai: 'btw', 'side', 'pictures', 'search', 'review', 'designWrite',
  // 'designCheck', 'agents'), or undefined when its profile is the conversation's own model.
  helper(ai, now) {
    const d = this.data();
    const { name } = profileFor({ ai }, d);
    const p = name ? d.profiles[name] : null;
    if (!p?.server || !p.model) return undefined;
    const url = this.urlNow(p.server);
    if (!url) return undefined; // its server is being reached: this once, the conversation's model
    const x = this.extras(name);
    if (x.cooled) return x.cooled;
    if (url === now.url && p.model === now.model) return undefined;
    return { ...this.callOf(p, url, ai), profile: name, ...x };
  }
  // What client.mjs lays over the server's endpoint for this model: its name, and on an Ollama service
  // what it can do and the room it is loaded at.
  callOf(p, url, ai = null) {
    const e = this.entryOf(p.server, p.model);
    const svc = this.pool.get(serverKey(p.server))?.conn?.info?.ollama;
    return { url, model: p.model, ...(svc ? { numCtx: HELPER_CTX[ai] ?? (ai ? HELPER_ROOM : undefined), thinks: Boolean(e?.thinking), tools: e?.tools !== false, family: e?.family ?? '', keepAlive: HELPER_KEEP } : {}) };
  }

  // ---- spills ----------------------------------------------------------------------------------

  // A request's extras for profile `name`: { spill } while its server is tried, or, cooling down
  // after a spill, the backup's call itself ({ url, model, … , profile: backup }).
  extras(name) {
    const d = this.data();
    const p = d.profiles[name];
    const b = p?.backup && d.profiles[p.backup] ? d.profiles[p.backup] : null;
    if (!b) return {};
    if ((this.cooling.get(name) ?? 0) > this.now()) {
      const url = this.urlNow(b.server);
      return url ? { cooled: { ...this.callOf(b, url), profile: p.backup } } : {};
    }
    return { spill: { name, after: p.spillAfter ?? 0, to: (why) => this.spillTo(name, why) } };
  }
  // The conversation's step for profile `name`: its meter's name and its spill or its cooled backup.
  callFor(name) { return name && this.active() ? { profile: name, ...this.extras(name) } : {}; }
  async spillTo(name, why) {
    const d = this.data();
    const p = d.profiles[name];
    const b = p?.backup ? d.profiles[p.backup] : null;
    if (!b?.server) return null;
    this.cooling.set(name, this.now() + COOL_MS);
    try {
      const { url } = await this.reach(b.server, b.model);
      return { name: p.backup, url, use: { ...this.callOf(b, url), profile: p.backup }, why };
    } catch { return null; }
  }
  coolingLeft(name) { return Math.max(0, (this.cooling.get(name) ?? 0) - this.now()); }

  // The main profile's name, for the footer and the notes.
  mainName() { const d = this.data(); return profileFor({ ai: 'main' }, d).name ?? MAIN_PROFILE; }

  // Every connection the router opened itself (the window's own is the window's to close).
  stop() { for (const e of this.pool.values()) if (e.owned) e.conn?.stop?.(); this.pool.clear(); }
}
