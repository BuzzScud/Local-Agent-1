// Step 2 in one place, in the order the agent takes it (agent.mjs send):
// a greeting, "update memory", a line that continues the last turn, the
// question first, then the kind. Words only: no files are read and no model is
// called, so it says where a request goes and whether the model is asked
// before work starts. The sort test runs every real request through it.
import { routeByRules, isSmallTalk } from './index.mjs';
import { needsClarifying, wantsWhere } from './clarify.mjs';
import { isQuit, isFollowUp, sortLine } from './words.mjs';
import { isMemoryRequest } from '../agent/memory.mjs';

// { path, ask, line }
//   path: quit · chat · memory · follow-up · rename · fix · change · question · other · unsorted (the model sorts it)
//   ask:  null · fixed (a set question) · model (the model is asked whether it is clear) · where
export function sortOf(text, { hasPrior = false } = {}) {
  const t = String(text).trim();
  if (isQuit(t)) return { path: 'quit', ask: null, line: null };
  if (isSmallTalk(t)) return { path: 'chat', ask: null, line: null };
  if (isMemoryRequest(t)) return { path: 'memory', ask: null, line: null };
  if (isFollowUp(t, hasPrior)) return { path: 'follow-up', ask: null, line: sortLine('follow-up') };
  const c = needsClarifying(t);
  const ask = c === 'fix' ? 'fixed' : c === 'model' ? 'model' : wantsWhere(t) ? 'where' : null;
  const kind = routeByRules(t)?.kind;
  return { path: kind ?? 'unsorted', ask, line: kind ? sortLine(kind, { shortcut: true }) : null };
}
