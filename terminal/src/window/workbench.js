// The workbench (26 Nov 2026, the owner: "i want to make them both like vs code, it does everything"; their picks: our own
// workbench with VS Code's editor part inside, editor tabs with colours and split, search and source control, the
// command palette and its keys, one page used by Agentic Coder's window and by hearth). This file is that page's
// script and knows nothing of either: the page that holds it hands `Workbench.mount` a host, an object of calls
// (tree, read, save, search, git, …), and draws the chat itself. Parts: the activity bar, a side pane (Files, Search,
// Source control), editor tabs in up to three groups, a bottom panel (Problems, Terminal), a status line and the
// palette. With no editor part to load (host.monaco gives null) a file opens in a plain text box and everything else
// works the same. No confirm() or alert(): a question is a bar over the editor or a line in the pane.
(() => {
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  // the small tools every part uses (workbench-kit.js, loaded first): elements, a fuzzy match, the page's colours
  const { h, put, fuzzy, marked, colourOf, over, hex } = window.WorkbenchKit;
  // The icons are the page's own (window.WorkbenchIcons, or host.icons): a name → its drawing as HTML. The window brings
  // its set (workbench-icons.js); hearth brings the ones every hearth screen uses.
  let I = {};
  const icon = (name, cls) => h('span', { class: cls ?? 'ic', html: I[name] });
  // A row or a tab that is pressed like a button and holds small buttons of its own (a button may not hold buttons).
  const press = (attrs, ...kids) => h('div', { role: 'button', tabindex: '0', ...attrs, onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); e.currentTarget.click(); } } }, ...kids);
  const base = (p) => p.slice(p.lastIndexOf('/') + 1);
  const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const key = (...k) => (MAC ? k.join('') : k.map((x) => ({ '⌘': 'Ctrl+', '⇧': 'Shift+', '⌃': 'Ctrl+', '⌥': 'Alt+' })[x] ?? x).join(''));
  const size = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} bytes`);


  function mount(root, host, opts = {}) {
    I = { ...(window.WorkbenchIcons ?? {}), ...(host.icons ?? {}) };
    const can = { write: true, git: true, stage: true, commit: true, branch: true, push: true, trash: true, ...(host.can ?? {}) };
    const store = host.store ?? { get: () => null, set: () => {} };
    const kept = store.get('state') ?? {};
    const S = {
      view: kept.view ?? null, sideW: kept.sideW ?? 264, panel: kept.panel ?? null, panelH: kept.panelH ?? 220,
      open: new Set(kept.open ?? ['']), kids: new Map(), sel: null, edit: null,
      docs: new Map(), groups: [], focus: 0, recent: kept.recent ?? [],
      git: null, gitSay: null, pushAsk: false, message: '',
      checks: new Map(), marks: [],
      find: { q: '', re: false, cs: false, word: false, inc: '', res: null, busy: false, shut: new Set() },
      monaco: null, files: null, wrap: kept.wrap ?? false, minimap: kept.minimap ?? true,
      terms: [], term: null, termN: 0,
    };
    let pal = null, menu = null, gitTimer = null, saveTimer = null, findTimer = null;

    root.classList.add('wbx');
    root.classList.toggle('wbx-narrow', Boolean(opts.narrow));
    const act = h('div', { class: 'wbx-act', role: 'toolbar', 'aria-label': 'Workbench' });
    const sideB = h('div', { class: 'wbx-side-b' });
    const sideH = h('div', { class: 'wbx-side-h' });
    const side = h('div', { class: 'wbx-side' }, sideH, sideB);
    const groupsEl = h('div', { class: 'wbx-groups' });
    const panelH = h('div', { class: 'wbx-panel-h' });
    const panelB = h('div', { class: 'wbx-panel-b' });
    const panel = h('div', { class: 'wbx-panel' }, panelH, panelB);
    const foot = h('div', { class: 'wbx-foot' });
    const noteEl = h('div', { class: 'wbx-bar wbx-notice' }); noteEl.hidden = true;
    const main = h('div', { class: 'wbx-main' }, noteEl, groupsEl, panel, foot);
    const welcome = h('div', { class: 'wbx-welcome' }); welcome.hidden = true;
    root.append(act, side, main, welcome);

    const keep = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set('state', { view: S.view, sideW: S.sideW, panel: S.panel, panelH: S.panelH, open: [...S.open].slice(0, 200), recent: S.recent.slice(0, 30), wrap: S.wrap, minimap: S.minimap, groups: S.groups.map((g) => ({ tabs: g.tabs.filter((k) => k.startsWith('f:')).map((k) => k.slice(2)), active: g.active?.startsWith('f:') ? g.active.slice(2) : null })) }), 200); };
    const mainOpen = () => S.groups.some((g) => g.tabs.length) || Boolean(S.panel);
    function layout() {
      side.hidden = !S.view; side.style.width = `${S.sideW}px`;
      main.hidden = !mainOpen();
      panel.hidden = !S.panel; panel.style.height = S.panelMax ? '' : `${S.panelH}px`;
      groupsEl.hidden = !S.groups.some((g) => g.tabs.length) || (S.panelMax && Boolean(S.panel));
      panel.style.flex = groupsEl.hidden ? '1' : '';
      root.classList.toggle('wbx-open', mainOpen());
      renderWelcome();
      opts.onLayout?.({ side: Boolean(S.view), main: mainOpen() });
      keep();
    }
    // The start screen (opts.welcome, for a page that gives the workbench its whole place): with nothing open, where the
    // editor would be: the ways in with their keys, what changed, and the files opened last.
    function renderWelcome() {
      const on = Boolean(opts.welcome) && !mainOpen();
      welcome.hidden = !on; if (!on) return put(welcome);
      const row = (ic, label, sub, fn, cls) => press({ class: 'wbx-row', onclick: fn }, icon(ic), h('span', { class: `nm${cls ? ` ${cls}` : ''}` }, label), sub ? h('span', { class: 'wbx-key' }, sub) : null);
      const files = S.git?.files ?? [], recent = S.recent.slice(0, 8);
      put(welcome, noteBar(), h('div', { class: 'wbx-wl' },
        h('div', { class: 'wbx-wl-h' }, host.name ?? 'This folder'),
        typeof opts.welcome === 'string' ? h('div', { class: 'wbx-wl-say' }, opts.welcome) : null,
        h('div', { class: 'wbx-wl-cols' },
          h('div', null, h('div', { class: 'wbx-wl-t' }, 'Start'),
            row('search', 'Go to file', key('⌘', 'P'), () => palette('')),
            row('search', 'Find in files', key('⇧', '⌘', 'F'), () => setView('search')),
            can.git ? row('git', 'Source control', key('⌃', '⇧', 'G'), () => setView('git')) : null,
            host.terminal ? row('panel', 'Terminal', key('⌃', '`'), () => togglePanel('terminal')) : null,
            row('right', 'Every command', key('⇧', '⌘', 'P'), () => palette('>'))),
          files.length ? h('div', null, h('div', { class: 'wbx-wl-t' }, `Changed${S.git?.since ? ` since ${S.git.since}` : ''}`),
            files.slice(0, 8).map((f) => row('file', base(f.path), dirOf(f.path), () => openDiff(f.path, f.staged), `wbx-c-${f.status}`)),
            files.length > 8 ? row('git', `${files.length - 8} more in Source control`, '', () => setView('git')) : null) : null,
          recent.length ? h('div', null, h('div', { class: 'wbx-wl-t' }, 'Opened last'), recent.map((p) => row('file', base(p), dirOf(p), () => openFile(p)))) : null)));
    }
    // A line over the editor from the page that holds the workbench (notice({ text, actions: [[label, fn, cls]] }), null to take
    // it away): what someone else did in the folder, with what can be done about it. One at a time.
    let noted = null;
    const noteBar = () => (noted ? h('div', { class: 'wbx-bar wbx-notice' }, h('span', { class: 't' }, noted.text), h('span', { class: 'wbx-btns' }, (noted.actions ?? []).map(([label, fn, cls]) => h('button', { type: 'button', class: `wbx-btn ${cls ?? 'plain'}`, onclick: () => fn?.() }, label)), ib('x', 'Close this line', () => notice(null)))) : null);
    function notice(v) {
      noted = v?.text ? v : null;
      noteEl.hidden = !noted; put(noteEl, ...(noted ? [...noteBar().childNodes] : []));
      renderWelcome();
    }
    // Files someone else is working on now (touch(paths, who); settle() when they are done): a mark in the tree, and the
    // tree, the tabs and Source control follow them as for any change on the disk.
    const touched = new Map();
    function touch(paths, who = 'Someone') {
      for (const p of paths ?? []) if (p) touched.set(p, who);
      changed(paths);
      if (S.view === 'files') renderSide();
    }
    function settle() { if (!touched.size) return; touched.clear(); if (S.view === 'files') renderSide(); }
    // Dragging an edge: a pane's width or the panel's height.
    function grip(el, cls, move, done) {
      const g = h('div', { class: `wbx-grip ${cls}` });
      g.addEventListener('pointerdown', (e) => {
        e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('drag');
        const x0 = e.clientX, y0 = e.clientY, from = move(null);
        const on = (ev) => move(from, ev.clientX - x0, ev.clientY - y0);
        const off = () => { g.classList.remove('drag'); g.removeEventListener('pointermove', on); g.removeEventListener('pointerup', off); done?.(); keep(); };
        g.addEventListener('pointermove', on); g.addEventListener('pointerup', off);
      });
      el.append(g);
    }
    grip(side, '', (from, dx) => { if (from == null) return S.sideW; S.sideW = Math.max(180, Math.min(520, from + dx)); side.style.width = `${S.sideW}px`; }, () => opts.onLayout?.({ side: true, main: mainOpen() }));
    grip(panel, 'row', (from, _dx, dy) => { if (from == null) return S.panelH; S.panelH = Math.max(110, Math.min(Math.max(140, main.clientHeight - 120), from - dy)); panel.style.height = `${S.panelH}px`; }, () => S.term?.h?.fit?.());

    // ---------- the activity bar
    function renderAct() {
      const changes = S.git?.files?.length ?? 0, bad = problems().filter((p) => p.severity === 'error').length;
      // v.run: a part's button that acts instead of opening a pane
      const b = (id, name, title, badge, cls, v) => { const on = v?.on ? v.on() : S.view === id || (id === 'panel' && S.panel && S.panel !== 'terminal'); return h('button', { type: 'button', class: on ? 'on' : '', title, 'aria-label': title, 'aria-pressed': String(Boolean(on)), onclick: () => (v?.run ? v.run() : id === 'panel' ? togglePanel() : setView(S.view === id ? null : id)) }, h('span', { html: I[name] }), badge ? h('span', { class: `wbx-badge ${cls ?? ''}` }, badge > 99 ? '99+' : badge) : null); };
      put(act,
        b('files', 'files', `Files ${key('⇧', '⌘', 'E')}`), b('search', 'search', `Search ${key('⇧', '⌘', 'F')}`),
        can.git ? b('git', 'git', `Source control ${key('⌃', '⇧', 'G')}`, changes) : null,
        partViews().map((v) => b(v.id, v.icon, v.title, v.badge?.(), v.badgeCls, v)),
        h('div', { class: 'gap' }), b('panel', 'panel', `Problems and terminal ${key('⌘', 'J')}`, bad, 'bad'),
      );
    }
    function setView(v) {
      if (v && !['files', 'search', 'git'].includes(v) && !partView(v)) v = null;
      S.view = v; layout(); renderAct(); renderSide();
      if (v === 'files' && !S.kids.has('')) loadDir('');
      if (v === 'git') refreshGit();
      if (v === 'search') setTimeout(() => sideB.querySelector('input')?.focus(), 0);
      partView(v)?.shown?.();
    }
    function renderSide() {
      if (!S.view) return;
      // A box you are typing in keeps its cursor when the pane is drawn again under it (a file changed, git answered).
      const top = sideB.scrollTop, was = document.activeElement, held = sideB.contains(was) ? was.dataset?.keep : null, sel = held ? [was.selectionStart, was.selectionEnd] : null;
      if (S.view === 'files') renderFiles(); else if (S.view === 'search') renderSearch(); else if (S.view === 'git') renderGit(); else partView(S.view)?.render(sideH, sideB);
      sideB.scrollTop = top;
      const again = held ? sideB.querySelector(`[data-keep="${held}"]`) : null;
      if (again && again !== document.activeElement) { again.focus(); try { again.setSelectionRange(sel[0], sel[1]); } catch {} }
    }
    const ib = (name, title, fn) => h('button', { type: 'button', class: 'wbx-ib', title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); fn(e); }, html: I[name] });

    // ---------- Files
    async function loadDir(path) {
      const r = await host.tree(path);
      if (r?.error && path) { S.kids.delete(path); S.open.delete(path); } else if (r?.error) S.kids.set(path, { error: r.error }); else S.kids.set(path, r.entries ?? []);
      if (S.view === 'files') renderSide();
    }
    const gitMarks = () => {
      const by = new Map(), dirs = new Set();
      for (const f of S.git?.files ?? []) { if (!by.has(f.path) || !f.staged) by.set(f.path, f); let d = dirOf(f.path); while (d) { dirs.add(d); d = dirOf(d); } }
      return { by, dirs };
    };
    function renderFiles() {
      put(sideH, h('span', { class: 't' }, host.name ?? 'Files'),
        can.write ? ib('newFile', 'New file', () => startEdit('new')) : null, can.write ? ib('newDir', 'New folder', () => startEdit('newdir')) : null,
        ib('refresh', 'Refresh', () => { for (const p of [...S.kids.keys()]) loadDir(p); refreshGit(); }), ib('fold', 'Close every folder', () => { S.open = new Set(['']); renderSide(); keep(); }));
      const { by, dirs } = gitMarks();
      const rows = [];
      const editRow = (depth) => h('div', { class: 'wbx-row', style: `padding-left:${10 + depth * 12}px` }, icon(S.edit.kind === 'newdir' ? 'right' : 'file'), h('input', { 'data-keep': 'name', value: S.edit.value ?? '', 'aria-label': S.edit.kind === 'rename' ? 'New name' : 'Name', spellcheck: 'false', oninput: (e) => { if (S.edit) S.edit.value = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') commitEdit(e.target.value); else if (e.key === 'Escape') { S.edit = null; renderSide(); } e.stopPropagation(); }, onblur: (e) => { const ed = S.edit; setTimeout(() => { if (S.edit === ed && ed && !sideB.querySelector('[data-keep="name"]')?.matches(':focus')) { S.edit = null; renderSide(); } }, 120); } }));
      // a file being worked on now, or a closed folder that holds one
      const liveAt = (e) => (touched.size ? (touched.get(e.path) ?? (e.dir && !S.open.has(e.path) ? [...touched].find(([p]) => p.startsWith(`${e.path}/`))?.[1] : null) ?? null) : null);
      const walk = (path, depth) => {
        const list = S.kids.get(path);
        if (S.edit && S.edit.kind !== 'rename' && S.edit.at === path) rows.push(editRow(depth));
        if (!list) return;
        if (list.error) { rows.push(h('div', { class: 'wbx-empty' }, list.error)); return; }
        for (const e of list) {
          if (S.edit?.kind === 'rename' && S.edit.at === e.path) { rows.push(editRow(depth)); continue; }
          const g = by.get(e.path), opened = e.dir && S.open.has(e.path);
          rows.push(press({ class: `wbx-row${S.sel === e.path ? ' sel' : ''}${e.heavy ? ' dim' : ''}${g?.status === 'deleted' ? ' gone' : ''}`, style: `padding-left:${10 + depth * 12}px`, title: e.path, 'aria-expanded': e.dir ? String(opened) : null,
            onclick: () => { S.sel = e.path; if (e.dir) toggleDir(e.path); else { openFile(e.path); renderSide(); } },
            oncontextmenu: (ev) => { ev.preventDefault(); S.sel = e.path; renderSide(); fileMenu(ev, e); } },
            icon(e.dir ? (opened ? 'down' : 'right') : 'file'), h('span', { class: `nm${g ? ` wbx-c-${g.status}` : ''}` }, e.name),
            liveAt(e) ? h('span', { class: 'wbx-live', title: `${liveAt(e)} is working on this now` }) : null,
            can.write ? h('span', { class: 'acts' }, ib('pen', 'Rename', () => startEdit('rename', e)), can.trash ? ib('bin', 'Move to the Trash', () => trash(e)) : null) : null,
            g ? h('span', { class: `tag ${g.status}`, title: g.status }, g.code === '?' ? 'U' : g.code) : (e.dir && dirs.has(e.path) ? h('span', { class: 'tag changed', title: 'has changes' }, '•') : null)));
          if (opened) walk(e.path, depth + 1);
        }
      };
      walk('', 0);
      if (!S.kids.has('')) rows.push(h('div', { class: 'wbx-empty' }, 'Reading the folder…'));
      else if (!rows.length) rows.push(h('div', { class: 'wbx-empty' }, 'This folder is empty.'));
      if (S.sideSay) rows.unshift(h('div', { class: 'wbx-say bad' }, S.sideSay));
      put(sideB, ...rows);
      const inp = sideB.querySelector('input');
      if (inp && S.edit && !S.edit.shown) { S.edit.shown = true; inp.focus(); const dot = inp.value.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 ? dot : inp.value.length); }
    }
    function toggleDir(path) {
      if (S.open.has(path)) S.open.delete(path); else { S.open.add(path); if (!S.kids.has(path)) loadDir(path); }
      renderSide(); keep();
    }
    function startEdit(kind, e) {
      if (S.view !== 'files') setView('files');
      const picked = S.sel && findEntry(S.sel);
      const at = kind === 'rename' ? e.path : picked ? (picked.dir ? picked.path : dirOf(picked.path)) : '';
      if (kind !== 'rename' && at) { S.open.add(at); if (!S.kids.has(at)) loadDir(at); }
      S.edit = { kind, at, value: kind === 'rename' ? e.name : '' }; S.sideSay = null; renderSide();
    }
    const findEntry = (path) => { for (const list of S.kids.values()) if (Array.isArray(list)) { const e = list.find((x) => x.path === path); if (e) return e; } return null; };
    async function commitEdit(value) {
      const ed = S.edit; S.edit = null;
      const name = String(value ?? '').trim().replace(/^\/+|\/+$/g, '');
      if (!name) return renderSide();
      let r;
      let touched;
      if (ed.kind === 'rename') { const to = dirOf(ed.at) ? `${dirOf(ed.at)}/${name}` : name; if (to === ed.at) return renderSide(); r = await host.rename(ed.at, to); if (r?.ok) moved(ed.at, r.path ?? to); touched = [ed.at, to]; }
      else { const path = ed.at ? `${ed.at}/${name}` : name; r = await host.make(path, ed.kind === 'newdir'); if (r?.ok && ed.kind === 'new') openFile(r.path ?? path); if (r?.ok && ed.kind === 'newdir') S.open.add(r.path ?? path); touched = [path]; }
      S.sideSay = r?.ok ? null : (r?.why ?? 'That did not work.');
      if (r?.ok) changed(touched); else renderSide();
    }
    // A file that got a new name keeps its tab.
    function moved(from, to) {
      for (const doc of [...S.docs.values()]) {
        if (doc.kind !== 'file' || (doc.path !== from && !doc.path.startsWith(`${from}/`))) continue;
        for (const g of S.groups) closeTab(g, doc.key, { force: true });
        if (doc.path === from) openFile(to);
      }
    }
    async function trash(e) {
      const r = await host.trash(e.path);
      S.sideSay = r?.ok ? null : (r?.why ?? 'That did not work.');
      if (r?.ok) for (const doc of [...S.docs.values()]) if (doc.kind === 'file' && (doc.path === e.path || doc.path.startsWith(`${e.path}/`))) for (const g of S.groups) closeTab(g, doc.key, { force: true });
      changed([e.path]);
    }
    function fileMenu(ev, e) {
      const items = [];
      if (!e.dir) items.push(['Open', () => openFile(e.path)], ['Open to the side', () => openFile(e.path, { group: Math.min(S.groups.length, 2) })]);
      if (can.write) items.push(['New file…', () => startEdit('new')], ['New folder…', () => startEdit('newdir')], null, ['Rename…', () => startEdit('rename', e)], ...(can.trash ? [['Move to the Trash', () => trash(e)]] : []), null);
      items.push(['Copy path', () => navigator.clipboard?.writeText(e.path)]);
      if (host.toChat) items.push(['Name it in the chat', () => host.toChat(`@${e.path} `)]);
      for (const p of parts) { const more = p.fileMenu?.(e) ?? []; if (more.length) items.push(null, ...more); }
      showMenu(ev.clientX, ev.clientY, items);
    }
    function showMenu(x, y, items) {
      closeMenu();
      menu = h('div', { class: 'wbx-menu', role: 'menu' }, items.map((it) => (it ? h('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenu(); it[1](); } }, it[0]) : h('hr'))));
      root.append(menu);
      const r = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`; menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
      menu.querySelector('button')?.focus();
    }
    const closeMenu = () => { menu?.remove(); menu = null; };

    // ---------- Search
    function renderSearch() {
      const f = S.find;
      put(sideH, h('span', { class: 't' }, 'Search'), ib('refresh', 'Search again', runFind), ib('fold', 'Close every file', () => { f.shut = new Set((f.res?.groups ?? []).map((g) => g.path)); renderSide(); }));
      if (!sideB.querySelector('.wbx-form:not(.wbx-tform)')) {
        const tg = (label, title, k) => h('button', { type: 'button', class: `wbx-tg${f[k] ? ' on' : ''}`, title, 'aria-label': title, 'aria-pressed': String(f[k]), onclick: (e) => { f[k] = !f[k]; e.currentTarget.classList.toggle('on', f[k]); e.currentTarget.setAttribute('aria-pressed', String(f[k])); runFind(); } }, label);
        const q = h('input', { type: 'text', placeholder: 'Search', 'aria-label': 'Search every file', value: f.q, spellcheck: 'false', oninput: (e) => { f.q = e.target.value; clearTimeout(findTimer); findTimer = setTimeout(runFind, 280); }, onkeydown: (e) => { if (e.key === 'Enter') { clearTimeout(findTimer); runFind(); } } });
        const inc = h('input', { type: 'text', placeholder: 'files to include, like *.mjs, src/**', 'aria-label': 'Files to include', value: f.inc, spellcheck: 'false', oninput: (e) => { f.inc = e.target.value; clearTimeout(findTimer); findTimer = setTimeout(runFind, 400); } });
        put(sideB, h('div', { class: 'wbx-form' }, h('div', { class: 'line' }, q, tg('Aa', 'Match case', 'cs'), tg('ab', 'Whole word', 'word'), tg('.*', 'Use a pattern', 're')), h('div', { class: 'line' }, inc)), h('div', { class: 'wbx-res' }));
      }
      const out = sideB.querySelector('.wbx-res');
      if (!f.q) return put(out);
      if (f.busy && !f.res) return put(out, h('div', { class: 'wbx-note' }, 'Searching…'));
      const r = f.res;
      if (!r) return;
      if (r.error) return put(out, h('div', { class: 'wbx-say bad' }, r.error));
      const rows = [h('div', { class: 'wbx-note' }, r.total ? `${plural(r.total, 'result')} in ${plural(r.files, 'file')}${r.cut ? ` · the first ${r.hits.length} shown` : ''}` : 'Nothing found.')];
      for (const g of r.groups) {
        const shut = f.shut.has(g.path);
        rows.push(press({ class: 'wbx-row', style: 'padding-left:10px', 'aria-expanded': String(!shut), onclick: () => { if (shut) f.shut.delete(g.path); else f.shut.add(g.path); renderSide(); } }, icon(shut ? 'right' : 'down'), h('span', { class: 'nm' }, base(g.path), dirOf(g.path) ? h('span', { class: 'sub' }, `  ${dirOf(g.path)}`) : null), h('span', { class: 'tag' }, g.hits.length)));
        if (shut) continue;
        for (const hit of g.hits) {
          const t = hit.text, a = Math.max(0, hit.col - 1), b = a + hit.len, from = Math.max(0, a - 40);
          rows.push(press({ class: 'wbx-row', style: 'padding-left:30px', title: `${g.path}:${hit.line}`, onclick: () => openFile(g.path, { line: hit.line, col: hit.col, len: hit.len }) },
            h('span', { class: 'nm wbx-hit' }, from ? '…' : '', t.slice(from, a).trimStart(), h('mark', null, t.slice(a, b)), t.slice(b, b + 120))));
        }
      }
      put(out, ...rows);
    }
    async function runFind() {
      const f = S.find, asked = `${f.q}\n${f.re}${f.cs}${f.word}\n${f.inc}`;
      if (!f.q) { f.res = null; return renderSide(); }
      f.busy = true; f.asked = asked; renderSide();
      const r = await host.search({ query: f.q, regex: f.re, matchCase: f.cs, word: f.word, include: f.inc });
      if (f.asked !== asked) return;
      f.busy = false;
      const groups = []; const by = new Map();
      for (const hit of r?.hits ?? []) { let g = by.get(hit.path); if (!g) { g = { path: hit.path, hits: [] }; by.set(hit.path, g); groups.push(g); } g.hits.push(hit); }
      f.res = r?.error ? { error: r.error } : { ...r, groups };
      if (S.view === 'search') renderSide();
    }

    // ---------- Source control
    async function refreshGit() {
      if (!can.git) return;
      const r = await host.git();
      S.git = r ?? null;
      renderAct(); renderFoot(); renderWelcome();
      if (S.view === 'git' || S.view === 'files') renderSide();
    }
    const gitSoon = () => { clearTimeout(gitTimer); gitTimer = setTimeout(refreshGit, 350); };
    async function gitRun(op, args, okSay) {
      const r = await host.gitDo(op, args ?? {});
      S.gitSay = r?.ok ? (okSay ? { text: typeof okSay === 'function' ? okSay(r) : okSay } : null) : { text: r?.why ?? 'git did not do that.', bad: true };
      S.pushAsk = false;
      await refreshGit();
      if (op === 'checkout' || op === 'branch' || op === 'discard') changed(null);
      return r;
    }
    function renderGit() {
      const g = S.git;
      put(sideH, h('span', { class: 't' }, 'Source control'), ib('refresh', 'Refresh', refreshGit));
      if (!g) return put(sideB, h('div', { class: 'wbx-empty' }, 'Reading the changes…'));
      if (!g.repo) return put(sideB, h('div', { class: 'wbx-empty' }, 'This folder is not in a git repository. ', can.write ? h('button', { type: 'button', onclick: () => gitRun('init', {}, 'A new repository is here.') }, 'Make it one') : null), S.gitSay ? h('div', { class: `wbx-say${S.gitSay.bad ? ' bad' : ''}` }, S.gitSay.text) : null);
      if (g.error) return put(sideB, h('div', { class: 'wbx-say bad' }, g.error));
      const staged = g.files.filter((f) => f.staged), loose = g.files.filter((f) => !f.staged);
      const rows = [];
      rows.push(h('div', { class: 'wbx-branch' }, can.branch ? h('button', { type: 'button', title: 'Switch branch', onclick: pickBranch }, h('span', { html: I.branch }), g.branch ?? 'no branch') : h('span', { class: 'nm' }, h('span', { html: I.branch }), ' ', g.branch ?? 'no branch'), g.since ? h('span', null, `since ${g.since}`) : g.upstream ? h('span', null, `${g.ahead ? `↑${g.ahead} ` : ''}${g.behind ? `↓${g.behind}` : ''}`) : h('span', null, g.remote === false ? 'on this computer only' : 'not pushed yet')));
      if (g.say) rows.push(h('div', { class: 'wbx-say' }, g.say));
      // what the host offers in place of a commit box of its own (asks: [[label, fn, cls]])
      if (g.asks?.length) rows.push(h('div', { class: 'wbx-btns wbx-asks' }, g.asks.map(([label, fn, cls]) => h('button', { type: 'button', class: `wbx-btn ${cls ?? 'plain'}`, onclick: () => fn?.() }, label))));
      if (can.write && can.commit) {
        const box = h('textarea', { 'data-keep': 'commit', placeholder: `What changed (${key('⌘', '↵')} commits)`, 'aria-label': 'Commit message', oninput: (e) => { S.message = e.target.value; btn.disabled = !canCommit(); }, onkeydown: (e) => { if (e.key === 'Enter' && (MAC ? e.metaKey : e.ctrlKey)) { e.preventDefault(); commit(); } } });
        box.value = S.message;
        const canCommit = () => Boolean(S.message.trim()) && Boolean(g.files.length);
        const btn = h('button', { type: 'button', class: 'wbx-btn', onclick: commit }, staged.length ? `Commit ${plural(staged.length, 'file')}` : 'Commit everything');
        btn.disabled = !canCommit();
        const push = can.push && g.remote !== false && (g.ahead > 0 || (!g.upstream && !g.detached && g.branch)) ? (S.pushAsk
          ? h('div', { class: 'wbx-say' }, g.upstream ? `Push ${plural(g.ahead, 'commit')} to ${g.upstream}? It leaves this computer.` : `Push ${g.branch} to origin for the first time? It leaves this computer.`, h('div', { class: 'wbx-btns' }, h('button', { type: 'button', class: 'wbx-btn', onclick: () => gitRun('push', {}, 'Pushed.') }, 'Push'), h('button', { type: 'button', class: 'wbx-btn plain', onclick: () => { S.pushAsk = false; renderSide(); } }, 'Not now')))
          : h('button', { type: 'button', class: 'wbx-btn plain', onclick: () => { S.pushAsk = true; renderSide(); } }, g.upstream ? `Push ${plural(g.ahead, 'commit')}…` : 'Push this branch…')) : null;
        rows.push(h('div', { class: 'wbx-commit' }, box, h('div', { class: 'wbx-btns' }, btn, push && !S.pushAsk ? push : null)), S.pushAsk ? push : null);
      }
      for (const p of parts) rows.push(...(p.gitRows?.(g) ?? []));
      if (S.gitSay) rows.push(h('div', { class: `wbx-say${S.gitSay.bad ? ' bad' : ''}` }, S.gitSay.text));
      const list = (title, files, isStaged) => {
        if (!files.length) return;
        rows.push(h('div', { class: 'wbx-sec' }, h('span', { class: 't' }, title), h('span', { class: 'n' }, files.length),
          can.write && can.stage ? (isStaged ? ib('minus', 'Take everything out of the commit', () => gitRun('unstage', { all: true })) : ib('plus', 'Put everything in the commit', () => gitRun('stage', { all: true }))) : null));
        for (const f of files) {
          const asked = S.discard === f.path && !isStaged;
          rows.push(press({ class: `wbx-row${f.status === 'deleted' ? ' gone' : ''}`, style: 'padding-left:14px', title: `${f.path} · ${f.status}`, onclick: () => (f.status === 'deleted' && !isStaged ? openDiff(f.path, isStaged) : f.status === 'new' ? openFile(f.path) : openDiff(f.path, isStaged)) },
            h('span', { class: 'nm' }, base(f.path), dirOf(f.path) ? h('span', { class: 'sub' }, `  ${dirOf(f.path)}`) : null),
            can.write ? h('span', { class: 'acts' }, f.status !== 'deleted' ? ib('open', 'Open the file', () => openFile(f.path)) : null,
              isStaged ? (can.stage ? ib('minus', 'Take out of the commit', () => gitRun('unstage', { path: f.path })) : null) : [ib('undo', f.status === 'new' ? (can.trash ? 'Move to the Trash' : 'Take it away') : 'Put back as it was', () => { S.discard = f.path; renderSide(); }), can.stage ? ib('plus', 'Put in the commit', () => gitRun('stage', { path: f.path })) : null]) : null,
            h('span', { class: `tag ${f.status}`, title: f.status }, f.code === '?' ? 'U' : f.code)));
          if (asked) rows.push(h('div', { class: 'wbx-say' }, f.status === 'new' ? (can.trash ? `Move ${base(f.path)} to the Trash?` : `Take ${base(f.path)} away? It was made since ${g.since ?? 'the last commit'} and does not come back.`) : `Put ${base(f.path)} back as it was ${g.since ? `at ${g.since}` : 'at the last commit'}? Your changes to it go.`, h('div', { class: 'wbx-btns' }, h('button', { type: 'button', class: 'wbx-btn danger', onclick: () => { S.discard = null; gitRun('discard', { path: f.path }); } }, f.status === 'new' ? (can.trash ? 'Move to the Trash' : 'Take it away') : 'Put it back'), h('button', { type: 'button', class: 'wbx-btn plain', onclick: () => { S.discard = null; renderSide(); } }, 'Keep it'))));
        }
      };
      list('In the commit', staged, true); list('Changes', loose, false);
      if (!g.files.length) rows.push(h('div', { class: 'wbx-empty' }, g.since ? `Nothing has changed since ${g.since}.` : 'Nothing has changed since the last commit.'));
      if (g.elsewhere) rows.push(h('div', { class: 'wbx-note' }, `${plural(g.elsewhere, 'change')} elsewhere in this repository, outside this folder.`));
      put(sideB, ...rows.filter(Boolean));
    }
    async function commit() {
      const g = S.git;
      if (!S.message.trim() || !g?.files?.length) return;
      const all = !g.files.some((f) => f.staged);
      const r = await gitRun('commit', { message: S.message, all }, (x) => `Committed${x.commit ? ` as ${x.commit}` : ''}.`);
      if (r?.ok) { S.message = ''; renderSide(); }
    }
    async function pickBranch() {
      const r = await host.gitDo('branches', {});
      if (!r?.ok) { S.gitSay = { text: r?.why ?? 'git gave no branches.', bad: true }; return renderSide(); }
      const items = r.branches.map((b) => ({ title: b.name, sub: `${b.current ? 'here now · ' : ''}${b.when ?? ''} · ${b.subject ?? ''}`, run: () => (b.current ? null : gitRun('checkout', { name: b.name }, `On ${b.name} now.`)) }));
      pick({ placeholder: 'Switch to a branch, or type a new name', items, make: can.write ? (name) => ({ title: `Make the branch "${name}" from here`, run: () => gitRun('branch', { name }, `On the new branch ${name}.`) }) : null });
    }

    // ---------- the editor: files as tabs, in groups side by side
    const docOf = (k) => S.docs.get(k);
    const lang = (doc) => doc?.model?.getLanguageId?.() ?? (doc?.path?.includes('.') ? doc.path.split('.').pop() : 'text');
    function makeGroup() {
      const g = { tabs: [], active: null, views: new Map(), editor: null, diff: null };
      g.tabsEl = h('div', { class: 'wbx-tabs', role: 'tablist' });
      g.barEl = h('div', { class: 'wbx-bar' }); g.barEl.hidden = true;
      g.crumbs = h('div', { class: 'wbx-crumbs' });
      g.codeEl = h('div'); g.diffEl = h('div'); g.msgEl = h('div', { class: 'wbx-msg' }); g.extEl = h('div', { class: 'wbx-kind' });
      g.plainEl = h('textarea', { spellcheck: 'false', 'aria-label': 'File', oninput: () => { const d = docOf(g.active); if (d && d.kind === 'file' && !S.monaco) { d.text = g.plainEl.value; setDirty(d, d.text !== d.saved); } }, onkeydown: (e) => { if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey && !g.plainEl.readOnly) { e.preventDefault(); const a = g.plainEl.selectionStart; g.plainEl.setRangeText('  ', a, g.plainEl.selectionEnd, 'end'); g.plainEl.dispatchEvent(new Event('input')); } }, onkeyup: renderFoot, onclick: renderFoot });
      g.el = h('div', { class: 'wbx-group' }, g.tabsEl, g.barEl, g.crumbs, h('div', { class: 'wbx-ed' }, g.codeEl, g.diffEl, g.plainEl, g.msgEl, g.extEl));
      g.el.addEventListener('pointerdown', () => focusGroup(g), true);
      groupsEl.append(g.el); S.groups.push(g);
      return g;
    }
    function focusGroup(g) { const i = S.groups.indexOf(g); if (i < 0 || i === S.focus) return; S.focus = i; for (const x of S.groups) x.el.classList.toggle('focus', x === g); renderFoot(); }
    function dropGroup(g) {
      const i = S.groups.indexOf(g); if (i < 0) return;
      g.editor?.dispose(); g.diff?.dispose(); g.el.remove(); S.groups.splice(i, 1);
      S.focus = Math.max(0, Math.min(S.focus, S.groups.length - 1));
      for (const x of S.groups) x.el.classList.toggle('focus', x === S.groups[S.focus]);
    }
    const now = () => S.groups[S.focus] ?? null;
    const nowDoc = () => docOf(now()?.active);
    function setDirty(doc, dirty) { if (doc.dirty === dirty) return; doc.dirty = dirty; for (const g of S.groups) if (g.tabs.includes(doc.key)) renderTabs(g); }
    function renderTabs(g) {
      const names = new Map(); for (const k of g.tabs) { const d = docOf(k); if (d) names.set(d.name, (names.get(d.name) ?? 0) + 1); }
      const tabs = g.tabs.map((k) => {
        const d = docOf(k); if (!d) return null;
        return press({ role: 'tab', class: `wbx-tab${k === g.active ? ' on' : ''}`, 'aria-selected': String(k === g.active), title: d.path + (d.kind === 'diff' ? (d.staged ? ' (in the commit)' : ' (changes)') : ''),
          onclick: () => { g.active = k; show(g); keep(); }, onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(g, k); } } },
          h('span', { class: 'nm' }, d.name, d.kind === 'diff' ? (d.staged ? ' ↔ commit' : ' ↔ changes') : ''), names.get(d.name) > 1 && dirOf(d.path) ? h('span', { class: 'dir' }, base(dirOf(d.path))) : null,
          d.dirty ? h('span', { class: 'dot', title: 'Not saved' }) : null,
          h('button', { type: 'button', class: 'x', 'aria-label': `Close ${d.name}`, title: `Close ${key('⌘', 'W')}`, onclick: (e) => { e.stopPropagation(); closeTab(g, k); }, html: I.x }));
      });
      put(g.tabsEl, ...tabs.filter(Boolean), h('span', { class: 'more' }, S.groups.length < 3 && g.active ? ib('split', `Split to the side ${key('⌘', '\\')}`, () => splitRight(g)) : null));
    }
    function bar(g, text, buttons) {
      if (!text) { g.barEl.hidden = true; put(g.barEl); return; }
      g.barEl.hidden = false;
      put(g.barEl, h('span', { class: 't' }, text), h('span', { class: 'wbx-btns' }, buttons.map(([label, fn, cls]) => h('button', { type: 'button', class: `wbx-btn ${cls ?? 'plain'}`, onclick: () => { bar(g, null); fn?.(); } }, label))));
    }
    function note(g, text) { for (const el of [g.codeEl, g.diffEl, g.plainEl, g.extEl]) el.hidden = true; g.msgEl.hidden = false; g.msgEl.textContent = text; }
    // Draw a group's open tab: the file in the editor part (its place and selection kept per tab), a change's two
    // sides in the diff view, or a line saying why there is nothing to draw.
    function show(g, at) {
      const doc = docOf(g.active);
      renderTabs(g); bar(g, null);
      g.crumbs.textContent = doc ? doc.path.split('/').join(' › ') : '';
      g.crumbs.hidden = !doc;
      for (const el of [g.codeEl, g.diffEl, g.plainEl, g.msgEl, g.extEl]) el.hidden = true;
      renderFoot();
      if (!doc) return;
      // a part's own kind of tab (a page in the browser), drawn by it
      const kind = kinds[doc.kind];
      if (kind) { g.extEl.hidden = false; if (g.extEl.dataset.doc !== doc.key) { g.extEl.dataset.doc = doc.key; put(g.extEl); } kind.show(g, doc, g.extEl); return; }
      if (doc.loading) return note(g, 'Opening…');
      if (doc.error) return note(g, doc.error);
      if (doc.binary) return note(g, `${doc.name} is not text${doc.size ? ` (${size(doc.size)})` : ''}, so there is nothing to edit here.`);
      if (doc.cut) bar(g, `${doc.name} is ${size(doc.size)}: its first part is shown, and it cannot be saved from here.`, [['OK']]);
      if (doc.stale) staleBar(g, doc);
      const m = S.monaco;
      if (doc.kind === 'diff') {
        if (!m) { g.plainEl.hidden = false; g.plainEl.readOnly = true; g.plainEl.value = doc.after ?? ''; return; }
        g.diffEl.hidden = false;
        if (!g.diff) g.diff = m.editor.createDiffEditor(g.diffEl, { ...edOpts(), readOnly: true, originalEditable: false, renderSideBySide: g.el.clientWidth > 720, minimap: { enabled: false } });
        g.diff.setModel({ original: doc.before, modified: doc.model });
        return;
      }
      if (!m) { g.plainEl.hidden = false; g.plainEl.readOnly = !can.write || Boolean(doc.cut); if (g.plainEl.value !== doc.text) g.plainEl.value = doc.text ?? ''; if (at?.line) { const off = doc.text.split('\n').slice(0, at.line - 1).join('\n').length + (at.line > 1 ? 1 : 0) + ((at.col ?? 1) - 1); g.plainEl.focus(); g.plainEl.setSelectionRange(off, off + (at.len ?? 0)); } return; }
      g.codeEl.hidden = false;
      if (!g.editor) {
        g.editor = m.editor.create(g.codeEl, { ...edOpts(), model: null, readOnly: !can.write });
        g.editor.onDidFocusEditorText(() => focusGroup(g));
        g.editor.onDidChangeCursorPosition(renderFoot);
        g.editor.addAction({ id: 'wb.toChat', label: 'Add the selection to the chat', contextMenuGroupId: '9_cutcopypaste', contextMenuOrder: 9, precondition: host.toChat ? undefined : 'false', run: (ed) => toChat(ed) });
        for (const p of parts) p.editor?.(g);
      }
      const was = g.editor.getModel();
      if (was && g.shown && g.shown !== doc.key) g.views.set(g.shown, g.editor.saveViewState());
      if (was !== doc.model) { g.editor.setModel(doc.model); const v = g.views.get(doc.key); if (v) g.editor.restoreViewState(v); }
      g.shown = doc.key;
      g.editor.updateOptions({ readOnly: !can.write || Boolean(doc.cut) });
      if (at?.line) { const range = new m.Range(at.line, at.col ?? 1, at.line, (at.col ?? 1) + (at.len ?? 0)); g.editor.setSelection(range); g.editor.revealRangeInCenterIfOutsideViewport(range); }
      if (at?.focus !== false) g.editor.focus();
    }
    const edOpts = () => window.WorkbenchKit.edOpts(root, S, opts);
    function toChat(ed) {
      const doc = nowDoc(); const sel = ed.getSelection(); const text = ed.getModel().getValueInRange(sel);
      if (!doc || !host.toChat) return;
      host.toChat(text.trim() ? `${doc.path}:${sel.startLineNumber}${sel.endLineNumber !== sel.startLineNumber ? `-${sel.endLineNumber}` : ''}\n\`\`\`${lang(doc)}\n${text}\n\`\`\`\n` : `@${doc.path} `);
    }
    function staleBar(g, doc) {
      bar(g, `${doc.name} changed on disk while you have changes that are not saved.`, [['Compare', () => openDiff(doc.path, false)], ['Take the disk\'s', () => reload(doc, true)], ['Keep mine', () => { doc.stale = false; doc.stamp = doc.diskStamp ?? doc.stamp; }]]);
    }
    async function loadDoc(doc) {
      const m = S.monaco;
      if (doc.kind === 'diff') {
        const r = await host.diff(doc.path, doc.staged);
        doc.loading = false;
        if (r?.error) doc.error = r.error; else if (r?.binary) doc.binary = true;
        else if (m) { doc.before = m.editor.createModel(r.before ?? '', undefined, m.Uri.from({ scheme: 'wbx-before', path: `/${doc.key}/${doc.path}` })); doc.model = m.editor.createModel(r.after ?? '', undefined, m.Uri.from({ scheme: 'wbx-after', path: `/${doc.key}/${doc.path}` })); }
        else doc.after = r.after ?? '';
      } else {
        const r = await host.read(doc.path);
        doc.loading = false;
        if (r?.error) doc.error = r.error; else if (r?.binary) { doc.binary = true; doc.size = r.size; }
        else {
          doc.stamp = r.stamp; doc.cut = Boolean(r.cut); doc.size = r.size;
          // a file a part changed, not saved yet (a rename across files), keeps that text
          const mine = parts.some((p) => p.edited?.(doc.path));
          if (m) { doc.model = modelFor(m, doc.path, r.text ?? '', mine); doc.savedId = mine ? -1 : doc.model.getAlternativeVersionId(); doc.model.onDidChangeContent(() => setDirty(doc, doc.model.getAlternativeVersionId() !== doc.savedId)); if (mine) setDirty(doc, true); }
          else { doc.text = r.text ?? ''; doc.saved = doc.text; }
        }
      }
      if (doc.model && doc.kind === 'file') for (const p of parts) p.model?.(doc);
      for (const g of S.groups) if (g.active === doc.key) show(g, doc.at);
      doc.at = null;
    }
    function place(doc, o = {}) {
      while (S.groups.length <= (o.group ?? 0) && S.groups.length < 3) makeGroup();
      const g = S.groups[Math.min(o.group ?? S.focus, S.groups.length - 1)] ?? makeGroup();
      if (!g.tabs.includes(doc.key)) g.tabs.push(doc.key);
      g.active = doc.key; focusGroup(g);
      for (const x of S.groups) x.el.classList.toggle('focus', x === S.groups[S.focus]);
      // a narrow place (opts.narrow) shows the side pane or the file, never both: opening one puts the pane away
      if (opts.narrow && S.view && o.focus !== false) { S.view = null; renderAct(); }
      layout();
      if (doc.loading) { doc.at = o.line ? o : doc.at; show(g); } else show(g, o.line ? o : { focus: o.focus });
      keep();
    }
    // a file's model: one a part made (the language service's) with the disk's text, else a new one
    function modelFor(m, path, text, keepIt = false) {
      const uri = m.Uri.from({ scheme: 'file', path: `/${path}` });
      const had = m.editor.getModel(uri);
      if (!had) return m.editor.createModel(text, undefined, uri);
      if (!keepIt && had.getValue() !== text) had.setValue(text);
      return had;
    }
    // a tab of a part's own kind (kinds[doc.kind].show)
    function openDoc(doc, o = {}) { const had = docOf(doc.key); if (!had) S.docs.set(doc.key, doc); place(had ?? doc, o); return had ?? doc; }
    function openFile(path, o = {}) {
      const k = `f:${path}`;
      let doc = docOf(k);
      if (!doc) { doc = { key: k, kind: 'file', path, name: base(path), loading: true }; S.docs.set(k, doc); loadDoc(doc); }
      S.recent = [path, ...S.recent.filter((p) => p !== path)].slice(0, 30);
      place(doc, o);
    }
    function openDiff(path, staged) {
      const k = `d:${staged ? 's' : 'w'}:${path}`;
      let doc = docOf(k);
      if (doc && !doc.loading) { doc.before?.dispose(); doc.model?.dispose(); doc.loading = true; doc.error = null; loadDoc(doc); }
      if (!doc) { doc = { key: k, kind: 'diff', path, staged: Boolean(staged), name: base(path), loading: true }; S.docs.set(k, doc); loadDoc(doc); }
      place(doc);
    }
    async function saveDoc(doc, { force = false } = {}) {
      if (!doc || doc.kind !== 'file' || doc.cut || !can.write || doc.loading || doc.error) return false;
      const text = doc.model ? doc.model.getValue() : doc.text;
      const id = doc.model?.getAlternativeVersionId();
      const r = await host.save(doc.path, text, doc.stamp ?? null, force);
      const g = S.groups.find((x) => x.active === doc.key) ?? now();
      if (!r?.ok) {
        if (r?.changed && g) bar(g, `${doc.name} changed on disk since you opened it.`, [['Compare', () => openDiff(doc.path, false)], ['Save mine over it', () => saveDoc(doc, { force: true }), 'danger'], ['Take the disk\'s', () => reload(doc, true)]]);
        else if (g) bar(g, r?.why ?? `${doc.name} was not saved.`, [['OK']]);
        return false;
      }
      doc.stamp = r.stamp; doc.stale = false; doc.savedAt = Date.now();
      if (doc.model) doc.savedId = id; else doc.saved = text;
      setDirty(doc, doc.model ? doc.model.getAlternativeVersionId() !== doc.savedId : doc.text !== doc.saved);
      S.checks.set(doc.path, r.problems ?? []);
      renderProblems(); renderAct(); gitSoon();
      return true;
    }
    async function reload(doc, force) {
      const r = await host.read(doc.path);
      if (r?.gone) { doc.stale = false; return; }
      if (r?.error || r?.binary) return;
      if (doc.dirty && !force) { if (r.stamp !== doc.stamp) { doc.stale = true; doc.diskStamp = r.stamp; for (const g of S.groups) if (g.active === doc.key) staleBar(g, doc); } return; }
      doc.stamp = r.stamp; doc.stale = false;
      if (doc.model) { if (doc.model.getValue() !== r.text) doc.model.setValue(r.text ?? ''); doc.savedId = doc.model.getAlternativeVersionId(); }
      else { doc.text = r.text ?? ''; doc.saved = doc.text; for (const g of S.groups) if (g.active === doc.key) g.plainEl.value = doc.text; }
      setDirty(doc, false);
    }
    function closeTab(g, k, { force = false } = {}) {
      const doc = docOf(k); if (!g.tabs.includes(k)) return;
      const elsewhere = S.groups.some((x) => x !== g && x.tabs.includes(k));
      if (doc?.dirty && !force && !elsewhere) { g.active = k; show(g); return bar(g, `${doc.name} has changes that are not saved.`, [['Save', async () => { if (await saveDoc(doc)) closeTab(g, k, { force: true }); }, ''], ['Don\'t save', () => closeTab(g, k, { force: true })], ['Cancel']]); }
      const i = g.tabs.indexOf(k);
      g.tabs.splice(i, 1); g.views.delete(k);
      if (g.active === k) g.active = g.tabs[Math.min(i, g.tabs.length - 1)] ?? null;
      if (g.shown === k) { g.shown = null; g.editor?.setModel(null); }
      // a model a part keeps (the language service's) stays, with the disk's text
      if (!elsewhere && doc) { if (g.diff && doc.kind === 'diff') g.diff.setModel(null); if (doc.kind === 'file' && doc.model && parts.some((p) => p.keeps?.(doc.path))) { if (doc.dirty) reloadModel(doc); } else doc.model?.dispose(); doc.before?.dispose(); doc.dispose?.(); S.docs.delete(k); S.checks.delete(doc.path); }
      if (!g.tabs.length && S.groups.length > 1) dropGroup(g); else show(g, { focus: false });
      layout(); renderProblems(); keep();
    }
    const reloadModel = (doc) => host.read(doc.path).then((r) => { if (typeof r?.text === 'string' && !doc.model.isDisposed()) doc.model.setValue(r.text); });
    function splitRight(g = now()) {
      const doc = docOf(g?.active); if (!doc || S.groups.length >= 3) return;
      const n = makeGroup(); n.tabs.push(doc.key); n.active = doc.key; focusGroup(n);
      for (const x of S.groups) renderTabs(x);
      show(n); layout();
    }

    // ---------- the bottom panel: Problems and the terminal
    function problems() {
      const out = [];
      for (const [path, list] of S.checks) for (const p of list ?? []) out.push({ ...p, path, from: 'check' });
      for (const p of S.marks) if (!out.some((x) => x.path === p.path && x.line === p.line)) out.push(p);
      return out.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    }
    function readMarks() {
      const m = S.monaco; if (!m) return;
      S.marks = m.editor.getModelMarkers({}).filter((k) => k.resource.scheme === 'file' && k.severity >= m.MarkerSeverity.Warning).map((k) => ({ path: k.resource.path.replace(/^\//, ''), line: k.startLineNumber, col: k.startColumn, message: k.message, severity: k.severity >= m.MarkerSeverity.Error ? 'error' : 'warning', from: k.source || 'editor' }));
      renderProblems(); renderAct(); renderFoot();
    }
    // ---------- parts: tools in files of their own (window.WorkbenchParts: api → { id, views, panels, kinds, … }).
    const api = {
      S, h, put, icon, ib, press, key, plural, base, dirOf, size, host, can, root, fuzzy, colourOf,
      addIcons: (more) => { I = { ...more, ...I }; }, inside: (el) => inside(el), mainOpen: () => mainOpen(),
      openFile, openDiff, openDoc, place, setView, togglePanel, renderSide, renderAct, renderFoot, renderPanel, layout, bar, notice, showMenu, pick, palette,
      saveDoc, saveAll: () => saveAll(), docOf, now: () => now(), nowDoc: () => nowDoc(), groups: () => S.groups, changed, refreshGit, gitRun, problems, touch, settle, lang, modelFor,
      monaco: () => S.monaco, part: (id) => parts.find((p) => p.id === id) ?? null,
    };
    const parts = (window.WorkbenchParts ?? []).map((make) => { try { return make(api); } catch (e) { console.error('workbench part', e); return null; } }).filter(Boolean);
    const kinds = Object.assign({}, ...parts.map((p) => p.kinds ?? {}));
    function partViews() { return parts.flatMap((p) => p.views ?? []).filter((v) => !v.when || v.when()); }
    function partView(id) { return id ? partViews().find((v) => v.id === id && !v.run) ?? null : null; }

    // The host's own panels beside Problems and the terminal (host.panels: [{ id, title, mount(box) → { dispose }? }]),
    // each drawn into a box of its own the first time it is shown, and kept. A part's panels come after them.
    const extras = [...(host.panels ?? []), ...parts.flatMap((p) => p.panels ?? [])].filter((p) => p?.id && p.mount).map((p) => ({ ...p, el: null, h: null }));
    const extra = (id) => extras.find((x) => x.id === id) ?? null;
    function showExtra(id) {
      for (const x of extras) {
        if (x.id !== id) { if (x.el) x.el.hidden = true; continue; }
        if (!x.el) { x.el = h('div', { class: 'wbx-extra' }); panelB.append(x.el); x.h = x.mount(x.el) ?? null; }
        x.el.hidden = false;
      }
    }
    function togglePanel(which) {
      if (which && S.panel === which) which = null;
      S.panel = which === undefined ? (S.panel ? null : (S.lastPanel ?? (host.terminal ? 'terminal' : 'problems'))) : which;
      if (S.panel) S.lastPanel = S.panel;
      layout(); renderAct(); renderPanel();
    }
    // The panel's head: its tabs on one line, then the front tab's icons; a part's panel shows its tab once it has something (when).
    function renderPanelHead() {
      if (!S.panel) return;
      const n = problems().length;
      const tab = (id, label, count) => h('button', { type: 'button', class: `wbx-ptab${S.panel === id ? ' on' : ''}`, role: 'tab', 'aria-selected': String(S.panel === id), onclick: () => { S.panel = id; S.lastPanel = id; renderPanel(); renderAct(); keep(); } }, label, count ? h('span', { class: 'n' }, count) : null);
      const term = S.panel === 'terminal';
      put(panelH, h('div', { class: 'wbx-ptabs', role: 'tablist' }, tab('problems', 'Problems', n), host.terminal ? tab('terminal', 'Terminal') : null, extras.filter((x) => !x.when || x.when() || S.panel === x.id).map((x) => tab(x.id, x.title))),
        h('div', { class: 'wbx-pacts' }, parts.flatMap((p) => p.panelActs?.(S.panel, S.term) ?? []),
          term && S.terms.length > 1 ? h('span', { class: 'wbx-tlist' }, S.terms.map((t) => h('button', { type: 'button', class: `wbx-tnum${t === S.term ? ' on' : ''}`, title: `Terminal ${t.n}`, onclick: () => showTerm(t) }, h('span', { html: I.panel }), t.n))) : null,
          term ? ib('plus', 'New terminal', newTerm) : null, term && S.term?.h?.clear ? ib('clear', 'Clear the terminal', () => S.term.h.clear()) : null, term && S.term ? ib('bin', 'End this terminal', () => endTerm(S.term)) : null,
          h('span', { class: 'sep' }), ib(S.panelMax ? 'restore' : 'max', S.panelMax ? 'Give the files their room back' : 'The panel the whole height', () => { S.panelMax = !S.panelMax; layout(); renderPanelHead(); requestAnimationFrame(() => S.term?.h?.fit?.()); }),
          ib('x', `Close the panel ${key('⌘', 'J')}`, () => togglePanel(null))));
    }
    function renderPanel() {
      if (!S.panel) return;
      renderPanelHead();
      // a panel kept from last time that this host no longer has
      if (S.panel !== 'problems' && S.panel !== 'terminal' && !extra(S.panel)) S.panel = 'problems';
      if (S.panel === 'terminal' && !host.terminal) S.panel = 'problems';
      if (S.panel === 'problems') { for (const t of S.terms) t.el.hidden = true; showExtra(null); renderProblems(); }
      else if (extra(S.panel)) { for (const t of S.terms) t.el.hidden = true; panelB.querySelector('.wbx-plist')?.remove(); renderPanelHead(); showExtra(S.panel); }
      else { showExtra(null); panelB.querySelector('.wbx-plist')?.remove(); if (!S.terms.length) newTerm(); else showTerm(S.term ?? S.terms[0]); }
    }
    function renderProblems() {
      renderPanelHead();
      if (S.panel !== 'problems') return;
      const list = problems();
      let box = panelB.querySelector('.wbx-plist'); if (!box) { box = h('div', { class: 'wbx-plist' }); panelB.append(box); }
      if (!list.length) return put(box, h('div', { class: 'wbx-empty' }, 'No problems in the files you have open or saved here.'));
      const rows = []; let last = null;
      for (const p of list) {
        if (p.path !== last) { last = p.path; rows.push(h('div', { class: 'wbx-row wbx-file' }, icon('file'), h('span', { class: 'nm' }, base(p.path), dirOf(p.path) ? h('span', { class: 'sub' }, `  ${dirOf(p.path)}`) : null), h('span', { class: 'tag' }, list.filter((x) => x.path === p.path).length))); }
        rows.push(press({ class: 'wbx-row', style: 'padding-left:30px', onclick: () => openFile(p.path, { line: p.line, col: p.col }) }, h('span', { class: `ic ${p.severity === 'error' ? 'wbx-c-deleted' : 'wbx-c-changed'}`, html: p.severity === 'error' ? I.err : I.warn }), h('span', { class: 'nm' }, p.message, h('span', { class: 'sub' }, `  line ${p.line}${p.col > 1 ? `, column ${p.col}` : ''}`)), h('span', { class: 'acts' }, parts.flatMap((x) => x.problemActs?.(p) ?? []))));
      }
      put(box, ...rows);
    }
    function newTerm() {
      if (!host.terminal) return;
      const t = { n: ++S.termN, el: h('div', { class: 'wbx-term' }) };
      panelB.append(t.el); S.terms.push(t);
      t.h = host.terminal.create(t.el, { ended: () => endTerm(t, true) });
      showTerm(t);
    }
    function showTerm(t) {
      S.term = t; S.panel = 'terminal';
      for (const x of S.terms) x.el.hidden = x !== t;
      showExtra(null); renderPanelHead();
      requestAnimationFrame(() => { t?.h?.fit?.(); t?.h?.focus?.(); });
    }
    function endTerm(t, gone) {
      const i = S.terms.indexOf(t); if (i < 0) return;
      S.terms.splice(i, 1); if (!gone) t.h?.dispose?.(); t.el.remove();
      if (S.term === t) S.term = S.terms[Math.max(0, i - 1)] ?? null;
      if (S.panel === 'terminal') { if (S.term) { renderPanel(); } else togglePanel(null); }
    }

    // ---------- the status line
    function renderFoot() {
      const g = S.git, doc = nowDoc(), grp = now();
      const list = problems(), bad = list.filter((p) => p.severity === 'error').length, warn = list.length - bad;
      const pos = doc?.kind === 'file' ? (grp?.editor && S.monaco ? grp.editor.getPosition() : null) : null;
      let where = pos ? `Ln ${pos.lineNumber}, Col ${pos.column}` : null;
      if (!where && doc?.kind === 'file' && !S.monaco && grp && !grp.plainEl.hidden) { const before = grp.plainEl.value.slice(0, grp.plainEl.selectionStart); where = `Ln ${before.split('\n').length}, Col ${before.length - before.lastIndexOf('\n')}`; }
      put(foot,
        g?.repo && g.branch ? h('button', { type: 'button', title: can.branch ? 'Switch branch' : 'Source control', onclick: can.branch ? pickBranch : () => setView('git') }, h('span', { html: I.branch }), g.branch, g.files?.length ? ` · ${plural(g.files.length, 'change')}` : '') : null,
        h('button', { type: 'button', class: bad ? 'bad' : '', title: 'Problems', onclick: () => togglePanel('problems') }, h('span', { html: I.err }), bad, ' ', h('span', { html: I.warn }), warn),
        parts.flatMap((p) => p.foot?.() ?? []),
        h('span', { class: 'gap' }),
        where ? h('button', { type: 'button', title: 'Go to a line', onclick: () => palette(':') }, where) : null,
        doc?.kind === 'file' && !doc.loading && !doc.error && !doc.binary ? h('span', null, lang(doc)) : null,
      );
    }

    // ---------- the palette: Go to file, a command, a line, or a list to pick from
    const commands = () => {
      const ed = () => now()?.editor;
      const list = [
        ['Go to File…', key('⌘', 'P'), () => palette('')], ['Go to Line…', key('⌃', 'G'), () => palette(':')],
        ['View: Files', key('⇧', '⌘', 'E'), () => setView('files')], ['View: Search', key('⇧', '⌘', 'F'), () => setView('search')],
        can.git ? ['View: Source Control', key('⌃', '⇧', 'G'), () => setView('git')] : null,
        ['View: Close the Side Pane', '', () => setView(null)], ['View: Problems', key('⇧', '⌘', 'M'), () => togglePanel('problems')],
        ...extras.map((x) => [`View: ${x.title}`, '', () => { if (S.panel !== x.id) togglePanel(x.id); }]),
        host.terminal ? ['Terminal: Show', key('⌃', '`'), () => togglePanel('terminal')] : null, host.terminal ? ['Terminal: New', '', () => { S.panel = 'terminal'; layout(); renderPanel(); newTerm(); renderPanel(); }] : null,
        ['View: Close the Panel', key('⌘', 'J'), () => togglePanel(null)],
        can.write ? ['File: Save', key('⌘', 'S'), () => saveDoc(nowDoc())] : null, can.write ? ['File: Save All', key('⌥', '⌘', 'S'), saveAll] : null,
        can.write ? ['File: New File…', '', () => startEdit('new')] : null, can.write ? ['File: New Folder…', '', () => startEdit('newdir')] : null,
        ['View: Close Editor', key('⌘', 'W'), () => now()?.active && closeTab(now(), now().active)], ['View: Close All Editors', '', () => { for (const g of [...S.groups]) for (const k of [...g.tabs]) closeTab(g, k); }],
        ['View: Split Editor to the Side', key('⌘', '\\'), () => splitRight()],
        ['View: Word Wrap On or Off', key('⌥', 'Z'), () => { S.wrap = !S.wrap; for (const g of S.groups) g.editor?.updateOptions({ wordWrap: S.wrap ? 'on' : 'off' }); keep(); }],
        ['View: Minimap On or Off', '', () => { S.minimap = !S.minimap; for (const g of S.groups) g.editor?.updateOptions({ minimap: { enabled: S.minimap } }); keep(); }],
        S.monaco ? ['Edit: Find in This File', key('⌘', 'F'), () => ed()?.getAction('actions.find')?.run()] : null, S.monaco ? ['Edit: Replace in This File', key('⌥', '⌘', 'F'), () => ed()?.getAction('editor.action.startFindReplaceAction')?.run()] : null,
        S.monaco ? ['Edit: Format Document', key('⇧', '⌥', 'F'), () => ed()?.getAction('editor.action.formatDocument')?.run()] : null, S.monaco ? ['Go to Symbol in This File…', key('⇧', '⌘', 'O'), () => { ed()?.focus(); ed()?.getAction('editor.action.quickOutline')?.run(); }] : null,
        S.monaco ? ['Edit: Comment the Line', key('⌘', '/'), () => ed()?.getAction('editor.action.commentLine')?.run()] : null, S.monaco ? ['Editor: Every Editor Command…', 'F1', () => { ed()?.focus(); ed()?.getAction('editor.action.quickCommand')?.run(); }] : null,
        can.git && can.branch ? ['Git: Switch Branch…', '', pickBranch] : null, can.git && can.write && can.stage ? ['Git: Put Everything in the Commit', '', () => gitRun('stage', { all: true })] : null,
        can.git ? ['Git: Refresh', '', refreshGit] : null, host.toChat && S.monaco ? ['Chat: Add the Selection', '', () => ed() && toChat(ed())] : null,
        ...partViews().filter((v) => !v.run).map((v) => [`View: ${v.title.replace(/\s+\S*[⌘⌃⇧].*$/, '')}`, v.key ?? '', () => setView(v.id)]),
      ].filter(Boolean).map(([title, k, run]) => ({ title, k, run }));
      return [...list, ...parts.flatMap((p) => p.commands?.() ?? []), ...(host.commands?.() ?? [])];
    };
    const saveAll = async () => { for (const d of S.docs.values()) if (d.dirty) await saveDoc(d); };
    function closePal() { pal?.el.remove(); pal = null; }
    function pick(o) { palette('', o); }
    function palette(preset = '', custom = null) {
      closePal(); closeMenu();
      const back = document.activeElement;
      const input = h('input', { type: 'text', spellcheck: 'false', 'aria-label': 'Go to a file or run a command', placeholder: custom?.placeholder ?? `Go to a file · > a command · : a line` });
      const list = h('div', { class: 'list', role: 'listbox' });
      pal = { el: h('div', { class: 'wbx-pal', role: 'dialog', 'aria-label': 'Palette' }, input, list), items: [], at: 0, back };
      root.append(pal.el);
      const draw = () => {
        const v = input.value; let items = [];
        if (custom) {
          const q = v.trim().toLowerCase();
          items = custom.items.map((it) => ({ it, f: fuzzy(q, it.title) })).filter((x) => x.f).sort((a, b) => b.f.score - a.f.score).map(({ it, f }) => ({ ...it, at: f.at }));
          if (custom.make && v.trim() && !custom.items.some((it) => it.title === v.trim())) items.push(custom.make(v.trim()));
        } else if (v.startsWith('>')) {
          const q = v.slice(1).trim().toLowerCase();
          items = commands().map((c) => ({ c, f: fuzzy(q, c.title) })).filter((x) => x.f).sort((a, b) => b.f.score - a.f.score).slice(0, 60).map(({ c, f }) => ({ ...c, at: f.at }));
        } else if (v.startsWith(':')) {
          const [line, col] = v.slice(1).split(/[:,]/).map((x) => parseInt(x, 10));
          const doc = nowDoc();
          items = doc?.kind === 'file' && line > 0 ? [{ title: `Go to line ${line}${col > 0 ? `, column ${col}` : ''}`, sub: doc.path, run: () => openFile(doc.path, { line, col: col > 0 ? col : 1 }) }] : [{ title: doc?.kind === 'file' ? 'Type a line number' : 'Open a file first', run: () => {} }];
        } else {
          const q = v.trim().toLowerCase().replace(/:(\d+)$/, ''), line = Number(/:(\d+)$/.exec(v.trim())?.[1]) || null;
          const files = S.files ?? [];
          if (!S.files) loadFiles().then(() => pal && draw());
          const pool = q ? files : [...S.recent.filter((p) => files.includes(p) || !S.files), ...files.filter((p) => !S.recent.includes(p))];
          const scored = [];
          for (const p of pool) { const f = fuzzy(q, p); if (f) scored.push({ p, f }); if (!q && scored.length >= 60) break; }
          if (q) scored.sort((a, b) => b.f.score - a.f.score);
          items = scored.slice(0, 60).map(({ p, f }) => ({ title: base(p), sub: dirOf(p), at: f.at.map((i) => i - (p.length - base(p).length)).filter((i) => i >= 0), subAt: f.at.filter((i) => i < dirOf(p).length), run: () => openFile(p, line ? { line } : {}) }));
          if (!S.files && !items.length) items = [{ title: 'Reading the file names…', run: () => {} }];
        }
        pal.items = items; pal.at = Math.min(pal.at, Math.max(0, items.length - 1));
        put(list, ...(items.length ? items.map((it, i) => h('button', { type: 'button', role: 'option', class: `it${i === pal.at ? ' on' : ''}`, 'aria-selected': String(i === pal.at), onclick: () => run(i), onmousemove: () => { if (pal && pal.at !== i) { pal.at = i; mark(); } } }, h('span', { class: 'nm' }, it.at ? marked(it.title, it.at) : it.title), h('span', { class: 'sub' }, it.subAt ? marked(it.sub ?? '', it.subAt) : (it.sub ?? '')), it.k ? h('span', { class: 'k' }, it.k) : null)) : [h('div', { class: 'none' }, v.startsWith('>') ? 'No command by that name.' : 'Nothing by that name.')]));
      };
      const mark = () => { [...list.children].forEach((el, i) => { el.classList?.toggle('on', i === pal.at); el.setAttribute?.('aria-selected', String(i === pal.at)); }); list.children[pal.at]?.scrollIntoView?.({ block: 'nearest' }); };
      const run = (i) => { const it = pal?.items[i]; if (!it) return; closePal(); it.run(); };
      input.value = preset; input.addEventListener('input', () => { pal.at = 0; draw(); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = pal.items.length; if (n) { pal.at = (pal.at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; mark(); } }
        else if (e.key === 'Enter') { e.preventDefault(); run(pal.at); }
        else if (e.key === 'Escape') { e.preventDefault(); closePal(); back?.focus?.(); }
        e.stopPropagation();
      });
      draw(); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
    }
    async function loadFiles() { const r = await host.files(); S.files = r?.files ?? []; }

    // ---------- keys: VS Code's own, wherever the pointer is; a tab's keys only while the workbench has the focus
    const inside = (el) => el instanceof Node && root.contains(el); // the palette and the menu are inside the root too
    function onKey(e) {
      const mod = MAC ? e.metaKey : e.ctrlKey, k = e.key.toLowerCase();
      const done = (fn) => { e.preventDefault(); e.stopImmediatePropagation(); fn(); };
      if (e.key === 'Escape' && menu) return done(closeMenu);
      if (pal) return; // the palette's own box takes its keys
      if (mod && !e.altKey && k === 'p') return done(() => palette(e.shiftKey ? '>' : ''));
      if (e.key === 'F1') return done(() => palette('>'));
      if (mod && e.shiftKey && k === 'e') return done(() => setView('files'));
      if (mod && e.shiftKey && k === 'f') return done(() => setView('search'));
      if (e.ctrlKey && e.shiftKey && k === 'g' && can.git) return done(() => setView('git'));
      if (mod && e.shiftKey && k === 'm') return done(() => togglePanel('problems'));
      if (mod && !e.shiftKey && !e.altKey && k === 'j') return done(() => togglePanel());
      if (e.ctrlKey && !e.metaKey && e.key === '`' && host.terminal) return done(() => togglePanel('terminal'));
      for (const p of parts) { const fn = p.keys?.(e); if (fn) return done(fn); }
      if (!inside(e.target) || !mainOpen()) return;
      if (mod && e.altKey && k === 's') return done(saveAll);
      if (mod && !e.shiftKey && k === 's') return done(() => saveDoc(nowDoc()));
      if (mod && !e.shiftKey && k === 'w' && now()?.active) return done(() => closeTab(now(), now().active));
      if (mod && e.key === '\\') return done(() => splitRight());
      if (e.ctrlKey && !e.metaKey && k === 'g' && !e.shiftKey && !S.monaco) return done(() => palette(':'));
      if (mod && /^[1-3]$/.test(e.key) && S.groups[Number(e.key) - 1]) return done(() => { const g = S.groups[Number(e.key) - 1]; focusGroup(g); g.editor?.focus(); });
    }
    document.addEventListener('keydown', onKey, true);
    const onDown = (e) => { if (pal && !pal.el.contains(e.target)) closePal(); if (menu && !menu.contains(e.target)) closeMenu(); };
    document.addEventListener('pointerdown', onDown, true);

    // ---------- files changed under the folder (the model's edits, a command, another app): follow them
    function changed(paths) {
      S.files = null;
      const dirs = new Set();
      if (!paths) for (const p of S.kids.keys()) dirs.add(p);
      else for (const p of paths) {
        if (!p || p === '.git' || p.startsWith('.git/')) continue;
        // the nearest folder above it that the tree has open, and the path itself when it is one
        let d = dirOf(p); while (d && !S.kids.has(d)) d = dirOf(d);
        if (S.kids.has(d)) dirs.add(d);
        if (S.kids.has(p)) dirs.add(p);
      }
      for (const d of dirs) loadDir(d);
      for (const doc of S.docs.values()) {
        if (doc.kind !== 'file' || doc.loading) continue;
        if (paths && !paths.includes(doc.path)) continue;
        if (doc.savedAt && Date.now() - doc.savedAt < 1200) continue; // our own save
        reload(doc, false);
      }
      gitSoon();
      if (S.view === 'search' && S.find.q && paths?.some((p) => !p.startsWith('.git'))) { clearTimeout(findTimer); findTimer = setTimeout(runFind, 900); }
      for (const p of parts) p.changed?.(paths);
    }
    host.onChange?.(changed);

    // ---------- the editor part, when the page can load it
    // the editor part in the page's own colours (workbench-kit.js)
    const theme = (m) => window.WorkbenchKit.theme(m, root);
    async function startMonaco() {
      let m = null;
      try { m = await host.monaco?.(); } catch { m = null; }
      if (!m) return;
      // Only what a file's own text shows: with no project loaded, "cannot find module" on every import would be noise.
      for (const d of [m.languages.typescript?.javascriptDefaults, m.languages.typescript?.typescriptDefaults]) { try { d?.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false }); } catch {} }
      theme(m);
      S.monaco = m;
      m.editor.onDidChangeMarkers(readMarks);
      // files opened in the plain box before the editor part came are opened in it now
      for (const p of parts) p.monaco?.(m);
      for (const doc of S.docs.values()) if (doc.kind === 'file' && !doc.model && typeof doc.text === 'string') { doc.model = modelFor(m, doc.path, doc.text); doc.savedId = doc.dirty ? -1 : doc.model.getAlternativeVersionId(); doc.model.onDidChangeContent(() => setDirty(doc, doc.model.getAlternativeVersionId() !== doc.savedId)); for (const p of parts) p.model?.(doc); }
      for (const doc of S.docs.values()) if (doc.kind === 'diff' && !doc.loading && !doc.model && !doc.error && !doc.binary) { doc.loading = true; loadDoc(doc); }
      for (const g of S.groups) show(g, { focus: false });
    }

    // ---------- start
    renderAct(); renderFoot();
    const first = makeGroup(); first.el.classList.add('focus');
    layout();
    if (S.view) setView(S.view);
    if (S.panel) renderPanel();
    refreshGit();
    startMonaco().then(() => {
      // the tabs the folder had open last time (a file gone since is left out by its own "is not there")
      (kept.groups ?? []).slice(0, 3).forEach((g, i) => { for (const p of g.tabs ?? []) openFile(p, { group: i, focus: false }); if (g.active) openFile(g.active, { group: i, focus: false }); });
      S.focus = 0; for (const x of S.groups) x.el.classList.toggle('focus', x === S.groups[0]);
      layout();
    });

    return {
      openFile, openDiff, palette, setView, togglePanel, changed, refreshGit, commands, notice, touch, settle,
      part: (id) => parts.find((p) => p.id === id)?.api ?? null,
      owns: (e) => inside(e.target) || Boolean(pal),
      retheme: () => S.monaco && theme(S.monaco),
      state: () => ({ view: S.view, panel: S.panel, main: mainOpen(), tabs: S.groups.map((g) => g.tabs.slice()), dirty: [...S.docs.values()].filter((d) => d.dirty).map((d) => d.path), editor: Boolean(S.monaco) }),
      dispose() { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); closePal(); closeMenu(); for (const p of parts) { try { p.dispose?.(); } catch {} } for (const t of S.terms) t.h?.dispose?.(); for (const x of extras) x.h?.dispose?.(); for (const g of S.groups) { g.editor?.dispose(); g.diff?.dispose(); } for (const d of S.docs.values()) { d.model?.dispose(); d.before?.dispose(); } put(root); root.classList.remove('wbx', 'wbx-open'); },
    };
  }

  window.Workbench = { mount, fuzzy };
})();
