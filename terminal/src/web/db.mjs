// Agentic Coder Web's database (bun:sqlite, one file in the web home). Secrets are kept only as
// their sha256: sign-in sessions, invite and reset links, API keys. Passwords are argon2id
// (Bun.password, auth.mjs).
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { webHome } from './config.mjs';

const SCHEMA = `
create table if not exists users (id integer primary key, name text unique not null collate nocase, role text not null default 'user', pass text not null, created integer not null, seen integer);
create table if not exists sessions (hash text primary key, user integer not null references users(id) on delete cascade, created integer not null, expires integer not null);
create table if not exists invites (hash text primary key, name text not null collate nocase, role text not null, by integer, created integer not null, expires integer not null, used integer);
create table if not exists resets (hash text primary key, user integer not null references users(id) on delete cascade, created integer not null, expires integer not null, used integer);
create table if not exists keys (id integer primary key, user integer not null references users(id) on delete cascade, name text not null, hash text unique not null, tail text not null, created integer not null, used integer);
create table if not exists chats (id text primary key, user integer not null references users(id) on delete cascade, title text not null, kind text not null, model text, service integer, created integer not null, updated integer not null, allow text not null default '[]');
create table if not exists runs (id text primary key, chat text not null, user integer not null, model text, service integer, status text not null, queued integer not null, started integer, ended integer, reason text, laguna integer not null default 0);
create table if not exists usage (day text not null, user integer not null, model text not null, requests integer not null default 0, tokens_in integer not null default 0, tokens_out integer not null default 0, wait_ms integer not null default 0, busy_ms integer not null default 0, spills integer not null default 0, primary key (day, user, model));
create table if not exists model_log (id integer primary key, at integer not null, user text, what text not null, detail text);
create index if not exists runs_user on runs(user);
create index if not exists chats_user on chats(user, updated);
`;

export function openDb(file = join(webHome(), 'web.sqlite')) {
  if (file !== ':memory:') mkdirSync(webHome(), { recursive: true, mode: 0o700 });
  const db = new Database(file, { create: true, strict: true });
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 3000;');
  db.exec(SCHEMA);
  // A run left "running" or "waiting" by a server that stopped did not finish.
  db.query("update runs set status = 'stopped', reason = 'the server stopped', ended = ?1 where status in ('running', 'waiting', 'asking')").run(Date.now());
  return db;
}

export const today = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

// One model request's numbers, added to its user's day.
export function addUsage(db, { user, model, tokensIn = 0, tokensOut = 0, waitMs = 0, busyMs = 0, spilled = false, t = Date.now() }) {
  db.query(`insert into usage (day, user, model, requests, tokens_in, tokens_out, wait_ms, busy_ms, spills) values (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?8)
    on conflict (day, user, model) do update set requests = requests + 1, tokens_in = tokens_in + ?4, tokens_out = tokens_out + ?5, wait_ms = wait_ms + ?6, busy_ms = busy_ms + ?7, spills = spills + ?8`)
    .run(today(t), user, String(model), Math.round(tokensIn), Math.round(tokensOut), Math.round(waitMs), Math.round(busyMs), spilled ? 1 : 0);
}
