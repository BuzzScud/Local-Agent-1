// Language smarts (27 Nov 2026, the owner's pick: "go to definition, find references, rename across files, hover info,
// JS/TS first"). A part of workbench.js. VS Code's editor part already carries the TypeScript language service, which
// knows JavaScript too; it only lacked the rest of the project. This part hands it every code file of the folder
// (host.sources → { files: [{ path, text }], cut }), so a definition, the references, a rename and the hover reach across
// files, and a jump to another file opens it in a tab. Nothing is installed for it. A file a rename changed that was not
// open opens as a tab, not saved, as a change you then save or drop.
(() => {
  const CODE = /\.(m?[jt]sx?|c[jt]s)$/i;
  (window.WorkbenchParts ??= []).push((api) => {
    const { h, host, plural } = api;
    if (!host.sources) return null;
    const L = { m: null, paths: new Set(), edited: new Set(), state: 'off', count: 0, cut: false, why: null, subs: [], opener: null, renamed: new Set(), renameTimer: null };

    async function load(m, again = false) {
      const ts = m.languages.typescript;
      if (!ts?.javascriptDefaults) { L.state = 'none'; return api.renderFoot(); }
      if (!again) {
        // a project of JavaScript and TypeScript side by side, its imports found the way a bundler finds them (by their
        // own names, .mjs and all), and nothing checked beyond what workbench.js asks (the file's own syntax)
        const o = { target: 99, module: 99, moduleResolution: 100, allowJs: true, checkJs: false, jsx: 1, allowNonTsExtensions: true, esModuleInterop: true, allowImportingTsExtensions: true, resolveJsonModule: true, noEmit: true, skipLibCheck: true };
        for (const d of [ts.javascriptDefaults, ts.typescriptDefaults]) { d.setCompilerOptions(o); d.setEagerModelSync(true); }
        L.opener = m.editor.registerEditorOpener?.({
          openCodeEditor(_from, uri, at) {
            if (uri.scheme !== 'file') return false;
            const path = uri.path.replace(/^\//, ''), line = at?.startLineNumber ?? at?.lineNumber, col = at?.startColumn ?? at?.column ?? 1;
            api.openFile(path, line ? { line, col } : {});
            return true;
          },
        });
      }
      L.state = 'loading'; api.renderFoot();
      const r = await host.sources().catch(() => null);
      if (!r?.files) { L.state = 'failed'; L.why = r?.why ?? 'The project\'s files did not come.'; return api.renderFoot(); }
      for (const f of r.files) put(m, f.path, f.text);
      L.cut = Boolean(r.cut); L.count = L.paths.size; L.state = 'on';
      api.renderFoot();
    }
    // a file of the project into the language service: a model of its own (workbench.js modelFor takes it over when the
    // file opens), followed for edits a rename makes while it is not open
    function put(m, path, text) {
      const uri = m.Uri.from({ scheme: 'file', path: `/${path}` });
      let model = m.editor.getModel(uri);
      if (model) { if (!api.docOf(`f:${path}`) && !L.edited.has(path) && model.getValue() !== text) model.setValue(text); }
      else {
        model = m.editor.createModel(text, undefined, uri);
        L.subs.push(model.onDidChangeContent((e) => { if (!e.isFlush && !api.docOf(`f:${path}`)) renamed(path); }));
      }
      L.paths.add(path);
    }
    // an edit to a file that is not open (a rename across files): open it, not saved, and say so once for them all
    function renamed(path) {
      L.edited.add(path); L.renamed.add(path);
      clearTimeout(L.renameTimer);
      L.renameTimer = setTimeout(() => {
        const list = [...L.renamed]; L.renamed.clear();
        for (const p of list) api.openFile(p, { focus: false });
        api.notice({ text: `That change reached ${plural(list.length, 'more file')}, open now and not saved yet.`, actions: [['Save all', async () => { await api.saveAll(); api.notice(null); }, ''], ['Look first', () => api.notice(null)]] });
      }, 60);
    }
    async function refresh(paths) {
      const m = L.m; if (!m || L.state !== 'on') return;
      for (const p of (paths ?? []).filter((x) => CODE.test(x)).slice(0, 200)) {
        if (api.docOf(`f:${p}`)) continue; // an open file follows the disk itself (workbench.js)
        const r = await host.read(p);
        const uri = m.Uri.from({ scheme: 'file', path: `/${p}` });
        if (r?.gone || r?.error) { const model = m.editor.getModel(uri); if (model && !L.edited.has(p)) { model.dispose(); L.paths.delete(p); } continue; }
        if (typeof r?.text === 'string' && !r.cut) put(m, p, r.text);
      }
      L.count = L.paths.size;
    }
    const word = () => ({ off: '', none: '', loading: 'JS/TS: reading the project…', failed: 'JS/TS: off', on: `JS/TS: ${plural(L.count, 'file')}${L.cut ? '+' : ''}` })[L.state] ?? '';

    return {
      id: 'lang',
      api: { state: () => ({ state: L.state, count: L.count, cut: L.cut, why: L.why }), reload: () => L.m && load(L.m, true) },
      monaco(m) { L.m = m; load(m); },
      keeps: (path) => L.paths.has(path),
      edited: (path) => L.edited.has(path),
      changed(paths) { if (paths) refresh(paths); },
      model(doc) { L.edited.delete(doc.path); },
      foot: () => (word() ? [h('button', { type: 'button', title: L.state === 'on' ? `Go to definition (F12), references (⇧F12), rename (F2) and hover reach every one of these files${L.cut ? ' (the project is bigger: the first ones only)' : ''}` : L.why ?? '', onclick: () => L.state !== 'loading' && L.m && load(L.m, true) }, word())] : []),
      commands: () => (L.m ? [
        { title: 'Language: Read the Project\'s Code Again', k: '', run: () => load(L.m, true) },
        { title: 'Go to Definition', k: 'F12', run: () => run('editor.action.revealDefinition') },
        { title: 'Go to References', k: '⇧F12', run: () => run('editor.action.goToReferences') },
        { title: 'Rename Symbol', k: 'F2', run: () => run('editor.action.rename') },
        { title: 'Peek Definition', k: '⌥F12', run: () => run('editor.action.peekDefinition') },
      ] : []),
      dispose() { L.opener?.dispose?.(); for (const s of L.subs) s.dispose?.(); },
    };
    // VS Code's editor part has these as commands, not as editor actions (getAction gives none): triggered by name
    function run(id) { const ed = api.now()?.editor; if (!ed) return; ed.focus(); ed.trigger('workbench', id, null); }
  });
})();
