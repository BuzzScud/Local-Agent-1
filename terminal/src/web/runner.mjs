// Chats and runs (Agentic Coder Web). A chat is a list of events in a file of its own; each message
// on the Mac copy is an Agentic Coder run (`coding -p --loop-events`, started as /loop starts its
// runs: app/loops.mjs startRun) in the user's own folder, with:
//   - its own Agentic Coder home (memory, settings, trust) under the user's folder, never the owner's;
//   - its model requests sent to this server's gateway with a one-time token (AGENTIC_REMOTE_KEY);
//   - the calculator through this server's /mcp/run/<token>, allowed without asking;
//   - Accept edits (edits in the folder go through, every command asks in the browser), the folder
//     fence on, no Screen tool, no web reading unless the admin turns it on, a clean environment;
//   - the conversation carried on from the chat's last run (its transcript).
// A message whose reading would not fit the default model asks first whether to switch that run to
// Laguna q8 (the owner's rule: Laguna only after a yes). Runs wait in the fair line (queue.mjs).
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { startRun } from '../app/loops.mjs';
import { userDir } from './config.mjs';
import { isLastResort, roleOf } from './models.mjs';
import { chat as plainChat, tokensOf } from './chat.mjs';

const RESERVE = 20_000; // tokens left for the instructions, tools and the answer
const DEFAULT_ROOM = 100_000;
const TEXT_EXT = new Set(['', '.md', '.txt', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php', '.html', '.css', '.scss', '.vue', '.svelte', '.sql', '.sh', '.yml', '.yaml', '.toml', '.ini', '.csv', '.tsv', '.xml', '.swift', '.m', '.lua', '.r', '.jl', '.ex', '.exs', '.erl', '.hs', '.scala', '.dart']);
// Words that ask for the whole folder at once ("read the whole project", "every file").
const WHOLE = /\b(whole|entire|every|all (of )?the|all) (project|repo|repository|codebase|folder|monorepo|files?|code)\b|\bmonorepo\b|\bevery file\b/i;
export const newId = (p) => `${p}_${randomBytes(9).toString('base64url')}`;
// The command that runs Agentic Coder itself: the installed app is its own program; from the repo,
// Bun with cli.jsx (whatever started this server: coding web, the container's main.mjs, a test).
export const agenticCommand = () => (import.meta.dir.startsWith('/$bunfs') ? [process.execPath] : [process.execPath, join(import.meta.dir, '..', 'cli.jsx')]);

const clip = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''));

export class Runner {
  // runExtra: { env, home } added to every run's environment and home settings (the tests' switches).
  constructor({ db, auth, gateway, settings, queue, port, mcpUrl, calc, runExtra = {} }) {
    Object.assign(this, { db, auth, gateway, settings, queue, port, mcpUrl, calc, runExtra });
    this.subs = new Map(); // chat id → Set(fn)
    this.live = new Map(); // chat id → { run, child, token, asks: Map, timers, kind }
    this.seq = new Map(); // chat id → last event number
  }

  // ---- folders ----
  dirs(userId) {
    const root = userDir(userId);
    const d = { root, work: join(root, 'work'), home: join(root, 'home'), chats: join(root, 'chats') };
    for (const p of [d.work, d.home, d.chats]) mkdirSync(p, { recursive: true, mode: 0o700 });
    return d;
  }

  // ---- chats ----
  chatsOf(userId) { return this.db.query('select id, title, kind, model, service, created, updated from chats where user = ?1 order by updated desc limit 200').all(userId).map((c) => ({ ...c, live: this.live.has(c.id) ? this.stateOf(c.id) : null })); }
  chat(id) { return this.db.query('select * from chats where id = ?1').get(id) ?? null; }
  createChat(user, { title, kind, model, service }) {
    const id = newId('c');
    const now = Date.now();
    this.db.query('insert into chats (id, user, title, kind, model, service, created, updated) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)').run(id, user.id, clip(title || 'New chat', 80), kind, model ?? null, service ?? null, now, now);
    return this.chat(id);
  }
  deleteChat(chat) {
    this.stop(chat, { quiet: true });
    const d = this.dirs(chat.user);
    for (const ext of ['.jsonl', '.transcript.json']) rmSync(join(d.chats, `${chat.id}${ext}`), { force: true });
    this.db.query('delete from chats where id = ?1').run(chat.id);
  }
  eventsFile(chat) { return join(this.dirs(chat.user).chats, `${chat.id}.jsonl`); }
  events(chat, after = 0) {
    let lines = [];
    try { lines = readFileSync(this.eventsFile(chat), 'utf8').split('\n').filter(Boolean); } catch { return []; }
    const out = [];
    for (const l of lines) { try { const e = JSON.parse(l); if (e.n > after) out.push(e); } catch { /* a cut line */ } }
    return out;
  }
  lastN(chat) {
    if (!this.seq.has(chat.id)) { const all = this.events(chat); this.seq.set(chat.id, all.at(-1)?.n ?? 0); }
    return this.seq.get(chat.id);
  }
  append(chat, ev) {
    const n = this.lastN(chat) + 1;
    this.seq.set(chat.id, n);
    const e = { n, at: Date.now(), ...ev };
    appendFileSync(this.eventsFile(chat), `${JSON.stringify(e)}\n`, { mode: 0o600 });
    this.db.query('update chats set updated = ?2 where id = ?1').run(chat.id, e.at);
    for (const fn of this.subs.get(chat.id) ?? []) { try { fn(e); } catch { /* a page that went away */ } }
    return e;
  }
  subscribe(chatId, fn) {
    if (!this.subs.has(chatId)) this.subs.set(chatId, new Set());
    this.subs.get(chatId).add(fn);
    return () => { this.subs.get(chatId)?.delete(fn); if (!this.subs.get(chatId)?.size) this.subs.delete(chatId); };
  }
  stateOf(chatId) {
    const l = this.live.get(chatId);
    if (!l) return null;
    return { run: l.run, state: l.state, place: l.state === 'waiting' ? this.queue.place(l.run) : 0, asking: [...l.asks.keys()], model: l.model, laguna: l.laguna };
  }

  // ---- how big a message's reading is ----
  folderTokens(work) {
    let chars = 0;
    const walk = (dir, depth) => {
      if (depth > 12) return;
      for (const name of readdirSync(dir)) {
        if (name === '.git' || name === 'node_modules' || name === '.agentic') continue;
        const p = join(dir, name);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) walk(p, depth + 1);
        else if (TEXT_EXT.has(extname(name).toLowerCase()) && st.size < 2_000_000) chars += st.size;
      }
    };
    try { walk(realpathSync(work), 0); } catch { /* empty */ }
    return Math.ceil(chars / 3.6);
  }
  // How much the tasks default holds as loaded (less what the instructions and answer need).
  async room() {
    const t = roleOf(this.settings(), 'tasks');
    const st = t ? await this.gateway.serviceFor(t.model, t.service) : null;
    const ctx = st?.loaded.get(t.model)?.ctx;
    return ctx ? Math.max(8000, ctx - RESERVE) : DEFAULT_ROOM;
  }
  async lagunaModel() {
    const r = roleOf(this.settings(), 'lastResort');
    const st = r ? await this.gateway.serviceFor(r.model, r.service) : null;
    return st ? { model: r.model, service: st.id } : null;
  }

  // ---- a message ----
  // user: who sends it; text; model/service: their pick (the chat's last one when left out).
  async send(user, chat, { text, model, service, laguna = false }) {
    const s = this.settings();
    text = String(text ?? '').trim();
    if (!text) return { ok: false, error: 'Type a message.' };
    const live = this.live.get(chat.id);
    // A message while a run works: a note it reads with its next step (as /loop's notes are).
    if (live?.state === 'running' && live.child) { live.child.send({ t: 'note', text }); this.append(chat, { t: 'user', text, note: true }); return { ok: true, note: true }; }
    if (live) return { ok: false, error: 'This chat is waiting for its turn or for your answer. Stop it first, or answer it.' };
    // The model: the one picked, else the chat's last one, else the admin's default for this kind of chat.
    // A chat's last model that is switched off or gone gives way to the default, with a note.
    const def = roleOf(s, chat.kind === 'agent' ? 'tasks' : 'chat');
    const picked = Boolean(model);
    let fellBack = null;
    if (!picked && chat.model) {
      const was = await this.gateway.serviceFor(chat.model, chat.service);
      if (was && !this.gateway.refusal({ user }, was.id, chat.model)) { model = chat.model; service ??= was.id; } else fellBack = chat.model;
    }
    if (!model) { model = def.model; service ??= def.service; }
    model = String(model);
    const st = await this.gateway.serviceFor(model, service ?? chat.service);
    if (!st) return { ok: false, error: `${model} is not on your AI services right now.` };
    const why = this.gateway.refusal({ user }, st.id, model);
    if (why) return { ok: false, error: why };

    this.db.query('update chats set model = ?2, service = ?3, title = case when title = \'New chat\' then ?4 else title end where id = ?1').run(chat.id, model, st.id, clip(text.replace(/\s+/g, ' '), 60));
    this.append(chat, { t: 'user', text, model, service: st.id, by: user.name });
    if (fellBack && fellBack !== model) this.append(chat, { t: 'note', text: `${fellBack} is no longer available here, so this chat goes on with ${model}.` });
    const run = newId('r');
    this.live.set(chat.id, { run, state: 'checking', asks: new Map(), timers: [], model, service: st.id, laguna: false, kind: chat.kind, user });
    // Too big for the default model: ask before Laguna (never by itself).
    try { if (!isLastResort(s, model, st.id)) {
      const room = await this.room();
      const d = this.dirs(chat.user);
      const need = tokensOf(text) + (chat.kind === 'agent' && WHOLE.test(text) ? this.folderTokens(d.work) : 0);
      const lag = need > room ? await this.lagunaModel() : null;
      if (lag) {
        const ask = { id: `switch-${run}`, kind: 'switch', tokens: need, room, to: lag.model };
        this.live.get(chat.id).asks.set(ask.id, { switch: true, lag, then: (choice) => this.afterSwitch(user, chat, { text, model, st, run, lag, choice }) });
        this.live.get(chat.id).state = 'asking';
        this.append(chat, { t: 'ask', ...ask, name: 'Switch', text: `Reading this needs about ${need.toLocaleString('en-US')} tokens; ${model} holds about ${room.toLocaleString('en-US')} as loaded. ${lag.model} holds it all, but it is several times slower and everyone else waits while it works.` });
        this.askTimer(chat, ask.id);
        return { ok: true, asking: ask.id };
      }
    } } catch (e) { this.live.delete(chat.id); return { ok: false, error: `Could not start: ${e.message}` }; }
    return this.enqueue(user, chat, { text, model, st, run, laguna: isLastResort(s, model, st.id) });
  }

  afterSwitch(user, chat, { text, model, st, run, lag, choice }) {
    if (choice === 'laguna') return this.enqueue(user, chat, { text, model: lag.model, st: { id: lag.service }, run, laguna: true });
    if (choice === 'parts') return this.enqueue(user, chat, { text: `${text}\n\n(The folder is bigger than you can hold at once: read it a part at a time, keep short notes as you go, and answer from the notes.)`, model, st, run, laguna: false });
    this.end(chat, { reason: 'stopped', final: 'Stopped before it started: nothing was read.' });
  }

  enqueue(user, chat, { text, model, st, run, laguna }) {
    const live = this.live.get(chat.id);
    Object.assign(live, { state: 'waiting', model, service: st.id, laguna, text });
    const now = Date.now();
    this.db.query('insert into runs (id, chat, user, model, service, status, queued, laguna) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)').run(run, chat.id, chat.user, model, st.id, 'waiting', now, laguna ? 1 : 0);
    const place = this.queue.add({ id: run, user: chat.user, start: () => this.start(user, chat, run) });
    if (place > 0) this.append(chat, { t: 'run', run, state: 'waiting', place });
    return { ok: true, run, place };
  }

  // ---- a run ----
  start(user, chat, run) {
    const live = this.live.get(chat.id);
    // Stopped while it waited: its place goes to the next.
    if (!live || live.run !== run) { setTimeout(() => this.queue.done(run), 0); return; }
    const s = this.settings();
    live.state = 'running';
    this.db.query("update runs set status = 'running', started = ?2 where id = ?1").run(live.run, Date.now());
    this.append(chat, { t: 'run', run: live.run, state: 'running', model: live.model, laguna: live.laguna });
    if (chat.kind === 'chat') return this.startChat(user, chat, live);
    const d = this.dirs(chat.user);
    const token = this.auth.runToken({ user: chat.user, run: live.run, service: live.service, laguna: live.laguna, token: null, note: (text) => this.append(chat, { t: 'note', text, by: 'gateway' }) });
    this.auth.runs.get(token).token = token;
    live.token = token;
    this.prepareHome(d, { model: live.model, token });
    const transcript = join(d.chats, `${chat.id}.transcript.json`);
    const allow = JSON.parse(this.chat(chat.id)?.allow ?? '[]');
    const child = startRun({ folder: d.work, prompt: live.text, mode: 'edits', allow, resume: existsSync(transcript) ? transcript : null }, { self: agenticCommand(), env: this.runEnv(d, token, transcript) });
    live.child = child;
    child.on((ev) => this.onRunEvent(chat, ev));
    live.timers.push(setTimeout(() => { this.append(chat, { t: 'note', text: `The run reached its ${s.limits.runMins}-minute limit and was stopped.` }); child.kill({ wait: true }); }, s.limits.runMins * 60_000));
  }

  // The user's own Agentic Coder home for a run: the gateway as its Ollama service, the calculator
  // allowed, their folder trusted, no web reading unless the admin allows it.
  prepareHome(d, { model, token }) {
    const s = this.settings();
    const work = realpathSync(d.work);
    let saved = {};
    try { saved = JSON.parse(readFileSync(join(d.home, 'settings.json'), 'utf8')); } catch { /* new */ }
    const remote = { source: 'openai', kind: 'openai', address: `http://127.0.0.1:${this.port()}`, port: null, connect: 'http', model, context: 0, key: true, keyEnd: token.slice(-4), keyId: 'openai', use: true };
    const helper = roleOf(s, 'helper');
    const settings = { ...saved, ...(this.runExtra.home ?? {}), remote, remotes: { openai: remote }, webHelper: helper && helper.model !== model ? helper : null, memoryToRemote: 'mine', web: { search: 'off', fetch: Boolean(s.runs?.webFetch), claude: false, keys: {} }, subagents: true, lastMode: 'edits' };
    writeFileSync(join(d.home, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(join(d.home, 'trust.json'), `${JSON.stringify({ [work]: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(join(d.home, 'permissions.json'), `${JSON.stringify({ everywhere: { allow: ['Mcp(calculator:calculate)', 'Mcp(calculator:calculator_functions)', 'Mcp(calculator:formulas)'], never: [], protect: [] } }, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(join(d.home, 'mcp.json'), `${JSON.stringify({ servers: { calculator: { url: this.mcpUrl(token), auth: 'none' } } }, null, 2)}\n`, { mode: 0o600 });
  }

  // What a run's process gets: no more of this server's environment than a shell needs.
  runEnv(d, token, transcript) {
    const keep = ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'TZ', '__CF_USER_TEXT_ENCODING', 'BUN_INSTALL', 'AGENTIC_REPO'];
    const env = { HOME: process.env.HOME ?? homedir() };
    for (const k of keep) if (process.env[k] != null) env[k] = process.env[k];
    return {
      ...env,
      AGENTIC_HOME: d.home, AGENTIC_REMOTE_KEY: token, AGENTIC_TRANSCRIPT: transcript,
      AGENTIC_UNLOAD: 'off', AGENTIC_TRYOUT: 'off', AGENTIC_SESSIONS: 'off', AGENTIC_NO_OPEN: '1', AGENTIC_NEWS: 'off',
      AGENTIC_SCREEN: 'off', AGENTIC_USER_HOOKS: 'off', AGENTIC_STUDIO: 'off', AGENTIC_WEB_RUN: '1',
      ...(this.runExtra.env ?? {}),
    };
  }

  onRunEvent(chat, ev) {
    const live = this.live.get(chat.id);
    if (!live) return;
    if (ev.t === 'ask') {
      live.asks.set(ev.id, { sig: ev.sig ?? null });
      this.append(chat, { t: 'ask', id: ev.id, name: ev.name, kind: ev.kind ?? null, text: ev.text, options: ev.options ?? null, always: ev.always ?? null, sig: ev.sig ?? null });
      this.askTimer(chat, ev.id);
      return;
    }
    if (ev.t === 'end') return this.end(chat, ev);
    if (['tool', 'note', 'text', 'heard'].includes(ev.t)) this.append(chat, ev);
  }

  askTimer(chat, id) {
    const live = this.live.get(chat.id);
    const mins = this.settings().limits.askMins;
    const t = setTimeout(() => {
      if (!this.live.get(chat.id)?.asks.has(id)) return;
      this.append(chat, { t: 'note', text: `Nobody answered for ${mins} minutes, so the run stopped.` });
      this.stop(chat, { quiet: true, reason: 'unanswered' });
    }, mins * 60_000);
    live?.timers.push(t);
  }

  // An answer from the page: yes · always · no (+ text for a question of the model's own), or for the
  // Laguna switch: laguna · parts · stop.
  answer(user, chat, { id, choice, text }) {
    const live = this.live.get(chat.id);
    const key = live?.asks.has(id) ? id : live?.asks.has(Number(id)) ? Number(id) : null;
    const a = key == null ? null : live.asks.get(key);
    if (!a) return { ok: false, error: 'That question is no longer waiting.' };
    if (a.switch) {
      if (!['laguna', 'parts', 'stop'].includes(choice)) return { ok: false, error: 'Answer laguna, parts or stop.' };
      live.asks.delete(key);
      this.append(chat, { t: 'answered', id, choice, by: user.name });
      a.then(choice);
      return { ok: true };
    }
    if (!['yes', 'always', 'no'].includes(choice)) return { ok: false, error: 'Answer yes, always or no.' };
    live.asks.delete(key);
    if (choice === 'always' && a.sig) {
      const allow = new Set(JSON.parse(this.chat(chat.id)?.allow ?? '[]'));
      allow.add(a.sig);
      this.db.query('update chats set allow = ?2 where id = ?1').run(chat.id, JSON.stringify([...allow]));
    }
    live.child?.send({ t: 'answer', id: key, choice, ...(text ? { text: String(text) } : {}) });
    this.append(chat, { t: 'answered', id, choice, text: text ? clip(text, 2000) : undefined, by: user.name });
    return { ok: true };
  }

  stop(chat, { quiet = false, reason = 'stopped' } = {}) {
    const live = this.live.get(chat.id);
    if (!live) return { ok: false, error: 'Nothing is running in this chat.' };
    if (live.child) { live.child.kill({ wait: true }); live.stopping = reason; if (!quiet) this.append(chat, { t: 'note', text: 'Stopping…' }); return { ok: true }; }
    if (live.abort) { live.abort.abort(); return { ok: true }; }
    this.end(chat, { reason, final: reason === 'unanswered' ? '' : 'Stopped before it started.' });
    return { ok: true };
  }

  end(chat, ev) {
    const live = this.live.get(chat.id);
    if (!live) return;
    for (const t of live.timers) clearTimeout(t);
    if (live.token) this.auth.dropRun(live.token);
    this.live.delete(chat.id);
    const reason = live.stopping ?? ev.reason ?? 'done';
    this.db.query('update runs set status = ?2, ended = ?3, reason = ?4 where id = ?1').run(live.run, reason === 'done' ? 'done' : 'stopped', Date.now(), String(reason));
    this.append(chat, { t: 'end', run: live.run, reason, final: ev.final ?? '', secs: ev.secs ?? null, steps: ev.steps ?? null, files: ev.files ?? [], tests: ev.tests ?? null, model: live.model, laguna: live.laguna });
    this.queue.done(live.run);
  }

  // ---- a plain chat (the AI-server copy; and a chat-kind conversation anywhere) ----
  async startChat(user, chat, live) {
    const history = [];
    for (const e of this.events(chat)) {
      if (e.t === 'user' && !e.note) history.push({ role: 'user', content: e.text });
      if (e.t === 'end' && e.final) history.push({ role: 'assistant', content: e.final });
    }
    live.abort = new AbortController();
    let text = '';
    const r = await plainChat({
      gateway: this.gateway, who: { user, via: 'cookie', run: { laguna: live.laguna, service: live.service } }, model: live.model, messages: history, calc: this.calc, signal: live.abort.signal,
      say: (ev) => {
        if (ev.t === 'text') { text += ev.delta; this.liveText(chat, text); }
        else if (ev.t === 'tool' && ev.out) this.append(chat, { t: 'tool', label: `calculator · ${ev.name}`, arg: ev.args?.expression ?? JSON.stringify(ev.args ?? {}), error: ev.out.ok === false, result: ev.out.ok === false ? ev.out.error : ev.out.value ?? null });
        else if (ev.t === 'note') this.append(chat, { t: 'note', text: ev.text });
        else if (ev.t === 'status') this.status(chat, ev.text);
      },
    });
    this.end(chat, { reason: r.ok ? 'done' : r.stopped ? 'stopped' : 'error', final: r.ok ? r.text : r.stopped ? r.text : `${r.text ? `${r.text}\n\n` : ''}${r.error}` });
  }
  // Words as they come and the waiting line are sent to the page but not kept (the end keeps the answer).
  liveText(chat, text) { for (const fn of this.subs.get(chat.id) ?? []) { try { fn({ n: 0, t: 'partial', text }); } catch {} } }
  status(chat, text) { for (const fn of this.subs.get(chat.id) ?? []) { try { fn({ n: 0, t: 'status', text }); } catch {} } }

  // Everything running or waiting (the admin's Queue).
  board() {
    const out = [];
    for (const [chatId, l] of this.live) out.push({ chat: chatId, run: l.run, user: l.user?.name, model: l.model, state: l.state, place: l.state === 'waiting' ? this.queue.place(l.run) : 0, laguna: l.laguna, title: this.chat(chatId)?.title });
    return out;
  }
}
