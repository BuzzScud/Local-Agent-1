// Adding a model-written test to a test file: its import lines are merged
// with the file's own, the rest goes at the end.
export function mergeTest(fileText, testCode, lang) {
  const lines = testCode.replace(/\n$/, '').split('\n');
  // Any import line (whatever its form) is an import, never test code.
  const isImport = lang === 'python' ? (l) => /^(from\s+\S+\s+import\s+|import\s+)/.test(l) : (l) => /^\s*import[\s{*'"]/.test(l) || /^\s*(const|let|var)\s+\{?[\w\s,$]*\}?\s*=\s*require\(/.test(l);
  const imports = lines.filter(isImport);
  let body = lines.filter((l) => !isImport(l)).join('\n').replace(/^\n+/, '');
  // In JavaScript the new test gets its own block, so names it declares
  // (a second `const rows`) cannot clash with the file's own.
  if (lang !== 'python' && /^\s*(const|let|var|function|class)\s/m.test(body)) body = `{\n${body}\n}`;
  let text = fileText.replace(/\n*$/, '\n');
  for (const imp of imports) text = addImport(text, imp, lang);
  return `${text}\n${body}\n`;
}

// Names an import line brings in: default, namespace (* as x) and { a, b as c }.
function importedNames(line) {
  const names = [];
  const req = /^\s*(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\(/.exec(line);
  if (req) return req[1].startsWith('{') ? req[1].slice(1, -1).split(',').map((p) => p.trim().split(/\s*:\s*/).pop()).filter(Boolean) : [req[1]];
  const m = /^\s*import\s+(.+?)\s+from\s/.exec(line.trim());
  if (!m) return names;
  const spec = m[1];
  const def = /^([A-Za-z_$][\w$]*)\s*(,|$)/.exec(spec);
  if (def) names.push(def[1]);
  const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(spec);
  if (ns) names.push(ns[1]);
  const named = /\{([^}]*)\}/.exec(spec);
  if (named) for (const part of named[1].split(',')) { const p = part.trim(); if (p) names.push(p.split(/\s+as\s+/).pop().trim()); }
  return names;
}

function declared(text) {
  const out = new Set();
  for (const l of text.split('\n')) {
    if (/^import\s/.test(l)) importedNames(l).forEach((n) => out.add(n));
    const d = /^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/.exec(l);
    if (d) out.add(d[1]);
  }
  return out;
}

function addImport(text, imp, lang) {
  if (text.includes(imp.trim())) return text;
  const lines = text.split('\n');
  if (lang !== 'python') {
    const m = /^import\s+\{([^}]*)\}\s+from\s+(['"])(.+)\2;?/.exec(imp);
    if (m) {
      const i = lines.findIndex((l) => new RegExp(`^import\\s+\\{[^}]*\\}\\s+from\\s+['"]${m[3].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(l));
      if (i >= 0) {
        const have = /\{([^}]*)\}/.exec(lines[i])[1].split(',').map((s) => s.trim()).filter(Boolean);
        const taken = declared(text); // e.g. assert, already imported from node:assert
        const add = m[1].split(',').map((s) => s.trim()).filter((n) => n && !have.includes(n) && !taken.has(n.split(/\s+as\s+/).pop().trim()));
        if (add.length) lines[i] = lines[i].replace(/\{[^}]*\}/, `{ ${[...have, ...add].join(', ')} }`);
        return lines.join('\n');
      }
    }
  } else {
    const m = /^from\s+(\S+)\s+import\s+(.+)$/.exec(imp);
    if (m) {
      const i = lines.findIndex((l) => l.startsWith(`from ${m[1]} import `));
      if (i >= 0) {
        const have = lines[i].slice(`from ${m[1]} import `.length).split(',').map((s) => s.trim());
        const add = m[2].split(',').map((s) => s.trim()).filter((n) => !have.includes(n));
        if (add.length) lines[i] = `from ${m[1]} import ${[...have, ...add].join(', ')}`;
        return lines.join('\n');
      }
    }
  }
  // A name the file already has (import assert from 'assert' when it has
  // node:assert/strict) would clash: keep the file's own.
  if (lang !== 'python') {
    const have = declared(text);
    if (importedNames(imp).some((n) => have.has(n))) return text;
  }
  const lastImport = lines.reduce((k, l, i) => (/^(import|from)\s/.test(l) ? i : k), -1);
  lines.splice(lastImport + 1, 0, imp);
  return lines.join('\n');
}
