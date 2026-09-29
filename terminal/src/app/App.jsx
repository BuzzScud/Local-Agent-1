// Agentic Coder's terminal app: starts the model, runs the agent, and turns
// its events into the screen; handles the prompt box, permission prompts,
// slash commands, layouts, sessions and keys.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, useInput, usePaste, useWindowSize } from 'ink';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, statSync, readFileSync, statfsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Screen, permissionOptions, primeRows, btwLayout } from './screen.jsx';
import { MIN_COLS, MIN_ROWS } from './window.mjs';
import { Agent } from '../agent/agent.mjs';
import { helpersFrom, helpersEnv, changeHelpers, helperRows } from './helpers.mjs';
import { systemPrompt, projectNotes, gitSummary, SESSION_MARK } from '../agent/prompt.mjs';
import { commandPrefix } from '../agent/permissions.mjs';
import { resolvePath, toolSchemas } from '../agent/tools.mjs';
import { warmUp, MODELS, DEFAULT_MODEL, modelPath, serverBinOf, engineOf, thinkingLevel, ModelServer, chooseContext, availableBytes, needBytes, runningServer, LINGER_SECS, liveUsers, stopIdleServers, stopServer, otherCopies, contextCheck, hasDraft, readEdited, editedModel, modelById, readRecord, Embedder, embedderReady, HOME, macMemory } from '../../../models/index.mjs';
import { footerLabel } from './mac-memory.mjs';
import { readFile } from '../tools/read.mjs';
import { runCommand } from '../tools/run.mjs';
import { walk } from '../tools/fs.mjs';
import { editInput, insertText, cursorLine, mentionAt, selectedText } from './edit-input.mjs';
import { copyToClipboard } from './clipboard.mjs';
import { matchCommands, COMMANDS } from './commands.mjs';
import { startWeightsServer, listDocs } from './weights.mjs';
import { MODE_OPTIONS } from './help.mjs';
import { memoryDirs, readFacts, readLog, undoSave, openMemory } from '../agent/facts.mjs';
import { rulesList, changeRules, looksLikeEvent, ALWAYS_MAX } from './rules.mjs';
import { notesCount, notesDir, claudeOn } from '../agent/claude-notes.mjs';
import { CLAUDE_RULES } from '../agent/claude-rules.mjs';
import { AutoSave, memoryOn, sinceLastTime } from './autosave.mjs';
import { mathTopics } from '../agent/expertise.mjs';
import { loadSettings, saveSettings, saveSession, listSessions, loadSession, newSessionId, loadHistory, addHistory } from './store.mjs';
import { saveTrust } from './trust.mjs';
import { countTries } from './live.mjs';
import { spinStyle } from '../ui/theme.mjs';
import { watchUpdates, updateText, bringIn, canRestart } from './update.mjs';
import { runMorning, summary as morningSummary } from '../morning/index.mjs';
import { complete } from '../flows/llm.mjs';
import { askAside, sendToMain } from '../agent/btw.mjs';
import { LIMITS, readLimits, limitsToSave, moveLimit, limitChanges, modelWithLimits, applyLimits, defaultLimits, showLimit } from './limits.mjs';
import { isQuit } from '../flows/words.mjs';

// The spinner's verb for a turn and its past tense for the line left behind
// when the turn ends ("⠿ Baked for 41s · done 12:58 PM"), as Claude Code does.
const VERBS = [['Baking', 'Baked'], ['Brewing', 'Brewed'], ['Cogitating', 'Cogitated'], ['Computing', 'Computed'], ['Conjuring', 'Conjured'], ['Cooking', 'Cooked'], ['Crafting', 'Crafted'], ['Crunching', 'Crunched'], ['Deliberating', 'Deliberated'], ['Forging', 'Forged'], ['Hatching', 'Hatched'], ['Ideating', 'Ideated'], ['Marinating', 'Marinated'], ['Mulling', 'Mulled'], ['Musing', 'Mused'], ['Noodling', 'Noodled'], ['Percolating', 'Percolated'], ['Pondering', 'Pondered'], ['Puzzling', 'Puzzled'], ['Ruminating', 'Ruminated'], ['Simmering', 'Simmered'], ['Stewing', 'Stewed'], ['Synthesizing', 'Synthesized'], ['Tinkering', 'Tinkered'], ['Working', 'Worked'], ['Wrangling', 'Wrangled']];
const PLACEHOLDERS = ['Try "explain what this project does"', 'Try "add a test for …"', 'Try "fix the failing tests"', 'Try "find where … is set"'];
const MODES = ['ask', 'edits', 'plan'];
const IDLE = { phase: 'idle' };
const INIT_PROMPT = 'Look through this project and write an AGENTS.md at its root for a coding assistant: what the project is, how to run it and its tests, the main folders and files, and conventions you notice in the code. Keep it under 60 lines. If an AGENTS.md already exists, improve it instead.';
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
let seq = 0;

const home = homedir();
const short = (p) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);
// A stopped server's process really gone (false after `ms`): two copies of the model never fit side by side.
async function exited(pid, ms = 15000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 200))) {
    try { process.kill(pid, 0); } catch { return true; }
  }
  return false;
}

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

export function App({ opts, win, onRestart }) {
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
    const on = (size) => {
      try { primeRows(itemsRef.current, { ...measure.current, width: Math.max(MIN_COLS, size.columns ?? 100) }); } catch {}
      setWinSize(size); setRedraw((n) => n + 1);
    };
    win.on('redraw', on);
    return () => win.off('redraw', on);
  }, [win]);
  // The text a menu was closed for with esc (typing again opens it).
  const [menuClosedFor, setMenuClosedFor] = useState(null);
  // Where Agentic Coder works; it can move into a project named from the home folder.
  const [cwd, setCwd] = useState(opts.cwd);
  const settings = useRef(loadSettings(opts.cwd)).current;
  // The model can change while the window is open (/model switches to the
  // edited copy and back), so it is state; the last pick is kept in settings.
  const [model, setModel] = useState(() => modelById(opts.modelId) ?? modelById(settings.model) ?? MODELS[DEFAULT_MODEL]);
  // The limits /increase moves (limits.mjs), kept in settings.json. `model`
  // stays the registry's; the agent and the server get it with the thinking cap.
  const limitsRef = useRef(null);
  limitsRef.current ??= readLimits(settings, model);
  // What the Weights tab last saved (the edited copy's manifest): feeds the
  // weights badge in the lower right.
  const [editedSaved, setEditedSaved] = useState(readEdited);
  // New Agentic Coder code on main since this start: the "Update available" badge,
  // and /update, which restarts this window on it.
  const [update, setUpdate] = useState(null);
  const updateRef = useRef(null);
  useEffect(() => { const w = watchUpdates(setUpdate); updateRef.current = w; return w.stop; }, []);
  const memoryNote = useRef(null);
  const measure = useRef({ width: 100, modelName: '', cwdShort: '' });
  const itemsRef = useRef([]);
  const [, bumpRows] = useState(0);

  // The welcome carries the Mac's memory as the window opened (cli.jsx measures it).
  const [items, setItems] = useState(() => [{ key: 'welcome', type: 'welcome' }]);
  const [live, setLive] = useState(IDLE);
  const [perm, setPerm] = useState(null);
  const [picker, setPicker] = useState(null);
  const [input, setInput] = useState({ value: '', cursor: 0 });
  const [menuIndex, setMenuIndex] = useState(0);
  const [mode, setModeState] = useState(MODES.includes(opts.mode ?? settings.mode) ? (opts.mode ?? settings.mode) : 'ask');
  const [thinking, setThinkingState] = useState(opts.thinking ?? settings.thinking ?? model.thinkingDefault ?? true);
  const [effort, setEffortState] = useState(opts.effort ?? settings.effort ?? model.thinkingEffort);
  const [startPhase, setStartPhase] = useState('loading');
  // Another copy of the model already loaded (a practice-test run, a speed
  // test): the start says who has it and waits for it to go; esc starts anyway
  // (the user's pick, 28 Sep). `waiting` is the line on the start screen.
  const [waiting, setWaiting] = useState(null);
  const waitRef = useRef(null);
  const waitForOthers = async (m, stillOn = () => true) => {
    let others = otherCopies(m);
    if (!others.length) return;
    const who = (list) => list.map((o) => `${o.who} (port ${o.port ?? '?'}, ${(o.bytes / 1e9).toFixed(1)} GB)`).join(' and ');
    setWaiting(who(others));
    setStartPhase('waiting');
    await new Promise((resolve) => {
      const done = () => { clearInterval(tick); waitRef.current = null; resolve(); };
      const tick = setInterval(() => {
        if (!stillOn()) return done();
        others = otherCopies(m);
        if (others.length) setWaiting(who(others));
        else done();
      }, 3000);
      waitRef.current = { go: () => { push({ type: 'note', text: `Starting anyway: ${who(others)} still has ${m.name} loaded, so both may be slow.`, tone: 'warn' }); done(); } };
    });
    setWaiting(null);
    setStartPhase('loading');
  };
  const [stats, setStats] = useState({});
  const [ctx, setCtx] = useState(opts.ctx ?? 32768);
  const [starting, setStarting] = useState(!opts.url);
  const [startedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState(null);
  const [queued, setQueued] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [popup, setPopup] = useState(null); // a box in the middle of the window (/help); any key closes it
  const [placeholder, setPlaceholder] = useState(pick(PLACEHOLDERS));
  const [ramGb, setRamGb] = useState(null);
  const [meters, setMeters] = useState(Boolean(settings.meters)); // the status bar under the prompt (off, like Claude Code)
  // /btw: a side question and its answer, in a panel in the prompt box's place
  // (Claude Code's /btw); gone when closed. The main job's own question wins
  // the place while one is open: answerWait is "type your answer" to it.
  const [btw, setBtw] = useState(null);
  const btwRef = useRef(null);
  const [answerWait, setAnswerWait] = useState(false);

  // Each new item is measured before it is shown (see primeRows), so the
  // space above the prompt box is right on the first frame; measured just
  // after the current step, never inside a render or an effect (a second
  // Ink render in there breaks the first one's layout).
  const push = useCallback((...its) => {
    const made = its.map((it) => ({ key: `i${++seq}`, ...it }));
    queueMicrotask(() => {
      try { primeRows(made, measure.current); } catch {}
      setItems((xs) => [...xs, ...made]);
    });
  }, []);
  const serverRef = useRef(null);
  const restartRef = useRef(null);
  const abortRef = useRef(null);
  const historyRef = useRef(loadHistory(cwd));
  const histIdx = useRef(null);
  const draftRef = useRef('');
  const pendingContext = useRef([]);
  // What ctrl+o can open, newest last: a thought, a tool's full output, what
  // came along with a request. ctrl+o opens the newest; pressed again, the one
  // before it, so a line further up that says "ctrl+o to expand" can be reached.
  const folds = useRef({ list: [], back: 0 });
  const fold = (f) => { const s = folds.current; s.list.push(f); if (s.list.length > 50) s.list.shift(); s.back = 0; };
  const exitArmed = useRef(0);
  const escArmed = useRef(0);
  const sessionRef = useRef({ id: newSessionId(), title: null, items: [] });
  const filesRef = useRef(null);
  const queuedRef = useRef(null);
  const answerRef = useRef(null); // resolves Agentic Coder's question with what you type next

  // The agent lives for the whole session.
  const agentRef = useRef(null);
  if (!agentRef.current) {
    // The memory: your two rules and an older notes file are carried in at
    // the first start; the small model that finds the facts is started with
    // the first request that needs it.
    const remembers = memoryOn(settings);
    if (remembers) { try { openMemory(cwd, { rules: claudeOn(settings) ? CLAUDE_RULES : null }); } catch {} }
    const notes = projectNotes(cwd, 6000, { memory: remembers });
    // The context helpers (agent/helpers.mjs): all on unless /helpers (in
    // settings.json) or AGENTIC_HELPERS says otherwise. The small model that
    // compares meanings serves both the memory and the code search.
    const helpers = helpersFrom(settings);
    const embedder = (remembers || helpers.has('rag')) && embedderReady() ? new Embedder() : null;
    agentRef.current = new Agent({
      // "claudeNotes": false in settings.json leaves Claude's notes out; a path names another folder.
      memory: remembers ? { embedder, claude: claudeOn(settings) ? settings.claudeNotes ?? true : false } : null,
      // The same small model ranks the files Read first gives (rank.mjs), with the memory on or off.
      helpers, embedder, ranker: embedder,
      url: opts.url ?? 'http://127.0.0.1:0', model: modelWithLimits(model, limitsRef.current), cwd,
      // a server given with --url and --slots 2 has a side slot for the save and the sorting
      ...(opts.url && opts.slots > 1 ? { slots: { main: 0, side: 1 } } : {}),
      system: systemPrompt({ cwd, notes: notes.text, git: gitSummary(cwd) }),
      thinking, effort, ctx, mode, flows: opts.flows !== false,
      ask: (req) => new Promise((resolve) => {
        const prefix = req.name === 'Bash' ? commandPrefix(req.args.command) : null;
        setPerm({ req, selected: 0, options: permissionOptions(req, prefix), resolve });
      }),
      waitForServer: async () => { if (restartRef.current) await restartRef.current; else if (serverRef.current) await serverRef.current.restart(); },
      // A conversation that starts over from its notes: the instructions come
      // back from their saved reading (a server Agentic Coder started itself).
      rewarm: async (signal) => {
        const a = agentRef.current;
        if (!serverRef.current || !a?.warmed || a.slots?.main === undefined) return;
        await warmUp({ sessionMark: SESSION_MARK, url: a.url, model: a.model, system: a.messages[0].content, tools: toolSchemas(), thinking: a.thinking, effort: a.effort, slot: a.slots.main, helper: serverRef.current.draft, signal });
      },
    });
    applyLimits(agentRef.current, limitsRef.current);
  }
  const agent = agentRef.current;
  // Saving on its own (autosave.mjs): a little after a task, and on quit.
  const autoRef = useRef(null);
  // Before a save, the facts are listed and a Save / Skip menu opens (the
  // default, "memorySave": "ask"); "auto" in settings.json saves unasked.
  const pendingSaveRef = useRef(null);
  const askRef = useRef(null);
  const saveEnv = process.env.AGENTIC_MEMORY_SAVE ?? process.env.BONSAI_MEMORY_SAVE; // off · on/auto · ask
  const saveMode = saveEnv === 'on' || saveEnv === 'auto' ? 'auto' : saveEnv === 'ask' ? 'ask' : (settings.memorySave ?? 'ask');
  autoRef.current ??= new AutoSave({ agent, ask: saveMode === 'ask' ? (p) => askRef.current(p) : null, say: (text) => push({ type: 'note', text, tone: 'dim' }), sessionsDir: join(HOME, 'sessions', cwd.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-100) || 'root') });

  // Everything the key handler needs, always current.
  const S = useRef({});
  S.current = { input, perm, picker, popup, menuIndex, mode, starting, live, queued, tooSmall, meters, btw, answerWait };

  const flash = useCallback((text, ms = 2000) => { setNotice(text); setTimeout(() => setNotice((n) => (n === text ? null : n)), ms); }, []);
  // Text selected in the prompt (shift + arrows) is copied as soon as the
  // selection settles, like Claude Code's copy on select.
  const copiedRef = useRef('');
  useEffect(() => {
    const text = selectedText(input);
    if (!text) { copiedRef.current = ''; return undefined; }
    const t = setTimeout(() => {
      if (text === copiedRef.current) return;
      copiedRef.current = text;
      if (copyToClipboard(text)) flash(`copied ${text.length.toLocaleString()} char${text.length === 1 ? '' : 's'} to clipboard`, 2500);
    }, 250);
    return () => clearTimeout(t);
  }, [input, flash]);

  const setMode = useCallback((m) => { agent.mode = m; setModeState(m); }, [agent]);

  // The menus that /effort, /mode and /meters open when typed alone: a
  // title, a line on what it sets, the options with what each does, the one
  // in use. applyChoice is also what the typed forms use, so both say the same.
  const choiceMenu = (id) => {
    if (id === 'effort') {
      const now = thinkingLevel(model, agent.thinking, agent.effort);
      return { title: 'Effort', blurb: 'How much Agentic Coder thinks before it acts. Kept for next time.', what: 'effort', current: now.id, options: (model.thinkingLevels ?? []).map((l) => ({ id: l.id, label: l.label, note: l.note ?? '' })) };
    }
    if (id === 'memory-save') return { title: 'Remember for next time?', blurb: 'What Agentic Coder learned in that task is listed above. /memory undo takes a save back.', what: 'memory', current: 'save', options: [{ id: 'save', label: 'Save', note: 'read at every start from now on' }, { id: 'skip', label: 'Skip', note: 'nothing is saved; /update memory saves later' }] };
    if (id === 'mode') return { title: 'Mode', blurb: 'How Agentic Coder asks before it changes things. For this conversation; shift+tab switches too.', what: 'mode', current: agent.mode, options: MODE_OPTIONS };
    return { title: 'Status bar', blurb: 'Model, speed, memory and effort on one line under the prompt. Kept for next time.', what: 'the status bar', current: S.current.meters ? 'on' : 'off', options: [{ id: 'on', label: 'On', note: 'show it under the prompt' }, { id: 'off', label: 'Off', note: 'hide it; /stats has the numbers' }] };
  };
  // The hub in the browser (/weights, /docs, /help): one small server per
  // window, closed with it. Answers { server, url } or null after a warning.
  const openHub = (tab) => {
    // The hub always serves and edits the ORIGINAL model file: each save
    // rebuilds the copy from a fresh clone of it plus the whole edit list.
    const base = MODELS[model.edited ? model.edited.base : DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL];
    const onEdits = (e) => {
      if (e.kind === 'save') {
        setEditedSaved(e.saved);
        const n = e.saved.edits.length;
        push({ type: 'note', text: `Saved ${model.name} · edited — ${n} edit${n === 1 ? '' : 's'}. Pick it in /model to run on it. The original file is untouched.`, tone: 'dim' });
      } else { setEditedSaved(null); push({ type: 'note', text: 'The edited copy was removed. The original was never touched.', tone: 'dim' }); }
    };
    try { weightsRef.current ??= startWeightsServer({ path: modelPath(base), onEdits, cwd }); } catch (e) { push({ type: 'note', text: `Could not start the hub: ${e.message}`, tone: 'warn' }); return null; }
    const url = `${weightsRef.current.url}?tab=${tab}`;
    if (!(process.env.AGENTIC_NO_OPEN ?? process.env.BONSAI_NO_OPEN)) Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' });
    return { server: weightsRef.current, url };
  };
  // /model picked a different set of weights: only the model server restarts;
  // the window, the conversation and the history all stay. About 40 s: the
  // new weights never reuse a saved warm-up, so the instructions are re-read.
  // /increase uses it too, to restart on a new context or thinking cap (`done` is its note).
  const switchModel = async (next, done) => {
    if (S.current.live !== IDLE) { push({ type: 'note', text: 'Agentic Coder is in the middle of a reply. Let it finish (or press esc), then switch.', tone: 'warn' }); return; }
    const cur = serverRef.current;
    // Only one 27B fits in memory, so nobody else may be on the old server.
    const others = cur?.port ? liveUsers(cur.port).filter((p) => p !== process.pid) : [];
    if (others.length) { push({ type: 'note', text: `Another Agentic Coder window is using ${model.name}. Close it first, then switch.`, tone: 'warn' }); return; }
    setModel(next);
    setStarting(true); setStartPhase('loading');
    try {
      const oldPid = cur?.child?.pid ?? cur?.shared?.pid;
      await cur?.stop();
      stopIdleServers(); // a server we only attached to (kept loaded earlier) is freed too
      // Wait for the old one to really exit: two 27Bs never fit side by side.
      if (oldPid && !(await exited(oldPid))) throw new Error('the old model server did not stop');
      await waitForOthers(next);
      const fixed = limitsRef.current.context;
      const c = fixed ? { ctx: fixed, reason: null } : chooseContext(next, { effort: agent.thinking ? agent.effort : undefined });
      // A context you picked is checked on a restart too: used as asked, said when it does not fit.
      if (fixed) {
        const chk = contextCheck(next, fixed, { draft: hasDraft(next) });
        c.reason = chk.note;
        if (!chk.fits) push({ type: 'note', text: chk.note, tone: 'warn' });
      }
      memoryNote.current = c.reason ?? null;
      const srv = new ModelServer(modelWithLimits(next, limitsRef.current));
      serverRef.current = srv;
      srv.on('crash', ({ code, signal }) => {
        if (srv.restarts >= 3) { push({ type: 'note', text: `The model server keeps stopping (code ${code ?? signal}). See ~/.agentic-coder/logs/server.log, then restart Agentic Coder.`, tone: 'error' }); return; }
        push({ type: 'note', text: `The model server stopped (code ${code ?? signal}); restarting it.`, tone: 'warn' });
        restartRef.current = srv.restart().then(() => { push({ type: 'note', text: 'The model server is back.', tone: 'dim' }); }).catch((e) => push({ type: 'note', text: e.message, tone: 'error' })).finally(() => { restartRef.current = null; });
      });
      const st = await srv.start({ ctx: c.ctx, lingerSecs: LINGER_SECS, helper: c.helper });
      agent.url = srv.url;
      agent.model = modelWithLimits(next, limitsRef.current);
      agent.ctx = st.ctx ?? c.ctx; setCtx(agent.ctx);
      if (st.slots > 1) agent.slots = { main: 0, side: 1 };
      setStartPhase('reading');
      await warmUp({ sessionMark: SESSION_MARK, url: srv.url, model: next, system: agent.messages[0].content, tools: toolSchemas(), thinking: agent.thinking, effort: agent.effort, slot: agent.slots?.main, helper: srv.draft, onPhase: setStartPhase });
      const n = next.edited?.edits.length ?? 0;
      if (done) push({ type: 'note', text: done(agent.ctx), tone: 'dim' });
      else push({ type: 'note', text: next.edited ? `Now on ${next.name} (${n} edit${n === 1 ? '' : 's'}). Pick ${MODELS[next.edited.base].name} in /model to go back.` : `Now on ${next.name}.`, tone: 'dim' });
    } catch (e) { push({ type: 'note', text: done ? `Could not restart ${next.name}: ${e.message}. /increase to try again.` : `Could not switch: ${e.message}. Pick a model in /model to try again.`, tone: 'error' }); }
    setStarting(false);
  };
  const openChoice = (id) => { const c = choiceMenu(id); setPicker({ kind: 'choice', id, ...c, index: Math.max(0, c.options.findIndex((o) => o.id === c.current)) }); };
  askRef.current = (p) => new Promise((resolve) => {
    // Not over something you are doing: typing, or another menu open. Asked
    // again at the next pause.
    if (S.current.picker || S.current.input?.value?.trim() || pendingSaveRef.current || S.current.btw) { resolve('later'); return; }
    pendingSaveRef.current = { resolve };
    push({ type: 'panel', title: `Learned in that task · ${p.add.length + p.drop.length} change${p.add.length + p.drop.length === 1 ? '' : 's'}`, pad: 0, rows: [...p.add.map((f) => [`+ ${f.text.replace(/\s+/g, ' ').slice(0, 140)}`]), ...p.drop.map((d) => [`− ${d.text.replace(/\s+/g, ' ').slice(0, 110)} (${d.why})`])] });
    openChoice('memory-save');
  });
  const applyChoice = (id, value) => {
    if (id === 'memory-save') { const p = pendingSaveRef.current; pendingSaveRef.current = null; p?.resolve(value === 'save'); return; }
    if (id === 'effort') {
      const lv = (model.thinkingLevels ?? []).find((l) => l.id === value); if (!lv) return;
      const on = !!lv.effort;
      setThinking(on, on ? lv.id : undefined);
      push({ type: 'note', text: `Effort is ${lv.label.toLowerCase()}: it ${lv.note ?? 'thinks before each step'}.`, tone: 'dim' });
    } else if (id === 'mode') {
      const o = MODE_OPTIONS.find((x) => x.id === value); if (!o) return;
      setMode(o.id);
      push({ type: 'note', text: `Mode is ${o.label.toLowerCase()}: Agentic Coder ${o.note}.`, tone: 'dim' });
    } else if (id === 'meters') {
      const on = value === 'on';
      setMeters(on);
      saveSettings({ meters: on });
      push({ type: 'note', text: on ? 'Status bar on: model, speed, memory and effort under the prompt.' : 'Status bar off. /stats has the numbers; a memory note appears only when it runs low.', tone: 'dim' });
    }
  };
  // /increase saved: the agent's limits change at once; a new context or
  // thinking cap restarts the model server (the window and conversation stay).
  const saveLimits = (next) => {
    const changes = limitChanges(limitsRef.current, next);
    if (!changes.length) { push({ type: 'note', text: 'Limits unchanged.', tone: 'dim' }); return; }
    const restart = changes.some((c) => c.restart);
    if (restart && !opts.url && (S.current.live !== IDLE || agent.busy)) { push({ type: 'note', text: 'Agentic Coder is in the middle of a reply. Let it finish (or press esc), then save the context or thinking cap again in /increase.', tone: 'warn' }); return; }
    limitsRef.current = next;
    applyLimits(agent, next);
    saveSettings({ limits: limitsToSave(next, model) });
    const list = changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join(' · ');
    if (!restart) { push({ type: 'note', text: `Saved: ${list}. In use from the next step; kept for next time.`, tone: 'dim' }); return; }
    if (opts.url) { agent.model = modelWithLimits(model, next); push({ type: 'note', text: `Saved: ${list}. The model server was given with --url, so restart it yourself for the context or thinking cap to take effect.`, tone: 'warn' }); return; }
    push({ type: 'note', text: `Saved: ${list}. Restarting ${model.name} for it (about a minute); the conversation stays.`, tone: 'dim' });
    switchModel(model, (ctx) => `${model.name} restarted: context ${Math.round(ctx / 1024)}k · thinking cap ${showLimit('thinking', next.thinking)}.`);
  };
  const setThinking = useCallback((on, eff) => {
    agent.thinking = on;
    setThinkingState(on);
    if (eff) { agent.effort = eff; setEffortState(eff); }
    saveSettings(eff ? { thinking: on, effort: eff } : { thinking: on });
  }, [agent]);
  // Clock for spinners and timers, only while something is moving.
  const btwMoving = btw?.phase === 'answering' || btw?.phase === 'writing';
  useEffect(() => {
    if (!(starting || live.phase === 'working' || btwMoving)) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [starting, live.phase, btwMoving]);

  // The Mac's memory for the footer, read every 5 s (a few ms); the footer
  // redraws only when what it says changes.
  const [mac, setMac] = useState(opts.macMem ?? null);
  useEffect(() => {
    if (!opts.macMem) return;
    const id = setInterval(() => {
      const m = macMemory();
      if (m) setMac((prev) => (prev && footerLabel(prev) === footerLabel(m) && prev.level === m.level ? prev : m));
    }, 5000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    // lessons: what happened in each turn, for the memory's review at night.
    try { saveSession(cwd, s.id, { title: s.title, messages: agent.messages, items: s.items.slice(-300), mode: agent.mode, lessons: agent.lessons }); } catch {}
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
    autoRef.current.cancel(); // a save in the background steps aside
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
      return { ...l, ...patch, waiting: false, tokens: (l.tokens ?? 0) + 1, lastTokenAt: t, firstTokenAt: first, streamTokens: n, liveTps: secs > 0.7 ? n / secs : l.liveTps };
    };
    const offs = [
      on('turn-start', () => { const [verb, past] = pick(VERBS); setLive({ phase: 'working', turnStart: Date.now(), verb, past, tokens: 0, waiting: true }); }),
      on('waiting', () => setLive((l) => ({ ...l, waiting: true, thinking: null, text: null, writing: null, firstTokenAt: null, streamTokens: 0 }))),
      on('reasoning', ({ all }) => setLive((l) => stream(l, { thinking: { text: all, startedAt: l.thinking?.startedAt ?? Date.now(), tokens: (l.thinking?.tokens ?? 0) + 1 } }))),
      on('text', ({ all }) => setLive((l) => stream(l, { text: all }))),
      on('tool-writing', ({ name, args, tokens }) => setLive((l) => stream(l, { writing: { name, args, tokens } }))),
      on('assistant', ({ text, reasoning, thinkSecs }) => {
        const add = [];
        if (reasoning?.trim()) {
          add.push({ type: 'thinking', text: reasoning.trim(), secs: thinkSecs || 0.1, tokens: Math.ceil(reasoning.length / 3.6) });
          fold({ title: `Thinking (${Math.round(thinkSecs)}s)`, text: reasoning.trim() });
        }
        if (text?.trim()) add.push({ type: 'text', text: text.trim() });
        if (add.length) push(...add);
        setLive((l) => ({ ...l, thinking: null, text: null, writing: null }));
      }),
      on('tool-running', ({ label, arg }) => setLive((l) => ({ ...l, running: { label, arg }, writing: null }))),
      on('tool', (ev) => {
        push({ type: 'tool', label: ev.label, arg: ev.arg, view: ev.view, error: ev.error });
        const v = ev.view ?? {};
        if (v.kind === 'bash') fold({ title: `Bash(${ev.arg})`, text: v.lines.join('\n') });
        else if (v.content) fold({ title: `${ev.label}(${ev.arg})`, text: v.content });
        setLive((l) => ({ ...l, running: null, writing: null }));
      }),
      on('note', ({ text, tone }) => push({ type: 'note', text, tone })),
      // What came along with the request (memory, Claude's notes): one line; ctrl+o lists it.
      on('context', (c) => { push({ type: 'context', ...c }); fold({ context: c }); }),
      // Which path the request took, under the request.
      on('sorted', ({ text }) => push({ type: 'sorted', text })),
      // Saying yes to "Work in <project>?" counts as trusting that folder.
      on('cwd', ({ cwd: dir }) => { setCwd(dir); try { saveTrust(dir); } catch {} }),
      // Focused paths: the live try counter, its finished line, the current step.
      on('tries', (t) => setLive((l) => countTries(l, t))),
      on('tries-done', (t) => { push({ type: 'tries', ...t }); setLive((l) => ({ ...l, tries: null })); }),
      on('flow-step', (st) => setLive((l) => ({ ...l, flowStep: st }))),
      on('stats', (st) => setStats(st)),
      on('mode', (m) => setModeState(m)),
      on('settled', () => autoRef.current.schedule()),
      on('compacted', ({ summary }) => { push({ type: 'note', text: 'Conversation summarized to free memory.', tone: 'dim' }); fold({ title: 'Summary', text: summary }); }),
      on('turn-end', ({ reason, secs, steps, reads, thinkTokens }) => {
        const past = S.current.live?.past ?? 'Worked';
        setLive(IDLE);
        setPerm(null);
        answerRef.current = null;
        setAnswerWait(false);
        if (reason === 'interrupted') { push({ type: 'note', text: 'Interrupted · What should Agentic Coder do instead?', tone: 'warn' }); setPlaceholder('Tell Agentic Coder what to do instead'); }
        // A finished turn leaves its time behind, as in Claude Code: "⠿ Worked for 41s · done 12:58 PM".
        // With the counts that say where the time went: steps, reads, thinking.
        else if (reason === 'done' && secs >= 1) push({ type: 'done', past, secs, at: Date.now(), steps, reads, thinkTokens });
        if (reason === 'declined') setPlaceholder('Tell Agentic Coder what to do instead');
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
      // --ctx wins; then the context /increase saved; then what fits (chooseContext).
      let size = opts.ctx ?? (limitsRef.current.context || undefined);
      const picked = !opts.ctx && limitsRef.current.context;
      // A model still loaded from an earlier start (or another window) is used
      // as it is; otherwise the memory size is chosen from what is free now.
      let running = runningServer(model);
      // Kept loaded at another size than the one you picked, with no other
      // window on it: it restarts at yours (before, it kept the old size until coding stop).
      if (picked && running?.linger && running.ctx !== picked && !(running.users ?? []).some((p) => p !== process.pid)) {
        stopServer(running);
        await exited(running.pid);
        running = null;
      }
      if (!size && running) size = running.ctx;
      // Another copy loaded outside the app windows: wait for it (esc starts anyway).
      if (!running) await waitForOthers(model, () => alive);
      if (!alive) return;
      let helper;
      if (!size) {
        const c = chooseContext(model, { effort: agent.thinking ? agent.effort : undefined });
        size = c.ctx;
        helper = c.helper; // false: High keeps its memory, the speed helper stays off
        memoryNote.current = c.reason ?? null; // shown by /stats, not on the start screen
      }
      // A context you picked is used as asked, checked against what is free now
      // (before loading): said when it does not fit, and shown by /stats.
      if (picked && !running) {
        const chk = contextCheck(model, size, { draft: hasDraft(model) });
        memoryNote.current = chk.note;
        if (!chk.fits) push({ type: 'note', text: chk.note, tone: 'warn' });
      }
      agent.ctx = size;
      setCtx(size);
      const srv = new ModelServer(modelWithLimits(model, limitsRef.current));
      serverRef.current = srv;
      srv.on('crash', ({ code, signal }) => {
        if (srv.restarts >= 3) { push({ type: 'note', text: `The model server keeps stopping (code ${code ?? signal}). See ~/.agentic-coder/logs/server.log, then restart Agentic Coder.`, tone: 'error' }); return; }
        push({ type: 'note', text: `The model server stopped (code ${code ?? signal}); restarting it.`, tone: 'warn' });
        restartRef.current = srv.restart().then(() => { push({ type: 'note', text: 'The model server is back.', tone: 'dim' }); }).catch((e) => push({ type: 'note', text: e.message, tone: 'error' })).finally(() => { restartRef.current = null; });
      });
      let st;
      try {
        st = await srv.start({ ctx: size, lingerSecs: LINGER_SECS, helper });
        const want = !opts.ctx && limitsRef.current.context;
        if (want && st.shared && st.ctx !== want) push({ type: 'note', text: `${model.name} was already loaded at ${Math.round(st.ctx / 1024)}k, so it runs at that. Your /increase context (${Math.round(want / 1024)}k) applies after coding stop, or save it again in /increase.`, tone: 'warn' });
        if (st.shared) {
          agent.ctx = st.ctx;
          setCtx(st.ctx);
          if (!st.idle) push({ type: 'note', text: `Sharing the model with another Agentic Coder window (port ${st.port}); replies wait their turn.`, tone: 'dim' });
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
        agent.warmed = true; // this window's own reading of the instructions: a restart from notes restores it
        await warmUp({ sessionMark: SESSION_MARK, url: srv.url, model, system: agent.messages[0].content, tools: toolSchemas(), thinking: agent.thinking, effort: agent.effort, slot: agent.slots?.main, helper: srv.draft, onPhase: (p) => { if (alive) setStartPhase(p); } });
      } catch {}
      if (!alive) return;
      setStarting(false);
      const q = queuedRef.current;
      if (q) { queuedRef.current = null; setQueued(null); sendPrompt(q); }
      // First use here: what is already written is read once, in the background.
      else setTimeout(() => { autoRef.current.seed(); }, 3000).unref?.();
    })();
    return () => { alive = false; serverRef.current?.stop({ keep: true }); weightsRef.current?.stop(); weightsRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // What the memory saved after the last window here had closed, said once.
  useEffect(() => {
    if (!agent.memory) return;
    for (const line of sinceLastTime(cwd)) push({ type: 'note', text: line, tone: 'dim' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // /weights: the viewer's little server, started once per window and closed with it.
  const weightsRef = useRef(null);

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
    btwRef.current?.ac.abort();
    saveNow();
    // What the memory has not saved yet is handed to a process of its own,
    // which needs the model a little longer and stops it when it is done.
    const handed = autoRef.current.leave({ stopAfter: Boolean(serverRef.current?.child) });
    await agent.embedder?.stop({ keep: true }).catch(() => {});
    await serverRef.current?.stop({ keep: handed });
    exit();
  }, [exit, saveNow, agent]);

  // /update: Agentic Coder starts again on the new code (the launcher builds it) and
  // picks this conversation back up; the model stays loaded in between. An
  // update only on GitHub is brought into the repo's main first, if git can
  // do that without touching anything uncommitted.
  const updateNow = useCallback(async () => {
    const w = updateRef.current;
    if (!w?.repo) { push({ type: 'note', text: 'Updates are looked for when Agentic Coder runs from its repo (the coding command); AGENTIC_NO_UPDATE=1 turns them off.', tone: 'dim' }); return; }
    if (S.current.live.phase === 'working' || S.current.perm) { push({ type: 'note', text: 'Agentic Coder is busy. Let it finish (or press esc), then /update.', tone: 'warn' }); return; }
    const u = await w.check();
    if (!u) { push({ type: 'note', text: 'Agentic Coder is up to date: no new code on main since this window started.', tone: 'dim' }); return; }
    if (u.kind === 'pull') {
      const r = await bringIn(w.repo);
      if (!r.ok) { push({ type: 'note', text: `Could not bring the update in: ${r.why}. Pull it into the repo yourself, then /update.`, tone: 'warn' }); return; }
    }
    if (!canRestart()) { push({ type: 'note', text: `The update is ${u.kind === 'pull' ? 'in the repo now' : 'on main'}. This window was not started by the coding command, so quit and start it again to use it.`, tone: 'warn' }); return; }
    push({ type: 'note', text: '↻ Restarting on the update…', tone: 'dim' });
    abortRef.current?.abort();
    saveNow();
    const s = sessionRef.current;
    const level = thinkingLevel(model, thinking, effort).id;
    onRestart?.([
      ...(s.title ? ['--resume', s.id] : []),
      ...(opts.url ? ['--url', opts.url] : []),
      ...(opts.flows === false ? ['--no-flows'] : []),
      ...(opts.ctx ? ['--ctx', String(opts.ctx)] : []),
      ...(['low', 'medium', 'high'].includes(level) ? ['--effort', level] : []),
    ]);
    await serverRef.current?.stop({ keep: true });
    exit();
  }, [effort, exit, model, onRestart, opts.ctx, opts.flows, opts.url, push, saveNow, thinking]);

  const interrupt = useCallback(() => {
    abortRef.current?.abort();
    const p = S.current.perm;
    if (p) { p.resolve({ choice: 'no' }); setPerm(null); }
    if (answerRef.current) { answerRef.current({ choice: 'no' }); answerRef.current = null; setAnswerWait(false); }
  }, []);

  // /btw: asked on the side lane with a copy of the conversation, while the
  // main job goes on; its own stop, so closing it never touches the main job.
  const closeBtw = useCallback(() => {
    btwRef.current?.ac.abort();
    btwRef.current = null;
    setBtw(null);
    // A memory save that stepped aside for the question may run now.
    if (!agent.busy) autoRef.current?.schedule();
  }, [agent]);
  const askBtw = useCallback(async (question) => {
    btwRef.current?.ac.abort();
    const id = ++seq;
    const ac = new AbortController();
    btwRef.current = { id, ac };
    const mine = (fn) => setBtw((b) => (b && b.id === id ? fn(b) : b));
    setBtw({ id, question, text: '', phase: 'answering', startedAt: Date.now(), scroll: null });
    autoRef.current.cancel(); // the side lane is the memory save's too
    try {
      const r = await askAside({ agent, question, live: S.current.live, signal: ac.signal, onText: (all) => mine((b) => ({ ...b, text: all, phase: 'writing' })) });
      if (ac.signal.aborted) return;
      if (r.noRoom) mine((b) => ({ ...b, phase: 'noroom', text: "No room for a side question right now: the conversation fills the model's memory. Ask again after this step, or /compact when it is done." }));
      else mine((b) => ({ ...b, phase: r.text ? 'done' : 'error', text: r.text || 'No answer came back. Try asking again.' }));
    } catch (e) {
      if (!ac.signal.aborted) mine((b) => ({ ...b, phase: 'error', text: `Could not answer: ${e.message}` }));
    }
  }, [agent]);

  const runShell = useCallback(async (command) => {
    if (!command) return;
    setLive({ phase: 'working', turnStart: Date.now(), verb: 'Running', tokens: 0, running: { label: 'Bash', arg: command } });
    const r = await runCommand(command, { cwd, maxLines: 200, sandbox: false }); // you typed it: no fence
    setLive(IDLE);
    push({ type: 'bash', command, lines: r.lines, code: r.code });
    fold({ title: `! ${command}`, text: r.lines.join('\n') });
    pendingContext.current.push(`[The user ran \`${command}\` in the terminal (exit ${r.code}). Output:\n${r.lines.slice(-60).join('\n')}]`);
  }, [cwd, push]);

  const doctor = useCallback(() => {
    const ok = (b) => (b ? '✓' : '✗');
    const bin = serverBinOf(model);
    const ver = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    const file = modelPath(model);
    const size = existsSync(file) ? statSync(file).size : 0;
    const avail = availableBytes();
    let disk = null;
    try { const f = statfsSync(home); disk = (f.bavail * f.bsize) / 1e9; } catch {}
    push({
      type: 'panel', title: 'Doctor', pad: 22, rows: [
        [`${ok(ver.status === 0)} model server`, ver.status === 0 ? `${engineOf(model).id} ${(ver.stderr + ver.stdout).match(/build \d+/)?.[0] ?? 'ok'} · ${short(bin)}` : `missing at ${short(bin)}`],
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
      case 'help': {
        // The whole Help page (commands, keys, modes, effort, where things
        // live) opens in the hub's Help tab; here, a box in the middle says so.
        const hub = openHub('help');
        if (hub) setPopup({ title: 'Agentic Coder help', text: 'Opened a help page in your browser, with every command, key and setting.', url: hub.url });
        break;
      }
      case 'clear':
        if (busy) { flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        {
          // Back in the folder Agentic Coder was started in, if a "Work in <project>?" moved it.
          const back = agent.startOver(opts.cwd);
          sessionRef.current = { id: newSessionId(), title: null, items: [] };
          push({ type: 'divider', text: 'new conversation' });
          if (back) push({ type: 'note', text: `Back in ${short(opts.cwd)}, the folder Agentic Coder was started in.`, tone: 'dim' });
        }
        break;
      case 'btw': {
        // A quick side question, like Claude Code's: it runs while Agentic Coder works.
        if (!arg) { push({ type: 'note', text: 'Ask the question after it: /btw what are you doing right now?', tone: 'dim' }); break; }
        if (S.current.starting) { push({ type: 'note', text: 'The model is still starting; ask again in a moment.', tone: 'dim' }); break; }
        // Without a side lane the question would take the conversation's lane
        // and throw away its reading.
        if (agent.slots?.side === undefined) { push({ type: 'note', text: '/btw needs the model server\'s side lane, and this one has a single lane (with --url, add --slots 2).', tone: 'warn' }); break; }
        askBtw(arg);
        break;
      }
      case 'morning': {
        // The morning brief: the repos read, the words written by the model on
        // its side slot and checked against the facts, and the page (with every
        // earlier morning in its calendar) opened in the browser.
        if (busy || S.current.live.phase === 'working') { flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        const day = arg.toLowerCase() || 'auto';
        if (!/^(auto|today|yesterday|\d{4}-\d{2}-\d{2})$/.test(day)) { push({ type: 'note', text: 'Use /morning, or /morning today, yesterday or a date (2026-09-26).', tone: 'warn' }); break; }
        const ac = new AbortController();
        abortRef.current = ac;
        setLive({ phase: 'working', turnStart: Date.now(), verb: 'Reading the repos', tokens: 0 });
        try {
          const r = await runMorning({
            day, complete: agent.url ? complete : undefined, url: agent.url, model: agent.model, slot: agent.slots?.side, signal: ac.signal,
            onToken: (n) => setLive((l) => ({ ...l, tokens: n, lastTokenAt: Date.now() })),
            onStep: (kind, text) => {
              if (kind === 'gather' && text.startsWith('Read ')) push({ type: 'note', text, tone: 'dim' });
              if (kind === 'words') setLive((l) => ({ ...l, verb: 'Writing the brief' }));
            },
          });
          push({ type: 'note', text: `${morningSummary(r)}${agent.url ? '' : ' · the model was still starting, so the words are plain'}`, tone: r.error ? 'warn' : 'dim' });
        } catch (e) {
          push({ type: 'note', text: ac.signal.aborted ? 'Morning brief stopped.' : `Morning brief: ${e.message}`, tone: ac.signal.aborted ? 'dim' : 'error' });
        } finally {
          setLive(IDLE);
        }
        break;
      }
      case 'compact':
        if (busy) { flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        setLive({ phase: 'working', turnStart: Date.now(), verb: 'Compacting', tokens: 0 });
        try { await agent.compact(undefined, { instructions: arg || undefined }); } catch (e) { push({ type: 'note', text: e.message, tone: 'error' }); }
        setLive(IDLE);
        break;
      case 'effort':
      case 'think': { // /think is the old name, still accepted
        // Alone: a menu of the levels, like Claude Code's. With a word:
        // /effort low|medium|high, or on|off ("off" and "xhigh" are the old
        // names for low and high).
        const levels = model.thinkingLevels ?? [];
        if (!arg.trim() && levels.length) { openChoice('effort'); break; }
        const a = arg.toLowerCase().replace(/^off$/, 'low').replace(/^xhigh$/, 'high');
        const picked = levels.find((l) => l.id === a);
        if (a && !picked && !/^(on|yes|true|1|no|false|0)$/i.test(a)) {
          push({ type: 'note', text: `${model.name} has no ${a} effort: it has ${levels.map((l) => l.label).join(' and ')}. Effort stays ${thinkingLevel(model, agent.thinking, agent.effort).label.toLowerCase()}.`, tone: 'warn' });
          break;
        }
        const on = picked ? !!picked.effort : a ? /^(on|yes|true|1)$/i.test(a) : !agent.thinking;
        const eff = on && picked?.effort ? picked.id : undefined;
        setThinking(on, eff);
        const lv = thinkingLevel(model, on, eff ?? agent.effort);
        push({ type: 'note', text: `Effort is ${lv.label.toLowerCase()}: it ${lv.note ?? 'thinks before each step'}.`, tone: 'dim' });
        break;
      }
      case 'mode': {
        if (!arg.trim()) { openChoice('mode'); break; }
        const m = MODES.includes(arg) ? arg : MODES[(MODES.indexOf(agent.mode) + 1) % MODES.length];
        applyChoice('mode', m);
        break;
      }
      case 'memory': {
        // What Agentic Coder remembers: your own memory and this project's.
        if (!agent.memory) { push({ type: 'note', text: 'The memory is off here ("memory": false in settings.json).', tone: 'dim' }); break; }
        const dirs = memoryDirs(cwd);
        const tilde = (p) => (p?.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);
        if (/^open\b/i.test(arg.trim())) {
          // The hub on its Memory tab: every fact, with its trust, to edit, pin, take out or bring back.
          const hub = openHub('memory'); if (!hub) break;
          push({ type: 'note', text: `Memory opened in the browser at ${hub.url}`, tone: 'dim' });
          break;
        }
        if (/^undo\b/i.test(arg.trim())) {
          const u = undoSave(dirs);
          if (!u) { push({ type: 'note', text: 'Nothing to take back: no save in the log.', tone: 'dim' }); break; }
          push({ type: 'panel', title: 'Memory · the last save taken back', pad: 14, rows: [...u.did.map((d) => [d.what, d.fact.text.replace(/\s+/g, ' ').slice(0, 110)]), ['/memory undo again takes back the save before it']] });
          break;
        }
        const rows = [];
        for (const [title, dir] of [['About you', dirs.you], ['This project', dirs.project]]) {
          const facts = dir ? readFacts(dir).sort((x, y) => Number(y.always) - Number(x.always) || y.trust - x.trust || y.used - x.used) : [];
          if (!facts.length) continue;
          rows.push([`${title} · ${facts.length} fact${facts.length === 1 ? '' : 's'}`, tilde(dir)]);
          for (const f of facts.slice(0, 8)) rows.push([`  ${f.always ? 'always' : f.kind}${f.pinned ? ' · pinned' : ''}`, `${f.text.replace(/\s+/g, ' ').slice(0, 96)}${f.text.length > 96 ? '…' : ''}${f.always ? '' : `  (trust ${f.trust}, used ${f.used})`}`]);
          if (facts.length > 8) rows.push(['', `and ${facts.length - 8} more: /memory open shows them all in the browser`]);
        }
        // Claude's notes are not Agentic Coder's to change: only how many there are, and where.
        if (agent.memory.claude) {
          const c = notesCount(agent.memory.claude === true ? notesDir() : notesDir({ setting: agent.memory.claude }));
          if (c.dir) rows.push([`Claude's notes · ${c.used}`, `${tilde(c.dir)}  (read only; ${c.leftOut.length} about sign-ins, servers or secrets are left out)`]);
        }
        if (!rows.length) { push({ type: 'note', text: 'Nothing saved yet. After a task Agentic Coder shows what it would remember and asks; "/update memory" or "remember that …" saves at once.', tone: 'dim' }); break; }
        const last = [dirs.you, dirs.project].filter(Boolean).flatMap((d) => readLog(d)).filter((l) => l.what !== 'trust').sort((x, y) => String(y.at).localeCompare(String(x.at)))[0];
        rows.push([last ? `last change ${String(last.at).slice(0, 16).replace('T', ' ')}` : '', '/memory undo takes the last save back · /memory open shows it in the browser']);
        push({ type: 'panel', title: `Memory · ${agent.memory.embedder ? 'facts are found by meaning' : 'facts are found by their words (coding setup adds the small model)'}`, pad: 22, rows });
        break;
      }
      case 'rules': {
        // What the model reads at every start, numbered; short commands change it.
        if (!agent.memory) { push({ type: 'note', text: 'The memory is off here ("memory": false in settings.json), so there are no rules to show.', tone: 'dim' }); break; }
        const dirs = memoryDirs(cwd);
        const [what = '', ...rest] = arg.trim().split(/\s+/);
        if (/^open$/i.test(what)) {
          const hub = openHub('memory'); if (!hub) break;
          push({ type: 'note', text: `Memory opened in the browser at ${hub.url}`, tone: 'dim' });
          break;
        }
        if (what) {
          if (busy) { flash('Wait for Agentic Coder to finish first'); break; }
          const r = changeRules(dirs, what.toLowerCase(), rest.join(' '));
          if (r.changed) agent.refreshNotes();
          push({ type: 'note', text: r.text, tone: r.tone ?? 'dim' });
          break;
        }
        const list = rulesList(dirs);
        const plain = (f) => ({ n: f.n, text: f.text.replace(/\s+/g, ' '), event: looksLikeEvent(f.text) });
        const tilde = (p) => (p?.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);
        push({ type: 'rules', always: list.always.map(plain), other: list.other.map(plain), off: list.off.map(plain), tokens: list.tokens, max: ALWAYS_MAX, where: tilde(dirs.you) });
        break;
      }
      case 'helpers': {
        // The context helpers, numbered, on or off; "/helpers off 3" switches one.
        const [what = '', ...rest] = arg.trim().split(/\s+/);
        if (what) {
          if (busy) { flash('Wait for Agentic Coder to finish first'); break; }
          const r = changeHelpers(agent.helpers, what.toLowerCase(), rest.join(' '));
          if (r.changed) {
            agent.helpers = r.on;
            saveSettings({ helpers: [...r.on] });
            // The code search needs the small model, which the memory may not have started.
            if (r.on.has('rag') && !agent.embedder && embedderReady()) agent.embedder = new Embedder();
          }
          push({ type: 'note', text: r.text, tone: r.tone ?? 'dim' });
          break;
        }
        const set = helpersEnv();
        push({ type: 'panel', title: `Helpers · ${agent.helpers.size} of 4 on · what comes along with a request before the first step${set !== undefined ? ` · AGENTIC_HELPERS=${set} decides` : ''}`, pad: 35, rows: helperRows(agent.helpers, agent.lastHelpers ?? []) });
        break;
      }
      case 'init':
        if (busy) { flash('Wait for Agentic Coder to finish first'); break; }
        sendPrompt(INIT_PROMPT, '/init');
        break;
      case 'math': {
        // Alone: the topics of ~/Desktop/MATH. With a question: ask it with
        // the notes attached even when no topic word matches.
        const topics = mathTopics();
        if (!topics.length) { push({ type: 'note', text: 'No math notes found (~/Desktop/MATH is missing or has no .md files).', tone: 'warn' }); break; }
        if (!arg) { push({ type: 'panel', title: 'Math topics (~/Desktop/MATH)', pad: 28, rows: topics }); break; }
        if (busy) { flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        agent.mathForce = true;
        sendPrompt(arg, `/math ${arg}`);
        break;
      }
      case 'resume': {
        const list = listSessions(cwd);
        if (!list.length) { push({ type: 'note', text: 'No earlier conversations in this folder.', tone: 'dim' }); break; }
        setPicker({ title: 'Resume a conversation', index: 0, items: list.map((s) => ({ key: s.id, label: s.title, desc: `${new Date(s.updated).toLocaleString()} · ${s.turns} prompt${s.turns === 1 ? '' : 's'}` })) });
        break;
      }
      case 'model': {
        // The model list and the thinking level in one picker. The edited
        // copy, when one is saved, is one more row.
        const levels = model.thinkingLevels ?? [];
        const lvNow = thinkingLevel(model, agent.thinking, agent.effort);
        const edited = editedModel();
        const models = [...Object.values(MODELS), ...(edited ? [edited] : [])];
        setPicker({ kind: 'model', models, index: Math.max(0, models.findIndex((m) => m.id === model.id)), level: Math.max(0, levels.findIndex((l) => l.id === lvNow.id)) });
        break;
      }
      case 'increase': {
        // Every limit that can move, with what each value costs; ←→ moves, enter saves.
        // The memory Gemma holds now counts as free: a restart hands it back first.
        const freeBytes = availableBytes() + (serverRef.current?.port ? needBytes(model, agent.ctx, { draft: false }) : 0);
        setPicker({ kind: 'limits', index: 0, values: { ...limitsRef.current }, saved: { ...limitsRef.current }, model, env: { model, freeBytes, tps: stats.tps, pps: stats.pps, ctxNow: agent.ctx } });
        break;
      }
      case 'stats':
        push({ type: 'panel', title: 'Stats', pad: 20, rows: [
          ['model', `${model.name}${model.edited ? ` · ${model.edited.edits.length} edit${model.edited.edits.length === 1 ? '' : 's'} · saved ${new Date(model.edited.saved).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`],
          ['context used', `${(stats.ctxUsed ?? agent.ctxUsed).toLocaleString()} of ${agent.ctx.toLocaleString()} tokens`],
          ['writing speed', stats.tps ? `${stats.tps.toFixed(1)} tokens/s (last reply)` : '—'],
          ['reading speed', stats.pps ? `${Math.round(stats.pps)} tokens/s (last long read)` : '—'],
          ['written so far', `${(stats.outTokens ?? 0).toLocaleString()} tokens in ${stats.requests ?? 0} replies`],
          ['memory', `${ramGb ? `${ramGb.toFixed(1)} GB` : '—'}${memoryNote.current ? ` · ${memoryNote.current}` : ''}`],
          ['limits', `context ${showLimit('context', limitsRef.current.context)} · thinking cap ${showLimit('thinking', limitsRef.current.thinking)} · ${limitsRef.current.tries} tries · ${limitsRef.current.steps} steps · /increase moves them`],
          ['kept loaded', `${LINGER_SECS / 60} min after the last window quits · coding stop frees it now`],
          ['server', serverRef.current?.port ? `port ${serverRef.current.port} · restarts ${serverRef.current.restarts}` : opts.url ?? '—'],
        ] });
        break;
      case 'doctor':
        doctor();
        break;
      case 'tests': {
        // The hub on its Tests tab: the record every test run adds a line to.
        const hub = openHub('tests'); if (!hub) break;
        const runs = readRecord();
        push({ type: 'note', text: runs.length ? `Tests opened in the browser at ${hub.url} · ${runs.length} run${runs.length === 1 ? '' : 's'} recorded, the latest: ${runs[0].name} (${runs[0].total != null ? `${runs[0].passed} of ${runs[0].total}` : runs[0].result}) · it stays up while this window is open` : `Tests opened in the browser at ${hub.url} · no test has been recorded yet`, tone: 'dim' });
        break;
      }
      case 'weights':
      case 'docs': {
        // The hub in the browser: the same server as `coding weights` / `coding docs`,
        // inside this window. /weights opens it on the model's weights, /docs on
        // the harness diagram with structure and every page one tab away.
        const path = modelPath(model);
        if (cmd === 'weights' && !existsSync(path)) { push({ type: 'note', text: `The model file is not here yet (${path}). Run coding setup first.`, tone: 'warn' }); break; }
        const hub = openHub(cmd === 'docs' ? 'harness' : 'weights'); if (!hub) break;
        const w = hub.server; const url = hub.url;
        if (cmd === 'docs') {
          const d = listDocs(w.docsDir);
          push({ type: 'note', text: d.missing ? `Docs opened at ${url}, but the DOCS folder was not found (agentic-coder DOCS at the top of the repo; set AGENTIC_DOCS to point elsewhere)` : `Docs opened in the browser at ${url} · ${d.pages.length} pages from ${d.dir.replace(process.env.HOME, '~')}${d.pinned.harness ? ` · harness: ${d.pinned.harness.title}` : ''}${d.pinned.structure ? ` · structure: ${d.pinned.structure.title}` : ''} · it stays up while this window is open`, tone: d.missing ? 'warn' : 'dim' });
        } else push({ type: 'note', text: `Weights of ${w.name} (${(w.size / 1e9).toFixed(2)} GB) opened in the browser at ${url} · it stays up while this window is open`, tone: 'dim' });
        break;
      }
      case 'meters': {
        if (!arg.trim()) { openChoice('meters'); break; }
        applyChoice('meters', /^(on|show|yes)$/i.test(arg) ? 'on' : 'off');
        break;
      }
      case 'update':
        // /update memory [what]: save to memory now, like saying "update memory".
        if (/^memory\b/i.test(arg.trim())) { const what = arg.trim().replace(/^memory\b[\s:]*/i, ''); sendPrompt(what ? `update memory: ${what}` : 'update memory'); break; }
        await updateNow();
        break;
      case 'exit':
      case 'quit':
        await quit();
        break;
      default:
        push({ type: 'note', text: `Unknown command /${cmd}. Type /help for the list.`, tone: 'warn' });
    }
  }, [agent, askBtw, cwd, doctor, flash, meters, opts.url, push, quit, ramGb, sendPrompt, setMode, setThinking, stats, updateNow]);

  const submit = useCallback((raw) => {
    const value = raw.replace(/\s+$/, '');
    setInput({ value: '', cursor: 0 });
    setShowShortcuts(false);
    histIdx.current = null;
    if (!value.trim()) return;
    if (answerRef.current) {
      // The answer to Agentic Coder's question, shown like a message of yours.
      const resolve = answerRef.current;
      answerRef.current = null;
      setAnswerWait(false);
      push({ type: 'user', text: value });
      addHistory(cwd, value);
      historyRef.current.push(value);
      setPlaceholder(pick(PLACEHOLDERS));
      resolve({ choice: 'answer', text: value });
      return;
    }
    if (value.startsWith('/')) { runSlash(value); return; }
    if (value.startsWith('!')) { runShell(value.slice(1).trim()); return; }
    // "exit" or "quit" typed as a plain message quits, like /exit.
    if (isQuit(value)) { quit(); return; }
    addHistory(cwd, value);
    historyRef.current.push(value);
    if (agent.busy || S.current.starting) { queuedRef.current = value; setQueued(value); return; }
    sendPrompt(value);
  }, [agent, cwd, push, quit, runShell, runSlash, sendPrompt]);

  // Menu under the prompt: slash commands or @files.
  const inputMode = input.value.startsWith('!') ? 'bash' : 'prompt';
  let menu = null;
  const btwShown = Boolean(btw && !perm && !answerWait);
  if (!perm && !picker && !btwShown && input.value !== menuClosedFor) {
    const cmds = inputMode === 'prompt' ? matchCommands(input.value) : [];
    if (cmds.length) menu = { kind: 'slash', pad: 14, items: cmds.map((c) => ({ label: `/${c.name}`, desc: c.desc, value: c.name, takesArg: !!c.arg, picker: !!c.picker })) };
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
    setPopup(null); // a paste closes the /help box, like any key
    if (S.current.perm || S.current.picker || (S.current.btw && !S.current.answerWait)) return;
    setInput((s) => insertText(s, text.replace(/\r\n?/g, '\n')));
  });

  useInput((ch, key) => {
    const cur = S.current;
    // A window too small to show the screen takes no keys (enter could answer
    // a question you cannot see), except ctrl+c.
    if (cur.tooSmall && !(key.ctrl && ch === 'c')) return;
    // The start waits for another copy of the model to go: esc starts anyway.
    if (waitRef.current && key.escape) { waitRef.current.go(); return; }
    // The box in the middle (/help): esc, enter or ctrl+c close it; any other
    // key closes it and does what it always does, so typing goes on as usual.
    if (cur.popup) {
      setPopup(null);
      if (key.escape || key.return || (key.ctrl && ch === 'c')) return;
    }
    // Permission prompt
    if (cur.perm) {
      const p = cur.perm;
      const n = p.options.length;
      const choose = (i) => {
        const o = p.options[i];
        const choice = o.choice;
        setPerm(null);
        // Agentic Coder's question: a listed choice answers it; "type" takes the next line you enter.
        if (choice === 'type') { answerRef.current = p.resolve; setAnswerWait(true); setPlaceholder('Type your answer to Agentic Coder, then enter'); return; }
        if (choice === 'answer') { p.resolve({ choice, text: o.text }); return; }
        p.resolve({ choice });
        if (choice === 'no') setPlaceholder('Tell Agentic Coder what to do instead');
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
    // The /btw panel: its keys only, and the main job goes on. esc, enter,
    // space or ctrl+c close it (stopping an answer still being written).
    if (cur.btw && !cur.answerWait) {
      const b = cur.btw;
      if (key.escape || key.return || ch === ' ' || (key.ctrl && ch === 'c')) { closeBtw(); return; }
      const step = key.pageUp || key.pageDown ? 5 : 1;
      if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) {
        const L = btwLayout({ btw: b, width, rows: rows ?? 40 });
        const at = key.upArrow || key.pageUp ? L.offset - step : L.offset + step;
        setBtw((x) => (x && x.id === b.id ? { ...x, scroll: Math.min(L.maxOffset, Math.max(0, at)) } : x));
        return;
      }
      if (ch === 'c' && b.text && b.phase !== 'answering') {
        if (copyToClipboard(b.text)) flash(`copied the answer (${b.text.length.toLocaleString()} chars) to clipboard`, 2500);
        return;
      }
      if (ch === 'f' && b.phase === 'done') {
        pendingContext.current.push(sendToMain(b.question, b.text));
        closeBtw();
        push({ type: 'note', text: 'The side question and its answer go to Agentic Coder with your next message.', tone: 'dim' });
        return;
      }
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
        // A different model — or the same edited copy with newer edits saved
        // since — restarts the model server in place; the window stays.
        const changed = picked.id !== model.id || (picked.edited && model.edited && picked.edited.saved !== model.edited.saved);
        if (changed) { saveSettings({ model: picked.id }); switchModel(picked); }
        else push({ type: 'note', text: `${picked.name} · effort ${lv?.label.toLowerCase() ?? 'low'}.`, tone: 'dim' });
      }
      return;
    }
    // /increase: ↑↓ a limit, ←→ lower / raise it, enter saves (on the last row: every limit back to its default), esc keeps them
    if (cur.picker?.kind === 'limits') {
      const pk = cur.picker;
      const rows = LIMITS.length + 1;
      if (key.upArrow) setPicker({ ...pk, index: (pk.index + rows - 1) % rows });
      else if (key.downArrow || key.tab) setPicker({ ...pk, index: (pk.index + 1) % rows });
      else if ((key.leftArrow || key.rightArrow) && pk.index < LIMITS.length) setPicker({ ...pk, values: moveLimit(pk.values, LIMITS[pk.index].id, key.rightArrow ? 1 : -1, model) });
      else if (key.return) { setPicker(null); saveLimits(pk.index === LIMITS.length ? defaultLimits(model) : pk.values); }
      else if (key.escape || (key.ctrl && ch === 'c')) { setPicker(null); push({ type: 'note', text: 'Limits kept as they were.', tone: 'dim' }); }
      return;
    }
    // A choice menu (/effort, /mode, /meters): ↑↓ or a number, enter picks, esc goes back unchanged
    if (cur.picker?.kind === 'choice') {
      const pk = cur.picker;
      const n = pk.options.length;
      const pick = (i) => { setPicker(null); applyChoice(pk.id, pk.options[i].id); };
      if (key.upArrow) setPicker({ ...pk, index: (pk.index + n - 1) % n });
      else if (key.downArrow || key.tab) setPicker({ ...pk, index: (pk.index + 1) % n });
      else if (key.return) pick(pk.index);
      else if (/^[1-9]$/.test(ch) && Number(ch) <= n) pick(Number(ch) - 1);
      else if (key.escape || (key.ctrl && ch === 'c')) {
        setPicker(null);
        if (pk.id === 'memory-save') { applyChoice('memory-save', 'skip'); return; }
        const kept = pk.options.find((o) => o.id === pk.current);
        push({ type: 'note', text: `Kept ${pk.what} as ${kept ? kept.label.toLowerCase() : 'it was'}.`, tone: 'dim' });
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
      // An open menu or shortcut list closes first; the next esc stops Agentic Coder.
      if (menu) { setMenuClosedFor(cur.input.value); return; }
      if (showShortcuts) { setShowShortcuts(false); return; }
      if (selectedText(cur.input)) { setInput({ value: cur.input.value, cursor: cur.input.cursor }); return; } // drops the selection only
      if (agent.busy || cur.live.phase === 'working') { interrupt(); return; }
      if (cur.input.value) {
        if (Date.now() - escArmed.current < 1500) { setInput({ value: '', cursor: 0 }); return; }
        escArmed.current = Date.now();
        flash('Press esc again to clear', 1500);
      }
      return;
    }
    if (key.tab && key.shift) { const m = MODES[(MODES.indexOf(cur.mode) + 1) % MODES.length]; setMode(m); return; }
    if (key.ctrl && ch === 'o') {
      const s = folds.current;
      if (!s.list.length) { flash('Nothing to expand yet'); return; }
      if (s.back >= s.list.length) { flash('That was the first one'); return; }
      const f = s.list[s.list.length - 1 - s.back];
      s.back += 1;
      if (f.context) push({ type: 'context', ...f.context, open: true });
      else push({ type: 'expand', title: f.title, text: f.text });
      if (s.back < s.list.length) flash('ctrl+o again opens the one before', 2000);
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
          // a command that takes a word waits for it; one that opens a menu when alone (/effort) runs now
          if (it.takesArg && !it.picker && !/\s/.test(cur.input.value) && `/${it.value}` !== cur.input.value) { completeMenu(menu, menuIdx); return; }
          submit(`/${it.value}`);
          return;
        }
        completeMenu(menu, menuIdx);
        return;
      }
    }
    // History
    const pos = cursorLine(cur.input);
    if (key.upArrow && !key.shift && pos.line === 0) {
      const h = historyRef.current;
      if (!h.length) return;
      if (histIdx.current === null) { draftRef.current = cur.input.value; histIdx.current = h.length; }
      histIdx.current = Math.max(0, histIdx.current - 1);
      const v = h[histIdx.current];
      setInput({ value: v, cursor: v.length });
      return;
    }
    if (key.downArrow && !key.shift && pos.line === pos.lines - 1) {
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

  // Items added some other way (a resumed conversation, /clear) or a resize:
  // measure after the frame, then draw once more with the space right.
  useEffect(() => {
    let on = true;
    queueMicrotask(() => { try { if (on && primeRows(itemsRef.current, measure.current)) bumpRows((n) => n + 1); } catch {} });
    return () => { on = false; };
  }, [items, width]);
  // What primeRows needs to measure items as they are printed.
  measure.current = { width, modelName: model.name, cwdShort: short(cwd), loaded: opts.loaded ?? '' };
  itemsRef.current = items;
  // "/btw " typed: its argument's hint after the cursor, as in Claude Code.
  const hintFor = /^\/(\S+) $/.exec(input.value);
  const argHint = hintFor && input.cursor === input.value.length ? COMMANDS.find((c) => c.name === hintFor[1])?.arg ?? null : null;
  const app = {
    btw: btwShown ? btw : null, btwWaiting: Boolean(btw && !btwShown), argHint,
    items, live, perm, picker, popup, input, mode, width, rows: rows ?? 40, columns: columns ?? 100, tooSmall, redraw, cwd, cwdShort: short(cwd), loaded: opts.loaded ?? '',
    modelName: model.name, now, spinner: spinStyle((process.env.AGENTIC_SPINNER ?? process.env.BONSAI_SPINNER)), stats: { ...stats, ctxUsed: stats.ctxUsed ?? agent.ctxUsed }, ctx, ramGb, mac, meters, starting, startedAt, notice, queued, showShortcuts, placeholder,
    inputMode, menu: menu ? { ...menu, index: menuIdx } : null, waitingForYou: !!perm, thinking,
    thinkingLabel: thinkingLevel(model, thinking, effort).label.toLowerCase(), thinkingLevels: model.thinkingLevels ?? [], startPhase, waiting,
    // The weights badge, lower right: edited weights saved and waiting, in
    // use, or newer ones saved than the copy loaded now.
    updateBadge: updateText(update),
    weightsBadge: model.edited
      ? (editedSaved && editedSaved.saved !== model.edited.saved ? '✱ newer edits saved · /model to reload'
        : `✱ on edited weights (${model.edited.edits.length} edit${model.edited.edits.length === 1 ? '' : 's'})`)
      : (editedSaved ? '✱ edited weights ready · /model to switch' : null),
  };
  return <Screen app={app} />;
}
