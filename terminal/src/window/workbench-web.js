// The browser preview (27 Nov 2026, the owner's pick: "opens a page or a localhost address in a pane"). A part of
// workbench.js: a page as an editor tab, with its address, back to it, reload and open outside. A file of the folder
// (an .html, an .svg) opens through host.site(path) → its address, reloaded by itself when the folder's files change; an
// address you type (a dev server on this Mac) opens as it is. host.servers() → [{ port, name }] lists what this Mac
// serves, for the address list. A page of the folder runs apart from the workbench (a sandbox with no way to it).
(() => {
  const PAGE = /\.(html?|svg|xhtml)$/i;
  (window.WorkbenchParts ??= []).push((api) => {
    const { h, put, ib, host, base, key } = api;
    const W = { n: 0, recent: host.store?.get('webRecent') ?? [], live: host.store?.get('webLive') !== false };
    api.addIcons({ globe: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c-2.2 2.6-2.2 8.4 0 11M8 2.5c2.2 2.6 2.2 8.4 0 11"/></svg>' });
    const norm = (s) => { const t = String(s ?? '').trim(); if (!t) return null; if (/^\d{2,5}$/.test(t)) return `http://localhost:${t}/`; if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(t)) return `http://${t}`; if (/^https?:\/\//i.test(t)) return t; return null; };

    function open(target, o = {}) {
      const file = o.file ?? (PAGE.test(target) && !/^https?:/i.test(target) ? target : null);
      const url = file ? null : norm(target);
      if (!file && !url) return api.notice({ text: `"${target}" is not an address this preview opens (http, https or a port on this Mac).`, actions: [] });
      if (url) { W.recent = [url, ...W.recent.filter((x) => x !== url)].slice(0, 12); host.store?.set('webRecent', W.recent); }
      const key = file ? `w:f:${file}` : `w:${++W.n}`;
      const had = api.docOf(key);
      const doc = had ?? { key, kind: 'web', path: file ?? url, name: file ? `Preview ${base(file)}` : (new URL(url).host || url), file, url, el: null };
      if (had && !file) { doc.url = url; doc.path = url; }
      api.openDoc(doc, { group: o.side ? Math.min(api.groups().length, 2) : undefined });
      if (had) reload(doc);
    }
    async function srcOf(doc) { if (!doc.file) return doc.url; const r = await host.site?.(doc.file); return r?.url ?? null; }
    function reload(doc) { const f = doc.el?.querySelector('iframe'); if (!f) return; srcOf(doc).then((src) => { if (src) f.src = `${src}${doc.file ? `${src.includes('?') ? '&' : '?'}v=${Date.now()}` : ''}`; }); }
    const kinds = {
      web: {
        show(g, doc, box) {
          if (!doc.el) {
            const addr = h('input', { type: 'text', class: 'wbx-web-addr', spellcheck: 'false', 'aria-label': 'Address', value: doc.file ?? doc.url ?? '', readonly: doc.file ? true : null, onkeydown: (e) => { if (e.key === 'Enter') { const u = norm(addr.value); if (u) { doc.url = u; doc.path = u; doc.name = new URL(u).host; frame.src = u; } } e.stopPropagation(); } });
            const frame = h('iframe', { class: 'wbx-web-frame', title: doc.name, ...(doc.file ? { sandbox: 'allow-scripts allow-forms allow-popups allow-modals' } : {}), referrerpolicy: 'no-referrer' });
            const live = doc.file ? h('button', { type: 'button', class: `wbx-tg${W.live ? ' on' : ''}`, title: 'Reload by itself when the folder\'s files change', 'aria-pressed': String(W.live), onclick: (e) => { W.live = !W.live; host.store?.set('webLive', W.live); e.currentTarget.classList.toggle('on', W.live); } }, 'Live') : null;
            doc.el = h('div', { class: 'wbx-web' }, h('div', { class: 'wbx-web-bar' }, api.icon('globe'), addr, ib('refresh', 'Reload', () => reload(doc)), live,
              doc.url ? ib('open', 'Open in your browser', () => window.open(doc.url, '_blank')) : null,
              doc.file ? ib('file', 'Open the file', () => api.openFile(doc.file)) : null), frame);
            srcOf(doc).then((src) => { if (src) frame.src = src; else put(frame.parentNode, h('div', { class: 'wbx-empty' }, 'This page has no way to show a file of the folder.')); });
          }
          if (doc.el.parentNode !== box) put(box, doc.el);
        },
      },
    };
    function pickAddress() {
      const items = W.recent.map((u) => ({ title: u, sub: 'opened before', run: () => open(u) }));
      api.pick({ placeholder: 'An address or a port, like localhost:3000 or 5173', items, make: (t) => (norm(t) ? { title: `Open ${norm(t)}`, run: () => open(t) } : { title: 'Type an http address, or a port on this Mac', run: () => {} }) });
      host.servers?.().then((list) => {
        if (!list?.length) return;
        const more = list.map((s) => ({ title: `localhost:${s.port}`, sub: s.name, run: () => open(`http://localhost:${s.port}/`) })).filter((x) => !W.recent.includes(`http://localhost:${x.title.split(':')[1]}/`));
        // the list grows while the box is open: drawn again with what this Mac serves
        if (more.length) api.pick({ placeholder: 'An address or a port, like localhost:3000 or 5173', items: [...items, ...more], make: (t) => (norm(t) ? { title: `Open ${norm(t)}`, run: () => open(t) } : { title: 'Type an http address, or a port on this Mac', run: () => {} }) });
      });
    }
    return {
      id: 'web',
      api: { open },
      kinds,
      changed(paths) {
        if (!W.live || !paths?.length) return;
        clearTimeout(W.t); W.t = setTimeout(() => { for (const g of api.groups()) { const d = api.docOf(g.active); if (d?.kind === 'web' && d.file) reload(d); } }, 300);
      },
      fileMenu: (e) => (!e.dir && PAGE.test(e.path) && host.site ? [['Open the preview', () => open(e.path, { file: e.path })], ['Open the preview to the side', () => open(e.path, { file: e.path, side: true })]] : []),
      commands: () => [
        { title: 'Browser: Open an Address…', k: '', run: pickAddress },
        host.site ? { title: 'Browser: Preview This File', k: '', run: () => { const d = api.nowDoc(); if (d?.kind === 'file' && PAGE.test(d.path)) open(d.path, { file: d.path, side: true }); } } : null,
      ].filter(Boolean),
      editor(g) {
        if (!host.site) return;
        g.editor.addAction({ id: 'wb.web.preview', label: 'Open the Preview to the Side', contextMenuGroupId: 'navigation', contextMenuOrder: 9, precondition: undefined, run: () => { const d = api.docOf(g.active); if (d?.kind === 'file' && PAGE.test(d.path)) open(d.path, { file: d.path, side: true }); } });
      },
    };
  });
})();
