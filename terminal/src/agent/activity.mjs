// What a model on an Ollama service is doing, for the hub's Bonsai tab to show live (27 Oct 2026, the owner: "allow
// me to have it open, have agentic coder open and working, and the bonsai page updating live"). Every request to an
// Ollama service, from any window, `coding -p` run or side job, is recorded here, in the app's home, so the hub reads
// it whichever process runs the hub:
//   activity/now/<pid>-<n>.json   a request under way: its model, what asked (your conversation, a side job), when it
//                                 started, its phase (reading → thinking → writing) and the tokens so far, rewritten at
//                                 most every 700 ms and at each change of phase; removed when it ends
//   activity/requests.jsonl       one line a finished request: the service's own figures (read, written, loading) and
//                                 how it ended; kept to the newest REQUESTS_KEEP lines
// Nothing here may slow a request or fail it: every write is best effort.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME } from '../../../models/index.mjs';

export const activityDir = () => join(HOME, 'activity');
const nowDir = () => join(activityDir(), 'now');
const logFile = () => join(activityDir(), 'requests.jsonl');
const REQUESTS_KEEP = 400;
const NOW_EVERY_MS = 700;
let seq = 0;
let appended = 0;

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const writeNow = (st) => safe(() => {
  mkdirSync(nowDir(), { recursive: true });
  const f = join(nowDir(), `${st.id}.json`);
  writeFileSync(`${f}.tmp`, JSON.stringify(st));
  renameSync(`${f}.tmp`, f);
});
function append(line) {
  safe(() => {
    mkdirSync(activityDir(), { recursive: true });
    appendFileSync(logFile(), `${JSON.stringify(line)}\n`);
    // Kept short: every 50 lines, a file past twice the keep is cut to the newest REQUESTS_KEEP.
    if (++appended % 50 === 0 && statSync(logFile()).size > 600 * REQUESTS_KEEP) {
      const lines = readFileSync(logFile(), 'utf8').trim().split('\n');
      if (lines.length > REQUESTS_KEEP * 2) writeFileSync(logFile(), `${lines.slice(-REQUESTS_KEEP).join('\n')}\n`);
    }
  });
}

// The words of the request it answers (your last message), for the page's "working on" line.
const askOf = (messages) => {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    const t = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c) => c?.text ?? '').join(' ') : '';
    if (t.trim()) return t.replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  return '';
};

// The stream of one request, passed through unchanged, its progress written as it goes.
// who: 'conversation' (your conversation's own steps) or a side job's name (flows/llm.mjs `what`).
export async function* recorded(stream, { model, url, who, messages, tools = 0, think }) {
  const st = { id: `${process.pid}-${++seq}`, pid: process.pid, model, url, who: who ?? 'a side job', ask: who === 'conversation' ? askOf(messages) : '', tools, think: think ?? null,
    started: Date.now(), phase: 'reading', firstAt: null, thinkTok: 0, textTok: 0 };
  let last = 0;
  const save = (force) => { const t = Date.now(); if (force || t - last >= NOW_EVERY_MS) { last = t; writeNow(st); } };
  save(true);
  let end = 'stopped';
  try {
    for await (const ev of stream) {
      if (ev.type === 'reasoning') { const was = st.phase; st.phase = 'thinking'; st.firstAt ??= Date.now(); st.thinkTok++; save(was !== 'thinking'); }
      else if (ev.type === 'text' || ev.type === 'tool') { const was = st.phase; st.phase = 'writing'; st.firstAt ??= Date.now(); st.textTok++; save(was !== 'writing'); }
      else if (ev.type === 'done') {
        const t = ev.timings ?? {};
        end = ev.finish ?? 'stop';
        append({ at: new Date().toISOString(), pid: st.pid, model, who: st.who, ask: st.ask, tools, think: st.think, secs: (Date.now() - st.started) / 1000,
          readTok: t.prompt_n ?? null, readMs: t.prompt_ms ?? null, wroteTok: t.predicted_n ?? null, writeMs: t.predicted_ms ?? null, loadMs: t.load_ms ?? null,
          thinkTok: st.thinkTok, end });
      }
      yield ev;
    }
  } catch (e) {
    end = e?.name === 'AbortError' ? 'stopped' : 'error';
    append({ at: new Date().toISOString(), pid: st.pid, model, who: st.who, ask: st.ask, secs: (Date.now() - st.started) / 1000, end, error: String(e?.message ?? e).slice(0, 200) });
    throw e;
  } finally {
    safe(() => rmSync(join(nowDir(), `${st.id}.json`), { force: true }));
  }
}

// ---- reading it back (the hub) ----
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// The requests under way now, oldest first; a file left by a process that is gone is removed.
export function activeRequests({ model = null } = {}) {
  const out = [];
  for (const f of safe(() => readdirSync(nowDir())) ?? []) {
    if (!f.endsWith('.json')) continue;
    const st = safe(() => JSON.parse(readFileSync(join(nowDir(), f), 'utf8')));
    if (!st) continue;
    if (!alive(st.pid)) { safe(() => rmSync(join(nowDir(), f), { force: true })); continue; }
    if (model && st.model !== model) continue;
    out.push(st);
  }
  return out.sort((a, b) => a.started - b.started);
}
// The newest finished requests, newest first.
export function recentRequests({ model = null, limit = 40 } = {}) {
  const text = safe(() => readFileSync(logFile(), 'utf8')) ?? '';
  const out = [];
  const lines = text.trim().split('\n');
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const r = safe(() => JSON.parse(lines[i]));
    if (r && (!model || r.model === model)) out.push(r);
  }
  return out;
}
