// The hub's Memory tab: what Agentic Coder remembers, read live from the two
// memory folders (src/agent/facts.mjs), and the few changes you can make
// there by hand. Every change goes through the store, so it is in the log
// and can be undone.
//   GET  /memory.json       both memories: facts, retired facts, the last changes
//   POST /memory/edit       { where, id, text }
//   POST /memory/pin        { where, id, pinned }
//   POST /memory/retire     { where, id }
//   POST /memory/restore    { where, id }
//   POST /memory/undo       takes back the last save
import { homedir } from 'node:os';
import { memoryDirs, readFacts, readLog, editFact, pinFact, applyChanges, restoreFact, undoSave, RETIRE_AT, UNUSED_DAYS } from '../agent/facts.mjs';

const tilde = (p) => (p && p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);
const plain = ({ dir: _d, ...f }) => f;

function memoryData(cwd) {
  const dirs = memoryDirs(cwd);
  const part = (where, dir) => ({ where, dir: tilde(dir), facts: dir ? readFacts(dir).map(plain) : [], retired: dir ? readFacts(dir, { retired: true }).map(plain) : [] });
  const parts = [part('you', dirs.you), ...(dirs.project ? [part('project', dirs.project)] : [])];
  const log = [dirs.you, dirs.project].filter(Boolean).flatMap((d) => readLog(d).map((l) => ({ ...l, where: d === dirs.you ? 'you' : 'project' }))).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);
  return { cwd: tilde(cwd), parts, log, retireAt: RETIRE_AT, unusedDays: UNUSED_DAYS, at: new Date().toISOString() };
}

// Only this page may change the memory: a request from another site that a
// browser tab sends to this address carries that site as its origin.
const fromHere = (req, url) => { const o = req.headers.get('origin'); return !o || o === url.origin; };

export async function memoryRoute(req, url, cwd) {
  if (url.pathname === '/memory.json' && req.method === 'GET') return Response.json(memoryData(cwd), { headers: { 'cache-control': 'no-store' } });
  if (!url.pathname.startsWith('/memory/')) return null;
  const bad = (m, code = 400) => Response.json({ error: m }, { status: code, headers: { 'cache-control': 'no-store' } });
  if (req.method !== 'POST') return bad('not found', 404);
  if (!fromHere(req, url)) return bad('only the hub page may change the memory', 403);
  let body = {};
  try { body = await req.json(); } catch { if (url.pathname !== '/memory/undo') return bad('the request body is not JSON'); }
  const dirs = memoryDirs(cwd);
  const dir = body.where === 'you' ? dirs.you : body.where === 'project' ? dirs.project : null;
  const ok = (extra = {}) => Response.json({ ok: true, ...extra, data: memoryData(cwd) }, { headers: { 'cache-control': 'no-store' } });
  if (url.pathname === '/memory/undo') { const u = undoSave(dirs); return u ? ok({ undone: u.did.length }) : bad('nothing to take back', 404); }
  if (!dir || typeof body.id !== 'string' || !/^[\w.-]+$/.test(body.id)) return bad('which fact?');
  if (url.pathname === '/memory/edit') { const r = editFact(dir, body.id, body.text); return r.error ? bad(r.error) : ok(); }
  if (url.pathname === '/memory/pin') return pinFact(dir, body.id, body.pinned !== false) ? ok() : bad('no such fact', 404);
  if (url.pathname === '/memory/retire') { const r = applyChanges(dir, { retire: [{ id: body.id, reason: 'taken out of use by you' }] }, { why: 'by hand' }); return r.retired.length ? ok() : bad('no such fact', 404); }
  if (url.pathname === '/memory/restore') return restoreFact(dir, body.id) ? ok() : bad('no such fact', 404);
  return bad('not found', 404);
}
