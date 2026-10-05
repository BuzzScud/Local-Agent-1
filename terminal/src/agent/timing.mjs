// Where a request's time goes (5 Oct 2026, the owner: "CAN WE BUILD #2?"). In the shootout's runs a model on
// a service spent about three quarters of its time on its replies, and with thinking off a short reply still
// took 60-80 s; nothing saved said whether the service was reading the conversation or writing. Now every
// model reply, every side call (the cases' list, the case review, the second look, the notes) and every tool
// run is one entry, and the bench keeps them with each run (bench/run.mjs) and adds them up.
//
// A reply from a service that says what it spent (Ollama's load_duration, prompt_eval_duration and
// eval_duration; llama.cpp's prompt_ms and predicted_ms): loading the model, reading the conversation
// (only what its cache does not hold, so a long read for few new tokens is the conversation read again),
// writing (thinking included), and what is left of the reply's time, waiting (behind other work on a shared
// service, or on the way). A reply with no such numbers (one cut short, the Claude API): the time to its
// first word, and writing after it.

const tenths = (secs) => Math.round(secs * 10) / 10;
const secsOf = (ms) => tenths(ms / 1000);

// One reply or side call. start and end: Date.now() values. fresh: the tokens added to the conversation since
// the model's last reply (the tool results and notes, not its own reply), all a perfect cache would read.
export function replyTiming({ kind = 'reply', what = null, start, end = Date.now(), firstToken = null, timings = null, out = 0, think = 0, thinkSecs = 0, fresh = null, cut = null }) {
  const secs = secsOf(end - start);
  const e = { kind, ...(what ? { what } : {}), start, secs, out, ...(fresh != null ? { fresh } : {}), ...(think ? { think, thinkSecs: tenths(thinkSecs) } : {}), ...(cut ? { cut } : {}) };
  if (Number.isFinite(timings?.prompt_ms) && Number.isFinite(timings?.predicted_ms)) {
    const load = secsOf(timings.load_ms ?? 0);
    const read = secsOf(timings.prompt_ms);
    const write = secsOf(timings.predicted_ms);
    return { ...e, prompt: timings.prompt_n ?? null, load, read, write, wait: Math.max(0, tenths(secs - load - read - write)) };
  }
  const before = firstToken ? Math.min(secs, secsOf(firstToken - start)) : secs;
  return { ...e, before, write: tenths(secs - before) };
}

// A tool's run.
export const toolTiming = ({ name, start, end = Date.now(), error = false }) => ({ kind: 'tool', name, start, secs: secsOf(end - start), ...(error ? { error: true } : {}) });

const sum = (xs, k) => tenths(xs.reduce((s, e) => s + (e[k] ?? 0), 0));

// The entries of a run added up. secs: the run's own time, of which the rest is the app's own work (its
// checks, reading files for the model, saving) and anything the entries do not cover.
export function timeOf(entries, secs) {
  const replies = entries.filter((e) => e.kind === 'reply');
  const calls = entries.filter((e) => e.kind === 'call');
  const tools = entries.filter((e) => e.kind === 'tool');
  const model = [...replies, ...calls];
  const byTool = {};
  for (const t of tools) byTool[t.name] = tenths((byTool[t.name] ?? 0) + t.secs);
  const cut = replies.filter((e) => e.cut);
  const t = {
    secs: tenths(secs),
    replies: replies.length, calls: calls.length, tools: tools.length,
    load: sum(model, 'load'), read: sum(model, 'read'), write: sum(model, 'write'), think: sum(model, 'thinkSecs'), wait: sum(model, 'wait'), before: sum(model, 'before'),
    callSecs: sum(calls, 'secs'), toolSecs: sum(tools, 'secs'),
    byTool: Object.fromEntries(Object.entries(byTool).sort((a, b) => b[1] - a[1])),
    cut: cut.length, cutSecs: sum(cut, 'secs'),
  };
  t.app = Math.max(0, tenths(secs - sum(model, 'secs') - t.toolSecs));
  return t;
}

const s = (n) => `${Math.round(n).toLocaleString('en-US')} s`;

// One line for a run's log: "time 1,500 s: writing 980 s (thinking 320 s), reading 210 s, …".
export function timeLine(t) {
  const tools = Object.entries(t.byTool).slice(0, 3).map(([name, secs]) => `${name} ${s(secs)}`).join(', ');
  const parts = [
    `writing ${s(t.write)}${t.think >= 1 ? ` (thinking ${s(t.think)})` : ''}`,
    `reading ${s(t.read)}`,
    ...(t.before >= 1 ? [`before the first word ${s(t.before)} (not split)`] : []),
    ...(t.wait >= 1 ? [`waiting ${s(t.wait)}`] : []),
    ...(t.load >= 1 ? [`loading ${s(t.load)}`] : []),
    `tools ${s(t.toolSecs)}${tools ? ` (${tools})` : ''}`,
    `the app ${s(t.app)}`,
  ];
  const calls = t.calls ? `; ${t.calls} side ${t.calls === 1 ? 'call' : 'calls'} ${s(t.callSecs)} of it` : '';
  const cut = t.cut ? `; ${t.cut} ${t.cut === 1 ? 'reply' : 'replies'} cut short and asked again (${s(t.cutSecs)})` : '';
  return `time ${s(t.secs)}: ${parts.join(', ')}${calls}${cut}`;
}

// The replies that read longest, with how much was new to read: "reply 14: 38 s reading, 2,140 new tokens
// of 61,200". A long read of few new tokens is the service reading the conversation again.
export function slowReads(entries, n = 3, min = 5) {
  const numbered = entries.filter((e) => e.kind === 'reply').map((e, i) => ({ ...e, n: i + 1 }));
  return numbered.filter((e) => (e.read ?? 0) >= min).sort((a, b) => b.read - a.read).slice(0, n)
    .map((e) => `reply ${e.n}: ${s(e.read)} reading${e.fresh != null ? `, ${e.fresh.toLocaleString('en-US')} new tokens` : ''}${e.prompt ? ` of ${e.prompt.toLocaleString('en-US')}` : ''}`);
}

// The entries as a run keeps them: when each started, in seconds from the run's start.
export const timelineFrom = (entries, t0) => entries.map(({ start, ...e }) => ({ at: tenths((start - t0) / 1000), ...e }));
