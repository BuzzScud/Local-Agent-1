// The Test builder (the hub's Test builder tab): making tests of your own, in full, on top of the
// arena's store. A test made here is a Battle test of the set "My tests" (store.mjs), with a level
// (Easy, Medium, Hard), so the Arena runs it, in a battle or on one model.
//   builderData()      everything the tab shows: your tests, the trash, the levels, the kinds, the checks
//   saveOwn(body)      the editor's Save: a new test or an edit of one (it needs a level and a check)
//   pasteTests(text)   a pasted list → one test each, not sorted yet, with Easy's starting checks
//   setLevel(id, lv)   the quick E / M / H: the level, and its starting checks while the test's checks are
//                      still a level's starting checks (once you ticked by hand, they stay yours)
//   duplicateOwn(id)   a copy, with its files
//   listTrash(), restoreOwn(name)   a deleted test comes back
//   exportOwn(), importOwn(data)    every test in one file, and back in (one already here is skipped)
//   tryChecks(...)     a test's page checks on a page, with no model: a page you hand it, else the
//                      last page a run of the test made (keepPage, called by run-one.mjs)
// Nothing here is in git: the tests live in ~/.agentic-coder/battle/ on this Mac only.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, cpSync, rmSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { battleHome, paths, readJson, writeJson, listTests, saveTest, trashTest, inside, slug, KINDS, LEVELS, LIMIT_SECS, MAX_MINUTES, limitSecsOf, pointsOf } from './store.mjs';
import { CHECKS, labelOf, runChecksWith } from './checks.mjs';
import { parsePrompts, kindOf, suggestChecks, startChecks } from './suggest.mjs';

// The checks that read a page: the ones Try the checks can run with no model.
export const PAGE_CHECKS = ['page-made', 'scripts-valid', 'offline', 'page-has', 'count', 'drawn', 'layout'];
const mine = (home) => listTests(home).filter((t) => t.suite === 'mine');
const cleanChecks = (list) => (Array.isArray(list) ? list : []).filter((c) => c && CHECKS[c.type]).map((c) => ({ type: String(c.type), value: String(c.value ?? '').trim() }));
const sameChecks = (a, b) => JSON.stringify(cleanChecks(a).map((c) => `${c.type}:${c.value}`).sort()) === JSON.stringify(cleanChecks(b).map((c) => `${c.type}:${c.value}`).sort());
// Its checks are exactly its level's starting checks (no level yet: Easy's): they follow the level.
const followsLevel = (t) => sameChecks(t.checks, startChecks(t.prompt, t.kind, LEVELS[t.level] ? t.level : null));

// One test as the tab shows it.
function row(t, home) {
  const page = lastPage(t.id, home);
  return {
    id: t.id, n: t.n ?? null, title: t.title, kind: t.kind, level: LEVELS[t.level] ? t.level : null, minutes: t.minutes ?? null, limit: Math.round(limitSecsOf(t) / 60),
    points: pointsOf(t), design: Boolean(t.design), auto: followsLevel(t), prompt: t.prompt, checks: cleanChecks(t.checks), ask: t.answers?.[0]?.reply ?? '',
    files: t.files ?? [], created: t.created ?? null, edited: t.edited ?? null, page: page ? { name: page.name, at: page.at, model: page.model } : null,
    suggest: suggestChecks(t.prompt, t.kind),
  };
}

export function builderData(home = battleHome()) {
  const tests = mine(home).map((t) => row(t, home));
  return {
    tests, trash: listTrash(home), levels: LEVELS, kinds: KINDS, maxMinutes: MAX_MINUTES, battleMinutes: LIMIT_SECS / 60, pageChecks: PAGE_CHECKS,
    checks: Object.fromEntries(Object.entries(CHECKS).map(([k, v]) => [k, { label: v.label, value: v.value }])),
    points: { of: tests.reduce((s, t) => s + t.points, 0) }, at: new Date().toISOString(),
  };
}

// What the tab asks while you type: the checks that fit these words.
export const suggestFor = (prompt, kind) => suggestChecks(prompt, KINDS[kind] ? kind : kindOf(prompt));
// A pasted list as the tab previews it, before anything is saved.
export const readList = (text) => parsePrompts(text).map((p) => { const kind = kindOf(p.prompt); const s = suggestChecks(p.prompt, kind); return { n: p.n, title: p.title, prompt: p.prompt, kind, fit: s.checks.length, eye: s.eye.length }; });

// The editor's Save. A test made here needs a level (its points and its time), and a check.
export function saveOwn(body, home = battleHome()) {
  const b = body ?? {};
  if (!LEVELS[b.level]) throw new Error('pick a level first (Easy, Medium or Hard)');
  const checks = cleanChecks(b.checks);
  if (!checks.length) throw new Error('tick at least one check, so a run of it can pass or fail');
  if (b.id != null && !mine(home).some((t) => t.id === b.id)) throw new Error('no such test of yours');
  const kind = KINDS[b.kind] ? b.kind : kindOf(b.prompt);
  return saveTest({
    id: b.id ?? null, title: b.title, kind, prompt: b.prompt, checks, ask: b.ask ?? '', files: Array.isArray(b.files) ? b.files : [], removePaths: Array.isArray(b.removePaths) ? b.removePaths : [],
    suite: 'mine', level: b.level, minutes: b.minutes == null || Number(b.minutes) === LEVELS[b.level].minutes ? null : Number(b.minutes), design: kind === 'page' ? b.design !== false : false,
  }, home);
}

// A pasted list: each prompt becomes a test, not sorted yet (you set its level next). One whose
// words are already a test of yours is skipped, so pasting the same list twice adds nothing.
export function pasteTests(text, home = battleHome()) {
  const have = new Set(mine(home).map((t) => t.prompt.trim()));
  const added = []; let skipped = 0;
  for (const p of parsePrompts(text)) {
    if (have.has(p.prompt.trim())) { skipped += 1; continue; }
    const kind = kindOf(p.prompt);
    added.push(saveTest({ title: p.title, kind, prompt: p.prompt, checks: startChecks(p.prompt, kind, null), suite: 'mine', level: null, design: kind === 'page' }, home));
    have.add(p.prompt.trim());
  }
  return { added: added.map((m) => m.id), skipped };
}

// The quick level (E, M, H on a row). While the test's checks are still a level's starting checks
// they follow the new level; once you ticked by hand they stay yours.
export function setLevel(id, level, home = battleHome()) {
  if (!LEVELS[level]) throw new Error(`no level ${level} (easy, medium or hard)`);
  const t = mine(home).find((x) => x.id === id);
  if (!t) throw new Error('no such test of yours');
  const checks = followsLevel(t) ? startChecks(t.prompt, t.kind, level) : cleanChecks(t.checks);
  return saveTest({ id, title: t.title, kind: t.kind, prompt: t.prompt, checks: checks.length ? checks : cleanChecks(t.checks), ask: t.answers?.[0]?.reply ?? '', level }, home);
}

export function duplicateOwn(id, home = battleHome()) {
  const P = paths(home);
  const t = mine(home).find((x) => x.id === id);
  if (!t) throw new Error('no such test of yours');
  const meta = saveTest({ title: `${t.title} (copy)`, kind: t.kind, prompt: t.prompt, checks: cleanChecks(t.checks), ask: t.answers?.[0]?.reply ?? '', suite: 'mine', level: t.level ?? null, minutes: t.minutes ?? null, design: Boolean(t.design) }, home);
  const from = join(P.tests, id, 'project');
  if (existsSync(from)) cpSync(from, join(P.tests, meta.id, 'project'), { recursive: true });
  return meta;
}

export const deleteOwn = (id, home = battleHome()) => { if (!mine(home).some((t) => t.id === id)) throw new Error('no such test of yours'); trashTest(id, home); };

// The tests of yours in the trash, newest first: [{ name (its folder there), id, title, level, kind, at }].
export function listTrash(home = battleHome()) {
  const P = paths(home);
  let names = [];
  try { names = readdirSync(P.trash); } catch { return []; }
  const out = [];
  for (const name of names) {
    const meta = readJson(join(P.trash, name, 'meta.json'));
    if (!meta || meta.suite !== 'mine') continue;
    const at = Number(/-(\d{10,})$/.exec(name)?.[1] ?? 0);
    out.push({ name, id: meta.id, title: meta.title, level: LEVELS[meta.level] ? meta.level : null, kind: meta.kind, at: at ? new Date(at).toISOString() : null });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
export function restoreOwn(name, home = battleHome()) {
  const P = paths(home);
  const dir = inside(P.trash, name);
  const meta = dir ? readJson(join(dir, 'meta.json')) : null;
  if (!meta || meta.suite !== 'mine' || dir === P.trash) throw new Error('no such test in the trash');
  let id = meta.id;
  // Its place was taken since (a test restored twice, say): it comes back beside it.
  if (existsSync(join(P.tests, id))) { id = `${id}-r${Date.now().toString(36).slice(-3)}`; writeJson(join(dir, 'meta.json'), { ...meta, id }); }
  mkdirSync(P.tests, { recursive: true });
  renameSync(dir, join(P.tests, id));
  return id;
}

// Every test of yours in one file: what a test is (its words, level, checks, files), not its results.
export function exportOwn(home = battleHome()) {
  const P = paths(home);
  return {
    app: 'agentic-coder', what: 'my-tests', version: 1, exported: new Date().toISOString(),
    tests: mine(home).map((t) => ({
      title: t.title, level: LEVELS[t.level] ? t.level : null, kind: t.kind, prompt: t.prompt, minutes: t.minutes ?? null, design: Boolean(t.design), checks: cleanChecks(t.checks), ask: t.answers?.[0]?.reply ?? '',
      files: (t.files ?? []).map((f) => ({ path: f, b64: readFileSync(join(P.tests, t.id, 'project', f)).toString('base64') })),
    })),
  };
}
export function importOwn(data, home = battleHome()) {
  if (data?.what !== 'my-tests' || !Array.isArray(data.tests)) throw new Error('that is not a file the Test builder exported');
  // One already here (the same name, level and words) is skipped; a copy of a test at another level is not.
  const same = (t) => `${String(t.title ?? '').trim()}\n${LEVELS[t.level] ? t.level : ''}\n${String(t.prompt ?? '').trim()}`;
  const have = new Set(mine(home).map(same));
  const added = []; let skipped = 0;
  for (const t of data.tests.slice(0, 500)) {
    const prompt = String(t?.prompt ?? '').trim();
    if (!prompt || have.has(same(t))) { skipped += 1; continue; }
    const kind = KINDS[t.kind] ? t.kind : kindOf(prompt);
    const level = LEVELS[t.level] ? t.level : null;
    let checks = cleanChecks(t.checks);
    if (!checks.length) checks = startChecks(prompt, kind, level);
    added.push(saveTest({ title: t.title, kind, prompt, checks, ask: t.ask ?? '', files: Array.isArray(t.files) ? t.files : [], suite: 'mine', level, minutes: t.minutes ?? null, design: Boolean(t.design) }, home));
    have.add(same(t));
  }
  return { added: added.map((m) => m.id), skipped };
}

// The last page a model made for a test, kept so its checks can be tried again with no model.
export function keepPage(testId, modelId, file, home = battleHome()) {
  try {
    const dir = inside(paths(home).pages, slug(testId));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${slug(modelId)}.html`), readFileSync(file));
    writeJson(join(dir, `${slug(modelId)}.json`), { name: basename(file), model: modelId, at: new Date().toISOString() });
    return true;
  } catch { return false; }
}
export function lastPage(testId, home = battleHome()) {
  const dir = join(paths(home).pages, slug(testId));
  let best = null;
  let names = [];
  try { names = readdirSync(dir).filter((f) => f.endsWith('.html')); } catch { return null; }
  for (const f of names) {
    const st = statSync(join(dir, f));
    if (best && st.mtimeMs <= best.mtime) continue;
    const info = readJson(join(dir, f.replace(/\.html$/, '.json')), {});
    best = { file: join(dir, f), name: info.name ?? f, model: info.model ?? f.replace(/\.html$/, ''), at: info.at ?? new Date(st.mtimeMs).toISOString(), mtime: st.mtimeMs };
  }
  return best;
}

// A test's checks on one page, no model: the page handed over ({ name, html }), else the last page a
// run of test `id` made. A check that does not read a page (the tests pass, no file changed) needs a
// real run: it comes back as not tried (pass null). layoutCheck: the app's (see checks.mjs).
export async function tryChecks({ id = null, checks = [], prompt = '', page = null }, { layoutCheck = null } = {}, home = battleHome()) {
  const list = cleanChecks(checks);
  let src = page && typeof page.html === 'string' && page.html.trim() ? { name: basename(String(page.name || 'page.html')).replace(/[^\w.-]+/g, '-') || 'page.html', html: page.html, at: page.at ?? null, model: null, given: true } : null;
  if (!src && id) { const last = lastPage(id, home); if (last) src = { name: last.name, html: readFileSync(last.file, 'utf8'), at: last.at, model: last.model, given: false }; }
  if (!src) return { page: null, results: [], pass: null };
  const work = mkdtempSync(join(tmpdir(), 'agentic-try-'));
  try {
    writeFileSync(join(work, /\.html?$/i.test(src.name) ? src.name : `${src.name}.html`), src.html);
    const tried = list.filter((c) => PAGE_CHECKS.includes(c.type));
    const r = await runChecksWith({ checks: tried, work, before: {}, answer: '', prompt }, { layoutCheck });
    const by = new Map(tried.map((c, i) => [`${c.type}:${c.value}`, r.checks[i]]));
    const results = list.map((c) => { const x = by.get(`${c.type}:${c.value}`); return x ? { key: `${c.type}:${c.value}`, label: x.label, pass: x.pass, why: String(x.why ?? '').replace(/^[^:]+\.html?: /, ''), ...(x.problems ? { problems: x.problems } : {}) } : { key: `${c.type}:${c.value}`, label: labelOf(c), pass: null, why: 'needs a real run: it does not read a page' }; });
    const real = results.filter((x) => x.pass !== null);
    return { page: { name: src.name, at: src.at, model: src.model, given: src.given }, results, pass: real.length ? real.every((x) => x.pass) : null };
  } finally { rmSync(work, { recursive: true, force: true }); }
}
