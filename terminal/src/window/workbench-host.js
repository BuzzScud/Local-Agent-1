// The window's side of the workbench (workbench.js): its calls answered by this window's server (workbench.mjs, under
// /wb/ with the window's key), VS Code's editor part and its terminal part loaded from the packages the server hands
// out (/vs/, /xterm/), a real shell in the terminal pane over the page's own line to the server, and the chat beside
// it: the conversation keeps the window until a file is open, then takes a column on the right. What the workbench
// had open is kept per folder on this Mac (/wb/state), since the page's own address changes at every start.
(() => {
  const el = document.getElementById('wb'), rowEl = document.getElementById('wbrow'), gripEl = document.getElementById('chatgrip');
  if (!el || !window.Workbench) return;
  const enc = encodeURIComponent;
  const at = (path) => `${path}${path.includes('?') ? '&' : '?'}t=${T}`;
  const get = (path) => fetch(at(path)).then((r) => r.json()).catch(() => ({ error: 'The window did not answer.' }));
  const post = (path, body) => fetch(at(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, why: 'The window did not answer.' }));

  // The terminal part comes as a module (import), so it never meets the editor part's loader: a plain script tag of it
  // would hand itself to that loader's `define` instead of the page.
  const lib = (src) => import(src);
  const css = (href, name) => { if (document.querySelector(`link[href="${href}"]`)) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; if (name) l.dataset.name = name; document.head.append(l); };
  let monacoP = null;
  const monaco = () => (monacoP ??= (async () => {
    const there = await fetch('/vs/loader.js', { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
    if (!there) return null;
    css('/vs/editor/editor.main.css', 'vs/editor/editor.main');
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/vs/loader.js'; s.onload = res; s.onerror = rej; document.head.append(s); });
    return new Promise((res) => { window.require.config({ paths: { vs: `${location.origin}/vs` } }); window.require(['vs/editor/editor.main'], () => res(window.monaco ?? null), () => res(null)); });
  })().catch(() => null));

  // The terminal's colours (27 Nov 2026, the owner: "improve the terminal design"): the window's own (ui.html) where it has
  // one (text, accent, ok, bad, sand), the rest of the sixteen softened to sit beside them, a slim scrollbar.
  const termTheme = () => {
    const v = (n, fb) => cssVar(n) || fb;
    return {
      background: v('--win', '#161618'), foreground: v('--text', '#e8e8ea'), cursor: v('--accent', '#5fafff'), cursorAccent: v('--win', '#161618'),
      selectionBackground: 'rgba(95,175,255,.28)', selectionInactiveBackground: 'rgba(255,255,255,.1)',
      black: '#2b2b30', red: v('--bad', '#ff6b6b'), green: v('--ok', '#4fb59a'), yellow: v('--sand', '#e2c08d'), blue: v('--accent', '#5fafff'), magenta: '#e58fb6', cyan: '#6cc4cf', white: '#c9c9ce',
      brightBlack: '#6e6e76', brightRed: '#ff8a8a', brightGreen: '#72d1b5', brightYellow: '#f0d4a6', brightBlue: '#8cc6ff', brightMagenta: '#f2aacb', brightCyan: '#92dbe4', brightWhite: '#f4f4f6',
      scrollbarSliderBackground: 'rgba(255,255,255,.1)', scrollbarSliderHoverBackground: 'rgba(255,255,255,.18)', scrollbarSliderActiveBackground: 'rgba(255,255,255,.26)',
    };
  };
  // The terminal pane: one shell a tab, on the server (makeShells); what it prints comes back on the page's line.
  const terms = new Map();
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const terminal = {
    create(box, { ended } = {}) {
      const id = `t${Math.random().toString(36).slice(2, 9)}`;
      const t = { ended, term: null, fit: null, early: [] };
      terms.set(id, t);
      (async () => {
        let X, F;
        try { [X, F] = await Promise.all([lib('/xterm/lib/xterm.mjs'), lib('/xterm-fit/lib/addon-fit.mjs')]); } catch { box.textContent = 'The terminal part is not installed here (bun install in the app\'s folder).'; return; }
        css('/xterm/css/xterm.css');
        const term = new X.Terminal({ fontFamily: cssVar('--mono') || 'Menlo, monospace', fontSize: 12.5, lineHeight: 1.35, fontWeightBold: '600', cursorBlink: true, cursorStyle: 'bar', cursorWidth: 2, cursorInactiveStyle: 'outline', scrollback: 8000, macOptionIsMeta: true, minimumContrastRatio: 3, drawBoldTextInBrightColors: false, theme: termTheme() });
        const fit = new F.FitAddon(); term.loadAddon(fit); term.open(box);
        try { fit.fit(); } catch {}
        t.term = term; t.fit = fit;
        send({ t: 'wbx-term', op: 'open', id, cols: term.cols, rows: term.rows });
        term.onData((data) => send({ t: 'wbx-term', op: 'data', id, data }));
        term.onResize(({ cols, rows }) => send({ t: 'wbx-term', op: 'resize', id, cols, rows }));
        new ResizeObserver(() => { if (box.offsetParent) { try { fit.fit(); } catch {} } }).observe(box);
        for (const d of t.early) term.write(d);
        t.early = null; term.focus();
      })();
      // selection() and text(n), the last n lines it shows: for "Send to chat" (workbench-ai.js)
      const text = (n = 60) => { const b = t.term?.buffer?.active; if (!b) return ''; const out = []; for (let i = Math.max(0, b.length - n); i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? ''); return out.join('\n').replace(/\n+$/, ''); };
      return { focus: () => t.term?.focus(), fit: () => { try { t.fit?.fit(); } catch {} }, selection: () => t.term?.getSelection?.() ?? '', text, clear: () => { t.term?.clear(); t.term?.focus(); }, dispose: () => { send({ t: 'wbx-term', op: 'close', id }); t.term?.dispose(); terms.delete(id); } };
    },
  };

  // A question to the app (bridge-wb.mjs) and its answer, by id: the review's copies, an undo, a commit message.
  const asked = new Map();
  const ask = (what, args = {}, ms = 60_000) => new Promise((res) => {
    const id = `a${Math.random().toString(36).slice(2, 9)}`;
    const timer = setTimeout(() => { asked.delete(id); res({ ok: false, why: 'Agentic Coder did not answer in time.' }); }, ms);
    asked.set(id, (m) => { clearTimeout(timer); asked.delete(id); res(m); });
    send({ t: 'act', do: what, id, ...args });
  });
  let changedCb = null, saved = {}, saveTimer = null, siteBase = null;
  // the tests' and the debugger's runs by id, and the debugger's answers by question
  const runs = new Map(), answers = new Map();
  const host = {
    agentName: 'Agentic Coder', live: true,
    // the newer tools (workbench-run.mjs, workbench-debug.mjs): the project's code for the language service, the tests,
    // the debugger, a file of the folder for the browser preview and the servers this Mac runs
    sources: () => get('/wb/sources'),
    tests: {
      list: () => get('/wb/tests'),
      run: (o, on) => { const id = `r${Math.random().toString(36).slice(2, 9)}`; runs.set(id, on); send({ t: 'wbx-test', op: 'run', id, path: o.path ?? null, name: o.name ?? null }); return { id }; },
      stop: (id) => send({ t: 'wbx-test', op: 'stop', id }),
    },
    debug: {
      start: (o, on) => { const id = `d${Math.random().toString(36).slice(2, 9)}`; runs.set(id, on); send({ t: 'wbx-dbg', op: 'start', id, path: o.path, runtime: o.runtime ?? null, bps: o.bps ?? {} }); return { id }; },
      cmd: (id, cmd, args = {}) => new Promise((res) => { const req = `q${Math.random().toString(36).slice(2, 9)}`; answers.set(req, res); setTimeout(() => { if (answers.delete(req)) res({ why: 'No answer from the debugger.' }); }, 12_000); send({ t: 'wbx-dbg', op: 'cmd', id, cmd, req, args }); if (!['props', 'eval'].includes(cmd)) { answers.delete(req); res({ ok: true }); } }),
      stop: (id) => send({ t: 'wbx-dbg', op: 'stop', id }),
    },
    site: async (path) => { siteBase ??= (await get('/wb/site-key')).base; return siteBase ? { url: `${siteBase}${path.split('/').map(enc).join('/')}` } : null; },
    servers: () => get('/wb/ports').then((r) => r?.ports ?? []),
    review: { before: (path, n) => ask('wb-before', { n, path }), undo: (path, n) => ask('wb-undo', { n, path }) },
    ask: (o) => ask('wb-ask', o, 120_000),
    get name() { return (S.folder || 'Files').split('/').filter(Boolean).pop() ?? 'Files'; },
    tree: (p) => get(`/wb/tree?p=${enc(p)}`), files: () => get('/wb/files'), read: (p) => get(`/wb/file?p=${enc(p)}`),
    save: (path, text, stamp, force) => post('/wb/file', { path, text, stamp, force }),
    make: (path, dir) => post('/wb/new', { path, dir }), rename: (from, to) => post('/wb/rename', { from, to }), trash: (path) => post('/wb/trash', { path }),
    search: (o) => get(`/wb/search?q=${enc(o.query)}&re=${o.regex ? 1 : 0}&case=${o.matchCase ? 1 : 0}&word=${o.word ? 1 : 0}&inc=${enc(o.include ?? '')}`),
    git: () => get('/wb/git'), diff: (p, staged) => get(`/wb/diff?p=${enc(p)}&staged=${staged ? 1 : 0}`), gitDo: (op, args) => post('/wb/git', { ...args, op }),
    check: (p) => get(`/wb/check?p=${enc(p)}`),
    monaco, terminal,
    onChange: (cb) => { changedCb = cb; },
    // into the prompt, as a paste: you send it when you have said what you want
    toChat: (text) => { send({ t: 'paste', text }); toast('Added to the prompt'); },
    commands: () => [['/model', 'Model'], ['/remote', 'Remote'], ['/mode', 'Mode'], ['/loop', 'Loops'], ['/memory', 'Memory'], ['/skills', 'Skills'], ['/mcp', 'MCP servers'], ['/usage', 'Usage'], ['/settings', 'Settings'], ['/help', 'Help']]
      .map(([cmd, name]) => ({ title: `Agentic Coder: ${name}`, k: cmd, run: () => run(cmd) }))
      .concat([{ title: 'Agentic Coder: New Chat in a New Window', k: '⌘N', run: () => newWindow() }, { title: 'Agentic Coder: Show the Folder in Finder', k: '', run: () => fetch(at('/reveal')) }]),
    store: { get: (k) => saved[k] ?? null, set: (k, v) => { saved[k] = v; clearTimeout(saveTimer); saveTimer = setTimeout(() => post('/wb/state', { state: saved }), 400); } },
  };

  // The chat's column: all of the window until a file or the panel is open, then a column on the right you can drag.
  let chatW = null;
  const place = ({ main }) => {
    const was = rowEl.classList.contains('ed');
    rowEl.classList.toggle('ed', Boolean(main));
    if (chatW) rowEl.style.setProperty('--chatw', `${chatW}px`);
    if (was !== Boolean(main)) { fit(); fitModes?.(); }
  };
  gripEl?.addEventListener('pointerdown', (e) => {
    e.preventDefault(); gripEl.setPointerCapture(e.pointerId);
    const x0 = e.clientX, from = document.getElementById('body').getBoundingClientRect().width;
    const move = (ev) => { chatW = Math.max(360, Math.min(innerWidth - 420, from - (ev.clientX - x0))); rowEl.style.setProperty('--chatw', `${chatW}px`); };
    const up = () => { gripEl.removeEventListener('pointermove', move); gripEl.removeEventListener('pointerup', up); host.store.set('chatW', chatW); fit(); };
    gripEl.addEventListener('pointermove', move); gripEl.addEventListener('pointerup', up);
  });

  // What the agent does, from the window's state (bridge.mjs): the files its new steps read and edit go to the
  // workbench as it works (workbench-ai.js follow), and a reply's changed files once its copies are kept (done).
  const seen = new Set();
  let working = false, turnN = undefined;
  const relOf = (p) => {
    let s = String(p ?? '').trim().replace(/^["'`]|["'`]$/g, '').replace(/:\d+(?:[-:]\d+)*$/, '');
    if (!s || /\s/.test(s) && !s.includes('/')) return null;
    const f = String(S.folder ?? '').replace(/\/+$/, '');
    if (f && s.startsWith(`${f}/`)) return s.slice(f.length + 1);
    if (s.startsWith('~/')) { const rest = s.slice(2), parts = f.split('/'); for (let i = 1; i < parts.length; i++) { const tail = parts.slice(i).join('/'); if (rest.startsWith(`${tail}/`)) return rest.slice(tail.length + 1); } return null; }
    if (s.startsWith('/') || s.startsWith('..')) return null;
    return s.replace(/^\.\//, '');
  };
  function onState(m, first) {
    const ai = window.WB?.part?.('ai');
    if (first || !ai) { for (const k of Object.keys(m.steps ?? m.state?.steps ?? {})) seen.add(k); if (turnN === undefined) turnN = (m.state ?? m).wbTurn?.n ?? null; return; }
    const now = m.live?.phase === 'working', reading = [], editing = [];
    for (const [k, v] of Object.entries(m.steps ?? {})) {
      if (seen.has(k)) continue; seen.add(k);
      if (v?.err) continue;
      if (v?.k === 'diff') { const p = relOf(v.path); if (p) editing.push({ path: p, lines: (v.hunk ?? []).filter((x) => x[0] === '+' && x[2]).map((x) => x[2]) }); }
      else if (v?.k === 'read' || v?.k === 'same') { const p = relOf(v.arg); if (p) reading.push(p); }
    }
    const w = m.live?.writing?.path ? relOf(m.live.writing.path) : null;
    if (w) editing.push({ path: w, lines: [] });
    if (reading.length || editing.length || now !== working) ai.follow({ reading, editing, working: now });
    working = now;
    const t = m.wbTurn;
    if (!now && t && t.n !== turnN) { turnN = t.n; ai.done({ ref: t.n, files: t.files }); }
  }

  window.WBHOST = {
    state: onState,
    on(m) {
      if (m.t === 'wbx-ai') return asked.get(m.id)?.(m);
      if (m.t === 'wbx-test') {
        const on = runs.get(m.id); if (!on) return;
        if (m.why) { on({ data: `${m.why}\n` }); on({ ended: true, code: null, results: [] }); }
        else on(m);
        if (m.ended || m.why) runs.delete(m.id);
        return;
      }
      if (m.t === 'wbx-dbg') {
        if (m.op === 'answer') { const r = answers.get(m.req); answers.delete(m.req); return r?.(m); }
        const on = runs.get(m.id); if (!on) return;
        if (m.op === 'begun' && !m.ok) { on({ id: m.id, op: 'out', text: `${m.why ?? 'It did not start.'}\n`, err: true }); on({ id: m.id, op: 'ended', code: null }); runs.delete(m.id); return; }
        on(m);
        if (m.op === 'ended') runs.delete(m.id);
        return;
      }
      if (m.t === 'wbx-fs') return changedCb?.(m.paths ?? null);
      const t = terms.get(m.id); if (!t) return;
      if (m.data != null) { if (t.term) t.term.write(m.data); else t.early?.push(m.data); }
      if (m.ended) { t.term?.dispose(); terms.delete(m.id); t.ended?.(); }
      if (m.why) { if (t.term) t.term.write(`\r\n${m.why}\r\n`); else t.early?.push(`${m.why}\r\n`); }
    },
  };
  get('/wb/state').then((r) => {
    saved = r?.state && typeof r.state === 'object' ? r.state : {};
    chatW = Number(saved.chatW) || null;
    window.WB = window.Workbench.mount(el, host, { onLayout: place });
  });
})();
