// Runs one prompt start to finish without the terminal UI: used by the
// practice-task runner and by `coding -p "…"`.
import { Agent } from './agent/agent.mjs';
import { applyLimits } from './app/limits.mjs';
import { systemPrompt, projectNotes, gitSummary, SESSION_MARK } from './agent/prompt.mjs';
import { toolSchemas } from './agent/tools.mjs';
import { warmUp, Embedder, embedderReady } from '../../models/index.mjs';
import { openMemory } from './agent/facts.mjs';
import { saveLessons, worthSaving } from './agent/lessons.mjs';

// memory: true uses the memory (facts brought back, lessons saved when the
// run ends); { home, embedder, save } sets where it lives and how. Off by
// default, so a practice run is the same every time. save: 'after' leaves
// the save to the caller (the result's save()), for a run whose files are
// checked first.
export async function runHeadless({ prompt, cwd, url, model, thinking, effort, ctx, autoApprove = false, approve, answers, signal, onEvent = () => {}, flows = true, slots, warm = false, memory = false, limits = null, rank = true }) {
  // memory.claude: true (or a folder) also brings Claude's notes that fit a request.
  const mem = memory ? { embedder: embedderReady() ? new Embedder() : null, save: true, ...(memory === true ? {} : memory) } : null;
  if (mem) { try { openMemory(cwd, { home: mem.home }); } catch { /* the run goes on without it */ } }
  // Files ranked by meaning before the first step (agent/rank.mjs), as in the
  // app with the memory on; rank: false leaves it to the request's words.
  const ranker = rank && !mem?.embedder && embedderReady() ? new Embedder() : null;
  const system = systemPrompt({ cwd, notes: projectNotes(cwd, 6000, { memory: Boolean(mem), home: mem?.home }).text, git: gitSummary(cwd) });
  const agent = new Agent({
    url, model, cwd, system, thinking, effort, ctx, mode: autoApprove ? 'edits' : 'ask', flows: flows !== false, slots, memory: mem, ranker,
    // Starting over from its notes: the instructions come back from their saved reading.
    rewarm: warm && slots ? (sig) => warmUp({ sessionMark: SESSION_MARK, url, model, system: agent.messages[0].content, tools: toolSchemas(), thinking, effort: agent.effort, slot: slots.main, signal: sig }) : undefined,
    // approve(req) → false says no to one request even when auto-approving.
    // answers(question, req) → the reply to one of Agentic Coder's questions (null = no answer);
    // set answers.steers = true to also answer its plans (req.kind 'plan') and check-ins ('checkin').
    ask: async (req) => {
      if (req.name === 'Ask') {
        // A plan to confirm or a check-in goes to answers only when it steers
        // (answers.steers = true); otherwise the plan is approved and the
        // check-in carries on, as when no one is watching.
        // A "stuck" question with no one to steer is skipped: the run goes on as
        // before (the old limits stop it), so practice results stay comparable.
        if (req.kind === 'stuck' && !answers?.steers) return { choice: 'skip' };
        const steering = req.kind === 'plan' || req.kind === 'checkin' || req.kind === 'stuck';
        if (steering && !answers?.steers) return autoApprove ? { choice: 'answer', text: req.kind === 'plan' ? 'yes' : 'keep going' } : { choice: 'no' };
        const text = answers ? await answers(req.args.question, req) : null;
        if (text != null) return { choice: 'answer', text: String(text) };
        return autoApprove ? { choice: 'answer', text: 'I do not know. If the files do not tell you, stop and tell me what you found; do not invent anything.' } : { choice: 'no' };
      }
      return { choice: autoApprove && (!approve || approve(req)) ? 'yes' : 'no' };
    },
  });
  // The limits /increase saved (coding -p passes them; the practice bench does not).
  if (limits) applyLimits(agent, limits);
  // coding -p started the server itself: restore (or read) the instructions first.
  if (warm && slots) await warmUp({ sessionMark: SESSION_MARK, url, model, system, tools: toolSchemas(), thinking, effort: agent.effort, slot: slots.main, signal }).catch(() => {});
  const log = [];
  let finalText = '';
  for (const type of ['assistant', 'tool', 'note', 'todos', 'compacted', 'tries-done', 'route', 'sorted', 'memory', 'context', 'settled']) {
    agent.on(type, (ev) => {
      log.push({ type, ...ev, at: Date.now() });
      if (type === 'assistant' && ev.final) finalText = ev.text;
      onEvent(type, ev);
    });
  }
  // The turn's own counts (steps, reads, thinking): the last turn-end wins.
  let counts = {};
  agent.on('turn-end', (ev) => { counts = ev; });
  const t0 = Date.now();
  const reason = await agent.send(prompt, { signal });
  const secs = (Date.now() - t0) / 1000;
  // What the run taught goes into the memory before it ends.
  let saved = null;
  const save = async () => {
    if (!mem || !worthSaving(agent.lessons)) return null;
    try { return await saveLessons({ url, model, slot: slots?.side, cwd, home: mem.home, lessons: agent.lessons, messages: agent.messages, embedder: mem.embedder }); } catch { return null; /* a save that fails never fails the run */ }
  };
  if (mem?.save === true && !signal?.aborted) { saved = await save(); if (saved) onEvent('saved', saved); }
  if (mem?.embedder && !memory?.embedder) await mem.embedder.stop({ keep: true }).catch(() => {});
  if (ranker) await ranker.stop({ keep: true }).catch(() => {});
  return {
    saved, save, lessons: agent.lessons,
    reason, finalText, log, messages: agent.messages, secs,
    steps: log.filter((e) => e.type === 'tool').length,
    asked: log.filter((e) => e.type === 'tool' && e.label === 'Ask').map((e) => ({ question: String(e.arg), answer: e.view?.text ?? null })),
    toolErrors: log.filter((e) => e.type === 'tool' && e.error).length,
    outTokens: agent.stats.outTokens, tps: agent.stats.tps, ctxUsed: agent.ctxUsed,
    replies: counts.steps ?? 0, reads: counts.reads ?? 0, readFirst: counts.readFirst ?? 0, thinkTokens: counts.thinkTokens ?? 0, stuckAsks: counts.stuckAsks ?? 0,
  };
}
