// Looking into databases (the owner's pick, 20 Nov 2026): the Database tool lists a database's tables,
// shows a table's columns, and runs one query, read only, with the rows it brings back capped. For
// "why is this data wrong", "how many users signed up today", or checking what a change wrote.
//
// Read only is held by the database itself, not by reading the query:
//   SQLite (a .db, .sqlite or .sqlite3 file)  opened read only (bun:sqlite), so a write fails there
//   PostgreSQL (postgres://… or postgresql://) each query in a READ ONLY transaction that is rolled
//                                              back, with a time limit (Bun.SQL; nothing to install)
// A connection address can hold a password: it is never shown back, and the rule the user is asked
// about names only the host and the database (permissions.mjs).
// bun:sqlite is loaded only when a SQLite file is opened: models/evals spawn node on scripts that
// import terminal/index.mjs, and a top-level bun: import is ERR_UNSUPPORTED_ESM_URL_SCHEME there.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

export const DATABASE_ACTIONS = ['tables', 'schema', 'query'];
export const ROWS_DEFAULT = 50;
export const ROWS_MAX = 500;
const CELL_MAX = 200;
const QUERY_MS = 15_000;
export const DB_EXTS = ['.db', '.sqlite', '.sqlite3', '.db3'];

// What the database argument names. → { kind: 'sqlite', abs, said } | { kind: 'postgres', url, said } | { error }
export function databaseOf(given, cwd) {
  const t = String(given ?? '').trim();
  if (!t) return { error: 'database is needed: a SQLite file in the project (data/app.db) or a PostgreSQL address (postgres://user@host/name).' };
  if (/^postgres(?:ql)?:\/\//i.test(t)) {
    let u;
    try { u = new URL(t); } catch { return { error: 'That PostgreSQL address could not be read.' }; }
    return { kind: 'postgres', url: t, said: `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname || '/'}` };
  }
  if (/^[a-z][\w+.-]*:\/\//i.test(t)) return { error: `Only SQLite files and PostgreSQL addresses can be opened (not ${t.split(':')[0]}).` };
  const abs = isAbsolute(t) ? t : t.startsWith('~/') ? join(homedir(), t.slice(2)) : resolve(cwd, t);
  if (!existsSync(abs) || !statSync(abs).isFile()) return { error: `There is no file ${t}.` };
  const rel = relative(cwd, abs);
  return { kind: 'sqlite', abs, said: rel.startsWith('..') ? abs.replace(homedir(), '~') : rel };
}
// Databases in a folder and the one below it (the tool is offered where there is one).
export function hasDatabase(cwd) {
  const look = (d) => { try { return readdirSync(d, { withFileTypes: true }); } catch { return []; } };
  for (const e of look(cwd)) {
    if (e.isFile() && DB_EXTS.includes(extname(e.name).toLowerCase())) return true;
    if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && look(join(cwd, e.name)).some((f) => f.isFile() && DB_EXTS.includes(extname(f.name).toLowerCase()))) return true;
  }
  return false;
}

const cell = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Uint8Array) return `<${v.length} bytes>`;
  if (v instanceof Date) return v.toISOString();
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  const one = s.replace(/\s*\n\s*/g, ' ⏎ ');
  return one.length > CELL_MAX ? `${one.slice(0, CELL_MAX)}…` : one;
};
// Rows as a plain table: a header line, then one line a row, cells split by " | ".
export function rowsText(rows, { more = false, limit } = {}) {
  if (!rows.length) return '(no rows)';
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(' | '), ...rows.map((r) => cols.map((c) => cell(r[c])).join(' | '))];
  return `${lines.join('\n')}\n(${rows.length} row${rows.length === 1 ? '' : 's'}${more ? `; there are more: only the first ${limit} are shown. Narrow the query, or pass limit up to ${ROWS_MAX}` : ''})`;
}
const limitOf = (v) => Math.min(ROWS_MAX, Math.max(1, Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : ROWS_DEFAULT));

// ---- SQLite ----
function sqlite(db, args) {
  const action = args.action;
  if (action === 'tables') {
    const rows = db.query("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    if (!rows.length) return { text: 'The database has no tables.' };
    const counted = rows.map((r) => {
      let n = '?';
      try { n = db.query(`SELECT COUNT(*) AS n FROM "${r.name.replace(/"/g, '""')}"`).get().n.toLocaleString('en-US'); } catch { /* a view that fails */ }
      return `${r.type} ${r.name} (${n} rows)`;
    });
    return { text: counted.join('\n') };
  }
  if (action === 'schema') {
    const table = String(args.table ?? '').trim();
    if (!table) {
      const all = db.query("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name").all();
      return { text: all.map((r) => `${r.sql};`).join('\n\n') || 'The database has no tables.' };
    }
    const def = db.query("SELECT sql FROM sqlite_master WHERE name = ?").get(table);
    if (!def) return { text: `There is no table ${table}. Use action tables to list them.`, error: true };
    const idx = db.query("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(table);
    return { text: [def.sql + ';', ...idx.map((r) => `${r.sql};`)].join('\n') };
  }
  const sql = String(args.sql ?? '').trim();
  if (!sql) return { text: 'sql is needed: the query to run (read only).', error: true };
  const limit = limitOf(args.limit);
  const stmt = db.query(sql);
  const rows = [];
  let more = false;
  for (const r of stmt.iterate()) { if (rows.length >= limit) { more = true; break; } rows.push(r); }
  stmt.finalize?.();
  return { text: rowsText(rows, { more, limit }) };
}

// One statement, and a read (28 Nov 2026, the tools audit). Bun.SQL's unsafe() with no parameters sends the text as one simple
// query, which runs every statement in it: "commit; drop table t" ended the read-only transaction and dropped the table (tried on a
// scratch PostgreSQL 16: the table was gone). A ; outside quotes, $$ strings and comments is refused, a trailing one aside, and the
// first word must be a read. → { sql } (the text to run, its trailing ; gone) or { error }. A doubt is a refusal: a $ right after a
// name's letter is not a $$ string (PostgreSQL reads it as part of the name), and an E'…\'' string is read as ending sooner than
// PostgreSQL does, which can only find a ; that is not there.
export const READ_FIRST = /^(?:select|with|explain|show|values|table)\b/i;
export function oneStatement(sql) {
  const s = String(sql ?? '');
  let bare = '';
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (s.startsWith('--', i)) { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; bare += ' '; continue; }
    if (s.startsWith('/*', i)) {
      let depth = 1;
      let j = i + 2;
      while (j < s.length && depth) { if (s.startsWith('/*', j)) { depth++; j += 2; } else if (s.startsWith('*/', j)) { depth--; j += 2; } else j++; }
      if (depth) return { error: 'The SQL has a /* comment with no end.' };
      i = j; bare += ' '; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      for (;;) {
        const k = s.indexOf(c, j);
        if (k < 0) return { error: `The SQL has a ${c} with no end.` };
        if (s[k + 1] === c) { j = k + 2; continue; }
        j = k + 1;
        break;
      }
      bare += `${c}${c}`; i = j; continue;
    }
    if (c === '$' && !/[\w$]/.test(s[i - 1] ?? '')) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i))?.[0];
      if (tag) {
        const k = s.indexOf(tag, i + tag.length);
        if (k < 0) return { error: 'The SQL has a $$ string with no end.' };
        bare += "''"; i = k + tag.length; continue;
      }
    }
    bare += c; i++;
  }
  const body = bare.replace(/[\s;]+$/, '');
  if (body.includes(';')) return { error: 'One statement at a time: the SQL has a ; between two of them. The Database tool only reads, one query a call.' };
  if (!READ_FIRST.test(body.trim())) return { error: 'Only a read runs here: a SELECT (or WITH, EXPLAIN, SHOW, VALUES, TABLE). A change to the data goes through the project\'s own code or a command the user allows.' };
  return { sql: s.replace(/[\s;]+$/, '') };
}

// ---- PostgreSQL ----
async function postgres(url, args) {
  const sql = new Bun.SQL(url, { max: 1, idleTimeout: 5, connectionTimeout: 10 });
  const ro = (q, params = []) => sql.begin('read only', async (tx) => {
    await tx.unsafe(`SET LOCAL statement_timeout = ${QUERY_MS}`);
    const rows = await tx.unsafe(q, params);
    throw Object.assign(new Error('rollback'), { rows }); // never committed, even read only
  }).catch((e) => { if (e.rows) return e.rows; throw e; });
  try {
    if (args.action === 'tables') {
      const rows = await ro("SELECT table_schema AS schema, table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1, 2");
      return { text: rows.length ? rows.map((r) => `${r.type === 'VIEW' ? 'view' : 'table'} ${r.schema === 'public' ? '' : `${r.schema}.`}${r.name}`).join('\n') : 'The database has no tables.' };
    }
    if (args.action === 'schema') {
      const table = String(args.table ?? '').trim();
      if (!table) return { text: 'table is needed for schema on PostgreSQL: one of the names tables lists.', error: true };
      const [schema, name] = table.includes('.') ? table.split('.', 2) : ['public', table];
      const cols = await ro('SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position', [schema, name]);
      if (!cols.length) return { text: `There is no table ${table}. Use action tables to list them.`, error: true };
      const idx = await ro('SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2', [schema, name]);
      return { text: [`${table}:`, ...cols.map((c) => `  ${c.column_name} ${c.data_type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}${c.column_default ? ` DEFAULT ${c.column_default}` : ''}`), ...idx.map((i) => i.indexdef)].join('\n') };
    }
    if (!String(args.sql ?? '').trim()) return { text: 'sql is needed: the query to run (read only).', error: true };
    const one = oneStatement(String(args.sql).trim());
    if (one.error) return { text: one.error, error: true };
    const q = one.sql;
    const limit = limitOf(args.limit);
    // Cap in the database: a SELECT * of a big table must not come back whole, then be sliced here.
    const capped = /^(with|select)\b/i.test(q) ? `SELECT * FROM (\n${q}\n) AS _agentic_q LIMIT ${limit + 1}` : q;
    const rows = [...(await ro(capped))];
    return { text: rowsText(rows.slice(0, limit), { more: rows.length > limit, limit }) };
  } finally {
    await sql.close().catch(() => {});
  }
}

// What the Database tool answers: { text, error? }. args: { action, database, table, sql, limit }.
export async function databaseTool(args, { cwd = process.cwd() } = {}) {
  const action = String(args.action ?? '').trim().toLowerCase();
  if (!DATABASE_ACTIONS.includes(action)) return { text: `action must be one of: ${DATABASE_ACTIONS.join(', ')}.`, error: true };
  const db = databaseOf(args.database ?? args.path ?? args.url, cwd);
  if (db.error) return { text: db.error, error: true };
  try {
    if (db.kind === 'postgres') return await postgres(db.url, { ...args, action });
    const { Database } = await import('bun:sqlite');
    let handle;
    try { handle = new Database(db.abs, { readonly: true }); } catch (e) { return { text: `${db.said} could not be opened as a SQLite database: ${e.message}.`, error: true }; }
    try { return sqlite(handle, { ...args, action }); } finally { handle.close(); }
  } catch (e) {
    const msg = String(e.message ?? e).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '(the address)');
    const ro = /read.?only|readonly/i.test(msg) ? ' The Database tool only reads: a change to the data goes through the project\'s own code or a command the user allows.' : '';
    return { text: `${db.said}: ${msg}.${ro}`, error: true };
  }
}
