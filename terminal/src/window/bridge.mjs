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
import { AgentsView } from '../app/agents-view.jsx';
import { LoopsView } from '../app/loops-view.jsx';
import { viewItem, heldView, ansiRows } from './view.mjs';

const SEND_MS = 33; // at most 30 states a second; a burst of redraws is sent as the last of them

export function makeBridge(path = process.env.AGENTIC_WINDOW_SOCK) {
  if (!path) return null;
  let sock = null, open = false, timer = null, last = null, self = null, inbox = '';
  const sentItems = new Map(); // key → the JSON last sent for it
  const ansiCache = new Map();
  let sentOrder = '';
  const pendingWrites = [];
  const send = (msg) => { const line = `${JSON.stringify(msg)}\n`; if (open) sock.write(line); else pendingWrites.push(line); };
  try {
    sock = connect(path);
    sock.setEncoding('utf8');
    sock.on('connect', () => { open = true; for (const l of pendingWrites.splice(0)) sock.write(l); });
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
  function act(m) {
    if (!self || m?.t !== 'act') return;
    if (m.do === 'toggle' && m.id) self.toggleGroup?.(m.id);
    else if (m.do === 'mode' && m.mode) self.setMode?.(m.mode);
    else if (m.do === 'resume' && m.id) self.resumeSession?.(m.id);
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
    const width = Math.max(60, app.width ?? 100);
    const ctx = { model: app.modelName, cwd: app.cwdShort, loaded: app.loaded ?? '', start: app.start };
    const order = [], changed = {};
    for (const it of printed) {
      let v = viewItem(it);
      if (v?.t === 'skip') continue;
      // no view of its own: the app's drawing of it, as it would print
      if (!v) v = { t: 'ansi', key: it.key ?? it.id, rows: ansiOf(`${it.key ?? it.id}\0${it.type}\0${it.open ?? ''}`, React.createElement(ItemFrame, { it, width, ...ctx }), width) };
      const key = String(v.key ?? it.key);
      order.push(key);
      const json = JSON.stringify(v);
      if (sentItems.get(key) !== json) { sentItems.set(key, json); changed[key] = v; }
    }
    const live = app.live ?? {};
    const perm = app.perm ? {
      name: app.perm.req?.name, kind: app.perm.req?.kind, title: app.perm.req?.title, helper: app.perm.req?.helper ?? null,
      command: app.perm.req?.args?.command ?? null, path: app.perm.req?.prepared?.rel ?? null, created: Boolean(app.perm.req?.prepared?.created),
      hunk: (app.perm.req?.prepared?.hunk ?? []).slice(0, 80), rule: app.perm.req?.rule ?? null, autoReason: app.perm.req?.autoReason ?? null,
      options: (app.perm.options ?? []).map((o) => o?.label ?? String(o)), selected: app.perm.selected ?? 0, ask: Boolean(app.perm.ask),
    } : null;
    // A panel in the prompt box's place: the app's own drawing of it (the window draws a permission question itself).
    const panel = panelOpen(app) ? { kind: app.picker?.kind ?? (app.perm ? 'perm' : app.btw ? 'btw' : 'picker'), rows: ansiRows(renderToString(React.createElement(PanelArea, { app }), { columns: width })) } : null;
    // A screen that takes the whole window: /agents' tree, /loop's board.
    const full = app.agentsTree ? { kind: 'agents', rows: ansiRows(renderToString(React.createElement(AgentsView, { state: app.agentsTree, columns: app.columns, rows: app.rows, now: app.agentsNow }), { columns: app.columns })) }
      : app.loopsFrame ? { kind: 'loops', rows: ansiRows(renderToString(React.createElement(LoopsView, { frame: app.loopsFrame, columns: app.columns }), { columns: app.columns })) } : null;
    // The side bar's lists: the files this conversation changed (from its diffs, newest first) and its last to-do list.
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
    let usageText = null;
    try { usageText = app.usage ? textOf(usageChip(app.usage)) : null; } catch { usageText = null; }
    return {
      t: 'state', now: Date.now(),
      order: order.join('\n') === sentOrder ? undefined : order, items: changed,
      held: working ? heldView(held) : null,
      live: { phase: live.phase ?? 'idle', verb: live.verb ?? null, turnStart: live.turnStart ?? null, stepStart: live.stepStart ?? null, tokens: live.tokens ?? 0, tps: live.liveTps ?? null, thinking: live.thinking ? String(live.thinking).slice(-1200) : null, text: live.text ? String(live.text).slice(-6000) : null, writing: live.writing ? { path: live.writing.path ?? live.writing.rel ?? null } : null, running: live.running ? { label: live.running.label ?? null, arg: String(live.running.arg ?? '').slice(0, 300) } : null, waiting: Boolean(live.waiting) },
      input: { value: app.input?.value ?? '', cursor: app.input?.cursor ?? 0 }, placeholder: app.placeholder ?? '', inputMode: app.inputMode ?? 'prompt', argHint: app.argHint ?? null,
      menu: app.menu ? { kind: app.menu.kind, index: app.menu.index ?? 0, items: (app.menu.items ?? []).slice(0, 60).map((x) => ({ label: x.label, desc: x.desc ?? '' })) } : null,
      perm, panel, full,
      mode: app.mode, modelName: app.modelName, modelOff: Boolean(app.modelOff), starting: Boolean(app.starting), cwd: app.cwd, cwdShort: app.cwdShort,
      hold: Boolean(app.hold), start: app.hold ? { model: app.start?.model, effort: app.start?.effort, cwd: app.start?.cwd, git: app.start?.git ?? null, recent: (app.start?.recent ?? []).slice(0, 12).map((r) => ({ id: r.id, title: String(r.title ?? '').replace(/\s+/g, ' ').slice(0, 140), updated: r.updated ?? null, turns: r.turns ?? 0 })) } : null,
      queued: app.queued ?? null, notice: app.notice ?? null, tip: app.tip ?? null, usageText, files: [...files.values()].reverse(), todos, spend: app.spend ?? '', loopsBadge: app.loopsBadge ?? null,
      stats: { ctxUsed: app.stats?.ctxUsed ?? null, ctx: app.ctx ?? null },
    };
  }

  // Each redraw: the newest state, sent once the burst settles (SEND_MS), never more often.
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

export const windowBridge = makeBridge();
