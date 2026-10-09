// Profiles (8 Oct 2026, the owner's ask and picks): a profile is a server, a model and that model's
// settings, under a name (Main, Fast, Review…). Each AI (who asks: the main conversation, /btw, the
// helpers) and each task group (a task type, a category, a skill) points at a profile by name, and a
// request reads its profile as it is sent: change a profile and the next request goes the new way, in
// every window on this Mac. A profile may name a backup: when its server is busy (it says so, or sends
// nothing for spillAfter seconds) the request goes to the backup instead.
// Kept in ~/.agentic-coder/profiles.json:
//   { profiles: { Main: { server: { kind, source, address, port, connect, keyId }, model, backup, spillAfter, level, limits }, … },
//     uses: { 'ai:main': 'Main', 'type:fix': 'Review', 'skill:write-a-test': 'Fast', … } }
// Who wins when several fit: the skill, then the task type, then its category, then the AI's own,
// then Main (profileFor).
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { HOME } from '../../../models/index.mjs';
import { readSkills } from '../agent/prompt-files.mjs';

export const PROFILES_FILE = () => join(HOME, 'profiles.json');
export const MAIN_PROFILE = 'Main';
// Seconds without a first word before a request goes to the backup (the steps ←→ walks).
export const SPILL_STEPS = [10, 20, 30, 45, 60, 90, 120, 0];
export const spillWord = (s) => (s ? `${s} s` : 'only when busy');

// The task groups, as /profiles shows them. A row's key is `${group}:${id}`.
// cat: the category a task type or an AI falls in, when it has none of its own.
export const GROUPS = [
  { id: 'ai', label: 'AIs', note: 'who is asking', rows: [
    { id: 'main', label: 'Main conversation', note: 'your requests, step by step' },
    { id: 'btw', label: '/btw', note: 'a side question while it works', cat: 'background' },
    { id: 'side', label: 'Side jobs', note: 'summaries, saved notes, sorting a request', cat: 'background' },
    { id: 'pictures', label: 'Pictures', note: 'looks at a picture your model cannot see', needs: 'vision' },
    { id: 'search', label: 'Code search', note: 'finds the code closest to a request (an embedding model)', needs: 'embedding' },
    { id: 'review', label: 'Second opinion', note: 'checks the plan and the finished change', cat: 'checks' },
    { id: 'designWrite', label: 'UI design · writes', note: 'writes the layout and styling of a page', cat: 'design' },
    { id: 'designCheck', label: 'UI design · checks', note: 'looks at a picture of the page it built', cat: 'checks', needs: 'vision' },
    { id: 'agents', label: '/agents', note: 'the six stages: Define, Plan, Build, Verify, Review, Ship' },
    { id: 'helpers', label: 'Helpers it starts', note: 'the Agent tool: work the model hands to a helper' },
  ] },
  { id: 'type', label: 'Task types', note: 'how a request is sorted', rows: [
    { id: 'question', label: 'Question', note: 'read and answer, change nothing', cat: 'reading' },
    { id: 'fix', label: 'Fix', note: 'make failing tests pass', cat: 'coding' },
    { id: 'change', label: 'Change', note: 'a test first, then the change', cat: 'coding' },
    { id: 'rename', label: 'Rename', note: 'one name, everywhere it is used', cat: 'coding' },
    { id: 'page', label: 'Page / design', note: 'make or restyle a page, screen or widget', cat: 'design' },
    { id: 'chat', label: 'Small talk', note: 'a greeting or thanks', cat: 'reading' },
    { id: 'other', label: 'Other', note: 'anything else, step by step', cat: 'coding' },
  ] },
  { id: 'cat', label: 'Categories', note: 'groups of task types and AIs', rows: [
    { id: 'coding', label: 'Coding', note: 'Fix, Change, Rename, Other' },
    { id: 'reading', label: 'Reading', note: 'Question, Small talk' },
    { id: 'design', label: 'Design', note: 'Page / design, UI design · writes' },
    { id: 'checks', label: 'Checks', note: 'Second opinion, UI design · checks' },
    { id: 'background', label: 'Background', note: '/btw, Side jobs' },
  ] },
  { id: 'skill', label: 'Skills', note: 'SKILLS.md, each brought by its words', rows: [] },
];

// The groups with this Mac's skills in the last one (the remote set's, which a model on a service reads).
export function groupsNow(skills = null) {
  let list = skills;
  if (!list) { try { list = readSkills(undefined, 'remote'); } catch { list = []; } }
  return GROUPS.map((g) => (g.id === 'skill' ? { ...g, rows: list.map((s) => ({ id: s.slug, label: s.name, note: s.about || 'a skill' })) } : g));
}
export const rowsOf = (groups) => groups.flatMap((g) => g.rows.map((r) => ({ ...r, group: g.id, key: `${g.id}:${r.id}` })));

// Which profile a request uses, and why: { name, from } with from the key that decided it
// ('skill:…', 'type:…', 'cat:…', 'ai:…') or 'main' when none did.
export function profileFor({ ai = 'main', type = null, skill = null } = {}, data) {
  const uses = data?.uses ?? {};
  const have = (k) => (uses[k] && data.profiles?.[uses[k]] ? uses[k] : null);
  const rowCat = (g, id) => GROUPS.find((x) => x.id === g)?.rows.find((r) => r.id === id)?.cat ?? null;
  const tries = [skill && `skill:${skill}`, type && `type:${type}`, type && rowCat('type', type) && `cat:${rowCat('type', type)}`, `ai:${ai}`, rowCat('ai', ai) && `cat:${rowCat('ai', ai)}`].filter(Boolean);
  for (const k of tries) if (have(k)) return { name: uses[k], from: k };
  return { name: data?.profiles?.[MAIN_PROFILE] ? MAIN_PROFILE : Object.keys(data?.profiles ?? {})[0] ?? null, from: 'main' };
}

// What a row uses when it has no pick of its own: { name, from } (from: the row it comes from).
export function inheritedOf(row, data) {
  if (row.group === 'skill') return { name: profileFor({}, data).name, from: 'request' };
  if (row.group === 'type') return profileFor({ type: row.id, ai: 'main' }, { ...data, uses: { ...data.uses, [row.key]: undefined } });
  if (row.group === 'cat') return { name: profileFor({}, data).name, from: 'main' };
  return profileFor({ ai: row.id }, { ...data, uses: { ...data.uses, [row.key]: undefined } });
}

// ---- the file ------------------------------------------------------------------------------------

// The server part of a saved /remote set-up (never its key: that stays in the Keychain under keyId).
export const serverOf = (r) => (r ? { kind: r.kind, source: r.source ?? null, address: r.address ?? '', port: r.port ?? null, connect: r.connect ?? 'http', keyId: r.keyId ?? 'default' } : null);
export const sameServer = (a, b) => Boolean(a && b) && a.kind === b.kind && (a.address ?? '') === (b.address ?? '') && (a.port ?? null) === (b.port ?? null);
export const serverWord = (s) => (!s ? 'no server' : s.kind === 'claude' ? 'Claude API' : s.kind === 'openai' ? 'service' : 'your computer');

// The first profiles, from what runs today, so nothing changes on day one: Main = the remote in use,
// one profile per /subagents helper model (jobs: the agent's helperJobs, { id: { on, model } }),
// named by the job, and each other server saved in /remote (the Claude API, a service, your other
// computer) as a profile nothing uses yet, ready to be given jobs or be a backup.
const JOB_PROFILE = { side: 'Fast', review: 'Review', pictures: 'Vision', search: 'Search', designCheck: 'Vision', designWrite: 'Writer' };
const JOB_ROW = { side: ['ai:side', 'ai:btw'], review: ['ai:review'], pictures: ['ai:pictures'], search: ['ai:search'], designCheck: ['ai:designCheck'], designWrite: ['ai:designWrite'] };
export function seedProfiles(settings = {}, jobs = null) {
  const r = settings.remote?.use ? settings.remote : null;
  const profiles = {};
  const uses = {};
  if (!r) return { profiles, uses };
  profiles[MAIN_PROFILE] = { server: serverOf(r), model: r.model, backup: null, spillAfter: 30 };
  uses['ai:main'] = MAIN_PROFILE;
  const byModel = new Map([[r.model, MAIN_PROFILE]]);
  for (const [id, j] of Object.entries(jobs ?? {})) {
    if (!j?.on || !j.model || !JOB_ROW[id]) continue;
    const model = j.model === 'main' ? r.model : j.model;
    let name = byModel.get(model);
    if (!name) {
      name = JOB_PROFILE[id];
      if (profiles[name]) name = `${name} ${Object.keys(profiles).length}`;
      profiles[name] = { server: serverOf(r), model, backup: id === 'search' ? null : MAIN_PROFILE, spillAfter: 0 };
      byModel.set(model, name);
    }
    for (const k of JOB_ROW[id]) uses[k] = name;
  }
  const SAVED_NAME = { claude: 'Claude', openai: 'Service', machine: 'Computer' };
  for (const [src, saved] of Object.entries(settings.remotes ?? {})) {
    if (!saved?.model || sameServer(serverOf(saved), serverOf(r)) || Object.values(profiles).some((p) => sameServer(p.server, serverOf(saved)))) continue;
    const name = SAVED_NAME[src] ?? src;
    if (!profiles[name]) profiles[name] = { server: serverOf(saved), model: saved.model, backup: null, spillAfter: 0 };
  }
  return { profiles, uses };
}

export function readProfiles(settings, jobs = null) {
  try {
    const d = JSON.parse(readFileSync(PROFILES_FILE(), 'utf8'));
    if (d && typeof d.profiles === 'object') return { profiles: d.profiles ?? {}, uses: d.uses ?? {} };
  } catch {}
  return seedProfiles(settings, jobs);
}

// Written whole through a file beside it, so a window reading it never sees half of it.
export function writeProfiles(data) {
  mkdirSync(HOME, { recursive: true });
  const tmp = `${PROFILES_FILE()}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ profiles: data.profiles, uses: data.uses }, null, 2)}\n`);
  renameSync(tmp, PROFILES_FILE());
  return data;
}
export const profilesSaved = () => existsSync(PROFILES_FILE());

// ---- /remote and the conversation's profile ------------------------------------------------------

// /remote's Connect, and a window's start on the remote (9 Oct 2026, the owner's pick: "Connect makes the
// new model Main", every window following from its next step). Before, Connect moved the window and the
// router moved it back to Main at the next step. r: the /remote set-up connected, its model the one in use.
// { name, was, data } with the conversation's profile on that server and model, or null when it is already.
export function withMain(data, r) {
  const own = data.uses['ai:main'];
  const name = own && data.profiles[own] ? own : MAIN_PROFILE;
  const p = data.profiles[name];
  const server = serverOf(r);
  if (!r?.model || (p && sameServer(p.server, server) && p.model === r.model)) return null;
  // A backup that is now the same server and model as Main is no backup.
  const b = p?.backup ? data.profiles[p.backup] : null;
  const backup = b && sameServer(b.server, server) && b.model === r.model ? null : p?.backup ?? null;
  return { name, was: p ?? null, data: { profiles: { ...data.profiles, [name]: { ...(p ?? { spillAfter: 30 }), server, model: r.model, backup } }, uses: { ...data.uses, 'ai:main': name } } };
}
// The other way (9 Oct 2026): Main changed in /profiles, the hub or a window's route, so /remote's saved
// set-up (where a window starts) names it too; else the next start put Main back. The set-up to save, from
// the server's own saved one in /remote (its key's name, its address), or null when it already is.
export function remoteOfMain(settings, data) {
  const p = data.profiles[profileFor({}, data).name];
  const r = settings?.remote;
  if (!p?.server || !p.model || !r?.use || (sameServer(serverOf(r), p.server) && r.model === p.model)) return null;
  const saved = sameServer(serverOf(r), p.server) ? r : Object.values(settings.remotes ?? {}).find((x) => sameServer(serverOf(x), p.server));
  return saved ? { ...saved, model: p.model, use: true } : null;
}
// /remote's "Just this window" (9 Oct 2026, the owner's picks): the profiles as one window sees them while it
// runs on a service of its own, the file left as it is, so the other windows stay where Main is. own: { server,
// model }. Every job follows the window: the conversation's profile is that model; a profile on that server
// keeps its model; one on another server (the Claude API) is that model too. A backup on another server is
// none here (the window never reaches outside its service): a busy server means a wait.
export function windowView(data, own) {
  if (!own?.server || !own.model) return data;
  const main = profileFor({}, data).name;
  const here = (p) => Boolean(p) && sameServer(p.server, own.server);
  const profiles = {};
  for (const [name, p] of Object.entries(data.profiles)) {
    const keep = here(p) && name !== main;
    const b = p.backup ? data.profiles[p.backup] : null;
    const { level, limits, ...rest } = p;
    profiles[name] = { ...(keep ? p : rest), server: keep ? p.server : own.server, model: keep ? p.model : own.model, backup: here(b) && p.backup !== main ? p.backup : null };
  }
  if (!main) profiles[MAIN_PROFILE] = { server: own.server, model: own.model, backup: null, spillAfter: 30 };
  return { profiles, uses: { ...data.uses, 'ai:main': main ?? MAIN_PROFILE } };
}
// The AIs whose profile is on another server than the conversation's: what Connect says stays where it
// is (the owner's pick: the helpers keep their own profiles). [{ label, model, where }], one per profile.
export function helpersAway(data) {
  const main = data.profiles[profileFor({}, data).name];
  const by = new Map();
  for (const row of GROUPS[0].rows) {
    if (row.id === 'main') continue;
    const { name } = profileFor({ ai: row.id }, data);
    const p = name ? data.profiles[name] : null;
    if (!p || !main || sameServer(p.server, main.server)) continue;
    if (!by.has(name)) by.set(name, { labels: [], model: p.model, where: serverWord(p.server) });
    by.get(name).labels.push(row.label);
  }
  return [...by.values()].map((x) => ({ label: x.labels.join(' and '), model: x.model, where: x.where }));
}

// ---- /model's step 2: which profile uses the model picked --------------------------------------

// The rows: each profile, then + New profile…, then Just this window (today's switch, no profile).
export function profileStepRows(data) {
  return [...Object.keys(data.profiles).map((name) => ({ kind: 'profile', name })), { kind: 'new' }, { kind: 'window' }];
}
// Who uses a profile, in words: its own picks first ("your conversation, /btw"), then how many more.
export function usersOf(name, data, groups = GROUPS) {
  const rows = rowsOf(groups).filter((r) => data.uses[r.key] === name);
  const words = rows.map((r) => (r.key === 'ai:main' ? 'your conversation' : r.label));
  return words;
}
export const validProfileName = (s) => /^[A-Za-z][\w .-]{0,19}$/.test(String(s ?? '').trim());

// ---- /profiles ---------------------------------------------------------------------------------

// The panel's state: the profiles, then one group's rows (tab), the cursor over both (at).
export function openProfiles(data, { groups = groupsNow() } = {}) {
  return { kind: 'profiles', data, groups, at: 0, tab: 0 };
}
// The cursor runs over the profile rows (+ New profile) and then the open group's rows.
export function listRows(pk) {
  const names = Object.keys(pk.data.profiles);
  const g = pk.groups[pk.tab];
  return [...names.map((name) => ({ kind: 'profile', name })), { kind: 'new' }, ...g.rows.map((r) => ({ kind: 'use', row: { ...r, group: g.id, key: `${g.id}:${r.id}` } }))];
}
// A row's pick stepped through: (its category's or Main's: none of its own) → each profile in turn.
export function stepUse(pk, key, dir) {
  const names = [null, ...Object.keys(pk.data.profiles)];
  const i = names.indexOf(pk.data.uses[key] ?? null);
  const next = names[(i + dir + names.length) % names.length];
  const uses = { ...pk.data.uses };
  if (next) uses[key] = next; else delete uses[key];
  return { ...pk, data: { ...pk.data, uses } };
}
// A model that cannot do a row's job: the pictures need one that sees, code search an embedding model.
export function cannotDo(row, profile, catalog) {
  if (!row.needs || !profile) return null;
  const m = catalog?.find((x) => x.id === profile.model);
  if (!m) return profile.server?.kind === 'claude' && row.needs === 'vision' ? null : row.needs === 'embedding' ? `${profile.model} is not an embedding model` : null;
  if (row.needs === 'vision' && !m.vision) return `${profile.model} cannot see pictures`;
  if (row.needs === 'embedding' && !m.embedding) return `${profile.model} is not an embedding model`;
  return null;
}
