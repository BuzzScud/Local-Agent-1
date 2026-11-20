// NotebookEdit (tools-defs.mjs, Claude Code's tool of that name; the owner's pick 19 Nov 2026): one cell of a
// Jupyter notebook replaced, inserted or deleted, worked out here on the file's text; agent-step.mjs runs
// the result as one Edit of the whole file, so its checks, questions and /rewind hold as for any Edit.

// A cell's source as Jupyter keeps it: a list of lines, each but the last ending in \n.
const sourceLines = (s) => { const t = String(s ?? ''); if (!t) return []; const parts = t.split('\n'); return parts.map((l, i) => (i < parts.length - 1 ? `${l}\n` : l)).filter((l) => l !== ''); };
const textOf = (src) => (Array.isArray(src) ? src.join('') : String(src ?? ''));

// Every cell with its number, kind and first line, for an answer.
function cellList(nb) {
  return (nb.cells ?? []).map((c, i) => `${i} · ${c.cell_type} · ${textOf(c.source).split('\n').find((l) => l.trim())?.slice(0, 80) ?? '(empty)'}`).join('\n');
}

// text: the .ipynb file as it is; args: the call's. → { after, said } or { error } or { list } (only path given).
export function notebookChange(text, args) {
  let nb;
  try { nb = JSON.parse(text); } catch { return { error: 'This file is not a notebook: its text is not JSON.' }; }
  if (!Array.isArray(nb?.cells)) return { error: 'This file is not a notebook: it has no "cells" list.' };
  const mode = args.mode ?? 'replace';
  const n = nb.cells.length;
  if (args.cell == null && args.source == null && args.mode == null) return { list: `${n} cell${n === 1 ? '' : 's'}:\n${cellList(nb)}` };
  if (!['replace', 'insert', 'delete'].includes(mode)) return { error: `mode is replace, insert or delete, not "${mode}".` };
  const at = args.cell == null ? (mode === 'insert' ? n : null) : Number(args.cell);
  if (at == null || !Number.isInteger(at) || at < 0 || at > (mode === 'insert' ? n : n - 1)) return { error: `There is no cell ${args.cell ?? '(none given)'}: the notebook has ${n} (0 to ${n - 1}).\n${cellList(nb)}` };
  if (mode !== 'delete' && typeof args.source !== 'string') return { error: `${mode} needs source: the cell's new text.` };
  const kind = args.cell_type;
  if (kind != null && !['code', 'markdown'].includes(kind)) return { error: `cell_type is code or markdown, not "${kind}".` };
  const cells = [...nb.cells];
  let said;
  if (mode === 'delete') { cells.splice(at, 1); said = `Deleted cell ${at}`; }
  else if (mode === 'insert') {
    const type = kind ?? 'code';
    cells.splice(at, 0, type === 'code' ? { cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: sourceLines(args.source) } : { cell_type: 'markdown', metadata: {}, source: sourceLines(args.source) });
    said = `Inserted a ${type} cell at ${at}`;
  } else {
    const was = cells[at];
    const type = kind ?? was.cell_type;
    const cell = { ...was, cell_type: type, source: sourceLines(args.source) };
    if (type === 'code') { cell.outputs = []; cell.execution_count = null; } else { delete cell.outputs; delete cell.execution_count; }
    cells[at] = cell;
    said = `Replaced cell ${at} (${type})`;
  }
  // Jupyter writes one space of indent and a new line at the end; a file written otherwise keeps its own indent.
  const indent = /^\{\n( +|\t)"/.exec(text)?.[1] ?? ' ';
  const after = `${JSON.stringify({ ...nb, cells }, null, indent)}${text.endsWith('\n') ? '\n' : ''}`;
  return { after, said };
}
