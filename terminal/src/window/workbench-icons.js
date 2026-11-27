// The workbench's icons in the window (workbench.js draws none of its own: the page that holds it brings them, so on hearth
// they are hearth's). A name → its drawing, in the window's own line weight.
(() => {
  const svg = (d, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  window.WorkbenchIcons = {
    files: svg('<path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3"/>', 18), search: svg('<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>', 18),
    git: svg('<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="6" r="1.5"/><path d="M4.5 5v6M11.5 7.5c0 2.5-3 2.5-7 3"/>', 18),
    panel: svg('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 9.5h11"/>', 18),
    right: svg('<path d="M6 4l4 4-4 4"/>', 14), down: svg('<path d="M4 6l4 4 4-4"/>', 14), x: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>', 12),
    file: svg('<path d="M4.5 2.5h4.5l2.5 2.5v8.5h-7z"/>', 14), newFile: svg('<path d="M4 2.5h5l3 3v8H4z"/><path d="M8 7.5v4M6 9.5h4"/>', 14),
    newDir: svg('<path d="M2 4.5h4l1.2 1.5H14v7H2z"/><path d="M8 8v3M6.5 9.5h3"/>', 14), refresh: svg('<path d="M12.5 7A4.5 4.5 0 0 0 4 5.2M3.5 9A4.5 4.5 0 0 0 12 10.8"/><path d="M4 2.8v2.6h2.6M12 13.2v-2.6H9.4"/>', 14),
    fold: svg('<path d="M3 5.5h10M3 8h10M3 10.5h10"/>', 14), plus: svg('<path d="M8 3.5v9M3.5 8h9"/>', 14), minus: svg('<path d="M3.5 8h9"/>', 14),
    undo: svg('<path d="M5.5 4L3 6.5 5.5 9"/><path d="M3 6.5h6a3.5 3.5 0 0 1 0 7H7"/>', 14), pen: svg('<path d="M3 13l.6-2.8L10.8 3l2.2 2.2-7.2 7.2z"/>', 13),
    bin: svg('<path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5"/>', 13), split: svg('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M8 3v10"/>', 14),
    branch: svg('<circle cx="4.5" cy="3.5" r="1.4"/><circle cx="4.5" cy="12.5" r="1.4"/><circle cx="11.5" cy="5.5" r="1.4"/><path d="M4.5 5v6M11.5 7c0 2.6-3.4 2.4-7 3"/>', 13),
    warn: svg('<path d="M8 2.5l6 10.5H2z"/><path d="M8 6.5v3M8 11.3v.1"/>', 13), err: svg('<circle cx="8" cy="8" r="5.5"/><path d="M6 6l4 4M10 6l-4 4"/>', 13),
    max: svg('<path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9"/>', 13), restore: svg('<path d="M13.5 2.5L9.5 6.5M9.5 3v3.5H13M2.5 13.5l4-4M6.5 13V9.5H3"/>', 13),
    clear: svg('<path d="M3 3.5h10M3 6.5h6M3 9.5h4"/><path d="M10 9l3.5 3.5M13.5 9L10 12.5"/>', 13),
    chat: svg('<path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z"/>', 13), open: svg('<path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5L7.5 8.5"/>', 13),
  };
})();
