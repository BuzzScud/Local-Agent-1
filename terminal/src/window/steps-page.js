// The window's timeline (27 Oct 2026, the owner's pick "7 · Smooth" of five rounds of designs, private:
// docs/private/design rounds/agentic-coder-window-steps-v5-2026-10-27.html). Each part of a reply is a box: the model's
// line (or the to-do it moved on to) over a timeline of every step in it, thinking, tool calls, what it writes and the
// app's own steps, each its coloured verb (tools blue, thinking violet, writing sand, the app grey, a failure red), when it
// started, what it was on, how it went and how long it took; a click opens it in place. The part under way says in one
// row what it is doing and for how long, its plan under it, and what streams shows its newest five lines with a time bar.
// Every part, line and message keeps its element: only what changed is written, and what is new slides in.
// server.mjs puts this file into ui.html; it uses the page's own esc, md, itemHtml, plural, SPIN, STILL, S and render.
(() => {
  const FAM = { tools: '#7fb2e5', think: '#b7a2f2', write: '#e2c08d', app: '#7d8794', fail: 'var(--bad)' };
  const fam = (d) => (d.err || d.k === 'error' ? FAM.fail : d.k === 'think' ? FAM.think : d.k === 'said' || d.k === 'writing' ? FAM.write : d.k === 'note' || d.k === 'machine' ? FAM.app : FAM.tools);
  const TESTY = /\b(test|tests|pytest|vitest|jest|lake build|check)\b/;
  const base = (p) => String(p ?? '').split('/').pop();
  const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const plain = (t) => String(t ?? '').replace(/\*\*|__|`/g, '').replace(/^\s*(\d+\.|[-*•])\s+/gm, '').replace(/\s+/g, ' ').trim();
  const firstSentence = (t) => plain(t).split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)[0] ?? '';
  const dur = (ms) => { if (ms == null || ms < 0) return ''; const s = ms / 1000; return s < 10 ? s.toFixed(1) + ' s' : s < 60 ? Math.round(s) + ' s' : Math.floor(s / 60) + 'm ' + String(Math.round(s % 60)).padStart(2, '0') + 's'; };
  const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const ktok = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n ?? 0));
  const now = () => Date.now() - (S.skew || 0);
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h + ':' + s.length; };
  const isCall = (d) => !['think', 'said', 'note', 'machine'].includes(d.k);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  // what is opened (a step, a source list), what is folded (a part, a long answer opened), kept for this window
  const opened = new Set(), shut = new Set(), unfolded = new Set();
  let tailOpen = true;
  try { tailOpen = localStorage.getItem('think-open') !== '0'; } catch {}

  // ---- a step in words ----
  function verbOf(d) {
    if (d.err || d.k === 'error') return ['Failed', (d.label ? d.label + ' · ' : '') + (d.message || d.arg || '')];
    switch (d.k) {
      case 'think': return ['Thought', firstSentence(d.text)];
      case 'said': return [String(d.text).length > 300 ? 'Wrote' : 'Said', plain(d.text)];
      case 'note': return ['App', d.text];
      case 'machine': return ['App', 'gave it ' + [d.notes?.length ? plural(d.notes.length, d.notes.every((n) => n.from === 'memory') ? 'memory fact' : 'note') : '', d.design?.length ? plural(d.design.length, 'design card') : ''].filter(Boolean).join(' and ')];
      case 'read': case 'same': return [/^SKILLS\//.test(d.arg) ? 'Skill' : /^RULES\//.test(d.arg) ? 'Guide' : 'Reading', d.arg];
      case 'search': return ['Searching', d.arg];
      case 'list': return ['Listing', d.arg];
      case 'diff': return [d.created ? 'Writing' : 'Editing', d.path];
      case 'bash': case 'job': return [TESTY.test(d.arg) ? 'Testing' : 'Running', d.arg];
      case 'todos': return ['Planning', plural((d.items ?? []).length, 'to-do') + ' · ' + (d.items ?? []).filter((t) => t.done).length + ' done'];
      case 'answer': return ['Asking you', d.question];
      case 'websearch': return ['Web search', d.query ? '“' + d.query + '”' : 'the query was not saved'];
      case 'fetched': return ['Fetched', d.url];
      default: return [d.label || d.k, d.arg ?? d.text ?? ''];
    }
  }
  // the step under way, from the app's live state: what it does now and since when
  const LABEL_VERB = { Read: 'Reading', Search: 'Searching', Grep: 'Searching', List: 'Listing', Edit: 'Editing', Write: 'Writing', WebSearch: 'Searching the web', WebFetch: 'Fetching', TodoWrite: 'Planning', Ask: 'Asking you', Agent: 'Asking a helper' };
  function liveStepOf(L) {
    const since = L.stepStart ?? L.turnStart ?? now();
    // the answer once it comes (the thought before it is still in the live state until the reply ends)
    if (L.text) return { key: 'live', k: 'said', text: L.text, since: L.textStart ?? since, verb: ['Writing', ''] };
    if (L.thinking) return { key: 'live', k: 'think', text: L.thinking, tokens: L.thinkTokens ?? 0, since: L.thinkStart ?? since, verb: ['Thinking', ''] };
    if (L.writing) return { key: 'live', k: 'writing', since, verb: ['Writing', L.writing.path ? base(L.writing.path) : L.writing.name === 'Edit' ? 'an edit' : L.writing.name ? 'a ' + L.writing.name + ' call' : ''] };
    if (L.running) { const lb = L.running.label ?? ''; return { key: 'live', k: 'tool', since, verb: [lb === 'Bash' ? (TESTY.test(L.running.arg) ? 'Testing' : 'Running') : LABEL_VERB[lb] ?? lb, L.running.arg ?? ''] }; }
    if (L.task) return { key: 'live', k: 'tool', since, verb: ['Working', L.task] };
    return { key: 'live', k: 'wait', since, verb: ['Waiting', L.waiting ? 'for the model to read what is new' : ''] };
  }
  function resultOf(d) {
    if (d.k === 'diff') return '<span class="add">+' + d.add + '</span> <span class="del">−' + d.del + '</span>';
    if (d.tests) return d.tests.failed ? '<span class="bad">✗ ' + d.tests.failed + '</span>' : '<span class="ok">✓ ' + d.tests.passed + '</span>';
    if ((d.k === 'bash' || d.k === 'job') && d.code) return '<span class="bad">exit ' + d.code + '</span>';
    if (d.k === 'search' && !d.count) return '<span class="dim">none</span>';
    if (d.k === 'websearch') return '<span class="dim">' + plural(d.sources?.length || d.count || 0, 'source') + '</span>';
    return '';
  }
  // what opens under a step: the change with its line numbers, the command and what it printed (the failing lines red),
  // the thought as written, what the app gave the model
  const HOT = (l) => /\b(fail(ed|ures?|ing)?|errors?|✗|not ok|Traceback|exception)\b/i.test(l) && !/\b(fail(ed|ures?)?|errors?)\W{0,3}0\b|\b0\s+(fail(ed|ures?)?|errors?)\b/i.test(l);
  function detailHtml(d) {
    if (d.k === 'think') return '<div class="dt"><div class="prose md">' + md(String(d.text).replace(/^[ \t]+/gm, '')) + '</div></div>';
    if (d.k === 'said' || d.k === 'note') return '<div class="dt"><div class="prose">' + esc(d.text) + '</div></div>';
    if (d.k === 'machine') return '<div class="dt">' + (d.notes ?? []).map((n) => '<div class="memo"><span class="chip7">' + esc(n.from) + ' · ' + n.tokens + ' tokens</span> ' + esc(n.text) + '</div>').join('') + (d.design?.length ? '<div class="memo"><span class="chip7">design cards</span> ' + d.design.map(esc).join(', ') + '</div>' : '') + '</div>';
    if (d.k === 'diff') return '<div class="dt"><div class="diff">' + (d.hunk ?? []).map(([t, o, n, x]) => '<div class="' + (t === '+' ? 'add' : t === '-' ? 'del' : '') + '"><span class="n">' + (t === '-' ? o ?? '' : n ?? '') + '</span><span class="t">' + esc(x) + '</span></div>').join('') + (d.more ? '<div><span class="n"></span><span class="t dim">… ' + d.more + ' more lines</span></div>' : '') + '</div></div>';
    if (d.k === 'bash' || d.k === 'job') {
      const line = (l) => '<div' + (HOT(l) ? ' class="hot"' : '') + '>' + esc(l) + '</div>';
      const out = (d.head ?? []).map(line).join('') + ((d.tail ?? []).length ? (d.n > d.head.length + d.tail.length ? '<div class="gap">… ' + (d.n - d.head.length - d.tail.length) + ' lines between …</div>' : '') + d.tail.map(line).join('') : '');
      return '<div class="dt"><div class="cmd">' + esc(d.arg) + '</div>' + (d.n ? '<div class="out">' + out + '</div>' : '') + '</div>';
    }
    if (d.k === 'todos') return '<div class="dt">' + (d.items ?? []).map((t) => '<div class="todo' + (t.done ? ' done' : t.now ? ' now' : '') + '">' + (t.done ? '✓' : t.now ? '▸' : '○') + ' ' + esc(t.text) + '</div>').join('') + '</div>';
    if (d.k === 'answer') return '<div class="dt"><div class="prose">' + esc(d.question) + '</div><div class="ans">→ ' + esc(d.answer || '(no answer kept)') + '</div></div>';
    if (d.content?.length) return '<div class="dt"><div class="out">' + d.content.map((l) => '<div>' + esc(l) + '</div>').join('') + '</div></div>';
    if (d.message) return '<div class="dt"><div class="cmd bad">' + esc(d.message) + '</div></div>';
    return '<div class="dt"><div class="cmd">' + esc(d.arg || d.url || '') + '</div></div>';
  }

  // ---- a line of the timeline ----
  const pos = (s) => Math.min(1, Math.log10(1 + Math.max(0, s)) / Math.log10(301));
  // the time bar in the line under way while it thinks or writes: it fills with the seconds on a scale that slows
  // (10 s under half, 1 min about three quarters, 5 min full), with what came so far beside it
  function barHtml(d) {
    const secs = (now() - d.since) / 1000;
    const so = d.k === 'think' ? d.tokens ?? 0 : String(d.text ?? '').split(/\s+/).filter(Boolean).length;
    const rate = d.k === 'think' && secs > 0.5 && so ? Math.round(so / secs) : null;
    return '<span class="tx bar7w"><span class="bar7"><i style="width:' + (pos(secs) * 100).toFixed(1) + '%"></i>' + [10, 30, 60, 300].map((t) => '<b style="left:' + (pos(t) * 100).toFixed(1) + '%"></b>').join('') + '</span><span class="bv">' + (d.k === 'think' ? ktok(so) + ' tokens' + (rate ? ' · ' + rate + '/s' : '') : plural(so, 'word')) + '</span></span>';
  }
  // what streams: its newest words, at most five whole lines, starting at a whole word
  function tailHtml(d) {
    let t = d.k === 'said' ? String(d.text ?? '') : plain(d.text);
    if (t.length > 700) { t = t.slice(-700); t = '… ' + t.slice(t.search(/\s/) + 1); }
    return '<div class="tail7' + (d.k === 'said' ? ' w' : '') + '"><div>' + esc(t) + '<span class="caret7"></span></div></div>';
  }
  function lineHtml(d, t0, live) {
    const [vb, tg] = live ? d.verb : verbOf(d);
    const mid = live && (d.k === 'think' || d.k === 'said') ? barHtml(d) : '<span class="tx">' + esc(cut(d.k === 'diff' || live ? tg : tg, 220)) + '</span>';
    const took = live ? dur(now() - d.since) : dur(d.ms);
    return '<div class="l7' + (d.err || d.k === 'error' ? ' err' : '') + (live ? ' live' : '') + (d.k === 'note' || d.k === 'machine' ? ' app' : '') + '" ' + (live ? 'data-tail7="1"' : 'data-r7="' + esc(d.key) + '"') + ' style="--c:' + fam(d) + '"><span class="at">' + (d.at && t0 ? mmss(d.at - t0) : '') + '</span><span class="tg">' + esc(vb) + '</span>' + mid + '<span class="rs">' + (live ? '' : resultOf(d)) + '</span><span class="du">' + took + '</span></div>';
  }
  // the lines of a part: each step (opened, its result under it), a web search's sources, the step under way
  function linesOf(p, t0, ls) {
    const out = [];
    // the model's line, when a move in its plan names the part
    if (p.line) out.push([p.key + '#said', lineHtml({ key: p.key + '#said', k: 'said', text: p.line }, t0, false)]);
    for (const k of p.keys) {
      const d = S.steps[k];
      if (!d) continue;
      if (d.k === 'websearch') {
        out.push([k, lineHtml(d, t0, false)]);
        const all = opened.has(k), n = (d.sources ?? []).length, show = all ? n : Math.min(n, 4);
        for (const [i, s] of (d.sources ?? []).slice(0, show).entries()) out.push([k + '#' + i, '<a class="src7" href="' + esc(s.url) + '" target="_blank" rel="noopener"><span class="fav">' + esc((host(s.url)[0] ?? '·').toUpperCase()) + '</span><span class="host">' + esc(host(s.url)) + '</span><span class="st">' + esc(s.title || s.url) + '</span>' + (s.age ? '<span class="age">' + esc(s.age) + '</span>' : '') + '</a>']);
        if (n > 4) out.push([k + '#more', '<div class="srcmore" data-r7="' + esc(k) + '">' + (all ? 'Show fewer' : '+ ' + plural(n - 4, 'more source')) + '</div>']);
        continue;
      }
      out.push([k, lineHtml(d, t0, false) + (opened.has(k) ? '<div class="det7">' + detailHtml(d) + '</div>' : '')]);
    }
    if (ls) out.push(['live', lineHtml(ls, t0, true) + (tailOpen && (ls.k === 'think' || ls.k === 'said') ? tailHtml(ls) : '')]);
    return out;
  }

  // ---- a part ----
  function partHead(p, n, live, turn) {
    const ds = p.keys.map((k) => S.steps[k]).filter(Boolean), acts = ds.filter(isCall);
    const title = (p.plan ? '<span class="pl7">▸</span> ' : '') + (p.said && p.title ? esc(p.title) : '<span class="g">' + esc(cut(p.title || (acts[0] ? verbOf(acts[0]).join(' ') : 'Part ' + n), 160)) + '</span>');
    if (live) {
      const ls = live, [vb, tg] = ls.verb, fails = turn.steps.filter((d) => d.err || d.k === 'error').length;
      return '<div class="hd7"><span class="no"><span class="ac">' + (STILL.matches ? '⠿' : SPIN[Math.floor(now() / 120) % 10]) + '</span></span><span class="ti">' + title + '<span class="nw7" style="--c:' + fam(ls) + '"><span class="vb">' + esc(vb) + '</span>' + (tg ? ' <span class="tg">' + esc(cut(tg, 90)) + '</span>' : '') + ' <span class="t">' + dur(now() - ls.since) + '</span></span></span><span class="oc">' + turn.steps.filter(isCall).length + ' calls · ' + ktok(turn.think + (ls.k === 'think' ? ls.tokens ?? 0 : 0)) + ' thinking' + (fails ? ' · <span class="bad">' + fails + ' failed</span>' : '') + '</span><span class="tm"><b>' + dur(now() - (turn.start ?? now())) + '</b></span></div>';
    }
    const files = {}; for (const d of acts) if (d.k === 'diff') { const f = files[base(d.path)] ??= { a: 0, r: 0 }; f.a += d.add; f.r += d.del; }
    const names = Object.keys(files), test = acts.filter((d) => d.tests).pop(), fails = acts.filter((d) => d.err || d.k === 'error').length;
    const oc = [names.length ? '<span class="ed">' + esc(names.length === 1 ? names[0] : names.length + ' files') + ' <span class="add">+' + names.reduce((s, x) => s + files[x].a, 0) + '</span> <span class="del">−' + names.reduce((s, x) => s + files[x].r, 0) + '</span></span>' : '', test ? (test.tests.failed ? '<span class="bad">✗ ' + test.tests.failed + ' failed</span>' : '<span class="ok">✓ ' + test.tests.passed + ' passed</span>') : '', fails ? '<span class="bad">' + plural(fails, 'failed step') + '</span>' : ''].filter(Boolean).join('');
    const ms = ds.reduce((s, d) => s + (d.ms ?? 0), 0);
    return '<div class="hd7" data-o7="' + esc(p.key) + '"><span class="no">' + n + '</span><span class="ti">' + title + '</span><span class="oc">' + oc + '</span><span class="tm">' + (ms ? dur(ms) : '') + '</span></div>';
  }
  function planOf(turn) {
    const last = turn.steps.filter((d) => d.k === 'todos').pop();
    if (!last) return '';
    const i = (last.items ?? []).findIndex((t) => !t.done);
    return '<div class="plan7">' + (last.items ?? []).map((t, j) => '<span class="' + (t.done ? 'done' : j === i ? 'now' : '') + '">' + (t.done ? '✓' : j === i ? '▸' : '○') + ' ' + esc(cut(t.text, 48)) + '</span>').join('') + '</div>';
  }

  // ---- kept elements ----
  const COPY = '<button class="cp7" data-copy7 title="Copy"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.5" y="5.5" width="8.5" height="8.5" rx="2"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/></svg></button>';
  // Copy in the top corner of a code block, a command's output, a change and an opened thought, inside its box
  function addCopy(root) {
    for (const el of root.querySelectorAll('pre, .dt .out, .dt .diff, .dt .prose.md')) {
      if (el.parentElement?.classList.contains('cpw')) continue;
      const w = document.createElement('div'); w.className = 'cpw'; el.replaceWith(w); w.append(el); w.insertAdjacentHTML('beforeend', COPY);
    }
  }
  function write(el, html) { const h = hash(html); if (el.dataset.h !== h) { el.innerHTML = html; el.dataset.h = h; addCopy(el); } }
  const made = (cls, key, quiet) => { const el = document.createElement('div'); el.className = cls + (quiet ? '' : ' enter7'); el.dataset.k = key; return el; };
  function place(box, el, prev) { if ((prev ? prev.nextSibling : box.firstChild) !== el) box.insertBefore(el, prev ? prev.nextSibling : box.firstChild); return el; }
  function partInto(el, p, n, t0, live, turn, quiet) {
    // a finished part that nothing changed in is left as it is
    const sig = live ? null : [p.key, p.keys.length, n, t0, shut.has(p.key), p.keys.filter((k) => opened.has(k)).join(','), p.keys.filter((k) => !S.steps[k]).length].join('|');
    if (sig && el.dataset.sig === sig) return;
    el.dataset.sig = sig ?? '';
    if (!el.firstChild) el.innerHTML = '<div class="hd7w"></div><div class="fold7"><div class="in7"><div class="live7"><div class="li7"></div></div><div class="tl7"></div></div></div>';
    el.classList.add('ch7');
    el.classList.toggle('live', Boolean(live));
    el.classList.toggle('shut', !live && shut.has(p.key));
    write(el.querySelector('.hd7w'), partHead(p, n, live, turn));
    if (live) write(el.querySelector('.li7'), planOf(turn)); // when the part ends its plan stays while it folds away
    const tl = el.querySelector('.tl7'), have = new Map([...tl.children].map((x) => [x.dataset.k, x]));
    let prev = null;
    for (const [k, html] of linesOf(p, t0, live)) {
      const x = have.get(k) ?? made('s7', k, quiet);
      write(x, html);
      prev = place(tl, x, prev);
      have.delete(k);
    }
    for (const x of have.values()) x.remove();
  }
  // a message: an answer that pastes a whole file folds to its first lines; the end line counts tool calls
  function itemOf(v) {
    if (v.t === 'text') {
      const block = Math.max(0, ...[...String(v.text).matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1].split('\n').length));
      if (block >= 25) { const open = unfolded.has(v.key), n = String(v.text).split('\n').length; return '<div class="reply reply7' + (open ? ' open' : '') + '"><div class="rb">' + md(v.text) + '</div><button class="more7" data-fold7="' + esc(v.key) + '">' + (open ? 'Show less' : 'Show all · ' + plural(n, 'line')) + '</button></div>'; }
    }
    if (v.t === 'done' && v.calls != null) return itemHtml({ ...v, steps: 0 }, null, null).replace(/<\/div>$/, ' · ' + plural(v.calls, 'tool call') + '</div>');
    return itemHtml(v, null, null);
  }

  // ---- the conversation ----
  let drawnOnce = false;
  // list: the printed items; st: the state (its held part, the live state); box: #items
  function draw(list, st, box) {
    const working = st?.live?.phase === 'working';
    const held = working ? st.held : null;
    const blocks = [];
    for (const v of list) {
      if (v.t === 'taskend') continue;
      if (v.t === 'taskrun' && v.parts) { for (const p of v.parts) blocks.push({ part: p }); continue; }
      blocks.push({ item: v });
    }
    let ls = null;
    if (working) {
      ls = liveStepOf(st.live);
      if (held?.t === 'live' && held.parts) { let live = false; for (const p of held.parts) { blocks.push({ part: p, live: Boolean(p.now) }); live ||= Boolean(p.now); } if (!live) blocks.push({ part: { key: 'p:live', title: held.line ?? '', said: Boolean(held.line), keys: [] }, live: true }); }
      else if (held) blocks.push({ old: true });
      else blocks.push({ part: { key: 'p:live', title: '', said: false, keys: [] }, live: true });
    }
    // the turns: each part numbered within its turn, its times from the turn's start, the turn's own counts
    let turn = null, lastUser = -1;
    blocks.forEach((b, i) => { if (b.item?.t === 'user') lastUser = i; });
    const turns = [];
    blocks.forEach((b, i) => {
      if (b.item?.t === 'user' || !turn) { turn = { n: 0, start: null, steps: [], think: 0 }; turns.push(turn); }
      b.turn = turn;
      if (b.part) {
        b.n = ++turn.n;
        for (const k of b.part.keys) { const d = S.steps[k]; if (!d) continue; turn.steps.push(d); if (d.k === 'think') turn.think += d.tokens ?? 0; turn.start ??= d.at ?? null; }
      }
      // a turn that ended started where its end line says (so its times read as they did while it worked)
      if (b.item?.t === 'done' && b.item.at > 0 && b.item.secs != null) turn.start = b.item.at - b.item.secs * 1000;
      if (working && i > lastUser) turn.start = st.live.turnStart ?? turn.start;
    });
    const have = new Map([...box.children].map((el) => [el.dataset.k, el]));
    const fresh = !drawnOnce || blocks.filter((b) => !have.has(b.part ? b.part.key : b.item ? 'i:' + b.item.key : 'old')).length > 6;
    drawnOnce = true;
    let prev = null;
    for (const b of blocks) {
      let el;
      if (b.part) {
        const key = b.part.key;
        el = have.get(key);
        // the part under way keeps its box when its first step comes and its key becomes that step's
        if (!el && b.live) el = have.get('p:live') ?? [...have.values()].find((x) => x.classList.contains('live'));
        el ??= made('', key, fresh);
        have.delete(el.dataset.k);
        el.dataset.k = key;
        partInto(el, b.part, b.n, b.turn.start, b.live ? ls : null, b.turn, fresh);
      } else if (b.item) {
        const key = 'i:' + b.item.key;
        el = have.get(key) ?? made('it7', key, fresh);
        have.delete(key);
        write(el, itemOf(b.item));
      } else {
        el = have.get('old') ?? made('it7', 'old', true);
        have.delete('old');
        write(el, liveHtml(st.live, held));
      }
      prev = place(box, el, prev);
    }
    for (const el of have.values()) el.remove();
  }
  window.tlDraw = draw;

  // While it works the times move: the conversation is drawn again five times a second (only what changed is written).
  setInterval(() => {
    if (S.last?.live?.phase !== 'working' || typeof frame === 'undefined' || frame !== 'main') return;
    const c = document.getElementById('convo'), follow = atEnd(c);
    draw(S.order.map((k) => S.items[k]).filter(Boolean), S.last, document.getElementById('items'));
    if (follow) c.scrollTop = c.scrollHeight;
  }, 200);

  // A press opens a step, folds a part, opens a long answer, shows or hides what streams (on the press: the part under
  // way is drawn again five times a second); a click copies.
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest('[data-r7],[data-o7],[data-fold7],[data-tail7]');
    if (!el) return;
    if (el.dataset.r7) { const k = el.dataset.r7; opened.has(k) ? opened.delete(k) : opened.add(k); }
    else if (el.dataset.o7) { const k = el.dataset.o7; shut.has(k) ? shut.delete(k) : shut.add(k); }
    else if (el.dataset.fold7) { const k = el.dataset.fold7; unfolded.has(k) ? unfolded.delete(k) : unfolded.add(k); }
    else if (el.dataset.tail7) { tailOpen = !tailOpen; try { localStorage.setItem('think-open', tailOpen ? '1' : '0'); } catch {} }
    render();
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy7]');
    if (!b) return;
    const host = b.parentElement, el = host.firstElementChild;
    const text = el.matches('.diff') ? [...el.children].map((r) => (r.classList.contains('add') ? '+' : r.classList.contains('del') ? '-' : ' ') + (r.querySelector('.t')?.textContent ?? '')).join('\n') : String(el.innerText ?? el.textContent).replace(/\n{3,}/g, '\n\n').trim();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;opacity:0'; document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch {} ta.remove();
    }
    b.classList.toggle('done', ok); b.classList.toggle('fail', !ok);
    clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('done', 'fail'), 1600);
  });
})();
