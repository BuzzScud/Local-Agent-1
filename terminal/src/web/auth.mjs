// Who is asking (Agentic Coder Web, 8 Oct 2026): accounts made by an admin (an invite link), a
// sign-in cookie for the page, API keys for scripts and other apps, and the one-time tokens of the
// runs this server starts (their model requests come back through the gateway with it).
//   - Passwords: argon2id (Bun.password), at least 10 characters.
//   - The cookie's name is this copy's own (acw_<its id>): browsers keep cookies by address, not
//     by port, so two copies on one Mac (or a preview beside the real one) would sign each other out
//     with one shared name (8 Oct 2026, the owner's "the admin acct doesnt work").
//   - Sign-in: a random token in an HttpOnly, SameSite=Strict cookie (Secure behind https), kept
//     as its sha256, 30 days from the last use. 5 wrong tries a minute for one name from one
//     address, and sign-in waits a minute.
//   - A change made with the cookie must come from the page itself (Origin = this server).
//   - API keys: acw_ + 32 letters, shown once, kept as sha256; Authorization: Bearer acw_….
//   - The first account: with nobody yet, the server prints a one-time setup link (an admin invite).
import { createHash, randomBytes } from 'node:crypto';

export const cookieName = (id) => `acw_${String(id ?? 'session').replace(/[^A-Za-z0-9]/g, '')}`;
const SESSION_DAYS = 30;
const TRIES = 5;
const LOCK_MS = 60_000;
export const MIN_PASSWORD = 10;

export const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export const randomWord = (n = 32) => Array.from(randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join('');
export const validName = (name) => /^[a-z0-9][a-z0-9._-]{1,31}$/i.test(String(name ?? ''));

export const hashPassword = (p) => Bun.password.hash(String(p), { algorithm: 'argon2id' });
export const checkPassword = (p, hash) => Bun.password.verify(String(p ?? ''), String(hash ?? '')).catch(() => false);

export function cookieOf(req, name) {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')); }
  return null;
}
export const sessionCookie = (token, { name, secure = false, clear = false } = {}) => `${name}=${clear ? '' : encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=${clear ? 0 : SESSION_DAYS * 86400}`;

export class Auth {
  constructor(db, { id = null } = {}) {
    this.db = db;
    this.cookie = cookieName(id);
    this.fails = new Map(); // `${ip}|${name}` → [times]
    this.runs = new Map(); // run token → { user, run, laguna }
  }

  userCount() { return this.db.query('select count(*) as n from users').get().n; }
  userById(id) { return this.db.query('select id, name, role, created, seen from users where id = ?1').get(id) ?? null; }
  userByName(name) { return this.db.query('select id, name, role, created, seen from users where name = ?1').get(String(name)) ?? null; }
  users() { return this.db.query('select id, name, role, created, seen from users order by name').all(); }

  // ---- sign-in ----
  locked(ip, name) {
    const k = `${ip}|${String(name).toLowerCase()}`;
    const now = Date.now();
    const recent = (this.fails.get(k) ?? []).filter((t) => now - t < LOCK_MS);
    this.fails.set(k, recent);
    return recent.length >= TRIES;
  }
  async signIn(name, password, ip) {
    if (this.locked(ip, name)) return { ok: false, error: 'Too many wrong tries: sign-in waits a minute.', locked: true };
    const row = this.db.query('select id, pass from users where name = ?1').get(String(name ?? ''));
    // A name that does not exist costs the same time as a wrong password.
    this.dummy ??= hashPassword(randomWord(16));
    const good = row ? await checkPassword(password, row.pass) : (await checkPassword(password, await this.dummy), false);
    if (!good) {
      const k = `${ip}|${String(name).toLowerCase()}`;
      this.fails.set(k, [...(this.fails.get(k) ?? []), Date.now()]);
      return { ok: false, error: 'That username and password do not match.' };
    }
    this.fails.delete(`${ip}|${String(name).toLowerCase()}`);
    return { ok: true, token: this.newSession(row.id), user: this.userById(row.id) };
  }
  newSession(userId) {
    const token = randomWord(40);
    const now = Date.now();
    this.db.query('insert into sessions (hash, user, created, expires) values (?1, ?2, ?3, ?4)').run(sha(token), userId, now, now + SESSION_DAYS * 864e5);
    this.db.query('update users set seen = ?2 where id = ?1').run(userId, now);
    return token;
  }
  signOut(token) { if (token) this.db.query('delete from sessions where hash = ?1').run(sha(token)); }

  // Who a request is: { user, via: 'cookie' | 'key' | 'run', run? } or null.
  who(req) {
    const now = Date.now();
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? null;
    if (bearer?.startsWith('acr_')) {
      const r = this.runs.get(bearer);
      return r ? { user: this.userById(r.user), via: 'run', run: r } : null;
    }
    if (bearer) {
      const k = this.db.query('select id, user from keys where hash = ?1').get(sha(bearer));
      if (!k) return null;
      this.db.query('update keys set used = ?2 where id = ?1').run(k.id, now);
      const user = this.userById(k.user);
      return user ? { user, via: 'key', key: k.id } : null;
    }
    const c = cookieOf(req, this.cookie);
    if (!c) return null;
    const s = this.db.query('select user, expires from sessions where hash = ?1').get(sha(c));
    if (!s || s.expires < now) return null;
    // Sliding: a session used keeps going 30 days from its last use (written at most hourly).
    if (s.expires - now < (SESSION_DAYS * 864e5) - 3600e3) this.db.query('update sessions set expires = ?2 where hash = ?1').run(sha(c), now + SESSION_DAYS * 864e5);
    const user = this.userById(s.user);
    if (user && (!user.seen || now - user.seen > 60_000)) this.db.query('update users set seen = ?2 where id = ?1').run(user.id, now);
    return user ? { user, via: 'cookie', token: c } : null;
  }

  // ---- invites, the first account, password resets ----
  invite({ name, role = 'user', by = null, days = 7 }) {
    if (!validName(name)) return { ok: false, error: 'A name is 2–32 letters, digits, dots, dashes or underscores.' };
    if (this.userByName(name)) return { ok: false, error: `There is already a user called ${name}.` };
    const token = randomWord(32);
    const now = Date.now();
    this.db.query('delete from invites where name = ?1 and used is null').run(name);
    this.db.query('insert into invites (hash, name, role, by, created, expires) values (?1, ?2, ?3, ?4, ?5, ?6)').run(sha(token), name, role === 'admin' ? 'admin' : 'user', by, now, now + days * 864e5);
    return { ok: true, token, expires: now + days * 864e5 };
  }
  inviteInfo(token) {
    const i = this.db.query('select name, role, by, expires, used from invites where hash = ?1').get(sha(token));
    if (!i || i.used || i.expires < Date.now()) return null;
    return { name: i.name, role: i.role, by: i.by ? this.userById(i.by)?.name ?? null : null, expires: i.expires };
  }
  invites() { return this.db.query('select name, role, created, expires from invites where used is null and expires > ?1 order by created desc').all(Date.now()); }
  async acceptInvite(token, { name, password }) {
    const i = this.inviteInfo(token);
    if (!i) return { ok: false, error: 'This invite link has been used or has expired. Ask the admin for a new one.' };
    const chosen = String(name || i.name).trim();
    if (!validName(chosen)) return { ok: false, error: 'A name is 2–32 letters, digits, dots, dashes or underscores.' };
    if (String(password ?? '').length < MIN_PASSWORD) return { ok: false, error: `A password needs at least ${MIN_PASSWORD} characters.` };
    if (this.userByName(chosen)) return { ok: false, error: `The name ${chosen} is taken. Pick another.` };
    const now = Date.now();
    const id = this.db.query('insert into users (name, role, pass, created) values (?1, ?2, ?3, ?4) returning id').get(chosen, i.role, await hashPassword(password), now).id;
    this.db.query('update invites set used = ?2 where hash = ?1').run(sha(token), now);
    return { ok: true, user: this.userById(id), token: this.newSession(id) };
  }
  // With no account yet: an admin invite that does not expire for a day.
  setupLink() { return this.userCount() ? null : this.invite({ name: 'admin', role: 'admin', days: 1 }); }

  resetLink(userId, hours = 24) {
    const token = randomWord(32);
    const now = Date.now();
    this.db.query('insert into resets (hash, user, created, expires) values (?1, ?2, ?3, ?4)').run(sha(token), userId, now, now + hours * 3600e3);
    return { token, expires: now + hours * 3600e3 };
  }
  resetInfo(token) {
    const r = this.db.query('select user, expires, used from resets where hash = ?1').get(sha(token));
    return r && !r.used && r.expires > Date.now() ? { user: this.userById(r.user) } : null;
  }
  async useReset(token, password) {
    const r = this.resetInfo(token);
    if (!r?.user) return { ok: false, error: 'This link has been used or has expired. Ask the admin for a new one.' };
    if (String(password ?? '').length < MIN_PASSWORD) return { ok: false, error: `A password needs at least ${MIN_PASSWORD} characters.` };
    this.db.query('update users set pass = ?2 where id = ?1').run(r.user.id, await hashPassword(password));
    this.db.query('update resets set used = ?2 where hash = ?1').run(sha(token), Date.now());
    // Every sign-in of theirs ends; their API keys keep working.
    this.db.query('delete from sessions where user = ?1').run(r.user.id);
    return { ok: true, user: r.user, token: this.newSession(r.user.id) };
  }
  async changePassword(userId, old, next) {
    const row = this.db.query('select pass from users where id = ?1').get(userId);
    if (!row || !(await checkPassword(old, row.pass))) return { ok: false, error: 'Your current password is not right.' };
    if (String(next ?? '').length < MIN_PASSWORD) return { ok: false, error: `A password needs at least ${MIN_PASSWORD} characters.` };
    this.db.query('update users set pass = ?2 where id = ?1').run(userId, await hashPassword(next));
    return { ok: true };
  }
  setRole(userId, role) { this.db.query('update users set role = ?2 where id = ?1').run(userId, role === 'admin' ? 'admin' : 'user'); }
  admins() { return this.db.query("select count(*) as n from users where role = 'admin'").get().n; }
  deleteUser(userId) { this.db.query('delete from users where id = ?1').run(userId); }

  // ---- API keys ----
  newKey(userId, name) {
    const key = `acw_${randomWord(32)}`;
    const id = this.db.query('insert into keys (user, name, hash, tail, created) values (?1, ?2, ?3, ?4, ?5) returning id').get(userId, String(name || 'key').slice(0, 60), sha(key), key.slice(-4), Date.now()).id;
    return { id, key };
  }
  keys(userId) { return this.db.query('select id, name, tail, created, used from keys where user = ?1 order by created desc').all(userId); }
  deleteKey(userId, id) { return this.db.query('delete from keys where id = ?1 and user = ?2').run(id, userId).changes > 0; }

  // ---- the runs' own tokens (never stored: a server restart ends every run) ----
  runToken(entry) { const t = `acr_${randomWord(40)}`; this.runs.set(t, entry); return t; }
  dropRun(token) { this.runs.delete(token); }
}

// A change made with the sign-in cookie must come from this server's own page.
export function sameOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return req.method === 'GET' || req.method === 'HEAD';
  try {
    const o = new URL(origin);
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    return o.host === host;
  } catch { return false; }
}
