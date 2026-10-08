// The hub's Profiles tab (8 Oct 2026, the owner's pick of the full build): the same profiles as /profiles,
// read from and saved to the same file, so a change here reaches every window's next request.
// The hub runs apart from the windows, so it never makes the first profiles: those come from a window's
// /subagents helpers (profiles.mjs seedProfiles); until a window has saved them the tab only says so.
//   GET  /profiles.json                          the profiles, who uses which, the groups, today's meters
//   POST /profiles/use     { key, profile|null } a row's profile (null: none of its own)
//   POST /profiles/set     { name, model?, backup?, spillAfter? }   a profile's model or its backup
// A model is picked from the list the Remote tab reads for that server (/remote.json?service=<its source>).
import { readFileSync } from 'node:fs';
import { loadSettings } from './store.mjs';
import { PROFILES_FILE, profilesSaved, groupsNow, rowsOf, inheritedOf, writeProfiles, SPILL_STEPS, serverWord } from './profiles.mjs';
import { readMeters } from '../agent/profile-meters.mjs';

const noStore = { 'cache-control': 'no-store' };
const json = (body, status = 200) => Response.json(body, { status, headers: noStore });
const bad = (error, status = 400) => json({ error }, status);
// A page of this hub only (another site in the browser cannot post here).
const fromHere = (req, url) => { const o = req.headers.get('origin'); return !o || o === url.origin; };

export function profilesHub({ cwd = process.cwd() } = {}) {
  const read = () => { try { const d = JSON.parse(readFileSync(PROFILES_FILE(), 'utf8')); return { profiles: d.profiles ?? {}, uses: d.uses ?? {} }; } catch { return null; } };
  const view = () => {
    const d = read();
    const s = loadSettings(cwd);
    if (!d || !profilesSaved()) return { saved: false, remote: Boolean(s.remote?.use) };
    const groups = groupsNow();
    const rows = rowsOf(groups).map((r) => ({ key: r.key, group: r.group, label: r.label, note: r.note, own: d.uses[r.key] ?? null, uses: d.uses[r.key] ?? inheritedOf(r, d).name }));
    const profiles = Object.entries(d.profiles).map(([name, p]) => ({ name, model: p.model, server: serverWord(p.server), source: p.server?.source ?? (p.server?.kind === 'claude' ? 'claude' : 'openai'), backup: p.backup ?? null, spillAfter: p.spillAfter ?? 0 }));
    return { saved: true, profiles, groups: groups.map((g) => ({ id: g.id, label: g.label, note: g.note })), rows, meters: readMeters(), spills: SPILL_STEPS };
  };
  async function route(req, url) {
    if (url.pathname === '/profiles.json' && req.method === 'GET') return json(view());
    if (req.method !== 'POST' || !url.pathname.startsWith('/profiles/')) return null;
    if (!fromHere(req, url)) return bad('not from this hub', 403);
    let body;
    try { body = (await req.json()) ?? {}; } catch { return bad('the request body is not JSON'); }
    const d = read();
    if (!d) return bad('no profiles saved yet: open /profiles in a window first', 409);
    if (url.pathname === '/profiles/use') {
      const key = String(body.key ?? '');
      if (!rowsOf(groupsNow()).some((r) => r.key === key)) return bad('no such row');
      if (body.profile == null) delete d.uses[key];
      else if (d.profiles[body.profile]) d.uses[key] = body.profile;
      else return bad('no such profile');
      writeProfiles(d);
      return json(view());
    }
    if (url.pathname === '/profiles/set') {
      const p = d.profiles[body.name];
      if (!p) return bad('no such profile');
      if (typeof body.model === 'string' && body.model.trim()) p.model = body.model.trim().slice(0, 200);
      if ('backup' in body) { if (body.backup == null || body.backup === '') p.backup = null; else if (d.profiles[body.backup] && body.backup !== body.name) p.backup = body.backup; else return bad('no such profile for a backup'); }
      if ('spillAfter' in body) { const n = Number(body.spillAfter); if (!SPILL_STEPS.includes(n)) return bad('not one of the waits'); p.spillAfter = n; }
      writeProfiles(d);
      return json(view());
    }
    return bad('no such action', 404);
  }
  return { route };
}
