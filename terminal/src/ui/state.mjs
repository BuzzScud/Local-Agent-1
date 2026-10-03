// What the screen should show at time t (seconds) of a recorded session.
// Pure: the live runner and the preview builder both call it.

const progress = (t, a, b) => (b <= a ? 1 : Math.min(1, Math.max(0, (t - a) / (b - a))));

function toolArg(step) {
  return step.args.path ?? step.args.command;
}

export function stateAt(session, t) {
  const steps = session.steps;
  const s = {
    t, items: [], active: null, permission: null, todos: null, activeTodo: 0,
    mode: 'ask', typed: '', turnStart: null, outTokens: 0, ctx: session.systemTokens ?? 0,
    phase: 'idle', doneAt: null, speed: null, todoSecs: [],
  };
  let lastOut = 0;
  for (const st of steps) {
    if (t < st.t0) break;
    const done = t >= st.t1;
    if (st.todo !== undefined) s.activeTodo = st.todo;
    if (st.todo !== undefined || st.kind !== 'user') {
      const i = st.todo ?? s.activeTodo;
      s.todoSecs[i] = (s.todoSecs[i] ?? 0) + (Math.min(t, st.t1) - st.t0);
    }
    const p = progress(t, st.t0, st.t1);
    const genEnd = st.tCall ?? st.t1;
    const genTokens = st.tokens ? Math.round(st.tokens * progress(t, st.t0, genEnd)) : 0;
    s.outTokens = lastOut + genTokens;
    if (done) { lastOut = st.out ?? lastOut; s.ctx = st.ctx; }

    switch (st.kind) {
      case 'user':
        if (done) { s.items.push({ key: 'u', type: 'user', text: st.text }); s.turnStart = st.t1; s.phase = 'working'; }
        else s.typed = st.text.slice(0, Math.floor(st.text.length * p));
        break;
      case 'prefill':
        if (!done) { s.active = { type: 'prefill', verb: st.verb }; s.speed = 'in'; }
        break;
      case 'think':
      case 'text':
      case 'final': {
        const secs = st.t1 - st.t0;
        if (done) {
          s.items.push({ key: `s${st.t0}`, type: st.kind === 'think' ? 'thinking' : st.kind, text: st.text, secs, tokens: st.tokens });
          if (st.kind === 'final') { s.phase = 'done'; s.doneAt = st.t1; }
        } else {
          s.active = { type: st.kind === 'think' ? 'thinking' : st.kind, verb: st.verb, text: st.text.slice(0, Math.floor(st.text.length * p)), secs: t - st.t0, tokens: genTokens };
          s.speed = 'out';
        }
        break;
      }
      case 'todos':
        if (t >= st.tResult) s.todos = st.items;
        if (done) s.items.push({ key: `td${st.t0}`, type: 'todos', items: st.items });
        else if (t < st.tResult) { s.active = { type: 'todos-writing', verb: st.verb, tokens: genTokens, total: st.tokens }; s.speed = 'out'; }
        else { s.active = { type: 'prefill', verb: st.verb }; s.speed = 'in'; }
        break;
      case 'tool': {
        const base = { tool: st.tool, arg: toolArg(st), step: st };
        const perm = st.permission;
        const askEnd = perm ? st.tAsk + perm.wait : st.tCall;
        if (t < st.tCall) {
          s.active = { type: 'tool-writing', verb: st.verb, ...base, tokens: genTokens, total: st.tokens };
          s.speed = 'out';
        } else if (perm && t < askEnd) {
          const settled = t >= askEnd - 0.8 ? perm.choice : 0;
          s.permission = { ...base, selected: settled, choice: perm.choice };
          s.phase = 'waiting';
          s.speed = null;
        } else if (t < st.tResult) {
          s.active = { type: 'tool-running', verb: st.verb, ...base };
          s.speed = null;
        } else {
          if (perm && perm.choice === 1 && st.tool === 'Update') s.mode = 'edits';
          s.items.push({ key: `t${st.t0}`, type: 'tool', ...base, result: st.result, secs: st.tResult - st.t0 });
          if (!done) { s.active = { type: 'prefill', verb: st.verb }; s.speed = 'in'; }
        }
        if (perm && t >= askEnd && perm.choice === 1 && st.tool === 'Update') s.mode = 'edits';
        if (s.phase === 'waiting' && !(perm && t < askEnd)) s.phase = 'working';
        break;
      }
    }
    if (s.phase === 'waiting' && !s.permission) s.phase = 'working';
  }
  if (s.permission) s.phase = 'waiting';
  else if (s.doneAt === null && s.turnStart !== null) s.phase = 'working';
  s.turnSecs = s.turnStart === null ? 0 : (s.doneAt ?? t) - s.turnStart;
  return s;
}

// Moments worth a marker on the preview's timeline.
export function markers(session) {
  const out = [];
  for (const st of session.steps) {
    if (st.kind === 'user') out.push({ t: st.t0, label: 'You ask' });
    if (st.kind === 'think') out.push({ t: st.t0, label: 'Thinks' });
    if (st.kind === 'tool') out.push({ t: st.permission ? st.tAsk : st.t0, label: st.permission ? `${st.tool} · asks you` : st.tool });
    if (st.kind === 'final') out.push({ t: st.t1, label: 'Done' });
  }
  return out;
}
