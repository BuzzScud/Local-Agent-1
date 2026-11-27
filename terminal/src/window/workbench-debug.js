// Run and Debug (27 Nov 2026, the owner's pick: "breakpoints, step through, see variables, node and bun first"). A part of
// workbench.js. Breakpoints are set in the margin beside the line numbers (or F9), kept per folder; a file runs under the
// host's debugger (host.debug: start({ path, runtime, bps }, on) → { id } | { why }, cmd(id, op, args) → a promise of the
// answer for 'props' and 'eval', stop(id); on(m) gets started, paused { frames, reason }, resumed, out { text, err } and
// ended { code }). Paused, the line shows in the editor, the call stack and each frame's variables in the side pane, a
// value under the pointer in a hover, and the Debug console evaluates in the frame you picked. VS Code's keys: F5, ⇧F5,
// F10, F11, ⇧F11, F9.
(() => {
  (window.WorkbenchParts ??= []).push((api) => {
    const { h, put, ib, host, base, dirOf, plural } = api;
    if (!host.debug) return null;
    const kept = host.store?.get('bps') ?? {};
    const D = { bps: new Map(Object.entries(kept).map(([p, l]) => [p, new Set(l)])), run: null, target: host.store?.get('dbgTarget') ?? null, runtime: host.store?.get('dbgRuntime') ?? 'auto', out: [], vars: new Map(), open: new Set(), decos: new Map(), here: new Map(), conEl: null, hist: [], sec: new Set(host.store?.get('dbgShut') ?? []) };
    const svg = (d, s = 14, fill = false) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    api.addIcons({
      bug: svg('<path d="M5.5 5.5a2.5 2.5 0 0 1 5 0"/><rect x="4.5" y="5.5" width="7" height="7.5" rx="3.5"/><path d="M8 7.5v5M2.5 8.5h2M11.5 8.5h2M3 4.5l1.8 1.5M13 4.5l-1.8 1.5M3 13l1.8-1.5M13 13l-1.8-1.5"/>', 18),
      cont: svg('<path d="M4 3v10"/><path d="M7 3.2v9.6L13 8z" fill="currentColor"/>'), pause: svg('<path d="M5.5 3.5v9M10.5 3.5v9"/>'),
      over: svg('<path d="M2.5 9a5.5 5.5 0 0 1 11 0"/><path d="M13.5 5.5V9H10"/><circle cx="8" cy="12.5" r="1.3" fill="currentColor"/>'),
      into: svg('<path d="M8 2.5v7M5 6.5l3 3 3-3"/><circle cx="8" cy="12.8" r="1.3" fill="currentColor"/>'),
      out: svg('<path d="M8 10V3M5 6l3-3 3 3"/><circle cx="8" cy="12.8" r="1.3" fill="currentColor"/>'),
      again: svg('<path d="M12.5 7A4.5 4.5 0 1 0 11 11.2"/><path d="M12.8 3.5V7H9.3"/>'), halt: svg('<rect x="4" y="4" width="8" height="8" rx="1"/>', 14, true),
    });
    const save = () => host.store?.set('bps', Object.fromEntries([...D.bps].filter(([, s]) => s.size).map(([p, s]) => [p, [...s].sort((a, b) => a - b)])));
    const bpCount = () => [...D.bps.values()].reduce((n, s) => n + s.size, 0);
    const paused = () => D.run?.paused ?? null;
    const frame = () => paused()?.frames?.[D.run.frame ?? 0] ?? null;

    // ---------- breakpoints
    function toggleBp(path, line) {
      const s = D.bps.get(path) ?? new Set(); const on = !s.has(line);
      if (on) s.add(line); else s.delete(line);
      D.bps.set(path, s); save();
      if (D.run) host.debug.cmd(D.run.id, 'bp', { path, line, on });
      markBps(path); draw();
    }
    function markBps(path) {
      const m = api.monaco(), doc = api.docOf(`f:${path}`); if (!m || !doc?.model || doc.model.isDisposed()) return;
      const lines = [...(D.bps.get(path) ?? [])].filter((n) => n <= doc.model.getLineCount());
      D.decos.set(path, doc.model.deltaDecorations(D.decos.get(path) ?? [], lines.map((n) => ({ range: new m.Range(n, 1, n, 1), options: { glyphMarginClassName: 'wbx-bp', glyphMarginHoverMessage: { value: 'Breakpoint · click to take it away' }, stickiness: 1 } }))));
    }
    // the breakpoints move with the lines as you type above them
    function followBps(doc) {
      const ids = D.decos.get(doc.path); if (!ids?.length) return;
      const lines = ids.map((id) => doc.model.getDecorationRange(id)?.startLineNumber).filter(Boolean);
      const was = [...(D.bps.get(doc.path) ?? [])].sort((a, b) => a - b).join(','), now = [...new Set(lines)].sort((a, b) => a - b);
      if (was === now.join(',')) return;
      D.bps.set(doc.path, new Set(now)); save(); draw();
    }
    function markHere() {
      const m = api.monaco(); const f = frame();
      for (const [path, ids] of D.here) { const d = api.docOf(`f:${path}`); if (d?.model && !d.model.isDisposed()) d.model.deltaDecorations(ids, []); }
      D.here.clear();
      if (!m || !f?.path) return;
      const d = api.docOf(`f:${f.path}`); if (!d?.model) return;
      D.here.set(f.path, d.model.deltaDecorations([], [{ range: new m.Range(f.line, 1, f.line, 1), options: { isWholeLine: true, className: 'wbx-here', glyphMarginClassName: 'wbx-here-g' } }]));
    }

    // ---------- a run
    function start(path = D.target ?? api.nowDoc()?.path) {
      if (!path) { api.setView('debug'); D.say = 'Open a file to run, or pick one.'; return draw(); }
      if (D.run) stop();
      D.target = path; host.store?.set('dbgTarget', path); D.say = null;
      D.out = []; D.vars.clear(); D.open.clear();
      const bps = Object.fromEntries([...D.bps].map(([p, s]) => [p, [...s]]));
      const r = host.debug.start({ path, runtime: D.runtime === 'auto' ? null : D.runtime, bps }, onMsg);
      if (r?.why) { D.say = r.why; return draw(); }
      D.run = { id: r.id, path, runtime: r.runtime ?? D.runtime, paused: null, frame: 0, state: 'starting', t0: Date.now() };
      print(`▶ ${path}${r.runtime ? ` (${r.runtime})` : ''}\n`, 'sys');
      api.setView('debug'); if (api.S.panel !== 'dbgcon') api.togglePanel('dbgcon');
      draw();
    }
    function onMsg(m) {
      const r = D.run; if (!r || m.id !== r.id) return;
      if (m.op === 'started') { r.state = 'running'; if (m.runtime) r.runtime = m.runtime; }
      else if (m.op === 'paused') {
        r.state = 'paused'; r.paused = { frames: m.frames ?? [], reason: m.reason, error: m.error }; r.frame = 0; D.vars.clear(); D.open = new Set();
        const f = frame(); if (f?.path) api.openFile(f.path, { line: f.line, col: 1 });
        if (m.error) print(`⚠ ${m.error}\n`, 'err');
        loadScopes();
      } else if (m.op === 'resumed') { r.state = 'running'; r.paused = null; D.vars.clear(); }
      else if (m.op === 'out') print(m.text, m.err ? 'err' : null);
      else if (m.op === 'ended') { print(`■ ended${m.code != null ? ` (exit code ${m.code})` : ''}\n`, 'sys'); D.run = null; }
      markHere(); draw(); api.renderFoot();
    }
    async function loadScopes() {
      const f = frame(); if (!f) return;
      // the first scopes open (the function's own), the program-wide one closed: it holds everything there is
      for (const sc of f.scopes) if (!/global/i.test(sc.type) && D.open.size < 2) { D.open.add(sc.objectId); await props(sc.objectId); }
      draw();
    }
    async function props(objectId) {
      if (!D.run || !objectId) return;
      const r = await host.debug.cmd(D.run.id, 'props', { objectId });
      D.vars.set(objectId, r?.vars ?? []); draw();
    }
    const cmd = (op) => { if (D.run) host.debug.cmd(D.run.id, op); };
    function stop() { if (D.run) { host.debug.stop(D.run.id); print('■ stopped\n', 'sys'); } }
    function restart() { const p = D.run?.path ?? D.target; stop(); setTimeout(() => start(p), 150); }
    async function evaluate(expression) {
      if (!expression.trim()) return;
      D.hist = [expression, ...D.hist.filter((x) => x !== expression)].slice(0, 50);
      print(`› ${expression}\n`, 'in');
      if (!D.run) return print('Start a run first (F5).\n', 'sys');
      const r = await host.debug.cmd(D.run.id, 'eval', { expression, callFrameId: frame()?.callFrameId ?? null });
      print(`${r?.value ?? r?.why ?? 'no answer'}\n`, r?.bad ? 'err' : 'val');
    }
    function print(text, cls) {
      D.out.push([text, cls]); if (D.out.length > 4000) D.out.splice(0, 1000);
      if (!D.conEl) return;
      const pre = D.conEl.querySelector('.wbx-con-out'), atEnd = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
      pre.append(h('span', { class: cls ? `c-${cls}` : null }, text));
      if (atEnd) pre.scrollTop = pre.scrollHeight;
    }

    // ---------- the side pane
    const sec = (id, title, n, body) => [api.press({ class: 'wbx-sec wbx-dsec', 'aria-expanded': String(!D.sec.has(id)), onclick: () => { if (D.sec.has(id)) D.sec.delete(id); else D.sec.add(id); host.store?.set('dbgShut', [...D.sec]); draw(); } }, api.icon(D.sec.has(id) ? 'right' : 'down'), h('span', { class: 't' }, title), n != null ? h('span', { class: 'n' }, n) : null), D.sec.has(id) ? null : body()];
    function varRows(objectId, depth) {
      const list = D.vars.get(objectId); if (!list) return [h('div', { class: 'wbx-note', style: `padding-left:${14 + depth * 12}px` }, 'Reading…')];
      if (!list.length) return [h('div', { class: 'wbx-note', style: `padding-left:${14 + depth * 12}px` }, 'Nothing here.')];
      return list.flatMap((v) => {
        const open = v.objectId && D.open.has(v.objectId);
        return [api.press({ class: 'wbx-row wbx-var', style: `padding-left:${8 + depth * 12}px`, title: `${v.name}: ${v.value}`, onclick: () => { if (!v.objectId) return; if (open) D.open.delete(v.objectId); else { D.open.add(v.objectId); if (!D.vars.has(v.objectId)) props(v.objectId); } draw(); } },
          v.objectId ? api.icon(open ? 'down' : 'right') : h('span', { class: 'ic' }), h('span', { class: 'k' }, v.name), h('span', { class: `v t-${v.type}` }, v.value)),
        open ? varRows(v.objectId, depth + 1) : null];
      });
    }
    function render(sideH, sideB) {
      const r = D.run, p = paused();
      put(sideH, h('span', { class: 't' }, 'Run and debug'), r ? null : ib('cont', 'Start debugging (F5)', () => start()));
      const btn = (icon, title, fn, on = true) => h('button', { type: 'button', class: 'wbx-dbtn', title, 'aria-label': title, disabled: !on, onclick: fn, html: api.icon(icon).innerHTML });
      const rows = [];
      if (r) {
        rows.push(h('div', { class: 'wbx-dbar' }, p ? btn('cont', 'Continue (F5)', () => cmd('resume')) : btn('pause', 'Pause (F6)', () => cmd('pause'), r.state === 'running'),
          btn('over', 'Step over (F10)', () => cmd('stepOver'), Boolean(p)), btn('into', 'Step into (F11)', () => cmd('stepInto'), Boolean(p)), btn('out', 'Step out (⇧F11)', () => cmd('stepOut'), Boolean(p)),
          btn('again', 'Restart (⇧⌘F5)', restart), btn('halt', 'Stop (⇧F5)', stop)));
        const f = frame();
        rows.push(h('div', { class: `wbx-say${p?.error ? ' bad' : ''}` }, p ? `Paused${p.reason && !/other|breakpoint/i.test(p.reason) ? ` (${p.reason})` : ' on a breakpoint'}${f?.path ? ` at ${base(f.path)}:${f.line}` : ''}${p.error ? `: ${p.error}` : ''}` : r.state === 'starting' ? `Starting ${base(r.path)}…` : `Running ${base(r.path)}…`));
        if (r.runtime === 'bun' && !p) rows.push(h('div', { class: 'wbx-note' }, 'Bun stays open after the program ends while it is debugged: press Stop when it is done.'));
        if (p) {
          rows.push(sec('vars', 'Variables', null, () => (f?.scopes ?? []).flatMap((sc) => { const open = D.open.has(sc.objectId); return [api.press({ class: 'wbx-row', style: 'padding-left:8px', onclick: () => { if (open) D.open.delete(sc.objectId); else { D.open.add(sc.objectId); if (!D.vars.has(sc.objectId)) props(sc.objectId); } draw(); } }, api.icon(open ? 'down' : 'right'), h('span', { class: 'nm' }, `${sc.type[0].toUpperCase()}${sc.type.slice(1)}${sc.name ? `: ${sc.name}` : ''}`)), open ? varRows(sc.objectId, 1) : null]; })));
          rows.push(sec('stack', 'Call stack', p.frames.length, () => p.frames.map((fr, i) => api.press({ class: `wbx-row${i === r.frame ? ' sel' : ''}`, style: 'padding-left:14px', title: fr.url, onclick: () => { r.frame = i; D.vars.clear(); D.open.clear(); if (fr.path) api.openFile(fr.path, { line: fr.line }); markHere(); loadScopes(); draw(); } },
            h('span', { class: 'nm' }, fr.name), h('span', { class: 'sub' }, fr.path ? `${base(fr.path)}:${fr.line}` : (fr.url ? `${base(fr.url)}:${fr.line}` : ''))))));
        }
      } else {
        const target = D.target ?? api.nowDoc()?.path ?? null;
        rows.push(h('div', { class: 'wbx-dstart' },
          h('div', { class: 'wbx-note' }, 'Run a file with its breakpoints, step through it and see its variables.'),
          api.press({ class: 'wbx-row wbx-dtarget', title: 'Pick the file to run', onclick: pickTarget }, api.icon('file'), h('span', { class: 'nm' }, target ? base(target) : 'Pick a file…', target && dirOf(target) ? h('span', { class: 'sub' }, `  ${dirOf(target)}`) : null), h('span', { class: 'wbx-key' }, 'change')),
          h('div', { class: 'wbx-seg', role: 'radiogroup', 'aria-label': 'Runtime' }, ['auto', 'node', 'bun'].map((k) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(D.runtime === k), class: D.runtime === k ? 'on' : '', onclick: () => { D.runtime = k; host.store?.set('dbgRuntime', k); draw(); } }, k === 'auto' ? 'Auto' : k))),
          h('button', { type: 'button', class: 'wbx-btn', disabled: !target, onclick: () => start(target) }, 'Start debugging'), h('span', { class: 'wbx-key' }, ' F5')));
        if (D.say) rows.push(h('div', { class: 'wbx-say bad' }, D.say));
      }
      rows.push(sec('bps', 'Breakpoints', bpCount(), () => (bpCount() ? [...D.bps].flatMap(([path, s]) => [...s].sort((a, b) => a - b).map((line) => api.press({ class: 'wbx-row', style: 'padding-left:14px', onclick: () => api.openFile(path, { line }) }, h('span', { class: 'wbx-bpdot' }), h('span', { class: 'nm' }, base(path), h('span', { class: 'sub' }, `  line ${line}`)), h('span', { class: 'acts' }, ib('x', 'Take it away', () => toggleBp(path, line))))))
        : [h('div', { class: 'wbx-note', style: 'padding-left:14px' }, 'Click beside a line number to stop there (F9).')])));
      put(sideB, ...rows.flat(3).filter(Boolean));
    }
    function pickTarget() {
      const go = (files) => api.pick({ placeholder: 'The file to run', items: files.filter((p) => /\.(m?[jt]sx?|c[jt]s)$/.test(p)).slice(0, 3000).map((p) => ({ title: base(p), sub: dirOf(p), run: () => { D.target = p; host.store?.set('dbgTarget', p); draw(); } })) });
      host.files().then((r) => go(r?.files ?? []));
    }
    function draw() { if (api.S.view === 'debug') api.renderSide(); api.renderAct(); }

    return {
      id: 'debug',
      api: { start, stop, toggleBp, cmd, evaluate, state: () => ({ run: D.run ? { ...D.run } : null, bps: Object.fromEntries([...D.bps].map(([p, s]) => [p, [...s]])), vars: Object.fromEntries(D.vars), out: D.out.map((x) => x[0]).join('') }) },
      views: [{ id: 'debug', icon: 'bug', title: 'Run and debug', badge: () => (D.run ? '●' : 0), badgeCls: 'live', render }],
      panels: [{ id: 'dbgcon', title: 'Debug console', when: () => Boolean(D.run || D.out.length), mount(box) {
        D.conEl = box;
        let at = -1;
        const inp = h('input', { type: 'text', spellcheck: 'false', placeholder: 'Evaluate in the paused frame (↑ for the last ones)', 'aria-label': 'Evaluate', onkeydown: (e) => {
          if (e.key === 'Enter') { evaluate(inp.value); inp.value = ''; at = -1; }
          else if (e.key === 'ArrowUp' && D.hist.length) { at = Math.min(D.hist.length - 1, at + 1); inp.value = D.hist[at]; e.preventDefault(); }
          else if (e.key === 'ArrowDown') { at = Math.max(-1, at - 1); inp.value = at < 0 ? '' : D.hist[at]; e.preventDefault(); }
          e.stopPropagation();
        } });
        put(box, h('div', { class: 'wbx-con' }, h('pre', { class: 'wbx-out wbx-con-out' }), h('div', { class: 'wbx-con-in' }, h('span', { class: 'p' }, '›'), inp)));
        const pre = box.querySelector('pre'); for (const [t, c] of D.out) pre.append(h('span', { class: c ? `c-${c}` : null }, t));
      } }],
      monaco(m) {
        // the value under the pointer while paused
        D.hover = m.languages.registerHoverProvider(['javascript', 'typescript'], { async provideHover(model, pos) {
          if (!paused() || model.uri.scheme !== 'file') return null;
          const w = model.getWordAtPosition(pos); if (!w) return null;
          const line = model.getLineContent(pos.lineNumber), before = line.slice(0, w.startColumn - 1).match(/((?:[\w$]+\??\.)*)$/)?.[1] ?? '';
          const expr = `${before.replace(/\?\./g, '.')}${w.word}`;
          const r = await host.debug.cmd(D.run.id, 'eval', { expression: expr, callFrameId: frame()?.callFrameId });
          if (!r || r.bad) return null;
          return { range: new m.Range(pos.lineNumber, w.startColumn - before.length, pos.lineNumber, w.endColumn), contents: [{ value: `\`${expr}\` = ${'`'}${String(r.value).slice(0, 400)}${'`'}` }] };
        } });
      },
      editor(g) {
        g.editor.updateOptions({ glyphMargin: true });
        g.editor.onMouseDown((e) => {
          // the margin beside the line numbers (2: glyphs, 4: line marks), not a test's own mark there
          const t = e.target; if (!t || (t.type !== 2 && t.type !== 4) || t.element?.classList?.contains('wbx-tglyph')) return;
          const d = api.docOf(g.active), line = t.position?.lineNumber;
          if (d?.kind === 'file' && line) toggleBp(d.path, line);
        });
        g.editor.onDidChangeModel(() => { const d = api.docOf(g.active); if (d?.kind === 'file') setTimeout(() => { markBps(d.path); markHere(); }, 0); });
      },
      model(doc) { markBps(doc.path); markHere(); let t = null; doc.model.onDidChangeContent(() => { clearTimeout(t); t = setTimeout(() => followBps(doc), 300); }); },
      keys(e) {
        if (!(api.inside(e.target) || D.run) || e.altKey) return null;
        const sh = e.shiftKey, mod = e.metaKey || e.ctrlKey;
        if (e.key === 'F5' && sh && mod) return D.run ? restart : null;
        if (e.key === 'F5') return sh ? (D.run ? stop : null) : D.run ? (paused() ? () => cmd('resume') : null) : () => start();
        if (e.key === 'F6' && D.run && !paused()) return () => cmd('pause');
        if (e.key === 'F10' && paused()) return () => cmd('stepOver');
        if (e.key === 'F11' && paused()) return () => cmd(sh ? 'stepOut' : 'stepInto');
        if (e.key === 'F9' && !sh) return () => { const g = api.now(), d = api.nowDoc(), line = g?.editor?.getPosition()?.lineNumber; if (d?.kind === 'file' && line) toggleBp(d.path, line); };
        return null;
      },
      foot: () => (D.run ? [h('button', { type: 'button', class: 'wbx-dfoot', title: 'Run and debug', onclick: () => api.setView('debug') }, h('span', { html: api.icon('bug').innerHTML }), paused() ? ` Paused · ${base(frame()?.path ?? D.run.path)}:${frame()?.line ?? ''}` : ` Debugging ${base(D.run.path)}`)] : []),
      commands: () => [
        { title: 'Debug: Start Debugging', k: 'F5', run: () => start() },
        { title: 'Debug: Start Debugging This File', k: '', run: () => { const d = api.nowDoc(); if (d?.kind === 'file') start(d.path); } },
        { title: 'Debug: Toggle Breakpoint', k: 'F9', run: () => { const g = api.now(), d = api.nowDoc(), line = g?.editor?.getPosition()?.lineNumber; if (d?.kind === 'file' && line) toggleBp(d.path, line); } },
        { title: 'Debug: Remove Every Breakpoint', k: '', run: () => { for (const [p, s] of D.bps) for (const l of [...s]) toggleBp(p, l); } },
        D.run ? { title: 'Debug: Stop', k: '⇧F5', run: stop } : null, D.run ? { title: 'Debug: Restart', k: '⇧⌘F5', run: restart } : null,
        { title: 'View: Debug Console', k: '', run: () => api.togglePanel('dbgcon') },
      ].filter(Boolean),
      dispose() { stop(); D.hover?.dispose?.(); },
    };
  });
})();
