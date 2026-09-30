// Shared instruction editor. Project files and permission enforcement stay separate.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_INSTRUCTIONS, INSTRUCTION_LIMITS, INSTRUCTION_START, INSTRUCTION_END, instructionFile, instructionHome, readInstructions, saveInstructions, focusedInstructions } from '../agent/instructions.mjs';
import { projectNotes, systemPrompt, gitSummary, isHomeFolder, SESSION_MARK, NOTES_RANK, promptVersion, notesRoom } from '../agent/prompt.mjs';
import { isDesignRequest, pickCards, designNotes, designSettings, designDir, readCards, mixTurn, STYLES, styleWords } from '../agent/design.mjs';
import { toolSchemas } from '../agent/tools.mjs';
import { wayPrompt } from '../agent/way.mjs';
import { TOP, recall, recallNotes, looksLikeEvent } from '../agent/recall.mjs';
import { memoryDirs, readFacts } from '../agent/facts.mjs';
import { MODELS, DEFAULT_MODEL, thinkingKwargs, Embedder, embedderReady, EMBEDDERS, DEFAULT_EMBEDDER, Reranker, rerankerReady, RERANKERS } from '../../../models/index.mjs';
import { loadSettings, saveSettings } from './store.mjs';
import { readLimits } from './limits.mjs';
import { howChosen } from '../agent/search.mjs';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
// What the model receives besides the system prompt, read from the same code the agent runs.
function seesData(cwd, prompt, focused, way = 'app') {
  let facts = [];
  try { const dirs = memoryDirs(cwd); facts = [...readFacts(dirs.you), ...readFacts(dirs.project)].filter((f) => !f.always && !looksLikeEvent(f.text)); } catch { /* a memory that cannot be read is left out */ }
  return {
    folder: { path: cwd, isHome: isHomeFolder(cwd) },
    // Prompt parts the focused calls do not get, found by comparing the two.
    focusedLeftOut: ['Tool use', 'Work habits', 'Fixing a bug', 'Rules', 'This session'].filter((h) => prompt.includes(`\n${h}\n`) && !focused.includes(`\n${h}\n`)),
    tools: toolSchemas(way),
    recall: { top: TOP, example: recallNotes([{ kind: 'you', text: 'a saved fact that fits your request' }]), total: facts.length,
      facts: facts.slice(0, 25).map((f) => ({ kind: f.kind, text: f.text.replace(/\s+/g, ' ').slice(0, 240) })) },
    // Per thinking level: what the template is sent and the reply limit (the agent's replyRoom: 2,048, plus the thinking budget when thinking is on).
    models: Object.values(MODELS).map((m) => ({ id: m.id, name: m.name, budget: m.thinkingBudget ?? null, sampling: m.sampling ?? null, thinkingSampling: m.thinkingSampling ?? null,
      effortDial: (m.thinkingLevels ?? []).filter((l) => l.effort).length > 1,
      levels: (m.thinkingLevels ?? []).map((l) => ({ ...l, kwargs: thinkingKwargs(m, Boolean(l.effort), l.effort), replyLimit: l.effort ? 2048 + (m.thinkingBudget ?? 2048) : 2048 })) })),
  };
}

// The folders the preview can be shown for: the hub's own, the home folder, and
// the ones Agentic Coder was used in (its history, newest first) or trusted.
export function knownFolders(cwd, { home = homedir(), state = instructionHome() } = {}) {
  const out = [cwd, home];
  try {
    const lines = readFileSync(join(state, 'history.jsonl'), 'utf8').trim().split('\n').reverse();
    for (const l of lines) { try { const c = JSON.parse(l).cwd; if (c) out.push(c); } catch {} }
  } catch {}
  try { out.push(...Object.keys(JSON.parse(readFileSync(join(state, 'trust.json'), 'utf8')))); } catch {}
  const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  return [...new Set(out)].filter((p) => typeof p === 'string' && p.startsWith('/') && isDir(p)).slice(0, 12)
    .map((path) => ({ path, name: path === home ? '~ (home folder)' : path.replace(home, '~') }));
}

// Reading speed on this Mac, measured 29 Sep 2026 (server.log): 120–200 tokens a second.
export const READ_SPEED = 150;
const estimate = (text) => Math.ceil((text?.length ?? 0) / 3.6);

// The prompt cut into the parts it is built from, in order: where each comes
// from, where it is changed, and how it is kept. kept: 'disk' = before
// "This session", saved once and restored in under a second at every start;
// 'folder' = saved with this folder, day and git state, read again when one
// changes. side: also copied into each focused (side) call.
export function promptParts(prompt, sources) {
  const at = (h, from = 0) => prompt.indexOf(h, from);
  const cuts = [];
  const add = (id, name, group, start, from, extra = {}) => { if (start >= 0) cuts.push({ id, name, group, start, from, ...extra }); };
  add('opening', 'Opening lines', 'built', 0, 'Built in');
  const block = at(INSTRUCTION_START);
  add('general', 'General', 'yours', block, 'Tab 01, yours to edit', { edit: 'general', side: true });
  add('planning', 'Planning', 'yours', at('\n\nPlanning\n', block) + 2, 'Tab 02, yours to edit', { edit: 'planning', side: true });
  const end = at(INSTRUCTION_END);
  add('tooluse', 'Tool use', 'built', at('\nTool use\n', end) + 1, 'Built in');
  add('habits', 'Work habits', 'built', at('\nWork habits\n', end) > 0 ? at('\nWork habits\n', end) + 1 : -1, 'Built in (new 30 Sep: how Opus and Fable work)');
  add('example', 'Worked example', 'built', at('\nExample of good work', end) > 0 ? at('\nExample of good work', end) + 1 : -1, 'Built in (AGENTIC_EXAMPLE=1)');
  add('bugs', 'Fixing a bug', 'built', at('\nFixing a bug\n', end) > 0 ? at('\nFixing a bug\n', end) + 1 : -1, 'terminal/rules/bug-fixing.md');
  add('rules', 'Rules', 'built', at('\nRules\n', end) + 1, 'Built in (the app enforces them)');
  const session = at(SESSION_MARK, end);
  add('session', 'This session', 'session', session, 'The date, Git and the test command');
  const notesAt = at('\nProject notes\n', session);
  if (notesAt >= 0) {
    const rank = at(NOTES_RANK, notesAt);
    add('notes-head', rank >= 0 ? 'Which notes win' : 'Project notes', 'notes', notesAt + 1, 'Built in', { side: true });
    for (const [i, s] of (sources ?? []).entries()) {
      // The memory comes after every file, so its heading is the last "Memory" line.
      if (s.kind === 'memory') { add('memory', 'Memory', 'memory', prompt.lastIndexOf('\nMemory\n') + 1, s.path, { side: true }); continue; }
      if (s.status === 'left') continue;
      add(`note-${i}`, s.name, 'notes', at(`From ${s.name}`, notesAt), s.label, { side: true, status: s.status });
    }
  }
  cuts.sort((a, b) => a.start - b.start);
  return cuts.map((c, i) => {
    const text = prompt.slice(c.start, cuts[i + 1]?.start ?? prompt.length);
    return { id: c.id, name: c.name, group: c.group, from: c.from, edit: c.edit ?? null, side: Boolean(c.side), status: c.status ?? null,
      kept: c.start < session || session < 0 ? 'disk' : 'folder', start: c.start, chars: text.length, tokens: estimate(text), text };
  });
}

// Exact token counts from the model server when one is up (its own tokenizer),
// else the estimate the agent uses (3.6 characters a token); and, from its chat
// template, whether the tools sit before "This session" (kept on disk with the
// rest) or after it. Tests replace measure.
export const tokenHooks = {
  async measure(texts, { prompt, tools, state = instructionHome(), signal = AbortSignal.timeout(1500) } = {}) {
    let server = null;
    try {
      for (const f of readdirSync(join(state, 'servers')).filter((x) => x.endsWith('.json'))) {
        const s = JSON.parse(readFileSync(join(state, 'servers', f), 'utf8'));
        if (s.port && s.model && !/bge|rerank|embed|minilm/i.test(s.model)) { server = s; break; }
      }
    } catch {}
    if (!server) return null;
    const by = server.model.replace(/\.gguf$/i, '');
    // `coding serve` running here asks for its key (models/runtime/serve.mjs).
    let auth = {};
    try { if (server.serve?.keyFile) auth = { authorization: `Bearer ${readFileSync(server.serve.keyFile, 'utf8').split('\n')[0].trim()}` }; } catch {}
    const post = async (path, body) => (await fetch(`http://127.0.0.1:${server.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify(body), signal })).json();
    try {
      const counts = await Promise.all(texts.map(async (content) => (await post('/tokenize', { content })).tokens.length));
      let toolsKept = null;
      try {
        const t = (await post('/apply-template', { messages: [{ role: 'system', content: prompt }, { role: 'user', content: 'hi' }], tools })).prompt;
        const tool = t.indexOf(tools[0].function.description.slice(0, 40)), mark = t.indexOf(SESSION_MARK);
        if (tool >= 0 && mark >= 0) toolsKept = tool < mark ? 'disk' : 'folder';
      } catch {}
      return { counts, by, toolsKept };
    } catch { return { counts: null, by, busy: true }; } // up, but it did not answer in time (it may be writing a reply)
  },
};

export function instructionsData(cwd, home, { folder } = {}) {
  const saved = readInstructions(home);
  const folders = knownFolders(cwd);
  const here = folder && folders.some((f) => f.path === folder) ? folder : cwd;
  const notes = projectNotes(here);
  const settings = settingsHooks.load(here);
  const model = MODELS[settings.model] ?? MODELS[DEFAULT_MODEL];
  // The prompt and tools of the way /effort's Who decides row is on (agent/way.mjs).
  const way = readLimits(settings, model).way ?? 'app';
  const prompt = wayPrompt(systemPrompt({ cwd: here, notes: notes.text, git: gitSummary(here), instructions: saved.sections }), way);
  const focused = focusedInstructions(prompt);
  const tools = toolSchemas(way);
  const parts = [...promptParts(prompt, notes.sources), { id: 'tools', name: `Tools (${tools.length})`, group: 'tools', from: 'Sent with every request, apart from the text', edit: null, side: false, status: null, kept: 'unknown', start: null, chars: JSON.stringify(tools).length, tokens: estimate(JSON.stringify(tools)), text: JSON.stringify(tools) }];
  return { sections: saved.sections, revision: saved.revision, updatedAt: saved.updatedAt, customized: saved.customized,
    undoCount: saved.history.length, defaults: DEFAULT_INSTRUCTIONS, limits: INSTRUCTION_LIMITS,
    file: instructionFile(home), cwd: here, hubFolder: cwd, folders, sources: notes.files, notes: notes.sources, context: notes.text,
    version: promptVersion(), notesRoom: notesRoom(), rank: NOTES_RANK,
    preview: prompt, focusedPreview: focused, sees: seesData(here, prompt, focused, way), way,
    cost: { parts, context: readLimits(settings, model).context ?? null, model: model?.name ?? '', speed: READ_SPEED, tokenizer: null },
    design: designInfo(here) };
}

// The saved settings, as the design style reads and saves them. Tests replace
// both: settings.json's place is fixed when models/index.mjs is first imported,
// so a test file could otherwise write the real one.
export const settingsHooks = { load: (cwd) => loadSettings(cwd), save: (patch) => saveSettings(patch) };

// The design cards as the hub shows them: the style, the sets and their looks.
function designInfo(cwd) {
  const s = designSettings(settingsHooks.load(cwd).design);
  const { dir, sets } = readCards(designDir());
  return { style: s.style, styles: STYLES.map((id) => ({ id, words: styleWords(id) })), on: s.auto, dir: dir ? dir.replace(homedir(), '~') : null,
    fromEnv: Boolean(process.env.AGENTIC_DESIGN_STYLE),
    sets: sets.map((x) => ({ name: x.name, kinds: x.cards.filter((c) => !c.look && !c.always).length, looks: x.cards.filter((c) => c.look).map((c) => c.file.split('/').pop().replace(/^look-|\.md$/gi, '')) })) };
}

// The data with exact token counts when the model server can count them.
async function withTokens(data) {
  const parts = data.cost.parts;
  const r = await tokenHooks.measure(parts.map((p) => p.text), { prompt: data.preview, tools: data.sees.tools }).catch(() => null);
  if (r?.counts?.length === parts.length) { parts.forEach((p, i) => { p.tokens = r.counts[i]; }); data.cost.tokenizer = r.by; }
  else if (r?.busy) data.cost.busy = r.by;
  const tools = parts.find((p) => p.id === 'tools');
  if (tools) tools.kept = r?.toolsKept ?? 'unknown';
  for (const p of parts) delete p.text;
  return data;
}

// The small matching model, as the agent uses it. It is not started until the first search; the model server
// then keeps it loaded for 30 minutes and shares it with any other window. Tests replace this.
let embedder;
let reranker;
export const recallHooks = {
  embedder: () => (embedder ??= embedderReady() ? new Embedder() : null),
  // /effort's Search rows as the app saved them, and the reranker they name (started at its first use).
  search: (cwd) => readLimits(loadSettings(cwd), MODELS[DEFAULT_MODEL]),
  reranker: (id) => (reranker?.model?.id === id ? reranker : (reranker = RERANKERS[id] && rerankerReady(RERANKERS[id]) ? new Reranker(RERANKERS[id]) : null)),
};

// "Try a request": which saved facts would be attached to it, found the way the agent finds them.
// mark: false, so trying a request never counts as using a fact.
async function tryRequest(cwd, text) {
  const request = String(text ?? '').trim().slice(0, 1000);
  if (!request) throw Object.assign(new Error('Type a request first.'), { status: 400 });
  const model = EMBEDDERS[DEFAULT_EMBEDDER];
  // Found the way the agent finds them: with /effort's Search rows (Embedder, Retriever, Reranker).
  const s = recallHooks.search(cwd);
  const off = s.embedder === 'off';
  const r = await recall(cwd, request, { embedder: off ? null : recallHooks.embedder(), retriever: s.retriever, reranker: s.reranker !== 'off' ? recallHooks.reranker(s.reranker) : null, signal: AbortSignal.timeout(60_000), mark: false, near: 3 });
  const rows = off ? 'Embedder is Off in /effort, so by words.' : r.chosen && (r.chosen.order === 'hybrid' || r.chosen.reranked) ? `/effort's Search rows: chosen ${howChosen(r.chosen, r.how)}.` : null;
  const row = (f) => ({ kind: f.kind, text: f.text.replace(/\s+/g, ' ').slice(0, 240), close: f.close });
  return { request, how: r.how, ms: r.ms, note: [rows, r.note].filter(Boolean).join(' ') || null, cut: r.how === 'meaning' ? model.cut : null,
    attached: r.facts.map(row), near: (r.near ?? []).map(row), goesAlong: recallNotes(r.facts), design: designTry(cwd, request) };
}

// "Try a request": the design cards that would go along, found the way the
// agent finds them. Under mix it only peeks at whose turn it is.
export function designTry(cwd, request) {
  const s = designSettings(settingsHooks.load(cwd).design);
  const page = isDesignRequest(request);
  if (!s.auto || !page) return { page, on: s.auto, style: s.style, cards: [] };
  const style = s.style === 'mix' ? mixTurn({ peek: true }) : s.style;
  const pick = pickCards(request, { sets: s.sets, style });
  const notes = designNotes(pick);
  return { page, on: true, style: s.style, turn: s.style === 'mix' ? style : null, cards: notes ? notes.cards.map((c) => c.file) : [],
    example: pick.examples[0]?.file ?? null, look: pick.look?.file ?? null, more: pick.more.map((c) => c.file), tokens: notes ? estimate(notes.text) : 0 };
}

export async function instructionsRoute(req, url, cwd, home, { onDesign } = {}) {
  // Reject cross-site reads/writes and DNS rebinding, even on this loopback server.
  if (url.hostname !== '127.0.0.1' || (req.headers.get('origin') && req.headers.get('origin') !== url.origin)
      || ['cross-site', 'same-site'].includes(req.headers.get('sec-fetch-site'))) return json({ error: 'Open the editor from this local hub.' }, 403);
  try {
    const folder = url.searchParams.get('folder') || undefined;
    if (url.pathname === '/instructions.json' && req.method === 'GET') return json(await withTokens(instructionsData(cwd, home, { folder })));
    if (['/instructions/save', '/instructions/undo', '/instructions/recall', '/instructions/design-style'].includes(url.pathname) && req.method === 'POST') {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')) return json({ error: 'Send JSON.' }, 415);
      const reader = req.body?.getReader();
      if (!reader) return json({ error: 'Provide instructions and a revision.' }, 400);
      const chunks = []; let size = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 80_000) { await reader.cancel(); return json({ error: 'Request is too large.' }, 413); } chunks.push(value); }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json({ error: 'The request body is not valid JSON.' }, 400); }
      if (!data || typeof data !== 'object') return json({ error: 'Provide instructions and a revision.' }, 400);
      const at = data.folder && knownFolders(cwd).some((f) => f.path === data.folder) ? data.folder : cwd;
      if (url.pathname === '/instructions/recall') return json(await tryRequest(at, data.request));
      if (url.pathname === '/instructions/design-style') {
        if (!STYLES.includes(data.style)) return json({ error: `The styles: ${STYLES.join(', ')}.` }, 400);
        // Saved like /design style: in settings.json, and told to the running app.
        const next = { ...(settingsHooks.load().design ?? {}), style: data.style };
        settingsHooks.save({ design: next });
        onDesign?.(next);
        return json({ design: designInfo(at) });
      }
      saveInstructions(data.sections, data.revision, { home, undo: url.pathname.endsWith('/undo') });
      return json(await withTokens(instructionsData(cwd, home, { folder: at })));
    }
    return json({ error: 'Not found.' }, 404);
  } catch (e) { return json({ error: e.message }, e.status ?? 500); }
}
