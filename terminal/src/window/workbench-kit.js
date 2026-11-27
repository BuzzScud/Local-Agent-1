// The workbench's small tools (27 Nov 2026), loaded before workbench.js and its parts, which take them from
// window.WorkbenchKit: an element made in one call, a box's children set anew, how well typed letters fit a name, and
// a colour of the page as numbers. Moved out of workbench.js so that file stays one a model can read whole.
(() => {
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(3)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  };
  // An element's children set anew: lists flattened, and nothing for a part that is not there (replaceChildren itself
  // would write the word "null").
  const put = (el, ...kids) => el.replaceChildren(...kids.flat(3).filter((k) => k != null && k !== false));

  // How well what was typed fits a name: every letter in order, better at the start of a word or of the file's own
  // name and in a run. → { score, at: [the letters' places] } or null.
  function fuzzy(q, s) {
    if (!q) return { score: 0, at: [] };
    const name = s.lastIndexOf('/') + 1;
    const walk = (from) => {
      const t = s.toLowerCase(); let i = 0, score = 0, last = -2; const at = [];
      for (let j = from; j < t.length && i < q.length; j++) {
        if (t[j] !== q[i]) continue;
        score += 1 + (j === last + 1 ? 4 : 0) + (j === name ? 8 : 0) + (j >= name ? 2 : 0) + (j === 0 || /[/._\- ]/.test(t[j - 1]) ? 3 : 0);
        at.push(j); last = j; i++;
      }
      return i === q.length ? { score: score - s.length * 0.02, at } : null;
    };
    return walk(name) ?? walk(0);
  }
  const marked = (s, at) => { const on = new Set(at); const out = []; let run = '', hit = false; for (let i = 0; i <= s.length; i++) { const now = on.has(i); if (i === s.length || now !== hit) { if (run) out.push(hit ? h('b', null, run) : run); run = ''; hit = now; } if (i < s.length) run += s[i]; } return out; };

  // A colour of the page as numbers, whatever way its stylesheet wrote it.
  function colourOf(el, name) {
    const probe = h('span', { style: `color: var(${name}); display: none` }); el.append(probe);
    const c = getComputedStyle(probe).color; probe.remove();
    // a mixed colour comes back as color(srgb r g b / a), each from 0 to 1
    const k = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(c);
    if (k) return { r: k[1] * 255, g: k[2] * 255, b: k[3] * 255, a: k[4] == null ? 1 : Number(k[4]) };
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  }
  const over = (c, bg) => (c.a >= 1 || !bg ? c : { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 });
  const hex = (c) => `#${[c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;


  // VS Code's editor part in the page's colours: each --wbx- name as the editor's own colour of that kind.
  function theme(m, root) {
    const c = (n) => colourOf(root, n);
    const bg = c('--wbx-bg') ?? { r: 22, g: 22, b: 24, a: 1 };
    const of = (n, fb) => hex(over(c(n) ?? fb, bg));
    const dark = (bg.r * 299 + bg.g * 587 + bg.b * 114) / 1000 < 128;
    const pane = of('--wbx-pane', bg), line = of('--wbx-line2', bg), text = of('--wbx-text', { r: 232, g: 232, b: 234, a: 1 }), faint = of('--wbx-faint', { r: 150, g: 150, b: 157, a: 1 });
    m.editor.defineTheme('wb', { base: dark ? 'vs-dark' : 'vs', inherit: true, rules: [], colors: {
      'editor.background': hex(bg), 'editor.foreground': text, 'editorGutter.background': hex(bg), 'editorLineNumber.foreground': faint, 'editorLineNumber.activeForeground': text,
      'editor.lineHighlightBackground': of('--wbx-raise', bg), 'editor.lineHighlightBorder': '#00000000', 'editorCursor.foreground': of('--wbx-accent', bg), 'editor.selectionBackground': of('--wbx-mark', bg),
      'editorWidget.background': pane, 'editorWidget.border': line, 'editorSuggestWidget.background': pane, 'editorHoverWidget.background': pane, 'input.background': of('--wbx-field', bg), 'focusBorder': of('--wbx-accent-line', bg),
      'quickInput.background': pane, 'list.hoverBackground': of('--wbx-raise2', bg), 'list.activeSelectionBackground': of('--wbx-accent-bg', bg), 'minimap.background': hex(bg), 'editorStickyScroll.background': hex(bg),
      'scrollbarSlider.background': `${line}99`, 'scrollbarSlider.hoverBackground': line, 'editorIndentGuide.background1': of('--wbx-line', bg), 'diffEditor.insertedTextBackground': `${of('--wbx-ok', bg)}33`, 'diffEditor.removedTextBackground': `${of('--wbx-bad', bg)}33`,
    } });
    m.editor.setTheme('wb');
  }
  // VS Code's editor part's options in the page's type: the mono face the page sets, the minimap and wrap you chose.
  const edOpts = (root, S, opts) => ({ theme: 'wb', automaticLayout: true, fontSize: 13, lineHeight: 20, fontFamily: getComputedStyle(root).getPropertyValue('--wbx-mono').trim() || 'ui-monospace, Menlo, monospace', minimap: { enabled: S.minimap && !opts.narrow }, wordWrap: S.wrap ? 'on' : 'off', scrollBeyondLastLine: false, smoothScrolling: true, padding: { top: 8 }, fixedOverflowWidgets: true, tabSize: 2, renderWhitespace: 'selection', bracketPairColorization: { enabled: true }, stickyScroll: { enabled: true }, scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 } });
  window.WorkbenchKit = { h, put, fuzzy, marked, colourOf, over, hex, theme, edOpts };

  // The terminal's own button on the activity bar (27 Nov 2026, the owner, pointing at the bar: "can you add the terminal
  // here?"): a part of every workbench whose page has a terminal; it opens the panel on the terminal, or puts it away.
  (window.WorkbenchParts ??= []).push((api) => {
    if (!api.host.terminal) return null;
    api.addIcons({ terminal: '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M4.8 6.2l2.2 1.9-2.2 1.9M8.5 10.3h2.8"/></svg>' });
    return { id: 'term', views: [{ id: 'term', icon: 'terminal', title: `Terminal ${api.key('⌃', '`')}`, on: () => api.S.panel === 'terminal', run: () => api.togglePanel('terminal'), badge: () => (api.S.terms.length > 1 ? api.S.terms.length : 0) }] };
  });
})();
