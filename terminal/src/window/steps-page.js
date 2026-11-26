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
  const fam = (d) => (d.err || d.k === 'error' ? FAM.fail : d.k === 'think' ? FAM.think : d.k === 'said' || d.k === 'writing' || d.k === 'whole' ? FAM.write : d.k === 'note' || d.k === 'machine' ? FAM.app : FAM.tools);
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
    // hearth (an Ollama service) sends a tool call in one piece once it is written: its words stop while a long one is
    // written, so after 15 s of quiet the line says so, with about how much is written at the last reply's speed
    // (21 Nov 2026: a dashboard file written for 5 minutes read "Writing… 16 words" the whole time)
    const quiet = L.whole && L.lastTokenAt && !L.waiting && !L.running && !L.task ? (now() - L.lastTokenAt) / 1000 : 0;
    if (quiet >= 15) return { key: 'live', k: 'whole', text: L.text, since: L.lastTokenAt, tps: L.wholeTps ?? null, room: L.room ?? null, verb: ['Writing its next step', 'sent in one piece when it is done'] };
    // A reply with no words before its call (thinking off) sends nothing at all until the call is whole: once reading what is
    // new should be done (readSecs, at the service's usual reading speed) and 15 s more have passed, it is writing (21 Nov 2026:
    // a dashboard written for 11 minutes read "Waiting… for the model to read what is new" the whole time). Not while it waits in line.
    const readEnd = L.whole && L.waiting && !L.queued && !L.running && !L.task && L.readSecs != null && L.stepStart ? L.stepStart + L.readSecs * 1000 : null;
    if (readEnd && (now() - readEnd) / 1000 >= 15) return { key: 'live', k: 'whole', text: null, since: readEnd, tps: L.wholeTps ?? null, room: L.room ?? null, verb: ['Writing its next step', 'sent in one piece when it is done'] };
    // the answer once it comes (the thought before it is still in the live state until the reply ends)
    if (L.text) return { key: 'live', k: 'said', text: L.text, since: L.textStart ?? since, verb: ['Writing', ''] };
    if (L.thinking) return { key: 'live', k: 'think', text: L.thinking, tokens: L.thinkTokens ?? 0, since: L.thinkStart ?? since, verb: ['Thinking', ''] };
    if (L.writing) return { key: 'live', k: 'writing', since, verb: ['Writing', L.writing.path ? base(L.writing.path) : L.writing.name === 'Edit' ? 'an edit' : L.writing.name ? 'a ' + L.writing.name + ' call' : ''] };
    if (L.running) { const lb = L.running.label ?? ''; return { key: 'live', k: 'tool', since, verb: [lb === 'Bash' ? (TESTY.test(L.running.arg) ? 'Testing' : 'Running') : LABEL_VERB[lb] ?? lb, L.running.arg ?? ''] }; }
    if (L.task) return { key: 'live', k: 'tool', since, verb: ['Working', L.task] };
    return { key: 'live', k: 'wait', since, verb: ['Waiting', L.waiting ? 'for the model to read what is new' : ''] };
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

  // ---- a line, as Claude Code prints it ----
  // (19 Nov 2026, the owner's pick "A · Claude Code transcript", docs/private/design rounds/window-footer-steps-2026-11-19/:
  // "reduce the windows here? make it like claude code".) No box and no columns: a bullet, the tool's name and what it was
  // on, and under it after ⎿ how it went when that says something. Reads, searches and lists in a row are one line; edits
  // to one file in a row are one line with their sum; the same failure twice is one line. A finished thought is hidden
  // (one line a part says how many, and shows them); the step under way is Claude Code's spinner line.
  let thinkShown = false;
  try { thinkShown = localStorage.getItem('think-shown') === '1'; } catch {}
  const failed = (d) => Boolean(d.err || d.k === 'error');
  const LOOK = new Set(['read', 'same', 'search', 'list']);
  const looks = (d) => LOOK.has(d.k) && !failed(d);
  const NAME = { Reading: 'Read', Searching: 'Search', Listing: 'List', Skill: 'Skill', Guide: 'Guide' };
  // Claude Code's name for a step and what it was on
  function ccOf(d) {
    if (failed(d)) return [d.label || 'Error', d.arg && d.arg !== d.message ? d.arg : ''];
    switch (d.k) {
      case 'diff': return [d.created ? 'Write' : 'Update', d.path];
      case 'bash': return ['Bash', d.arg];
      case 'job': return ['Bash', d.arg];
      case 'todos': return ['Update Todos', ''];
      case 'answer': return ['Asked you', d.question];
      case 'websearch': return ['Web Search', d.query ? '“' + d.query + '”' : ''];
      case 'fetched': return ['Fetch', d.url];
      default: { const [v, t] = verbOf(d); return [NAME[v] ?? v, t]; }
    }
  }
  // how it went, after ⎿: only when that says something (a plain command that ran is its line alone)
  function subOf(d, n) {
    if (failed(d)) return '<span class="bad">' + esc(cut(d.message || d.arg || 'failed', 260)) + (n > 1 ? ' (×' + n + ')' : '') + '</span>';
    if (d.k === 'diff') return '<span class="add">+' + d.add + '</span> <span class="del">−' + d.del + '</span>' + (n > 1 ? ' <span class="dim">· ' + n + ' edits</span>' : '');
    if (d.tests) return (d.tests.failed ? '<span class="bad">✗ ' + d.tests.failed + ' failed</span>' : '<span class="ok">✓ ' + d.tests.passed + ' passed</span>') + (d.ms != null ? ' <span class="dim">· ' + dur(d.ms) + '</span>' : '');
    if ((d.k === 'bash' || d.k === 'job') && d.code) return '<span class="bad">exit ' + d.code + '</span>';
    if (d.k === 'job') return '<span class="dim">in the background</span>';
    if (d.k === 'todos') return '<span class="dim">' + plural((d.items ?? []).length, 'to-do') + ' · ' + (d.items ?? []).filter((t) => t.done).length + ' done</span>';
    if (d.k === 'websearch') return '<span class="dim">' + plural(d.sources?.length || d.count || 0, 'source') + '</span>';
    if (d.k === 'answer') return '→ ' + esc(cut(d.answer || '(no answer kept)', 200));
    return '';
  }
  const bulletOf = (d) => (failed(d) ? 'bad' : d.k === 'note' || d.k === 'machine' ? 'app' : '');
  // a line: its bullet, name and (what it was on); when it started and how long it took in its tip and on hover
  function ccHtml(key, d, t0, name, arg, sub, cls) {
    const tip = [d.at && t0 ? mmss(d.at - t0) : '', d.ms != null ? dur(d.ms) : ''].filter(Boolean).join(' · ');
    return '<div class="l7' + (cls ? ' ' + cls : '') + '" data-r7="' + esc(key) + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '><span class="b7">' + (cls === 'app' ? '·' : '⏺') + '</span><span class="nm">' + esc(name) + '</span>' + (arg ? '<span class="ar">(' + esc(cut(arg, 220)) + ')</span>' : '') + '<span class="du">' + (d.ms != null ? dur(d.ms) : '') + '</span></div>'
      + (sub ? '<div class="sub7"><span class="k">⎿</span><span class="v">' + sub + '</span></div>' : '')
      + (opened.has(key) ? '<div class="det7">' + detailHtml(d) + '</div>' : '');
  }
  // what the model said: its words in full, white, as Claude Code's ⏺ text (a long one to its first lines, opened by a click)
  function sayHtml(key, text) {
    const t = String(text ?? ''), long = t.length > 300;
    return '<div class="l7 say"' + (long ? ' data-r7="' + esc(key) + '"' : '') + '><span class="b7">⏺</span><span class="sy">' + esc(long && !opened.has(key) ? cut(plain(t), 300) : t) + '</span></div>';
  }
  // reads, searches and lists in a row: "Read 2 files, searched 1 pattern"; one alone names what it read
  function lookHtml(group, t0) {
    const [k0, d0] = group[0];
    if (group.length === 1) { const [nm, ar] = ccOf(d0); return [k0, ccHtml(k0, d0, t0, nm, ar, d0.k === 'search' && !d0.count ? '<span class="dim">none found</span>' : '')]; }
    const n = (ks) => group.filter(([, d]) => ks.includes(d.k)).length, r = n(['read', 'same']), s = n(['search']), l = n(['list']);
    const words = [r ? 'read ' + plural(r, 'file') : '', s ? 'searched ' + plural(s, 'pattern') : '', l ? 'listed ' + plural(l, 'folder') : ''].filter(Boolean).join(', ');
    const key = 'g:' + k0, ms = group.reduce((x, [, d]) => x + (d.ms ?? 0), 0);
    const inner = opened.has(key) ? '<div class="grp7">' + group.map(([k, d]) => { const [nm, ar] = ccOf(d); return '<div class="gl7" data-r7="' + esc(k) + '"><span class="nm">' + esc(nm) + '</span> <span class="ar">' + esc(cut(ar, 200)) + '</span></div>' + (opened.has(k) ? '<div class="det7">' + detailHtml(d) + '</div>' : ''); }).join('') + '</div>' : '';
    return [key, '<div class="l7 grp" data-r7="' + esc(key) + '"><span class="b7">⏺</span><span class="nm">' + words[0].toUpperCase() + words.slice(1) + '</span><span class="du">' + (ms ? dur(ms) : '') + '</span></div>' + inner];
  }
  // the step under way, as Claude Code's spinner line: what it does now, then (for how long · the turn's counts · its time)
  const GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
  function liveLine(ls, turn) {
    const [vb, tg] = ls.verb, fails = turn.steps.filter(failed).length, secs = (now() - ls.since) / 1000;
    const so = ls.k === 'think' ? ls.tokens ?? 0 : ls.k === 'said' ? String(ls.text ?? '').split(/\s+/).filter(Boolean).length : null;
    const rate = ls.k === 'think' && secs > 0.5 && so ? Math.round(so / secs) : null;
    const think = turn.think + (ls.k === 'think' ? ls.tokens ?? 0 : 0);
    // About how much is written, at the last reply's speed; never past the most this reply may write (its room: 25 Nov 2026,
    // "about 12.4k tokens so far" on hearth, whose steps write 3k at most): then the time is a slow or busy server's.
    const est = ls.k === 'whole' && ls.tps > 0 ? Math.round(secs * ls.tps) : null;
    const slow = est != null && ls.room > 0 && est > ls.room;
    const meta = [dur(now() - ls.since), slow ? 'slower than its last reply: the server is slow or busy (this step writes ' + ktok(ls.room) + ' tokens at most)' : est ? 'about ' + ktok(est) + ' tokens so far' : so != null ? (ls.k === 'think' ? '↓ ' + ktok(so) + ' tokens' + (rate ? ' · ' + rate + '/s' : '') : plural(so, 'word')) : '', plural(turn.steps.filter(isCall).length, 'call'), think ? ktok(think) + ' thinking' : '', fails ? '<span class="bad">' + fails + ' failed</span>' : '', dur(now() - (turn.start ?? now())) + ' in all', 'esc to interrupt'].filter(Boolean).join(' · ');
    return '<div class="l7 live" data-tail7="1" style="--c:' + fam(ls) + '"><span class="b7 ac">' + (STILL.matches ? '✻' : GLYPHS[Math.floor(now() / 120) % GLYPHS.length]) + '</span><span class="nm vb">' + esc(vb) + '…</span>' + (tg ? '<span class="ar">' + esc(cut(tg, 160)) + '</span>' : '') + '<span class="mt">(' + meta + ')</span></div>';
  }
  // what streams: its newest words, at most five whole lines, starting at a whole word
  function tailHtml(d) {
    let t = d.k === 'said' || d.k === 'whole' ? String(d.text ?? '') : plain(d.text);
    // 1,600 characters: five whole lines across a wide window, now that the lines start at the left (19 Nov 2026)
    if (t.length > 1600) { t = t.slice(-1600); t = '… ' + t.slice(t.search(/\s/) + 1); }
    return '<div class="tail7' + (d.k === 'said' || d.k === 'whole' ? ' w' : '') + '"><div>' + esc(t) + '<span class="caret7"></span></div></div>';
  }
  // the lines of a part: the model's line, each step (opened, its result under it), a web search's sources, the hidden
  // thoughts, the step under way
  function linesOf(p, t0, ls, turn) {
    const out = [];
    if (p.line) out.push([p.key + '#said', sayHtml(p.key + '#said', p.line)]);
    const ds = p.keys.map((k) => [k, S.steps[k]]).filter(([, d]) => d);
    let thoughts = 0;
    for (let i = 0; i < ds.length;) {
      const [k, d] = ds[i];
      if (d.k === 'think' && !failed(d)) {
        thoughts++;
        if (thinkShown) out.push([k, '<div class="l7 think" data-r7="' + esc(k) + '"><span class="b7">∴</span><span class="nm">Thought' + (d.ms ? ' for ' + dur(d.ms) : '') + '</span><span class="ar">' + esc(cut(firstSentence(d.text), 160)) + '</span></div>' + (opened.has(k) ? '<div class="det7">' + detailHtml(d) + '</div>' : '')]);
        i++; continue;
      }
      if (d.k === 'said') { out.push([k, sayHtml(k, d.text)]); i++; continue; }
      if (looks(d)) { let j = i; while (j < ds.length && looks(ds[j][1])) j++; out.push(lookHtml(ds.slice(i, j), t0)); i = j; continue; }
      // the same file changed again and again, or the same failure: one line
      let j = i + 1;
      const same = (x) => (d.k === 'diff' && !failed(d) ? x.k === 'diff' && !failed(x) && !x.created && !d.created && x.path === d.path : failed(d) && failed(x) && x.label === d.label && (x.message || x.arg) === (d.message || d.arg));
      while (j < ds.length && same(ds[j][1])) j++;
      const run = ds.slice(i, j).map(([, x]) => x), [nm, ar] = ccOf(d);
      const sum = run.length > 1 && d.k === 'diff' ? { ...d, add: run.reduce((s, x) => s + x.add, 0), del: run.reduce((s, x) => s + x.del, 0), ms: run.reduce((s, x) => s + (x.ms ?? 0), 0), hunk: run.flatMap((x) => x.hunk ?? []) } : d;
      out.push([k, ccHtml(k, sum, t0, nm, ar, subOf(sum, run.length), bulletOf(d))]);
      if (d.k === 'websearch') {
        const all = opened.has(k + '#src'), n = (d.sources ?? []).length, show = all ? n : Math.min(n, 4);
        for (const [x, s] of (d.sources ?? []).slice(0, show).entries()) out.push([k + '#' + x, '<a class="src7" href="' + esc(s.url) + '" target="_blank" rel="noopener"><span class="fav">' + esc((host(s.url)[0] ?? '?').toUpperCase()) + '</span><span class="host">' + esc(host(s.url)) + '</span><span class="st">' + esc(s.title || s.url) + '</span><span class="age">' + esc(s.age ?? '') + '</span></a>']);
        if (n > 4) out.push([k + '#more', '<div class="srcmore" data-r7="' + esc(k + '#src') + '">' + (all ? 'Show fewer' : '+ ' + plural(n - 4, 'more source')) + '</div>']);
      }
      i = j;
    }
    if (thoughts) out.push([p.key + '#thinks', '<div class="th7" data-thinks7="1">∴ ' + plural(thoughts, 'thought') + (thinkShown ? ' · hide thinking' : ' hidden · show thinking') + '</div>']);
    if (ls) out.push(['live', liveLine(ls, turn) + (tailOpen && (ls.k === 'think' || ls.k === 'said' || (ls.k === 'whole' && ls.text)) ? tailHtml(ls) : '')]);
    return out;
  }

  // ---- a part ----
  // Its head is the model's line for it (⏺, white) or the to-do the plan moved on to (▸); a part with neither has none.
  // A click on the head folds the part's steps; a finished part's counts show beside it on hover.
  function partHead(p, n, live, turn) {
    const ds = p.keys.map((k) => S.steps[k]).filter(Boolean), acts = ds.filter(isCall);
    if (!p.title || (!p.said && !p.plan)) return '<div class="hd7 none"></div>';
    const title = (p.plan ? '<span class="pl7">▸</span>' : '<span class="b7">⏺</span>') + '<span class="ti">' + esc(p.title) + (!live && shut.has(p.key) ? ' <span class="g">· ' + plural(ds.length, 'step') + ' folded</span>' : '') + '</span>';
    if (live) return '<div class="hd7' + (p.plan ? ' plan' : '') + '" data-o7="' + esc(p.key) + '">' + title + '</div>';
    const files = {}; for (const d of acts) if (d.k === 'diff') { const f = files[base(d.path)] ??= { a: 0, r: 0 }; f.a += d.add; f.r += d.del; }
    const names = Object.keys(files), test = acts.filter((d) => d.tests).pop(), fails = acts.filter(failed).length;
    const oc = [names.length ? '<span class="ed">' + esc(names.length === 1 ? names[0] : names.length + ' files') + ' <span class="add">+' + names.reduce((s, x) => s + files[x].a, 0) + '</span> <span class="del">−' + names.reduce((s, x) => s + files[x].r, 0) + '</span></span>' : '', test ? (test.tests.failed ? '<span class="bad">✗ ' + test.tests.failed + ' failed</span>' : '<span class="ok">✓ ' + test.tests.passed + ' passed</span>') : '', fails ? '<span class="bad">' + plural(fails, 'failed step') + '</span>' : ''].filter(Boolean).join('');
    const ms = ds.reduce((s, d) => s + (d.ms ?? 0), 0);
    return '<div class="hd7' + (p.plan ? ' plan' : '') + '" data-o7="' + esc(p.key) + '">' + title + '<span class="oc">' + oc + '</span><span class="tm">' + (ms ? dur(ms) : '') + '</span></div>';
  }
  // the to-dos under the spinner line, in two rows: what is done as a count, the one under way, the next two and how
  // many more
  function planOf(turn) {
    const last = turn.steps.filter((d) => d.k === 'todos').pop(), items = last?.items ?? [];
    if (!items.length) return '';
    const done = items.filter((t) => t.done).length, i = items.findIndex((t) => !t.done);
    if (i < 0) return '<div class="plan7"><div><span class="k">⎿</span><span class="done">☒ ' + plural(done, 'to-do') + ' done</span></div></div>';
    const next = items.slice(i + 1).filter((t) => !t.done), more = next.length - 2;
    return '<div class="plan7"><div><span class="k">⎿</span>' + (done ? '<span class="done">☒ ' + done + ' done</span><span class="sep">·</span>' : '') + '<span class="now">☐ ' + esc(cut(items[i].text, 80)) + '</span></div>'
      + (next.length ? '<div><span class="k"></span>' + next.slice(0, 2).map((t) => '<span>☐ ' + esc(cut(t.text, 48)) + '</span>').join('<span class="sep">·</span>') + (more > 0 ? '<span class="sep">· +' + more + ' more</span>' : '') + '</div>' : '') + '</div>';
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
    const sig = live ? null : [p.key, p.keys.length, n, t0, shut.has(p.key), [...opened].join(','), thinkShown, p.keys.filter((k) => !S.steps[k]).length].join('|');
    if (sig && el.dataset.sig === sig) return;
    el.dataset.sig = sig ?? '';
    if (!el.firstChild) el.innerHTML = '<div class="hd7w"></div><div class="fold7"><div class="in7"><div class="tl7"></div><div class="live7"><div class="li7"></div></div></div></div>';
    el.classList.add('ch7');
    el.classList.toggle('live', Boolean(live));
    el.classList.toggle('shut', !live && shut.has(p.key));
    write(el.querySelector('.hd7w'), partHead(p, n, live, turn));
    if (live) write(el.querySelector('.li7'), planOf(turn)); // when the part ends its plan stays while it folds away
    const tl = el.querySelector('.tl7'), have = new Map([...tl.children].map((x) => [x.dataset.k, x]));
    let prev = null;
    for (const [k, html] of linesOf(p, t0, live, turn)) {
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
    const el = e.target.closest('[data-r7],[data-o7],[data-fold7],[data-tail7],[data-thinks7]');
    if (!el) return;
    if (el.dataset.r7) { const k = el.dataset.r7; opened.has(k) ? opened.delete(k) : opened.add(k); }
    else if (el.dataset.o7) { const k = el.dataset.o7; shut.has(k) ? shut.delete(k) : shut.add(k); }
    else if (el.dataset.fold7) { const k = el.dataset.fold7; unfolded.has(k) ? unfolded.delete(k) : unfolded.add(k); }
    else if (el.dataset.thinks7) { thinkShown = !thinkShown; try { localStorage.setItem('think-shown', thinkShown ? '1' : '0'); } catch {} }
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
