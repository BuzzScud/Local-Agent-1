// Code understanding (the owner's pick, 20 Nov 2026: "real code understanding"): the LSP tool asks a
// language server what the code means, as an editor does: where a name is defined, every place it is
// used, its type, a file's outline, the type errors in a file, and who calls a function. Before this
// the app only knew a file still parsed (tools-edit.mjs syntaxError).
//
// One server a language and project folder, started at the first question and kept warm (stopped
// after IDLE_MS of quiet, and when the app ends). The servers are the usual ones, found where they are:
//   TypeScript and JavaScript  typescript-language-server (the project's node_modules, then the app's
//                              home, tools/lsp, then PATH), run with bun: a Mac may have no node
//   Python                     pyright-langserver (the same places), basedpyright-langserver, pylsp
//   Swift, C, C++, Objective-C sourcekit-lsp (with Apple's command line tools), clangd
//   Rust                       rust-analyzer, with build scripts and macros off: they would run code
//   Go                         gopls
// The TypeScript and Python servers are put in the app's home with one command (INSTALL_TS_PY); a
// missing one is said with that command. AGENTIC_LSP_DIR: another folder holding their node_modules.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { HOME, REAL_HOME } from '../../../models/index.mjs';

export const IDLE_MS = 10 * 60_000;
const REQUEST_MS = 30_000; // one question; a big project's first load can take a while
const DIAG_MS = 15_000; // the first diagnostics of a cold server
export const LSP_DIR = () => process.env.AGENTIC_LSP_DIR || join(HOME, 'tools', 'lsp');
export const INSTALL_TS_PY = 'mkdir -p ~/.agentic-coder/tools/lsp && cd ~/.agentic-coder/tools/lsp && bun add typescript typescript-language-server pyright';

// bun: the one that runs Agentic Coder, or the usual place (as tools-edit.mjs bunBin).
function bunBin() {
  if (/(^|\/)bun$/.test(process.execPath)) return process.execPath;
  const home = join(homedir(), '.bun', 'bin', 'bun');
  return existsSync(home) ? home : 'bun';
}
const onPath = (name) => {
  const r = spawnSync('/usr/bin/which', [name], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};
const xcrun = (name) => {
  if (process.platform !== 'darwin') return null;
  const r = spawnSync('/usr/bin/xcrun', ['--find', name], { encoding: 'utf8', timeout: 5000 });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
};
// A package's script in the project's node_modules, the app's home, or the real home's (a test's home is empty).
function packageFile(root, rel) {
  const dirs = [join(root, 'node_modules'), join(LSP_DIR(), 'node_modules'), join(REAL_HOME ?? HOME, 'tools', 'lsp', 'node_modules')];
  for (const d of dirs) { const f = join(d, rel); if (existsSync(f)) return f; }
  return null;
}

// The servers, by language. cmd(root) → { bin, args, init? } or null when none is on this Mac.
export const SERVERS = [
  {
    id: 'typescript', name: 'TypeScript and JavaScript', exts: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
    // TypeScript 7 is a program of its own with the server in it (tsc --lsp --stdio): the project's
    // first, then the app's. An older TypeScript (tsserver.js) goes through typescript-language-server.
    cmd(root) {
      const native = packageFile(root, `@typescript/typescript-${process.platform}-${process.arch}/lib/tsc`);
      const projectOld = existsSync(join(root, 'node_modules', 'typescript', 'lib', 'tsserver.js'));
      if (native && !projectOld) return { bin: native, args: ['--lsp', '--stdio'] };
      const cli = packageFile(root, 'typescript-language-server/lib/cli.mjs');
      const tsserver = packageFile(root, 'typescript/lib/tsserver.js');
      const init = tsserver ? { tsserver: { path: tsserver } } : {};
      if (cli && tsserver) return { bin: bunBin(), args: [cli, '--stdio'], init };
      if (native) return { bin: native, args: ['--lsp', '--stdio'] };
      for (const n of ['typescript-language-server', 'tsgo']) { const bin = onPath(n); if (bin) return { bin, args: n === 'tsgo' ? ['--lsp', '--stdio'] : ['--stdio'], init }; }
      return null;
    },
    install: INSTALL_TS_PY,
  },
  {
    id: 'python', name: 'Python', exts: ['.py', '.pyi'],
    cmd(root) {
      const js = packageFile(root, 'pyright/langserver.index.js');
      if (js) return { bin: bunBin(), args: [js, '--stdio'] };
      for (const n of ['pyright-langserver', 'basedpyright-langserver']) { const bin = onPath(n); if (bin) return { bin, args: ['--stdio'] }; }
      const pylsp = onPath('pylsp');
      return pylsp ? { bin: pylsp, args: [] } : null;
    },
    install: INSTALL_TS_PY,
  },
  {
    id: 'swift', name: 'Swift', exts: ['.swift'],
    cmd() { const bin = xcrun('sourcekit-lsp') ?? onPath('sourcekit-lsp'); return bin ? { bin, args: [] } : null; },
    install: 'xcode-select --install (Apple\'s command line tools bring sourcekit-lsp)',
  },
  {
    id: 'c', name: 'C, C++ and Objective-C', exts: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.m', '.mm'],
    cmd() { const bin = onPath('clangd') ?? xcrun('clangd') ?? xcrun('sourcekit-lsp'); return bin ? { bin, args: [] } : null; },
    install: 'xcode-select --install (Apple\'s command line tools bring clangd), or brew install llvm',
  },
  {
    id: 'rust', name: 'Rust', exts: ['.rs'],
    // Build scripts and procedural macros run code of the project's: off, so a question only reads.
    cmd() { const bin = onPath('rust-analyzer'); return bin ? { bin, args: [], init: { cargo: { buildScripts: { enable: false } }, procMacro: { enable: false }, checkOnSave: false } } : null; },
    install: 'rustup component add rust-analyzer',
  },
  {
    id: 'go', name: 'Go', exts: ['.go'],
    cmd() { const bin = onPath('gopls'); return bin ? { bin, args: [] } : null; },
    install: 'go install golang.org/x/tools/gopls@latest',
  },
];
export const serverFor = (file) => SERVERS.find((s) => s.exts.includes(extname(file).toLowerCase())) ?? null;

const LANG_ID = { '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascriptreact', '.py': 'python', '.pyi': 'python', '.swift': 'swift', '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp', '.m': 'objective-c', '.mm': 'objective-cpp', '.rs': 'rust', '.go': 'go' };
const uriOf = (abs) => pathToFileURL(abs).href;
const pathOf = (uri) => { try { return fileURLToPath(uri); } catch { return uri; } };

// ---- one server over its standard input and output (JSON-RPC with Content-Length headers) ----
export class LspClient {
  constructor({ bin, args = [], root, init = {}, id = 'lsp' }) {
    this.id = id;
    this.root = root;
    this.seq = 0;
    this.waiting = new Map();
    this.diags = new Map(); // uri → { version, items }
    this.diagWaiters = [];
    this.open = new Map(); // uri → { version, text }
    this.dead = null;
    this.buf = Buffer.alloc(0);
    this.proc = spawn(bin, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: undefined } });
    this.proc.stdout.on('data', (d) => this.take(d));
    this.proc.stderr.on('data', () => {});
    this.proc.on('error', (e) => this.died(e.message));
    this.proc.on('exit', (code) => this.died(`it stopped (code ${code})`));
    this.proc.stdin.on('error', () => {});
    this.ready = this.request('initialize', {
      processId: process.pid, rootUri: uriOf(root), rootPath: root, workspaceFolders: [{ uri: uriOf(root), name: root.split('/').pop() }],
      initializationOptions: init,
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        workspace: { configuration: true, workspaceFolders: true, symbol: { dynamicRegistration: false } },
        textDocument: {
          synchronization: { didSave: false, dynamicRegistration: false },
          hover: { contentFormat: ['plaintext', 'markdown'] },
          definition: { linkSupport: false }, implementation: { linkSupport: false }, typeDefinition: { linkSupport: false },
          references: {}, documentSymbol: { hierarchicalDocumentSymbolSupport: true }, callHierarchy: {},
          publishDiagnostics: { versionSupport: true },
        },
      },
    }, 60_000).then((r) => { this.notify('initialized', {}); this.caps = r?.capabilities ?? {}; return this; });
    this.ready.catch(() => {});
    this.touch();
  }
  died(why) {
    if (this.dead) return;
    this.dead = why;
    for (const w of this.waiting.values()) w.reject(new Error(`the language server ${why}`));
    this.waiting.clear();
    for (const w of this.diagWaiters) w();
    this.diagWaiters = [];
    clearTimeout(this.idle);
  }
  touch() { clearTimeout(this.idle); this.idle = setTimeout(() => this.stop(), IDLE_MS); this.idle.unref?.(); }
  take(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const end = this.buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const len = Number(/content-length:\s*(\d+)/i.exec(this.buf.slice(0, end).toString('ascii'))?.[1]);
      if (!Number.isFinite(len)) { this.buf = this.buf.slice(end + 4); continue; }
      if (this.buf.length < end + 4 + len) return;
      const body = this.buf.slice(end + 4, end + 4 + len).toString('utf8');
      this.buf = this.buf.slice(end + 4 + len);
      let m;
      try { m = JSON.parse(body); } catch { continue; }
      this.handle(m);
    }
  }
  handle(m) {
    if (m.id !== undefined && m.method) { // a request of the server's: answered plainly
      const result = m.method === 'workspace/configuration' ? (m.params?.items ?? []).map(() => null)
        : m.method === 'workspace/workspaceFolders' ? [{ uri: uriOf(this.root), name: this.root.split('/').pop() }] : null;
      this.send({ jsonrpc: '2.0', id: m.id, result });
      return;
    }
    if (m.id !== undefined) {
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      clearTimeout(w.timer);
      if (m.error) w.reject(new Error(m.error.message)); else w.resolve(m.result);
      return;
    }
    if (m.method === 'textDocument/publishDiagnostics') {
      this.diags.set(m.params.uri, { version: m.params.version ?? null, items: m.params.diagnostics ?? [], at: Date.now() });
      const ws = this.diagWaiters;
      this.diagWaiters = [];
      for (const w of ws) w();
    }
  }
  send(msg) {
    if (this.dead) return;
    const body = Buffer.from(JSON.stringify(msg), 'utf8');
    try { this.proc.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])); } catch { /* died says it */ }
  }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
  request(method, params, ms = REQUEST_MS) {
    if (this.dead) return Promise.reject(new Error(`the language server ${this.dead}`));
    this.touch();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`the language server did not answer ${method} within ${Math.round(ms / 1000)} s`)); }, ms);
      this.waiting.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }
  // The file as it is on disk now, opened (or changed) in the server. → { uri, text }
  sync(abs) {
    const uri = uriOf(abs);
    const text = readFileSync(abs, 'utf8');
    const had = this.open.get(uri);
    if (!had) {
      this.open.set(uri, { version: 1, text });
      this.notify('textDocument/didOpen', { textDocument: { uri, languageId: LANG_ID[extname(abs).toLowerCase()] ?? 'plaintext', version: 1, text } });
    } else if (had.text !== text) {
      const version = had.version + 1;
      this.open.set(uri, { version, text });
      this.diags.delete(uri);
      this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
    }
    return { uri, text, version: this.open.get(uri).version };
  }
  // The diagnostics of a file at its version now: waits for the server to send them, then a moment more
  // for a second set (the TypeScript server sends what it finds as it goes).
  async diagnostics(abs, ms = DIAG_MS) {
    const { uri, version } = this.sync(abs);
    // A server that is asked for them (TypeScript 7) sends none by itself.
    if (this.caps?.diagnosticProvider) {
      const r = await this.request('textDocument/diagnostic', { textDocument: { uri } }, ms);
      return r?.items ?? [];
    }
    const fresh = () => { const d = this.diags.get(uri); return d && (d.version === null || d.version >= version) ? d : null; };
    const until = Date.now() + ms;
    while (!fresh() && !this.dead && Date.now() < until) await new Promise((r) => { const t = setTimeout(r, Math.max(50, until - Date.now())); this.diagWaiters.push(() => { clearTimeout(t); r(); }); });
    if (!fresh()) return null;
    for (;;) { const at = fresh().at; await new Promise((r) => setTimeout(r, 600)); if (fresh()?.at === at) break; }
    return fresh()?.items ?? [];
  }
  // JavaScript and TypeScript without a tsconfig.json or jsconfig.json: the server knows only the files
  // opened in it, so a question about uses would miss the rest. The project's files that hold the word
  // are opened first, up to PROJECT_FILES looked at (the folders of packages and builds left out): all
  // of them took 24 s on this app's own 3,000 files, these a fraction of it.
  openMentioning(word, exts) {
    if (!word || ['tsconfig.json', 'jsconfig.json'].some((f) => existsSync(join(this.root, f)))) return;
    for (const abs of projectFiles(this.root, exts)) {
      if (this.open.has(uriOf(abs))) { try { this.sync(abs); } catch { /* gone */ } continue; }
      try { if (readFileSync(abs, 'utf8').includes(word)) this.sync(abs); } catch { /* unreadable: left out */ }
    }
  }
  stop() {
    clearTimeout(this.idle);
    if (this.dead) return;
    const p = this.proc;
    this.request('shutdown', null, 2000).then(() => this.notify('exit', null)).catch(() => {}).finally(() => setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 500).unref?.());
    this.died('was stopped');
  }
}

export const PROJECT_FILES = 3000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.cache', 'vendor', '.venv', 'venv', '__pycache__', 'target']);
export function projectFiles(root, exts, max = PROJECT_FILES) {
  const out = [];
  const walk = (d, depth) => {
    if (out.length >= max || depth > 12) return;
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= max) return;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(join(d, e.name), depth + 1); }
      else if (e.isFile() && exts.includes(extname(e.name).toLowerCase())) out.push(join(d, e.name));
    }
  };
  walk(root, 0);
  return out;
}

// ---- the warm servers ----
const live = new Map(); // `${server}:${root}` → LspClient
let exitHooked = false;
export function stopAll() { for (const c of live.values()) { try { c.proc.kill('SIGKILL'); } catch {} c.died('was stopped'); } live.clear(); }
// A warm server for this file, if one is already running (an edit's check never starts one).
export function warmFor(abs, root) {
  const s = serverFor(abs);
  const c = s && live.get(`${s.id}:${root}`);
  return c && !c.dead && c.caps ? c : null;
}
// The server for a file in a project: started once, then shared. → { client } or { error }.
export async function clientFor(abs, root) {
  const s = serverFor(abs);
  if (!s) return { error: `No language server knows ${extname(abs) || 'files without an ending'} files. The LSP tool covers ${SERVERS.map((x) => x.name).join('; ')}.` };
  const key = `${s.id}:${root}`;
  let c = live.get(key);
  if (!c || c.dead) {
    const cmd = s.cmd(root);
    if (!cmd) return { error: `No ${s.name} language server is on this Mac. It is installed with: ${s.install}. Ask the user before you run it (it downloads a package).`, missing: s.id };
    if (!exitHooked) { exitHooked = true; process.on('exit', stopAll); }
    c = new LspClient({ ...cmd, root, id: s.id });
    live.set(key, c);
  }
  try { await c.ready; } catch (e) { live.delete(key); return { error: `The ${s.name} language server could not start: ${e.message}.` }; }
  return { client: c, server: s };
}

// ---- the LSP tool ----
const OPS = ['definition', 'references', 'hover', 'symbols', 'find', 'implementation', 'diagnostics', 'callers', 'callees'];
export const LSP_OPS = OPS;
const MAX_LOCS = 60;
const SYMBOL_KIND = ['', 'file', 'module', 'namespace', 'package', 'class', 'method', 'property', 'field', 'constructor', 'enum', 'interface', 'function', 'variable', 'constant', 'string', 'number', 'boolean', 'array', 'object', 'key', 'null', 'enum member', 'struct', 'event', 'operator', 'type parameter'];
const SEVERITY = ['', 'error', 'warning', 'info', 'hint'];

// Where on the line: the name's first place on it (a whole word), else character (from 1), else the first letter.
export function positionOf(text, line, name, character) {
  const lines = text.split('\n');
  if (!Number.isInteger(line) || line < 1 || line > lines.length) return { error: `line must be a line of the file, 1 to ${lines.length}` };
  const l = lines[line - 1];
  if (name) {
    const re = new RegExp(`(?<![\\w$])${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`);
    const m = re.exec(l) ?? (l.includes(name) ? { index: l.indexOf(name) } : null);
    if (!m) return { error: `"${name}" is not on line ${line}, which is: ${l.trim().slice(0, 160)}` };
    return { line: line - 1, character: m.index };
  }
  if (Number.isInteger(character) && character >= 1) return { line: line - 1, character: character - 1 };
  return { line: line - 1, character: Math.max(0, l.search(/\S/)) };
}

// The word under a position, when no name was given (line and character from 1).
function wordAt(text, line, character) {
  const l = text.split('\n')[line - 1] ?? '';
  const at = Number.isInteger(character) && character >= 1 ? character - 1 : Math.max(0, l.search(/\S/));
  const m = [...l.matchAll(/[\w$]+/g)].find((x) => x.index <= at && at < x.index + x[0].length);
  return m?.[0] ?? '';
}
const relOf = (cwd, abs) => { const r = relative(cwd, abs); return r.startsWith('..') ? abs.replace(homedir(), '~') : r; };
const lineText = (abs, n, cache) => {
  if (!cache.has(abs)) { try { cache.set(abs, readFileSync(abs, 'utf8').split('\n')); } catch { cache.set(abs, []); } }
  return (cache.get(abs)[n] ?? '').trim().slice(0, 160);
};
const locsOf = (r) => (r == null ? [] : Array.isArray(r) ? r : [r]).map((l) => ({ uri: l.uri ?? l.targetUri, range: l.range ?? l.targetSelectionRange ?? l.targetRange })).filter((l) => l.uri && l.range);
function locLines(cwd, locs) {
  const cache = new Map();
  const shown = locs.slice(0, MAX_LOCS).map((l) => { const abs = pathOf(l.uri); return `${relOf(cwd, abs)}:${l.range.start.line + 1}: ${lineText(abs, l.range.start.line, cache)}`; });
  return shown.join('\n') + (locs.length > MAX_LOCS ? `\n(${locs.length - MAX_LOCS} more not shown)` : '');
}
export function diagLines(cwd, abs, items) {
  return items.map((d) => `${relOf(cwd, abs)}:${d.range.start.line + 1}:${d.range.start.character + 1} ${SEVERITY[d.severity ?? 1] ?? 'error'}${d.code != null ? ` ${d.source === 'typescript' || d.source === 'ts' ? 'TS' : ''}${d.code}` : ''}: ${String(d.message).split('\n')[0]}`);
}
function symbolLines(items, depth = 0, out = []) {
  for (const s of items ?? []) {
    const line = (s.selectionRange ?? s.range ?? s.location?.range)?.start?.line;
    out.push(`${'  '.repeat(depth)}${SYMBOL_KIND[s.kind] ?? 'symbol'} ${s.name}${line != null ? ` (line ${line + 1})` : ''}`);
    if (s.children?.length && depth < 3) symbolLines(s.children, depth + 1, out);
  }
  return out;
}
const hoverText = (h) => {
  const c = h?.contents;
  const parts = (Array.isArray(c) ? c : [c]).map((x) => (typeof x === 'string' ? x : x?.value ?? '')).filter(Boolean);
  return parts.join('\n').replace(/```\w*\n?/g, '').trim();
};

// What the LSP tool answers: { text, error? }. args: { operation, path, line, name, character, query }.
export async function lspTool(args, { cwd, signal } = {}) {
  const op = String(args.operation ?? '').trim().toLowerCase();
  if (!OPS.includes(op)) return { text: `operation must be one of: ${OPS.join(', ')}.`, error: true };
  const path = String(args.path ?? '').trim();
  if (!path) return { text: 'path is needed: the file to ask about (for find, any file of the language to search).', error: true };
  const abs = isAbsolute(path) ? path : path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(cwd, path);
  if (!existsSync(abs) || !statSync(abs).isFile()) return { text: `There is no file ${path}.`, error: true };
  const root = rootOf(abs, cwd);
  const got = await clientFor(abs, root);
  if (got.error) return { text: got.error, error: true, missing: got.missing };
  const c = got.client;
  if (signal?.aborted) return { text: 'Stopped.', error: true };
  try {
    const { uri, text } = c.sync(abs);
    if (got.server.id === 'typescript' && ['references', 'find', 'implementation', 'callers'].includes(op)) c.openMentioning(String((op === 'find' ? args.query : null) ?? args.name ?? '').trim() || wordAt(text, Number(args.line), Number(args.character)), got.server.exts);
    const rel = relOf(cwd, abs);
    if (op === 'diagnostics') {
      const items = await c.diagnostics(abs);
      if (items === null) return { text: `The ${got.server.name} server sent no diagnostics for ${rel} within ${DIAG_MS / 1000} s.`, error: true };
      const errs = items.filter((d) => (d.severity ?? 1) <= 2);
      return { text: errs.length ? `${errs.length} problem${errs.length === 1 ? '' : 's'} in ${rel}:\n${diagLines(cwd, abs, errs.slice(0, 40)).join('\n')}${errs.length > 40 ? `\n(${errs.length - 40} more)` : ''}` : `No errors or warnings in ${rel} (${got.server.name} server).` };
    }
    if (op === 'symbols') {
      const r = await c.request('textDocument/documentSymbol', { textDocument: { uri } });
      const lines = symbolLines(r);
      return { text: lines.length ? `${rel}:\n${lines.slice(0, 200).join('\n')}` : `No symbols in ${rel}.` };
    }
    if (op === 'find') {
      const q = String(args.query ?? args.name ?? '').trim();
      if (!q) return { text: 'find needs query: the name (or part of it) to look for in the whole project.', error: true };
      const r = await c.request('workspace/symbol', { query: q });
      const items = (r ?? []).filter((s) => s.location?.uri && !/\/node_modules\//.test(s.location.uri));
      if (!items.length) return { text: `No symbol like "${q}" in the project.` };
      return { text: items.slice(0, MAX_LOCS).map((s) => `${SYMBOL_KIND[s.kind] ?? 'symbol'} ${s.containerName ? `${s.containerName}.` : ''}${s.name}: ${relOf(cwd, pathOf(s.location.uri))}:${(s.location.range?.start?.line ?? 0) + 1}`).join('\n') + (items.length > MAX_LOCS ? `\n(${items.length - MAX_LOCS} more)` : '') };
    }
    const pos = positionOf(text, Number(args.line), args.name ? String(args.name) : '', Number(args.character));
    if (pos.error) return { text: `${pos.error}.`, error: true };
    const at = { textDocument: { uri }, position: { line: pos.line, character: pos.character } };
    const what = args.name ? `"${args.name}" (${rel}:${pos.line + 1})` : `${rel}:${pos.line + 1}`;
    if (op === 'hover') {
      const t = hoverText(await c.request('textDocument/hover', at));
      return { text: t ? `${what}:\n${t.slice(0, 4000)}` : `Nothing is known about ${what}: is the name right, and on that line?` };
    }
    if (op === 'definition' || op === 'implementation') {
      const locs = locsOf(await c.request(op === 'definition' ? 'textDocument/definition' : 'textDocument/implementation', at));
      return { text: locs.length ? `${op === 'definition' ? 'Defined' : 'Implemented'} at:\n${locLines(cwd, locs)}` : `No ${op} found for ${what}.` };
    }
    if (op === 'references') {
      const locs = locsOf(await c.request('textDocument/references', { ...at, context: { includeDeclaration: true } }));
      const files = new Set(locs.map((l) => l.uri)).size;
      return { text: locs.length ? `${locs.length} place${locs.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'} use ${what}:\n${locLines(cwd, locs)}` : `No uses of ${what} found.` };
    }
    // callers, callees: the call hierarchy.
    const items = await c.request('textDocument/prepareCallHierarchy', at);
    if (!items?.length) return { text: `${what} is not a function or method the server can follow.` };
    const calls = await c.request(op === 'callers' ? 'callHierarchy/incomingCalls' : 'callHierarchy/outgoingCalls', { item: items[0] });
    const ends = (calls ?? []).map((x) => x.from ?? x.to).filter(Boolean);
    if (!ends.length) return { text: op === 'callers' ? `Nothing in the project calls ${what}.` : `${what} calls nothing the server knows.` };
    const cache = new Map();
    return { text: `${op === 'callers' ? 'Called from' : 'It calls'}:\n${ends.slice(0, MAX_LOCS).map((e) => { const p = pathOf(e.uri); const ln = (e.selectionRange ?? e.range).start.line; return `${SYMBOL_KIND[e.kind] ?? 'symbol'} ${isAbsolute(e.name) ? relOf(cwd, e.name) : e.name}: ${relOf(cwd, p)}:${ln + 1}: ${lineText(p, ln, cache)}`; }).join('\n')}` };
  } catch (e) {
    return { text: `The ${got.server.name} language server: ${e.message}.`, error: true };
  }
}

// The project folder a file belongs to: the folder the app works in when the file is inside it, else
// the nearest folder above the file with a project file.
const MARKERS = ['tsconfig.json', 'jsconfig.json', 'package.json', 'pyproject.toml', 'setup.py', 'Package.swift', 'Cargo.toml', 'go.mod', 'compile_commands.json', '.git'];
export function rootOf(abs, cwd) {
  if (cwd && !relative(cwd, abs).startsWith('..') && cwd !== homedir()) return cwd;
  for (let d = dirname(abs); d !== dirname(d); d = dirname(d)) if (MARKERS.some((m) => existsSync(join(d, m)))) return d;
  return dirname(abs);
}

// After an Edit or a Write: the errors in that file now, from a server already warm for it (never one
// started for this). → text to add to the edit's answer, or ''.
export async function errorsAfterEdit(abs, cwd, { ms = 4000 } = {}) {
  const c = warmFor(abs, rootOf(abs, cwd));
  if (!c) return '';
  try {
    const items = await c.diagnostics(abs, ms);
    const errs = (items ?? []).filter((d) => (d.severity ?? 1) === 1);
    if (!errs.length) return '';
    return `\n(The language server finds ${errs.length} error${errs.length === 1 ? '' : 's'} in this file now:\n${diagLines(cwd, abs, errs.slice(0, 10)).join('\n')}${errs.length > 10 ? `\n(${errs.length - 10} more: LSP diagnostics)` : ''})`;
  } catch { return ''; }
}
