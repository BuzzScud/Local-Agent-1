// Bonsai Code's terminal app: starts the model, runs the agent, and turns
// its events into the screen; handles the prompt box, permission prompts,
// slash commands, layouts, sessions and keys.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, useInput, usePaste, useWindowSize } from 'ink';
import { homedir } from 'node:os';
import { existsSync, statSync, readFileSync, statfsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Screen, permissionOptions } from './screen.jsx';
import { MIN_COLS, MIN_ROWS } from './window.mjs';
import { Agent } from '../agent/agent.mjs';
import { systemPrompt, projectNotes, gitSummary, SESSION_MARK } from '../agent/prompt.mjs';
import { commandPrefix } from '../agent/permissions.mjs';
import { resolvePath, toolSchemas } from '../agent/tools.mjs';
import { warmUp, MODELS, DEFAULT_MODEL, modelPath, SERVER_BIN, thinkingLevel, ModelServer, chooseContext, availableBytes, needBytes, runningServer, LINGER_SECS } from '../../../models/index.mjs';
import { readFile } from '../tools/read.mjs';
import { runCommand } from '../tools/run.mjs';
import { walk } from '../tools/fs.mjs';
import { editInput, insertText, cursorLine, mentionAt } from './edit-input.mjs';
import { COMMANDS, matchCommands } from './commands.mjs';
import { loadSettings, saveSettings, saveSession, listSessions, loadSession, newSessionId, loadHistory, addHistory } from './store.mjs';

const VERBS = ['Pruning', 'Shaping', 'Wiring', 'Grafting', 'Rooting', 'Branching', 'Watering', 'Potting', 'Trimming', 'Budding'];
const PLACEHOLDERS = ['Try "explain what this project does"', 'Try "add a test for …"', 'Try "fix the failing tests"', 'Try "find where … is set"'];
const MODES = ['ask', 'edits', 'plan'];
const IDLE = { phase: 'idle' };
const INIT_PROMPT = 'Look through this project and write an AGENTS.md at its root for a coding assistant: what the project is, how to run it and its tests, the main folders and files, and conventions you notice in the code. Keep it under 60 lines. If an AGENTS.md already exists, improve it instead.';
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
let seq = 0;

const home = homedir();
const short = (p) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);

// "@path" in a prompt attaches that file for the model.
function expandMentions(value, cwd, maxChars) {
  const attached = [];
  let extra = '';
  for (const m of value.matchAll(/(^|\s)@([^\s]+)/g)) {
    const p = resolvePath(cwd, m[2]);
    if (!p.inside || !existsSync(p.abs) || statSync(p.abs).isDirectory()) continue;
    const r = readFile(p.abs, { limit: 400 });
    if (r.text.includes('\u0000')) continue;
    attached.push({ path: p.rel, lines: r.lineCount });
    extra += `\n\n<file path="${p.rel}">\n${r.numbered.slice(0, maxChars)}\n</file>`;
  }
  return { text: value + extra, attached };
}

export function App({ opts, win }) {
  const { exit } = useApp();
  const inkSize = useWindowSize();
  // With the resize-aware window (the terminal app), the size changes only
  // when a resize has settled, together with the redraw.
  const [winSize, setWinSize] = useState(() => (win ? { columns: win.columns, rows: win.rows } : null));
  const { columns, rows } = winSize ?? inkSize;
  const width = Math.max(MIN_COLS, columns ?? 100);
  const tooSmall = (columns ?? 100) < MIN_COLS || (rows ?? 40) < MIN_ROWS;
  // Bumped on every resize: the conversation is printed again at the new size.
  const [redraw, setRedraw] = useState(0);
  useEffect(() => {
    if (!win) return;
    const on = (size) => { setWinSize(size); setRedraw((n) => n + 1); };
    win.on('redraw', on);
    return () => win.off('redraw', on);
  }, [win]);
  // The text a menu was closed for with esc (typing again opens it).
  const [menuClosedFor, setMenuClosedFor] = useState(null);
  // Where Bonsai works; it can move into a project named from the home folder.
  const [cwd, setCwd] = useState(opts.cwd);
  const model = MODELS[opts.modelId ?? DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL];
  const settings = useRef(loadSettings()).current;
  const memoryNote = useRef(null);

  const [items, setItems] = useState(() => [{ key: 'welcome', type: 'welcome' }]);
  const [live, setLive] = useState(IDLE);
  const [perm, setPerm] = useState(null);
  const [picker, setPicker] = useState(null);
  const [input, setInput] = useState({ value: '', cursor: 0 });
  const [menuIndex, setMenuIndex] = useState(0);
  const [mode, setModeState] = useState(opts.mode ?? 'ask');
  const [layout, setLayout] = useState(opts.layout ?? settings.layout ?? 'classic');
  const [thinking, setThinkingState] = useState(opts.thinking ?? settings.thinking ?? model.thinkingDefault ?? true);
  const [effort, setEffortState] = useState(opts.effort ?? settings.effort ?? model.thinkingEffort);
  const [startPhase, setStartPhase] = useState('loading');
  const [stats, setStats] = useState({});
  const [ctx, setCtx] = useState(opts.ctx ?? 32768);
  const [starting, setStarting] = useState(!opts.url);
  const [startedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState(null);
  const [queued, setQueued] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [placeholder, setPlaceholder] = useState(pick(PLACEHOLDERS));
  const [ramGb, setRamGb] = useState(null);

  const push = useCallback((...its) => setItems((xs) => [...xs, ...its.map((it) => ({ key: `i${++seq}`, ...it }))]), []);
  const serverRef = useRef(null);
  const restartRef = useRef(null);
  const abortRef = useRef(null);
  const historyRef = useRef(loadHistory(cwd));
  const histIdx = useRef(null);
  const draftRef = useRef('');
  const pendingContext = useRef([]);
  const lastFold = useRef(null);
  const exitArmed = useRef(0);
  const escArmed = useRef(0);
  const sessionRef = useRef({ id: newSessionId(), title: null, items: [] });
  const filesRef = useRef(null);
  const queuedRef = useRef(null);
  const answerRef = useRef(null); // resolves Bonsai's question with what you type next

  // The agent lives for the whole session.
  const agentRef = useRef(null);
  if (!agentRef.current) {
    const notes = projectNotes(cwd);
    agentRef.current = new Agent({
      url: opts.url ?? 'http://127.0.0.1:0', model, cwd,
      system: systemPrompt({ cwd, notes: notes.text, git: gitSummary(cwd) }),
      thinking, effort, ctx, mode, flows: opts.flows !== false,
      ask: (req) => new Promise((resolve) => {
        const prefix = req.name === 'Bash' ? commandPrefix(req.args.command) : null;
        setPerm({ req, selected: 0, options: permissionOptions(req, prefix), resolve });
      }),
      waitForServer: async () => { if (restartRef.current) await restartRef.current; else if (serverRef.current) await serverRef.current.restart(); },
    });
  }
  const agent = agentRef.current;

  // Everything the key handler needs, always current.
  const S = useRef({});
  S.current = { input, perm, picker, menuIndex, mode, layout, starting, live, queued, tooSmall };

  const flash = useCallback((text, ms = 2000) => { setNotice(text); setTimeout(() => setNotice((n) => (n === text ? null : n)), ms); }, []);

  const setMode = useCallback((m) => { agent.mode = m; setModeState(m); }, [agent]);
  const setThinking = useCallback((on, eff) => {
    agent.thinking = on;
    setThinkingState(on);
    if (eff) { agent.effort = eff; setEffortState(eff); }
    saveSettings(eff ? { thinking: on, effort: eff } : { thinking: on });
  }, [agent]);
  const toggleLayout = useCallback((to) => {
    setLayout((cur) => {
      const next = to ?? (cur === 'classic' ? 'live' : 'classic');
      saveSettings({ layout: next });
      flash(`Layout: ${next === 'live' ? 'Live thinking' : 'Classic'}`);
      return next;
    });
  }, [flash]);

  // Clock for spinners and timers, only while something is moving.
  useEffect(() => {
    if (!(starting || live.phase === 'working')) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [starting, live.phase]);

  // Memory the model really uses (for the Live thinking meter line).
  useEffect(() => {
    const read = () => { const s = serverRef.current; if (s?.child) setRamGb((s.footprintBytes() + model.bytes) / 1e9); };
    const id = setInterval(read, 5000);
    const first = setTimeout(read, 1500);
    return () => { clearInterval(id); clearTimeout(first); };
  }, [model]);

  const saveNow = useCallback(() => {
    const s = sessionRef.current;
    if (!s.title) return;
    try { saveSession(cwd, s.id, { title: s.title, messages: agent.messages, items: s.items.slice(-300), mode: agent.mode }); } catch {}
  }, [agent, cwd]);

  // Keep a copy of what was shown, for /resume.
  useEffect(() => { sessionRef.current.items = items.filter((it) => it.type !== 'welcome'); }, [items]);

  const sendPrompt = useCallback((value, shown = value) => {
    const { text, attached } = expandMentions(value, cwd, agent.maxResultChars);
    push({ type: 'user', text: shown, attached });
    let content = text;
    if (pendingContext.current.length) { content = `${pendingContext.current.join('\n\n')}\n\n${content}`; pendingContext.current = []; }
    if (agent.mode === 'plan') content += '\n\n[Plan mode is on: only read and search. Do not change files or run commands that change anything. Reply with a short numbered plan, then stop.]';
    if (!sessionRef.current.title) sessionRef.current.title = shown.slice(0, 80);
    const ac = new AbortController();
    abortRef.current = ac;
    setPlaceholder(pick(PLACEHOLDERS));
    agent.send(content, { signal: ac.signal });
  }, [agent, cwd, push]);

  // Agent events → screen.
  useEffect(() => {
    const on = (name, fn) => { agent.on(name, fn); return () => agent.off(name, fn); };
    const stream = (l, patch) => {
      const t = Date.now();
      const first = l.firstTokenAt ?? t;
      const n = (l.streamTokens ?? 0) + 1;
      const secs = (t - first) / 1000;
      return { ...l, ...patch, waiting: false, tokens: (l.tokens ?? 0) + 1, firstTokenAt: first, streamTokens: n, liveTps: secs > 0.7 ? n / secs : l.liveTps };
    };
    const offs = [
      on('turn-start', () => setLive({ phase: 'working', turnStart: Date.now(), verb: pick(VERBS), tokens: 0, waiting: true })),
      on('waiting', () => setLive((l) => ({ ...l, waiting: true, thinking: null, text: null, writing: null, firstTokenAt: null, streamTokens: 0 }))),
      on('reasoning', ({ all }) => setLive((l) => stream(l, { thinking: { text: all, startedAt: l.thinking?.startedAt ?? Date.now(), tokens: (l.thinking?.tokens ?? 0) + 1 } }))),
      on('text', ({ all }) => setLive((l) => stream(l, { text: all }))),
      on('tool-writing', ({ name, args, tokens }) => setLive((l) => stream(l, { writing: { name, args, tokens } }))),
      on('assistant', ({ text, reasoning, thinkSecs }) => {
        const add = [];
        if (reasoning?.trim()) {
          add.push({ type: 'thinking', text: reasoning.trim(), secs: thinkSecs || 0.1, tokens: Math.ceil(reasoning.length / 3.6) });
          lastFold.current = { title: `Thinking (${Math.round(thinkSecs)}s)`, text: reasoning.trim() };
        }
        if (text?.trim()) add.push({ type: 'text', text: text.trim() });
        if (add.length) push(...add);
        setLive((l) => ({ ...l, thinking: null, text: null, writing: null }));
      }),
      on('tool-running', ({ label, arg }) => setLive((l) => ({ ...l, running: { label, arg }, writing: null }))),
      on('tool', (ev) => {
        push({ type: 'tool', label: ev.label, arg: ev.arg, view: ev.view, error: ev.error });
        const v = ev.view ?? {};
        if (v.content) lastFold.current = { title: `${ev.label}(${ev.arg})`, text: v.content };
        if (v.kind === 'bash') lastFold.current = { title: `Bash(${ev.arg})`, text: v.lines.join('\n') };
        setLive((l) => ({ ...l, running: null, writing: null }));
      }),
      on('note', ({ text, tone }) => push({ type: 'note', text, tone })),
      on('cwd', ({ cwd: dir }) => setCwd(dir)),
      // Focused paths: the live try counter, its finished line, the current step.
      on('tries', (t) => setLive((l) => ({ ...l, tries: t, waiting: false }))),
      on('tries-done', (t) => { push({ type: 'tries', ...t }); setLive((l) => ({ ...l, tries: null })); }),
      on('flow-step', (st) => setLive((l) => ({ ...l, flowStep: st }))),
      on('stats', (st) => setStats(st)),
      on('mode', (m) => setModeState(m)),
      on('compacted', ({ summary }) => { push({ type: 'note', text: 'Conversation summarized to free memory.', tone: 'dim' }); lastFold.current = { title: 'Summary', text: summary }; }),
      on('turn-end', ({ reason }) => {
        setLive(IDLE);
        setPerm(null);
        answerRef.current = null;
        if (reason === 'interrupted') { push({ type: 'note', text: 'Interrupted · tell Bonsai what to do instead', tone: 'warn' }); setPlaceholder('Tell Bonsai what to do instead'); }
        if (reason === 'declined') setPlaceholder('Tell Bonsai what to do instead');
        saveNow();
        const q = queuedRef.current;
        if (q) { queuedRef.current = null; setQueued(null); setTimeout(() => sendPrompt(q), 50); }
      }),
    ];
    return () => offs.forEach((f) => f());
  }, [agent, push, saveNow, sendPrompt]);

  // Start the model server (unless one was given with --url).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (opts.url) { setStarting(false); return; }
      let size = opts.ctx;
      // A model still loaded from an earlier start (or another window) is used
      // as it is; otherwise the memory size is chosen from what is free now.
      const running = runningServer(model);
      if (!size && running) size = running.ctx;
      if (!size) {
        const c = chooseContext(model);
        size = c.ctx;
        memoryNote.current = c.reason ?? null; // shown by /stats, not on the start screen
      }
      agent.ctx = size;
      setCtx(size);
      const srv = new ModelServer(model);
      serverRef.current = srv;
      srv.on('crash', ({ code, signal }) => {
        if (srv.restarts >= 3) { push({ type: 'note', text: `The model server keeps stopping (code ${code ?? signal}). See ~/.bonsai-code/logs/server.log, then restart Bonsai Code.`, tone: 'error' }); return; }
        push({ type: 'note', text: `The model server stopped (code ${code ?? signal}); restarting it.`, tone: 'warn' });
        restartRef.current = srv.restart().then(() => { push({ type: 'note', text: 'The model server is back.', tone: 'dim' }); }).catch((e) => push({ type: 'note', text: e.message, tone: 'error' })).finally(() => { restartRef.current = null; });
      });
      let st;
      try {
        st = await srv.start({ ctx: size, lingerSecs: LINGER_SECS });
        if (st.shared) {
          agent.ctx = st.ctx;
          setCtx(st.ctx);
          if (!st.idle) push({ type: 'note', text: `Sharing the model with another Bonsai Code window (port ${st.port}); replies wait their turn.`, tone: 'dim' });
        }
      } catch (e) {
        if (alive) { setStarting(false); push({ type: 'note', text: `Could not start the model: ${e.message}`, tone: 'error' }); }
        return;
      }
      agent.url = srv.url;
      if (st.slots > 1) agent.slots = { main: 0, side: 1 };
      // Read the instructions and tools before the first message (restored from
      // disk after the first time), so the first reply starts fast. A server
      // shared with another window is already warm.
      if (alive) setStartPhase('reading');
      // A model kept loaded from an earlier start is ours now: warm it for
      // this folder too (instant when nothing changed). Another window's is left alone.
      if (!st.shared || st.idle) try {
        await warmUp({ sessionMark: SESSION_MARK, url: srv.url, model, system: agent.messages[0].content, tools: toolSchemas(), thinking: agent.thinking, effort: agent.effort, slot: agent.slots?.main, onPhase: (p) => { if (alive) setStartPhase(p); } });
      } catch {}
      if (!alive) return;
      setStarting(false);
      const q = queuedRef.current;
      if (q) { queuedRef.current = null; setQueued(null); sendPrompt(q); }
    })();
    return () => { alive = false; serverRef.current?.stop({ keep: true }); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Continue or resume a saved session given on the command line.
  useEffect(() => {
    const id = opts.resumeId ?? (opts.continueLast ? listSessions(cwd)[0]?.id : null);
    if (id) resumeSession(id);
    else if (opts.continueLast) push({ type: 'note', text: 'No earlier conversation in this folder yet.', tone: 'dim' });
    if (opts.prompt) { if (starting) { queuedRef.current = opts.prompt; setQueued(opts.prompt); } else sendPrompt(opts.prompt); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function resumeSession(id) {
    try {
      const s = loadSession(cwd, id);
      agent.messages = s.messages;
      agent.messages[0] = { role: 'system', content: agent.messages[0].content };
      sessionRef.current = { id: s.id, title: s.title, items: s.items ?? [] };
      push({ type: 'divider', text: `resumed: ${s.title}` }, ...(s.items ?? []).map(({ key, ...rest }) => rest));
      if (s.mode) setMode(s.mode);
    } catch (e) { push({ type: 'note', text: `Could not open that conversation: ${e.message}`, tone: 'error' }); }
  }

  const quit = useCallback(async () => {
    abortRef.current?.abort();
    saveNow();
    await serverRef.current?.stop();
    exit();
  }, [exit, saveNow]);

  const interrupt = useCallback(() => {
    abortRef.current?.abort();
    const p = S.current.perm;
    if (p) { p.resolve({ choice: 'no' }); setPerm(null); }
    if (answerRef.current) { answerRef.current({ choice: 'no' }); answerRef.current = null; }
  }, []);

  const runShell = useCallback(async (command) => {
    if (!command) return;
    setLive({ phase: 'working', turnStart: Date.now(), verb: 'Running', tokens: 0, running: { label: 'Bash', arg: command } });
    const r = await runCommand(command, { cwd, maxLines: 200, sandbox: false }); // you typed it: no fence
    setLive(IDLE);
    push({ type: 'bash', command, lines: r.lines, code: r.code });
    lastFold.current = { title: `! ${command}`, text: r.lines.join('\n') };
    pendingContext.current.push(`[The user ran \`${command}\` in the terminal (exit ${r.code}). Output:\n${r.lines.slice(-60).join('\n')}]`);
  }, [cwd, push]);

  const doctor = useCallback(() => {
    const ok = (b) => (b ? '✓' : '✗');
    const ver = spawnSync(SERVER_BIN, ['--version'], { encoding: 'utf8' });
    const file = modelPath(model);
    const size = existsSync(file) ? statSync(file).size : 0;
    const avail = availableBytes();
    let disk = null;
    try { const f = statfsSync(home); disk = (f.bavail * f.bsize) / 1e9; } catch {}
    push({
      type: 'panel', title: 'Doctor', pad: 22, rows: [
        [`${ok(ver.status === 0)} model server`, ver.status === 0 ? `${(ver.stderr + ver.stdout).match(/build \d+/)?.[0] ?? 'ok'} · ${short(SERVER_BIN)}` : `missing at ${short(SERVER_BIN)}`],
        [`${ok(size === model.bytes)} model file`, size ? `${(size / 1e9).toFixed(2)} GB · ${short(file)}` : `missing: download ${model.url}`],
        [`${ok(!!agent.url && !starting)} server running`, serverRef.current?.port ? `port ${serverRef.current.port}, context ${Math.round(agent.ctx / 1024)}k` : opts.url ? opts.url : 'not running'],
        [`${ok(avail > needBytes(model, 16384))} free memory`, `${(avail / 1e9).toFixed(1)} GB (32k needs ${(needBytes(model, 32768) / 1e9).toFixed(1)} GB, 16k ${(needBytes(model, 16384) / 1e9).toFixed(1)} GB)`],
        [`${ok(disk === null || disk > 2)} disk space`, disk === null ? 'unknown' : `${disk.toFixed(1)} GB free`],
        [`${ok(true)} terminal`, `${process.env.TERM_PROGRAM ?? 'unknown'} · ${process.env.COLORTERM === 'truecolor' ? 'true colour' : '256 colours'} · ${columns}×${rows}`],
      ],
    });
  }, [agent, columns, rows, model, opts.url, push, starting]);

  const runSlash = useCallback(async (line) => {
    const [cmd, ...rest] = line.slice(1).trim().split(/\s+/);
    const arg = rest.join(' ').trim();
    const busy = agent.busy;
    switch (cmd) {
      case 'help':
        push({ type: 'panel', title: 'Commands', pad: 12, rows: [...COMMANDS.map((c) => [`/${c.name}`, c.desc]), ['Keys: shift+tab mode · ctrl+l layout · ctrl+o expand · esc stop · ctrl+c twice quit · \\+enter new line · @ file · ! shell']] });
        break;
      case 'clear':
        if (busy) { flash('Wait for Bonsai to finish, or press esc first'); break; }
        agent.reset();
        sessionRef.current = { id: newSessionId(), title: null, items: [] };
        push({ type: 'divider', text: 'new conversation' });
        break;
      case 'compact':
        if (busy) { flash('Wait for Bonsai to finish, or press esc first'); break; }
        setLive({ phase: 'working', turnStart: Date.now(), verb: 'Compacting', tokens: 0 });
        try { await agent.compact(undefined, { instructions: arg || undefined }); } catch (e) { push({ type: 'note', text: e.message, tone: 'error' }); }
        setLive(IDLE);
        break;
      case 'layout':
        toggleLayout(arg.startsWith('l') ? 'live' : arg.startsWith('c') ? 'classic' : undefined);
        break;
      case 'effort':
      case 'think': { // /think is the old name, still accepted
        // /effort, /effort on|off, or a level: /effort medium|high
        const a = arg.toLowerCase();
        const lvIds = (model.thinkingLevels ?? []).map((l) => l.id);
        const on = lvIds.includes(a) ? a !== 'off' : a ? /^(on|yes|true|1)$/i.test(a) : !agent.thinking;
        const eff = on && lvIds.includes(a) ? a : undefined;
        setThinking(on, eff);
        const lv = thinkingLevel(model, on, eff ?? agent.effort);
        push({ type: 'note', text: on ? `Effort is ${lv.label.toLowerCase()}: it ${lv.note ?? 'thinks before each step'}.` : 'Effort is off: it answers straight away (fastest).', tone: 'dim' });
        break;
      }
      case 'mode': {
        const m = MODES.includes(arg) ? arg : MODES[(MODES.indexOf(agent.mode) + 1) % MODES.length];
        setMode(m);
        break;
      }
      case 'init':
        if (busy) { flash('Wait for Bonsai to finish first'); break; }
        sendPrompt(INIT_PROMPT, '/init');
        break;
      case 'resume': {
        const list = listSessions(cwd);
        if (!list.length) { push({ type: 'note', text: 'No earlier conversations in this folder.', tone: 'dim' }); break; }
        setPicker({ title: 'Resume a conversation', index: 0, items: list.map((s) => ({ key: s.id, label: s.title, desc: `${new Date(s.updated).toLocaleString()} · ${s.turns} prompt${s.turns === 1 ? '' : 's'}` })) });
        break;
      }
      case 'model': {
        // The model list and the thinking level in one picker.
        const levels = model.thinkingLevels ?? [];
        const lvNow = thinkingLevel(model, agent.thinking, agent.effort);
        const models = Object.values(MODELS);
        setPicker({ kind: 'model', models, index: Math.max(0, models.findIndex((m) => m.id === model.id)), level: Math.max(0, levels.findIndex((l) => l.id === lvNow.id)) });
        break;
      }
      case 'stats':
        push({ type: 'panel', title: 'Stats', pad: 20, rows: [
          ['context used', `${(stats.ctxUsed ?? agent.ctxUsed).toLocaleString()} of ${agent.ctx.toLocaleString()} tokens`],
          ['writing speed', stats.tps ? `${stats.tps.toFixed(1)} tokens/s (last reply)` : '—'],
          ['reading speed', stats.pps ? `${Math.round(stats.pps)} tokens/s (last long read)` : '—'],
          ['written so far', `${(stats.outTokens ?? 0).toLocaleString()} tokens in ${stats.requests ?? 0} replies`],
          ['memory', `${ramGb ? `${ramGb.toFixed(1)} GB` : '—'}${memoryNote.current ? ` · ${memoryNote.current}` : ''}`],
          ['kept loaded', `${LINGER_SECS / 60} min after the last window quits · bonsai stop frees it now`],
          ['server', serverRef.current?.port ? `port ${serverRef.current.port} · restarts ${serverRef.current.restarts}` : opts.url ?? '—'],
        ] });
        break;
      case 'doctor':
        doctor();
        break;
      case 'exit':
      case 'quit':
        await quit();
        break;
      default:
        push({ type: 'note', text: `Unknown command /${cmd}. Type /help for the list.`, tone: 'warn' });
    }
  }, [agent, cwd, doctor, flash, opts.url, push, quit, ramGb, sendPrompt, setMode, setThinking, stats, toggleLayout]);

  const submit = useCallback((raw) => {
    const value = raw.replace(/\s+$/, '');
    setInput({ value: '', cursor: 0 });
    setShowShortcuts(false);
    histIdx.current = null;
    if (!value.trim()) return;
    if (answerRef.current) {
      // The answer to Bonsai's question, shown like a message of yours.
      const resolve = answerRef.current;
      answerRef.current = null;
      push({ type: 'user', text: value });
      addHistory(cwd, value);
      historyRef.current.push(value);
      setPlaceholder(pick(PLACEHOLDERS));
      resolve({ choice: 'answer', text: value });
      return;
    }
    if (value.startsWith('/')) { runSlash(value); return; }
    if (value.startsWith('!')) { runShell(value.slice(1).trim()); return; }
    addHistory(cwd, value);
    historyRef.current.push(value);
    if (agent.busy || S.current.starting) { queuedRef.current = value; setQueued(value); return; }
    sendPrompt(value);
  }, [agent, cwd, push, runShell, runSlash, sendPrompt]);

  // Menu under the prompt: slash commands or @files.
  const inputMode = input.value.startsWith('!') ? 'bash' : 'prompt';
  let menu = null;
  if (!perm && !picker && input.value !== menuClosedFor) {
    const cmds = inputMode === 'prompt' ? matchCommands(input.value) : [];
    if (cmds.length) menu = { kind: 'slash', pad: 14, items: cmds.map((c) => ({ label: `/${c.name}`, desc: c.desc, value: c.name, takesArg: !!c.arg })) };
    const at = mentionAt(input);
    if (!menu && at) {
      if (!filesRef.current) { filesRef.current = []; let n = 0; for (const f of walk(cwd)) { if (!f.dir) filesRef.current.push(f.path); if (++n > 5000) break; } }
      const q = at.query.toLowerCase();
      const hits = filesRef.current.filter((f) => f.toLowerCase().includes(q)).sort((a, b) => (a.toLowerCase().startsWith(q) ? 0 : 1) - (b.toLowerCase().startsWith(q) ? 0 : 1) || a.length - b.length).slice(0, 50);
      if (hits.length) menu = { kind: 'files', pad: 0, at, items: hits.map((f) => ({ label: `@${f}`, value: f })) };
    }
  }
  const menuIdx = menu ? Math.min(menuIndex, menu.items.length - 1) : 0;
  useEffect(() => { setMenuIndex(0); setMenuClosedFor((v) => (v === input.value ? v : null)); }, [input.value]);

  const completeMenu = (m, idx) => {
    const it = m.items[idx];
    if (m.kind === 'slash') { const v = `/${it.value}${it.takesArg ? ' ' : ''}`; setInput({ value: v, cursor: v.length }); return v; }
    const before = input.value.slice(0, m.at.start);
    const after = input.value.slice(input.cursor);
    const v = `${before}@${it.value} ${after.replace(/^\s+/, '')}`;
    setInput({ value: v, cursor: before.length + it.value.length + 2 });
    return v;
  };

  usePaste((text) => {
    if (S.current.perm || S.current.picker) return;
    setInput((s) => insertText(s, text.replace(/\r\n?/g, '\n')));
  });

  useInput((ch, key) => {
    const cur = S.current;
    // A window too small to show the screen takes no keys (enter could answer
    // a question you cannot see), except ctrl+c.
    if (cur.tooSmall && !(key.ctrl && ch === 'c')) return;
    // Permission prompt
    if (cur.perm) {
      const p = cur.perm;
      const n = p.options.length;
      const choose = (i) => {
        const o = p.options[i];
        const choice = o.choice;
        setPerm(null);
        // Bonsai's question: a listed choice answers it; "type" takes the next line you enter.
        if (choice === 'type') { answerRef.current = p.resolve; setPlaceholder('Type your answer to Bonsai, then enter'); return; }
        if (choice === 'answer') { p.resolve({ choice, text: o.text }); return; }
        p.resolve({ choice });
        if (choice === 'no') setPlaceholder('Tell Bonsai what to do instead');
      };
      const always = p.options.findIndex((o) => o.choice === 'always');
      const no = p.options.findIndex((o) => o.choice === 'no');
      if (key.upArrow) setPerm({ ...p, selected: (p.selected + n - 1) % n });
      else if (key.downArrow) setPerm({ ...p, selected: (p.selected + 1) % n });
      else if (key.return) choose(p.selected);
      else if (key.escape) choose(no);
      else if (key.tab && key.shift && always >= 0 && p.req.name !== 'Bash') choose(always);
      else if (/^[1-9]$/.test(ch) && Number(ch) <= n) choose(Number(ch) - 1);
      else if (key.ctrl && ch === 'c') interrupt();
      return;
    }
    // Model picker: ↑↓ model, ←→ thinking, enter saves
    if (cur.picker?.kind === 'model') {
      const pk = cur.picker;
      const levels = model.thinkingLevels ?? [];
      if (key.leftArrow) setPicker({ ...pk, level: Math.max(0, pk.level - 1) });
      else if (key.rightArrow || key.tab) setPicker({ ...pk, level: key.tab ? (pk.level + 1) % levels.length : Math.min(levels.length - 1, pk.level + 1) });
      else if (key.upArrow) setPicker({ ...pk, index: Math.max(0, pk.index - 1) });
      else if (key.downArrow) setPicker({ ...pk, index: Math.min(pk.models.length - 1, pk.index + 1) });
      else if (key.escape || (key.ctrl && ch === 'c')) setPicker(null);
      else if (key.return) {
        const lv = levels[pk.level];
        const on = !!lv?.effort;
        setThinking(on, on ? lv.id : undefined);
        setPicker(null);
        const picked = pk.models[pk.index];
        push({ type: 'note', text: `${picked.name} · effort ${lv?.label.toLowerCase() ?? 'off'}${picked.id !== model.id ? ' (restart Bonsai Code to switch models)' : ''}.`, tone: 'dim' });
        if (picked.id !== model.id) saveSettings({ model: picked.id });
      }
      return;
    }
    // Resume picker
    if (cur.picker) {
      const pk = cur.picker;
      if (key.upArrow) setPicker({ ...pk, index: Math.max(0, pk.index - 1) });
      else if (key.downArrow) setPicker({ ...pk, index: Math.min(pk.items.length - 1, pk.index + 1) });
      else if (key.escape || (key.ctrl && ch === 'c')) setPicker(null);
      else if (key.return) { const id = pk.items[pk.index].key; setPicker(null); resumeSession(id); }
      return;
    }
    // Keys that work everywhere
    if (key.ctrl && ch === 'c') {
      if (agent.busy || cur.live.phase === 'working') { interrupt(); return; }
      if (cur.input.value) { setInput({ value: '', cursor: 0 }); return; }
      if (Date.now() - exitArmed.current < 2000) { quit(); return; }
      exitArmed.current = Date.now();
      flash('Press ctrl+c again to exit', 2000);
      return;
    }
    if (key.ctrl && ch === 'd' && !cur.input.value) { quit(); return; }
    if (key.escape) {
      // An open menu or shortcut list closes first; the next esc stops Bonsai.
      if (menu) { setMenuClosedFor(cur.input.value); return; }
      if (showShortcuts) { setShowShortcuts(false); return; }
      if (agent.busy || cur.live.phase === 'working') { interrupt(); return; }
      if (cur.input.value) {
        if (Date.now() - escArmed.current < 1500) { setInput({ value: '', cursor: 0 }); return; }
        escArmed.current = Date.now();
        flash('Press esc again to clear', 1500);
      }
      return;
    }
    if (key.tab && key.shift) { const m = MODES[(MODES.indexOf(cur.mode) + 1) % MODES.length]; setMode(m); return; }
    if (key.ctrl && ch === 'l') { toggleLayout(); return; }
    if (key.ctrl && ch === 'o') {
      if (lastFold.current) push({ type: 'expand', title: lastFold.current.title, text: lastFold.current.text });
      else flash('Nothing to expand yet');
      return;
    }
    // Keys typed while the app was busy can arrive together ("on\r"): the
    // Enter in them still sends (a real paste comes through usePaste instead).
    if (ch && ch.length > 1 && ch.includes('\r') && !key.ctrl && !key.meta) {
      const parts = ch.split(/\r\n?/);
      let st = cur.input;
      parts.forEach((part, i) => {
        st = insertText(st, part);
        if (i === parts.length - 1) return;
        if (st.value.endsWith('\\') && st.cursor === st.value.length) st = { value: `${st.value.slice(0, -1)}\n`, cursor: st.value.length };
        else { submit(st.value); st = { value: '', cursor: 0 }; }
      });
      setInput(st);
      return;
    }
    // Menu navigation
    if (menu) {
      if (key.upArrow) { setMenuIndex((i) => (i - 1 + menu.items.length) % menu.items.length); return; }
      if (key.downArrow) { setMenuIndex((i) => (i + 1) % menu.items.length); return; }
      if (key.tab) { completeMenu(menu, menuIdx); return; }
      if (key.return) {
        if (menu.kind === 'slash') {
          const it = menu.items[menuIdx];
          if (it.takesArg && !/\s/.test(cur.input.value) && `/${it.value}` !== cur.input.value) { completeMenu(menu, menuIdx); return; }
          submit(`/${it.value}`);
          return;
        }
        completeMenu(menu, menuIdx);
        return;
      }
    }
    // History
    const pos = cursorLine(cur.input);
    if (key.upArrow && pos.line === 0) {
      const h = historyRef.current;
      if (!h.length) return;
      if (histIdx.current === null) { draftRef.current = cur.input.value; histIdx.current = h.length; }
      histIdx.current = Math.max(0, histIdx.current - 1);
      const v = h[histIdx.current];
      setInput({ value: v, cursor: v.length });
      return;
    }
    if (key.downArrow && pos.line === pos.lines - 1) {
      if (histIdx.current === null) return;
      const h = historyRef.current;
      histIdx.current += 1;
      const v = histIdx.current >= h.length ? draftRef.current : h[histIdx.current];
      if (histIdx.current >= h.length) histIdx.current = null;
      setInput({ value: v, cursor: v.length });
      return;
    }
    if (key.return) {
      if (cur.input.value.endsWith('\\') && cur.input.cursor === cur.input.value.length) {
        setInput({ value: `${cur.input.value.slice(0, -1)}\n`, cursor: cur.input.value.length });
        return;
      }
      submit(cur.input.value);
      return;
    }
    if (ch === '?' && !cur.input.value) { setShowShortcuts((v) => !v); return; }
    setInput((s) => editInput(s, ch, key));
  });

  const app = {
    items, live, perm, picker, input, mode, layout, width, rows: rows ?? 40, columns: columns ?? 100, tooSmall, redraw, cwd, cwdShort: short(cwd),
    modelName: model.name, now, stats: { ...stats, ctxUsed: stats.ctxUsed ?? agent.ctxUsed }, ctx, ramGb, starting, startedAt, notice, queued, showShortcuts, placeholder,
    inputMode, menu: menu ? { ...menu, index: menuIdx } : null, waitingForYou: !!perm, thinking,
    thinkingLabel: thinkingLevel(model, thinking, effort).label.toLowerCase(), thinkingLevels: model.thinkingLevels ?? [], startPhase,
  };
  return <Screen app={app} />;
}
