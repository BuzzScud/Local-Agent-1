// /btw: a quick side question while Agentic Coder works, like Claude Code's.
// One question, one answer, no tools, and nothing added to the conversation.
// The model gets a copy of the whole conversation with long tool output cut
// (the side lane cannot reuse the main lane's reading: measured 28 Sep, a
// first side question re-read all 3,751 tokens), and answers on the side
// lane while the main job goes on in lane 0.
import { streamChat } from './client.mjs';
import { CLAUDE_MODELS, claudeName, ollamaCatalog, authHeaders } from '../../../models/index.mjs';
import { HELPER_CTX, HELPER_KEEP } from './helper-models.mjs';

const tokensOf = (s) => Math.ceil((s?.length ?? 0) / 3.6);

// Room in the answer, and kept free besides it in the shared memory pool.
export const ANSWER_TOKENS = 500;
const MARGIN = 256;
// Less room than this and the question is not sent: an answer this short
// would know too little, and two busy lanes overflowing the pool can fail
// the main job's request.
export const MIN_ROOM = 600;

export const BTW_SYSTEM = [
  'This is a side question from the user, asked with /btw while Agentic Coder (a coding assistant on their Mac) keeps working on the conversation below.',
  'Answer it directly, in one short reply: a few plain sentences or a short list.',
  // 3 Oct 2026, on a remote: asked "what are you doing right now?", a model began "I am not doing anything; I am a text-based AI".
  'In the question, "you" means Agentic Coder, and you answer as Agentic Coder, in the first person ("I am running the tests"): never speak about yourself as a separate assistant.',
  'You have NO tools: you cannot read files, run commands or change anything, and this is a one-off reply with no follow-up.',
  'Answer only from the conversation below, and be specific: name the files, commands, steps and numbers it shows. Never say you will do something or "let me check".',
  'If the conversation does not tell you, say so plainly. If you have to guess (how long something takes, especially), say it is a guess.',
].join(' ');

const text = (m) => (typeof m.content === 'string' ? m.content : m.content == null ? '' : JSON.stringify(m.content));
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
function cut(s, max) {
  if (s.length <= max) return s;
  const more = s.slice(max);
  const lines = more.split('\n').length - 1;
  return `${s.slice(0, max).replace(/\s+$/, '')} … (${lines > 1 ? `${lines} more lines` : `${more.length.toLocaleString()} more characters`} cut)`;
}

// The conversation as short lines, oldest first: what you asked, what it
// said, each tool it used, each result cut to a few lines. The system prompt
// and the tool list stay out (the side question needs neither).
export function conversationParts(messages, { maxOut = 400, maxText = 1500, maxArgs = 160 } = {}) {
  const parts = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      // An attached file (@path) is kept as its name only.
      const t = text(m).replace(/<file path="([^"]+)">[\s\S]*?<\/file>/g, '[attached file $1]');
      if (t.startsWith('[Automatic note from Agentic Coder')) parts.push(`(Agentic Coder's own note to itself: ${cut(oneLine(t.replace(/^\[Automatic note[^\]]*\]\s*/, '')), 300)})`);
      else if (/^\[The user (?:interrupted|ran)/.test(t)) parts.push(cut(t, maxOut));
      else parts.push(`User: ${cut(t.trim(), maxText)}`);
    } else if (m.role === 'assistant') {
      if (text(m).trim()) parts.push(`Agentic Coder: ${cut(text(m).trim(), maxText)}`);
      for (const c of m.tool_calls ?? []) {
        let args = c.function?.arguments ?? '';
        try { const a = JSON.parse(args); args = a.path ?? a.command ?? a.pattern ?? a.query ?? JSON.stringify(a); } catch {}
        parts.push(`Agentic Coder used ${c.function?.name ?? 'a tool'}(${cut(oneLine(String(args)), maxArgs)})`);
      }
    } else if (m.role === 'tool') parts.push(`  Result: ${cut(text(m).trim(), maxOut)}`);
  }
  return parts;
}

// The request being worked on and the steps taken for it so far.
const isRequest = (m) => m.role === 'user' && !/^\[(?:Automatic note|The user (?:interrupted|ran))/.test(text(m));
function stepsSoFar(messages = []) {
  let at = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (isRequest(messages[i])) { at = i; break; }
  if (at < 0) return null;
  const calls = messages.slice(at + 1).flatMap((m) => m.tool_calls ?? []).map((c) => {
    let a = c.function?.arguments ?? '';
    try { const j = JSON.parse(a); a = j.path ?? j.command ?? j.pattern ?? j.query ?? ''; } catch {}
    return `${c.function?.name ?? 'a tool'}(${cut(oneLine(String(a)), 80)})`;
  });
  return { request: cut(oneLine(text(messages[at]).replace(/<file path="([^"]+)">[\s\S]*?<\/file>/g, '[attached file $1]')), 300), calls };
}

// What Agentic Coder is doing right now, from the screen's live state.
export function rightNow({ busy, live, todos, messages, now = Date.now() } = {}) {
  const lines = [];
  const steps = busy ? stepsSoFar(messages) : null;
  if (steps) {
    lines.push(`The request it is working on: "${steps.request}"`);
    lines.push(steps.calls.length ? `Steps taken for it so far (${steps.calls.length}): ${steps.calls.slice(-12).join(' → ')}` : 'No steps taken for it yet.');
  }
  if (busy && live?.phase === 'working') {
    const secs = Math.max(0, Math.round((now - (live.turnStart ?? now)) / 1000));
    const took = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
    let s = `Right now Agentic Coder is still working on the last request (${took} so far)`;
    if (live.flowStep) s += `, on step ${live.flowStep.index + 1} of ${live.flowStep.count}: ${live.flowStep.text}`;
    if (live.running) s += `, running ${live.running.label}(${cut(oneLine(String(live.running.arg ?? '')), 120)})`;
    else if (live.tries) s += `, on try ${live.tries.n} of up to ${live.tries.max}`;
    else if (live.text) s += ', writing its reply';
    else if (live.thinking) s += ', thinking';
    lines.push(`${s}.`);
  } else lines.push('Right now Agentic Coder is idle, waiting for the user.');
  if (todos?.length) {
    lines.push('Its to-do list:');
    for (const t of todos) lines.push(`  ${t.status === 'done' ? '[done]' : t.status === 'in_progress' ? '[doing now]' : '[to do]'} ${oneLine(t.text ?? t.content ?? '')}`);
  }
  return lines.join('\n');
}

// Tokens the side question may use: the pool, less what the conversation
// holds (and the room for its reply while it is writing one), the answer and
// a margin. Lane 1's other jobs never overlap it: the server runs one
// request per lane and makes the next one wait.
export function roomFor({ ctx, ctxUsed, busy, thinking, budget = 2048 }) {
  return Math.floor(ctx - ctxUsed - (busy ? (thinking ? 2048 + budget : 2048) : 0) - ANSWER_TOKENS - MARGIN);
}

// The messages for the side question, cut to fit `room` tokens: the oldest
// part of the conversation goes first. null when not even the question fits.
export function sideMessages({ messages, question, now, room }) {
  if (room < MIN_ROOM) return null;
  const parts = conversationParts(messages);
  const tail = `${now}\n\nThe side question: ${question}`;
  const fixed = tokensOf(BTW_SYSTEM) + tokensOf(tail) + 40;
  let budget = room - fixed;
  if (budget < 0) return null;
  const kept = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const t = tokensOf(parts[i]) + 1;
    if (t > budget) break;
    kept.unshift(parts[i]);
    budget -= t;
  }
  const dropped = parts.length - kept.length;
  const head = kept.length || !parts.length
    ? `The conversation so far (long outputs are cut${dropped ? `; its first ${dropped} part${dropped === 1 ? ' is' : 's are'} left out to fit` : ''}):`
    : 'The conversation is too long to include here; only what is happening right now is known.';
  const body = kept.length ? `\n\n${kept.join('\n')}` : parts.length ? '' : '\n\n(nothing yet)';
  return [
    { role: 'system', content: BTW_SYSTEM },
    { role: 'user', content: `${head}${body}\n\n${tail}` },
  ];
}

// ---- on a remote (3 Oct 2026) ------------------------------------------------------------------
// The owner's picks: /btw works only on a remote. There the lowest model answers when the service
// has it ready, else the main one, which is loaded already. Measured that day on their Ollama
// service: the loaded 36B answered in 1.7 s; the lowest (3B, 2 GB) and the next one up never
// loaded beside it (the main model is kept there for ever); and a question asked while the main
// model wrote a reply was answered the moment that reply ended (one request at a time).

// Tokens of the conversation a side question on a remote carries at most: its own request, not a
// share of the main one's memory, but a long copy is slow to read.
export const SIDE_COPY = 12_000;
// How long the lowest model may take over its first word, the one time a session it is tried cold.
const TRY_MS = 8000;
// After this long with no word from a busy main model, the panel says what it waits for.
const WAIT_NOTE_MS = 3000;

const weights = (p) => { const m = /([\d.]+)\s*([MB])/i.exec(String(p ?? '')); return m ? Number(m[1]) * (m[2].toUpperCase() === 'B' ? 1e9 : 1e6) : 0; };
// The service's models that can take a side question, smallest first: they chat, are not
// embedders or picture readers (those see but call no tools), and have a billion weights at least.
export function lowModels(models = [], main) {
  return models.filter((m) => m.id !== main && m.chat !== false && !m.embedding && !(m.vision && !m.tools) && weights(m.params) >= 1e9)
    .sort((x, y) => (x.bytes || 0) - (y.bytes || 0));
}
// Who answers on an Ollama service: { model (null: the main one), why }.
//   ready  a smaller model the service has loaded now (the smallest of them)
//   try    the lowest, or the one /subagents names for side jobs, not loaded: tried once a session
//   main   the main model: nothing smaller is ready, and the one try did not load
// tried: null not yet this session, true it loaded, false it would not.
export function sideChoice({ models = [], main, picked = null, tried = null }) {
  const mainBytes = models.find((m) => m.id === main)?.bytes || Infinity;
  const low = lowModels(models, main).filter((m) => !m.bytes || m.bytes < mainBytes);
  const want = (picked && picked !== main && models.find((m) => m.id === picked)) || low[0] || null;
  const ready = [want, ...low].find((m) => m?.loaded);
  if (ready) return { model: ready.id, why: 'ready' };
  if (want && tried !== false) return { model: want.id, why: 'try' };
  return { model: null, why: 'main' };
}
// The Claude API's lowest model (its cheapest), or null when the main one is it already.
export function lowestClaude(main) {
  const low = [...CLAUDE_MODELS].sort((x, y) => (x.price.in + x.price.out) - (y.price.in + y.price.out))[0];
  return low && low.id !== main ? low.id : null;
}

// One answer, streamed. firstMs: no first word by then ends it as { timedOut: true }.
async function stream({ agent, messages, use, signal, onText, firstMs = 0 }) {
  const stop = new AbortController();
  const both = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  let all = '';
  let late = false;
  const t = firstMs ? setTimeout(() => { if (!all) { late = true; stop.abort(); } }, firstMs) : null;
  try {
    for await (const ev of streamChat({ url: agent.url, messages, model: agent.model, thinking: false, sampling: agent.model.sampling, maxTokens: ANSWER_TOKENS, slot: agent.slots?.side, signal: both, use })) {
      if (ev.type === 'text') { all += ev.text; onText?.(all); }
    }
  } catch (e) {
    if (late) return { timedOut: true };
    if (signal?.aborted) return { text: all, aborted: true };
    throw e;
  } finally { clearTimeout(t); }
  return late && !all ? { timedOut: true } : { text: all.trim() };
}

// Asks the side question and streams the answer. Answers { text, who } or { noRoom: true };
// throws on a server error; an abort (esc closed the panel) ends it quietly with what was written.
// remote: null on a model server with a side lane (this Mac's with --url --slots 2, or your other
// computer's): the question goes down that lane, with a share of the one memory. On a service:
// { kind, ollama, main, models (the service's list, when the app has it), picked (the
// model /subagents names for side jobs), memo (kept by the app for the session: { tried }) }.
// onNote(text): what the panel says while it waits (who is asked, what holds the answer up).
export async function askAside({ agent, question, live, signal, onText, onNote, remote = null, now = Date.now(), tryMs = TRY_MS, waitNoteMs = WAIT_NOTE_MS }) {
  const right = rightNow({ busy: agent.busy, live, todos: agent.todos, messages: agent.messages, now });
  if (!remote) {
    const room = roomFor({ ctx: agent.ctx, ctxUsed: agent.ctxUsed, busy: agent.busy, thinking: agent.thinking, budget: agent.model?.thinkingBudget });
    const messages = sideMessages({ messages: agent.messages, question, now: right, room });
    if (!messages) return { noRoom: true, room };
    const r = await stream({ agent, messages, use: agent.btwUse ? agent.btwUse() : agent.sideUse?.(), signal, onText });
    return { ...r, sent: messages };
  }
  // A request of its own on the service: the copy is cut to what reads quickly, not to a shared memory.
  const messages = sideMessages({ messages: agent.messages, question, now: right, room: Math.min((agent.ctx || 32_768) - ANSWER_TOKENS - MARGIN, SIDE_COPY) });
  if (!messages) return { noRoom: true };
  // The main model by its own name (the app's label for it carries the service's address).
  const mainName = remote.kind === 'claude' ? claudeName(remote.main) : remote.main ?? remote.mainName ?? 'the main model';
  let use;
  let who = mainName;
  if (remote.kind === 'claude') {
    const low = lowestClaude(remote.main);
    if (low) { use = { model: low }; who = claudeName(low); }
  } else if (remote.ollama) {
    // What the service has, with what it has loaded now.
    let models = remote.models ?? [];
    try {
      if (!models.length) models = (await ollamaCatalog({ url: agent.url, signal, timeoutMs: 4000 }))?.models ?? [];
      const ps = await fetch(`${agent.url.replace(/\/+$/, '')}/api/ps`, { headers: authHeaders(agent.url), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000) }).then((r) => r.json());
      const up = new Map((ps.models ?? []).map((m) => [m.name, m]));
      models = models.map((m) => ({ ...m, loaded: up.has(m.id), loadedCtx: up.get(m.id)?.context_length ?? null }));
    } catch { if (signal?.aborted) return { text: '', aborted: true }; }
    const memo = remote.memo ?? {};
    const pick = sideChoice({ models, main: remote.main, picked: remote.picked, tried: memo.tried ?? null });
    const entry = models.find((m) => m.id === pick.model);
    // A model the service has loaded is asked at the context it is loaded at (another would load
    // it again) and its own keep-alive is left as it is; one tried cold is kept half an hour.
    const useOf = (cold) => ({ model: entry.id, numCtx: cold ? HELPER_CTX.side : entry.loadedCtx || HELPER_CTX.side, thinks: Boolean(entry.thinking), tools: entry.tools !== false, family: entry.family ?? '', keepAlive: cold ? HELPER_KEEP : undefined });
    if (pick.why === 'ready') { use = useOf(false); who = entry.id; }
    else if (pick.why === 'try') {
      onNote?.(`Asking ${entry.id}, the lowest model there…`);
      const r = await stream({ agent, messages, use: useOf(true), signal, onText, firstMs: tryMs });
      if (!r.timedOut) { memo.tried = true; return { ...r, who: entry.id, sent: messages }; }
      memo.tried = false; // not again this session: the service did not load it beside the main model
      onNote?.(`${entry.id} is not ready on the service; ${mainName} answers…`);
    }
  }
  // The main model on an Ollama service, which takes one request at a time: asked mid-reply, it
  // waits its turn (the Claude API and the hosted services answer beside the main reply).
  const note = !use && remote.ollama && agent.busy
    ? setTimeout(() => onNote?.(`${mainName} is busy with its reply: this answers when that ends…`), waitNoteMs) : null;
  try {
    const r = await stream({ agent, messages, use, signal, onText: (all) => { clearTimeout(note); onText?.(all); } });
    return { ...r, who, sent: messages };
  } finally { clearTimeout(note); }
}

// What "f" hands to the main job with your next message.
export const sendToMain = (question, answer) => `[While Agentic Coder worked, the user asked a side question with /btw and got this quick answer (it could not use tools, so check it before relying on it).\nQuestion: ${question}\nAnswer: ${answer}]`;
