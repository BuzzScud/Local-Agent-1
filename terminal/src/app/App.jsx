// Agentic Coder's terminal app: starts the model, runs the agent, and turns
// its events into the screen; handles the prompt box, permission prompts,
// slash commands, layouts, sessions and keys.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, useInput, usePaste, useStdin, useWindowSize } from 'ink';
import { join } from 'node:path';
import { existsSync, statSync, writeSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Screen, permissionOptions, primeRows, heldRows, MENU_ROWS, shortcutRows, footerParts } from './screen.jsx';
import { startTip, START_MIN, START_BIG } from './start.jsx';
import { loadTimes, startLeft, typicalStart } from './start-times.mjs';
import { MIN_COLS, MIN_ROWS } from './window.mjs';
import { Agent } from '../agent/agent.mjs';
import { helpersFrom } from './helpers.mjs';
import { hooksFrom, leanFrom } from '../agent/way.mjs';
import { UserHooks } from '../agent/user-hooks.mjs';
import { systemPrompt, projectNotes, gitSummary, SESSION_MARK, notesRoom } from '../agent/prompt.mjs';
import { offerFor } from '../agent/permissions.mjs';
import { warmUp, MODELS, DEFAULT_MODEL, thinkingLevel, readEditedAll, modelById, Embedder, embedderReady, HOME, remoteLabel, remoteModel, withVision, visionPath, authHeaders } from '../../../models/index.mjs';
import { spendEvents, spendLabel, windowSpend } from '../agent/spend.mjs';
import { webSettings } from './web-form.mjs';
import { walk } from '../tools/fs.mjs';
import { mentionAt, selectedText } from './edit-input.mjs';
import { MOUSE_ON, MOUSE_OFF, isMouseText } from './mouse.mjs';
import { copyToClipboard } from './clipboard.mjs';
import { matchCommands, COMMANDS } from './commands.mjs';
import { openMemory } from '../agent/facts.mjs';
import { claudeOn } from '../agent/claude-notes.mjs';
import { CLAUDE_RULES } from '../agent/claude-rules.mjs';
import { AutoSave, memoryOn, sinceLastTime, saveModeOf } from './autosave.mjs';
import { loadSettings, saveSettings, loadSession, newSessionId, loadHistory, firstMode, keepsLastMode } from './store.mjs';
import { readRecord as sessionRecord } from './sessions.mjs';
import { runReader } from './loops-board.mjs';
import { drawBoard as drawLoops } from './loops-draw.mjs';
import { Rewind, pruneRewind } from './rewind.mjs';
import { rulesFor } from './perm-store.mjs';
import { openMcp } from './mcp-start.mjs';
import { openInBrowser } from './mcp-auth.mjs';
import { modeWord } from './perms.mjs';
import { spinStyle } from '../ui/theme.mjs';
import { watchUpdates, updateText } from './update.mjs';
import { readLimits, modelWithLimits, applyLimits, applySearch } from './limits.mjs';
import { agentsLine } from './agents-tree.mjs';
import { IDLE, PLACEHOLDERS, liveView, pick, short } from './app-common.mjs';
import { modelPart } from './app-model.mjs';
import { remotePart } from './app-remote.mjs';
import { panelsPart } from './app-panels.mjs';
import { runPart } from './app-run.mjs';
import { slashPart } from './app-slash.mjs';
import { keysPart } from './app-keys.mjs';
export { remoteConfOf } from './app-common.mjs';
let seq = 0;

export function App({ opts, win, onRestart }) {
  // The App's names the functions in its parts use (app-model.mjs and the others beside this file), read at
  // the moment a function uses them, from this render (app-common.mjs liveView).
  const self = liveView({
    MCP_EXTRAS: () => MCP_EXTRAS, S: () => S, abortRef: () => abortRef, agent: () => agent, agentRef: () => agentRef,
    agentsKey: () => agentsKey, agentsRef: () => agentsRef, agentsSize: () => agentsSize, aliveRef: () => aliveRef,
    answerRef: () => answerRef, applyChoice: () => applyChoice, applyKeep: () => applyKeep,
    applyRewind: () => applyRewind, arrowsRef: () => arrowsRef, askBtw: () => askBtw, askCopyBack: () => askCopyBack,
    askedAtOpen: () => askedAtOpen, autoRef: () => autoRef, battleRef: () => battleRef, btwRef: () => btwRef,
    bumpLists: () => bumpLists, busyNow: () => busyNow, catalog: () => catalog, chatOnlyRef: () => chatOnlyRef,
    chooseRewind: () => chooseRewind, closeBtw: () => closeBtw, columns: () => columns, connectForm: () => connectForm,
    copyAsk: () => copyAsk, copyRef: () => copyRef, cwd: () => cwd, doPutBack: () => doPutBack, doctor: () => doctor,
    draftRef: () => draftRef, effort: () => effort, escArmed: () => escArmed, exit: () => exit,
    exitArmed: () => exitArmed, fillSuggested: () => fillSuggested, flash: () => flash, fold: () => fold,
    folds: () => folds, footerRef: () => footerRef, heldNotes: () => heldNotes, histIdx: () => histIdx,
    historyRef: () => historyRef, holdRef: () => holdRef, hooksKeys: () => hooksKeys, hooksList: () => hooksList,
    input: () => input, interrupt: () => interrupt, items: () => items, itemsRef: () => itemsRef,
    jobWakeRef: () => jobWakeRef, jumpBoxKey: () => jumpBoxKey, jumpTo: () => jumpTo, lastCheck: () => lastCheck,
    limitsRef: () => limitsRef, loadFnRef: () => loadFnRef, loadRef: () => loadRef, loadSubagent: () => loadSubagent,
    loadedOnce: () => loadedOnce, loadsAtOpen: () => loadsAtOpen, localModelRef: () => localModelRef,
    loopsBadgeOf: () => loopsBadgeOf, loopsKey: () => loopsKey, loopsOf: () => loopsOf, loopsRef: () => loopsRef,
    loopsSeen: () => loopsSeen, loopsSegsKey: () => loopsSegsKey, loopsSize: () => loopsSize, loopsUi: () => loopsUi,
    macRef: () => macRef, mcpHub: () => mcpHub, mcpKeys: () => mcpKeys, mcpLists: () => mcpLists, mcpRef: () => mcpRef,
    mcpSigning: () => mcpSigning, mcpTests: () => mcpTests, measure: () => measure,
    memoryForRestart: () => memoryForRestart, memoryNote: () => memoryNote, menu: () => menu, menuIdx: () => menuIdx,
    model: () => model, modelOff: () => modelOff, modelOffNow: () => modelOffNow, mouse: () => mouse,
    mouseRef: () => mouseRef, noteModels: () => noteModels, onRestart: () => onRestart, onService: () => onService,
    openAgentsTree: () => openAgentsTree, openChoice: () => openChoice, openEffortLimits: () => openEffortLimits,
    openHub: () => openHub, openJumpBox: () => openJumpBox, openLoops: () => openLoops,
    openMcpPicker: () => openMcpPicker, openModelPicker: () => openModelPicker, openOwnSettings: () => openOwnSettings,
    openPermissions: () => openPermissions, openRemoteForm: () => openRemoteForm, openRewind: () => openRewind,
    openSettings: () => openSettings, openSubagentsPanel: () => openSubagentsPanel, openWebPicker: () => openWebPicker,
    opts: () => opts, othersRef: () => othersRef, pageRef: () => pageRef, pastedRef: () => pastedRef,
    pendingContext: () => pendingContext, pendingSaveRef: () => pendingSaveRef, pickHere: () => pickHere,
    pickLevel: () => pickLevel, pickLevels: () => pickLevels, pre: () => pre, preloadRemote: () => preloadRemote,
    psConn: () => psConn, psRef: () => psRef, push: () => push, queuedRef: () => queuedRef, quit: () => quit,
    railOn: () => railOn, ramGb: () => ramGb, recentRef: () => recentRef, redrawMac: () => redrawMac,
    redrawPs: () => redrawPs, refreshCatalog: () => refreshCatalog, relimit: () => relimit,
    remoteAtStart: () => remoteAtStart, remoteFnRef: () => remoteFnRef, remoteRef: () => remoteRef,
    remoteTo: () => remoteTo, remoteWord: () => remoteWord, renewRef: () => renewRef, restartRef: () => restartRef,
    resumeSession: () => resumeSession, rewindArmed: () => rewindArmed, rewindRef: () => rewindRef, rows: () => rows,
    runShell: () => runShell, runSlash: () => runSlash, runWebTest: () => runWebTest,
    saveEffortLimits: () => saveEffortLimits, saveNow: () => saveNow, saveOnlyForm: () => saveOnlyForm,
    saveOwnLevel: () => saveOwnLevel, saveOwnSettings: () => saveOwnSettings, saveSubagents: () => saveSubagents,
    saveWeb: () => saveWeb, savedAskRef: () => savedAskRef, sayEffort: () => sayEffort,
    seeingModels: () => seeingModels, sendPrompt: () => sendPrompt, seq: () => seq, serverRef: () => serverRef,
    serviceCtx: () => serviceCtx, serviceOf: () => serviceOf, sessionRef: () => sessionRef,
    sessionTokens: () => sessionTokens, setAgentsState: () => setAgentsState, setAgentsView: () => setAgentsView,
    setAnswerWait: () => setAnswerWait, setBattle: () => setBattle, setBtw: () => setBtw, setCatalog: () => setCatalog,
    setCtx: () => setCtx, setCwd: () => setCwd, setEditedSaved: () => setEditedSaved,
    setEffortState: () => setEffortState, setInCopy: () => setInCopy, setInput: () => setInput,
    setItems: () => setItems, setLeaving: () => setLeaving, setLive: () => setLive, setLoopsBadge: () => setLoopsBadge,
    setLoopsOn: () => setLoopsOn, setLoopsSegs: () => setLoopsSegs, setLoopsTick: () => setLoopsTick,
    setMenuClosedFor: () => setMenuClosedFor, setMenuIndex: () => setMenuIndex, setMeters: () => setMeters,
    setMode: () => setMode, setModeState: () => setModeState, setModel: () => setModel, setModelOff: () => setModelOff,
    setMouse: () => setMouse, setNotice: () => setNotice, setOwn: () => setOwn, setPerm: () => setPerm,
    setPicker: () => setPicker, setPlaceholder: () => setPlaceholder, setPopup: () => setPopup,
    setQueued: () => setQueued, setRamGb: () => setRamGb, setRemoteState: () => setRemoteState,
    setServiceCtx: () => setServiceCtx, setShowShortcuts: () => setShowShortcuts, setStartPhase: () => setStartPhase,
    setStartTook: () => setStartTook, setStartedAt: () => setStartedAt, setStarting: () => setStarting,
    setStats: () => setStats, setThinking: () => setThinking, setThinkingState: () => setThinkingState,
    setTip: () => setTip, setWaiting: () => setWaiting, setWheelPause: () => setWheelPause, settings: () => settings,
    sharedRef: () => sharedRef, sharedValues: () => sharedValues, showShortcuts: () => showShortcuts,
    sideMemo: () => sideMemo, signinOpen: () => signinOpen, start: () => start, startAgents: () => startAgents,
    startClicks: () => startClicks, startCopy: () => startCopy, startFnRef: () => startFnRef, starting: () => starting,
    stats: () => stats, stopFnRef: () => stopFnRef, submit: () => submit, switchBackRef: () => switchBackRef,
    switchModel: () => switchModel, switchService: () => switchService, thinking: () => thinking,
    timeDone: () => timeDone, timeLoad: () => timeLoad, timeLoaded: () => timeLoaded, timeWarmed: () => timeWarmed,
    timesRef: () => timesRef, timing: () => timing, toggleArmed: () => toggleArmed, toggleFnRef: () => toggleFnRef,
    tty: () => tty, turnSpend: () => turnSpend, update: () => update, updateNow: () => updateNow,
    updateRef: () => updateRef, useLocal: () => useLocal, useRemote: () => useRemote,
    visionWaitRef: () => visionWaitRef, waitForBattle: () => waitForBattle, waitForOthers: () => waitForOthers,
    waitRef: () => waitRef, wantRef: () => wantRef, weightsRef: () => weightsRef, width: () => width, win: () => win,
  }, { seq: (v) => { seq = v; } });
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
  // /remote on (and no --url or --local): the model on another machine. Until
  // it answers, `model` is a stand-in named after it.
  const remoteAtStart = !opts.url && !opts.local && Boolean(settings.remote?.use);
  // The model on this Mac loads when you type /start, not as the window opens (the user's pick,
  // 30 Sep 2026), so a window you only look around in takes none of the Mac's memory.
  // /autostart on (settings.json "modelAtStart"), --start or AGENTIC_MODEL_AT_START=on load it at once.
  // wantRef: this window wants the model loaded (/start sets it, /stop clears it).
  const wantRef = useRef(null);
  const envAtStart = process.env.AGENTIC_MODEL_AT_START; // on or off: wins over /autostart (the tests set it)
  const loadsAtOpen = () => Boolean(opts.load) || (envAtStart ? /^(on|1|true|yes)$/i.test(envAtStart) : settings.modelAtStart === true);
  wantRef.current ??= !opts.url && !remoteAtStart && loadsAtOpen();
  // The model on this Mac is off: nothing loaded, nothing loading (the start page, the footer and /stats say so).
  const [modelOff, setModelOff] = useState(!opts.url && !remoteAtStart && !wantRef.current);
  // Nothing to talk to: the model on this Mac is off (no --url server, no remote in use).
  const modelOffNow = () => !wantRef.current && !opts.url && !remoteRef.current?.on;
  const aliveRef = useRef(true); // false once the window has closed
  const loadRef = useRef(0); // bumped by every load, switch and /stop: only the newest one goes on
  // The model can change while the window is open (/model switches to the
  // edited copy and back), so it is state; the last pick is kept in settings.
  const [model, setModel] = useState(() => (remoteAtStart ? remoteModel(settings.remote) : modelById(opts.modelId) ?? modelById(settings.model) ?? MODELS[DEFAULT_MODEL]));
  // The limits /effort moves (limits.mjs), kept in settings.json. `model`
  // stays the registry's; the agent and the server get it with the thinking cap.
  const limitsRef = useRef(null);
  limitsRef.current ??= readLimits(settings, model);
  // --way starts this window that way; the /effort panel shows it (and a save there keeps it).
  if (opts.way && !limitsRef.wayGiven) { limitsRef.wayGiven = true; limitsRef.current = { ...limitsRef.current, way: opts.way }; }
  // What the Weights tab has saved (each model's edited copy, by model): feeds
  // the weights badge in the lower right.
  const [editedSaved, setEditedSaved] = useState(readEditedAll);
  // New Agentic Coder code on main since this start: the "Update available" badge,
  // and /update, which restarts this window on it.
  const [update, setUpdate] = useState(null);
  const updateRef = useRef(null);
  const jobWakeRef = useRef(null); // wakes the model for a background job that ended (set below)
  const userHooksRef = useRef(undefined); // your own hooks (user-hooks.mjs), made with the agent
  const hookNoteRef = useRef(null); // a hook that failed or stopped something, said on the screen
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
  // /agents (agents-run.mjs): the run, its state as last drawn, and where it shows: 'tree' (the
  // whole window), 'chat' (one live line above the prompt box) or null (not open).
  const agentsRef = useRef(null);
  const [agentsState, setAgentsState] = useState(null);
  const [agentsView, setAgentsView] = useState(null);
  const [agentsNow, setAgentsNow] = useState(() => Date.now());
  const agentsSize = useRef(null); // the window's size before /agents grew it
  // /loops: the loop board as this window's own screen (loops-board.mjs keys, loops-draw.mjs rows),
  // shown over the chat while loopsOn; loopsTick draws it again (its spinners, a key pressed).
  const [loopsOn, setLoopsOn] = useState(false);
  const [, setLoopsTick] = useState(0);
  const loopsUi = useRef(null);
  const loopsSize = useRef(null); // the window's size before /loops grew it
  const { pickLevels, pickLevel, waitForBattle, waitForOthers, modelKey, timeLoad, timeLoaded, timeWarmed, timeDone, listOtherWindows, pushFn, fold, flashFn, setModeFn, openHub, switchModel, openChoice, startCopy, askCopyBack, doPutBack, relimit, applyKeep, saveOwnLevel, setOwn } = modelPart(self);
  const [input, setInput] = useState({ value: '', cursor: 0 });
  const [menuIndex, setMenuIndex] = useState(0);
  const startedIn = useRef(firstMode(opts.mode, settings)).current;
  const [mode, setModeState] = useState(startedIn.mode);
  const [thinking, setThinkingState] = useState(opts.thinking ?? settings.thinking ?? model.thinkingDefault ?? true);
  const [effort, setEffortState] = useState(opts.effort ?? settings.effort ?? model.thinkingEffort);
  const [startPhase, setStartPhase] = useState('loading');
  // Another copy of the model already loaded (a practice-test run, a speed
  // test): the start says who has it and waits for it to go; esc starts anyway
  // (the user's pick, 28 Sep). `waiting` is the line on the start screen.
  const [waiting, setWaiting] = useState(null);
  const waitRef = useRef(null);
  // A run in the Arena (the hub's Arena tab: a battle, or a test on one model) holds the memory: only one model fits, so the
  // start waits until it is over and says so. `battle` is the line on the screen.
  const [battle, setBattle] = useState(null);
  const [stats, setStats] = useState({});
  const [ctx, setCtx] = useState(opts.ctx ?? 32768);
  const [starting, setStarting] = useState(!opts.url && !modelOff);
  // When the window opened, and then when the model last began to load (the "Starting …" seconds).
  const [startedAt, setStartedAt] = useState(Date.now());
  // The start's timed parts (start-times.mjs) for the start page's "about N s left" and "started
  // in N s": loading the model (when a new server starts), then reading or restoring its
  // instructions. timing is null until a start begins loading (not while it waits for memory).
  const timing = useRef(null);
  const timesRef = useRef(null);
  if (timesRef.current == null) timesRef.current = loadTimes();
  const [startTook, setStartTook] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState(null);
  const [queued, setQueued] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [popup, setPopup] = useState(null); // a box in the middle of the window (/help); any key closes it
  const [placeholder, setPlaceholder] = useState(pick(PLACEHOLDERS));
  // The start page (start.jsx): the tip under the prompt box until your first message, the
  // conversations it lists, and whether it is still held live (until your first message, so it
  // follows the model on this Mac: off, loading after /start, ready).
  const [tip, setTip] = useState(() => startTip(opts.start));
  const recentRef = useRef(opts.start?.recent ?? []);
  const holdRef = useRef(!opts.url && !remoteAtStart);
  // The start page's room as it was last shown held ({ room, rows }), kept for its printed copy.
  const pageRoomRef = useRef(null);
  // Quitting or restarting: the terminal's cursor leaves the prompt box for the
  // line under it, so what is printed after the app goes there, not into the box.
  const [leaving, setLeaving] = useState(false);
  const [ramGb, setRamGb] = useState(null);
  const [meters, setMeters] = useState(Boolean(settings.meters)); // the status bar under the prompt (off, like Claude Code)
  const [mouse, setMouse] = useState(settings.mouse !== false); // /mouse: drag to highlight in the prompt box, on unless turned off (off: the mouse stays Terminal's)
  const [wheelPause, setWheelPause] = useState(false); // a scroll just came in: the mouse is Terminal's for a moment
  // /btw: a side question and its answer, in a panel in the prompt box's place
  // (Claude Code's /btw); gone when closed. The main job's own question wins
  // the place while one is open: answerWait is "type your answer" to it.
  const [btw, setBtw] = useState(null);
  const btwRef = useRef(null);
  // By service, for the session: whether its lowest model loaded when tried (btw.mjs sideChoice).
  const sideMemo = useRef({});
  const [answerWait, setAnswerWait] = useState(false);

  // Each new item is measured before it is shown (see primeRows), so the
  // space above the prompt box is right on the first frame; measured just
  // after the current step, never inside a render or an effect (a second
  // Ink render in there breaks the first one's layout).
  // A turn under way: what it prints are steps on the rail (rail.jsx). What came along with the
  // request (the notes, the design cards, how it was sorted) is held until the turn's first step,
  // then printed as one line; the turn's last layout check is kept for its end line.
  const railOn = useRef(false);
  // The cost meter (/remote, spend.mjs): the footer's words, after each answer and every 15 s
  // (today's total counts the other windows too); turnSpend: the window's dollars as a request began.
  const turnSpend = useRef(0);
  // Every token the model wrote since the window opened: the spinner line and each end line
  // say it (the owner's pick, 4 Oct 2026: "add the total tokens … i cant see it").
  const sessionTokens = useRef(0);
  const [spend, setSpend] = useState('');
  useEffect(() => {
    const show = () => setSpend(spendLabel());
    spendEvents.on('change', show);
    const t = setInterval(() => { if (windowSpend().requests) show(); }, 15_000);
    t.unref?.();
    return () => { spendEvents.off('change', show); clearInterval(t); };
  }, []);
  // Several windows in one project (copies.mjs): this window's own copy (null: the folder itself),
  // the other windows found there as it opened, and the changes last asked about.
  const copyRef = useRef(null);
  const [inCopy, setInCopy] = useState(false);
  const othersRef = useRef([]);
  const copyAsk = useRef({ key: null, changes: [], conflicts: [] });
  useEffect(listOtherWindows, []);
  const pre = useRef(null);
  const lastCheck = useRef(null);
  // The app's small notes (fold: "Reminded it of your request", "Looking first…") are held and go out
  // as one line before the next item, not a line each (4 Oct 2026, the owner's pick: fewer lines in a
  // long turn). A printed line cannot change, so they are joined before they print.
  const heldNotes = useRef([]);
  const push = useCallback(pushFn, []);
  const serverRef = useRef(null);
  const restartRef = useRef(null);
  // The remote in use (/remote): its connection ({ url, stop, … } from
  // connectRemote), why it last failed, and the model on this Mac to go back to.
  const remoteRef = useRef({ conn: null, why: null, on: remoteAtStart });
  // This Mac's name while a window on another Mac shows this one (sharedOn below), else null.
  const sharedRef = useRef(null);
  // The service Save only just kept, for its "Connect now?" question: { source, label, again }.
  const savedAskRef = useRef(null);
  const localModelRef = useRef(null);
  const remoteFnRef = useRef({});
  // The remote as the footer tells it (connecting · on · loading: a model loading on the service ·
  // reconnecting · down), and an Ollama service's list of models for /model (ollama.mjs), read
  // after it connects and again as /model opens. chatOnlyRef: a model without tools waiting for a yes.
  const [remoteState, setRemoteState] = useState(remoteAtStart ? 'connecting' : null);
  const [catalog, setCatalog] = useState(null);
  const chatOnlyRef = useRef(null);
  // Pictures pasted with ctrl+v ([Image #n] → its file), and a message waiting while vision turns on.
  const pastedRef = useRef({ n: 0, files: new Map() });
  const visionWaitRef = useRef(null);
  // A model that cannot look at pictures (K2 Horizon) handed one message to a
  // model that can: the one to load again once that reply is over.
  const switchBackRef = useRef(null);
  const abortRef = useRef(null);
  const historyRef = useRef(loadHistory(cwd));
  const histIdx = useRef(null);
  const draftRef = useRef('');
  const pendingContext = useRef([]);
  // What ctrl+o can open, newest last: a thought, a tool's full output, what
  // came along with a request. ctrl+o opens the newest; pressed again, the one
  // before it, so a line further up that says "ctrl+o to expand" can be reached.
  const folds = useRef({ list: [], back: 0 });
  const exitArmed = useRef(0);
  const escArmed = useRef(0);
  const rewindArmed = useRef(0);
  const sessionRef = useRef({ id: newSessionId(), title: null, items: [] });
  const filesRef = useRef(null);
  const queuedRef = useRef(null);
  const answerRef = useRef(null); // resolves Agentic Coder's question with what you type next

  // /rewind (rewind.mjs): copies of the folder around each message and
  // command, in AGENTIC_HOME/rewind. AGENTIC_REWIND=off leaves them out.
  const rewindRef = useRef(undefined);
  if (rewindRef.current === undefined) rewindRef.current = process.env.AGENTIC_REWIND === 'off' ? null : new Rewind({ home: HOME, session: sessionRef.current.id });

  // The agent lives for the whole session, and so does the hub of your MCP servers (/mcp):
  // they start now, in the background, so their tools are there for the first message.
  const agentRef = useRef(null);
  const mcpRef = useRef(undefined);
  if (mcpRef.current === undefined) { try { mcpRef.current = openMcp(cwd); } catch { mcpRef.current = null; } }
  if (!agentRef.current) {
    // The memory: your two rules and an older notes file are carried in at
    // the first start; the small model that finds the facts is started with
    // the first request that needs it.
    const remembers = memoryOn(settings);
    if (remembers) { try { openMemory(cwd, { rules: claudeOn(settings) ? CLAUDE_RULES : null }); } catch {} }
    const notesChars = limitsRef.current.rulesRoom || notesRoom(ctx);
    const notes = projectNotes(cwd, notesChars, { memory: remembers });
    // The context helpers (agent/helpers.mjs): all on unless /helpers (in
    // settings.json) or AGENTIC_HELPERS says otherwise. The small model that
    // compares meanings serves both the memory and the code search.
    const helpers = helpersFrom(settings);
    // /effort's Embedder row Off: none, and every search goes by words.
    const embedder = (remembers || helpers.has('rag')) && embedderReady() && limitsRef.current.embedder !== 'off' ? new Embedder() : null;
    // Your own hooks (user-hooks.mjs, /hooks): yours and, once you say yes, the project's. AGENTIC_USER_HOOKS=off: none.
    if (userHooksRef.current === undefined) userHooksRef.current = process.env.AGENTIC_USER_HOOKS === 'off' ? null : new UserHooks({ cwd, onNote: (text, tone) => hookNoteRef.current?.(text, tone) });
    agentRef.current = new Agent({
      userHooks: userHooksRef.current,
      // "claudeNotes": false in settings.json leaves Claude's notes out; a path names another folder.
      // saveOff: "memorySave": "off" — the model's Remember saves nothing either (agent/way.mjs).
      memory: remembers ? { embedder, claude: claudeOn(settings) ? settings.claudeNotes ?? true : false, saveOff: saveModeOf(settings) === 'off' } : null,
      // Who decides (/effort's last row) and the app's checks switched on for when the model does (/hooks).
      way: limitsRef.current.way, hooks: hooksFrom(settings), lean: leanFrom(settings),
      // The web (/web): a search service and reading pages, each asked about first.
      web: webSettings(settings.web),
      // Helpers the model can hand work to (the Agent tool), unless "subagents": false.
      subagents: settings.subagents !== false,
      // Your MCP servers' tools (/mcp), each asked about before its first use.
      mcp: mcpRef.current?.hub ?? null,
      // The same small model ranks the files Read first gives (rank.mjs), with the memory on or off.
      helpers, embedder, ranker: embedder, rewind: rewindRef.current,
      // The design examples and the layout check (/design), as saved.
      design: settings.design,
      // A page asked for "on my desktop" opens in the browser at the end of the turn, and one
      // saved elsewhere is offered to be copied there (agent.mjs deliverDesktop): the app does
      // it, as the model cannot start apps. AGENTIC_OPEN=off (the tests) leaves both out.
      openPage: process.env.AGENTIC_OPEN === 'off' ? null : (page) => { spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [page], { stdio: 'ignore', timeout: 10_000 }); },
      // You are here to look: a page saved for a request stops the turn and asks first (/design ask).
      pageAsk: true,
      url: opts.url ?? 'http://127.0.0.1:0', model: modelWithLimits(model, limitsRef.current), cwd,
      // a server given with --url and --slots 2 has a side slot for the save and the sorting
      ...(opts.url && opts.slots > 1 ? { slots: { main: 0, side: 1 } } : {}),
      system: systemPrompt({ cwd, notes: notes.text, git: gitSummary(cwd) }),
      thinking, effort, ctx, mode, flows: opts.flows !== false,
      // What you saved with /permissions, read for the folder it works in at every command.
      permissions: (dir) => rulesFor(dir),
      ask: (req) => new Promise((resolve) => {
        // "Don't ask again" and "always allow" remember the first part of the command nothing covers yet.
        const a = agentRef.current;
        const saved = a?.savedRules();
        const offer = req.name === 'Bash' && !req.once ? offerFor(req.args.command, { saved: saved?.allow, session: a?.allowedPrefixes, protect: saved?.protect }) : req.rule ? { rule: req.rule } : null;
        setPerm({ req, selected: 0, options: permissionOptions(req, offer?.rule ?? null, saved?.broken ? null : offer?.rule ?? null), resolve, offer });
      }),
      // A remote that stopped answering is connected again (a new tunnel, say); if it cannot be, the reply stops and you are asked.
      waitForServer: async () => { if (remoteRef.current.on) await remoteFnRef.current.reconnect(); else if (restartRef.current) await restartRef.current; else if (serverRef.current) await serverRef.current.restart(); },
      // A conversation that starts over from its notes: the instructions come
      // back from their saved reading (a server Agentic Coder started itself).
      rewarm: async (signal) => {
        const a = agentRef.current;
        if (!serverRef.current || !a?.warmed || a.slots?.main === undefined) return;
        await warmUp({ sessionMark: SESSION_MARK, url: a.url, model: a.model, system: a.messages[0].content, tools: a.tools(), thinking: a.thinking, effort: a.effort, slot: a.slots.main, helper: serverRef.current.draft, signal });
      },
    });
    agentRef.current.notesRoomUsed = notesChars; // what the system prompt above was built with
    // /remote's Clean up at: it holds only while the model is on another machine (agent.mjs cleanCap).
    agentRef.current.workRoom = Number(settings.remoteCleanAt) || 0;
    applyLimits(agentRef.current, limitsRef.current);
    // /effort's Search rows: the retriever, and the reranker when it is on (started at its first use).
    applySearch(agentRef.current, limitsRef.current);
  }
  const agent = agentRef.current;
  const mcpHub = mcpRef.current?.hub ?? null;
  // Saving on its own (autosave.mjs): a little after a task, and on quit.
  const autoRef = useRef(null);
  // Before a save, the facts are listed and a Save / Skip menu opens (the
  // default, "memorySave": "ask"); "auto" in settings.json saves unasked.
  const pendingSaveRef = useRef(null);
  const askRef = useRef(null);
  const saveMode = saveModeOf(settings); // ask · auto · off (off: nothing is saved on its own)
  autoRef.current ??= new AutoSave({ agent, ask: saveMode === 'ask' ? (p) => askRef.current(p) : null, say: (text) => push({ type: 'note', text, tone: 'dim' }), sessionsDir: join(HOME, 'sessions', cwd.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-100) || 'root') });

  // Everything the key handler needs, always current.
  const S = useRef({});
  S.current = { input, perm, picker, popup, menuIndex, mode, starting, live, queued, tooSmall, meters, mouse, btw, answerWait, remoteState, agentsView, agentsState, loopsOn, model, catalog };
  const flash = useCallback(flashFn, []);
  // Text selected in the prompt (shift + arrows) is copied as soon as the
  // selection settles, like Claude Code's copy on select. Not the whole of it
  // selected by a key (⌥A): that is for deleting it or pasting over it.
  const copiedRef = useRef('');
  useEffect(() => {
    const text = selectedText(input);
    if (!text || input.all) { copiedRef.current = ''; return undefined; }
    const t = setTimeout(() => {
      if (text === copiedRef.current) return;
      copiedRef.current = text;
      if (copyToClipboard(text)) flash(`copied ${text.length.toLocaleString()} char${text.length === 1 ? '' : 's'} to clipboard`, 2500);
    }, 250);
    return () => clearTimeout(t);
  }, [input, flash]);
  const setMode = useCallback(setModeFn, [agent]);
  // The mode the window is left in is the next window's (store.mjs firstMode): kept in settings.json
  // as it changes, so a quit, a closed window or /update's restart all keep it.
  const keptMode = useRef(settings.lastMode ?? null);
  useEffect(() => {
    if (!keepsLastMode() || mode === keptMode.current) return;
    keptMode.current = mode;
    try { saveSettings({ lastMode: mode }); } catch { /* kept for this window only */ }
  }, [mode]);
  // Started in the mode the last window was left in: said once, so Bypass is never a surprise.
  useEffect(() => {
    if (startedIn.from === 'last' && startedIn.mode !== 'ask') push({ type: 'note', text: `Started in ${modeWord(startedIn.mode)}, as the last window left it · shift+tab changes it`, tone: startedIn.mode === 'bypass' ? 'warn' : 'dim' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { useRemote, useLocal, reconnect, openRemoteForm, busyNow, loopsBadgeOf, loopsOf, tickLoops, connectForm, remoteWord, saveOnlyForm, jumpTo, openJumpBox, jumpBoxKey, remoteTo, refreshCatalog, serviceCtx, onService, setServiceCtx, usedHere, noteModels, preloadRemote, switchService, openModelPicker } = remotePart(self);

  // Loops (/loop, loops.mjs): made in this window and ended with it. Each run is a process of its
  // own; the board (/loops) is this window's own screen, and a line above the prompt keeps them in sight.
  const loopsRef = useRef(null);
  const loopsSeen = useRef({ asked: new Set(), ended: new Set() });
  const [loopsBadge, setLoopsBadge] = useState(null);
  const [loopsSegs, setLoopsSegs] = useState(null);
  const loopsSegsKey = useRef('');
  const loopsLines = useRef(null);
  useEffect(tickLoops, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The window closes: what it used on the service is let go, unless another window uses it. The
  // process is ending, so it is one curl the window waits for (at most 2 seconds), with the key on
  // its stdin, never on its command line.
  remoteFnRef.current.unloadOnQuit = () => {
    const conn = remoteRef.current.conn;
    if (!conn?.info?.ollama || process.env.AGENTIC_UNLOAD === 'off') return;
    const names = usedHere(conn);
    if (!names.length) return;
    const head = { ...remoteRef.current.headers, ...authHeaders(conn.url) };
    const q = (v) => JSON.stringify(String(v));
    const one = (name) => [`url = ${q(`${conn.url.replace(/\/+$/, '')}/api/generate`)}`, `header = ${q('Content-Type: application/json')}`, ...Object.entries(head).map(([k, v]) => `header = ${q(`${k}: ${v}`)}`), `data = ${q(JSON.stringify({ model: name, keep_alive: 0 }))}`, 'output = "/dev/null"'].join('\n');
    try { spawnSync('curl', ['-s', '-Z', '--connect-timeout', '1', '-m', '2', '-K', '-'], { input: names.map(one).join('\nnext\n'), timeout: 2500, stdio: ['pipe', 'ignore', 'ignore'] }); } catch { /* the service lets them go by itself later */ }
  };
  const { openSubagentsPanel, saveSubagents, applyHelpers, loadSubagent, serviceOf, serviceProps, pickHere, openWebPicker, runWebTest, saveWeb, offerList, openMcpPicker, mcpKeys, hooksList, hooksKeys, mcpNews, seeingModels, needVision, openSettings, openRewind, chooseRewind, applyRewind, openPermissions, memoryForRestart, openEffortLimits, openOwnSettings, fillSuggested, sharedValues, saveOwnSettings, applyChoice, sayEffort, saveEffortLimits, setThinkingFn, readMacMemory, readServicePs, saveNowFn } = panelsPart(self);
  useEffect(() => { applyHelpers(catalog); }, [catalog, model]);
  remoteFnRef.current = { ...remoteFnRef.current, useRemote, useLocal, reconnect, openForm: openRemoteForm, to: remoteTo };

  // ---- /mcp: your MCP servers (mcp-form.mjs keeps the picker, mcp-store.mjs the files, tools/mcp.mjs runs them) ----
  // The Level 1 rows: sign-in in the browser, and Anthropic's connector on the Claude API.
  const MCP_EXTRAS = true;
  // Where a sign-in page opens: your browser. AGENTIC_SIGNIN_FOLLOW=1 (the tests) follows the page's
  // answer itself, as a browser where you said yes would.
  const signinOpen = process.env.AGENTIC_SIGNIN_FOLLOW === '1' ? (url) => { fetch(url, { redirect: 'manual' }).then((r) => fetch(r.headers.get('location'))).catch(() => {}); } : openInBrowser;
  const mcpSigning = useRef(null);
  // The servers' resources and prompts, for the @ and / menus: loaded the first time a name is typed
  // (@shop: or /shop:), kept until /mcp changes something. [, bump] draws the menu again once loaded.
  const mcpLists = useRef({ resources: {}, prompts: {} });
  const [, bumpLists] = useState(0);
  const mcpTests = useRef(0);
  useEffect(mcpNews, []);
  // After the reply of a model that took one message with a picture: the model you
  // had comes back (the conversation stays). true when it switched.
  remoteFnRef.current.switchBack = async () => {
    const back = switchBackRef.current;
    if (!back) return false;
    switchBackRef.current = null;
    await switchModel(back, () => `Back on ${back.name}.`);
    return true;
  };
  remoteFnRef.current.needVision = needVision;
  // The model read a picture (or a scanned page) by itself while not looking at pictures:
  // the same reload, in the middle of its reply, when the add-on is here (else Read says
  // to ask you to attach it, which offers the download).
  // Whether this model on this Mac can turn its vision on (the Screen tool is offered then too).
  agent.mayLook = () => !model.remote && !opts.url && Boolean(model.vision) && existsSync(visionPath(model));
  agent.screen = settings.screen !== false;
  agent.visionOn = async () => {
    if (!agent.mayLook()) return false;
    push({ type: 'note', text: `${model.name} wants to look at a picture: turning on its vision (a reload of about 20 s, the conversation stays).`, tone: 'dim' });
    await switchModel(withVision(model), () => `${model.name} can look at pictures now: it stays on for this window.`, { midTurn: true });
    return Boolean(agentRef.current?.canSee);
  };
  askRef.current = (p) => new Promise((resolve) => {
    // Not over something you are doing: typing, or another menu open. Asked
    // again at the next pause.
    if (S.current.picker || S.current.input?.value?.trim() || pendingSaveRef.current || S.current.btw) { resolve('later'); return; }
    pendingSaveRef.current = { resolve, again: Boolean(p.again) };
    push({ type: 'panel', title: `${p.title ?? 'Learned in that task'} · ${p.add.length + p.drop.length} change${p.add.length + p.drop.length === 1 ? '' : 's'}`, pad: 0, rows: [...p.add.map((f) => [`+ ${f.text.replace(/\s+/g, ' ').slice(0, 140)}`]), ...p.drop.map((d) => [`− ${d.text.replace(/\s+/g, ' ').slice(0, 110)} (${d.why})`])] });
    openChoice('memory-save');
  });
  const setThinking = useCallback(setThinkingFn, [agent]);
  // Clock for spinners and timers, only while something is moving.
  const btwMoving = btw?.phase === 'answering' || btw?.phase === 'writing';
  useEffect(() => {
    if (!(starting || live.phase === 'working' || btwMoving)) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [starting, live.phase, btwMoving]);

  // The Mac's memory for the footer, read every 5 s (a few ms). A new figure is
  // drawn with the next redraw (a key, a spinner), not with one of its own: that
  // would rewrite the bottom of the window every few seconds while nothing else
  // moves, and Terminal drops a highlight whose rows are drawn again, so text
  // there could not be copied (1 Oct 2026). A new pressure colour is drawn at once.
  const macRef = useRef(opts.macMem ?? null);
  const [, redrawMac] = useState(0);
  useEffect(readMacMemory, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mac = macRef.current;
  // In a background session that another Mac has a window on (through the door, door.mjs): this
  // Mac's name, lower right, so the window there says where its keys go. The session's record
  // says who is in it (sessions.mjs): read when a window joins, which redraws, and every 2 s.
  const [sharedOn, setSharedOn] = useState(null);
  // Kept for the /remote form and its notes, which name this Mac ("server-1") while it is shown elsewhere.
  sharedRef.current = sharedOn;
  useEffect(() => {
    const name = process.env.AGENTIC_IN_HOST;
    if (!name) return;
    const read = () => { const on = sessionRecord(name)?.shared?.mac ?? null; setSharedOn((was) => (was === on ? was : on)); };
    read();
    const id = setInterval(read, 2000);
    return () => clearInterval(id);
  }, [redraw]);

  // The service's GPU memory for the footer's gauge and /meters (remote-footer.mjs): Ollama's
  // /api/ps as the model comes up on the service and every 30 s after. As with the Mac's memory, a
  // new figure waits for the next redraw, so Terminal keeps a highlight (1 Oct 2026); a spill onto
  // the CPU starting or ending, or the model unloading, is drawn at once.
  const psRef = useRef(null);
  // Keep loaded's renewal on its way to the service, if any: leaving the service waits for it first.
  const renewRef = useRef(null);
  const [, redrawPs] = useState(0);
  const psConn = model.remote && remoteState === 'on' && remoteRef.current.conn?.info?.ollama ? remoteRef.current.conn : null;
  const psKey = psConn ? `${psConn.url} ${model.remote.model}` : null;
  useEffect(readServicePs, [psKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Memory the model really uses (for the Live thinking meter line).
  useEffect(() => {
    // A copy shared with another window is measured too (its process is that window's).
    const read = () => { const s = serverRef.current; if (s?.port && (s.child || s.shared)) setRamGb((s.footprintBytes() + model.bytes) / 1e9); };
    const id = setInterval(read, 5000);
    const first = setTimeout(read, 1500);
    return () => { clearInterval(id); clearTimeout(first); };
  }, [model]);
  const saveNow = useCallback(saveNowFn, [agent, cwd]);

  // Keep a copy of what was shown, for /resume.
  useEffect(() => { sessionRef.current.items = items.filter((it) => it.type !== 'welcome'); }, [items]);
  const { sendPromptFn, agentEvents, arenaTick, loadModel, windowOpens, stopModel, startModel, toggleModel, resumeAtStart, quitFn, updateNowFn, interruptFn, closeBtwFn, askBtwFn, runShellFn, doctorFn, openAgentsTree, openLoops, loopsKey, startAgents, agentsKey } = runPart(self);
  const sendPrompt = useCallback(sendPromptFn, [agent, cwd, push]);

  // A background job that ended after the reply (agent 'jobs-waiting', tools/jobs.mjs): the model is
  // told and carries on by itself, as Claude Code does (the owner's pick, 3 Oct 2026). With a reply or
  // a message on its way, the model off or loading, or /agents running, it waits: the news then goes
  // with that message, or after /start.
  hookNoteRef.current = (text, tone) => push({ type: 'note', text, tone: tone ?? 'dim' });
  jobWakeRef.current = () => {
    if (!agent.idle() || queuedRef.current || modelOffNow() || S.current.starting || S.current.remoteState === 'loading' || agentsRef.current?.running) return;
    const w = agent.jobWake();
    if (!w) return;
    push({ type: 'note', text: `↻ ${w.shown}: the model carries on (esc stops it)`, tone: 'dim' });
    const ac = new AbortController();
    abortRef.current = ac;
    const plan = agent.mode === 'plan' ? '\n\n[Plan mode is on: only read and search. Do not change files or run commands that change anything. Reply with a short numbered plan, then stop.]' : '';
    agent.send(`${w.text}${plan}`, { signal: ac.signal, shown: w.shown, wake: true });
  };

  // /rewind's first copy of this folder, and the clean-up of copies no
  // conversation has used for a week, both in the background.
  useEffect(() => {
    const rw = rewindRef.current;
    if (!rw) return;
    rw.warm(cwd).catch(() => {});
    pruneRewind(HOME).catch(() => {});
    // Pictures pasted with ctrl+v are kept a week, then let go.
    try { const dir = join(HOME, 'attachments'); for (const f of readdirSync(dir)) { const p = join(dir, f); if (Date.now() - statSync(p).mtimeMs > 7 * 86_400_000) rmSync(p, { force: true }); } } catch { /* none yet */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(agentEvents, [agent, push, saveNow, sendPrompt]);

  // The Arena wants the memory (it runs Gemma and Qwen one model at a time): once no
  // reply is running, this window lets its model go, and loads it again by itself when the
  // battle is over. A message sent meanwhile waits in line and goes once the model is back.
  const battleRef = useRef({ released: false });
  battleRef.current.switchModel = switchModel;
  battleRef.current.sendPrompt = sendPrompt;
  remoteFnRef.current.send = sendPrompt;
  battleRef.current.model = model;
  useEffect(arenaTick, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the model on this Mac: at the window's start when it loads then (/autostart on, --start),
  // and on /start. stillOn() turns false when the window closes or /stop comes first: the load
  // then ends quietly (a server /stop stopped mid-load fails its start, and that is not said).
  const loadedOnce = useRef(false);
  const loadFnRef = useRef(null);
  loadFnRef.current = loadModel;
  const askedAtOpen = useRef(false);
  useEffect(windowOpens, []); // eslint-disable-line react-hooks/exhaustive-deps
  const stopFnRef = useRef(null);
  stopFnRef.current = stopModel;
  const startFnRef = useRef(null);
  startFnRef.current = startModel;
  // ctrl+t, or a click on the model's label in the footer (/mouse on): off → /start, loading or
  // loaded → /stop. In the middle of a reply it asks first: the same again within 2 s stops the
  // reply and unloads the model.
  const toggleArmed = useRef(0);
  const toggleFnRef = useRef(null);
  toggleFnRef.current = toggleModel;
  // What the memory saved after the last window here had closed, said once.
  useEffect(() => {
    if (!agent.memory) return;
    for (const line of sinceLastTime(cwd)) push({ type: 'note', text: line, tone: 'dim' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A permissions file that cannot be read turns every saved rule off: said once.
  useEffect(() => {
    const r = rulesFor(cwd);
    if (r.broken) push({ type: 'note', text: `~/.agentic-coder/permissions.json cannot be read (${r.broken}), so none of your saved rules apply until it is fixed or deleted.`, tone: 'warn' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // /weights: the viewer's little server, started once per window and closed with it.
  const weightsRef = useRef(null);
  useEffect(resumeAtStart, []); // eslint-disable-line react-hooks/exhaustive-deps

  function resumeSession(id) {
    try {
      const s = loadSession(cwd, id);
      agent.messages = s.messages;
      agent.messages[0] = { role: 'system', content: agent.messages[0].content };
      sessionRef.current = { id: s.id, title: s.title, items: s.items ?? [] };
      rewindRef.current?.setSession(s.id);
      agent.startSession('resume').catch(() => {});
      push({ type: 'divider', text: `resumed: ${s.title}` }, ...(s.items ?? []).map(({ key, ...rest }) => rest));
      if (s.mode) setMode(s.mode);
    } catch (e) { push({ type: 'note', text: `Could not open that conversation: ${e.message}`, tone: 'error' }); }
  }
  const quit = useCallback(quitFn, [exit, saveNow, agent]);
  const updateNow = useCallback(updateNowFn, [effort, exit, model, onRestart, opts.ctx, opts.flows, opts.url, opts.way, push, saveNow, thinking]);
  const interrupt = useCallback(interruptFn, []);
  const closeBtw = useCallback(closeBtwFn, [agent]);
  const askBtw = useCallback(askBtwFn, [agent]);
  const runShell = useCallback(runShellFn, [cwd, push]);
  const doctor = useCallback(doctorFn, [agent, columns, rows, model, opts.url, push, starting]);
  const { runSlashFn } = slashPart(self);
  const runSlash = useCallback(runSlashFn, [agent, askBtw, closeBtw, cwd, doctor, flash, meters, model, opts.url, push, quit, ramGb, sendPrompt, setMode, setThinking, stats, update, updateNow, win]);
  const { submitFn, onPaste, onTerminalReply, flushArrows, onKey } = keysPart(self);
  const submit = useCallback(submitFn, [agent, cwd, push, quit, runShell, runSlash, sendPrompt]);

  // Menu under the prompt: slash commands or @files.
  const inputMode = input.value.startsWith('!') ? 'bash' : 'prompt';
  let menu = null;
  const btwShown = Boolean(btw && !perm && !answerWait);
  if (!perm && !picker && !btwShown && input.value !== menuClosedFor) {
    // The rows the / menu may take: 18 as ever, and more in a window with room for them (the box, the
    // footer and their gaps take 6). Under the start page while it is still live, the rows it can give
    // up and still show its bot (2 + START_BIG and its blank line; start.room, below, shrinks it to fit).
    const fits = holdRef.current ? (rows ?? 40) - 7 - heldRows(items, measure.current) - 2 - START_BIG : (rows ?? 24) - 6;
    const room = Math.max(MENU_ROWS, Number.isFinite(fits) ? fits : 0);
    const cmds = inputMode === 'prompt' ? matchCommands(input.value, { service: Boolean(model.remote?.ollama && remoteRef.current.conn?.info?.ollama), room, side: Boolean(model.remote) || (Boolean(opts.url) && agent.slots?.side !== undefined) }) : [];
    if (cmds.length) menu = { kind: 'slash', rows: room, pad: Math.max(14, ...cmds.map((c) => c.name.length + 3)), items: cmds.map((c) => ({ label: `/${c.name}`, desc: c.desc, value: c.name, takesArg: !!c.arg, picker: !!c.picker })) };
    // /shop: lists that MCP server's prompts (typed in full they run: /shop:review-pr 57).
    const slashServer = inputMode === 'prompt' && mcpHub ? /^\/([A-Za-z0-9][A-Za-z0-9-]{0,31}):(\S*)$/.exec(input.value) : null;
    if (!menu && slashServer && mcpHub.offers().prompts.includes(slashServer[1])) {
      const q = slashServer[2].toLowerCase();
      const list = offerList('prompts', slashServer[1]).filter((p) => p.name.toLowerCase().includes(q));
      if (list.length) menu = { kind: 'slash', rows: room, pad: Math.max(14, ...list.map((p) => slashServer[1].length + p.name.length + 4)), items: list.map((p) => ({ label: `/${slashServer[1]}:${p.name}`, desc: `${p.description ?? p.title ?? 'a prompt of this server'}${p.arguments?.length ? ` · ${p.arguments.map((a) => `${a.name}${a.required ? '' : '?'}`).join(' ')}` : ''}`, value: `${slashServer[1]}:${p.name}`, takesArg: Boolean(p.arguments?.length) })) };
    }
    const at = mentionAt(input);
    // @shop: lists that MCP server's resources; @sh offers the servers that have them.
    const offers = mcpHub && at ? mcpHub.offers().resources : [];
    const atServer = at ? /^([A-Za-z0-9][A-Za-z0-9-]{0,31}):(.*)$/.exec(at.query) : null;
    if (!menu && atServer && offers.includes(atServer[1])) {
      const q = atServer[2].toLowerCase();
      const list = offerList('resources', atServer[1]).filter((r) => `${r.uri} ${r.name ?? ''}`.toLowerCase().includes(q)).slice(0, 50);
      const lw = Math.min(60, Math.max(16, ...list.map((r) => atServer[1].length + String(r.uri).length + 4)));
      menu = { kind: 'files', pad: lw, at, items: list.length ? list.map((r) => ({ label: `@${atServer[1]}:${r.uri}`, desc: r.name ?? r.title ?? '', value: `${atServer[1]}:${r.uri}` })) : [{ label: `@${atServer[1]}:`, desc: mcpLists.current.resources[atServer[1]] === null ? 'loading its resources…' : 'it lists no resource that matches', value: `${atServer[1]}:` }] };
    }
    if (!menu && at && !atServer) for (const s of offers.filter((n) => n.toLowerCase().startsWith(at.query.toLowerCase()))) (menu ??= { kind: 'files', pad: 20, at, items: [] }).items.push({ label: `@${s}:`, desc: `the resources of your MCP server ${s}`, value: `${s}:`, open: true });
    if (!menu && at) {
      if (!filesRef.current) { filesRef.current = []; let n = 0; for (const f of walk(cwd)) { if (!f.dir) filesRef.current.push(f.path); if (++n > 5000) break; } }
      const q = at.query.toLowerCase();
      const hits = filesRef.current.filter((f) => f.toLowerCase().includes(q)).sort((a, b) => (a.toLowerCase().startsWith(q) ? 0 : 1) - (b.toLowerCase().startsWith(q) ? 0 : 1) || a.length - b.length).slice(0, 50);
      if (hits.length) menu = { kind: 'files', pad: 0, at, items: hits.map((f) => ({ label: `@${f}`, value: f })) };
    }
  }
  const menuIdx = menu ? Math.min(menuIndex, menu.items.length - 1) : 0;
  useEffect(() => { setMenuIndex(0); setMenuClosedFor((v) => (v === input.value ? v : null)); }, [input.value]);
  usePaste(onPaste);
  // The mouse in the prompt box (/mouse on). Terminal hands it over while
  // the box is on screen (with or without text in it, since 30 Sep 2026, so a
  // click on the model's label in the footer starts or stops the model): a
  // press puts the cursor there, a drag highlights (the selection shift +
  // arrows make: copied at once, delete removes it) and a double click takes
  // the word. A scroll gives the mouse back for a moment, so the rest of it
  // moves the conversation as it always did; fn held is Terminal's own highlight.
  const { internal_eventEmitter: rawKeys } = useStdin();
  const tty = win?.out ?? process.stdout;
  // The start page's Recent activity rows open with a click (start.jsx recentRows), so while the page
  // is up with any, the mouse is the app's even with /mouse off; it goes back to Terminal with the page.
  const pageRef = useRef(null);
  const startShown = holdRef.current || (items[0]?.type === 'welcome' && !items.some((it) => it.type === 'user'));
  const startClicks = Boolean(startShown && recentRef.current?.length);
  const mouseArmed = (mouse || startClicks) && !perm && !picker && !btwShown && !wheelPause && !leaving && !tooSmall;
  const mouseRef = useRef({ armed: false, asked: null, waiting: [], origin: null, down: false, last: null, wheel: null });
  const footerRef = useRef(null);
  useEffect(() => {
    if (!mouseArmed) return undefined;
    const m = mouseRef.current;
    m.armed = true;
    tty.write(MOUSE_ON);
    return () => { clearTimeout(m.asked); Object.assign(m, { armed: false, asked: null, waiting: [], origin: null, down: false }); tty.write(MOUSE_OFF); };
  }, [mouseArmed, tty]);
  // However the app ends, Terminal gets its mouse back.
  useEffect(() => {
    const off = () => { if (mouseRef.current.armed) { try { writeSync(1, MOUSE_OFF); } catch {} } };
    process.on('exit', off);
    return () => { process.off('exit', off); clearTimeout(mouseRef.current.wheel); };
  }, []);
  // What Terminal sends for the mouse arrives with the keys. A press first
  // asks where the cursor is (it sits where you type, so the answer places
  // the box: the conversation above it may have grown since the last press).
  const onRawRef = useRef(null);
  onRawRef.current = onTerminalReply;
  useEffect(() => {
    const h = (seq) => onRawRef.current(seq);
    rawKeys.on('input', h);
    return () => { rawKeys.removeListener('input', h); };
  }, [rawKeys]);
  // ⌥-click in Terminal moves the cursor by sending arrow keys, all at once:
  // plain arrows for the prompt wait for the rest of their read. One alone is
  // a key as usual; several are one move by rows and cells, kept in the box
  // (never the menu or earlier prompts), whatever order they came in.
  const arrowsRef = useRef([]);

  useInput((ch, key) => {
    if (isMouseText(ch)) return; // the mouse's reports are handled above, never typed
    const cur = S.current;
    const arrow = (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) && !key.shift && !key.meta && !key.ctrl;
    if (arrow && !cur.tooSmall && !cur.perm && !cur.picker && !(cur.btw && !cur.answerWait) && !waitRef.current && !cur.loopsOn) {
      arrowsRef.current.push(key);
      if (arrowsRef.current.length === 1) queueMicrotask(flushArrows);
      return;
    }
    flushArrows();
    onKey(ch, key);
  });

  // Items added some other way (a resumed conversation, /clear) or a resize:
  // measure after the frame, then draw once more with the space right.
  useEffect(() => {
    let on = true;
    queueMicrotask(() => { try { if (on && primeRows(itemsRef.current, measure.current)) bumpRows((n) => n + 1); } catch {} });
    return () => { on = false; };
  }, [items, width]);
  // Held until your first message (sendPrompt lets it go). Let go for good, printed as it is, when
  // what came under it, the / menu or the shortcuts would leave it fewer than START_MIN rows, or when a
  // panel, pop-up or question opens (the page and a tall panel would not fit together).
  // The rows the start page may use (start.jsx StartPage, start.room): the window less the prompt box,
  // the footer, their gaps and the cursor's line (6) and the page's own blank line; held, less what
  // sits under it too (the notes, the / menu, the shortcuts), so it shrinks to make room and stays
  // live. Printed at once (a start on a remote, or --url), it keeps rows for the notes that come after
  // it, a line and a gap each: the mode the last window left, and on a remote where it runs, its
  // Big-model mode and its load. Once printed it keeps the room it was shown with, until the window
  // changes size.
  const underRows = heldRows(items, measure.current) + (menu ? Math.min(menu.rows ?? MENU_ROWS, menu.items.length) : 0) + (showShortcuts ? shortcutRows(Boolean(model.remote)) : 0);
  const heldRoom = (rows ?? 40) - 7 - underRows;
  if (holdRef.current && !(items[0]?.type === 'welcome' && !picker && !popup && !perm && !btw && heldRoom >= START_MIN)) holdRef.current = false;
  if (holdRef.current) pageRoomRef.current = { room: heldRoom, rows: rows ?? 40 };
  const kept = pageRoomRef.current;
  const comingNotes = (startedIn.from === 'last' && startedIn.mode !== 'ask' ? 2 : 0) + (remoteAtStart ? 6 : 0);
  const pageRoom = holdRef.current ? heldRoom : kept?.rows === (rows ?? 40) ? kept.room : Math.max(START_MIN, (rows ?? 40) - 7 - comingNotes);
  // What primeRows needs to measure items as they are printed. The tip (startTip) is on the page while
  // it has room for its Try rows, else on the footer.
  const start = { model: model.name, effort: thinkingLevel(model, thinking, effort).label.toLowerCase(), ctx, cwd: short(cwd), git: opts.start?.git, notes: opts.start?.notes ?? [], also: opts.start?.also ?? [], recent: recentRef.current, now: startedAt, off: modelOff, took: startTook, typical: typicalStart(timesRef.current[modelKey(model)]), room: pageRoom, tip, news: opts.start?.news, places: opts.start?.places, folders: opts.start?.folders, memory: opts.start?.memory, running: opts.start?.running };
  const tipOnPage = Boolean(tip) && pageRoom - 2 >= START_BIG;
  measure.current = { width, modelName: model.name, cwdShort: short(cwd), loaded: opts.loaded ?? '', start };
  itemsRef.current = items;
  // "/btw " typed: its argument's hint after the cursor, as in Claude Code.
  const hintFor = /^\/(\S+) $/.exec(input.value);
  const argHint = hintFor && input.cursor === input.value.length ? COMMANDS.find((c) => c.name === hintFor[1])?.arg ?? null : null;
  // The model's label in the footer (screen.jsx modelLabels): off, loading, or on with the memory it holds.
  // A remote: the model by the name the server knows, where it runs, and how it is going (screen.jsx modelLabels).
  const remoteGb = remoteState === 'loading' ? (catalog?.models.find((m) => m.id === model.remote?.model)?.bytes ?? 0) / 1e9 || null : null;
  // Its name is remoteModel's without " · <where>" (one of ours keeps its own name, not its file's).
  const remoteName = model.remote ? model.name.replace(` · ${model.remote.label}`, '') : null;
  // The footer's gauges on a remote (remote-footer.mjs), from the model in use's own answers: none
  // until the first has a speed. While it writes, the speed is this reply's, in green.
  const writingNow = live.phase === 'working' && live.firstTokenAt && !live.waiting && live.liveTps ? live.liveTps : null;
  const ownStats = model.remote && stats.speedsOf === model.remote.model && (stats.tps || stats.speeds?.length);
  const server = psRef.current;
  const gauges = ownStats ? { tps: writingNow ?? stats.tps, live: Boolean(writingNow), speeds: stats.speeds ?? [], ttft: stats.ttft ?? null, ctxUsed: stats.ctxUsed ?? agent.ctxUsed, ctx, gpuPct: server?.loaded ? server.gpuPct : null } : null;
  const modelState = opts.url ? null : model.remote ? { remote: true, state: remoteState ?? 'connecting', name: remoteName, where: model.remote.label, gb: remoteGb } : modelOff ? { state: 'off' } : starting ? { state: 'loading', name: model.name } : { state: 'on', name: model.name, gb: ramGb };
  // What the running start has left (start-times.mjs), from how long each part has run so far.
  const tm = timing.current;
  const startLeftNow = starting && tm ? startLeft(timesRef.current[tm.id], { phase: startPhase, cold: tm.cold, sinceLoad: (now - tm.loadAt) / 1000, sinceWarm: tm.warmAt ? (now - tm.warmAt) / 1000 : 0 }) : null;
  // /agents: its tree takes the whole window (a permission prompt, a menu or a typed answer shows
  // over it, in the chat), and each switch draws the window again, as a resize does.
  const agentsShown = agentsView === 'tree' && Boolean(agentsState) && !perm && !picker && !answerWait && !popup;
  const agentsWas = useRef(false);
  useEffect(() => {
    if (agentsWas.current === agentsShown) return;
    agentsWas.current = agentsShown;
    win?.clear();
  }, [agentsShown]); // eslint-disable-line react-hooks/exhaustive-deps
  // Its dots and spinners move about 8 times a second while it works (twice a second in the chat's line).
  const agentsMoving = Boolean(agentsState) && !agentsState.verdict && !agentsState.paused && !agentsState.gate;
  useEffect(() => {
    if (!agentsMoving || !agentsView) return undefined;
    const id = setInterval(() => setAgentsNow(Date.now()), agentsShown ? 125 : 500);
    return () => clearInterval(id);
  }, [agentsMoving, agentsView, agentsShown]);
  const agentsLiveLine = agentsState && !agentsShown && agentsView === 'chat' ? agentsLine(agentsState, agentsNow) : null;
  // /loops: the board has the window (a question of the window's own shows over it, in the chat), and
  // each switch draws the window again, as /agents' does. It is drawn about 7 times a second while shown.
  const loopsShown = loopsOn && Boolean(loopsRef.current) && !perm && !picker && !answerWait && !popup && !agentsShown;
  const loopsWas = useRef(false);
  useEffect(() => {
    if (loopsWas.current === loopsShown) return;
    loopsWas.current = loopsShown;
    win?.clear();
  }, [loopsShown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loopsShown) return undefined;
    const id = setInterval(() => setLoopsTick((x) => x + 1), 150);
    return () => clearInterval(id);
  }, [loopsShown]);
  if (loopsShown && !loopsLines.current) loopsLines.current = runReader(loopsRef.current.home, loopsRef.current.pid);
  const loopsFrame = loopsShown ? drawLoops(loopsRef.current.snapshot(), loopsUi.current, { cols: columns ?? 100, rows: Math.max(10, (rows ?? 40) - 1), now: Date.now(), linesOf: loopsLines.current }) : null;
  const app = {
    sessionTokens: sessionTokens.current,
    agentsTree: agentsShown ? agentsState : null, agentsNow, agentsLine: agentsLiveLine,
    loopsFrame, loopsLine: loopsShown ? null : loopsSegs,
    btw: btwShown ? btw : null, btwWaiting: Boolean(btw && !btwShown), argHint, leaving,
    items, live, perm, picker, popup, input, mode, width, pageRef, rows: rows ?? 40, columns: columns ?? 100, tooSmall, redraw, cwd, cwdShort: short(cwd), loaded: opts.loaded ?? '', start, hold: holdRef.current, tip: tipOnPage ? null : tip,
    modelName: model.name, modelOff, modelState, gauges, gaugeList: settings.footer?.remote, server: model.remote ? server : null, now, spinner: spinStyle(process.env.AGENTIC_SPINNER), stats: { ...stats, ctxUsed: stats.ctxUsed ?? agent.ctxUsed }, ctx, ramGb, mac, meters, starting, startedAt, notice, queued, showShortcuts, placeholder,
    inputMode, menu: menu ? { ...menu, index: menuIdx } : null, waitingForYou: !!perm, thinking,
    thinkingLabel: thinkingLevel(model, thinking, effort).label.toLowerCase(), thinkingLevels: model.thinkingLevels ?? [], ...(picker?.kind === 'model' ? { pickLevels: pickLevels(picker), pickLevelId: pickLevel(picker).id } : {}), ...(picker?.kind === 'service' ? serviceProps(picker) : {}), ...(picker?.kind === 'subagents' ? { subagents: { models: catalog?.models ?? [], main: model.remote?.model ?? null, where: model.remote?.label ?? '' } } : {}), startPhase, startLeft: startLeftNow, waiting, battle, remoteSource: model.remote?.source ?? null,
    // The weights badge, lower right: edited weights saved and waiting, in
    // use, or newer ones saved than the copy loaded now.
    updateBadge: updateText(update),
    shareBadge: sharedOn ? `⇄ on ${sharedOn}` : null,
    // The /remote form's title, right side: where this window runs now.
    remoteWhere: remoteRef.current.on && remoteRef.current.conn ? `this window runs on ${remoteLabel(settings.remote)} · ${model.remote?.model ?? model.name}` : `this window runs on ${sharedOn ?? 'this Mac'} · its own model is ${modelOff ? 'off' : 'on'}`,
    // Loops made in this window (/loop): how many are open, and whether one waits for you.
    loopsBadge,
    // The footer's right side starts with these (screen.jsx footerParts): this window's own copy, the cost meter.
    spend: [inCopy ? 'own copy' : '', spend].filter(Boolean).join(' · '),
    weightsBadge: model.edited
      ? (editedSaved[model.edited.base] && editedSaved[model.edited.base].saved !== model.edited.saved ? '✱ newer edits saved · /model to reload'
        : `✱ on edited weights (${model.edited.edits.length} edit${model.edited.edits.length === 1 ? '' : 's'})`)
      : (Object.keys(editedSaved).length ? '✱ edited weights ready · /model to switch' : null),
  };
  // Where the footer drew the model's label, for a click on it (onMouse); an open menu takes the footer's place.
  footerRef.current = app.menu?.items?.length ? null : footerParts(app);
  return <Screen app={app} />;
}
