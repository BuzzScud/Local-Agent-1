// Profiles (8 Oct 2026): which profile a request uses (the most specific pick wins), the first profiles
// made from today's /subagents helpers, the file, the meters, the router (servers connected once, a
// helper's call, the cool-down after a spill), a request moved to the backup when its server is busy
// or silent, and the conversation moving to another server between two steps of one task.
import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_MEMORY_SAVE = 'off';
const { profileFor, inheritedOf, seedProfiles, readProfiles, writeProfiles, profilesSaved, PROFILES_FILE, rowsOf, groupsNow, GROUPS, stepUse, openProfiles, listRows, cannotDo, usersOf, withMain, helpersAway, remoteOfMain, windowView } = await import('../src/app/profiles.mjs');
const { ProfileRouter, serverKey } = await import('../src/app/profile-router.mjs');
const { noteServed, noteSpill, readMeters, flushMeters, meterWords } = await import('../src/agent/profile-meters.mjs');
const { streamChat, routeCalls } = await import('../src/agent/client.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');

const srv = (address, kind = 'openai') => ({ kind, source: kind === 'claude' ? 'claude' : 'openai', address, port: null, connect: 'http', keyId: kind });
const SVC = srv('http://svc.example:60009');
const CLAUDE = srv('', 'claude');
const P = (server, model, more = {}) => ({ server, model, backup: null, spillAfter: 0, ...more });
const cleanup = [];
afterAll(() => { for (const f of cleanup) f(); });
const fresh = () => rmSync(PROFILES_FILE(), { force: true });

// ---- which profile ----------------------------------------------------------------------------

test('the most specific pick wins: a skill, then the task type, then its category, then the AI, then Main', () => {
  const d = { profiles: { Main: P(SVC, 'qwen3.6'), Fast: P(SVC, 'llama3.2:3b'), Review: P(SVC, 'gpt-oss:120b'), Claude: P(CLAUDE, 'claude-opus-5-5') },
    uses: { 'ai:main': 'Main', 'ai:btw': 'Fast', 'cat:coding': 'Review', 'type:fix': 'Claude', 'skill:write-a-test': 'Fast' } };
  expect(profileFor({ ai: 'main', type: 'fix', skill: 'write-a-test' }, d)).toEqual({ name: 'Fast', from: 'skill:write-a-test' });
  expect(profileFor({ ai: 'main', type: 'fix' }, d)).toEqual({ name: 'Claude', from: 'type:fix' });
  expect(profileFor({ ai: 'main', type: 'change' }, d)).toEqual({ name: 'Review', from: 'cat:coding' });
  expect(profileFor({ ai: 'main', type: 'question' }, d)).toEqual({ name: 'Main', from: 'ai:main' });
  expect(profileFor({ ai: 'btw' }, d)).toEqual({ name: 'Fast', from: 'ai:btw' });
  // an AI with no pick: its category's (Second opinion is a Check), else Main
  expect(profileFor({ ai: 'review' }, { ...d, uses: { ...d.uses, 'cat:checks': 'Claude' } })).toEqual({ name: 'Claude', from: 'cat:checks' });
  expect(profileFor({ ai: 'pictures' }, d)).toEqual({ name: 'Main', from: 'main' });
  // a pick naming a profile that is gone does not count
  expect(profileFor({ ai: 'btw' }, { ...d, uses: { 'ai:btw': 'Gone' } }).name).toBe('Main');
  // what a row shows when it has no pick of its own
  const rows = rowsOf(groupsNow([]));
  expect(inheritedOf(rows.find((r) => r.key === 'type:rename'), d)).toEqual({ name: 'Review', from: 'cat:coding' });
  expect(inheritedOf(rows.find((r) => r.key === 'skill:x') ?? { group: 'skill', id: 'x', key: 'skill:x' }, d)).toEqual({ name: 'Main', from: 'request' });
  expect(usersOf('Fast', d)).toEqual(['/btw']);
});

test('the first profiles copy today: Main is the remote in use, one profile per /subagents helper model, the Claude API saved as one nothing uses', () => {
  const settings = { remote: { ...SVC, model: 'qwen3.6:35b-a3b', use: true }, remotes: { openai: { ...SVC, model: 'qwen3.6:35b-a3b' }, claude: { ...CLAUDE, model: 'claude-opus-5-5' } } };
  const jobs = { side: { on: true, model: 'llama3.2:3b' }, pictures: { on: true, model: 'llava:latest' }, search: { on: true, model: 'embeddinggemma:latest' }, review: { on: true, model: 'gpt-oss:120b' }, designWrite: { on: true, model: 'main' }, designCheck: { on: true, model: 'llava:latest' } };
  const d = seedProfiles(settings, jobs);
  expect(Object.keys(d.profiles)).toEqual(['Main', 'Fast', 'Vision', 'Search', 'Review', 'Claude']);
  expect(d.profiles.Main).toMatchObject({ model: 'qwen3.6:35b-a3b', server: { kind: 'openai', address: SVC.address } });
  expect(d.profiles.Claude).toMatchObject({ model: 'claude-opus-5-5', server: { kind: 'claude' } });
  expect(d.profiles.Search.backup).toBe(null);
  expect(d.uses).toEqual({ 'ai:main': 'Main', 'ai:side': 'Fast', 'ai:btw': 'Fast', 'ai:pictures': 'Vision', 'ai:search': 'Search', 'ai:review': 'Review', 'ai:designWrite': 'Main', 'ai:designCheck': 'Vision' });
  // a job switched off has no profile: the conversation's model, as before
  expect(seedProfiles(settings, { ...jobs, review: { on: false, model: 'gpt-oss:120b' } }).uses['ai:review']).toBeUndefined();
  // no remote in use: none
  expect(seedProfiles({ remote: { use: false } }, jobs)).toEqual({ profiles: {}, uses: {} });
  // on the Claude API (this Mac's set-up) with a service saved: the service is a profile nothing uses yet
  const onClaude = seedProfiles({ remote: { ...CLAUDE, model: 'claude-fable-5-1', use: true }, remotes: { claude: { ...CLAUDE, model: 'claude-fable-5-1' }, openai: { ...SVC, model: 'qwen3.6:35b-a3b' } } }, null);
  expect(Object.keys(onClaude.profiles)).toEqual(['Main', 'Service']);
  expect(onClaude.profiles.Service).toMatchObject({ model: 'qwen3.6:35b-a3b', server: { address: SVC.address } });
  expect(onClaude.uses).toEqual({ 'ai:main': 'Main' });
});

test('the file: none saved means none decide; a save is whole and read back as written', () => {
  fresh();
  expect(profilesSaved()).toBe(false);
  const settings = { remote: { ...SVC, model: 'qwen3.6', use: true } };
  expect(readProfiles(settings).profiles.Main.model).toBe('qwen3.6');
  writeProfiles({ profiles: { Main: P(SVC, 'laguna') }, uses: { 'ai:main': 'Main' } });
  expect(profilesSaved()).toBe(true);
  expect(readProfiles(settings)).toEqual({ profiles: { Main: P(SVC, 'laguna') }, uses: { 'ai:main': 'Main' } });
  fresh();
});

test('/profiles: ←→ on a row steps through none of its own, then each profile; a model that cannot do a row\'s job is named', () => {
  const d = { profiles: { Main: P(SVC, 'laguna'), Vision: P(SVC, 'llava:latest') }, uses: { 'ai:pictures': 'Vision' } };
  let pk = openProfiles(d, { groups: groupsNow([]) });
  expect(listRows(pk).map((r) => r.kind).slice(0, 4)).toEqual(['profile', 'profile', 'new', 'use']);
  pk = stepUse(pk, 'ai:pictures', 1);
  expect(pk.data.uses['ai:pictures']).toBeUndefined();
  pk = stepUse(pk, 'ai:pictures', 1);
  expect(pk.data.uses['ai:pictures']).toBe('Main');
  const pictures = GROUPS[0].rows.find((r) => r.id === 'pictures');
  const catalog = [{ id: 'laguna', vision: false, embedding: false }, { id: 'llava:latest', vision: true }];
  expect(cannotDo(pictures, d.profiles.Main, catalog)).toBe('laguna cannot see pictures');
  expect(cannotDo(pictures, d.profiles.Vision, catalog)).toBe(null);
  expect(cannotDo(GROUPS[0].rows.find((r) => r.id === 'search'), d.profiles.Main, catalog)).toBe('laguna is not an embedding model');
});

test('the meters: each window its own file, added up over the windows; a spill counts on the profile it left', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-meters-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const now = new Date('2026-10-08T14:00:00');
  noteServed('Main', { waitS: 2, tps: 50, usd: null }, { dir, pid: 11, now });
  noteServed('Main', { waitS: 6, tps: 40 }, { dir, pid: 11, now: new Date('2026-10-08T14:00:05') });
  noteSpill('Main', { dir, pid: 11, now });
  noteServed('Claude', { waitS: 1, usd: 0.25 }, { dir, pid: 11, now });
  flushMeters({ dir, pid: 11 });
  writeFileSync(join(dir, '2026-10-08', '22.json'), JSON.stringify({ day: '2026-10-08', profiles: { Main: { n: 2, waitSum: 4, waitN: 2, waitLast: 1, tpsLast: 30, spills: 0, usd: 0, at: 1 } } }));
  const m = readMeters({ dir, now });
  expect(m.Main).toMatchObject({ n: 4, wait: 3, spills: 1, tps: 40, waitLast: 6 });
  expect(meterWords(m.Main)).toBe('4 today · wait 3.0 s · 40 tok/s · 1 to backup');
  expect(meterWords(m.Claude)).toBe('1 today · wait 1.0 s · $0.25');
  expect(meterWords(undefined)).toBe('no requests yet today');
  // a profile whose only request went to its backup
  expect(meterWords({ n: 0, spills: 1, usd: 0 })).toBe('1 to backup');
});

// ---- the router -------------------------------------------------------------------------------

const modelObj = (name) => ({ ...MODELS[DEFAULT_MODEL], remote: { model: name, kind: 'openai' } });
// connectRemote's stand-in: the server's address is its url; its endpoint names the model asked for.
const fakeConnect = (calls = []) => async (r) => {
  calls.push(`${r.address}|${r.model}`);
  setEndpoint(r.address, { remote: true, kind: 'openai', model: r.model, label: r.address });
  return { url: r.address, model: modelObj(r.model), ctx: 32768, info: {}, vision: false, stop: () => {} };
};

test('the router: nothing until a file is saved; the conversation moves only when its profile is another model; a helper names its model and server', async () => {
  fresh();
  const A = srv('http://a.test:1'), B = srv('http://b.test:2');
  const calls = [];
  const settings = { remote: { ...A, model: 'a1', use: true }, remotes: {} };
  const r = new ProfileRouter({ settings: () => settings, connect: fakeConnect(calls) });
  expect(r.active()).toBe(false);
  writeProfiles({ profiles: { Main: P(A, 'a1'), Fast: P(A, 'a-small'), Far: P(B, 'b1', { backup: 'Main', spillAfter: 30 }) }, uses: { 'ai:main': 'Main', 'ai:btw': 'Fast', 'ai:review': 'Far' } });
  expect(r.active()).toBe(true);
  setEndpoint(A.address, { remote: true, kind: 'openai', model: 'a1', label: A.address }); // the window's own connection
  r.lend(A, { url: A.address });
  const now = { url: A.address, model: 'a1' };
  expect(await r.route({ ai: 'main' }, now)).toEqual({ name: 'Main', same: true });
  expect(calls).toEqual([]);
  // a helper on the conversation's own model: none; on another model there: that model, by name
  expect(r.helper('side', now)).toBeUndefined();
  expect(r.helper('btw', now)).toMatchObject({ url: A.address, model: 'a-small', profile: 'Fast' });
  // on another server: reached in the background; until then the conversation's model, once
  expect(r.helper('review', now)).toBeUndefined();
  await r.reach(B);
  const u = r.helper('review', now);
  expect(u).toMatchObject({ url: B.address, model: 'b1', profile: 'Far' });
  expect(u.spill).toMatchObject({ name: 'Far', after: 30 });
  // Main changed in the file: the next route moves the conversation, connected for that model
  await Bun.sleep(5);
  writeProfiles({ profiles: { Main: P(B, 'b2'), Fast: P(A, 'a-small') }, uses: { 'ai:main': 'Main', 'ai:btw': 'Fast' } });
  const to = await r.route({ ai: 'main' }, now);
  expect(to).toMatchObject({ name: 'Main', same: false, url: B.address, ctx: 32768 });
  expect(to.model.remote.model).toBe('b2');
  expect(calls.at(-1)).toBe(`${B.address}|b2`);
  // a connection closed elsewhere (its endpoint gone): forgotten and reached again, not used dead
  dropEndpoint(A.address);
  expect(r.helper('btw', { url: B.address, model: 'b2' })).toBeUndefined();
  await Bun.sleep(10);
  expect(r.helper('btw', { url: B.address, model: 'b2' })).toMatchObject({ url: A.address, model: 'a-small' });
  expect(calls.at(-1)).toBe(`${A.address}|`);
  r.stop();
  fresh();
});

test('the router: after a spill the profile cools down for 2 minutes: its requests go straight to the backup, then it is tried again', async () => {
  fresh();
  const A = srv('http://a.test:1'), B = srv('http://b.test:2');
  let t = 1_000_000;
  const r = new ProfileRouter({ settings: () => ({ remote: { ...A, model: 'a1', use: true } }), connect: fakeConnect(), now: () => t });
  writeProfiles({ profiles: { Main: P(A, 'a1', { backup: 'Spare', spillAfter: 45 }), Spare: P(B, 'b1') }, uses: { 'ai:main': 'Main' } });
  r.lend(A, { url: A.address });
  expect(r.callFor('Main')).toMatchObject({ profile: 'Main', spill: { name: 'Main', after: 45 } });
  const to = await r.callFor('Main').spill.to('no first word in 45 s');
  expect(to).toMatchObject({ name: 'Spare', url: B.address, use: { url: B.address, model: 'b1', profile: 'Spare' } });
  expect(r.callFor('Main').cooled).toMatchObject({ url: B.address, model: 'b1', profile: 'Spare' });
  t += 2 * 60_000 + 1;
  expect(r.callFor('Main').spill).toBeTruthy();
  r.stop();
  fresh();
});

// ---- the client: a request moved to the backup ------------------------------------------------

const ask = [{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'Say hi.' }];
const collect = async (gen) => { const out = []; for await (const ev of gen) out.push(ev); return out; };

test('a server that answers "too many requests": the request goes to the backup at once, with a spill event', async () => {
  const busy = createServer((req, res) => { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '20' }); res.end('{"error":{"message":"Too many requests"}}'); });
  await new Promise((ok) => busy.listen(0, '127.0.0.1', ok));
  const busyUrl = `http://127.0.0.1:${busy.address().port}`;
  const B = await startFakeServer([{ text: 'hi from the backup' }]);
  setEndpoint(busyUrl, { remote: true, kind: 'openai', model: 'a1', label: `busy-${busy.address().port}` });
  setEndpoint(B.url, { remote: true, kind: 'openai', model: 'b-default', label: 'b' });
  try {
    const t0 = Date.now();
    const evs = await collect(streamChat({ url: busyUrl, messages: ask, maxTokens: 50, profile: 'Main', spill: { name: 'Main', after: 30, to: async () => ({ name: 'Spare', url: B.url, use: { url: B.url, model: 'b1', profile: 'Spare' } }) } }));
    expect(evs.find((e) => e.type === 'spill')).toMatchObject({ from: 'Main', to: 'Spare', why: 'its server said it is busy' });
    expect(evs.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('hi from the backup');
    expect(B.requests[0].model).toBe('b1');
    expect(Date.now() - t0).toBeLessThan(5000);
  } finally { busy.close(); B.close(); dropEndpoint(busyUrl); dropEndpoint(B.url); }
});

test('a server that sends nothing: after the wait the request goes to the backup; one that answers in time stays', async () => {
  const silent = createServer(() => {});
  await new Promise((ok) => silent.listen(0, '127.0.0.1', ok));
  const silentUrl = `http://127.0.0.1:${silent.address().port}`;
  const B = await startFakeServer([{ text: 'from B' }, { text: 'B again' }]);
  setEndpoint(silentUrl, { remote: true, kind: 'openai', model: 'a1', label: `silent-${silent.address().port}` });
  setEndpoint(B.url, { remote: true, kind: 'openai', model: 'b1', label: 'b2' });
  const to = async () => ({ name: 'Spare', url: B.url, use: { url: B.url, model: 'b1', profile: 'Spare' } });
  try {
    const t0 = Date.now();
    const evs = await collect(streamChat({ url: silentUrl, messages: ask, maxTokens: 50, spill: { name: 'Main', after: 1, to } }));
    expect(evs[0]).toMatchObject({ type: 'spill', why: 'no first word in 1 s' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(950);
    expect(evs.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('from B');
    // B answers at once: it is not moved
    const kept = await collect(streamChat({ url: B.url, messages: ask, maxTokens: 50, spill: { name: 'Spare', after: 5, to: async () => { throw new Error('not called'); } } }));
    expect(kept.some((e) => e.type === 'spill')).toBe(false);
    expect(kept.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('B again');
  } finally { silent.closeAllConnections?.(); silent.close(); B.close(); dropEndpoint(silentUrl); dropEndpoint(B.url); }
});

test('no backup to go to: the request that is waiting goes on waiting, not sent again from the back of the line', async () => {
  // A server whose first word comes after 1.5 s (a short line ahead of it), one reply per request it gets.
  let asked = 0;
  const slow = createServer(async (req, res) => {
    for await (const _ of req) { /* the body */ }
    asked++;
    await Bun.sleep(1500);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `answer ${asked}` }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  await new Promise((ok) => slow.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${slow.address().port}`;
  setEndpoint(url, { remote: true, kind: 'openai', model: 'a1', label: `slow-${slow.address().port}` });
  try {
    let tried = 0;
    const evs = await collect(streamChat({ url, messages: ask, maxTokens: 50, spill: { name: 'Main', after: 1, to: async () => { tried++; return null; } } }));
    expect(tried).toBe(1); // it was past the wait, and the backup could not be had
    expect(evs.some((e) => e.type === 'spill')).toBe(false);
    expect(evs.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('answer 1');
    expect(asked).toBe(1);
  } finally { slow.closeAllConnections?.(); slow.close(); dropEndpoint(url); }
});

test('a call on the conversation\'s model that names no profile (a summary, the cases, a check) follows its profile too: to the backup while it cools down', async () => {
  const silent = createServer(() => {});
  await new Promise((ok) => silent.listen(0, '127.0.0.1', ok));
  const silentUrl = `http://127.0.0.1:${silent.address().port}`;
  const B = await startFakeServer([{ text: 'side answer from B' }]);
  setEndpoint(silentUrl, { remote: true, kind: 'openai', model: 'a1', label: `side-${silent.address().port}` });
  setEndpoint(B.url, { remote: true, kind: 'openai', model: 'b1', label: 'b3' });
  routeCalls(silentUrl, () => ({ use: { url: B.url, model: 'b1', profile: 'Spare' }, profile: 'Spare' }));
  try {
    const evs = await collect(streamChat({ url: silentUrl, messages: ask, maxTokens: 50 }));
    expect(evs.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('side answer from B');
    expect(B.requests[0].model).toBe('b1');
  } finally { routeCalls(silentUrl, null); silent.closeAllConnections?.(); silent.close(); B.close(); dropEndpoint(silentUrl); dropEndpoint(B.url); }
});

// ---- the conversation, mid-task ---------------------------------------------------------------

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-profiles-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  for (let i = 0; i < 3; i++) writeFileSync(join(dir, `f${i}.mjs`), `export const v${i} = ${i};\n`);
  return dir;
}
const agentOn = (url, model) => {
  const cwd = project();
  return new Agent({ url, model, cwd, system: systemPrompt({ cwd, git: 'none' }), memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, thinking: false, way: 'model', hooks: [] });
};
const streams = (s) => s.requests.filter((j) => j.stream);

test('mid-task: Main changed after the first step; the next step goes to the other server and model, and the screen is told', async () => {
  fresh();
  const A = await startFakeServer([{ tool: { name: 'Read', args: { path: 'f1.mjs' } } }, { text: 'A would answer here.' }]);
  const B = await startFakeServer([{ text: 'f1.mjs exports v1.' }]);
  const sA = srv(A.url), sB = srv(B.url);
  setEndpoint(A.url, { remote: true, kind: 'openai', model: 'a1', label: 'A' });
  writeProfiles({ profiles: { Main: P(sA, 'a1') }, uses: { 'ai:main': 'Main' } });
  const router = new ProfileRouter({ settings: () => ({ remote: { ...sA, model: 'a1', use: true } }), connect: fakeConnect() });
  router.lend(sA, { url: A.url });
  const a = agentOn(A.url, modelObj('a1'));
  a.router = router;
  const notes = [], routes = [];
  a.on('note', (n) => notes.push(n.text));
  a.on('profile-route', (r) => routes.push(r));
  let changed = false;
  // After the first step on A (the window's opening read of the memory is a tool too, before any step).
  a.on('tool', () => { if (!changed && streams(A).length === 1) { changed = true; writeProfiles({ profiles: { Main: P(sB, 'b1') }, uses: { 'ai:main': 'Main' } }); } });
  try {
    await a.send('which file exports v1?');
    expect(streams(A)).toHaveLength(1);
    expect(streams(B)).toHaveLength(1);
    expect(streams(B)[0].model).toBe('b1');
    // the new model read the whole conversation: the request and the first step's Read are in what B got
    expect(JSON.stringify(streams(B)[0].messages)).toContain('which file exports v1?');
    expect(JSON.stringify(streams(B)[0].messages)).toContain('export const v1 = 1');
    // (a short conversation: no line about reading it again; past 2k tokens it says how much)
    expect(notes.some((t) => /^Main: a1 → b1, from this step\.( It reads the conversation once \(about \d+k tokens\)\.)?$/.test(t))).toBe(true);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ name: 'Main', helper: false });
    expect(a.url).toBe(B.url);
    expect(a.messages.at(-1).content).toBe('f1.mjs exports v1.');
  } finally { router.stop(); A.close(); B.close(); dropEndpoint(A.url); dropEndpoint(B.url); fresh(); }
});

test('mid-task: Main\'s server sends nothing; after its wait the step goes to the backup, the next one too while it cools down, and the meters say so', async () => {
  fresh();
  const silent = createServer(() => {});
  await new Promise((ok) => silent.listen(0, '127.0.0.1', ok));
  const H = `http://127.0.0.1:${silent.address().port}`;
  const B = await startFakeServer([{ tool: { name: 'Read', args: { path: 'f2.mjs' } } }, { text: 'f2.mjs exports v2.' }]);
  const sH = srv(H), sB = srv(B.url);
  setEndpoint(H, { remote: true, kind: 'openai', model: 'h1', label: `H-${silent.address().port}` });
  writeProfiles({ profiles: { Main: P(sH, 'h1', { backup: 'Spare', spillAfter: 1 }), Spare: P(sB, 'b1') }, uses: { 'ai:main': 'Main' } });
  const router = new ProfileRouter({ settings: () => ({ remote: { ...sH, model: 'h1', use: true } }), connect: fakeConnect() });
  router.lend(sH, { url: H });
  const a = agentOn(H, modelObj('h1'));
  a.router = router;
  a.stats.pps = 1e9; // what is new is read at once here: the wait is the profile's own second (and one for the read)
  const notes = [];
  a.on('note', (n) => notes.push(n.text));
  flushMeters();
  const before = readMeters();
  try {
    await a.send('which file exports v2?');
    expect(notes.some((t) => /^Main's server: no first word in 2 s\. This step went to Spare; Main is asked again in 2 min\.$/.test(t))).toBe(true);
    // both steps came from the backup: the second went straight there (cooling down), with no wait and no second note
    expect(streams(B)).toHaveLength(2);
    expect(streams(B).every((j) => j.model === 'b1')).toBe(true);
    expect(notes.filter((t) => t.startsWith("Main's server"))).toHaveLength(1);
    expect(router.coolingLeft('Main')).toBeGreaterThan(60_000);
    expect(a.messages.at(-1).content).toBe('f2.mjs exports v2.');
    flushMeters();
    const m = readMeters();
    expect(m.Main.spills - (before.Main?.spills ?? 0)).toBe(1);
    expect(m.Spare.n - (before.Spare?.n ?? 0)).toBe(2);
  } finally { router.stop(); silent.closeAllConnections?.(); silent.close(); B.close(); dropEndpoint(H); dropEndpoint(B.url); fresh(); }
});

// ---- the hub's tab ----------------------------------------------------------------------------

test('the hub\'s Profiles tab: nothing to change until a window saved profiles; then a row\'s profile, a model and a backup are saved to the same file', async () => {
  fresh();
  const { profilesHub } = await import('../src/app/profiles-hub.mjs');
  const hub = profilesHub({ cwd: tmpdir() });
  const at = (path, body, origin = 'http://127.0.0.1:1') => {
    const url = new URL(`http://127.0.0.1:1${path}`);
    return hub.route(new Request(url, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }), url);
  };
  expect(await (await at('/profiles.json')).json()).toMatchObject({ saved: false });
  expect((await at('/profiles/use', { key: 'ai:btw', profile: 'Main' })).status).toBe(409);
  writeProfiles({ profiles: { Main: P(SVC, 'qwen3.6'), Fast: P(SVC, 'llama3.2:3b'), Claude: P(CLAUDE, 'claude-opus-5-5') }, uses: { 'ai:main': 'Main' } });
  const v = await (await at('/profiles.json')).json();
  expect(v.saved).toBe(true);
  expect(v.profiles.map((p) => `${p.name} ${p.model} ${p.server}`)).toEqual(['Main qwen3.6 service', 'Fast llama3.2:3b service', 'Claude claude-opus-5-5 Claude API']);
  expect(v.rows.find((r) => r.key === 'type:fix')).toMatchObject({ own: null, uses: 'Main' });
  await at('/profiles/use', { key: 'type:fix', profile: 'Claude' });
  await at('/profiles/set', { name: 'Main', model: 'laguna-xs-2.1:q8_0', backup: 'Claude', spillAfter: 45 });
  const d = readProfiles({});
  expect(d.uses['type:fix']).toBe('Claude');
  expect(d.profiles.Main).toMatchObject({ model: 'laguna-xs-2.1:q8_0', backup: 'Claude', spillAfter: 45 });
  // what is not a profile, a row or a wait is refused; a page of another site cannot post here
  expect((await at('/profiles/use', { key: 'type:nope', profile: 'Claude' })).status).toBe(400);
  expect((await at('/profiles/set', { name: 'Main', spillAfter: 7 })).status).toBe(400);
  expect((await at('/profiles/set', { name: 'Main', backup: 'Main' })).status).toBe(400);
  expect((await at('/profiles/use', { key: 'type:fix', profile: null }, 'http://evil.example')).status).toBe(403);
  await at('/profiles/use', { key: 'type:fix', profile: null });
  expect(readProfiles({}).uses['type:fix']).toBeUndefined();
  fresh();
});

// ---- /remote and Main (9 Oct 2026) -------------------------------------------------------------
// The owner's case: /remote → Claude API connected, and the router moved the conversation back to Main (Qwen3.6 on
// the service) at the next step. Now Connect moves Main; the helpers keep their own profiles; Main changed in
// /profiles or the hub is what /remote saves, so the next start does not put the old Main back.

test('/remote and Main are one pick: Connect moves the conversation\'s profile, the helpers keep theirs and are named, and another window follows', async () => {
  fresh();
  const d = { profiles: { Main: P(SVC, 'qwen3.6', { spillAfter: 30, backup: 'Claude' }), Fast: P(SVC, 'llama3.2:3b'), Vision: P(SVC, 'llava:latest'), Claude: P(CLAUDE, 'claude-opus-5-5') },
    uses: { 'ai:main': 'Main', 'ai:btw': 'Fast', 'ai:side': 'Fast', 'ai:pictures': 'Vision' } };
  // Connect to the Claude API: Main is that server and model; its wait stays, a backup that is now Main itself goes
  const m = withMain(d, { ...CLAUDE, model: 'claude-opus-5-5' });
  expect(m.name).toBe('Main');
  expect(m.was.model).toBe('qwen3.6');
  expect(m.data.profiles.Main).toMatchObject({ server: { kind: 'claude' }, model: 'claude-opus-5-5', spillAfter: 30, backup: null });
  expect(m.data.profiles.Fast).toEqual(d.profiles.Fast);
  expect(m.data.uses).toEqual(d.uses);
  // already so: nothing to write; the conversation on a profile of another name: that one moves
  expect(withMain(m.data, { ...CLAUDE, model: 'claude-opus-5-5' })).toBeNull();
  expect(withMain({ ...d, uses: { ...d.uses, 'ai:main': 'Claude' } }, { ...SVC, model: 'qwen3.6' }).name).toBe('Claude');
  // no profiles of its own yet: Main is made
  expect(withMain({ profiles: {}, uses: {} }, { ...SVC, model: 'qwen3.6' }).data).toMatchObject({ profiles: { Main: { model: 'qwen3.6', spillAfter: 30 } }, uses: { 'ai:main': 'Main' } });
  // the helpers on another server than Main, one line a profile; none when they share Main's
  expect(helpersAway(m.data)).toEqual([{ label: '/btw and Side jobs', model: 'llama3.2:3b', where: 'service' }, { label: 'Pictures', model: 'llava:latest', where: 'service' }]);
  expect(helpersAway(d)).toEqual([]);
  // another window, its conversation on the service: Main written by the first one's Connect moves it at its next step
  const calls = [];
  const r = new ProfileRouter({ settings: () => ({ remote: { ...SVC, model: 'qwen3.6', use: true }, remotes: { claude: { ...CLAUDE, model: 'claude-opus-5-5' } } }), connect: fakeConnect(calls) });
  writeProfiles(d);
  r.lend(SVC, { url: SVC.address });
  setEndpoint(SVC.address, { remote: true, kind: 'openai', model: 'qwen3.6', label: SVC.address });
  expect(await r.route({ ai: 'main' }, { url: SVC.address, model: 'qwen3.6' })).toEqual({ name: 'Main', same: true });
  await Bun.sleep(5);
  writeProfiles(m.data);
  const to = await r.route({ ai: 'main' }, { url: SVC.address, model: 'qwen3.6' });
  expect(to).toMatchObject({ name: 'Main', same: false, server: { kind: 'claude' } });
  expect(to.model.remote.model).toBe('claude-opus-5-5');
  r.stop();
  dropEndpoint(SVC.address);
  fresh();
});

test('Main changed in /profiles, the hub or by a route: /remote\'s saved set-up names it, from that server\'s own saved one', async () => {
  fresh();
  const settings = { remote: { ...SVC, model: 'qwen3.6', key: false, use: true }, remotes: { openai: { ...SVC, model: 'qwen3.6' }, claude: { ...CLAUDE, model: 'claude-sonnet-5-5', key: true, keyEnd: '6789' } } };
  const d = { profiles: { Main: P(SVC, 'qwen3.6'), Claude: P(CLAUDE, 'claude-opus-5-5') }, uses: { 'ai:main': 'Main' } };
  expect(remoteOfMain(settings, d)).toBeNull();
  expect(remoteOfMain(settings, { ...d, profiles: { ...d.profiles, Main: P(SVC, 'laguna-xs-2.1:q8_0') } })).toMatchObject({ kind: 'openai', address: SVC.address, model: 'laguna-xs-2.1:q8_0', use: true });
  expect(remoteOfMain(settings, { ...d, uses: { 'ai:main': 'Claude' } })).toMatchObject({ kind: 'claude', model: 'claude-opus-5-5', key: true, keyEnd: '6789', use: true });
  // this Mac's own model in use (no remote): profiles decide nothing, nothing to save
  expect(remoteOfMain({ ...settings, remote: { ...settings.remote, use: false } }, { ...d, uses: { 'ai:main': 'Claude' } })).toBeNull();
  // a server /remote has never saved: nothing to start from
  expect(remoteOfMain(settings, { ...d, profiles: { ...d.profiles, Main: P(srv('http://other.test:1'), 'x') } })).toBeNull();
  // the hub: a new model for Main is saved to /remote too, so a window starts where Main is
  const { saveSettings, loadSettings } = await import('../src/app/store.mjs');
  const { profilesHub } = await import('../src/app/profiles-hub.mjs');
  saveSettings({ remote: settings.remote, remotes: settings.remotes });
  writeProfiles(d);
  const hub = profilesHub({ cwd: tmpdir() });
  const at = (path, body) => { const url = new URL(`http://127.0.0.1:1${path}`); return hub.route(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:1' }, body: JSON.stringify(body) }), url); };
  await at('/profiles/set', { name: 'Main', model: 'laguna-xs-2.1:q8_0' });
  expect(loadSettings().remote).toMatchObject({ kind: 'openai', model: 'laguna-xs-2.1:q8_0', use: true });
  await at('/profiles/use', { key: 'ai:main', profile: 'Claude' });
  expect(loadSettings().remote).toMatchObject({ kind: 'claude', model: 'claude-opus-5-5', key: true, use: true });
  // a helper's row changes nothing of /remote
  await at('/profiles/use', { key: 'ai:btw', profile: 'Main' });
  expect(loadSettings().remote.model).toBe('claude-opus-5-5');
  saveSettings({ remote: null, remotes: {} });
  fresh();
});

test('"Just this window": every job of the window follows its service, the file and the other windows stay on Main', async () => {
  fresh();
  const OWN = { server: SVC, model: 'qwen3.6' };
  const d = { profiles: { Main: P(CLAUDE, 'claude-opus-5-5', { backup: 'Spare', level: 'high' }), Spare: P(SVC, 'qwen3.6'), Fast: P(SVC, 'llama3.2:3b', { backup: 'Main' }), Review: P(CLAUDE, 'claude-sonnet-5-5') },
    uses: { 'ai:main': 'Main', 'ai:btw': 'Fast', 'ai:review': 'Review' } };
  const v = windowView(d, OWN);
  // the conversation's profile is the window's model, without Claude's thinking level; a backup on the service stays
  expect(v.profiles.Main).toMatchObject({ server: { address: SVC.address }, model: 'qwen3.6', backup: 'Spare' });
  expect(v.profiles.Main.level).toBeUndefined();
  // a profile on the service keeps its model; its backup Main (Claude in the file) is none here
  expect(v.profiles.Fast).toMatchObject({ model: 'llama3.2:3b', backup: null });
  // one on the Claude API runs on the window's model too
  expect(v.profiles.Review).toMatchObject({ server: { address: SVC.address }, model: 'qwen3.6' });
  expect(helpersAway(v)).toEqual([]);
  expect(d.profiles.Main.model).toBe('claude-opus-5-5');
  expect(windowView(d, null)).toBe(d);
  expect(windowView({ profiles: {}, uses: {} }, OWN).profiles.Main).toMatchObject({ model: 'qwen3.6' });
  // the router: this window on its own service, another window on Main, the file untouched
  writeProfiles(d);
  const settings = () => ({ remote: { ...SVC, model: 'qwen3.6', use: true }, remotes: { claude: { ...CLAUDE, model: 'claude-opus-5-5' } } });
  const mine = new ProfileRouter({ settings, connect: fakeConnect() });
  const other = new ProfileRouter({ settings, connect: fakeConnect() });
  mine.setOwn(OWN);
  expect(mine.data().profiles.Main.model).toBe('qwen3.6');
  expect(other.data().profiles.Main.model).toBe('claude-opus-5-5');
  expect(readProfiles({}, []).profiles.Main.model).toBe('claude-opus-5-5');
  mine.lend(SVC, { url: SVC.address });
  setEndpoint(SVC.address, { remote: true, kind: 'openai', model: 'qwen3.6', label: SVC.address });
  expect(await mine.route({ ai: 'main' }, { url: SVC.address, model: 'qwen3.6' })).toEqual({ name: 'Main', same: true });
  // a change to the file elsewhere still reaches the window's view; Connect for every window ends its own
  await Bun.sleep(5);
  writeProfiles({ ...d, profiles: { ...d.profiles, Fast: P(SVC, 'llama3.2:1b') } });
  expect(mine.data().profiles.Fast.model).toBe('llama3.2:1b');
  expect(mine.data().profiles.Main.model).toBe('qwen3.6');
  mine.setOwn(null);
  expect(mine.data().profiles.Main.model).toBe('claude-opus-5-5');
  mine.stop(); other.stop();
  dropEndpoint(SVC.address);
  fresh();
});
