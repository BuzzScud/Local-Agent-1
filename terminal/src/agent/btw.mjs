// /btw: a quick side question while Agentic Coder works, like Claude Code's.
// One question, one answer, no tools, and nothing added to the conversation.
// The model gets a copy of the whole conversation with long tool output cut
// (the side lane cannot reuse the main lane's reading: measured 28 Sep, a
// first side question re-read all 3,751 tokens), and answers on the side
// lane while the main job goes on in lane 0.
import { streamChat } from './client.mjs';

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
export function roomFor({ ctx, ctxUsed, busy, thinking }) {
  return Math.floor(ctx - ctxUsed - (busy ? (thinking ? 4096 : 2048) : 0) - ANSWER_TOKENS - MARGIN);
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

// Asks the side question on the side lane and streams the answer.
// Answers { text } or { noRoom: true }; throws on a server error; an abort
// (esc closed the panel) ends it quietly with what was written.
export async function askAside({ agent, question, live, signal, onText, now = Date.now() }) {
  const room = roomFor({ ctx: agent.ctx, ctxUsed: agent.ctxUsed, busy: agent.busy, thinking: agent.thinking });
  const messages = sideMessages({ messages: agent.messages, question, now: rightNow({ busy: agent.busy, live, todos: agent.todos, messages: agent.messages, now }), room });
  if (!messages) return { noRoom: true, room };
  let all = '';
  try {
    for await (const ev of streamChat({ url: agent.url, messages, model: agent.model, thinking: false, sampling: agent.model.sampling, maxTokens: ANSWER_TOKENS, slot: agent.slots?.side, signal })) {
      if (ev.type === 'text') { all += ev.text; onText?.(all); }
    }
  } catch (e) {
    if (signal?.aborted) return { text: all, aborted: true };
    throw e;
  }
  return { text: all.trim(), sent: messages };
}

// What "f" hands to the main job with your next message.
export const sendToMain = (question, answer) => `[While Agentic Coder worked, the user asked a side question with /btw and got this quick answer (it could not use tools, so check it before relying on it).\nQuestion: ${question}\nAnswer: ${answer}]`;
