// The Tests view (27 Nov 2026, the owner's pick: "lists the project's tests, runs one or all, and shows pass or fail next
// to the code"). A part of workbench.js. The host finds the tests and runs them (host.tests: list() → { runner, files:
// [{ path, tests: [{ name, short, line }] }] }, run({ path, name }, on) → { id } | { why }, with on(m) getting what the run
// prints ({ data }) and its end ({ ended, code, secs, results: [{ name, state, ms }] }), stop(id)). This part draws the
// list in the side pane, the run's output in a panel, a mark beside each test in its file (click it to run that test),
// and "Ask … to fix" on a test that failed.
(() => {
  const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
  (window.WorkbenchParts ??= []).push((api) => {
    const { h, put, ib, host, base, dirOf, plural, key } = api;
    if (!host.tests) return null;
    const T = { list: null, busy: false, run: null, out: '', state: new Map(), runs: 0, q: '', shut: new Set(host.store?.get('testsShut') ?? []), outEl: null, decos: new Map(), last: null, tick: null };
    api.addIcons({
      flask: '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2.5h4M6.8 2.5v4L3.2 12.6a.9.9 0 0 0 .8 1.4h8a.9.9 0 0 0 .8-1.4L9.2 6.5v-4"/><path d="M4.6 10h6.8"/></svg>',
      play: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.2v9.6L12.5 8z"/></svg>',
      stop: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>',
    });
    const keyOf = (path, name) => `${path}\0${name}`;
    const stateOf = (path, t) => T.state.get(keyOf(path, t.name)) ?? null;
    const fileState = (f) => { const s = f.tests.map((t) => stateOf(f.path, t)?.state).filter(Boolean); return s.includes('fail') ? 'fail' : s.includes('run') ? 'run' : s.length && s.every((x) => x === 'pass' || x === 'skip') ? 'pass' : T.state.get(keyOf(f.path, ''))?.state ?? null; };
    const dot = (st) => h('span', { class: `wbx-tdot ${st ?? 'none'}`, title: { pass: 'passed', fail: 'failed', skip: 'skipped', run: 'running' }[st] ?? 'not run yet' });

    async function load() { T.busy = true; draw(); const r = await host.tests.list(); T.busy = false; T.list = r?.files ? r : { runner: null, files: [], why: r?.why ?? r?.error }; draw(); markAll(); }
    function run(path = null, name = null) {
      if (T.run) stop();
      T.out = ''; T.last = { path, name };
      // what this run covers is "running" until its results say otherwise
      for (const f of T.list?.files ?? []) if (!path || f.path === path) for (const t of f.tests) if (!name || t.name === name) T.state.set(keyOf(f.path, t.name), { state: 'run' });
      if (path) T.state.set(keyOf(path, ''), { state: 'run' });
      const r = host.tests.run({ path, name }, (m) => {
        if (m.data) { T.out += m.data.replace(ANSI, ''); if (T.out.length > 600_000) T.out = T.out.slice(-500_000); showOut(); }
        if (m.ended) finish(m, path, name);
      });
      if (r?.why) { T.out = r.why; T.run = null; for (const [k, v] of T.state) if (v.state === 'run') T.state.delete(k); showOut(); return draw(); }
      T.run = { id: r?.id, path, name, t0: Date.now() };
      T.tick = setInterval(() => api.renderFoot(), 1000);
      if (!api.S.panel || api.S.panel !== 'testout') api.togglePanel('testout');
      draw(); markAll(); api.renderFoot();
    }
    function finish(m, path, name) {
      clearInterval(T.tick); T.run = null; T.runs++;
      const res = m.results ?? [], c = m.counts;
      const files = (T.list?.files ?? []).filter((f) => !path || f.path === path);
      const covered = files.flatMap((f) => f.tests.filter((t) => !name || t.name === name));
      // a runner that names only its failures (bun out of a terminal): the rest passed when its totals add up
      const named = res.filter((x) => x.state !== 'pass').length;
      const restPassed = m.code === 0 || (c && c.pass + c.fail + (c.skip ?? 0) === covered.length && c.fail + (c.skip ?? 0) === named);
      for (const f of files) for (const t of f.tests) {
        if (name && t.name !== name) continue;
        const hit = res.find((x) => (!x.file || f.path.endsWith(x.file)) && (x.name === t.name || x.name.endsWith(` > ${t.name}`) || x.name === t.short || x.name.endsWith(t.short)));
        T.state.set(keyOf(f.path, t.name), hit ? { state: hit.state, ms: hit.ms } : { state: restPassed ? 'pass' : 'none' });
      }
      if (path) T.state.set(keyOf(path, ''), { state: m.code === 0 ? 'pass' : 'fail' });
      const p = c?.pass ?? res.filter((x) => x.state === 'pass').length, f = c?.fail ?? res.filter((x) => x.state === 'fail').length;
      T.summary = { pass: p, fail: f, secs: m.secs, code: m.code, at: Date.now() };
      T.out += `\n${m.code === 0 ? '✓' : '✗'} ${res.length || c ? `${p} passed${f ? `, ${f} failed` : ''}` : `exit code ${m.code}`} in ${(m.secs ?? 0).toFixed(1)} s\n`;
      showOut(); draw(); markAll(); api.renderFoot();
    }
    function stop() { if (T.run?.id) host.tests.stop(T.run.id); }
    function showOut() {
      if (!T.outEl) return;
      const pre = T.outEl.querySelector('pre'), atEnd = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
      pre.textContent = T.out || 'Run a test to see what it prints here.';
      if (atEnd) pre.scrollTop = pre.scrollHeight;
    }
    function fixAsk(f, t) {
      const lines = T.out.split('\n'), at = lines.findIndex((l) => l.includes(t.short) && /fail|✗|×|✕/i.test(l));
      const tail = (at >= 0 ? lines.slice(Math.max(0, at - 30), at + 5) : lines.slice(-40)).join('\n').trim();
      host.toChat?.(`This test fails: "${t.name}" in ${f.path}:${t.line}. Find out why and fix the code (not the test, unless the test is wrong).\n\`\`\`\n${tail}\n\`\`\`\n`);
    }

    // ---------- the side pane
    function render(sideH, sideB) {
      put(sideH, h('span', { class: 't' }, 'Tests'), T.run ? ib('stop', 'Stop the run', stop) : ib('play', 'Run every test', () => run()), ib('refresh', 'Find the tests again', load), ib('fold', 'Close every file', () => { T.shut = new Set((T.list?.files ?? []).map((f) => f.path)); host.store?.set('testsShut', [...T.shut]); draw(); }));
      if (!T.list) { if (!T.busy) load(); return put(sideB, h('div', { class: 'wbx-empty' }, 'Finding the tests…')); }
      if (!T.list.runner) return put(sideB, h('div', { class: 'wbx-empty' }, T.list.why ?? 'No test runner here (package.json, bun, pytest or go).'));
      const q = T.q.toLowerCase(), rows = [];
      let n = 0, pass = 0, fail = 0;
      for (const f of T.list.files) for (const t of f.tests) { n++; const s = stateOf(f.path, t)?.state; if (s === 'pass') pass++; else if (s === 'fail') fail++; }
      if (!sideB.querySelector('.wbx-tform')) put(sideB, h('div', { class: 'wbx-form wbx-tform' }, h('div', { class: 'line' }, h('input', { type: 'text', 'data-keep': 'tq', placeholder: 'Filter tests', 'aria-label': 'Filter tests', value: T.q, spellcheck: 'false', oninput: (e) => { T.q = e.target.value; draw(); } }))), h('div', { class: 'wbx-res' }));
      rows.push(h('div', { class: 'wbx-note' }, `${T.list.runner} · ${plural(n, 'test')} in ${plural(T.list.files.length, 'file')}${pass || fail ? ` · ${pass} passed${fail ? `, ${fail} failed` : ''}` : ''}${T.run ? ' · running…' : ''}`));
      for (const f of T.list.files) {
        const tests = q ? f.tests.filter((t) => t.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) : f.tests;
        if (q && !tests.length) continue;
        const shut = T.shut.has(f.path) && !q;
        rows.push(api.press({ class: 'wbx-row', style: 'padding-left:8px', title: f.path, 'aria-expanded': String(!shut), onclick: () => { if (shut) T.shut.delete(f.path); else T.shut.add(f.path); host.store?.set('testsShut', [...T.shut]); draw(); } },
          api.icon(shut ? 'right' : 'down'), dot(fileState(f)), h('span', { class: 'nm' }, base(f.path), dirOf(f.path) ? h('span', { class: 'sub' }, `  ${dirOf(f.path)}`) : null),
          h('span', { class: 'acts' }, ib('open', 'Open the file', () => api.openFile(f.path)), ib('play', 'Run this file', () => run(f.path))), h('span', { class: 'tag' }, f.tests.length)));
        if (shut) continue;
        for (const t of tests) {
          const st = stateOf(f.path, t);
          rows.push(api.press({ class: 'wbx-row', style: 'padding-left:30px', title: `${t.name} · line ${t.line}`, onclick: () => api.openFile(f.path, { line: t.line }) },
            dot(st?.state), h('span', { class: 'nm' }, t.name.includes(' > ') ? [h('span', { class: 'sub' }, `${t.name.slice(0, t.name.lastIndexOf(' > '))} › `), t.short] : t.name),
            h('span', { class: `acts${st?.state === 'fail' ? ' on' : ''}` }, st?.state === 'fail' && host.toChat ? ib('chat', `Ask ${host.agentName ?? 'the agent'} to fix it`, () => fixAsk(f, t)) : null, ib('play', 'Run this test', () => run(f.path, t.name))),
            st?.ms != null ? h('span', { class: 'sub' }, `${st.ms < 1000 ? `${Math.round(st.ms)} ms` : `${(st.ms / 1000).toFixed(1)} s`}`) : null));
        }
      }
      put(sideB.querySelector('.wbx-res'), ...rows);
    }
    function draw() { if (api.S.view === 'tests') api.renderSide(); api.renderAct(); }

    // ---------- the marks beside the tests in their files
    function markAll() { for (const g of api.groups()) { const d = api.docOf(g.active); if (d?.kind === 'file') mark(d); } }
    function mark(doc) {
      const m = api.monaco(); const f = T.list?.files?.find((x) => x.path === doc.path);
      if (!m || !doc.model || doc.model.isDisposed()) return;
      const decos = (f?.tests ?? []).filter((t) => t.line <= doc.model.getLineCount()).map((t) => { const s = stateOf(f.path, t)?.state ?? 'none'; return { range: new m.Range(t.line, 1, t.line, 1), options: { glyphMarginClassName: `wbx-tglyph wbx-tglyph-${s}`, glyphMarginHoverMessage: { value: `${t.name}: ${{ pass: 'passed', fail: 'failed', run: 'running', skip: 'skipped' }[s] ?? 'not run yet'} · click to run it` } } }; });
      T.decos.set(doc.path, doc.model.deltaDecorations(T.decos.get(doc.path) ?? [], decos));
    }

    return {
      id: 'tests',
      api: { run, stop, load, state: () => ({ list: T.list, run: T.run, summary: T.summary ?? null, out: T.out, results: [...T.state].map(([k, v]) => ({ key: k.replace('\0', ' :: '), ...v })) }) },
      views: [{ id: 'tests', icon: 'flask', title: 'Tests', badge: () => [...T.state.values()].filter((v) => v.state === 'fail').length, badgeCls: 'bad', render, shown: () => { if (!T.list && !T.busy) load(); } }],
      panels: [{ id: 'testout', title: 'Test output', when: () => Boolean(T.run || T.out), mount(box) { T.outEl = box; put(box, h('pre', { class: 'wbx-out' })); showOut(); } }],
      editor(g) {
        g.editor.updateOptions({ glyphMargin: true });
        g.editor.onMouseDown((e) => {
          if (!e.target?.element?.classList?.contains('wbx-tglyph')) return;
          const d = api.docOf(g.active), f = T.list?.files?.find((x) => x.path === d?.path), line = e.target.position?.lineNumber;
          const t = f?.tests.find((x) => x.line === line); if (t) run(f.path, t.name);
        });
        g.editor.onDidChangeModel(() => { const d = api.docOf(g.active); if (d?.kind === 'file') setTimeout(() => mark(d), 0); });
      },
      model(doc) { if (T.list) mark(doc); else if (/(\.(test|spec)\.|_test\.|test_)/.test(doc.path)) load(); },
      changed(paths) { if (T.list && paths?.some((p) => /(\.(test|spec)\.|_test\.|(^|\/)test_)/.test(p))) { clearTimeout(T.again); T.again = setTimeout(load, 800); } },
      foot: () => (T.run ? [h('button', { type: 'button', title: 'Stop the run', onclick: stop }, h('span', { html: api.icon('flask').innerHTML }), ` Testing… ${Math.round((Date.now() - T.run.t0) / 1000)} s`)]
        : T.summary ? [h('button', { type: 'button', class: T.summary.fail || T.summary.code ? 'bad' : '', title: 'Tests', onclick: () => api.setView('tests') }, h('span', { html: api.icon('flask').innerHTML }), T.summary.fail ? ` ${T.summary.fail} failed` : T.summary.pass ? ` ${T.summary.pass} passed` : ` exit ${T.summary.code}`)] : []),
      commands: () => [
        { title: 'Test: Run Every Test', k: '', run: () => { api.setView('tests'); if (!T.list) load().then(() => run()); else run(); } },
        { title: 'Test: Run the Tests in This File', k: '', run: () => { const d = api.nowDoc(); if (d?.kind === 'file') run(d.path); } },
        { title: 'Test: Run the Test at the Cursor', k: '', run: () => { const g = api.now(), d = api.nowDoc(); const f = T.list?.files?.find((x) => x.path === d?.path); const line = g?.editor?.getPosition()?.lineNumber ?? 0; const t = f?.tests.filter((x) => x.line <= line).pop(); if (t) run(f.path, t.name); } },
        { title: 'Test: Run the Last Run Again', k: '', run: () => T.last && run(T.last.path, T.last.name) },
        T.run ? { title: 'Test: Stop', k: '', run: stop } : null,
        { title: 'View: Test Output', k: '', run: () => api.togglePanel('testout') },
      ].filter(Boolean),
      dispose() { clearInterval(T.tick); stop(); },
    };
  });
})();
