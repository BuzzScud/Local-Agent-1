// Shared instruction editor. Project files and permission enforcement stay separate.
import { DEFAULT_INSTRUCTIONS, INSTRUCTION_LIMITS, instructionFile, readInstructions, saveInstructions, focusedInstructions } from '../agent/instructions.mjs';
import { projectNotes, systemPrompt, gitSummary, isHomeFolder } from '../agent/prompt.mjs';
import { toolSchemas } from '../agent/tools.mjs';
import { TOP, recall, recallNotes, looksLikeEvent } from '../agent/recall.mjs';
import { memoryDirs, readFacts } from '../agent/facts.mjs';
import { MODELS, DEFAULT_MODEL, thinkingKwargs, Embedder, embedderReady, EMBEDDERS, DEFAULT_EMBEDDER, Reranker, rerankerReady, RERANKERS } from '../../../models/index.mjs';
import { loadSettings } from './store.mjs';
import { readLimits } from './limits.mjs';
import { howChosen } from '../agent/search.mjs';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
// What the model receives besides the system prompt, read from the same code the agent runs.
function seesData(cwd, prompt, focused) {
  let facts = [];
  try { const dirs = memoryDirs(cwd); facts = [...readFacts(dirs.you), ...readFacts(dirs.project)].filter((f) => !f.always && !looksLikeEvent(f.text)); } catch { /* a memory that cannot be read is left out */ }
  return {
    folder: { path: cwd, isHome: isHomeFolder(cwd) },
    // Prompt parts the focused calls do not get, found by comparing the two.
    focusedLeftOut: ['Tool use', 'Fixing a bug', 'Rules', 'This session'].filter((h) => prompt.includes(`\n${h}\n`) && !focused.includes(`\n${h}\n`)),
    tools: toolSchemas(),
    recall: { top: TOP, example: recallNotes([{ kind: 'you', text: 'a saved fact that fits your request' }]), total: facts.length,
      facts: facts.slice(0, 25).map((f) => ({ kind: f.kind, text: f.text.replace(/\s+/g, ' ').slice(0, 240) })) },
    // Per thinking level: what the template is sent and the reply limit (the agent's replyRoom: 2,048, plus the thinking budget when thinking is on).
    models: Object.values(MODELS).map((m) => ({ id: m.id, name: m.name, budget: m.thinkingBudget ?? null, sampling: m.sampling ?? null, thinkingSampling: m.thinkingSampling ?? null,
      effortDial: (m.thinkingLevels ?? []).filter((l) => l.effort).length > 1,
      levels: (m.thinkingLevels ?? []).map((l) => ({ ...l, kwargs: thinkingKwargs(m, Boolean(l.effort), l.effort), replyLimit: l.effort ? 2048 + (m.thinkingBudget ?? 2048) : 2048 })) })),
  };
}

export function instructionsData(cwd, home) {
  const saved = readInstructions(home);
  const notes = projectNotes(cwd);
  const prompt = systemPrompt({ cwd, notes: notes.text, git: gitSummary(cwd), instructions: saved.sections });
  const focused = focusedInstructions(prompt);
  return { sections: saved.sections, revision: saved.revision, updatedAt: saved.updatedAt, customized: saved.customized,
    undoCount: saved.history.length, defaults: DEFAULT_INSTRUCTIONS, limits: INSTRUCTION_LIMITS,
    file: instructionFile(home), cwd, sources: notes.files, context: notes.text,
    preview: prompt, focusedPreview: focused, sees: seesData(cwd, prompt, focused) };
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
    attached: r.facts.map(row), near: (r.near ?? []).map(row), goesAlong: recallNotes(r.facts) };
}

export async function instructionsRoute(req, url, cwd, home) {
  // Reject cross-site reads/writes and DNS rebinding, even on this loopback server.
  if (url.hostname !== '127.0.0.1' || (req.headers.get('origin') && req.headers.get('origin') !== url.origin)
      || ['cross-site', 'same-site'].includes(req.headers.get('sec-fetch-site'))) return json({ error: 'Open the editor from this local hub.' }, 403);
  try {
    if (url.pathname === '/instructions.json' && req.method === 'GET') return json(instructionsData(cwd, home));
    if (['/instructions/save', '/instructions/undo', '/instructions/recall'].includes(url.pathname) && req.method === 'POST') {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')) return json({ error: 'Send JSON.' }, 415);
      const reader = req.body?.getReader();
      if (!reader) return json({ error: 'Provide instructions and a revision.' }, 400);
      const chunks = []; let size = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 80_000) { await reader.cancel(); return json({ error: 'Request is too large.' }, 413); } chunks.push(value); }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json({ error: 'The request body is not valid JSON.' }, 400); }
      if (!data || typeof data !== 'object') return json({ error: 'Provide instructions and a revision.' }, 400);
      if (url.pathname === '/instructions/recall') return json(await tryRequest(cwd, data.request));
      saveInstructions(data.sections, data.revision, { home, undo: url.pathname.endsWith('/undo') });
      return json(instructionsData(cwd, home));
    }
    return json({ error: 'Not found.' }, 404);
  } catch (e) { return json({ error: e.message }, e.status ?? 500); }
}
