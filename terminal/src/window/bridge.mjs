// The app's side of the window (12 Oct 2026: Agentic Coder in its own window). When the window server runs the
// app (AGENTIC_WINDOW_SOCK names its socket), every redraw of the app's screen also goes to the window as data:
// the conversation (view.mjs), the turn under way, the prompt as typed, the open menu, a permission question, the
// mode and the model, and for a panel the window has no view of its own yet, the app's own drawing of it. Only
// what changed is sent. The window's clicks come back as actions on the app (`act`); its keys go to the pretend
// terminal as typed, so every key does what it does in the terminal.
import { connect } from 'node:net';
import React from 'react';
import { renderToString } from 'ink';
import { printedOf, ItemFrame, PanelArea, panelOpen } from '../app/screen.jsx';
import { usageChip, textOf } from '../app/usage-bar.mjs';
import { ctxWord } from '../app/remote-models.mjs';
import { pressureWord, used as macUsed } from '../app/mac-memory.mjs';
import { gib } from '../../../models/index.mjs';
import { AgentsView } from '../app/agents-view.jsx';
import { LoopsView } from '../app/loops-view.jsx';
import { knownOf } from '../app/start.jsx';
import { viewItem, heldView, ansiRows, stepView } from './view.mjs';
import { askState } from '../app/app-ask.mjs';
import { shortName, sizeLine } from '../app/attach.mjs';

// The question box as it stands (app-ask.mjs): every tab, the row you are on, the ticks, what you typed and the answers
// so far (19 Nov 2026, the owner: "i also cant select the answer correctly"). Before, the window drew the request's
// top-level choices with row 0 lit: several questions showed one "Type something…" row, and a click counted its
// arrows from row 0 instead of from the row the box was on.
export function askBoxOf(box) {
  return {
    at: box.at,
    tabs: box.tabs.map((t) => ({
      header: t.header, question: String(t.q?.question ?? ''), several: Boolean(t.q?.several), ticks: Boolean(t.ticks),
      options: t.options.map((o) => ({ label: String(o.label ?? ''), about: String(o.about ?? ''), type: o.choice === 'type', recommended: Boolean(o.recommended) })),
      selected: t.selected, ticked: [...t.ticked], typed: t.typed?.value ?? '', answer: t.answer,
    })),
  };
}

// The attachments in the prompt box (App.jsx app.tray, attach.mjs trayItems) as the window shows them over the box: a
// card each with its chip, name and size, and a picture's file, shown as itself (server.mjs /pic) (19 Nov 2026, the
// owner: "when i attach a screenshot or image, it shows in the agentic coder"). Before, the window showed "[Image #1]"
// in the box and nothing else.
export function trayOf(tray) {
  return (tray ?? []).map((it) => ({ n: it.n, token: it.token, kind: it.kind, name: shortName(it.name), size: sizeLine(it), file: it.kind === 'image' ? it.file : null }));
}

const SEND_MS = 33; // at most 30 states a second; a burst of redraws is sent as the last of them

// key: the window server's word for its own app (AGENTIC_WINDOW_KEY), said first, so the window listens to this app only.
export function makeBridge(path = process.env.AGENTIC_WINDOW_SOCK, key = process.env.AGENTIC_WINDOW_KEY) {
  if (!path) return null;
  let sock = null, open = false, timer = null, last = null, self = null, inbox = '';
  const sentItems = new Map(); // key → the JSON last sent for it
  // Each step of the timeline (view.mjs stepView), sent when it changed: an item the app did not replace is the same
  // object, so it is not made into JSON again at every redraw.
  const sentSteps = new Map(), stepJson = new WeakMap();
  const ansiCache = new Map();
  // Each printed item's view and its JSON, kept by the item (the audit of 18 Nov 2026: every send, 30 a second while a
  // reply streams, made every item of the conversation into JSON again). A view that carries the plan along (a task row:
  // view.mjs partsOf) is kept with the plan it was made after, the plan it leaves, and the steps it met, so it is used
  // again only where it would come out the same.
  const itemViews = new WeakMap(); // item → { width, planIn, planOut, raws, v, key, json }
  // The last printed list as sent: the same list (no item came; a token streamed) needs no look at its items at all.
  let lastPrinted = null;
  // The side bar's lists, worked out again only when the items change.
  let sideOf = { items: null, files: [], todos: [] };
  let sentOrder = '';
  const pendingWrites = [];
  const send = (msg) => { const line = `${JSON.stringify(msg)}\n`; if (open) sock.write(line); else pendingWrites.push(line); };
  try {
    sock = connect(path);
    sock.setEncoding('utf8');
    sock.on('connect', () => { open = true; sock.write(`${JSON.stringify({ t: 'hi', key: key ?? '' })}\n`); for (const l of pendingWrites.splice(0)) sock.write(l); });
    sock.on('data', (d) => {
      inbox += d;
      let i;
      while ((i = inbox.indexOf('\n')) >= 0) {
        const line = inbox.slice(0, i); inbox = inbox.slice(i + 1);
        try { act(JSON.parse(line)); } catch { /* a line the app cannot read */ }
      }
    });
    sock.on('error', () => { open = false; });
    sock.on('close', () => { open = false; });
  } catch { return null; }

  // The window's clicks that are not keys: a task row or one of its rows opened, the mode picked, a conversation
  // resumed. Everything else the window does goes as keys.
  // A mode chip goes as /mode does (applyChoice): its note too, Bypass's warning among them (15 Oct 2026, the window
  // audit: a chip switched to Bypass without a word). A conversation opens as /resume opens one: not while a reply is
  // under way (its messages would be swapped under it), and the start page goes (holdRef).
  function act(m) {
    if (!self || m?.t !== 'act') return;
    if (m.do === 'toggle' && m.id) self.toggleGroup?.(m.id);
    else if (m.do === 'mode' && m.mode) { if (self.applyChoice) self.applyChoice('mode', m.mode); else self.setMode?.(m.mode); }
    else if (m.do === 'resume' && m.id) {
      // the app's one gate (app-run.mjs canStartTurn: a reply, a ! command, /agents), which says why itself
      if (self.canStartTurn ? !self.canStartTurn() : self.agent?.busy) { if (!self.canStartTurn) self.flash?.('Wait for Agentic Coder to finish, or press esc first'); return; }
      if (self.holdRef) self.holdRef.current = false;
      self.resumeSession?.(m.id);
    }
  }

  const ansiOf = (key, el, width) => {
    const k = `${key}\0${width}`;
    if (!ansiCache.has(k)) {
      if (ansiCache.size > 3000) ansiCache.clear();
      ansiCache.set(k, ansiRows(renderToString(el, { columns: width })));
    }
    return ansiCache.get(k);
  };

  function state(app) {
    const working = app.live?.phase === 'working';
    const view = app.stepsView;
    const { printed, held } = printedOf(app.items ?? [], working, view);
    let pc = { plan: null, raws: new Map() }; // the reply's parts: the plan carried along, every step met
    const width = Math.max(60, app.width ?? 100);
    const ctx = { model: app.modelName, cwd: app.cwdShort, loaded: app.loaded ?? '', start: app.start };
    let order = [];
    const changed = {};
    if (lastPrinted?.printed === printed && lastPrinted.width === width) {
      // nothing printed changed since the last send: its order and parts as they were, nothing new to send
      order = lastPrinted.order;
      pc = { plan: lastPrinted.plan, raws: new Map(lastPrinted.raws) };
    } else {
      for (const it of printed) {
        let c = itemViews.get(it);
        if (c && c.width === width && c.planIn === pc.plan) {
          pc.plan = c.planOut;
          for (const [k, x] of c.raws) pc.raws.set(k, x);
        } else {
          // the steps it meets are noted as they go into pc, so they can be met again from the cache
          const met = [];
          const planIn = pc.plan;
          const own = { get plan() { return pc.plan; }, set plan(p) { pc.plan = p; }, raws: { set: (k, x) => { met.push([k, x]); pc.raws.set(k, x); } } };
          let v = viewItem(it, own);
          // no view of its own: the app's drawing of it, as it would print
          if (!v) v = { t: 'ansi', key: it.key ?? it.id, rows: ansiOf(`${it.key ?? it.id}\0${it.type}\0${it.open ?? ''}`, React.createElement(ItemFrame, { it, width, ...ctx }), width) };
          c = v.t === 'skip' ? { width, planIn, planOut: pc.plan, raws: met, v } : { width, planIn, planOut: pc.plan, raws: met, v, key: String(v.key ?? it.key), json: JSON.stringify(v) };
          if (it && typeof it === 'object') itemViews.set(it, c);
        }
        if (c.v.t === 'skip') continue;
        order.push(c.key);
        if (sentItems.get(c.key) !== c.json) { sentItems.set(c.key, c.json); changed[c.key] = c.v; }
      }
      lastPrinted = { printed, width, order, plan: pc.plan, raws: new Map(pc.raws) };
    }
    const live = app.live ?? {};
    const perm = app.perm ? {
      name: app.perm.req?.name, kind: app.perm.req?.kind, title: app.perm.req?.title, helper: app.perm.req?.helper ?? null,
      command: app.perm.req?.args?.command ?? null, path: app.perm.req?.prepared?.rel ?? null, created: Boolean(app.perm.req?.prepared?.created),
      hunk: (app.perm.req?.prepared?.hunk ?? []).slice(0, 80), rule: app.perm.req?.rule ?? null, autoReason: app.perm.req?.autoReason ?? null,
      options: (app.perm.options ?? []).map((o) => o?.label ?? String(o)), selected: app.perm.selected ?? 0, ask: Boolean(app.perm.ask),
      // What an Ask asks ("Work in …?", the model's own question): before, the window showed its choices under "Ask" alone.
      question: app.perm.req?.name === 'Ask' ? String(app.perm.req?.args?.question ?? '') || null : null,
      box: app.perm.req?.name === 'Ask' ? askBoxOf(app.perm.ask ?? askState(app.perm.req)) : null,
    } : null;
    // A panel in the prompt box's place: the app's own drawing of it (the window draws a permission question itself).
    const panel = panelOpen(app) ? { kind: app.picker?.kind ?? (app.perm ? 'perm' : app.btw ? 'btw' : 'picker'), rows: ansiRows(renderToString(React.createElement(PanelArea, { app }), { columns: width })) } : null;
    // A screen that takes the whole window: /agents' tree, /loop's board.
    const full = app.agentsTree ? { kind: 'agents', rows: ansiRows(renderToString(React.createElement(AgentsView, { state: app.agentsTree, columns: app.columns, rows: app.rows, now: app.agentsNow }), { columns: app.columns })) }
      : app.loopsFrame ? { kind: 'loops', rows: ansiRows(renderToString(React.createElement(LoopsView, { frame: app.loopsFrame, columns: app.columns }), { columns: app.columns })) } : null;
    // The side bar's lists: the files this conversation changed (from its diffs, newest first) and its last to-do list.
    if (sideOf.items !== app.items) {
      const files = new Map();
      let todos = [];
      for (const it of app.items ?? []) {
        const v = it.type === 'tool' ? it.view : null;
        if (v?.kind === 'todos') todos = (v.items ?? []).map((t) => ({ text: String(t.text ?? t.content ?? '').slice(0, 200), status: t.status }));
        if (v?.kind !== 'diff' || it.error) continue;
        const name = String(v.path ?? '').split('/').pop();
        const was = files.get(name) ?? { name, add: 0, del: 0 };
        for (const h of v.hunk ?? []) { if (h.type === '+') was.add++; else if (h.type === '-') was.del++; }
        files.delete(name); files.set(name, was);
      }
      sideOf = { items: app.items, files: [...files.values()].reverse(), todos };
    }
    const { files, todos } = sideOf;
    let usageText = null, usage = null;
    try { usageText = app.usage ? textOf(usageChip(app.usage)) : null; usage = usageOf(app.usage); } catch { usageText = null; usage = null; }
    let meter = null;
    try { meter = meterOf(app); } catch { meter = null; }
    return {
      t: 'state', now: Date.now(),
      order: order.join('\n') === sentOrder ? undefined : order, items: changed,
      held: working ? heldView(held, pc) : null,
      steps: stepsOf(pc.raws),
      live: { phase: live.phase ?? 'idle', verb: live.verb ?? null, turnStart: live.turnStart ?? null, stepStart: live.stepStart ?? null, tokens: live.tokens ?? 0, tps: live.liveTps ?? null, thinking: live.thinking ? String(live.thinking.text ?? live.thinking).slice(-1200) : null, text: live.text ? String(live.text).slice(-6000) : null, writing: live.writing ? { path: live.writing.path ?? live.writing.rel ?? null, name: live.writing.name ?? null } : null, running: live.running ? { label: live.running.label ?? null, arg: String(live.running.arg ?? '').slice(0, 300) } : null, waiting: Boolean(live.waiting),
        // for the timeline's line under way (7 · Smooth): the thought's tokens (its pieces, or its length where it came in a
        // few, as the saved thought counts them) and start, the answer's start, what the app does between replies
        thinkTokens: live.thinking ? Math.max(live.thinking.tokens ?? 0, Math.ceil(String(live.thinking.text ?? '').length / 3.6)) : null, thinkStart: live.thinking?.startedAt ?? null, textStart: live.text ? live.textAt ?? null : null, task: live.task ? String(live.task).slice(0, 200) : null,
        // a service that sends a tool call in one piece (steps-page.js 'whole'): since when it has been quiet, and the last reply's speed
        whole: Boolean(live.whole), lastTokenAt: live.lastTokenAt ?? null, wholeTps: live.wholeTps ?? null },
      input: { value: app.input?.value ?? '', cursor: app.input?.cursor ?? 0 }, tray: trayOf(app.tray), placeholder: app.placeholder ?? '', inputMode: app.inputMode ?? 'prompt', argHint: app.argHint ?? null,
      menu: app.menu ? { kind: app.menu.kind, index: app.menu.index ?? 0, items: (app.menu.items ?? []).slice(0, 60).map((x) => ({ label: x.label, desc: x.desc ?? '' })) } : null,
      perm, panel, full,
      mode: app.mode, modelName: app.modelName, modelOff: Boolean(app.modelOff), starting: Boolean(app.starting), cwd: app.cwd, cwdShort: app.cwdShort,
      model: modelNowOf(app.modelState),
      hold: Boolean(app.hold), start: app.hold ? { model: app.start?.model, effort: effortWords(knownOf(app.start).effort), cwd: app.start?.cwd, git: app.start?.git ?? null, recent: (app.start?.recent ?? []).slice(0, 12).map((r) => ({ id: r.id, title: String(r.title ?? '').replace(/\s+/g, ' ').slice(0, 140), updated: r.updated ?? null, turns: r.turns ?? 0 })) } : null,
      queued: app.queued?.length ? app.queued.join(' · ') : null, notice: app.notice ?? null, tip: app.tip ?? null, usageText, usage, meter, acct: app.acct ?? null, files, todos, spend: app.spend ?? '', loopsBadge: app.loopsBadge ?? null,
      stats: { ctxUsed: app.stats?.ctxUsed ?? null, ctx: app.ctx ?? null },
    };
  }

  // Each redraw: the newest state, sent once the burst settles (SEND_MS), never more often.
  function stepsOf(raws) {
    const out = {};
    for (const [k, x] of raws) {
      let j = stepJson.get(x);
      if (!j) { j = JSON.stringify(stepView(x)); stepJson.set(x, j); }
      if (sentSteps.get(k) !== j) { sentSteps.set(k, j); out[k] = JSON.parse(j); }
    }
    return out;
  }
  function publish(app, own) {
    self = own;
    last = app;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        const s = state(last);
        if (s.order) sentOrder = s.order.join('\n');
        send(s);
      } catch (e) { send({ t: 'error', text: String(e?.stack ?? e).slice(0, 2000) }); }
    }, SEND_MS);
  }
  return { publish, close: () => { try { sock.end(); } catch {} } };
}

// The Claude API's usage for the title bar's pill beside the model (12 Oct 2026): the footer's words ("$43.16 left",
// usageChip) and its tone, and the numbers of the /usage card (claude-usage.mjs usageNow). null off the Claude API.
export function usageOf(u) {
  if (!u) return null;
  const tone = u.capped ? 'bad' : u.low ? 'bad' : u.pace?.beforeReset ? 'warn' : null;
  const lim = (p) => (p ? { limit: p.limit, remaining: p.remaining, reset: p.reset } : null);
  return {
    text: textOf(usageChip(u)), tone, capped: Boolean(u.capped), modelName: u.modelName ?? null,
    left: u.left, cap: u.cap, spent: u.spent, own: Boolean(u.ownLimit), tier: u.tier ?? null, tierCap: u.tierCap ?? null,
    balance: u.balance ? { usd: u.balance.usd, at: u.balance.at, since: u.balance.since, days: u.balance.days, stale: u.balance.stale } : null,
    month: u.monthName, resetsOn: u.resetsOn, today: u.today?.usd ?? 0, window: u.window ?? 0, last14: u.last14 ?? [],
    perDay: u.pace?.perDay ?? 0, runsOut: u.pace?.runsOut ?? null, beforeReset: Boolean(u.pace?.beforeReset),
    source: { kind: u.source?.kind ?? 'meter', usd: u.source?.usd ?? null, at: u.source?.at ?? null, since: u.source?.since ?? 0, days: u.source?.days ?? null, stale: Boolean(u.source?.stale) },
    limits: u.limits ? { at: u.limits.at, requests: lim(u.limits.requests), input: lim(u.limits.input), output: lim(u.limits.output) } : null,
    // the account of the key in use (claude-usage.mjs): being checked (a new key), its id's end, and this month's
    // dollars from before accounts were kept, not counted
    account: u.account ? { pending: Boolean(u.account.pending), orgEnd: u.account.orgEnd ?? null, earlier: u.account.earlier ?? 0, name: u.account.name ?? '', own: Boolean(u.account.own) } : null,
    // your keys by name (app-claude-keys.mjs), for the account box left of the model: never a key, only its last four
    keys: (u.keys ?? []).map((k) => ({ n: k.n, id: k.id, name: k.name ?? '', end: k.end ?? '', orgEnd: k.orgEnd ?? null, month: k.month ?? null, inUse: Boolean(k.inUse), checking: Boolean(k.checking) })),
  };
}

// Context and memory for the same pill on a model that costs nothing (12 Oct 2026, the owner: "ensure remote models
// from another service show context and memory here / same for local models / since those are free"): how full the
// conversation's context is, and the memory: the Mac's for a model on this Mac (and what the model holds), the
// service's GPU for one on Ollama (its /api/ps, as the footer's gauge). null on the Claude API (its pill is the month's
// dollars, usageOf) and with --url.
// A model on a service has no context size of its own until it has loaded there (App.jsx: the 32k planned for
// stands in): none is said then.
export function meterOf(app) {
  const ms = app?.modelState;
  if (!ms || app.usage) return null;
  const st = app.stats ?? {};
  const unsure = ms.remote && (ms.state === 'connecting' || ms.state === 'loading');
  const ctx = unsure ? null : app.ctx ?? st.ctx ?? null, ctxUsed = st.ctxUsed ?? null;
  const sv = ms.remote && app.server?.loaded ? app.server : null;
  const m = !ms.remote && app.mac ? app.mac : null;
  return {
    remote: Boolean(ms.remote), state: ms.state ?? 'on', name: ms.name ?? app.modelName ?? null, where: ms.where ?? null,
    ctx, ctxUsed, pct: ctx && ctxUsed != null ? Math.min(100, Math.max(0, Math.round((ctxUsed / ctx) * 100))) : null, ctxWord: ctxWord(ctx),
    modelGb: ms.gb ?? null,
    mac: m ? { used: gib(macUsed(m)), total: gib(m.total), pressure: pressureWord(m) } : null,
    gpu: sv ? { size: sv.size ?? null, vram: sv.vram ?? null, pct: sv.gpuPct ?? null, until: sv.until ?? null, ms: sv.ms ?? null } : null,
    tps: st.tps ?? null, ttft: st.ttft ?? null, speeds: (st.speeds ?? []).slice(-8),
  };
}

// How the model stands, for the window's status line and the dot in its title bar (18 Oct 2026, the owner: the window
// said Ready for the ~12 s a model on the service was still loading, where the terminal's footer said so): App.jsx's
// modelState, null with --url.
export function modelNowOf(ms) {
  if (!ms) return null;
  return { remote: Boolean(ms.remote), state: ms.state ?? 'on', name: ms.name ?? null, where: ms.where ?? null, gb: ms.gb ?? null };
}

// The start page's thinking (18 Oct 2026, the owner: "it should say thinking on"): a model with steps says its effort
// ("high effort"); one that only thinks or not says so ("thinking on"; "no thinking" for one that cannot). The level's
// label, lower case (models/registry.mjs thinkingLevel, models/runtime/remote.mjs remoteLevels); null while not known
// (start.jsx knownOf: a model on a service that has not answered yet).
export function effortWords(level) {
  if (!level) return null;
  if (level === 'on' || level === 'off') return `thinking ${level}`;
  if (level === 'none') return 'no thinking';
  return `${level} effort`;
}

export const windowBridge = makeBridge();
// The socket is this app's alone (14 Oct 2026, a screen recording of the window flashing): read once above, it is
// taken out of the env, so what the app starts (its commands, the tests it runs, a coding typed in Bash) never
// connects too. Each copy that did was a new connection, and the window (server.mjs) took it for the app started
// again: it dropped the conversation, showed the raw terminal for a moment, then took that copy's drawing.
// Its key goes too; a copy that still has the socket (one started before this fix) is not heard without it.
// Bun.spawn with no env of its own still hands a child what was taken out here: start an app copy with { env }.
delete process.env.AGENTIC_WINDOW_SOCK;
delete process.env.AGENTIC_WINDOW_KEY;
