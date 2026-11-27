// The workbench and the chat as one (27 Nov 2026, the owner: "can you make it better? add more tools? more integration?";
// their picks: follow it live, a review bar with keep or undo, fix and explain buttons, source control helpers). A part
// of workbench.js (window.WorkbenchParts): it knows nothing of Agentic Coder or hearth either. The page that holds the
// workbench tells it what the agent does (WB.part('ai').follow(…) while it works, .done(…) when a reply ends) and hands
// it these calls on the host, each one optional:
//   host.agentName                       who works beside you ("Agentic Coder", "hearth")
//   host.live                            true when the page calls follow() and done() as the agent works
//   host.toChat(text)                    text into the chat's prompt, for you to send
//   host.review.before(path, ref)        → { text } | { gone } | { why }: a file as it was before the reply
//   host.review.undo(path, ref)          → { ok } | { why }: that file put back as it was
//   host.ask({ what: 'commit', patch })  → { text } | { why }: a commit message written by the model
(() => {
  const STATUS = { new: 'added', changed: 'changed', deleted: 'deleted' };
  (window.WorkbenchParts ??= []).push((api) => {
    const { h, put, ib, host, base, dirOf, plural, S, key } = api;
    const who = () => host.agentName ?? 'The agent';
    const A = { follow: host.store?.get('follow') !== false, working: false, editing: new Map(), deco: new Map(), turn: null, ask: null, writing: false };
    api.addIcons({
      eye: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
      spark: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2L12 12M12 4l-1.8 1.8M5.8 10.2L4 12"/></svg>',
    });

    // ---------- follow it live: what it reads and edits lights up in the tree; the file it edits opens beside you with
    // its new lines marked, without taking the keys from where you are typing
    function follow({ reading = [], editing = [], working = true } = {}) {
      const was = A.working; A.working = working;
      const paths = [...reading, ...editing.map((e) => e.path)].filter(Boolean);
      if (paths.length) api.touch(paths, who());
      for (const e of editing) {
        if (!e?.path) continue;
        const lines = new Set([...(A.editing.get(e.path) ?? []), ...(e.lines ?? [])]);
        A.editing.set(e.path, lines);
        if (A.follow) {
          const first = (e.lines ?? []).length ? Math.min(...e.lines) : null;
          const open = api.docOf(`f:${e.path}`);
          if (!open) api.openFile(e.path, { focus: false, ...(first ? { line: first, col: 1 } : {}) });
          else if (first) reveal(e.path, first);
        }
        mark(e.path);
      }
      if (was !== working) api.renderFoot();
    }
    function reveal(path, line) {
      const m = api.monaco(); if (!m) return;
      for (const g of api.groups()) if (g.active === `f:${path}` && g.editor) g.editor.revealLineInCenterIfOutsideViewport(line);
    }
    // the reply's new lines, marked in the file's model (again after the disk's text came in, which drops marks)
    function mark(path) {
      const m = api.monaco(), doc = api.docOf(`f:${path}`);
      if (!m || !doc?.model || doc.model.isDisposed()) return;
      const lines = [...(A.editing.get(path) ?? [])].filter((n) => n >= 1 && n <= doc.model.getLineCount());
      const decos = lines.map((n) => ({ range: new m.Range(n, 1, n, 1), options: { isWholeLine: true, className: 'wbx-ai-line', linesDecorationsClassName: 'wbx-ai-gut' } }));
      A.deco.set(path, doc.model.deltaDecorations(A.deco.get(path) ?? [], decos));
    }
    function unmark() {
      for (const [path, ids] of A.deco) { const d = api.docOf(`f:${path}`); if (d?.model && !d.model.isDisposed()) d.model.deltaDecorations(ids, []); }
      A.deco.clear(); A.editing.clear();
    }

    // ---------- the review: a reply ended with files changed → a line over the editor, and a Review tab with each file's
    // change and Keep or Undo
    function done({ ref = null, files = [] } = {}) {
      A.working = false; api.settle(); api.renderFoot();
      const list = files.filter((f) => f?.path).map((f) => ({ path: f.path, status: f.status ?? 'changed', state: f.undone ? 'undone' : 'waiting', why: null }));
      if (!list.length) { unmark(); return; }
      A.turn = { ref, files: list, at: Date.now(), pick: list[0].path, ask: null };
      say();
      const doc = api.docOf('review');
      if (doc) { doc.turn = A.turn; for (const g of api.groups()) if (g.active === 'review') api.place(doc, { focus: false }); }
    }
    const waiting = () => (A.turn?.files ?? []).filter((f) => f.state === 'waiting');
    function say() {
      const t = A.turn, left = waiting();
      if (!t || !left.length) { api.notice(null); if (t) unmark(); return; }
      const can = Boolean(host.review?.undo);
      api.notice({ text: `${who()} changed ${plural(left.length, 'file')}${left.length < t.files.length ? ' still to look at' : ''}.`, actions: [['Review', openReview, ''], ['Keep all', keepAll], ...(can ? [['Undo all…', () => openReview({ askAll: true }), 'danger']] : [])] });
    }
    function keepAll() { for (const f of waiting()) f.state = 'kept'; say(); redraw(); }
    async function undo(f) {
      if (!host.review?.undo || f.state === 'undone') return;
      f.busy = true; redraw();
      const r = await host.review.undo(f.path, A.turn?.ref);
      f.busy = false;
      if (r?.ok) { f.state = 'undone'; f.why = null; api.changed([f.path]); } else f.why = r?.why ?? 'It could not be put back.';
      say(); redraw();
    }
    async function undoAll() { for (const f of waiting()) await undo(f); }
    function openReview(o = {}) {
      if (!A.turn) return;
      if (o.askAll) A.turn.ask = 'all';
      api.openDoc({ key: 'review', kind: 'review', path: 'Review', name: `Review · ${plural(A.turn.files.length, 'file')}`, turn: A.turn });
    }
    function redraw() { const d = api.docOf('review'); if (!d) return; for (const g of api.groups()) if (g.active === 'review') review.show(g, d, g.extEl); }
    // the Review tab: the files on the left with their buttons, the picked one's change on the right
    const review = {
      show(g, doc, box) {
        const t = doc.turn ?? A.turn; if (!t) return put(box, h('div', { class: 'wbx-empty' }, 'Nothing to review.'));
        doc.name = `Review · ${plural(t.files.length, 'file')}`;
        let ui = box.querySelector('.wbx-rv');
        if (!ui) {
          doc.diff?.dispose(); doc.diff = null; doc.shownPick = null;
          ui = h('div', { class: 'wbx-rv' }, h('div', { class: 'wbx-rv-list' }), h('div', { class: 'wbx-rv-diff' })); put(box, ui);
          doc.dispose = () => { doc.diff?.dispose(); doc.before?.dispose(); doc.after?.dispose(); };
        }
        const listEl = ui.firstChild, diffEl = ui.lastChild, can = Boolean(host.review?.undo), left = t.files.filter((f) => f.state === 'waiting');
        const btn = (label, fn, cls) => h('button', { type: 'button', class: `wbx-btn ${cls ?? 'plain'}`, onclick: fn }, label);
        put(listEl,
          h('div', { class: 'wbx-rv-h' }, h('span', { class: 't' }, `${who()} changed ${plural(t.files.length, 'file')}`), h('span', { class: 'sub' }, left.length ? `${left.length} to look at` : 'all looked at')),
          t.ask === 'all' ? h('div', { class: 'wbx-say' }, `Put ${plural(left.length, 'file')} back as ${left.length === 1 ? 'it was' : 'they were'} before the reply? What it wrote in them goes.`, h('div', { class: 'wbx-btns' }, btn('Undo all', () => { t.ask = null; undoAll(); }, 'danger'), btn('Not now', () => { t.ask = null; redraw(); }))) : null,
          left.length ? h('div', { class: 'wbx-btns wbx-rv-all' }, btn('Keep all', keepAll, ''), can ? btn('Undo all…', () => { t.ask = 'all'; redraw(); }) : null) : null,
          t.files.map((f) => api.press({ class: `wbx-row wbx-rv-f${t.pick === f.path ? ' sel' : ''}`, title: f.path, onclick: () => { t.pick = f.path; redraw(); } },
            h('span', { class: `nm wbx-c-${f.status}` }, base(f.path), dirOf(f.path) ? h('span', { class: 'sub' }, `  ${dirOf(f.path)}`) : null),
            h('span', { class: `wbx-chip ${f.state}` }, f.busy ? 'putting back…' : f.state === 'waiting' ? STATUS[f.status] ?? f.status : f.state),
            f.state === 'waiting' ? h('span', { class: 'acts on' }, ib('plus', 'Keep', () => { f.state = 'kept'; say(); redraw(); }), can ? ib('undo', 'Undo: put it back as it was', () => undo(f)) : null) : null)),
          t.files.find((f) => f.why) ? h('div', { class: 'wbx-say bad' }, t.files.filter((f) => f.why).map((f) => `${base(f.path)}: ${f.why}`).join(' · ')) : null);
        const f = t.files.find((x) => x.path === t.pick) ?? t.files[0];
        if (doc.shownPick !== `${f.path}\0${f.state}`) { doc.shownPick = `${f.path}\0${f.state}`; showDiff(doc, diffEl, f, t); }
      },
    };
    async function showDiff(doc, el, f, t) {
      const m = api.monaco();
      const [was, now] = await Promise.all([host.review?.before ? host.review.before(f.path, t.ref) : Promise.resolve({ why: 'This page keeps no copy from before the reply.' }), f.status === 'deleted' ? Promise.resolve({ text: '' }) : host.read(f.path)]);
      if (doc.shownPick !== `${f.path}\0${f.state}`) return;
      const before = was?.gone ? '' : was?.text, after = now?.text ?? '';
      if (before == null) return put(el, h('div', { class: 'wbx-empty' }, was?.why ?? 'No copy from before the reply.'), h('button', { type: 'button', class: 'wbx-btn plain', onclick: () => api.openFile(f.path) }, 'Open the file'));
      if (!m) return put(el, h('pre', { class: 'wbx-rv-plain' }, after));
      if (!doc.diff) { put(el); doc.diff = m.editor.createDiffEditor(el, { theme: 'wb', automaticLayout: true, readOnly: true, originalEditable: false, renderSideBySide: el.clientWidth > 640, minimap: { enabled: false }, fontSize: 13, lineHeight: 20, scrollBeyondLastLine: false }); }
      const lang = m.languages.getLanguages().find((l) => l.extensions?.some((x) => f.path.endsWith(x)))?.id;
      const old = [doc.before, doc.after], n = (doc.n = (doc.n ?? 0) + 1);
      doc.before = m.editor.createModel(before, lang, m.Uri.from({ scheme: 'wbx-rv-before', path: `/${f.path}`, query: String(n) }));
      doc.after = m.editor.createModel(after, lang, m.Uri.from({ scheme: 'wbx-rv-after', path: `/${f.path}`, query: String(n) }));
      doc.diff.setModel({ original: doc.before, modified: doc.after });
      for (const x of old) x?.dispose();
    }

    // ---------- fix, explain, a test: the code you point at, into the prompt with what to do about it
    const ask = (text) => { if (host.toChat) host.toChat(text); };
    const where = (doc, sel) => `${doc.path}:${sel.startLineNumber}${sel.endLineNumber !== sel.startLineNumber ? `-${sel.endLineNumber}` : ''}`;
    function aboutSelection(g, verb) {
      // the file in this editor (its group may show another tab in front of it, the review)
      const ed = g.editor, model = ed?.getModel(), doc = model && api.docOf(`f:${model.uri.path.replace(/^\//, '')}`); if (!doc) return;
      let sel = ed.getSelection();
      if (sel.isEmpty()) { const n = sel.startLineNumber; sel = new (api.monaco().Range)(n, 1, n, model.getLineMaxColumn(n)); }
      const code = model.getValueInRange(sel);
      const problems = api.problems().filter((p) => p.path === doc.path && p.line >= sel.startLineNumber && p.line <= sel.endLineNumber).map((p) => `- line ${p.line}: ${p.message}`);
      const lead = { explain: 'Explain what this code does and why:', fix: `Fix this code${problems.length ? ' (its problems are below)' : ''}:`, test: 'Write a test for this code, in the project\'s own test style, and run it:' }[verb];
      ask(`${lead}\n${where(doc, sel)}\n\`\`\`${api.lang(doc)}\n${code}\n\`\`\`\n${problems.length ? `${problems.join('\n')}\n` : ''}`);
    }
    const acts = [['explain', `Explain This (${'⌥E'})`], ['fix', 'Fix This'], ['test', 'Write a Test for This']];

    // ---------- the commit message from the changes, and a review before you commit
    async function writeMessage() {
      if (A.writing) return;
      if (!host.ask) return ask('Write a commit message for the changes in this folder that are not committed yet (git diff), in the style of its last commits. Only the message.');
      A.writing = true; A.ask = null; api.renderSide();
      const staged = (S.git?.files ?? []).some((f) => f.staged);
      const p = await host.gitDo('patch', { staged });
      const r = p?.ok ? await host.ask({ what: 'commit', patch: p.patch, log: p.log ?? '' }) : { why: p?.why ?? 'git gave no changes.' };
      A.writing = false;
      if (r?.text) S.message = r.text.trim(); else A.ask = r?.why ?? 'No message came back.';
      api.renderSide();
    }

    return {
      id: 'ai',
      api: { follow, done, review: () => A.turn, following: () => A.follow, openReview },
      kinds: { review },
      changed(paths) { for (const p of paths ?? []) if (A.editing.has(p)) setTimeout(() => mark(p), 350); },
      model(doc) { if (A.editing.has(doc.path)) mark(doc.path); },
      editor(g) {
        if (!host.toChat) return;
        const m = api.monaco();
        acts.forEach(([verb, label], i) => g.editor.addAction({ id: `wb.ai.${verb}`, label: `${who()}: ${label.replace(/ \(.*\)$/, '')}`, contextMenuGroupId: '0_ai', contextMenuOrder: i, ...(verb === 'explain' ? { keybindings: [m.KeyMod.Alt | m.KeyCode.KeyE] } : {}), run: () => aboutSelection(g, verb) }));
      },
      problemActs: (p) => (host.toChat ? [ib('chat', `Fix it with ${who()}`, () => ask(`Fix this problem in ${p.path} at line ${p.line}${p.col > 1 ? `, column ${p.col}` : ''}: ${p.message}`))] : []),
      panelActs(panel, term) {
        if (panel !== 'terminal' || !host.toChat || !term?.h?.text) return [];
        return [ib('chat', `Send to ${who()}: the selection, or the terminal's last lines, into the prompt`, () => { const sel = term.h.selection?.() || term.h.text(60); if (sel.trim()) ask(`This came out of my terminal:\n\`\`\`\n${sel.trim()}\n\`\`\`\n`); })];
      },
      // only where the page has a commit box of its own (hearth commits from its chat, and asks there itself)
      gitRows(g) {
        if (!g?.repo || !g.files?.length || !api.can.commit) return [];
        return [h('div', { class: 'wbx-btns wbx-ai-git' },
          h('button', { type: 'button', class: 'wbx-btn plain', disabled: A.writing, onclick: writeMessage, title: host.ask ? `${who()} writes the message from your changes` : 'Ask for a message in the chat' }, h('span', { class: 'ic', html: api.icon('spark').innerHTML }), A.writing ? ' Writing…' : ' Write the message'),
          host.toChat ? h('button', { type: 'button', class: 'wbx-btn plain', onclick: () => ask(`Review my changes that are not committed yet (git diff${g.files.some((f) => f.staged) ? ' --cached' : ''}) before I commit: bugs, missed cases, anything left half done. Change nothing yet.`) }, `Ask ${who()} to review`) : null),
        A.ask ? h('div', { class: 'wbx-say bad' }, A.ask) : null].filter(Boolean);
      },
      // the Follow switch only where the page tells this part what the agent does (host.live)
      foot: () => [!host.live ? null : h('button', { type: 'button', class: A.follow ? 'on' : '', title: `Follow ${who()}: open the file it edits and mark its new lines (click to turn ${A.follow ? 'off' : 'on'})`, onclick: () => { A.follow = !A.follow; host.store?.set('follow', A.follow); api.renderFoot(); } }, h('span', { html: api.icon('eye').innerHTML }), A.working ? ` ${who()} is working` : ' Follow'),
        A.turn && waiting().length ? h('button', { type: 'button', title: 'Review what the reply changed', onclick: openReview }, `Review ${waiting().length}`) : null],
      commands: () => [
        { title: `${who()}: Follow On or Off`, k: '', run: () => { A.follow = !A.follow; host.store?.set('follow', A.follow); api.renderFoot(); } },
        A.turn ? { title: `${who()}: Review the Last Reply's Changes`, k: '', run: openReview } : null,
        A.turn && waiting().length ? { title: `${who()}: Keep All of the Last Reply's Changes`, k: '', run: keepAll } : null,
        ...(host.toChat ? acts.map(([verb, label]) => ({ title: `${who()}: ${label.replace(/ \(.*\)$/, '')}`, k: verb === 'explain' ? key('⌥', 'E') : '', run: () => { const g = api.now(); if (g?.editor) aboutSelection(g, verb); } })) : []),
        { title: `Source Control: ${who()} Writes the Commit Message`, k: '', run: () => { api.setView('git'); writeMessage(); } },
      ].filter(Boolean),
    };
  });
})();
