// The hub's Test builder (a window over the Arena tab, a tab of its own until 30 Sep 2026): making tests of your own, in full (models/evals/battle/builder.mjs).
// A test made here is one of the Battle arena's "My tests", with a level (Easy, Medium, Hard), kept
// on this Mac only in ~/.agentic-coder/battle/tests/. The files are read and written here directly,
// so the tab works whether or not the arena's runner is up.
//   GET  /builder.json        your tests, the trash, the levels, the kinds, the checks
//   POST /builder/suggest     { prompt, kind } → the checks that fit those words
//   POST /builder/read        { text } → the prompts a pasted list holds (nothing is saved)
//   POST /builder/paste       { text } → each prompt saved as a test, not sorted yet
//   POST /builder/save        a new test or an edit (it needs a level and a check)
//   POST /builder/level       { id, level } → the quick E / M / H
//   POST /builder/duplicate   { id }        POST /builder/delete { id } (to the trash)
//   POST /builder/restore     { name } (from the trash)
//   GET  /builder/export      every test in one file    POST /builder/import { data }
//   POST /builder/try         { id, checks, prompt, page? } → the page checks on a page, no model
// Only this hub's own page may call them (no other site, no rebinding), like the Tests tab's runs.
import { builderData, suggestFor, readList, saveOwn, pasteTests, setLevel, duplicateOwn, deleteOwn, restoreOwn, exportOwn, importOwn, tryChecks } from '../../../models/index.mjs';
import { layoutCheck } from '../flows/layoutcheck.mjs';

const noStore = { 'cache-control': 'no-store' };
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...noStore, ...extra } });

// home: the arena's folder (a test passes its own); check: the layout check (a test passes a stand-in).
export async function builderRoute(req, url, { home, check = layoutCheck } = {}) {
  const o = req.headers.get('origin');
  if (url.hostname !== '127.0.0.1' || (o && o !== url.origin) || ['cross-site', 'same-site'].includes(req.headers.get('sec-fetch-site'))) return json({ error: 'Open the Test builder from this local hub.' }, 403);
  const data = () => builderData(home);
  if (req.method === 'GET') {
    if (url.pathname === '/builder.json') return json(data());
    if (url.pathname === '/builder/export') return json(exportOwn(home), 200, { 'content-disposition': 'attachment; filename="my-tests.json"' });
    return json({ error: 'not found' }, 404);
  }
  if (req.method !== 'POST') return json({ error: 'not found' }, 404);
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')) return json({ error: 'Send JSON.' }, 415);
  let body = {};
  try { body = (await req.json()) ?? {}; } catch { return json({ error: 'The request body is not JSON.' }, 400); }
  try {
    switch (url.pathname) {
      case '/builder/suggest': return json(suggestFor(String(body.prompt ?? ''), body.kind));
      case '/builder/read': return json({ found: readList(String(body.text ?? '')) });
      case '/builder/paste': { const r = pasteTests(String(body.text ?? ''), home); return json({ ok: true, ...r, data: data() }); }
      case '/builder/save': { const meta = saveOwn(body, home); return json({ ok: true, id: meta.id, n: meta.n ?? null, data: data() }); }
      case '/builder/level': { const meta = setLevel(String(body.id ?? ''), body.level, home); return json({ ok: true, id: meta.id, data: data() }); }
      case '/builder/duplicate': { const meta = duplicateOwn(String(body.id ?? ''), home); return json({ ok: true, id: meta.id, data: data() }); }
      case '/builder/delete': { deleteOwn(String(body.id ?? ''), home); return json({ ok: true, data: data() }); }
      case '/builder/restore': { const id = restoreOwn(String(body.name ?? ''), home); return json({ ok: true, id, data: data() }); }
      case '/builder/import': { const r = importOwn(body.data, home); return json({ ok: true, ...r, data: data() }); }
      case '/builder/try': return json(await tryChecks({ id: body.id ?? null, checks: body.checks, prompt: String(body.prompt ?? ''), page: body.page ?? null }, { layoutCheck: check }, home));
      default: return json({ error: 'not found' }, 404);
    }
  } catch (e) { return json({ error: e.message }, 400); }
}
