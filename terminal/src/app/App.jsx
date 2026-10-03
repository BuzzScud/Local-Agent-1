// Agentic Coder's terminal app: starts the model, runs the agent, and turns
// its events into the screen; handles the prompt box, permission prompts,
// slash commands, layouts, sessions and keys.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, useInput, usePaste, useStdin, useWindowSize } from 'ink';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, statSync, readFileSync, statfsSync, writeSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { Screen, permissionOptions, primeRows, btwLayout, heldRows, holdRoom, MENU_ROWS, shortcutRows, footerParts } from './screen.jsx';
import { startTip } from './start.jsx';
import { loadTimes, saveTime, startLeft, typicalStart } from './start-times.mjs';
import { MIN_COLS, MIN_ROWS } from './window.mjs';
import { Agent } from '../agent/agent.mjs';
import { helpersFrom, helpersEnv, changeHelpers, helperRows } from './helpers.mjs';
import { hooksFrom, hooksEnv, changeHooks, hookRows, HOOKS } from '../agent/way.mjs';
import { systemPrompt, projectNotes, gitSummary, SESSION_MARK, notesRoom, isHomeFolder } from '../agent/prompt.mjs';
import { offerFor, nextMode, modeOf } from '../agent/permissions.mjs';
import { screenAccess, askScreenAccess, terminalApp } from '../tools/screen.mjs';
import { resolvePath } from '../agent/tools.mjs';
import { warmUp, MODELS, DEFAULT_MODEL, modelPath, onDiskBytes, serverBinOf, engineOf, thinkingLevel, ModelServer, chooseContext, availableBytes, needBytes, runningServer, LINGER_SECS, liveUsers, stopIdleServers, stopServer, otherCopies, serverProcesses, contextCheck, freeWithHandBack, freeAfterQuit, searchBytes, scanServers, hasDraft, battleHold, battleCounts, findRunTest, RUN_TESTS, readEditedAll, editedModels, modelById, readRecord, Embedder, embedderReady, HOME, macMemory , connectRemote, remoteLabel, remoteRisk, remoteModel, saveKey, removeKey, keyStore, DEFAULT_REMOTE, sourceOf, withVision, visionPath, getVision, ollamaCatalog, ollamaModel, ollamaPs, preloadOllama, unloadOllama, isOutOfMemory, floorCtx, setEndpoint, endpointOf, authHeaders } from '../../../models/index.mjs';
import { droppedFiles, IMAGE_TOKEN } from '../agent/images.mjs';
import { spendEvents, spendLabel, windowSpend } from '../agent/spend.mjs';
import { registerWindow, updateWindow, unregisterWindow, projectOf, othersIn, modelsInUseOn, copyAt, makeCopy, removeCopy, copyChanges, changeLines, putBack, copyDiff, keptCopies } from './copies.mjs';
import { isImage, isPdf, preparedImage, pdfText, clipboardImage } from '../tools/media.mjs';
import { rowsOf as remoteRows, openForm, moveRow, startEdit, editField, pasteField, commitEdit, testForm, withTest, savePlan, connectionChanged, formWarning, kindWord, sourceWord, remotesOf, readyRemote, remoteChoices, openModelPick, movePick, moveCopy, commitPick, closePick, modelChoices } from './remote-form.mjs';
import { openService, serviceRows, atRow, moveService, filterService, toggleFold, ctxWord, suggestModel } from './remote-models.mjs';
import { suggestedFor } from './remote-suggested.mjs';
import { jobsOf, openSubagents, moveJob, stepModel, toggleJob, savedOf, MAIN } from './subagents.mjs';
import { RemoteEmbedder, HELPER_CTX, HELPER_KEEP } from '../agent/helper-models.mjs';
import { tryOut } from '../agent/tryout.mjs';
import { serviceKey, readTryouts, saveTryout, triedWord } from './tryouts.mjs';
import { WEB_ROWS, openWebForm, moveWebRow, testWebForm, toWebSettings, webWarning, webSettings, searchKeyId } from './web-form.mjs';
import { PROVIDER_NAMES } from '../tools/web.mjs';
import { readFile } from '../tools/read.mjs';
import { runCommand } from '../tools/run.mjs';
import { walk } from '../tools/fs.mjs';
import { editInput, insertText, cursorLine, cursorCell, mentionAt, selectedText, withUndo, undoEdit, redoEdit, moveBy, posAt, wordAt, promptTextWidth } from './edit-input.mjs';
import { MOUSE_ON, MOUSE_OFF, ASK_CURSOR, DOUBLE_CLICK_MS, WHEEL_PAUSE_MS, parseMouse, parseCursorReply, isMouseText } from './mouse.mjs';
import { copyToClipboard } from './clipboard.mjs';
import { fromScreen } from './screen-copy.mjs';
import { matchCommands, COMMANDS, SETTINGS } from './commands.mjs';
import { startWeightsServer, listDocs, findDocsDir } from './weights.mjs';
import { MODE_OPTIONS, VERSION } from './help.mjs';
import { memoryDirs, readFacts, readLog, undoSave, openMemory, health, healthLine } from '../agent/facts.mjs';
import { rulesList, changeRules, looksLikeEvent, ALWAYS_MAX } from './rules.mjs';
import { notesCount, notesDir, claudeOn } from '../agent/claude-notes.mjs';
import { CLAUDE_RULES } from '../agent/claude-rules.mjs';
import { AutoSave, memoryOn, sinceLastTime, saveModeOf } from './autosave.mjs';
import { mathTopics } from '../agent/expertise.mjs';
import { designSettings, designSummary, designDir, readCards, STYLES as DESIGN_STYLES, styleWords } from '../agent/design.mjs';
import { studioSummary } from '../agent/studio.mjs';
import { loadSettings, saveSettings, saveSession, listSessions, loadSession, newSessionId, loadHistory, addHistory } from './store.mjs';
import { readRecord as sessionRecord, askJump, DETACH_LABEL } from './sessions.mjs';
import { saveTrust } from './trust.mjs';
import { Rewind, pruneRewind, rowNote, rewindChoices, planLines, names } from './rewind.mjs';
import { rulesFor, addRule, startModeFor } from './perm-store.mjs';
import { changePermissions, summary as permSummary, settingsValue, modeWord } from './perms.mjs';
import { countTries } from './live.mjs';
import { spinStyle } from '../ui/theme.mjs';
import { readInstructions } from '../agent/instructions.mjs';
import { watchUpdates, updateText, bringIn, canRestart } from './update.mjs';
import { runMorning, summary as morningSummary } from '../morning/index.mjs';
import { complete } from '../flows/llm.mjs';
import { askAside, sendToMain } from '../agent/btw.mjs';
import { readLimits, limitsToSave, moveLimit, limitChanges, modelWithLimits, applyLimits, applySearch, searchModels, defaultLimits, showLimit, effortNote, defaultLevelId, OWN_ROWS, ownOf, shownLimits } from './limits.mjs';
import { isQuit } from '../flows/words.mjs';
import { AgentsRun, STAGES as AGENT_STAGES } from '../agent/agents-run.mjs';
import { agentDriver, savedRun } from '../agent/agents-driver.mjs';
import { demoDriver } from '../agent/agents-demo.mjs';
import { agentsLine } from './agents-tree.mjs';
import { growTo, canResize, resizeSeq } from './agents-window.mjs';

// The spinner's verb for a turn and its past tense for the line left behind
// when the turn ends ("⠿ Baked for 41s · done 12:58 PM"), as Claude Code does.
const VERBS = [['Baking', 'Baked'], ['Brewing', 'Brewed'], ['Cogitating', 'Cogitated'], ['Computing', 'Computed'], ['Conjuring', 'Conjured'], ['Cooking', 'Cooked'], ['Crafting', 'Crafted'], ['Crunching', 'Crunched'], ['Deliberating', 'Deliberated'], ['Forging', 'Forged'], ['Hatching', 'Hatched'], ['Ideating', 'Ideated'], ['Marinating', 'Marinated'], ['Mulling', 'Mulled'], ['Musing', 'Mused'], ['Noodling', 'Noodled'], ['Percolating', 'Percolated'], ['Pondering', 'Pondered'], ['Puzzling', 'Puzzled'], ['Ruminating', 'Ruminated'], ['Simmering', 'Simmered'], ['Stewing', 'Stewed'], ['Synthesizing', 'Synthesized'], ['Tinkering', 'Tinkered'], ['Working', 'Worked'], ['Wrangling', 'Wrangled']];
// A turn's end line when it did not finish its job (rail.jsx); the note before it says why.
const END_WORDS = { stuck: 'Stopped: it was stuck', limit: 'Stopped at the step limit', error: 'Stopped by an error', declined: 'Stopped: you said no' };
const PLACEHOLDERS = ['Try "explain what this project does"', 'Try "add a test for …"', 'Try "fix the failing tests"', 'Try "find where … is set"'];
const IDLE = { phase: 'idle' };
const INIT_PROMPT = 'Look through this project and write an AGENTS.md at its root for a coding assistant: what the project is, how to run it and its tests, the main folders and files, and conventions you notice in the code. Keep it under 60 lines. If an AGENTS.md already exists, improve it instead.';
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
let seq = 0;

const home = homedir();
// A path as you would write it: ~ for your home folder.
const tildeOf = (p) => (p === home ? '~' : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);
const short = (p) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);
// A stopped server's process really gone (false after `ms`): two copies of the model never fit side by side.
async function exited(pid, ms = 15000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 200))) {
    try { process.kill(pid, 0); } catch { return true; }
  }
  return false;
}

// A window lets go of a model server: stopped when no other window uses it (a copy kept loaded
// by an earlier window, which this one only joined, is stopped too), else left to the others.
// The deciding steps run at once, so a window closing as it calls this still frees the memory.
// Answers { others: windows still on it, done: settles once the process has gone }.
function letGo(srv) {
  if (!srv) return { others: 0, done: Promise.resolve() };
  const port = srv.port;
  const others = port ? liveUsers(port).filter((p) => p !== process.pid).length : 0;
  const joined = !others && srv.shared ? scanServers().find((e) => e.port === port && e.pid === srv.shared.pid) : null;
  const stopped = srv.stop({ keep: others > 0 });
  if (joined) stopServer(joined);
  return { others, done: stopped.then(() => (joined ? exited(joined.pid) : true)) };
}

// A remote's settings as a window keeps them for its after-close memory save: everything but a key
// typed in (the key itself stays in the Keychain; `key` says only whether there is one).
export const remoteConfOf = (r) => (r ? { ...r, key: Boolean(r.key) } : null);

// "@path" in a prompt attaches that file for the model.
// @picture.png and @doc.pdf too: a picture is attached as a picture (images), a
// PDF as its text. A file dragged into the window (its path) and a pasted
// picture ([Image #n], `pasted`) count the same way.
function expandMentions(value, cwd, maxChars, pasted = new Map()) {
  const attached = [];
  const images = [];
  let extra = '';
  const addPdf = (abs, shown) => {
    try {
      const pages = pdfText(abs);
      const body = pages.map((t, i) => `--- page ${i + 1} of ${pages.length} ---\n${t.trim() || '(no text on this page: a scan or a picture)'}`).join('\n');
      attached.push({ path: shown, label: `PDF, ${pages.length} page${pages.length === 1 ? '' : 's'}` });
      extra += `\n\n<file path="${shown}">\n${body.slice(0, maxChars)}\n</file>`;
    } catch (e) { attached.push({ path: shown, label: `not read: ${e.message}` }); }
  };
  const addImage = (abs, shown) => {
    try { const img = preparedImage(abs); images.push({ ...img, path: shown }); attached.push({ path: shown, label: `picture, ${img.srcW}×${img.srcH}` }); } catch (e) { attached.push({ path: shown, label: `not a picture it can open: ${e.message}` }); }
  };
  for (const m of value.matchAll(IMAGE_TOKEN)) {
    const file = pasted.get(Number(m[1]));
    if (file && existsSync(file)) addImage(file, m[0]);
  }
  for (const d of droppedFiles(value, cwd)) {
    const shown = d.path.startsWith(homedir()) ? `~${d.path.slice(homedir().length)}` : d.path;
    if (d.kind === 'image') addImage(d.path, shown); else addPdf(d.path, shown);
  }
  for (const m of value.matchAll(/(^|\s)@([^\s]+)/g)) {
    // "@invoice.pdf?" names invoice.pdf: punctuation after a name that is not part of the file.
    let p = resolvePath(cwd, m[2]);
    if (!existsSync(p.abs) && /[?!.,;:)\]'"]+$/.test(m[2])) p = resolvePath(cwd, m[2].replace(/[?!.,;:)\]'"]+$/, ''));
    if (!p.inside || !existsSync(p.abs) || statSync(p.abs).isDirectory()) continue;
    if (isImage(p.abs)) { addImage(p.abs, p.rel); continue; }
    if (isPdf(p.abs)) { addPdf(p.abs, p.rel); continue; }
    const r = readFile(p.abs, { limit: 400 });
    if (r.text.includes('\u0000')) continue;
    attached.push({ path: p.rel, lines: r.lineCount });
    extra += `\n\n<file path="${p.rel}">\n${r.numbered.slice(0, maxChars)}\n</file>`;
  }
  return { text: value + extra, attached, images };
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
  // /model's Effort row is the highlighted model's own levels (1 Oct 2026: K2 Horizon and Bonsai have Medium, Gemma
  // and Qwen do not). The level you chose is kept by name (levelId, on), so moving the cursor never changes it; a model
  // without it shows its nearest (thinkingLevel: Medium is High there). A remote's row has no levels: the model in use's.
  const pickModelOf = (pk) => { const m = pk.models[pk.index]; return m?.thinkingLevels ? m : model; };
  const pickLevels = (pk) => pickModelOf(pk).thinkingLevels ?? [];
  const pickLevel = (pk) => thinkingLevel(pickModelOf(pk), pk.on, pk.levelId);
  const [input, setInput] = useState({ value: '', cursor: 0 });
  const [menuIndex, setMenuIndex] = useState(0);
  const [mode, setModeState] = useState(modeOf(opts.mode ?? settings.mode) ?? 'ask');
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
  const waitForBattle = async (stillOn = () => true) => {
    let h = battleHold();
    if (!h) return;
    setBattle(h); setStartPhase('waiting');
    await new Promise((resolve) => {
      const tick = setInterval(() => {
        if (!stillOn()) { clearInterval(tick); resolve(); return; }
        h = battleHold();
        if (h) setBattle(h); else { clearInterval(tick); resolve(); }
      }, 3000);
    });
    setBattle(null); setStartPhase('loading');
  };
  // Waits while another copy of the model is loaded outside the app windows. Returns what is free
  // once the servers that quit meanwhile give their memory back (freeAfterQuit, from the last look
  // while they ran), 0 when it did not wait or none quit.
  const waitForOthers = async (m, stillOn = () => true) => {
    let others = otherCopies(m);
    if (!others.length) return 0;
    const look = () => ({ free: availableBytes(), servers: serverProcesses() });
    let last = look();
    const who = (list) => list.map((o) => `${o.who} (port ${o.port ?? '?'}, ${(o.bytes / 1e9).toFixed(1)} GB)`).join(' and ');
    setWaiting(who(others));
    setStartPhase('waiting');
    await new Promise((resolve) => {
      const done = () => { clearInterval(tick); waitRef.current = null; resolve(); };
      const tick = setInterval(() => {
        if (!stillOn()) return done();
        others = otherCopies(m);
        if (others.length) { setWaiting(who(others)); last = look(); } else done();
      }, 3000);
      waitRef.current = { go: () => { push({ type: 'note', text: `Starting anyway: ${who(others)} still has ${m.name} loaded, so both may be slow.`, tone: 'warn' }); done(); } };
    });
    setWaiting(null);
    setStartPhase('loading');
    return freeAfterQuit(last, serverProcesses());
  };
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
  const modelKey = (m) => m.id ?? m.file ?? m.name;
  const timeLoad = (m, cold) => { timing.current = { id: modelKey(m), loadAt: Date.now(), warmAt: null, cold }; };
  const timeLoaded = (st) => {
    const t = timing.current;
    if (!t) return;
    t.cold = !st?.shared;
    if (t.cold) saveTime(t.id, 'load', (Date.now() - t.loadAt) / 1000);
    t.warmAt = Date.now();
  };
  const timeWarmed = (res) => {
    const t = timing.current;
    if (t?.warmAt && res && !res.skipped && !res.remote && !res.fallback) saveTime(t.id, res.restored ? 'restore' : 'read', (Date.now() - t.warmAt) / 1000);
  };
  const timeDone = () => {
    const t = timing.current;
    if (!t) return;
    setStartTook((Date.now() - t.loadAt) / 1000);
    timesRef.current = loadTimes();
    timing.current = null;
  };
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
  // Quitting or restarting: the terminal's cursor leaves the prompt box for the
  // line under it, so what is printed after the app goes there, not into the box.
  const [leaving, setLeaving] = useState(false);
  const [ramGb, setRamGb] = useState(null);
  const [meters, setMeters] = useState(Boolean(settings.meters)); // the status bar under the prompt (off, like Claude Code)
  const [mouse, setMouse] = useState(Boolean(settings.mouse)); // /mouse: drag to highlight in the prompt box (off: the mouse stays Terminal's)
  const [wheelPause, setWheelPause] = useState(false); // a scroll just came in: the mouse is Terminal's for a moment
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
  // A turn under way: what it prints are steps on the rail (rail.jsx). What came along with the
  // request (the notes, the design cards, how it was sorted) is held until the turn's first step,
  // then printed as one line; the turn's last layout check is kept for its end line.
  const railOn = useRef(false);
  // The cost meter (/remote, spend.mjs): the footer's words, after each answer and every 15 s
  // (today's total counts the other windows too); turnSpend: the window's dollars as a request began.
  const turnSpend = useRef(0);
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
  useEffect(() => {
    if (process.env.AGENTIC_WINDOWS === 'off') return undefined;
    // A moment after the window opens (git is asked which project this is): nothing typed meanwhile waits on it.
    const t = setTimeout(() => {
      let kept = [];
      try {
        const m = copyAt(opts.cwd);
        if (m) { copyRef.current = m; setInCopy(true); registerWindow(opts.cwd, { copyOf: m.original }); }
        else {
          const p = projectOf(opts.cwd);
          registerWindow(opts.cwd);
          othersRef.current = othersIn(p.root);
          kept = keptCopies(p.root);
        }
      } catch {}
      if (othersRef.current.length && !isHomeFolder(opts.cwd)) {
        // Already answering a message typed at once: said in a line instead of asked.
        if (agent.busy) push({ type: 'note', text: 'Another window is also working in this folder. /copy gives this window its own copy.', tone: 'warn' });
        else openChoice('same-folder');
      }
      else if (kept.length) push({ type: 'note', text: `A window that closed earlier left changes in its own copy, not yet put back: open a window in ${tildeOf(kept[0].work)} and type /copy.`, tone: 'warn' });
    }, 300);
    // The window closes: its file goes, and so does its copy when nothing is left to put back.
    let tidied = false;
    const tidy = () => {
      if (tidied) return;
      tidied = true;
      remoteFnRef.current.unloadOnQuit?.();
      unregisterWindow();
      const m = copyRef.current;
      if (!m) return;
      try { if (!copyChanges(m).changes.length) removeCopy(m); } catch {}
    };
    process.once('exit', tidy);
    // The app closes (quit) before the process ends: tidy then.
    return () => { clearTimeout(t); process.off('exit', tidy); tidy(); };
  }, []);
  const pre = useRef(null);
  const lastCheck = useRef(null);
  const push = useCallback((...its) => {
    let list = its;
    if (railOn.current && pre.current && its.some((it) => it.type !== 'machine')) {
      list = [{ type: 'machine', ...pre.current }, ...its];
      pre.current = null;
      setLive((l) => ({ ...l, pre: null }));
    }
    const made = list.map((it) => ({ key: `i${++seq}`, ...(railOn.current && it.rail === undefined ? { rail: true } : {}), ...it }));
    queueMicrotask(() => {
      try { primeRows(made, measure.current); } catch {}
      setItems((xs) => [...xs, ...made]);
    });
  }, []);
  const serverRef = useRef(null);
  const restartRef = useRef(null);
  // The remote in use (/remote): its connection ({ url, stop, … } from
  // connectRemote), why it last failed, and the model on this Mac to go back to.
  const remoteRef = useRef({ conn: null, why: null, on: remoteAtStart });
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
  const fold = (f) => { const s = folds.current; s.list.push(f); if (s.list.length > 50) s.list.shift(); s.back = 0; };
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
  if (rewindRef.current === undefined) rewindRef.current = (process.env.AGENTIC_REWIND ?? process.env.BONSAI_REWIND) === 'off' ? null : new Rewind({ home: HOME, session: sessionRef.current.id });

  // The agent lives for the whole session.
  const agentRef = useRef(null);
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
    agentRef.current = new Agent({
      // "claudeNotes": false in settings.json leaves Claude's notes out; a path names another folder.
      // saveOff: "memorySave": "off" — the model's Remember saves nothing either (agent/way.mjs).
      memory: remembers ? { embedder, claude: claudeOn(settings) ? settings.claudeNotes ?? true : false, saveOff: saveModeOf(settings) === 'off' } : null,
      // Who decides (/effort's last row) and the app's checks switched on for when the model does (/hooks).
      way: limitsRef.current.way, hooks: hooksFrom(settings),
      // The web (/web): a search service and reading pages, each asked about first.
      web: webSettings(settings.web),
      // Helpers the model can hand work to (the Agent tool), unless "subagents": false.
      subagents: settings.subagents !== false,
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
    applyLimits(agentRef.current, limitsRef.current);
    // /effort's Search rows: the retriever, and the reranker when it is on (started at its first use).
    applySearch(agentRef.current, limitsRef.current);
  }
  const agent = agentRef.current;
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
  S.current = { input, perm, picker, popup, menuIndex, mode, starting, live, queued, tooSmall, meters, mouse, btw, answerWait, remoteState, agentsView, agentsState };

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

  // The menus that /mode, /meters and /mouse open when typed alone: a title, a line
  // on what it sets, the options with what each does, the one in use.
  // applyChoice is also what the typed forms use, so both say the same.
  // (/effort opens the Effort and limits panel instead: openEffortLimits.)
  const choiceMenu = (id) => {
    if (id === 'memory-save') {
      // Asked at a start about what the last window's second look found, or after a task.
      const again = pendingSaveRef.current?.again;
      return { title: 'Remember for next time?', blurb: again ? 'What the last window found when it read the conversation again is listed above. /memory undo takes a save back.' : 'What Agentic Coder learned in that task is listed above. /memory undo takes a save back.', what: 'memory', current: 'save', options: [{ id: 'save', label: 'Save', note: 'read at every start from now on' }, { id: 'skip', label: 'Skip', note: 'not saved, and not offered again; /update memory still saves it if you ask' }] };
    }
    if (id === 'startmode') {
      const st = startModeFor(agent.cwd);
      const now = st && !st.here ? ` Now it starts in ${modeWord(st.mode)}, saved ${st.where === 'everywhere' ? 'for every folder' : `for ${st.key.replace(homedir(), '~')}`}.` : '';
      return { title: 'Start-up mode', blurb: `What Agentic Coder starts in for ${agent.cwd.replace(homedir(), '~')}, saved for this folder; /mode and shift+tab change only this conversation.${now}`, what: 'startmode', current: st?.here ? st.mode : 'reset', options: [...MODE_OPTIONS, { id: 'reset', label: 'Not saved', note: 'use the one saved above it or for every folder, else manual' }] };
    }
    if (id === 'mode') return { title: 'Mode', blurb: 'How Agentic Coder asks before it changes things. For this conversation; shift+tab switches too.', what: 'mode', current: agent.mode, options: MODE_OPTIONS };
    if (id === 'vision-get') {
      const gb = ((model.vision?.bytes ?? 0) / 1e9).toFixed(2);
      return { title: `Look at the picture? ${model.name} needs its vision add-on`, blurb: `A one-time download of ${gb} GB (then kept with the model). It loads only in windows where you attach a picture.`, what: 'the picture', current: null, options: [
        { id: 'get', label: `Download it (${gb} GB) and look`, note: 'then the model reloads once with it (about 20 s)' },
        { id: 'skip', label: 'Send without the picture', note: 'the message goes now, with a line saying a picture was attached' },
      ] };
    }
    if (id === 'vision-switch') {
      return { title: `${model.name} cannot look at pictures`, blurb: `Hand this message to a model that can? Only one model fits in memory, so it loads in ${model.name}'s place (about 20–40 s), answers, and ${model.name} comes back after (the conversation stays).`, what: 'the picture', current: null, options: [
        ...seeingModels().map((m) => ({ id: `use:${m.id}`, label: `${m.name} for this message`, note: `it looks at the picture, then ${model.name} again` })),
        { id: 'skip', label: 'Send without the picture', note: `${model.name} answers, with a line saying a picture was attached` },
      ] };
    }
    // Two windows in one project (copies.mjs): asked as a window opens there, and when its copy changed files.
    if (id === 'same-folder') {
      const o = othersRef.current[0];
      const when = o?.at ?? o?.started;
      const mins = when ? Math.max(1, Math.round((Date.now() - Date.parse(when)) / 60_000)) : null;
      return { title: othersRef.current.length > 1 ? `${othersRef.current.length} other windows are already working in this folder` : 'Another window is already working in this folder',
        blurb: o?.task ? `It is working on "${o.task}"${mins ? ` (${mins} min ago)` : ''}.` : 'It has not been given a task yet.', what: 'this folder', current: null, options: [
          { id: 'copy', label: 'Work in my own copy', note: 'both windows can change files safely; I ask before putting my changes back' },
          { id: 'share', label: 'Share this folder', note: 'both change the same files, so one window can overwrite the other\'s work' },
        ] };
    }
    if (id === 'copy-back') {
      const list = copyAsk.current.lines ?? [];
      const word = list.length === 1 ? 'file' : 'files';
      return { title: `This window worked in its own copy and changed ${list.length} ${word}`,
        blurb: `${list.slice(0, 6).map((l) => `${l.path} ${l.status === 'D' ? 'removed' : `+${l.add} −${l.del}${l.status === 'A' ? ' new file' : ''}`}`).join(' · ')}${list.length > 6 ? ` · and ${list.length - 6} more` : ''}`, what: 'the changes', current: null, options: [
          { id: 'back', label: 'Put them back into the real folder', note: `into ${tildeOf(copyRef.current?.original ?? '')}; a file the other window also changed is merged` },
          { id: 'show', label: 'Show me the changes first', note: 'the lines that changed, then this question again' },
          { id: 'later', label: 'Not now', note: 'the copy stays; /copy brings this question back' },
        ] };
    }
    if (id === 'copy-conflict') {
      const c = copyAsk.current.conflicts ?? [];
      return { title: `${c.length === 1 ? '1 file was' : `${c.length} files were`} changed in both windows: ${c.slice(0, 3).join(', ')}${c.length > 3 ? '…' : ''}`,
        blurb: 'The same lines changed here and in the real folder, so these were not put back. The rest went back.', what: 'those files', current: null, options: [
          { id: 'leave', label: 'Leave those as they are', note: 'the real folder keeps its version; /copy asks again later' },
          { id: 'mine', label: 'Use this window\'s version for those', note: 'overwrites the other window\'s change in those files' },
        ] };
    }
    if (id === 'remote-down') {
      const local = localModelRef.current ?? modelById(settings.model) ?? MODELS[DEFAULT_MODEL];
      const why = remoteRef.current.why ?? 'it did not answer';
      return { title: `The remote model is not answering · ${remoteLabel(settings.remote)}`, blurb: `${why[0].toUpperCase()}${why.slice(1)}. Nothing loads on this Mac unless you pick it.`, what: 'the remote', current: null, options: [
        { id: 'retry', label: 'Try again', note: 'connect to it again' },
        { id: 'local', label: `Use ${local.name} on this Mac for now`, note: `loads it here (about ${Math.round((local.bytes ?? 7e9) / 1e9)} GB); the remote stays on for next time` },
        { id: 'edit', label: 'Open /remote', note: 'change the address, the key or how it connects' },
      ] };
    }
    // /model on a service: a model that cannot use tools is picked only after a yes (the user's pick, 1 Oct 2026).
    if (id === 'service-chat-only') {
      const m = chatOnlyRef.current?.m;
      return { title: `${m?.id ?? 'This model'} cannot use tools`, blurb: 'On it Agentic Coder can only answer in words: no file reads, edits, commands or searches. The chat stays, and /model switches back.', what: 'the model', current: 'stay', options: [
        { id: 'stay', label: `Stay on ${model.remote?.model ?? model.name}`, note: 'nothing changes' },
        { id: 'switch', label: `Switch to ${m?.id ?? 'it'} anyway`, note: 'it answers in words only; its settings come next' },
      ] };
    }
    if (id === 'autostart') return { title: 'Model at start', blurb: `Whether ${model.name} loads as a window opens. Off, it waits for /start, so a window you only look around in takes none of the Mac's memory. Kept for next time.`, what: 'the model at start', current: settings.modelAtStart ? 'on' : 'off', options: [{ id: 'off', label: 'Off', note: 'the model loads when you type /start' }, { id: 'on', label: 'On', note: 'the model loads as soon as a window opens' }] };
    if (id === 'mouse') return { title: 'Mouse in the prompt box', blurb: 'Drag over the text you are typing to highlight it: copied at once, delete removes it, typing replaces it. A click on the model’s label in the footer starts or stops it. While it is on the mouse is Agentic Coder’s; hold fn for Terminal’s own highlight. Kept for next time.', what: 'the mouse', current: S.current.mouse ? 'on' : 'off', options: [{ id: 'on', label: 'On', note: 'click, drag to highlight, double click for a word, click the model’s label' }, { id: 'off', label: 'Off', note: 'the mouse stays Terminal’s; option+click and ctrl+t still work' }] };
    return { title: 'Status bar', blurb: 'Model, speed, memory and effort on one line under the prompt. Kept for next time.', what: 'the status bar', current: S.current.meters ? 'on' : 'off', options: [{ id: 'on', label: 'On', note: 'show it under the prompt' }, { id: 'off', label: 'Off', note: 'hide it; /stats has the numbers' }] };
  };
  // The hub in the browser (/weights, /docs, /help): one small server per
  // window, closed with it. Answers { server, url } or null after a warning.
  // extra: more of the hub's address (/test: run=1, the model and test to pick).
  const openHub = (tab, extra = {}) => {
    // The hub always serves and edits the ORIGINAL model file: each save
    // rebuilds the copy from a fresh clone of it plus the whole edit list.
    const base = MODELS[model.edited ? model.edited.base : DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL];
    const onEdits = (e) => {
      if (e.kind === 'save') {
        setEditedSaved((all) => ({ ...all, [e.saved.base]: e.saved }));
        const n = e.saved.edits.length;
        push({ type: 'note', text: `Saved ${MODELS[e.saved.base]?.name ?? model.name} · edited — ${n} edit${n === 1 ? '' : 's'}. Pick it in /model to run on it. The original file is untouched.`, tone: 'dim' });
      } else { setEditedSaved((all) => { const rest = { ...all }; delete rest[e.base]; return rest; }); push({ type: 'note', text: `${MODELS[e.base]?.name ? `${MODELS[e.base].name}’s` : 'The'} edited copy was removed. The original was never touched.`, tone: 'dim' }); }
    };
    // The design style picked on the Instructions page: this window uses it from the next page request, as /design style does.
    const onDesign = (next) => { settings.design = next; if (agentRef.current) agentRef.current.designSaved = next; };
    try { weightsRef.current ??= startWeightsServer({ path: modelPath(base), onEdits, onDesign, cwd }); } catch (e) { push({ type: 'note', text: `Could not start the hub: ${e.message}`, tone: 'warn' }); return null; }
    const more = Object.entries(extra).filter(([, v]) => v != null && v !== '').map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
    const url = `${weightsRef.current.url}?tab=${tab}${more}`;
    if (!(process.env.AGENTIC_NO_OPEN ?? process.env.BONSAI_NO_OPEN)) Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' });
    return { server: weightsRef.current, url };
  };
  // /model picked a different set of weights: only the model server restarts;
  // the window, the conversation and the history all stay. About 40 s: the
  // new weights never reuse a saved warm-up, so the instructions are re-read.
  // /effort uses it too, to restart on a new context or thinking cap (`done` is its note).
  // midTurn: the model asked for it in the middle of its reply (vision for a picture it read).
  const switchModel = async (next, done, { midTurn = false } = {}) => {
    if (S.current.live !== IDLE && !midTurn) { push({ type: 'note', text: 'Agentic Coder is in the middle of a reply. Let it finish (or press esc), then switch.', tone: 'warn' }); return; }
    // The model is off (not started yet, or /stop): the pick is kept and nothing loads; /start loads it.
    if (modelOffNow() && !midTurn) {
      setModel(next);
      relimit(next);
      agent.model = modelWithLimits(next, limitsRef.current);
      push({ type: 'note', text: `${done ? 'It applies' : `${next.name} is picked; it loads`} when you type /start. The model is off, so nothing loads now.`, tone: 'dim' });
      return;
    }
    const cur = serverRef.current;
    // Only one 27B fits in memory, so nobody else may be on the old server.
    const others = cur?.port ? liveUsers(cur.port).filter((p) => p !== process.pid) : [];
    if (others.length) { push({ type: 'note', text: `Another Agentic Coder window is using ${model.name}. Close it first, then switch.`, tone: 'warn' }); return; }
    setModel(next);
    setStarting(true); setStartPhase('loading'); setStartedAt(Date.now());
    // /stop while it switches calls the switch off (stopModel bumps loadRef): it ends quietly.
    const my = ++loadRef.current;
    const stillOn = () => loadRef.current === my && !modelOffNow();
    try {
      const oldPid = cur?.child?.pid ?? cur?.shared?.pid;
      const mem = memoryForRestart(); // before the old server stops: what it gives back counts as free
      await cur?.stop();
      stopIdleServers(); // a server we only attached to (kept loaded earlier) is freed too
      // Wait for the old one to really exit: two 27Bs never fit side by side.
      if (oldPid && !(await exited(oldPid))) throw new Error('the old model server did not stop');
      await waitForBattle(stillOn);
      const back = await waitForOthers(next, stillOn);
      if (!stillOn()) return;
      const fixed = limitsRef.current.context;
      const available = Math.max(mem.free, back, availableBytes());
      const c = fixed ? { ctx: fixed, reason: null } : chooseContext(next, { effort: agent.thinking ? agent.effort : undefined, available });
      // A context you picked is checked on a restart too: used as asked, said when it does not fit.
      if (fixed) {
        const chk = contextCheck(next, fixed, { draft: hasDraft(next), available, search: mem.search(limitsRef.current) });
        c.reason = chk.note;
        if (!chk.fits) push({ type: 'note', text: chk.note, tone: 'warn' });
      }
      memoryNote.current = c.reason ?? null;
      timeLoad(next, true);
      const srv = new ModelServer(modelWithLimits(next, limitsRef.current));
      serverRef.current = srv;
      srv.on('crash', ({ code, signal }) => {
        if (srv.restarts >= 3) { push({ type: 'note', text: `The model server keeps stopping (code ${code ?? signal}). See ~/.agentic-coder/logs/server.log, then restart Agentic Coder.`, tone: 'error' }); return; }
        push({ type: 'note', text: `The model server stopped (code ${code ?? signal}); restarting it.`, tone: 'warn' });
        restartRef.current = srv.restart().then(() => { push({ type: 'note', text: 'The model server is back.', tone: 'dim' }); }).catch((e) => push({ type: 'note', text: e.message, tone: 'error' })).finally(() => { restartRef.current = null; });
      });
      const st = await srv.start({ ctx: c.ctx, lingerSecs: LINGER_SECS, helper: c.helper });
      timeLoaded(st);
      agent.url = srv.url;
      agent.canSee = Boolean(srv.vision);
      relimit(next);
      agent.model = modelWithLimits(next, limitsRef.current);
      agent.ctx = st.ctx ?? c.ctx; setCtx(agent.ctx);
      agent.syncRules(); // rules that follow the Context are read again before the warm-up below
      if (st.slots > 1) agent.slots = { main: 0, side: 1 };
      setStartPhase('reading');
      timeWarmed(await warmUp({ sessionMark: SESSION_MARK, url: srv.url, model: next, system: agent.messages[0].content, tools: agent.tools(), thinking: agent.thinking, effort: agent.effort, slot: agent.slots?.main, helper: srv.draft, onPhase: setStartPhase }));
      timeDone();
      const n = next.edited?.edits.length ?? 0;
      if (done) push({ type: 'note', text: done(agent.ctx), tone: 'dim' });
      else push({ type: 'note', text: next.edited ? `Now on ${next.name} (${n} edit${n === 1 ? '' : 's'}). Pick ${MODELS[next.edited.base].name} in /model to go back.` : `Now on ${next.name}.`, tone: 'dim' });
      if (!stillOn()) return;
    } catch (e) {
      if (!stillOn()) return;
      push({ type: 'note', text: done ? `Could not restart ${next.name}: ${e.message}. /effort to try again.` : `Could not switch: ${e.message}. Pick a model in /model to try again.`, tone: 'error' });
    }
    setStarting(false);
  };
  const openChoice = (id) => { const c = choiceMenu(id); setPicker({ kind: 'choice', id, ...c, index: Math.max(0, c.options.findIndex((o) => o.id === c.current)) }); };

  // ---- Several windows in one project (copies.mjs) ----
  // Makes this window's own copy and moves it there (its tests, its AGENTS.md, its commands).
  const startCopy = () => {
    push({ type: 'note', text: 'Making your own copy of this folder…', tone: 'dim' });
    setTimeout(async () => {
      try {
        const m = makeCopy(agent.cwd);
        agent.moveTo(m.work);
        try { await agent.rewind?.whenMoved(); } catch {}
        copyRef.current = m;
        setInCopy(true);
        registerWindow(m.work, { copyOf: m.original });
        push({ type: 'note', text: `Working in your own copy now (${m.kind === 'worktree' ? 'a git worktree' : 'a copy of the folder'} at ${tildeOf(m.work)}). When a request changes files, I ask before putting them back into ${tildeOf(m.original)}.`, tone: 'dim' });
      } catch (e) {
        push({ type: 'note', text: `Could not make a copy: ${e.message}. This window shares the folder.`, tone: 'warn' });
      }
    }, 30);
  };
  // After a request (or /copy): the copy's changes not yet put back, asked about once per set.
  // force: ask even about changes already answered with "Not now".
  const askCopyBack = ({ force = false } = {}) => {
    const m = copyRef.current;
    if (!m) return false;
    let changes;
    try { changes = copyChanges(m).changes; } catch (e) { push({ type: 'note', text: `Could not look at the copy: ${e.message}.`, tone: 'warn' }); return false; }
    if (!changes.length) return false;
    const key = changes.map((c) => `${c.path}:${c.to}`).join('|');
    if (!force && key === copyAsk.current.key) return false;
    copyAsk.current = { ...copyAsk.current, key, changes, lines: changeLines(m, changes) };
    openChoice('copy-back');
    return true;
  };
  const doPutBack = (opts2 = {}) => {
    const m = copyRef.current;
    if (!m) return;
    let r;
    try { r = putBack(m, opts2); } catch (e) { push({ type: 'note', text: `Could not put the changes back: ${e.message}. They stay in the copy.`, tone: 'error' }); return; }
    const n = r.applied.length;
    if (n) push({ type: 'note', text: `Put ${n === 1 ? '1 file' : `${n} files`} back into ${tildeOf(m.original)}${r.merged.length ? ` (${r.merged.length} merged with the other window's changes)` : ''}.`, tone: 'dim' });
    copyAsk.current.key = null;
    if (r.conflicts.length) { copyAsk.current.conflicts = r.conflicts; setTimeout(() => openChoice('copy-conflict'), 60); }
  };

  // ---- /remote: the model on another machine (remote-form.mjs, models/runtime/remote.mjs) ----
  // To the remote: connect first (the tunnel when it goes by SSH, the key from
  // the Keychain, the check), and only then let the model on this Mac go.
  // One that does not answer changes nothing when this Mac's model is running;
  // at the start (none running) it asks what to do (remote-down).
  // Big-model mode (models/runtime/remote.mjs): /effort's Steps, Tries and Command output start
  // from the model in use, so a switch to or from a big model on a service moves them; what /effort
  // saved still wins. A model on a service with its own settings (/model's menu) has its own rows
  // and its own Effort; the next model has its own, or the shared ones again. Called before
  // agent.model is set; says so when the mode or the settings come or go.
  const relimit = (m) => {
    const was = limitsRef.current;
    const fresh = readLimits({ ...loadSettings(opts.cwd), remote: settings.remote }, m);
    // Who decides moves too: a big model on a service decides for itself (BIG_HARNESS), unless /effort saved one.
    const next = { ...was, ...Object.fromEntries(OWN_ROWS.map((id) => [id, fresh[id]])), way: fresh.way };
    const name = m.remote?.model ?? m.name;
    const own = m.remote ? ownOf(settings, m.remote.model) : null;
    ownLevel(m, own);
    const moved = limitChanges(was, next);
    if (!moved.length) return;
    limitsRef.current = next;
    applyLimits(agent, next);
    const list = moved.map((c) => `${c.label} ${c.from} → ${c.to}`).join(' · ');
    push({ type: 'note', text: m.harness
      ? `Big-model mode for ${name}${own?.limits ? ' and its own settings' : ''}: ${list}, and it reads files ${m.harness.read.whole} lines at a time. /effort changes any of it.`
      : own?.limits ? `${name}’s own settings: ${list}. /effort changes them.`
        : agent.model?.harness ? `Big-model mode off: ${list}.` : `The shared settings again: ${list}.`, tone: 'dim' });
  };
  // Keep loaded (/effort's Model rows): how long the service keeps the model after each request
  // (open: until this window closes, as before), carried by every request to it.
  const applyKeep = (values = limitsRef.current) => {
    const conn = remoteRef.current.conn;
    if (!conn?.info?.ollama) return;
    setEndpoint(conn.url, { ...endpointOf(conn.url), keepAlive: typeof values.keepLoaded === 'number' ? values.keepLoaded : -1 });
  };
  // A model's own Effort (/model's menu), when it has more than one: in use from its next reply.
  const ownLevel = (m, own) => {
    const levels = m.thinkingLevels ?? [];
    const lv = own?.level && levels.length > 1 ? levels.find((l) => l.id === own.level) : null;
    if (lv && lv.id !== thinkingLevel(m, agent.thinking, agent.effort).id) setThinking(Boolean(lv.effort), lv.effort ? lv.id : undefined);
  };
  // A model's own settings on the service (null: none, it follows the shared ones), kept by model
  // in the service's set-up ("tuned"), as its Context is ("contexts", setServiceCtx).
  const setOwn = (name, own) => {
    const src = sourceOf(settings.remote);
    const put = (p) => { const tuned = { ...(p?.tuned ?? {}) }; if (own) tuned[name] = own; else delete tuned[name]; return { ...p, tuned }; };
    const saved = saveSettings({ remote: put(settings.remote), ...(settings.remotes?.[src] ? { remotes: { ...settings.remotes, [src]: put(settings.remotes[src]) } } : {}) });
    settings.remote = saved.remote;
    settings.remotes = saved.remotes;
  };
  const useRemote = async (r, { atStart = false } = {}) => {
    if (!atStart && (S.current.live !== IDLE || agent.busy)) { push({ type: 'note', text: 'Agentic Coder is in the middle of a reply. Let it finish (or press esc), then switch.', tone: 'warn' }); return false; }
    const before = { model, server: serverRef.current };
    if (!model.remote) localModelRef.current = model;
    remoteRef.current.conn?.stop();
    remoteRef.current.conn = null;
    remoteRef.current.on = true;
    setModel(remoteModel(r));
    setStarting(true); setStartPhase('connecting');
    setRemoteState('connecting'); setCatalog(null);
    let conn;
    try { conn = await connectRemote(r, { serviceSize: true }); } catch (e) {
      remoteRef.current.why = e.message;
      setStarting(false);
      if (before.server && !before.model.remote) {
        remoteRef.current.on = false;
        setModel(before.model);
        setRemoteState(null);
        // Kept, but off: the next start does not try a remote that just failed.
        if (settings.remote?.use) settings.remote = saveSettings({ remote: { ...settings.remote, use: false } }).remote;
        push({ type: 'note', text: `The remote at ${remoteLabel(r)} did not answer, so nothing changed: ${e.message}. Still on ${before.model.name}, on this Mac; the remote is saved but off (/remote to fix it and try again).`, tone: 'error' });
        return false;
      }
      setRemoteState('down');
      push({ type: 'note', text: `The remote model at ${remoteLabel(r)} did not answer: ${e.message}.`, tone: 'error' });
      openChoice('remote-down');
      return false;
    }
    remoteRef.current.conn = conn;
    remoteRef.current.why = null;
    // The service this window connected with (never its key): its memory save after you close it goes
    // there too, not to whichever service another window saved since (autosave.mjs).
    agent.remoteConf = remoteConfOf(r);
    serverRef.current = null;
    // The Mac's own model is let go: back on this Mac, it is off until /start.
    wantRef.current = false;
    setModelOff(false);
    await before.server?.stop().catch(() => {});
    setRamGb(null);
    memoryNote.current = null;
    const m = conn.model;
    setModel(m);
    agent.url = conn.url;
    agent.canSee = Boolean(conn.vision);
    relimit(m);
    agent.model = modelWithLimits(m, limitsRef.current);
    applyKeep();
    agent.ctx = conn.ctx; setCtx(conn.ctx);
    agent.slots = conn.slots > 1 ? { main: 0, side: 1 } : null;
    setStartPhase('reading');
    try { await warmUp({ sessionMark: SESSION_MARK, url: conn.url, model: m, system: agent.messages[0].content, tools: agent.tools(), thinking: agent.thinking, effort: agent.effort, slot: agent.slots?.main, onPhase: setStartPhase }); } catch {}
    setStarting(false);
    push({ type: 'note', text: `On the remote: ${m.name} · ${kindWord(r.kind)} · answered in ${conn.info.ms ?? '?'} ms · ${Math.round(conn.ctx / 1024)}k context. Your prompts, your code and the files it reads now go to ${remoteLabel(r)}; /remote switches back.`, tone: 'dim' });
    setRemoteState('on');
    // A model still loading on the service: a waiting message goes once it has (preloadRemote).
    const loading = preloadRemote(conn);
    refreshCatalog(conn);
    const risk = remoteRisk(r);
    if (risk) push({ type: 'note', text: `⚠ ${risk}.`, tone: 'warn' });
    const q = queuedRef.current;
    if (q && loading) { /* sent by preloadRemote */ }
    else if (q) { queuedRef.current = null; setQueued(null); setTimeout(() => remoteFnRef.current.send?.(q), 50); }
    // At the start, as after a start here: the last window's second look is asked about, then (first use here) what is written is read.
    else if (atStart) setTimeout(() => { autoRef.current.atStart(); }, 3000).unref?.();
    return true;
  };
  // Back to the model on this Mac: the tunnel closes. The model loads here only when you ask for
  // it (load: "Use … on this Mac for now", or /autostart on); otherwise it is off until /start.
  const useLocal = async ({ note, load = false } = {}) => {
    if (S.current.live !== IDLE || agent.busy) { push({ type: 'note', text: 'Agentic Coder is in the middle of a reply. Let it finish (or press esc), then switch.', tone: 'warn' }); return; }
    remoteRef.current.on = false;
    remoteRef.current.conn?.stop();
    remoteRef.current.conn = null;
    setRemoteState(null); setCatalog(null);
    const back = localModelRef.current ?? modelById(settings.model) ?? MODELS[DEFAULT_MODEL];
    localModelRef.current = null;
    agent.slots = null;
    agent.remoteConf = null;
    if (!load && !wantRef.current && !loadsAtOpen()) {
      agent.url = 'http://127.0.0.1:0';
      setModel(back);
      relimit(back);
      agent.model = modelWithLimits(back, limitsRef.current);
      setModelOff(true);
      push({ type: 'note', text: `${note ?? `Back on ${back.name}, on this Mac.`} The model is off: /start loads it.`, tone: 'dim' });
      return;
    }
    wantRef.current = true;
    setModelOff(false);
    await switchModel(back, () => note ?? `Back on ${back.name}, on this Mac.`);
  };
  // The remote stopped answering in the middle of a reply: connect again once
  // (a new tunnel, say). If it cannot be reached, the reply stops and you are asked.
  const reconnect = async () => {
    remoteRef.current.conn?.stop();
    remoteRef.current.conn = null;
    setRemoteState('reconnecting');
    try {
      const conn = await connectRemote(settings.remote ?? DEFAULT_REMOTE);
      remoteRef.current.conn = conn;
      agent.url = conn.url;
      setRemoteState('on');
      push({ type: 'note', text: `Connected to the remote again (${remoteLabel(settings.remote)}).`, tone: 'dim' });
    } catch (e) {
      setRemoteState('down');
      remoteRef.current.why = e.message;
      setTimeout(() => openChoice('remote-down'), 0);
      throw new Error(`the remote model at ${remoteLabel(settings.remote)} stopped answering: ${e.message}`);
    }
  };
  // The form opens on the service in use in this window (This Mac when none is),
  // or on `source`; ask: a row to start typing in (/remote claude with no key yet).
  const openRemoteForm = ({ source = null, ask = null } = {}) => {
    const f = openForm(settings, { on: Boolean(remoteRef.current.on), source });
    if (!ask) { setPicker(f); return; }
    setPicker({ ...startEdit({ ...f, index: remoteRows(f).findIndex((r) => r.id === ask) }, ask), ask });
  };
  const busyNow = () => S.current.live !== IDLE || agent.busy || S.current.starting;
  // Saves what the form changed: the keys first (nothing is written when one
  // cannot be kept), then settings.json. Answers the plan, or null.
  const keepForm = (pk, { connect }) => {
    const plan = savePlan(pk, settings, { connect });
    if (formWarning(pk)?.tone === 'error' && pk.source !== 'here') { setPicker({ ...pk, tried: true, error: 'Nothing was saved: fix the line above first.' }); return null; }
    try {
      for (const k of plan.keys) { if (k.op === 'save') saveKey(k.key, k.id, `Agentic Coder · ${sourceWord(k.source)}`); else removeKey(k.id); }
    } catch (e) { setPicker({ ...pk, error: `Nothing was saved: the key could not be kept (${e.message}).` }); return null; }
    const next = saveSettings({ remotes: plan.remotes, ...(plan.remote ? { remote: plan.remote } : {}), ...(plan.memoryToRemote ? { memoryToRemote: plan.memoryToRemote } : {}) });
    settings.remotes = next.remotes;
    if (plan.remote) settings.remote = next.remote;
    if (plan.memoryToRemote) settings.memoryToRemote = next.memoryToRemote;
    return plan;
  };
  // Connect: the shown service's rows are checked as they are (the tunnel opened
  // and closed for it); only when that works are they saved and the window
  // switched. One that does not work leaves the form open with what it found.
  // Several models and none named: the list opens (a coder highlighted); enter
  // picks one and the check runs again. This Mac: back to the model here.
  const connectForm = (pk) => {
    if (pk.source === 'here') {
      if (remoteRef.current.on && busyNow()) { setPicker({ ...pk, error: 'Agentic Coder is busy (a reply, or a model starting): switch when it is done.' }); return; }
      if (!keepForm(pk, { connect: true })) return;
      setPicker(null);
      if (remoteRef.current.on) useLocal();
      else push({ type: 'note', text: 'Already on this Mac. The remotes stay saved: Run on (or /remote claude) switches.', tone: 'dim' });
      return;
    }
    if (formWarning({ ...pk, tried: true })?.tone === 'error') { setPicker({ ...pk, tried: true, error: null }); return; }
    if (busyNow()) { setPicker({ ...pk, error: 'Agentic Coder is busy (a reply, or a model starting). Nothing was saved: connect again when it is done.' }); return; }
    const id = (remoteRef.current.tests = (remoteRef.current.tests ?? 0) + 1);
    setPicker({ ...pk, tried: true, test: { running: true, id }, error: null, pick: null });
    // The check's line says what it waits for and counts the seconds; closing the form (or a
    // new check) stops the request, so a model is not left loading on the service for nothing.
    const stop = new AbortController();
    const t0 = Date.now();
    let found = null;
    const mine = () => { const p = S.current.picker; return p?.kind === 'remote' && p.test?.id === id ? p : null; };
    const tick = setInterval(() => {
      const p = mine();
      if (!p) { stop.abort(); clearInterval(tick); return; }
      if (p.test.running && found) setPicker({ ...p, test: { ...p.test, ...found, secs: Math.round((Date.now() - t0) / 1000) } });
    }, 1000);
    testForm(pk, { autoPick: false, signal: stop.signal, onStep: (f) => { found = f; } }).finally(() => clearInterval(tick)).then((res) => {
      const p = S.current.picker;
      if (p?.kind !== 'remote' || p.test?.id !== id) return;
      const done = withTest(p, res, id);
      if (res.needModel && res.models?.length > 1) { setPicker(openModelPick(done, res.models)); return; }
      if (!res.ok) { setPicker(done); return; }
      if (busyNow()) { setPicker({ ...done, error: 'It works, but Agentic Coder got busy meanwhile. Nothing was saved: connect again when it is done.' }); return; }
      const before = settings.remote;
      const plan = keepForm(done, { connect: true });
      if (!plan) return;
      setPicker(null);
      const r = settings.remote;
      if (!remoteRef.current.on || !remoteRef.current.conn || connectionChanged(before, r, plan.keys.some((k) => k.op === 'save' && k.id === done.source))) { useRemote(r); return; }
      push({ type: 'note', text: `${sourceWord(done.source)} saved and still in use (${remoteLabel(r)}).`, tone: 'dim' });
    });
  };
  // Save only: kept for next time; this window stays where it is.
  const saveOnlyForm = (pk) => {
    const plan = keepForm(pk, { connect: false });
    if (!plan) return;
    setPicker(null);
    const r = plan.remotes[pk.source];
    const where = remoteRef.current.on ? sourceWord(sourceOf(settings.remote)) : 'this Mac';
    const inUse = remoteRef.current.on && sourceOf(settings.remote) === pk.source;
    push({ type: 'note', text: `${sourceWord(pk.source)} saved${r?.address ? ` (${remoteLabel(r)}${r.key ? ' · with a key' : ''})` : r?.key ? ' (with a key)' : ''}. This window stays on ${where}${inUse ? ': the changes are used from the next Connect or start' : `; Connect (or /remote ${pk.source === 'machine' ? 'computer' : pk.source === 'openai' ? 'service' : 'claude'}) switches`}.`, tone: 'dim' });
  };
  // /remote claude, /remote computer, /remote service: straight to that saved
  // service; one not set up yet opens the form on it, typing in its first row.
  const remoteTo = (source) => {
    const r = remotesOf(settings)[source];
    if (!readyRemote(r)) { openRemoteForm({ source, ask: source === 'claude' ? 'key' : 'address' }); return; }
    if (remoteRef.current.on && remoteRef.current.conn && sourceOf(settings.remote) === source) { push({ type: 'note', text: `Already on ${sourceWord(source)} (${remoteLabel(settings.remote)}).`, tone: 'dim' }); return; }
    settings.remote = saveSettings({ remote: { ...r, use: true } }).remote;
    useRemote(settings.remote);
  };
  // An Ollama service's list (ollama.mjs), read in the background: after a connect, and as /model opens.
  const refreshCatalog = (conn = remoteRef.current.conn) => {
    if (!conn?.info?.ollama) return;
    ollamaCatalog({ url: conn.url }).then((c) => { if (c && remoteRef.current.conn === conn) setCatalog(c); }).catch(() => {});
  };
  // An Ollama model's own context (/effort's Context row; 0: the service's own), kept by model in
  // the service's set-up ("contexts"), so `coding -p` and the next start ask for it too.
  const serviceCtx = (name = model.remote?.model) => Number(settings.remote?.contexts?.[name]) || 0;
  // On an Ollama service now (connected): its models' context is theirs, not this Mac's.
  const onService = () => Boolean(model.remote?.ollama && remoteRef.current.conn?.info?.ollama);
  const setServiceCtx = (name, v) => {
    const src = sourceOf(settings.remote);
    const put = (p) => { const contexts = { ...(p?.contexts ?? {}) }; if (v) contexts[name] = v; else delete contexts[name]; return { ...p, contexts }; };
    const saved = saveSettings({ remote: put(settings.remote), ...(settings.remotes?.[src] ? { remotes: { ...settings.remotes, [src]: put(settings.remotes[src]) } } : {}) });
    settings.remote = saved.remote;
    settings.remotes = saved.remotes;
  };
  // A message that waited while a model loaded on the service goes now.
  const flushQueued = () => {
    const q = queuedRef.current;
    if (q) { queuedRef.current = null; setQueued(null); setTimeout(() => remoteFnRef.current.send?.(q), 50); }
  };
  // A model not loaded on the service (or loaded at another context than it is to run at) is loaded
  // now, with an empty prompt, so a switch is not first felt on the next reply: the footer says so,
  // and a message sent meanwhile waits for it. Then the context it really runs at is read and used
  // (until then no more than 32k is planned for: Ollama cuts a longer prompt without a word).
  // One that does not fit in the service's GPU memory is tried again at half the context, down to
  // 32k, and the size it fitted at is kept for that model; one that never loads gives way to `back`,
  // the model in use before, and says why (the user's pick, 1 Oct 2026). Answers whether it loads.
  // After the model is loaded (or was): this window notes what it uses on the service, the model
  // left behind is let go (only you use the service: the user's pick, 2 Oct 2026; never one another
  // window uses), and a model never tried gets its try-out.
  const afterLoad = (conn, { back = null } = {}) => {
    const name = conn?.info?.model;
    if (!name || !conn.info.ollama) return;
    noteModels(conn);
    if (back && back !== name && !modelsInUseOn(conn.url).has(back)) {
      unloadOllama({ url: conn.url, model: back }).then((ok) => { if (ok) { push({ type: 'note', text: `${back} let go on the service, so ${name} has its room.`, tone: 'dim' }); refreshCatalog(conn); } });
    }
    maybeTryOut(conn);
  };
  // The window closes: what it used on the service is let go, unless another window uses it. The
  // process is ending, so it is one curl the window waits for (at most 2 seconds), with the key on
  // its stdin, never on its command line.
  remoteFnRef.current.unloadOnQuit = () => {
    const conn = remoteRef.current.conn;
    if (!conn?.info?.ollama || process.env.AGENTIC_UNLOAD === 'off') return;
    const others = modelsInUseOn(conn.url);
    const helpers = Object.values(agent.helperJobs ?? {}).filter((j) => j.on && j.model && j.model !== MAIN).map((j) => j.model);
    const names = [...new Set([conn.info.model, ...helpers])].filter((n) => n && !others.has(n));
    if (!names.length) return;
    const head = { ...remoteRef.current.headers, ...authHeaders(conn.url) };
    const q = (v) => JSON.stringify(String(v));
    const one = (name) => [`url = ${q(`${conn.url.replace(/\/+$/, '')}/api/generate`)}`, `header = ${q('Content-Type: application/json')}`, ...Object.entries(head).map(([k, v]) => `header = ${q(`${k}: ${v}`)}`), `data = ${q(JSON.stringify({ model: name, keep_alive: 0 }))}`, 'output = "/dev/null"'].join('\n');
    try { spawnSync('curl', ['-s', '-Z', '--connect-timeout', '1', '-m', '2', '-K', '-'], { input: names.map(one).join('\nnext\n'), timeout: 2500, stdio: ['pipe', 'ignore', 'ignore'] }); } catch { /* the service lets them go by itself later */ }
  };
  // What this window uses on the service (copies.mjs): the main model and the helpers that are loaded.
  const noteModels = (conn = remoteRef.current.conn) => {
    if (!conn?.info?.ollama) { updateWindow({ service: null, models: [] }); return; }
    const helpers = Object.values(agent.helperJobs ?? {}).filter((j) => j.on && j.model && j.model !== MAIN).map((j) => j.model);
    updateWindow({ service: conn.url, models: [...new Set([conn.info.model, ...helpers])] });
    // Kept for the window's close: the endpoint (and its key) is gone by then.
    remoteRef.current.headers = authHeaders(conn.url);
  };
  // The try-out (agent/tryout.mjs): the first time a model on a service is picked, three short real
  // steps, in the background; the result is kept (tryouts.mjs) and shows in /model and /remote.
  const maybeTryOut = (conn) => {
    const name = conn?.info?.model;
    const where = settings.remote?.address;
    if (!name || !where || process.env.AGENTIC_TRYOUT === 'off') return;
    const entry = catalog?.models.find((m) => m.id === name) ?? conn.info.ollama ?? {};
    if (entry.tools === false || readTryouts(where)[name] || remoteRef.current.trying === name) return;
    remoteRef.current.trying = name;
    push({ type: 'note', text: `Trying ${name} once: it reads a file, fixes one line and runs a command (nothing is changed for real).`, tone: 'dim' });
    tryOut({ url: conn.url, model: name, entry, numCtx: conn.numCtx ?? undefined, keepAlive: -1 }).then((r) => {
      saveTryout(where, name, { ok: r.ok, tokS: r.tokS ?? null, why: r.why, steps: r.steps, secs: r.secs });
      push({ type: 'note', text: `${r.ok ? '✔' : '✗'} ${name}: ${r.steps.map((x) => `${x.ok ? '✔' : '✗'} ${x.text}`).join(' · ')}${r.tokS ? ` · ${Math.round(r.tokS)} tok/s` : ''}. ${r.ok ? 'It works with the agent; kept for next time.' : `It did not pass (${r.why}): /model shows ✗ beside it; it can still be used.`}`, tone: r.ok ? 'dim' : 'warn' });
      refreshCatalog(conn);
    }).catch(() => {}).finally(() => { if (remoteRef.current.trying === name) remoteRef.current.trying = null; });
  };
  const preloadRemote = (conn, { back = null, skip = new Set() } = {}) => {
    const o = conn?.info?.ollama;
    if (!o || (o.loaded && (!conn.numCtx || o.loadedCtx === conn.numCtx))) { afterLoad(conn, { back }); return false; }
    const my = (remoteRef.current.loads = (remoteRef.current.loads ?? 0) + 1);
    const mine = () => remoteRef.current.loads === my && remoteRef.current.conn === conn;
    const name = conn.info.model;
    const asked = conn.numCtx ?? null;
    const t0 = Date.now();
    setRemoteState('loading');
    (async () => {
      let numCtx = asked;
      // The service's own is at most the model's longest (256k here for most).
      let at = numCtx || Math.min(o.ctx || 262_144, 262_144);
      let err = null;
      for (;;) {
        try {
          await preloadOllama({ url: conn.url, model: name, numCtx, keepAlive: -1 });
          // The service's own size is less than the agent works in (Ollama's own is 4k): loaded again at
          // the floor, and kept for it below.
          const own = numCtx ? null : (await ollamaModel({ url: conn.url, model: name }).catch(() => null))?.loadedCtx;
          if (own && own < floorCtx(o) && mine()) { numCtx = at = floorCtx(o); conn.numCtx = numCtx; setEndpoint(conn.url, { ...endpointOf(conn.url), numCtx }); continue; }
          err = null; break;
        } catch (e) { err = e; }
        if (!mine() || !isOutOfMemory(err.message) || at / 2 < 32_768) break;
        push({ type: 'note', text: `${name} did not fit on the service at ${ctxWord(at)} context: trying ${ctxWord(at / 2)}…`, tone: 'warn' });
        at /= 2;
        numCtx = at;
        conn.numCtx = numCtx;
        setEndpoint(conn.url, { ...endpointOf(conn.url), numCtx });
      }
      if (!mine()) return;
      if (!err) {
        const now = await ollamaModel({ url: conn.url, model: name }).catch(() => null);
        if (!mine()) return;
        const real = now?.loadedCtx || numCtx;
        if (real && real !== agent.ctx) { conn.ctx = real; agent.ctx = real; setCtx(real); agent.syncRules(); }
        // Loaded at the service's own: that size is named from now on (the model is not loaded again for a request).
        if (!numCtx && real) { conn.numCtx = real; setEndpoint(conn.url, { ...endpointOf(conn.url), numCtx: real }); }
        // It fitted only smaller: that size is kept for it, so the next switch loads it at once.
        if (numCtx !== asked) setServiceCtx(name, numCtx);
        setRemoteState('on');
        push({ type: 'note', text: `${name} is loaded on the service (${Math.max(1, Math.round((Date.now() - t0) / 1000))} s)${real ? ` · ${ctxWord(agent.ctx)} context` : ''}.${numCtx !== asked ? ' Kept at that size for it; /effort’s Context row changes it.' : ''}`, tone: 'dim' });
        refreshCatalog(conn);
        afterLoad(conn, { back });
        flushQueued();
        return;
      }
      const gb = catalog?.models.find((m) => m.id === name)?.bytes;
      const why = isOutOfMemory(err.message)
        ? `the service has no room for it${gb ? ` (its weights alone are ${(gb / 1e9).toFixed(1)} GB)` : ''}, even at ${ctxWord(at)} context, next to the models it keeps loaded`
        : err.message;
      if (back && back !== name) {
        push({ type: 'note', text: `${name} did not load on the service: ${why}. Back on ${back}.`, tone: 'warn' });
        try {
          const c2 = await useServiceModel(back);
          setRemoteState('on');
          refreshCatalog(c2);
          if (!preloadRemote(c2)) flushQueued();
        } catch (e) {
          setRemoteState('down');
          push({ type: 'note', text: `${back} did not answer either: ${e.message}. /model or /remote to pick another.`, tone: 'error' });
        }
        return;
      }
      // No model to go back to: a backup, the best one that passed its try-out (or else the suggestion).
      // (At most two spares in a row: a service with no room for any gets a note, not a loop.)
      const gone = new Set([...skip, name]);
      const spare = catalog && gone.size <= 2 ? suggestModel(catalog.models.filter((m) => !gone.has(m.id)), readTryouts(settings.remote?.address)) : null;
      if (spare) {
        push({ type: 'note', text: `${name} did not load on the service: ${why}. Using ${spare} instead (/model picks another).`, tone: 'warn' });
        try {
          const c2 = await useServiceModel(spare);
          setRemoteState('on');
          refreshCatalog(c2);
          if (!preloadRemote(c2, { skip: gone })) flushQueued();
          return;
        } catch (e) { push({ type: 'note', text: `${spare} did not answer either: ${e.message}.`, tone: 'error' }); }
      }
      setRemoteState('on');
      push({ type: 'note', text: `${name} did not load on the service: ${why}. /model picks another.`, tone: 'warn' });
      flushQueued();
    })();
    return true;
  };
  // Points this window at another model on the same service: it is checked (it answers, what it can
  // do), the pick is kept for next time, and the agent goes on with it. Throws when it does not answer.
  const useServiceModel = async (id) => {
    const before = remoteRef.current.conn;
    const r = { ...settings.remote, model: id };
    const conn = await connectRemote(r, { serviceSize: true });
    // The same address (http): its endpoint now names the new model. A tunnel of its own (ssh): the old one closes.
    if (before && before.url !== conn.url) before.stop();
    remoteRef.current.conn = conn;
    remoteRef.current.why = null;
    agent.remoteConf = remoteConfOf(r);
    const src = sourceOf(r);
    const saved = saveSettings({ remote: r, ...(settings.remotes?.[src] ? { remotes: { ...settings.remotes, [src]: { ...settings.remotes[src], model: id } } } : {}) });
    settings.remote = saved.remote;
    settings.remotes = saved.remotes;
    const m = conn.model;
    setModel(m);
    agent.url = conn.url;
    agent.canSee = Boolean(conn.vision);
    relimit(m);
    agent.model = modelWithLimits(m, limitsRef.current);
    applyKeep();
    agent.ctx = conn.ctx; setCtx(conn.ctx);
    agent.syncRules();
    return conn;
  };
  // /model on an Ollama service: another of its models, in place. The chat stays (one longer than
  // the new model's context is summed up before the next reply, as when a chat fills). One that does
  // not answer changes nothing; one that does not load goes back to this one (preloadRemote).
  const switchService = async (entry) => {
    if (busyNow()) { push({ type: 'note', text: 'Agentic Coder is in the middle of a reply. Let it finish (or press esc), then switch.', tone: 'warn' }); return; }
    const back = model.remote?.model ?? null;
    setRemoteState('connecting');
    let conn;
    try { conn = await useServiceModel(entry.id); } catch (e) {
      setRemoteState(remoteRef.current.conn ? 'on' : 'down');
      push({ type: 'note', text: `Could not switch to ${entry.id}: ${e.message}. Still on ${back ?? model.name}.`, tone: 'error' });
      return;
    }
    setRemoteState('on');
    // What it runs at: the size kept for it, else (loaded) the one it has; a cold model's own is
    // said by the note once it has loaded (until then no more than 32k is planned for).
    const room = conn.numCtx || entry.loadedCtx || entry.ctx || conn.ctx;
    const used = agent.ctxUsed ?? 0;
    push({ type: 'note', text: `Now on ${entry.id} on ${remoteLabel(settings.remote)}${conn.numCtx || entry.loaded ? ` · ${ctxWord(room)} context` : ''}. The chat stays${used > room * 0.85 ? `; at about ${ctxWord(used)} it is more than fits, so the oldest part is summed up before the next reply` : ''}.${entry.tools ? '' : ' It cannot use tools: it answers in words only.'}`, tone: 'dim' });
    preloadRemote(conn, { back });
    refreshCatalog(conn);
  };
  // /model: the model list and the thinking level in one picker. Each model's edited copy, when
  // one is saved, is one more row after the models, and each service set up in /remote one more
  // (Claude API, the other computer, another service). On an Ollama service it is the service's
  // own list instead (remote-models.mjs), read again as it opens; this Mac's models and the other
  // services follow it, and enter on one of its models opens that model's own settings first
  // (openOwnSettings). Elsewhere its Effort starts from the one you chose, whatever the model in use allows.
  const openModelPicker = () => {
    const conn = remoteRef.current.conn;
    if (model.remote && conn?.info?.ollama) {
      refreshCatalog(conn);
      const last = localModelRef.current ?? modelById(settings.model);
      const sv = { title: sourceWord(model.remote.source), where: model.remote.label, ms: conn.info.ms ?? null, mac: [...Object.values(MODELS), ...editedModels()], services: remoteChoices(settings).filter((x) => x.source !== model.remote.source), lastLocal: last?.name ?? null };
      setPicker({ ...openService({ inUse: model.remote.model }), sv });
      return;
    }
    const lvNow = thinkingLevel(model, agent.thinking, agent.effort);
    const models = [...Object.values(MODELS), ...editedModels(), ...remoteChoices(settings)];
    setPicker({ kind: 'model', models, index: Math.max(0, models.findIndex((m) => (model.remote ? m.source === model.remote.source : m.id === model.id))), levelId: lvNow.id, on: Boolean(lvNow.effort) });
  };
  // /subagents: the helper models on an Ollama service, one row per job (subagents.mjs). The jobs are
  // kept by service address; changes are saved as they are made.
  const subagentsKey = () => serviceKey(settings.remote?.address ?? '');
  const openSubagentsPanel = () => {
    const conn = remoteRef.current.conn;
    if (!(model.remote && conn?.info?.ollama)) { push({ type: 'note', text: 'Subagents are helper models on an Ollama service: connect to one first (/remote service), then /subagents gives each job a model.', tone: 'dim' }); return; }
    const open = (c) => setPicker(openSubagents(jobsOf(settings.helperModels?.[subagentsKey()] ?? {}, c?.models ?? [], model.remote.model)));
    if (catalog) { open(catalog); refreshCatalog(conn); return; }
    ollamaCatalog({ url: conn.url }).then((c) => { if (c) setCatalog(c); open(c); }).catch(() => open(null));
  };
  // Kept as settings.json `helperModels` by service ("subagents" there already switches the Agent tool).
  const saveSubagents = (jobs) => {
    settings.helperModels = saveSettings({ helperModels: { ...(settings.helperModels ?? {}), [subagentsKey()]: savedOf(jobs) } }).helperModels;
    applyHelpers();
  };
  // The jobs the agent works with (helper-models.mjs): each with the service's entry for its
  // model, and the code search's embedder from the service when that job is on.
  const applyHelpers = (c = catalog) => {
    const conn = remoteRef.current.conn;
    if (!(model.remote?.ollama && conn?.info?.ollama && c?.models?.length)) { agent.helperJobs = null; agent.searchEmbedder = null; return; }
    const jobs = jobsOf(settings.helperModels?.[subagentsKey()] ?? {}, c.models, model.remote.model);
    agent.helperJobs = Object.fromEntries(jobs.map((j) => [j.id, { on: j.on, model: j.model, entry: c.models.find((m) => m.id === j.model) ?? null }]));
    const search = agent.helperJobs.search;
    const want = search?.on && search.model && search.model !== MAIN ? `${conn.url}|${search.model}` : null;
    if (!want) agent.searchEmbedder = null;
    else if (agent.searchEmbedder?.key !== want) { agent.searchEmbedder = new RemoteEmbedder({ url: conn.url, model: search.model }); agent.searchEmbedder.key = want; }
  };
  useEffect(() => { applyHelpers(catalog); }, [catalog, model]);
  // enter on a job: its model is loaded on the service now (a search model is asked for one meaning).
  const loadSubagent = (job) => {
    const conn = remoteRef.current.conn;
    if (!conn || !job.on || !job.model || job.model === MAIN) return;
    const m = catalog?.models.find((x) => x.id === job.model);
    if (m?.loaded) { push({ type: 'note', text: `${job.model} is already loaded on the service.`, tone: 'dim' }); return; }
    push({ type: 'note', text: `Loading ${job.model} on the service for ${job.label}…`, tone: 'dim' });
    const t0 = Date.now();
    const go = m?.embedding
      ? fetch(`${conn.url.replace(/\/+$/, '')}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders(conn.url) }, body: JSON.stringify({ model: job.model, input: 'ready' }) }).then((r) => { if (!r.ok) throw new Error(`${r.status}`); })
      : preloadOllama({ url: conn.url, model: job.model, numCtx: HELPER_CTX[job.id] ?? undefined, keepAlive: HELPER_KEEP });
    go.then(() => { push({ type: 'note', text: `${job.model} is loaded (${Math.max(1, Math.round((Date.now() - t0) / 1000))} s).`, tone: 'dim' }); refreshCatalog(conn); noteModels(conn); })
      .catch((e) => push({ type: 'note', text: `${job.model} did not load: ${isOutOfMemory(e.message) ? 'the service has no room for it next to the main model' : e.message}.`, tone: 'warn' }));
  };
  // What the service's /model draws from: what was set as it opened, and what moves (the list, the chat).
  const serviceOf = (pk) => ({ ...pk.sv, catalog, version: catalog?.version ?? model.remote?.ollama ?? null, inUse: model.remote?.model ?? null, used: agent.ctxUsed ?? 0, tried: readTryouts(settings.remote?.address) });
  // The screen's part of it: the list.
  const serviceProps = (pk) => ({ service: serviceOf(pk) });
  // A model on this Mac picked while on a remote: back to this Mac with it (the remote stays saved, off).
  const pickHere = (picked) => {
    localModelRef.current = picked;
    settings.remote = saveSettings({ model: picked.id, remote: { ...(settings.remote ?? DEFAULT_REMOTE), use: false } }).remote;
    useLocal({ note: `Now on ${picked.name}, on this Mac. /remote turns the remote back on.` });
  };
  remoteFnRef.current = { ...remoteFnRef.current, useRemote, useLocal, reconnect, openForm: openRemoteForm, to: remoteTo };

  // ---- /web: what the model may do on the web (web-form.mjs, tools/web.mjs) ----
  const openWebPicker = () => setPicker(openWebForm(settings.web, { claude: model.remote?.kind === 'claude' }));
  const runWebTest = (pk) => {
    const id = (remoteRef.current.tests = (remoteRef.current.tests ?? 0) + 1);
    setPicker({ ...pk, test: { running: true, id }, error: null });
    testWebForm(pk).then((res) => setPicker((p) => (p?.kind !== 'web' || p.test?.id !== id ? p : { ...p, test: { ...res, id } })));
  };
  // Save: the search service's key to the Keychain (its own entry), the rest to settings.json.
  // The tools change with it, so the next reply reads the instructions again.
  const saveWeb = (pk) => {
    if (webWarning(pk)?.tone === 'error') { setPicker({ ...pk, error: 'Nothing was saved: fix the line above first.' }); return; }
    const v = pk.values;
    if (v.search !== 'off' && pk.key !== null) {
      try { if (pk.key) saveKey(pk.key, searchKeyId(v.search), 'Agentic Coder web search'); else removeKey(searchKeyId(v.search)); } catch (e) { setPicker({ ...pk, error: `Nothing was saved: the key could not be kept (${e.message}).` }); return; }
    }
    const w = toWebSettings(pk);
    setPicker(null);
    settings.web = saveSettings({ web: w }).web;
    agent.web = webSettings(settings.web);
    push({ type: 'note', text: `Web saved: ${w.search === 'off' ? 'no search' : `search with ${PROVIDER_NAMES[w.search]}${w.keys[w.search] ? '' : ' (no key yet)'}`} · ${w.fetch ? 'pages can be read, each site asked about first' : 'no pages read'}${model.remote?.kind === 'claude' ? ` · on the Claude API: ${w.claude ? 'Claude’s own web tools' : 'none'}` : ''}.`, tone: 'dim' });
  };

  // ---- pictures: the model's vision add-on, loaded when a picture is first attached ----
  // The other models on this Mac that can look at pictures (their file and their add-on here).
  const seeingModels = () => Object.values(MODELS).filter((m) => m.id !== model.id && m.vision && existsSync(modelPath(m)) && existsSync(visionPath(m)));
  // After the reply of a model that took one message with a picture: the model you
  // had comes back (the conversation stays). true when it switched.
  remoteFnRef.current.switchBack = async () => {
    const back = switchBackRef.current;
    if (!back) return false;
    switchBackRef.current = null;
    await switchModel(back, () => `Back on ${back.name}.`);
    return true;
  };
  // true: the message waits (vision turning on, or a question about downloading it);
  // false: it goes now (text only, with a note why).
  const needVision = (value, shown) => {
    // A Pictures helper on the service (/subagents) describes it; the message goes now.
    if (model.remote && agent.helperUse?.('pictures')) return false;
    if (model.remote) { push({ type: 'note', text: `The remote model (${remoteLabel(settings.remote)}) cannot look at pictures${model.remote.kind === 'llama' ? ': its coding serve has no vision add-on (coding setup there gets it)' : ''}. The message goes with a line saying so.`, tone: 'warn' }); return false; }
    if (opts.url) { push({ type: 'note', text: 'The model server given with --url is not looking at pictures (start it with its --mmproj file). The message goes with a line saying so.', tone: 'warn' }); return false; }
    if (!model.vision) {
      // Another model on this Mac can: you are asked whether it takes this message.
      if (seeingModels().length) { visionWaitRef.current = { value, shown }; openChoice('vision-switch'); return true; }
      push({ type: 'note', text: `${model.name} cannot look at pictures. The message goes with a line saying so.`, tone: 'warn' });
      return false;
    }
    visionWaitRef.current = { value, shown };
    if (!existsSync(visionPath(model))) { openChoice('vision-get'); return true; }
    turnVisionOn();
    return true;
  };
  const turnVisionOn = async () => {
    const wait = visionWaitRef.current;
    push({ type: 'note', text: `Turning on ${model.name}'s vision: a reload of about 20 s (the conversation stays). Your message goes as soon as it can see.`, tone: 'dim' });
    await switchModel(withVision(model), () => `${model.name} can look at pictures now: it stays on for this window.`);
    visionWaitRef.current = null;
    if (wait) setTimeout(() => remoteFnRef.current.send?.(wait.value, wait.shown, { visionAsked: true }), 50);
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
  // /settings: the commands kept out of the / menu, each row with what it
  // holds right now (none reads blank); enter runs the row's command.
  const openSettings = () => {
    const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
    const tokK = (t) => `${(t / 1024).toFixed(t < 10240 ? 1 : 0)}k`;
    const dirs = agent.memory ? memoryDirs(cwd) : null;
    const facts = (d) => (d ? readFacts(d).length : 0);
    let ins = null;
    try { ins = readInstructions(); } catch {}
    const steps = (t) => (String(t ?? '').match(/^\d+\./gm) ?? []).length;
    const docs = listDocs(findDocsDir());
    const runs = readRecord();
    const last = runs[0];
    const bc = battleCounts();
    const value = {
      meters: S.current.meters ? 'on' : 'off',
      mouse: S.current.mouse ? 'on' : 'off',
      autostart: settings.modelAtStart ? 'on · loads at once' : 'off · /start loads it',
      helpers: `${agent.helpers.size} of 4 on`,
      hooks: agent.way === 'app' ? 'all run: App decides' : `${agent.hooks.size} of ${HOOKS.length} on`,
      permissions: settingsValue(agent.cwd),
      web: (() => { const w = webSettings(settings.web); return `${w.search === 'off' ? 'no search' : PROVIDER_NAMES[w.search]} · pages ${w.fetch ? 'on' : 'off'}`; })(),
      rules: dirs ? n(rulesList(dirs).always.length, 'rule') : 'memory off here',
      instructions: ins ? `${steps(ins.sections.general)} general · ${steps(ins.sections.planning)} planning` : 'could not read',
      memory: dirs ? `${facts(dirs.you)} about you · ${facts(dirs.project)} here` : 'off here',
      weights: (() => { const here = Object.values(MODELS).filter((m) => m.format !== 'mlx' && existsSync(modelPath(m))); return here.length > 1 ? here.map((m) => m.name).join(' · ') : here.length ? `${here[0].name} · ${(statSync(modelPath(here[0])).size / 1e9).toFixed(2)} GB` : 'no model file here yet'; })(),
      docs: docs.missing ? 'DOCS folder not found' : n(docs.pages.length, 'page'),
      tests: last ? `${n(runs.length, 'run')} · last ${last.total != null ? `${last.passed}/${last.total}` : last.result}` : 'no runs yet',
      arena: battleHold() ? 'something is running there' : `${n(bc.tests, 'test')} · ${n(bc.battles, 'run')}`,
      stats: `${tokK(agent.ctxUsed ?? 0)} of ${tokK(agent.ctx)} context`,
      doctor: `${(availableBytes() / 1e9).toFixed(1)} GB free now`,
      init: existsSync(join(cwd, 'AGENTS.md')) ? 'AGENTS.md is here' : 'no AGENTS.md yet',
      update: update ? (update.kind === 'pull' ? 'new code on GitHub' : 'new code waiting') : `${VERSION} · nothing new`,
    };
    const groups = SETTINGS.map((g) => ({ group: g.group, rows: g.rows.map((r) => ({ ...r, value: value[r.name] })) }));
    setPicker({ kind: 'settings', groups, rows: groups.flatMap((g) => g.rows), index: 0 });
  };
  // /permissions alone: its five rows, each with what it holds now; enter opens
  // one (a list, or the start-up mode picker) by running its typed form.
  // /rewind and esc twice on an empty prompt: your messages, newest first,
  // then what to put back to before the one you pick.
  const openRewind = () => {
    const rw = rewindRef.current;
    if (agent.busy || S.current.live.phase === 'working') { flash('Wait for Agentic Coder to finish, or press esc first'); return; }
    if (!rw) { push({ type: 'note', text: 'Rewind is off here (AGENTIC_REWIND=off).', tone: 'dim' }); return; }
    const items = rw.list().map((m) => ({ ...m, talk: rw.messageIndex(agent.messages, m.n) > 0 }));
    if (!items.length) { push({ type: 'note', text: 'Nothing to rewind yet: once you send a message, /rewind (or esc twice) can put things back to before it.', tone: 'dim' }); return; }
    setNotice(null); // "Press esc again to rewind" has done its job
    setPicker({ kind: 'rewind', stage: 'list', items: items.map((m) => ({ ...m, note: rowNote(m) })), index: 0 });
  };
  const chooseRewind = (pk) => {
    const rw = rewindRef.current;
    const m = pk.items[pk.index];
    const plan = rw.plan(m.n);
    if (!plan) { setPicker(null); return; }
    const options = rewindChoices(plan, m.talk);
    setPicker({ ...pk, stage: 'choose', options, choice: 0, lines: planLines(plan, m.talk) });
  };
  const applyRewind = async (pk, what) => {
    setPicker(null);
    if (what === 'cancel') return;
    const rw = rewindRef.current;
    const m = pk.items[pk.index];
    const said = m.text.split('\n')[0].slice(0, 60) + (m.text.length > 60 || m.text.includes('\n') ? '…' : '');
    if (what === 'both' || what === 'files') {
      const r = await rw.restore(m.n);
      if (r) {
        if (r.put.length) push({ type: 'note', text: `Put back ${r.put.length === 1 ? '1 file' : `${r.put.length} files`} to before "${said}": ${names(r.put.map((f) => f.rel), 8)}`, tone: 'ok' });
        for (const f of r.skip) push({ type: 'note', text: `Left alone: ${f.rel} (${f.why})`, tone: 'warn' });
        for (const f of r.failed) push({ type: 'note', text: `Could not put back ${f.rel}: ${f.why}`, tone: 'error' });
        // Files only: the model is told with your next message, so it reads them again.
        if (what === 'files' && r.put.length) pendingContext.current.push(`[The user put these files back to how they were before their message "${said}": ${names(r.put.map((f) => f.rel), 12)}. Your later changes to them are gone; read a file again before you change it.]`);
      }
    }
    if (what === 'both' || what === 'talk') {
      const at = rw.messageIndex(agent.messages, m.n);
      if (at > 0 && agent.cutBefore(at)) {
        // What happened in those messages is not a lesson any more.
        agent.lessons = agent.lessons.filter((l) => !(l.at >= m.at));
        rw.dropFrom(m.n);
        pendingContext.current = [];
        push({ type: 'divider', text: `rewound to before: ${said}` });
        if (what === 'talk') push({ type: 'note', text: 'The files stay as they are now.', tone: 'dim' });
        setInput((s) => withUndo(s, { value: m.text, cursor: m.text.length }));
        saveNow();
      } else push({ type: 'note', text: 'That message is no longer in the conversation (it was summarized since), so the conversation stays.', tone: 'warn' });
    }
  };

  const openPermissions = () => {
    const at = agent.cwd;
    const v = permSummary(at, { session: agent.allowedPrefixes });
    const rows = [
      { name: 'permissions mode', label: 'Start-up mode', value: v.mode, note: 'what it starts in; /mode changes one conversation' },
      { name: 'permissions allow', label: 'Runs without asking', value: v.allow, note: 'on top of commands that only read' },
      { name: 'permissions never', label: 'Never runs', value: v.never, note: 'every mode; a commit always asks' },
      { name: 'permissions protect', label: 'Protected files', value: v.protect, note: 'always ask before a change, even in Accept edits and Auto' },
      { name: 'permissions folders', label: 'Trusted folders', value: v.folders, note: 'folders you said yes to in the safety check' },
      // The Screen tool (tools/screen.mjs): /screen, typed in full, is the same.
      { name: 'screen', label: 'Screen', value: process.platform !== 'darwin' ? 'Mac only' : `${screenAccess() ? 'allowed' : 'not allowed yet'} · ${agent.canSee || agent.mayLook?.() ? 'model sees' : 'model is blind'}`, note: 'the model may look at an app or the whole screen; each app asks once' },
    ];
    setPicker({ kind: 'settings', title: 'Permissions', blurb: `Saved for ${at.replace(homedir(), '~')}. Each row opens; /permissions test <command> tries one.`, groups: [{ group: 'What Agentic Coder may do here', rows }], rows, index: 0 });
  };
  // Memory for /effort's panel and for a restart, counted one way for both:
  // what is free now plus what the model server holds (a restart hands it
  // back first), and search(values): the search models those values turn on
  // that are not loaded yet.
  const memoryForRestart = () => {
    const cur = serverRef.current;
    const free = cur?.port ? freeWithHandBack(cur.model, cur.ctx ?? agent.ctx, { draft: Boolean(cur.draft) }) : availableBytes();
    const loaded = new Set(scanServers().map((e) => e.model));
    return { free, search: (values) => searchBytes(searchModels(agent, values), (m) => loaded.has(m.file)) };
  };
  // /effort, one panel: Effort on top, then every limit that can move, with
  // what each value costs; ←→ moves, enter saves all of it.
  const openEffortLimits = () => {
    const mem = memoryForRestart();
    const levels = model.thinkingLevels ?? [];
    const level = Math.max(0, levels.findIndex((l) => l.id === thinkingLevel(model, agent.thinking, agent.effort).id));
    // On an Ollama service the Context row is the model's own (serviceCtx), not this Mac's, and the
    // ranks page's values for it are suggested beside its rows (remote-suggested.mjs).
    const svc = onService();
    const values = svc ? { ...limitsRef.current, context: serviceCtx() } : { ...limitsRef.current };
    setPicker({ kind: 'limits', index: 0, level, savedLevel: level, values, saved: { ...values }, model, ...(svc ? { suggested: suggestedFor(model.remote.model, model) } : {}), env: { model, freeBytes: mem.free, searchBytes: mem.search, tps: stats.tps, pps: stats.pps, ctxNow: agent.ctx, lastRerank: agent.reranker?.last ?? null } });
  };
  // /model's menu for one model on the service (the user's pick, 2 Oct 2026): its own Effort and
  // rows, with the ranks page's values suggested beside them, before anything loads; enter switches
  // to it with them, esc goes back to the list (back). On the model in use it is saved at once.
  // A model not in use is read from the service's entry for it (what it can do, its longest context).
  const openOwnSettings = (entry, { back = null } = {}) => {
    const inUse = entry.id === model.remote?.model;
    const m = inUse ? model : remoteModel(settings.remote, { model: entry.id, ollama: { version: catalog?.version ?? model.remote?.ollama ?? '?', ...entry }, ctx: entry.loadedCtx || entry.ctx || null });
    const levels = m.thinkingLevels ?? [];
    const own = ownOf(settings, entry.id);
    const lvNow = (levels.length > 1 && levels.find((l) => l.id === own?.level)) || thinkingLevel(m, agent.thinking, agent.effort);
    const level = Math.max(0, levels.findIndex((l) => l.id === lvNow.id));
    const mine = readLimits({ ...loadSettings(opts.cwd), remote: settings.remote }, m);
    const values = { ...limitsRef.current, ...Object.fromEntries(OWN_ROWS.map((id) => [id, mine[id]])), context: serviceCtx(entry.id) };
    setPicker({ kind: 'limits', index: 0, level, savedLevel: level, values, saved: { ...values }, model: m, suggested: suggestedFor(entry.id, m),
      own: { id: entry.id, entry, inUse, back },
      env: { model: m, switching: !inUse, freeBytes: null, searchBytes: null, tps: stats.tps, pps: stats.pps, ctxNow: inUse ? agent.ctx : entry.loadedCtx || null, lastRerank: null } });
  };
  // The menu's values with every suggested one filled in (s).
  const fillSuggested = (pk) => {
    const sg = pk.suggested;
    const li = sg?.level ? (pk.model.thinkingLevels ?? []).findIndex((l) => l.id === sg.level) : -1;
    return { ...pk, values: { ...pk.values, ...(sg?.limits ?? {}) }, ...(li >= 0 ? { level: li } : {}) };
  };
  // A model on the service back to the shared settings: its own rows as every model has them, its Context the service's own.
  const sharedValues = (pk) => {
    const shared = readLimits(loadSettings(opts.cwd), pk.model, { own: false });
    return { ...pk.values, ...Object.fromEntries(OWN_ROWS.map((id) => [id, shared[id]])), context: 0 };
  };
  // The menu saved: on the model in use, as /effort saves; on another, its own set (the rows you
  // moved, with the ones it had, and its Effort when it has more than one) and its Context are
  // kept for it, then the switch to it, which puts them in use (relimit). Reset: back to the shared ones.
  const saveOwnSettings = (pk, { reset = false } = {}) => {
    const { id, entry, inUse } = pk.own;
    const levels = pk.model.thinkingLevels ?? [];
    const lv = levels[pk.level] ?? null;
    if (inUse) { setPicker(null); saveEffortLimits(lv?.id ?? null, reset ? sharedValues(pk) : pk.values, { reset }); return; }
    if (busyNow()) { push({ type: 'note', text: `Agentic Coder is busy (a reply, or a model loading). Press enter again when it is done; nothing was saved and ${model.remote?.model ?? model.name} is still in use.`, tone: 'warn' }); return; }
    setPicker(null);
    const prev = ownOf(settings, id);
    const moved = OWN_ROWS.filter((r) => pk.values[r] !== pk.saved[r]);
    const limits = reset ? {} : { ...(prev?.limits ?? {}), ...Object.fromEntries(moved.map((r) => [r, pk.values[r]])) };
    const level = reset ? null : levels.length > 1 && lv && pk.level !== pk.savedLevel ? lv.id : prev?.level ?? null;
    const own = { ...(level ? { level } : {}), ...(Object.keys(limits).length ? { limits } : {}) };
    if (Object.keys(own).length || prev) setOwn(id, Object.keys(own).length ? own : null);
    const ctx = reset ? 0 : pk.values.context ?? 0;
    if (ctx !== serviceCtx(id)) setServiceCtx(id, ctx);
    // Its Effort goes in use once the switch has worked (relimit's ownLevel): one that fails leaves the model in use as it was.
    switchService(entry);
  };
  askRef.current = (p) => new Promise((resolve) => {
    // Not over something you are doing: typing, or another menu open. Asked
    // again at the next pause.
    if (S.current.picker || S.current.input?.value?.trim() || pendingSaveRef.current || S.current.btw) { resolve('later'); return; }
    pendingSaveRef.current = { resolve, again: Boolean(p.again) };
    push({ type: 'panel', title: `${p.title ?? 'Learned in that task'} · ${p.add.length + p.drop.length} change${p.add.length + p.drop.length === 1 ? '' : 's'}`, pad: 0, rows: [...p.add.map((f) => [`+ ${f.text.replace(/\s+/g, ' ').slice(0, 140)}`]), ...p.drop.map((d) => [`− ${d.text.replace(/\s+/g, ' ').slice(0, 110)} (${d.why})`])] });
    openChoice('memory-save');
  });
  const applyChoice = (id, value) => {
    if (id === 'memory-save') { const p = pendingSaveRef.current; pendingSaveRef.current = null; p?.resolve(value === 'save'); return; }
    if (id === 'vision-get') {
      const wait = visionWaitRef.current;
      if (value === 'skip') { visionWaitRef.current = null; if (wait) setTimeout(() => remoteFnRef.current.send?.(wait.value, wait.shown, { visionAsked: true }), 50); return; }
      push({ type: 'note', text: `Downloading ${model.name}'s vision add-on…`, tone: 'dim' });
      getVision(model, (t) => flash(String(t).trim(), 4000))
        .then(() => turnVisionOn())
        .catch((e) => { visionWaitRef.current = null; push({ type: 'note', text: `The vision add-on did not download: ${e.message}. The message goes without the picture.`, tone: 'error' }); if (wait) setTimeout(() => remoteFnRef.current.send?.(wait.value, wait.shown, { visionAsked: true }), 50); });
      return;
    }
    if (id === 'vision-switch') {
      const wait = visionWaitRef.current;
      visionWaitRef.current = null;
      const go = () => { if (wait) setTimeout(() => remoteFnRef.current.send?.(wait.value, wait.shown, { visionAsked: true }), 50); };
      const seer = String(value).startsWith('use:') ? MODELS[String(value).slice(4)] : null;
      if (!seer) { go(); return; }
      const back = model;
      (async () => {
        await switchModel(withVision(seer), () => `${seer.name} looks at the picture; ${back.name} comes back after its reply.`);
        switchBackRef.current = back;
        // It did not load (or loaded without its add-on): the message goes to the model you had.
        if (!agentRef.current?.canSee) { push({ type: 'note', text: `${seer.name} could not take the picture; back to ${back.name}, and the message goes without it.`, tone: 'warn' }); await remoteFnRef.current.switchBack(); }
        go();
      })();
      return;
    }
    if (id === 'service-chat-only') {
      const pick = chatOnlyRef.current;
      chatOnlyRef.current = null;
      if (value !== 'switch' || !pick) return;
      openOwnSettings(pick.m, { back: pick.back });
      return;
    }
    if (id === 'same-folder') {
      if (value !== 'copy') { push({ type: 'note', text: 'Sharing this folder with the other window: both can change the same files.', tone: 'dim' }); return; }
      if (agent.busy) { push({ type: 'note', text: 'Wait for the reply to finish, then type /copy to work in your own copy.', tone: 'warn' }); return; }
      startCopy();
      return;
    }
    if (id === 'copy-back') {
      if (value === 'show') {
        let diff = '';
        try { diff = copyDiff(copyRef.current); } catch (e) { diff = `Could not show them: ${e.message}`; }
        push({ type: 'note', text: diff || 'Nothing changed in the copy.', tone: 'dim' });
        setTimeout(() => openChoice('copy-back'), 60);
      } else if (value === 'back') doPutBack();
      else push({ type: 'note', text: 'Your changes stay in the copy for now. /copy brings the question back.', tone: 'dim' });
      return;
    }
    if (id === 'copy-conflict') {
      if (value === 'mine') doPutBack({ only: copyAsk.current.conflicts, force: true });
      else push({ type: 'note', text: `Left ${copyAsk.current.conflicts.join(', ')} as they are in the real folder; /copy asks again later.`, tone: 'dim' });
      return;
    }
    if (id === 'remote-down') {
      if (value === 'retry') useRemote(settings.remote);
      else if (value === 'local') useLocal({ note: 'This window uses the model on this Mac for now; /remote is still on for the next start.', load: true });
      else openRemoteForm();
      return;
    }
    if (id === 'mode') {
      const o = MODE_OPTIONS.find((x) => x.id === value); if (!o) return;
      setMode(o.id);
      const MODE_SAYS = {
        auto: 'Mode is auto: reading, searching and edits inside the project go through; a command or web page no rule covers is checked by the model against your request first, and runs only when it fits and can be undone. Commits and protected files still ask.',
        ask: 'Mode is manual: Agentic Coder asks before every change and every command that can change things.',
        edits: 'Mode is accept edits: file edits go through without asking; commands still ask.',
        plan: 'Mode is plan: it only reads and searches, then replies with a plan.',
        bypass: 'Bypass permissions is on: nothing asks. Still never: rm -rf, sudo, git push, stopping processes, a change to Agentic Coder’s own settings, your never-list; commands stay in the project with no internet (the sandbox). shift+tab goes back to manual.',
      };
      push({ type: 'note', text: MODE_SAYS[o.id], tone: o.id === 'bypass' ? 'warn' : 'dim' });
    } else if (id === 'meters') {
      const on = value === 'on';
      setMeters(on);
      saveSettings({ meters: on });
      push({ type: 'note', text: on ? 'Status bar on: model, speed, memory and effort under the prompt.' : 'Status bar off. /stats has the numbers; a memory note appears only when it runs low.', tone: 'dim' });
    } else if (id === 'mouse') {
      const on = value === 'on';
      setMouse(on);
      saveSettings({ mouse: on });
      push({ type: 'note', text: on ? 'Mouse on: a click in the prompt box puts the cursor there and a drag highlights (copied at once; delete removes it); a click on the model’s label in the footer starts or stops it. Hold fn to highlight the way Terminal does.' : 'Mouse off: the mouse is Terminal’s again. option+click, shift+arrows and ctrl+t still work.', tone: 'dim' });
    } else if (id === 'autostart') {
      const on = value === 'on';
      settings.modelAtStart = on;
      saveSettings({ modelAtStart: on });
      push({ type: 'note', text: on ? `Model at start on: ${model.name} loads as soon as a window opens. /stop still unloads it.` : 'Model at start off: a window opens with the model off, and /start loads it.', tone: 'dim' });
    } else if (id === 'startmode') {
      const r = changePermissions(agent.cwd, `mode ${value}`, { mode: agent.mode, session: agent.allowedPrefixes });
      if (r.mode) setMode(r.mode);
      push({ type: 'note', text: r.text, tone: r.tone ?? 'dim' });
    }
  };
  // What the note after an effort change says; a level's note can name the
  // thinking cap, so it is given the cap in use.
  const sayEffort = (lv, cap) => push({ type: 'note', text: `Effort is ${lv.label.toLowerCase()}: it ${effortNote(lv, cap) || 'thinks before each step'}.`, tone: 'dim' });
  // The Effort and limits panel saved (`levelId` is null when the model has no
  // levels): the effort and the agent's limits change at once; a new context or
  // thinking cap restarts the model server (the window and conversation stay).
  // All of it or none: a restart is refused in the middle of a reply and while the model is still starting.
  // On an Ollama service the model's own rows and Effort are kept for it alone (/model's menu, 2 Oct
  // 2026); reset: it goes back to the shared ones (its own set and its Context dropped).
  const saveEffortLimits = (levelId, next, { reset = false } = {}) => {
    const lv = levelId ? (model.thinkingLevels ?? []).find((l) => l.id === levelId) : null;
    const effortChanged = !!lv && lv.id !== thinkingLevel(model, agent.thinking, agent.effort).id;
    // On an Ollama service the Context row is the model's own: kept by model, and the model loads
    // again on the service at that size (the conversation stays); this Mac's Context is left as it was.
    const svc = onService();
    const svcCtx = svc ? next.context ?? 0 : 0;
    const ctxChanged = svc && svcCtx !== serviceCtx();
    if (svc) next = { ...next, context: limitsRef.current.context };
    const changes = limitChanges(limitsRef.current, next);
    const prevOwn = svc ? ownOf(settings, model.remote.model) : null;
    if (!effortChanged && !changes.length && !ctxChanged && !(reset && prevOwn)) { push({ type: 'note', text: 'Effort and limits unchanged.', tone: 'dim' }); return; }
    if (ctxChanged && busyNow()) { push({ type: 'note', text: 'Agentic Coder is busy (a reply, or a model loading). Save the Context again in /effort when it is done. Nothing was changed.', tone: 'warn' }); return; }
    const restart = changes.some((c) => c.restart);
    if (restart && !opts.url && !model.remote) {
      // A restart needs a quiet model: no reply running, and no start still going
      // (a prompt queued meanwhile would be sent to the server just stopped).
      const why = S.current.starting ? 'still starting. Wait until it is ready' : S.current.live !== IDLE || agent.busy ? 'in the middle of a reply. Let it finish (or press esc)' : null;
      if (why) { push({ type: 'note', text: `Agentic Coder is ${why}, then save again in /effort. Nothing was changed.`, tone: 'warn' }); return; }
    }
    if (effortChanged) { setThinking(!!lv.effort, lv.effort ? lv.id : undefined); sayEffort(lv, next.thinking); }
    // The model's own set on the service: the rows moved here (with the ones it had), and its
    // Effort when it has more than one; the shared rows are saved below as before.
    const ownMoved = svc ? changes.filter((c) => OWN_ROWS.includes(c.id)).map((c) => c.id) : [];
    if (svc && (ownMoved.length || effortChanged || reset)) {
      const limits = reset ? {} : { ...(prevOwn?.limits ?? {}), ...Object.fromEntries(ownMoved.map((id) => [id, next[id]])) };
      const level = reset ? null : effortChanged && model.thinkingLevels.length > 1 ? lv.id : prevOwn?.level ?? null;
      const own = { ...(level ? { level } : {}), ...(Object.keys(limits).length ? { limits } : {}) };
      if (Object.keys(own).length || prevOwn) setOwn(model.remote.model, Object.keys(own).length ? own : null);
      if (reset && prevOwn && !changes.length) push({ type: 'note', text: `${model.remote.model} follows the shared settings again.`, tone: 'dim' });
    }
    if (ctxChanged) {
      const conn = remoteRef.current.conn;
      const name = model.remote.model;
      const from = serviceCtx();
      setServiceCtx(name, svcCtx);
      conn.numCtx = svcCtx || null;
      setEndpoint(conn.url, { ...endpointOf(conn.url), numCtx: conn.numCtx });
      if (svcCtx) { conn.ctx = svcCtx; agent.ctx = svcCtx; setCtx(svcCtx); agent.syncRules(); }
      push({ type: 'note', text: `Context ${from ? ctxWord(from) : 'auto'} → ${svcCtx ? ctxWord(svcCtx) : 'auto (the service’s own)'} for ${name}, kept for it: it loads again on the service at that size; the chat stays.`, tone: 'dim' });
      // Loaded again even when it is loaded: at the new size (or the service's own).
      conn.info.ollama = { ...conn.info.ollama, loaded: false };
      preloadRemote(conn);
    }
    if (!changes.length) return;
    limitsRef.current = next;
    applyLimits(agent, next);
    // A model on a service: its Reply length and sampling from the next step, Keep loaded from the next request.
    if (svc) { agent.model = modelWithLimits(model, next); applyKeep(next); }
    const searchNote = applySearch(agent, next);
    if (searchNote) push({ type: 'note', text: searchNote, tone: 'warn' });
    // A row this save left alone stays saved as it was (limitsToSave's keep). On a service only the
    // shared rows go there, laid over what every model shares (its own rows are kept above).
    const touched = new Set(changes.map((c) => c.id).filter((id) => !ownMoved.includes(id)));
    const kept = Object.fromEntries(Object.entries(loadSettings(opts.cwd).limits ?? {}).filter(([id]) => !touched.has(id)));
    if (touched.size) saveSettings({ limits: limitsToSave(svc ? { ...readLimits(loadSettings(opts.cwd), model, { own: false }), ...Object.fromEntries([...touched].map((id) => [id, next[id]])) } : next, model, kept) });
    const list = changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join(' · ');
    // Who decides changes the prompt and the tools: the next reply reads the instructions again, once.
    const way = changes.some((c) => c.id === 'way') ? ` ${next.way === 'model' ? 'The model decides from the next message: no sorting, no reading ahead, the checks only as /hooks switches them' : 'The app decides again from the next message'}; that reply reads the instructions again, once.` : '';
    const forIt = svc && ownMoved.length ? (reset ? ` ${model.remote.model} follows the shared settings again.` : ` Kept for ${model.remote.model} alone${touched.size ? ' (Who decides and the search for every model)' : ''}.`) : '';
    if (!restart) { push({ type: 'note', text: `Saved: ${list}. In use from the next step; kept for next time.${forIt}${way}`, tone: 'dim' }); return; }
    if (opts.url) { agent.model = modelWithLimits(model, next); push({ type: 'note', text: `Saved: ${list}. The model server was given with --url, so restart it yourself for the context or thinking cap to take effect.`, tone: 'warn' }); return; }
    if (model.remote) { agent.model = modelWithLimits(model, next); push({ type: 'note', text: `Saved: ${list}. The model runs on the remote: its context is set there (coding serve --ctx, or /remote's Context row), and the new cap is asked for with each reply.`, tone: 'dim' }); return; }
    if (modelOffNow()) { agent.model = modelWithLimits(model, next); push({ type: 'note', text: `Saved: ${list}. The model is off, so it applies when you type /start; kept for next time.${way}`, tone: 'dim' }); return; }
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

  // The Mac's memory for the footer, read every 5 s (a few ms). A new figure is
  // drawn with the next redraw (a key, a spinner), not with one of its own: that
  // would rewrite the bottom of the window every few seconds while nothing else
  // moves, and Terminal drops a highlight whose rows are drawn again, so text
  // there could not be copied (1 Oct 2026). A new pressure colour is drawn at once.
  const macRef = useRef(opts.macMem ?? null);
  const [, redrawMac] = useState(0);
  useEffect(() => {
    if (!opts.macMem) return;
    const id = setInterval(() => {
      // On a remote the footer shows the service instead (remote-footer.mjs): nothing to read here.
      if (remoteRef.current.on) return;
      const m = macMemory();
      if (!m) return;
      const prev = macRef.current;
      macRef.current = m;
      if (!prev || prev.level !== m.level) redrawMac((n) => n + 1);
    }, Number(process.env.AGENTIC_MAC_EVERY) || 5000); // ms; the tests read it faster
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mac = macRef.current;
  // In a background session that another Mac has a window on (through the door, door.mjs): this
  // Mac's name, lower right, so the window there says where its keys go. The session's record
  // says who is in it (sessions.mjs): read when a window joins, which redraws, and every 2 s.
  const [sharedOn, setSharedOn] = useState(null);
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
  const [, redrawPs] = useState(0);
  const psConn = model.remote && remoteState === 'on' && remoteRef.current.conn?.info?.ollama ? remoteRef.current.conn : null;
  const psKey = psConn ? `${psConn.url} ${model.remote.model}` : null;
  useEffect(() => {
    psRef.current = null;
    if (!psConn) return;
    const name = model.remote.model;
    let on = true;
    const read = async () => {
      const p = await ollamaPs({ url: psConn.url, model: name }).catch(() => null);
      if (!on) return;
      const prev = psRef.current;
      psRef.current = p;
      const spill = (x) => (x?.loaded ? (x.gpuPct ?? 100) < 100 : null);
      if (!prev || spill(prev) !== spill(p) || Boolean(prev.loaded) !== Boolean(p?.loaded)) redrawPs((n) => n + 1);
    };
    read();
    const id = setInterval(read, Number(process.env.AGENTIC_PS_EVERY) || 30_000); // ms; the tests read it faster
    return () => { on = false; clearInterval(id); };
  }, [psKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Memory the model really uses (for the Live thinking meter line).
  useEffect(() => {
    // A copy shared with another window is measured too (its process is that window's).
    const read = () => { const s = serverRef.current; if (s?.port && (s.child || s.shared)) setRamGb((s.footprintBytes() + model.bytes) / 1e9); };
    const id = setInterval(read, 5000);
    const first = setTimeout(read, 1500);
    return () => { clearInterval(id); clearTimeout(first); };
  }, [model]);

  const saveNow = useCallback(() => {
    const s = sessionRef.current;
    if (!s.title) return;
    // lessons: what happened in each turn, for the memory's review at night.
    const slimImages = (m) => (m.images ? { ...m, images: m.images.map(({ data, ...rest }) => rest) } : m);
    try { saveSession(cwd, s.id, { title: s.title, messages: agent.messages.map(slimImages), items: s.items.slice(-300), mode: agent.mode, lessons: agent.lessons }); } catch {}
  }, [agent, cwd]);

  // Keep a copy of what was shown, for /resume.
  useEffect(() => { sessionRef.current.items = items.filter((it) => it.type !== 'welcome'); }, [items]);

  const sendPrompt = useCallback((value, shown = value, { visionAsked = false } = {}) => {
    // The model is off: the message waits (the Queued line) and goes once /start has loaded it.
    if (modelOffNow()) {
      const had = queuedRef.current;
      queuedRef.current = value; setQueued(value);
      if (!had) push({ type: 'note', text: 'The model is off. /start or ctrl+t loads it (your message waits and goes out after).', tone: 'dim' });
      return;
    }
    const { text, attached, images } = expandMentions(value, cwd, agent.maxResultChars, pastedRef.current.files);
    // A picture, and a model not looking at pictures yet: its vision is turned on first (the
    // message waits for it), or, where it cannot be, the message goes with a line saying so.
    if (images.length && !agent.canSee && !visionAsked && remoteFnRef.current.needVision?.(value, shown)) return;
    // Not seen, unless a Pictures helper describes it (agent.work, /subagents).
    const blind = images.length && !agent.canSee && !agent.helperUse?.('pictures');
    holdRef.current = false; // your first message prints the start page above it
    push({ type: 'user', text: shown, attached });
    let content = blind ? `${text}\n\n(The user attached ${images.length === 1 ? 'a picture' : `${images.length} pictures`} (${images.map((i) => i.path).join(', ')}), but this model is not looking at pictures now.)` : text;
    if (pendingContext.current.length) { content = `${pendingContext.current.join('\n\n')}\n\n${content}`; pendingContext.current = []; }
    if (agent.mode === 'plan') content += '\n\n[Plan mode is on: only read and search. Do not change files or run commands that change anything. Reply with a short numbered plan, then stop.]';
    if (!sessionRef.current.title) sessionRef.current.title = shown.slice(0, 80);
    const ac = new AbortController();
    abortRef.current = ac;
    setPlaceholder(pick(PLACEHOLDERS));
    autoRef.current.cancel(); // a save in the background steps aside
    agent.send(content, { signal: ac.signal, shown, images: blind ? undefined : images });
  }, [agent, cwd, push]);

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
    const addPre = (patch) => { pre.current = { ...(pre.current ?? {}), ...patch }; setLive((l) => ({ ...l, pre: pre.current })); };
    const offs = [
      // A busy service (busy.mjs): the spinner counts down to the next try.
      on('busy', ({ until }) => setLive((l) => (l.phase ? { ...l, busyUntil: until } : l))),
      on('turn-start', () => { try { const u = [...agent.messages].reverse().find((x) => x.role === 'user'); updateWindow({ task: String(typeof u?.content === 'string' ? u.content : u?.content?.find?.((c) => c.type === 'text')?.text ?? '').replace(/\s+/g, ' ').slice(0, 80), at: new Date().toISOString() }); } catch {} turnSpend.current = windowSpend().usd; railOn.current = true; pre.current = null; lastCheck.current = null; const [verb, past] = pick(VERBS); setLive({ phase: 'working', turnStart: Date.now(), verb, past, tokens: 0, waiting: true, rail: true }); }),
      // A new reply: its step clock starts, and its room and thinking cap feed the meters.
      on('waiting', ({ room, thinkCap } = {}) => setLive((l) => ({ ...l, waiting: true, thinking: null, text: null, writing: null, firstTokenAt: null, streamTokens: 0, liveTps: null, stepStart: Date.now(), room, thinkCap, task: null }))),
      // A reply that will not run as it was (cut off, repeating itself): its live lines go.
      on('reply-dropped', () => setLive((l) => ({ ...l, thinking: null, text: null, writing: null }))),
      // The app working between replies (notes, a summary): the working line says so.
      on('busy', ({ task }) => setLive((l) => ({ ...l, thinking: null, text: null, writing: null, waiting: false, liveTps: null, stepStart: Date.now(), task }))),
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
      // During a turn the design cards join the line of what came along; a layout check is a step.
      on('note', ({ text, tone, design, check }) => {
        if (design && railOn.current) { addPre({ design }); return; }
        if (check) lastCheck.current = check;
        push({ type: 'note', text, tone, ...(check ? { check } : {}) });
      }),
      // What came along with the request (memory, Claude's notes): one line; ctrl+o lists it.
      on('context', (c) => { fold({ context: c }); if (railOn.current) addPre({ contexts: [...(pre.current?.contexts ?? []), c] }); else push({ type: 'context', ...c }); }),
      // Which path the request took, under the request.
      on('sorted', ({ text }) => { if (railOn.current) addPre({ sorted: text }); else push({ type: 'sorted', text }); }),
      // Saying yes to "Work in <project>?" counts as trusting that folder.
      on('cwd', ({ cwd: dir }) => { setCwd(dir); try { saveTrust(dir); } catch {} }),
      // Focused paths: the live try counter, its finished line, the current step.
      on('tries', (t) => setLive((l) => countTries(l, t))),
      on('tries-done', (t) => { push({ type: 'tries', ...t }); setLive((l) => ({ ...l, tries: null })); }),
      on('flow-step', (st) => setLive((l) => ({ ...l, flowStep: st }))),
      on('stats', (st) => setStats(st)),
      on('mode', (m) => setModeState(m)),
      on('screen-setup', () => push({ type: 'note', text: `The model tried to look at the screen, but macOS has not let ${terminalApp()} take pictures of it yet: type /screen setup (once).`, tone: 'warn' })),
      on('settled', () => autoRef.current.schedule()),
      on('compacted', ({ summary, inPlace, n }) => { push({ type: 'note', text: inPlace ? `Picked up from its notes${n ? ` (${n})` : ''}` : `Summarized${n ? ` (${n})` : ''}, carrying on`, tone: 'dim' }); fold({ title: 'Summary', text: summary }); }),
      on('turn-end', ({ reason, secs, steps, reads, thinkTokens }) => {
        const past = S.current.live?.past ?? 'Worked';
        setLive(IDLE);
        setPerm(null);
        answerRef.current = null;
        setAnswerWait(false);
        // The turn's end line closes the rail: how it ended, its time and counts ("╰─ ⠿ Worked for
        // 41s · 5 steps · done 12:58 PM"), and the layout problems its last check left.
        const left = lastCheck.current?.problems?.length ?? 0;
        const at = Date.now();
        // What this request cost on a paid service (spend.mjs), for its end line.
        const spent = windowSpend().usd - (turnSpend.current ?? 0);
        const usd = spent > 0 ? spent : undefined;
        if (reason === 'interrupted') { push({ type: 'done', reason, text: 'Interrupted · What should Agentic Coder do instead?', secs, at, usd }); setPlaceholder('Tell Agentic Coder what to do instead'); }
        else if (reason === 'done') push({ type: 'done', reason, past, secs, at, steps, reads, thinkTokens, left, usd });
        else push({ type: 'done', reason, text: END_WORDS[reason] ?? `Stopped (${reason})`, secs, at, left, usd });
        railOn.current = false;
        pre.current = null;
        // In its own copy: changed files are offered back to the real folder (copies.mjs).
        if (copyRef.current && !queuedRef.current) setTimeout(() => askCopyBack(), 60);
        if (reason === 'declined') setPlaceholder('Tell Agentic Coder what to do instead');
        saveNow();
        const q = queuedRef.current;
        if (q) { queuedRef.current = null; setQueued(null); }
        // A model that took one message with a picture hands back to yours first.
        if (switchBackRef.current) setTimeout(async () => { await remoteFnRef.current.switchBack?.(); if (q) sendPrompt(q); }, 50);
        else if (q) setTimeout(() => sendPrompt(q), 50);
      }),
    ];
    return () => offs.forEach((f) => f());
  }, [agent, push, saveNow, sendPrompt]);

  // The Arena wants the memory (it runs Gemma and Qwen one model at a time): once no
  // reply is running, this window lets its model go, and loads it again by itself when the
  // battle is over. A message sent meanwhile waits in line and goes once the model is back.
  const battleRef = useRef({ released: false });
  battleRef.current.switchModel = switchModel;
  battleRef.current.sendPrompt = sendPrompt;
  remoteFnRef.current.send = sendPrompt;
  battleRef.current.model = model;
  useEffect(() => {
    if (opts.url) return undefined;
    const tick = setInterval(async () => {
      // On a remote, nothing here holds the memory an Arena run needs.
      if (remoteRef.current.on) return;
      const b = battleRef.current;
      const h = battleHold();
      if (b.released) {
        if (h) { setBattle(h); return; }
        if (b.reloading) return;
        b.reloading = true;
        setBattle(null);
        await b.switchModel(b.model, () => `The ${b.what ?? 'battle'} is over: ${b.model.name} is loaded again.`);
        b.released = false; b.reloading = false;
        // The model is back (switchModel has finished): a message typed meanwhile goes now.
        const q = queuedRef.current;
        if (q && serverRef.current?.port) { queuedRef.current = null; setQueued(null); setTimeout(() => b.sendPrompt(q), 50); }
        return;
      }
      if (!h || S.current.starting || S.current.live !== IDLE || !serverRef.current?.port) return;
      b.released = true;
      b.what = /^a test/.test(h) ? 'test run' : 'battle';
      setBattle(h);
      setStarting(true); setStartPhase('waiting');
      await serverRef.current.stop({ keep: false }).catch(() => {});
      push({ type: 'note', text: `${b.model.name} is unloaded for now: ${h}. It loads again by itself when the ${b.what} is over; a message you send meanwhile waits for it.`, tone: 'dim' });
    }, 3000);
    return () => clearInterval(tick);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the model on this Mac: at the window's start when it loads then (/autostart on, --start),
  // and on /start. stillOn() turns false when the window closes or /stop comes first: the load
  // then ends quietly (a server /stop stopped mid-load fails its start, and that is not said).
  const loadedOnce = useRef(false);
  const loadModel = async () => {
    const my = ++loadRef.current;
    const stillOn = () => aliveRef.current && loadRef.current === my;
    wantRef.current = true;
    setModelOff(false);
    setStarting(true); setStartPhase('loading'); setStartedAt(Date.now());
    timing.current = null;
    await waitForBattle(stillOn);
    if (!stillOn()) return;
    // --ctx wins; then the context /effort saved; then what fits (chooseContext).
    let size = opts.ctx ?? (limitsRef.current.context || undefined);
    const picked = !opts.ctx && limitsRef.current.context;
    // A model still loaded from an earlier start (or another window) is used
    // as it is; otherwise the memory size is chosen from what is free now.
    let running = runningServer(model);
    // Kept loaded at another size than the one you picked, with no other
    // window on it: it restarts at yours (before, it kept the old size until coding stop).
    let freeBefore = 0; // what is free with that copy's memory back (freeWithHandBack)
    if (picked && running?.linger && running.ctx !== picked && !(running.users ?? []).some((p) => p !== process.pid)) {
      freeBefore = freeWithHandBack(model, running.ctx, { draft: Boolean(running.draft) });
      stopServer(running);
      await exited(running.pid);
      running = null;
    }
    if (!size && running) size = running.ctx;
    // Another copy loaded outside the app windows: wait for it (esc starts anyway).
    // What the copies it waited for give back counts as free, as a restart's does.
    if (!running) freeBefore = Math.max(freeBefore, await waitForOthers(model, stillOn));
    if (!stillOn()) return;
    let helper;
    if (!size) {
      const c = chooseContext(model, { effort: agent.thinking ? agent.effort : undefined, available: Math.max(freeBefore, availableBytes()) });
      size = c.ctx;
      helper = c.helper; // false: High keeps its memory, the speed helper stays off
      memoryNote.current = c.reason ?? null; // shown by /stats, not on the start screen
    }
    // A context you picked is used as asked, checked against what is free now
    // (before loading) with the search models still to load: said when it
    // does not fit, and shown by /stats.
    if (picked && !running) {
      const loaded = new Set(scanServers().map((e) => e.model));
      const chk = contextCheck(model, size, { draft: hasDraft(model), available: Math.max(freeBefore, availableBytes()), search: searchBytes(searchModels(agent, limitsRef.current), (m) => loaded.has(m.file)) });
      memoryNote.current = chk.note;
      if (!chk.fits) push({ type: 'note', text: chk.note, tone: 'warn' });
    }
    agent.ctx = size;
    setCtx(size);
    agent.syncRules(); // rules that follow the Context, settled before the model reads them
    timeLoad(model, !running);
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
      if (!stillOn()) return;
      timeLoaded(st);
      const want = !opts.ctx && limitsRef.current.context;
      if (want && st.shared && st.ctx !== want) push({ type: 'note', text: `${model.name} was already loaded at ${Math.round(st.ctx / 1024)}k, so it runs at that. Your /effort context (${Math.round(want / 1024)}k) applies after /stop and /start, or save it again in /effort.`, tone: 'warn' });
      if (st.shared) {
        agent.ctx = st.ctx;
        setCtx(st.ctx);
        agent.syncRules();
        if (!st.idle) push({ type: 'note', text: `Sharing the model with another Agentic Coder window (port ${st.port}); replies wait their turn.`, tone: 'dim' });
      }
    } catch (e) {
      if (stillOn()) {
        // Nothing loaded: the window is as it was before /start.
        serverRef.current = null; wantRef.current = false;
        setStarting(false); setModelOff(true);
        push({ type: 'note', text: `Could not start the model: ${e.message}. /start tries again.`, tone: 'error' });
      }
      return;
    }
    agent.url = srv.url;
    agent.canSee = Boolean(srv.vision);
    if (st.slots > 1) agent.slots = { main: 0, side: 1 };
    // Read the instructions and tools before the first message (restored from
    // disk after the first time), so the first reply starts fast. A server
    // shared with another window is already warm.
    setStartPhase('reading');
    // A model kept loaded from an earlier start is ours now: warm it for
    // this folder too (instant when nothing changed). Another window's is left alone.
    if (!st.shared || st.idle) try {
      agent.warmed = true; // this window's own reading of the instructions: a restart from notes restores it
      timeWarmed(await warmUp({ sessionMark: SESSION_MARK, url: srv.url, model, system: agent.messages[0].content, tools: agent.tools(), thinking: agent.thinking, effort: agent.effort, slot: agent.slots?.main, helper: srv.draft, onPhase: (p) => { if (stillOn()) setStartPhase(p); } }));
    } catch {}
    if (!stillOn()) return;
    timeDone();
    setStarting(false);
    const first = !loadedOnce.current;
    loadedOnce.current = true;
    // A save that waited for the model (the window closed while it was off) runs on it now.
    autoRef.current.runWaiting();
    const q = queuedRef.current;
    if (q) { queuedRef.current = null; setQueued(null); sendPrompt(q); }
    // The first load here: what the last window's second look would save is asked about (at
    // the window's start already, when the model was off then); then (first use here) what is
    // already written is read, in the background.
    else if (first) setTimeout(() => { (askedAtOpen.current ? autoRef.current.seed() : autoRef.current.atStart()).catch(() => {}); }, 3000).unref?.();
  };
  const loadFnRef = useRef(null);
  loadFnRef.current = loadModel;
  const askedAtOpen = useRef(false);

  // The window opens: the model loads now only when it should (wantRef); otherwise it is off until /start.
  useEffect(() => {
    aliveRef.current = true;
    (async () => {
      if (opts.url) {
        setStarting(false);
        // A llama.cpp server given by hand says whether it has its vision add-on.
        try { const p = await (await fetch(`${opts.url.replace(/\/+$/, '')}/props`, { signal: AbortSignal.timeout(3000) })).json(); agent.canSee = Boolean(p?.modalities?.vision); } catch { agent.canSee = false; }
        // A server given by hand: what the last window's second look would
        // save is still asked about (no model needed); the first-use reading waits for a start of its own.
        setTimeout(() => { if (aliveRef.current) autoRef.current.askPending().catch(() => {}); }, 3000).unref?.();
        return;
      }
      // /remote on: the model on another machine; nothing loads here.
      if (remoteAtStart) { await remoteFnRef.current.useRemote(settings.remote, { atStart: true }); return; }
      if (wantRef.current) { await loadFnRef.current(); return; }
      // The model is off: what the last window's second look would save is still asked about (no model needed).
      askedAtOpen.current = true;
      setTimeout(() => { if (aliveRef.current) autoRef.current.askPending().catch(() => {}); }, 3000).unref?.();
    })();
    // The window is gone (quit, a closed Terminal window): its model goes too, unless another window still uses it.
    return () => { aliveRef.current = false; letGo(serverRef.current); serverRef.current = null; weightsRef.current?.stop(); weightsRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // /stop: the model is unloaded and its memory given back. A reply under way stops first; a load
  // under way is called off. Another window on the same copy keeps it: this window only lets go.
  const stopModel = async () => {
    if (opts.url) { push({ type: 'note', text: `This window uses the model server at ${opts.url} (--url). Agentic Coder did not start it, so /stop leaves it running.`, tone: 'dim' }); return; }
    if (remoteRef.current.on) { push({ type: 'note', text: 'On the remote model: nothing is loaded on this Mac. /remote off goes back to the model on this Mac.', tone: 'dim' }); return; }
    const srv = serverRef.current;
    const b = battleRef.current;
    const wasOn = wantRef.current || Boolean(srv?.port);
    if (!wasOn) {
      // Nothing loaded here; a copy an earlier window left loaded is freed (as `coding stop` does).
      const r = stopIdleServers();
      push({ type: 'note', text: r.stopped.length ? `The model was off here; freed the copy an earlier window had left loaded (port ${r.stopped.map((e) => e.port).join(', ')}).` : 'The model is already off. /start loads it.', tone: 'dim' });
      return;
    }
    // A reply under way stops first (as esc does), and the memory's save in the background too.
    if (S.current.live !== IDLE || agent.busy) {
      interrupt();
      for (const t0 = Date.now(); (S.current.live !== IDLE || agent.busy) && Date.now() - t0 < 10_000;) await new Promise((r) => setTimeout(r, 100));
    }
    autoRef.current.cancel();
    loadRef.current++; // a load still under way ends quietly
    wantRef.current = false;
    b.released = false; b.reloading = false;
    serverRef.current = null;
    agent.url = 'http://127.0.0.1:0';
    agent.slots = null;
    agent.warmed = false;
    setBattle(null); setWaiting(null); waitRef.current = null;
    setStarting(false); setStartPhase('loading');
    setModelOff(true);
    setRamGb(null);
    const before = availableBytes();
    const { others, done } = letGo(srv);
    // The small search models (the memory's and the code search's) go too; they load again at their next use.
    for (const x of [agent.embedder, agent.reranker]) {
      if (!x?.server) continue;
      letGo(x.server).done.catch(() => {});
      x.server = null;
    }
    await done.catch(() => {});
    const freed = Math.max(0, availableBytes() - before);
    push({ type: 'note', text: others
      ? `This window let go of ${model.name}. Another Agentic Coder window still uses it, so it stays loaded until that one quits or types /stop.`
      : `${model.name} is unloaded${freed > 5e8 ? `: ${(freed / 1e9).toFixed(1)} GB back to the Mac` : ''}. /start loads it again.`, tone: 'dim' });
  };
  const stopFnRef = useRef(null);
  stopFnRef.current = stopModel;
  // /start: the model on this Mac loads (the window opens with it off, unless /autostart is on).
  const startModel = () => {
    if (opts.url) { push({ type: 'note', text: `This window uses the model server at ${opts.url} (--url); there is nothing to load.`, tone: 'dim' }); return; }
    if (remoteRef.current.on) { push({ type: 'note', text: `On the remote model (${remoteLabel(settings.remote)}): nothing loads on this Mac. /remote off goes back to this Mac.`, tone: 'dim' }); return; }
    if (S.current.starting) { push({ type: 'note', text: `${model.name} is already loading.`, tone: 'dim' }); return; }
    if (serverRef.current?.port) { push({ type: 'note', text: `${model.name} is already loaded (port ${serverRef.current.port}). /stop unloads it.`, tone: 'dim' }); return; }
    loadFnRef.current();
  };
  const startFnRef = useRef(null);
  startFnRef.current = startModel;
  // ctrl+t, or a click on the model's label in the footer (/mouse on): off → /start, loading or
  // loaded → /stop. In the middle of a reply it asks first: the same again within 2 s stops the
  // reply and unloads the model.
  const toggleArmed = useRef(0);
  const toggleModel = (how = 'ctrl+t') => {
    if (opts.url) { flash('This window uses a model server given with --url: nothing here to start or stop', 3000); return; }
    // On a remote nothing loads on this Mac: ctrl+t, like a click, opens the model list.
    if (remoteRef.current.on) { openModelPicker(); return; }
    if (!wantRef.current) { startFnRef.current(); return; }
    if ((S.current.live !== IDLE || agent.busy) && Date.now() - toggleArmed.current > 2000) {
      toggleArmed.current = Date.now();
      flash(`${how === 'click' ? 'Click it' : 'Press ctrl+t'} again to stop the reply and unload ${model.name}`, 2000);
      return;
    }
    toggleArmed.current = 0;
    stopFnRef.current();
  };
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
      rewindRef.current?.setSession(s.id);
      push({ type: 'divider', text: `resumed: ${s.title}` }, ...(s.items ?? []).map(({ key, ...rest }) => rest));
      if (s.mode) setMode(s.mode);
    } catch (e) { push({ type: 'note', text: `Could not open that conversation: ${e.message}`, tone: 'error' }); }
  }

  const quit = useCallback(async () => {
    setLeaving(true);
    abortRef.current?.abort();
    btwRef.current?.ac.abort();
    saveNow();
    // What the memory has not saved yet is handed to a process of its own,
    // which needs the model a little longer and stops it when it is done.
    // With the model off, the save waits for the next /start here instead: nothing loads after you quit.
    const off = !opts.url && !remoteRef.current.on && !serverRef.current?.port;
    const handed = autoRef.current.leave({ stopAfter: true, modelOff: off, given: Boolean(opts.url) });
    // Otherwise the model goes now (the user's pick, 30 Sep 2026: not kept loaded after you
    // quit), unless another window still uses it; the small search models go with it.
    const srv = serverRef.current;
    serverRef.current = null;
    if (handed) {
      await agent.embedder?.stop({ keep: true }).catch(() => {});
      await agent.reranker?.stop({ keep: true }).catch(() => {});
      await srv?.stop({ keep: true });
    } else {
      const small = [agent.embedder?.server, agent.reranker?.server].map((x) => letGo(x).done.catch(() => {}));
      await Promise.all([letGo(srv).done.catch(() => {}), ...small]);
    }
    remoteRef.current.conn?.stop();
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
      ...(opts.way ? ['--way', opts.way] : []),
      ...(opts.ctx ? ['--ctx', String(opts.ctx)] : []),
      ...(['low', 'medium', 'high'].includes(level) ? ['--effort', level] : []),
      // The model loaded now stays loaded across the restart, so the new version joins it at once.
      ...(!opts.url && !remoteRef.current.on && serverRef.current?.port ? ['--start'] : []),
    ]);
    setLeaving(true);
    // Kept loaded for the new version, which joins it at its start (--start above).
    const srv = serverRef.current;
    serverRef.current = null;
    await srv?.stop({ keep: true });
    exit();
  }, [effort, exit, model, onRestart, opts.ctx, opts.flows, opts.url, opts.way, push, saveNow, thinking]);

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
    // On a remote: where it is, how it connects, how it answered; this Mac's model files do not matter.
    if (model.remote) {
      const c = remoteRef.current.conn;
      const r = settings.remote ?? DEFAULT_REMOTE;
      push({ type: 'panel', title: 'Doctor · on a remote model', pad: 22, rows: [
        [`${ok(Boolean(c))} remote`, c ? `${remoteLabel(r)} · ${kindWord(r.kind)} · ${r.connect === 'ssh' ? `SSH tunnel on port ${c.tunnel?.port}` : r.connect} · answered in ${c.info.ms ?? '?'} ms` : `not connected: ${remoteRef.current.why ?? 'not started'}`],
        [`${ok(!r.key || Boolean(c))} API key`, r.key ? `${keyStore() === 'keychain' ? 'in the Keychain' : 'in the key file'} (••••${r.keyEnd ?? ''})` : 'none'],
        [`${ok(Boolean(c))} model`, c ? `${c.info.model ?? model.name} · context ${Math.round(agent.ctx / 1024)}k${c.slots > 1 ? ` · ${c.slots} slots` : ''}` : '—'],
        [`${ok(!remoteRisk(r))} privacy`, remoteRisk(r) ?? (r.connect === 'ssh' ? 'through ssh' : r.connect === 'https' ? 'https' : 'http on a private network')],
        [`${ok(true)} terminal`, `${process.env.TERM_PROGRAM ?? 'unknown'} · ${process.env.COLORTERM === 'truecolor' ? 'true colour' : '256 colours'} · ${columns}×${rows}`],
      ] });
      return;
    }
    const bin = serverBinOf(model);
    const ver = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    const file = modelPath(model);
    const size = onDiskBytes(model);
    const avail = availableBytes();
    let disk = null;
    try { const f = statfsSync(home); disk = (f.bavail * f.bsize) / 1e9; } catch {}
    push({
      type: 'panel', title: 'Doctor', pad: 22, rows: [
        [`${ok(ver.status === 0)} model server`, ver.status === 0 ? `${engineOf(model).id} ${(ver.stderr + ver.stdout).match(/build \d+/)?.[0] ?? 'ok'} · ${short(bin)}` : `missing at ${short(bin)}`],
        [`${ok(size === model.bytes)} model file`, size ? `${(size / 1e9).toFixed(2)} GB · ${short(file)}` : `missing: download ${model.url}`],
        // Off is fine (it waits for /start), so it is not marked as a fault.
        modelOffNow() ? ['· server running', 'no: the model is off · /start loads it'] : [`${ok(!!agent.url && !starting)} server running`, serverRef.current?.port ? `port ${serverRef.current.port}, context ${Math.round(agent.ctx / 1024)}k` : opts.url ? opts.url : 'not running'],
        [`${ok(true)} vision`, !model.vision ? `${model.name} cannot look at pictures` : agent.canSee ? 'on: it can look at pictures in this window' : existsSync(visionPath(model)) ? 'off: turns on when you attach a picture' : `not downloaded: attaching a picture offers it (${(model.vision.bytes / 1e9).toFixed(2)} GB), or coding setup`],
        [`${ok(avail > needBytes(model, 16384))} free memory`, `${(avail / 1e9).toFixed(1)} GB (32k needs ${(needBytes(model, 32768) / 1e9).toFixed(1)} GB, 16k ${(needBytes(model, 16384) / 1e9).toFixed(1)} GB)`],
        [`${ok(disk === null || disk > 2)} disk space`, disk === null ? 'unknown' : `${disk.toFixed(1)} GB free`],
        [`${ok(true)} terminal`, `${process.env.TERM_PROGRAM ?? 'unknown'} · ${process.env.COLORTERM === 'truecolor' ? 'true colour' : '256 colours'} · ${columns}×${rows}`],
      ],
    });
  }, [agent, columns, rows, model, opts.url, push, starting]);

  // /agents: the window grows while its tree is open and goes back after (agents-window.mjs).
  const agentsGrow = () => {
    if (!canResize() || agentsSize.current) return;
    const cur = { columns: process.stdout.columns, rows: process.stdout.rows };
    const to = growTo(cur);
    if (!to) return;
    agentsSize.current = cur;
    try { process.stdout.write(resizeSeq(to[0], to[1])); } catch { /* the window stays as it is */ }
  };
  const agentsGiveBack = () => {
    const was = agentsSize.current;
    agentsSize.current = null;
    if (!was || !canResize()) return;
    try { process.stdout.write(resizeSeq(was.columns, was.rows)); } catch { /* it stays big */ }
  };
  const openAgentsTree = () => { setAgentsView('tree'); agentsGrow(); };
  const closeAgents = () => { setAgentsView(null); agentsGiveBack(); };
  const startAgents = (request, { demo = false, saved = null } = {}) => {
    const driver = demo ? demoDriver() : agentDriver(agent);
    const run = new AgentsRun({ request, driver, saved });
    agentsRef.current = run;
    // Accept edits for the run: the stop list asks about what matters; your mode comes back after.
    const before = agent.mode;
    if (!demo && before === 'ask') setMode('edits');
    run.on('state', (st) => setAgentsState({ ...st }));
    run.on('end', (st) => {
      if (!demo && before === 'ask') setMode('ask');
      setAgentsState({ ...st });
      const v = st.verdict ?? {};
      const files = demo ? 'a pretend run: nothing was written' : st.place ? `its files in ${st.place}/ (yours are as they were)` : 'SPEC.md, CONSTRAINTS.md, tasks/plan.md, tasks/todo.md, tasks/review.md and tasks/ship.md';
      push({ type: 'note', text: `/agents ${v.kind === 'go' ? 'GO' : v.kind === 'nogo' ? 'NO-GO' : v.kind === 'failed' ? 'stopped by an error' : 'stopped'}${v.why ? `: ${v.why}` : ''} · ${st.items[2]?.filter((t) => t.state === 'done').length ?? 0} tasks done · ${files} · nothing committed (read git diff, then commit). /agents opens the tree again.`, tone: v.kind === 'go' ? 'dim' : 'warn' });
      // A few seconds on the result, then the window is yours again.
      setTimeout(() => { if (agentsRef.current === run && !run.running) closeAgents(); }, 4000);
    });
    setAgentsState({ ...run.state });
    push({ type: 'note', text: `/agents${demo ? ' demo (a pretend run, nothing is written)' : ''}: ${request}`, tone: 'dim' });
    openAgentsTree();
    run.start(saved?.stage ?? 0);
  };
  // The answer to the question the run waits on; "type it" takes your next line in the chat.
  const agentsAnswer = (n) => {
    const run = agentsRef.current, g = run?.state.gate;
    if (!g || n < 0 || n >= g.opts.length) return;
    if (g.typeAt === n) {
      setAgentsView('chat');
      answerRef.current = ({ text }) => { run.answer(n, text); setAgentsView('tree'); };
      setAnswerWait(true);
      setPlaceholder('Type your answer for /agents, then enter');
      return;
    }
    run.answer(n);
  };
  const agentsKey = (ch, key) => {
    const run = agentsRef.current, st = run?.state;
    if (!run) return false;
    if (key.ctrl && ch === 'c') return false;
    if (key.escape) { if (run.running) setAgentsView('chat'); else closeAgents(); return true; }
    const g = st.gate;
    if (g) {
      if (/^[1-9]$/.test(ch) && Number(ch) <= g.opts.length) { agentsAnswer(Number(ch) - 1); return true; }
      if (key.upArrow || key.downArrow) { g.sel = (g.sel + (key.upArrow ? g.opts.length - 1 : 1)) % g.opts.length; setAgentsState({ ...st }); return true; }
      if (key.return) { agentsAnswer(g.sel); return true; }
    }
    if (ch === 'p' && !key.ctrl && !key.meta) { if (st.paused) run.resume(); else run.pause(); return true; }
    // Typing anything else goes to the chat, where it is a note for the next step.
    if (ch && !key.ctrl && !key.meta && !key.return && !key.tab) { setAgentsView('chat'); return false; }
    return true;
  };

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
          const back = agent.startOver(copyRef.current?.work ?? opts.cwd); // a window in its own copy stays there
          sessionRef.current = { id: newSessionId(), title: null, items: [] };
          // Like Claude Code's /clear: nothing of the old conversation is left on
          // the screen, in the scrollback, behind ctrl+o or in the status line;
          // only the start page, drawn again. The old one stays in /resume.
          pendingContext.current = [];
          folds.current = { list: [], back: 0 };
          setStats({});
          closeBtw();
          // The start page again, listing the conversation just cleared (a new key: its rows are measured afresh).
          try { recentRef.current = listSessions(copyRef.current?.work ?? opts.cwd); } catch {}
          itemsRef.current = [{ key: `welcome${++seq}`, type: 'welcome' }];
          holdRef.current = !opts.url && !remoteRef.current?.on; // live again until the next message
          setItems(itemsRef.current);
          win?.clear();
          rewindRef.current?.setSession(sessionRef.current.id);
          if (back) push({ type: 'note', text: `Back in ${short(opts.cwd)}, the folder Agentic Coder was started in.`, tone: 'dim' });
        }
        break;
      case 'btw': {
        // A quick side question, like Claude Code's: it runs while Agentic Coder works.
        if (!arg) { push({ type: 'note', text: 'Ask the question after it: /btw what are you doing right now?', tone: 'dim' }); break; }
        if (S.current.starting) { push({ type: 'note', text: 'The model is still starting; ask again in a moment.', tone: 'dim' }); break; }
        if (modelOffNow()) { push({ type: 'note', text: 'The model is off: /start loads it, then ask again.', tone: 'dim' }); break; }
        // Without a side lane the question would take the conversation's lane
        // and throw away its reading.
        if (agent.slots?.side === undefined) { push({ type: 'note', text: '/btw needs the model server\'s side lane, and this one has a single lane (with --url, add --slots 2).', tone: 'warn' }); break; }
        askBtw(arg);
        break;
      }
      case 'agents': {
        // /agents <request>: spec, plan, test-first build, verify, review and ship, on the agent tree.
        const run = agentsRef.current;
        const sub = arg.toLowerCase();
        if (sub === 'stop') { if (run?.running) { run.stop(); push({ type: 'note', text: 'Stopping /agents after this step. Nothing was committed.', tone: 'dim' }); } else push({ type: 'note', text: 'No /agents run is going.', tone: 'dim' }); break; }
        if (!arg || sub === 'open') {
          if (run) { openAgentsTree(); break; }
          const saved = savedRun(agent.cwd);
          push({ type: 'note', text: saved ? `An unfinished /agents run here: "${saved.request}". /agents resume goes on from ${AGENT_STAGES[saved.stage]?.name ?? 'where it stopped'}.` : 'Give it a request: /agents build a Kepler solver (/agents demo shows the tree on a pretend run).', tone: 'dim' });
          break;
        }
        if (run?.running) { push({ type: 'note', text: 'A /agents run is going: /agents opens it, /agents stop ends it.', tone: 'dim' }); break; }
        if (sub === 'demo') { startAgents('build a Kepler solver: where an orbit is at time t', { demo: true }); break; }
        if (busy || S.current.starting) { flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        if (modelOffNow()) { push({ type: 'note', text: 'The model is off: /start loads it, then /agents again.', tone: 'dim' }); break; }
        // Plan mode turns every edit away: said up front, not at each step (the run says it too).
        if (agent.mode === 'plan') { push({ type: 'note', text: '/agents writes its files and the code, and Plan mode only reads: leave Plan mode (shift+tab), then /agents again.', tone: 'warn' }); break; }
        if (sub === 'resume') {
          const saved = savedRun(agent.cwd);
          if (!saved) { push({ type: 'note', text: 'No unfinished /agents run in this folder.', tone: 'dim' }); break; }
          startAgents(saved.request, { saved });
          break;
        }
        startAgents(arg);
        break;
      }
      // /jumptomac [mac]: this window goes to your other Mac's sessions (the menu coding attach
      // <mac> shows) and this session keeps running; ctrl+b there comes back. The window does it
      // (door.mjs viewJumping): the app only asks its host to send the window that typed this.
      case 'jumptomac': {
        const here = process.env.AGENTIC_IN_HOST;
        const mac = (arg || loadSettings().lastMac || '').trim();
        if (!here) { push({ type: 'note', text: 'This window cannot jump: it runs the app itself, not a background session (an older Bun, or sessions switched off). Quit, then type: coding attach <mac>', tone: 'warn' }); break; }
        if (!mac) { push({ type: 'note', text: '/jumptomac <mac>: your other Mac’s Tailscale name (that Mac needs coding door on). After the first time, /jumptomac alone goes to the Mac used last.', tone: 'warn' }); break; }
        if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/.test(mac)) { push({ type: 'note', text: `"${mac}" is not a Mac’s name: letters, digits, dots and hyphens (its Tailscale name, like server-1).`, tone: 'warn' }); break; }
        const r = await askJump(here, mac);
        push({ type: 'note', text: r.ok ? `Jumping to ${mac}. This session keeps running here; ${DETACH_LABEL} there comes back to it.` : `Could not jump: ${r.text}`, tone: r.ok ? 'dim' : 'warn' });
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
        if (modelOffNow()) { push({ type: 'note', text: 'The model is off: /start loads it, then /compact can summarize.', tone: 'dim' }); break; }
        // agent.compact leaves a conversation this short as it is; said, so ctrl+p is not silent.
        if ((agent.said?.() ?? agent.messages?.length ?? 0) <= 3) { flash('Nothing to summarize yet: the conversation is still short', 2500); break; }
        setLive({ phase: 'working', turnStart: Date.now(), verb: 'Compacting', tokens: 0 });
        try { await agent.compact(undefined, { instructions: arg || undefined }); } catch (e) { push({ type: 'note', text: e.message, tone: 'error' }); }
        setLive(IDLE);
        break;
      case 'effort':
      case 'think': { // /think is the old name, still accepted
        // Alone: the Effort and limits panel. With a word:
        // /effort low|medium|high, or on|off ("off" and "xhigh" are the old
        // names for low and high).
        const levels = model.thinkingLevels ?? [];
        if (!arg.trim() && levels.length) { openEffortLimits(); break; }
        const a = arg.toLowerCase().replace(/^off$/, 'low').replace(/^xhigh$/, 'high');
        const picked = levels.find((l) => l.id === a);
        if (a && !picked && !/^(on|yes|true|1|no|false|0)$/i.test(a)) {
          push({ type: 'note', text: `${model.name} has no ${a} effort: it has ${levels.map((l) => l.label).join(' and ')}. Effort stays ${thinkingLevel(model, agent.thinking, agent.effort).label.toLowerCase()}.`, tone: 'warn' });
          break;
        }
        const on = picked ? !!picked.effort : a ? /^(on|yes|true|1)$/i.test(a) : !agent.thinking;
        const eff = on && picked?.effort ? picked.id : undefined;
        setThinking(on, eff);
        sayEffort(thinkingLevel(model, on, eff ?? agent.effort), limitsRef.current.thinking);
        break;
      }
      case 'mode': {
        if (!arg.trim()) { openChoice('mode'); break; }
        const m = modeOf(arg) ?? (/^[1-5]$/.test(arg.trim()) ? MODE_OPTIONS[Number(arg) - 1].id : null);
        if (!m) { push({ type: 'note', text: `There is no mode "${arg.trim()}": auto, manual, edits, plan or bypass (or 1–5, as /mode lists them).`, tone: 'warn' }); break; }
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
        // Folders said short: under the project as ./…, under home as ~/…
        const short = (p) => {
          const s = p?.startsWith(cwd) ? `.${p.slice(cwd.length)}` : tilde(p);
          if (s.length <= 34) return s;
          const two = s.split('/').slice(-2).join('/');
          return `…/${two.length <= 32 ? two : s.split('/').pop()}`; // whole folder names, never cut mid-word
        };
        const sections = [];
        for (const [title, dir] of [['About you', dirs.you], ['This project', dirs.project]]) {
          const facts = dir ? readFacts(dir).sort((x, y) => Number(y.always) - Number(x.always) || y.trust - x.trust || y.used - x.used) : [];
          if (!facts.length) continue;
          sections.push({ title, where: short(dir), facts: facts.slice(0, 8).map((f) => ({ id: f.id, kind: f.kind, always: f.always, pinned: f.pinned, trust: f.trust, used: f.used, text: f.text.replace(/\s+/g, ' ') })), more: Math.max(0, facts.length - 8) });
        }
        // Claude's notes are not Agentic Coder's to change: only how many there are, and where.
        let claude = null;
        if (agent.memory.claude) {
          const c = notesCount(agent.memory.claude === true ? notesDir() : notesDir({ setting: agent.memory.claude }));
          if (c.dir) claude = { used: c.used, where: tilde(c.dir), leftOut: c.leftOut.length };
        }
        if (!sections.length && !claude) { push({ type: 'note', text: 'Nothing saved yet. After a task Agentic Coder shows what it would remember and asks; "/update memory" or "remember that …" saves at once.', tone: 'dim' }); break; }
        const last = [dirs.you, dirs.project].filter(Boolean).flatMap((d) => readLog(d)).filter((l) => l.what !== 'trust').sort((x, y) => String(y.at).localeCompare(String(x.at)))[0];
        const at = last ? new Date(last.at) : null;
        const when = at ? `${at.getDate()} ${at.toLocaleString('en-US', { month: 'short' })}, ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : null;
        // How it is doing: is it learning, and do the facts come with requests?
        push({ type: 'memory', how: agent.memory.embedder ? 'meaning' : 'words', sections, claude, health: healthLine(health(dirs)), last: when });
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
            if (r.on.has('rag') && !agent.embedder && embedderReady() && limitsRef.current.embedder !== 'off') agent.embedder = new Embedder();
          }
          push({ type: 'note', text: r.text, tone: r.tone ?? 'dim' });
          break;
        }
        const set = helpersEnv();
        push({ type: 'panel', title: `Helpers · ${agent.helpers.size} of 4 on · what comes along with a request before the first step${set !== undefined ? ` · AGENTIC_HELPERS=${set} decides` : ''}`, pad: 35, rows: helperRows(agent.helpers, agent.lastHelpers ?? [], { ragPaused: limitsRef.current.embedder === 'off' }) });
        break;
      }
      case 'hooks': {
        // The app's checks as hooks, for when the model decides (agent/way.mjs): numbered, on or
        // off; "/hooks on 1" switches one. On App they all run, as they always have.
        const [what = '', ...rest] = arg.trim().split(/\s+/);
        if (what) {
          if (busy) { flash('Wait for Agentic Coder to finish first'); break; }
          const r = changeHooks(agent.hooks, what.toLowerCase(), rest.join(' '));
          if (r.changed) { agent.hooks = r.on; saveSettings({ hooks: [...r.on] }); }
          push({ type: 'note', text: `${r.text}${r.changed && agent.way === 'app' ? ' (Who decides is App in /effort, so every check runs now anyway.)' : ''}`, tone: r.tone ?? 'dim' });
          break;
        }
        const set = hooksEnv();
        const n = agent.way === 'app' ? 'all on: Who decides is App' : `${agent.hooks.size} of ${HOOKS.length} on while the model decides`;
        push({ type: 'panel', title: `Hooks · ${n} · the app's checks${set !== undefined ? ` · AGENTIC_HOOKS=${set} decides` : ''}`, pad: 32, rows: hookRows(agent.hooks, agent.way) });
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
      case 'design': {
        // Alone: the folder, set by set, and what is on. on|off: the cards with
        // page requests; check on|off: the browser check; ask on|off: a saved
        // page asks you before it is checked (or not); sets all|a,b: which
        // sets; style auto|opus|fable|mix: which set's cards win; studio
        // [on|off]: the design studio's pieces. Anything else is a request
        // sent with the cards.
        const saved = { ...(settings.design ?? {}) };
        const keep = (patch) => {
          const next = { ...saved, ...patch };
          settings.design = next;
          if (agent) agent.designSaved = next;
          saveSettings({ design: next });
          const now = designSettings(next);
          push({ type: 'note', text: `Design examples ${now.auto ? 'on' : 'off'} with page requests · layout check ${now.check ? 'on' : 'off'} · ${now.ask ? 'asks you first' : 'checks by itself'} · studio ${now.studio ? 'on' : 'off'} · sets: ${now.sets === 'all' ? 'all' : now.sets.join(', ')} · style: ${styleWords(now.style)}${process.env.AGENTIC_DESIGN || process.env.AGENTIC_LAYOUT || process.env.AGENTIC_LAYOUT_ASK || process.env.AGENTIC_DESIGN_SETS || process.env.AGENTIC_DESIGN_STYLE ? ' (an AGENTIC_DESIGN… setting in the environment decides over this)' : ''}.`, tone: 'dim' });
        };
        const a = arg.trim();
        if (!a) {
          const now = designSettings(saved);
          const sum = designSummary(now);
          if (!sum.dir) { push({ type: 'note', text: 'No design examples folder (make "design examples" in docs/private/, one subfolder per set of .md cards).', tone: 'warn' }); break; }
          push({ type: 'panel', title: `Design examples · ${now.auto ? 'on' : 'off'} with page requests · layout check ${now.check ? 'on' : 'off'} · ${now.ask ? 'asks you first' : 'checks by itself'} (/design ask) · studio ${now.studio ? 'on' : 'off'} (/design studio) · style: ${styleWords(now.style)} · ${sum.dir.replace(homedir(), '~')}`, pad: 18, rows: sum.rows });
          break;
        }
        if (/^(on|off)$/i.test(a)) { keep({ auto: /^on$/i.test(a) }); break; }
        const chk = /^check\s+(on|off)$/i.exec(a);
        if (chk) { keep({ check: /^on$/i.test(chk[1]) }); break; }
        // ask on: a saved page stops the turn and asks you before any check; off: it checks by itself.
        const ask = /^ask\s+(on|off)$/i.exec(a);
        if (ask) { keep({ ask: /^on$/i.test(ask[1]) }); break; }
        const sty = /^style(?:\s+(\S+))?$/i.exec(a);
        if (sty) {
          const want = sty[1]?.toLowerCase();
          if (!want || !DESIGN_STYLES.includes(want)) { push({ type: 'note', text: `The styles: ${DESIGN_STYLES.map((x) => `${x} (${styleWords(x)})`).join(' · ')}. Now: ${styleWords(designSettings(saved).style)}.`, tone: want ? 'warn' : 'dim' }); break; }
          keep({ style: want });
          break;
        }
        // studio: the design studio's pieces (agent/studio.mjs), alone its list; on|off: switch.
        const stu = /^studio(?:\s+(on|off))?$/i.exec(a);
        if (stu) {
          if (stu[1]) {
            const on = /^on$/i.test(stu[1]);
            const next = { ...saved, studio: on };
            settings.design = next;
            if (agent) agent.designSaved = next;
            saveSettings({ design: next });
            const now = designSettings(next);
            push({ type: 'note', text: `Design studio ${now.studio ? 'on' : 'off'}: ${now.studio ? 'a page request gets the pieces that fit it, and the page its built styles' : 'page requests get the design cards only'}${now.auto ? '' : ' (the design examples are off: /design on)'}${process.env.AGENTIC_STUDIO ? ' (AGENTIC_STUDIO in the environment decides over this)' : ''}.`, tone: 'dim' });
            break;
          }
          const sum = studioSummary();
          if (!sum.dir) { push({ type: 'note', text: 'No design studio folder (make "design studio" in docs/private/: styles/theme.css and components/<kind>/<piece>.html).', tone: 'warn' }); break; }
          const now = designSettings(saved);
          push({ type: 'panel', title: `Design studio · ${now.studio && now.auto ? 'on' : 'off'} with page requests · ${sum.dir.replace(homedir(), '~')}`, pad: 12, rows: sum.rows.length ? sum.rows : [['(none)', 'no pieces in components/ yet']] });
          break;
        }
        const sets = /^sets?\s+(.+)$/i.exec(a);
        if (sets) {
          const known = readCards(designDir()).sets.map((x) => x.name);
          const want = /^all$/i.test(sets[1].trim()) ? 'all' : sets[1].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
          const unknown = want === 'all' ? [] : want.filter((x) => !known.includes(x));
          if (unknown.length) { push({ type: 'note', text: `No set named ${unknown.join(', ')}. The sets: ${known.join(', ') || 'none yet'}.`, tone: 'warn' }); break; }
          keep({ sets: want });
          break;
        }
        if (busy) { flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        agent.designForce = true;
        sendPrompt(a, `/design ${a}`);
        break;
      }
      case 'settings':
        openSettings();
        break;
      case 'permissions': {
        // The raw text after the command: a new line in a command to try stays a new line.
        const r = changePermissions(agent.cwd, line.replace(/^\/permissions\b/i, ''), { mode: agent.mode, session: agent.allowedPrefixes });
        if (r.open === 'panel') { openPermissions(); break; }
        if (r.open === 'mode') { openChoice('startmode'); break; }
        if (r.mode) setMode(r.mode);
        if (r.panel) push({ type: 'panel', ...r.panel });
        if (r.text) push({ type: 'note', text: r.text, tone: r.tone ?? 'dim' });
        break;
      }
      // Not in the / menu (it holds what fits 80 × 24): the question a copy asks after a request,
      // again; outside a copy, the copy question for this folder.
      case 'copy': {
        if (busy) { flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        if (copyRef.current) { if (!askCopyBack({ force: true })) push({ type: 'note', text: 'Nothing in your copy waits to be put back.', tone: 'dim' }); break; }
        othersRef.current = (() => { try { return othersIn(projectOf(agent.cwd).root); } catch { return []; } })();
        openChoice('same-folder');
        break;
      }
      case 'rewind':
        openRewind();
        break;
      case 'resume': {
        const list = listSessions(cwd);
        if (!list.length) { push({ type: 'note', text: 'No earlier conversations in this folder.', tone: 'dim' }); break; }
        setPicker({ title: 'Resume a conversation', index: 0, items: list.map((s) => ({ key: s.id, label: s.title, desc: `${new Date(s.updated).toLocaleString()} · ${s.turns} prompt${s.turns === 1 ? '' : 's'}` })) });
        break;
      }
      case 'web': openWebPicker(); break;
      case 'screen': {
        // /screen: whether the model can look (macOS's Screen Recording, a model that sees
        // pictures) and the apps it may; /screen setup asks macOS, then opens its Settings page.
        if (process.platform !== 'darwin') { push({ type: 'note', text: 'Looking at the screen works on a Mac only.', tone: 'dim' }); break; }
        const sees = agent.canSee || agent.mayLook?.();
        if (arg.trim().toLowerCase() === 'setup') {
          if (screenAccess()) { push({ type: 'note', text: `${terminalApp()} may already take pictures of the screen: nothing to set up.`, tone: 'dim' }); break; }
          const ok = askScreenAccess();
          push({ type: 'note', text: ok ? `${terminalApp()} may take pictures of the screen now.` : `macOS keeps Screen Recording for itself to switch on: in System Settings (open now) → Privacy & Security → Screen & System Audio Recording, turn on ${terminalApp()}, then quit ${terminalApp()} and open it again (macOS asks that once). /screen says when it is allowed.`, tone: ok ? 'dim' : 'warn' });
          break;
        }
        const saved = agent.savedRules?.()?.allow?.filter((r) => /^Screen\(/i.test(r)) ?? [];
        const now = [...(agent.allowedPrefixes ?? [])].filter((r) => /^Screen\(/i.test(r));
        push({ type: 'note', text: [
          `Screen: ${screenAccess() ? `${terminalApp()} may take pictures of the screen` : `${terminalApp()} may not take pictures of the screen yet: /screen setup`}.`,
          `${model.name} ${sees ? 'can look at pictures, so it has the Screen tool: it asks before it looks at an app the first time (this time, for this session, or always).' : 'cannot look at pictures, so it has no Screen tool. A model that sees: on this Mac Qwen3.5 9B or Gemma, on Ollama one marked "vision" in /model.'}`,
          `It only looks: nothing is clicked or typed.${saved.length || now.length ? ` Allowed: ${[...saved.map((r) => `${r} (saved)`), ...now.map((r) => `${r} (this session)`)].join(', ')}.` : ''}`,
        ].join('\n'), tone: 'dim' });
        break;
      }
      case 'remote': {
        // /remote alone: the form. claude / computer / service: straight to that
        // service (the form, asking for its first row, when it is not set up);
        // here or off: back to this Mac; on: the last remote used.
        const w = arg.toLowerCase();
        const r = settings.remote ?? DEFAULT_REMOTE;
        const to = { claude: 'claude', computer: 'machine', machine: 'machine', service: 'openai', openai: 'openai' }[w];
        if (to) { remoteFnRef.current.to(to); break; }
        if (w === 'off' || w === 'here') {
          if (settings.remote) settings.remote = saveSettings({ remote: { ...r, use: false } }).remote;
          if (remoteRef.current.on) remoteFnRef.current.useLocal();
          else push({ type: 'note', text: 'Already on the model on this Mac. The remote stays off for next time too.', tone: 'dim' });
          break;
        }
        if (w === 'on') {
          if (!readyRemote(settings.remote ? remotesOf(settings)[sourceOf(r)] : null)) { push({ type: 'note', text: 'No remote is set up yet: pick Run on, fill in its rows, then Connect.', tone: 'dim' }); remoteFnRef.current.openForm(); break; }
          settings.remote = saveSettings({ remote: { ...r, use: true } }).remote;
          if (!remoteRef.current.conn) remoteFnRef.current.useRemote(settings.remote);
          else push({ type: 'note', text: `Already on the remote (${remoteLabel(r)}).`, tone: 'dim' });
          break;
        }
        if (w) { push({ type: 'note', text: '/remote alone opens the form; /remote claude, computer or service switches to one, /remote here (or off) comes back to this Mac.', tone: 'dim' }); break; }
        remoteFnRef.current.openForm();
        break;
      }
      case 'start':
        startFnRef.current();
        break;
      case 'stop':
        await stopFnRef.current();
        break;
      case 'autostart': {
        if (!arg.trim()) { openChoice('autostart'); break; }
        applyChoice('autostart', /^(on|yes|true)$/i.test(arg.trim()) ? 'on' : 'off');
        break;
      }
      case 'model': {
        openModelPicker();
        break;
      }
      case 'subagents': {
        openSubagentsPanel();
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
          ['pictures', agent.canSee ? 'on: it can look at pictures' : model.vision ? 'off: turns on when you attach one (ctrl+v, a dragged file, @file.png)' : 'this model cannot look at pictures'],
          ['search', `embedder ${showLimit('embedder', limitsRef.current.embedder)} · retriever ${showLimit('retriever', limitsRef.current.retriever).toLowerCase()} · reranker ${showLimit('reranker', limitsRef.current.reranker)}${agent.reranker?.last ? ` (last ${(agent.reranker.last.ms / 1000).toFixed(1)} s for ${agent.reranker.last.pieces})` : ''} · /effort moves them`],
          ['limits', `context ${showLimit('context', limitsRef.current.context)} · thinking cap ${showLimit('thinking', limitsRef.current.thinking)} · ${limitsRef.current.tries} tries · ${limitsRef.current.steps} steps · /effort moves them`],
          ['loaded', modelOffNow() ? 'no: the model is off · /start loads it' : model.remote || opts.url ? 'not by Agentic Coder' : `yes · until /stop or you quit${settings.modelAtStart ? ' · loads as a window opens (/autostart)' : ''}`],
          ['server', model.remote ? `remote ${remoteLabel(settings.remote)} · ${kindWord(settings.remote?.kind)}${remoteRef.current.conn ? '' : ' · not connected'}` : serverRef.current?.port ? `port ${serverRef.current.port} · restarts ${serverRef.current.restarts}` : opts.url ?? (modelOffNow() ? 'off' : '—')],
        ] });
        break;
      case 'doctor':
        doctor();
        break;
      case 'arena':
      case 'battle': { // /battle: its name before 30 Sep 2026, still typed
        // The hub on its Arena tab: a test on one model, or a battle of two. The Arena runs on its own
        // (the hub starts it), so what runs there keeps going when this window closes.
        const hub = openHub('arena'); if (!hub) break;
        push({ type: 'note', text: `The Arena opened in the browser at ${hub.url} · run a test on one model, or battle two with it, one model at a time, each run stopped at 10 min · while something runs there, ${model.name} here is unloaded and comes back by itself when it ends`, tone: 'dim' });
        break;
      }
      case 'test': {
        // The Arena with this window's model as who runs it: pick a test (or name one: /test practice 28,
        // /test work28, /test 12 for practice test 12, /test 18b for your copy of it, /test sorting) and press
        // Run there. The run is the Arena runner's: this window lets go of its model while it runs, and it keeps
        // going when this window closes.
        const num = /^(?:task\s*)?(\d{1,2}[b-z]?)$/i.exec(arg);
        const t = arg ? (findRunTest(arg) ?? (num ? RUN_TESTS.find((x) => x.id === 'task') : null)) : null;
        if (arg && !t) { push({ type: 'note', text: `No test called "${arg}". Try one of: ${RUN_TESTS.map((x) => x.name.toLowerCase()).join(', ')}, or a practice task's number (/test 12). /test alone opens the list.`, tone: 'warn' }); break; }
        const mine = model.edited ? model.edited.base : model.id;
        const hub = openHub('arena', { run: '1', model: t && !t.model ? 'none' : MODELS[mine] ? mine : '', test: t?.id, n: num && t?.id === 'task' ? num[1] : '' });
        if (!hub) break;
        push({ type: 'note', text: `The Arena opened in the browser at ${hub.url} · ${t ? `${t.name}${num && t.id === 'task' ? ` ${num[1]}` : ''} is picked` : 'pick a test'}${t && !t.model ? '' : ` on ${model.name}`}, then press Run · while it runs, ${model.name} here is unloaded and comes back by itself when it ends`, tone: 'dim' });
        break;
      }
      case 'tests': {
        // The Arena with the test record over it: every test run and its result.
        const hub = openHub('arena', { record: '1' }); if (!hub) break;
        const runs = readRecord();
        push({ type: 'note', text: runs.length ? `The test record opened in the browser at ${hub.url} · ${runs.length} run${runs.length === 1 ? '' : 's'} recorded, the latest: ${runs[0].name} (${runs[0].total != null ? `${runs[0].passed} of ${runs[0].total}` : runs[0].result}) · it stays up while this window is open` : `The test record opened in the browser at ${hub.url} · no test has been recorded yet`, tone: 'dim' });
        break;
      }
      case 'instructions': {
        const hub = openHub('instructions'); if (!hub) break;
        push({ type: 'note', text: `Instructions opened at ${hub.url} · saved changes apply to the next task`, tone: 'dim' });
        break;
      }
      case 'weights':
      case 'docs': {
        // The hub in the browser: the same server as `coding weights` / `coding docs`,
        // inside this window. /weights opens it on the models' weights (every model in
        // /model, one alone or side by side), /docs on the harness diagram with
        // structure and every page one tab away.
        const here = Object.values(MODELS).filter((m) => m.format !== 'mlx' && existsSync(modelPath(m)));
        if (cmd === 'weights' && !here.length) { push({ type: 'note', text: `No model file is here yet (${modelPath(MODELS[DEFAULT_MODEL])}). Run coding setup first.`, tone: 'warn' }); break; }
        const hub = openHub(cmd === 'docs' ? 'harness' : 'weights'); if (!hub) break;
        const w = hub.server; const url = hub.url;
        if (cmd === 'docs') {
          const d = listDocs(w.docsDir);
          push({ type: 'note', text: d.missing ? `Docs opened at ${url}, but the DOCS folder was not found (docs/ in the repo; set AGENTIC_DOCS to point elsewhere)` : `Docs opened in the browser at ${url} · ${d.pages.length} pages from ${d.dir.replace(process.env.HOME, '~')}${d.pinned.harness ? ` · harness: ${d.pinned.harness.title}` : ''}${d.pinned.structure ? ` · structure: ${d.pinned.structure.title}` : ''} · it stays up while this window is open`, tone: d.missing ? 'warn' : 'dim' });
        } else push({ type: 'note', text: `Weights of ${here.map((m) => m.name).join(' and ')} opened in the browser at ${url} · it stays up while this window is open`, tone: 'dim' });
        break;
      }
      case 'meters': {
        if (!arg.trim()) { openChoice('meters'); break; }
        applyChoice('meters', /^(on|show|yes)$/i.test(arg) ? 'on' : 'off');
        break;
      }
      case 'mouse': {
        if (!arg.trim()) { openChoice('mouse'); break; }
        applyChoice('mouse', /^(on|yes)$/i.test(arg.trim()) ? 'on' : 'off');
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
        push({ type: 'note', text: `Unknown command /${cmd}. /settings has the ones not in the / menu, and /help lists them all.`, tone: 'warn' });
    }
  }, [agent, askBtw, closeBtw, cwd, doctor, flash, meters, model, opts.url, push, quit, ramGb, sendPrompt, setMode, setThinking, stats, update, updateNow, win]);

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
      // During a turn the Ask step shows the answer ("You: …"); an echo of it would say it twice.
      if (!railOn.current) push({ type: 'user', text: value });
      addHistory(cwd, value);
      historyRef.current.push(value);
      setPlaceholder(pick(PLACEHOLDERS));
      resolve({ choice: 'answer', text: value });
      return;
    }
    if (value.startsWith('/')) { runSlash(value); return; }
    if (value.startsWith('!')) { runShell(value.slice(1).trim()); return; }
    // While /agents runs, a message is a note for its next step (the model is busy with the run).
    if (agentsRef.current?.running && !isQuit(value)) {
      agentsRef.current.note(value);
      push({ type: 'note', text: `Noted for /agents: "${value}" goes with its next step. esc opens the tree.`, tone: 'dim' });
      return;
    }
    // "exit" or "quit" typed as a plain message quits, like /exit.
    if (isQuit(value)) { quit(); return; }
    addHistory(cwd, value);
    historyRef.current.push(value);
    setTip(null);
    // A model loading on the service: the message waits for it (preloadRemote sends it).
    if (agent.busy || S.current.starting || S.current.remoteState === 'loading') { queuedRef.current = value; setQueued(value); return; }
    sendPrompt(value);
  }, [agent, cwd, push, quit, runShell, runSlash, sendPrompt]);

  // Menu under the prompt: slash commands or @files.
  const inputMode = input.value.startsWith('!') ? 'bash' : 'prompt';
  let menu = null;
  const btwShown = Boolean(btw && !perm && !answerWait);
  if (!perm && !picker && !btwShown && input.value !== menuClosedFor) {
    // The rows the / menu may take: 18 as ever, and more in a window with room for them (the box, the
    // footer and their gaps take 6). Under the start page while it is still live, only what fits
    // under it: one row too many would print the page, and /start could no longer change it in place.
    const fits = holdRef.current ? holdRoom(items, measure.current, rows ?? 40) - heldRows(items, measure.current) : (rows ?? 24) - 6;
    const room = Math.max(MENU_ROWS, Number.isFinite(fits) ? fits : 0);
    const cmds = inputMode === 'prompt' ? matchCommands(input.value, { service: Boolean(model.remote?.ollama && remoteRef.current.conn?.info?.ollama), room }) : [];
    if (cmds.length) menu = { kind: 'slash', rows: room, pad: Math.max(14, ...cmds.map((c) => c.name.length + 3)), items: cmds.map((c) => ({ label: `/${c.name}`, desc: c.desc, value: c.name, takesArg: !!c.arg, picker: !!c.picker })) };
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
    // /remote: a paste goes into the row being edited (an API key, an address), or starts editing a text row.
    const rp = S.current.picker;
    if (rp?.kind === 'remote' || rp?.kind === 'web') {
      const row = (rp.kind === 'web' ? WEB_ROWS : remoteRows(rp))[rp.index];
      if (rp.editing) setPicker({ ...rp, editing: pasteField(rp.editing, text) });
      else if (row?.type === 'text' || row?.type === 'secret') setPicker({ ...startEdit(rp, row.id), editing: pasteField({ id: row.id, value: '', cursor: 0 }, text) });
      return;
    }
    if (S.current.perm || S.current.picker || (S.current.btw && !S.current.answerWait)) return;
    // Text copied off this screen (your message, the prompt box) comes back as it was written:
    // without the screen's line breaks, indents, padding and │ edges. ctrl+z gives the paste as copied.
    const raw = text.replace(/\r\n?/g, '\n');
    const clean = fromScreen(raw, { cols: width });
    setInput((s) => {
      const pasted = withUndo(s, insertText(s, raw));
      return clean === raw ? pasted : withUndo(pasted, insertText(s, clean));
    });
  });

  // The prompt box's rows as it draws them (its width; the ! of shell mode is not drawn).
  const rowsOf = (s) => ({ width: promptTextWidth(width), skip: s.value.startsWith('!') ? 1 : 0 });
  // The mouse in the prompt box (/mouse on). Terminal hands it over while
  // the box is on screen (with or without text in it, since 30 Sep 2026, so a
  // click on the model's label in the footer starts or stops the model): a
  // press puts the cursor there, a drag highlights (the selection shift +
  // arrows make: copied at once, delete removes it) and a double click takes
  // the word. A scroll gives the mouse back for a moment, so the rest of it
  // moves the conversation as it always did; fn held is Terminal's own highlight.
  const { internal_eventEmitter: rawKeys } = useStdin();
  const tty = win?.out ?? process.stdout;
  const mouseArmed = mouse && !perm && !picker && !btwShown && !wheelPause && !leaving && !tooSmall;
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
  // One press, drag or release, with the box's place on screen known (origin:
  // the screen row and cell of the first row's first letter).
  const onMouse = (ev) => {
    const m = mouseRef.current;
    const s = S.current.input;
    const o = rowsOf(s);
    const row = ev.row - m.origin.row, x = ev.col - m.origin.col;
    if (ev.kind === 'release') { m.down = false; return; }
    if (ev.kind === 'drag') {
      if (!m.down) return;
      const to = posAt(s, row, x, o);
      setInput((p) => withUndo(p, { value: p.value, cursor: to, anchor: p.anchor ?? p.cursor }));
      return;
    }
    const boxRows = cursorCell(s, o).rows.length;
    // The footer's row is two under the box's bottom edge (a blank row between): a press on the model's label switches it.
    const f = footerRef.current;
    if (row === boxRows + 2 && f?.labelAt && ev.col >= f.labelAt.from && ev.col <= f.labelAt.to) { m.down = false; toggleFnRef.current('click'); return; }
    // a press counts only on one of the box's own rows
    if (row < 0 || row >= boxRows) { m.down = false; return; }
    const to = posAt(s, row, x, o);
    const again = Boolean(m.last) && m.last.to === to && Date.now() - m.last.t < DOUBLE_CLICK_MS;
    m.last = again ? null : { to, t: Date.now() };
    m.down = !again;
    setPopup(null);
    if (again) { const [a, b] = wordAt(s.value, to); setInput((p) => withUndo(p, { value: p.value, cursor: b, anchor: a })); return; }
    setInput((p) => withUndo(p, { value: p.value, cursor: to, anchor: ev.shift ? (p.anchor ?? p.cursor) : to }));
  };
  // What Terminal sends for the mouse arrives with the keys. A press first
  // asks where the cursor is (it sits where you type, so the answer places
  // the box: the conversation above it may have grown since the last press).
  const onRawRef = useRef(null);
  onRawRef.current = (seq) => {
    const m = mouseRef.current;
    if (!m.armed || typeof seq !== 'string') return;
    const at = parseCursorReply(seq);
    if (at) {
      if (!m.asked) return;
      clearTimeout(m.asked);
      m.asked = null;
      const c = cursorCell(S.current.input, rowsOf(S.current.input));
      m.origin = { row: at.row - c.row, col: at.col - c.x };
      m.waiting.splice(0).forEach(onMouse);
      return;
    }
    const ev = parseMouse(seq);
    if (!ev || ev.kind === 'other') return;
    if (ev.kind === 'wheel') {
      setWheelPause(true);
      clearTimeout(m.wheel);
      m.wheel = setTimeout(() => setWheelPause(false), WHEEL_PAUSE_MS);
      return;
    }
    if (ev.kind === 'press') {
      clearTimeout(m.asked);
      m.origin = null;
      m.waiting = [ev];
      m.asked = setTimeout(() => { m.asked = null; m.waiting = []; }, 500);
      tty.write(ASK_CURSOR);
      return;
    }
    if (m.origin) onMouse(ev);
    else if (m.asked) m.waiting.push(ev);
  };
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
  const flushArrows = () => {
    const keys = arrowsRef.current;
    if (!keys.length) return;
    arrowsRef.current = [];
    if (keys.length === 1) { onKey('', keys[0]); return; }
    const n = (k) => keys.filter((x) => x[k]).length;
    setPopup(null);
    setInput((s) => withUndo(s, moveBy(s, n('downArrow') - n('upArrow'), n('rightArrow') - n('leftArrow'), rowsOf(s))));
  };
  // ctrl+r: a second opinion now (2 Oct 2026, a key for big models). The review helper on an Ollama
  // service (/subagents) reads the last message's request and change, as it does after a change.
  // What it finds goes into an empty prompt, for enter to send to the model.
  const secondOpinionNow = async () => {
    if (agent.busy || S.current.live.phase === 'working') { flash('Wait for Agentic Coder to finish, or press esc first'); return; }
    if (!agent.helperUse?.('review')) { flash(model.remote ? 'No second opinion here: /subagents gives the job a model on an Ollama service' : 'A second opinion needs a review model on an Ollama service (/remote service, then /subagents)', 3000); return; }
    if (!agent.turn?.changed || !agent.turn.diffs?.trim()) { flash('Nothing changed in the last message, so there is nothing to review', 2500); return; }
    const ac = new AbortController();
    abortRef.current = ac;
    setLive({ phase: 'working', turnStart: Date.now(), verb: 'Checking', tokens: 0 });
    try {
      const found = await agent.secondOpinion(ac.signal);
      if (found && !ac.signal.aborted) {
        if (S.current.input.value) flash('What it found is above; your prompt was left as it is', 3000);
        else { setInput((s) => withUndo(s, { value: found, cursor: found.length })); flash('What it found is in the prompt: enter sends it to the model', 4000); }
      }
    } catch (e) {
      if (!ac.signal.aborted) push({ type: 'note', text: `Second opinion: ${e.message}`, tone: 'error' });
    } finally { setLive(IDLE); }
  };

  useInput((ch, key) => {
    if (isMouseText(ch)) return; // the mouse's reports are handled above, never typed
    const cur = S.current;
    const arrow = (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) && !key.shift && !key.meta && !key.ctrl;
    if (arrow && !cur.tooSmall && !cur.perm && !cur.picker && !(cur.btw && !cur.answerWait) && !waitRef.current) {
      arrowsRef.current.push(key);
      if (arrowsRef.current.length === 1) queueMicrotask(flushArrows);
      return;
    }
    flushArrows();
    onKey(ch, key);
  });
  const onKey = (ch, key) => {
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
    // /agents' tree has the window: its keys first (a permission prompt or a question shows over it).
    if (cur.agentsView === 'tree' && agentsRef.current && !cur.perm && !cur.picker && !cur.answerWait) {
      if (agentsKey(ch, key)) return;
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
        // "Always allow": saved for this folder, and it runs now. If it cannot be saved it still holds for this session.
        if (choice === 'save') {
          const r = addRule(agentRef.current.cwd, 'allow', p.offer.rule);
          push({ type: 'note', text: r.ok ? `Saved for this folder: "${p.offer.rule}" runs without asking. /permissions lists it; /permissions remove allow <n> takes it back.` : r.duplicate ? `"${p.offer.rule}" is already saved.` : `${r.error} It holds for this session only.`, tone: r.ok || r.duplicate ? 'dim' : 'warn' });
          p.resolve({ choice: r.ok || r.duplicate ? 'yes' : 'always' });
          return;
        }
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
    // /model on an Ollama service (remote-models.mjs): ↑↓ a row, ←→ the highlighted model's effort,
    // letters filter by name (backspace takes one back, esc clears it, then closes), enter switches
    // to the model (one without tools asks first), opens or shuts a fold, or goes to a model here.
    // /subagents: ↑↓ the job, ←→ its model, space on or off (saved at once), enter loads it now, esc closes.
    if (cur.picker?.kind === 'subagents') {
      const pk = cur.picker;
      const set = (next) => { setPicker(next); if (next.jobs !== pk.jobs) saveSubagents(next.jobs); };
      if (key.upArrow) setPicker(moveJob(pk, -1));
      else if (key.downArrow || key.tab) setPicker(moveJob(pk, 1));
      else if (key.leftArrow || key.rightArrow) set(stepModel(pk, key.leftArrow ? -1 : 1));
      else if (ch === ' ') set(toggleJob(pk));
      else if (key.return) loadSubagent(pk.jobs[pk.at]);
      else if (key.escape || (key.ctrl && ch === 'c')) setPicker(null);
      return;
    }
    if (cur.picker?.kind === 'service') {
      const pk = cur.picker;
      const sv = serviceOf(pk);
      const rows = serviceRows(pk, sv);
      const row = atRow(pk, rows);
      const typed = ch && !key.ctrl && !key.meta && !key.escape && !key.return && !key.tab ? ch.replace(/[\x00-\x1f\x7f]/g, '') : '';
      if (key.upArrow) setPicker(moveService(pk, rows, -1));
      else if (key.downArrow) setPicker(moveService(pk, rows, 1));
      else if (key.escape) setPicker(pk.filter ? filterService(pk, sv, '') : null);
      else if (key.ctrl && ch === 'c') setPicker(null);
      else if (key.backspace || key.delete) { if (pk.filter) setPicker(filterService(pk, sv, pk.filter.slice(0, -1))); }
      else if (key.return && row) {
        if (row.kind === 'fold') { setPicker(toggleFold(pk, row.id)); return; }
        if (row.kind === 'service') { setPicker(null); remoteTo(row.s.source); return; }
        if (row.kind === 'local') { setPicker(null); pickHere(row.m); return; }
        // A model on the service: its own settings first, and nothing loads until enter there (the
        // user's pick, 2 Oct 2026). One without tools is asked about before that.
        if (!row.m.tools && row.m.id !== sv.inUse) { setPicker(null); chatOnlyRef.current = { m: row.m, back: pk }; openChoice('service-chat-only'); return; }
        openOwnSettings(row.m, { back: pk });
      } else if (typed) setPicker(filterService(pk, sv, pk.filter + typed));
      return;
    }
    if (cur.picker?.kind === 'model') {
      const pk = cur.picker;
      // ←→ step through the highlighted model's own levels, from the one it shows now.
      const levels = pickLevels(pk), k = levels.findIndex((l) => l.id === pickLevel(pk).id);
      const toLevel = (i) => (levels[i] ? { levelId: levels[i].id, on: Boolean(levels[i].effort) } : {});
      if (key.leftArrow) setPicker({ ...pk, ...toLevel(Math.max(0, k - 1)) });
      else if (key.rightArrow || key.tab) setPicker({ ...pk, ...toLevel(key.tab ? (k + 1) % levels.length : Math.min(levels.length - 1, k + 1)) });
      else if (key.upArrow) setPicker({ ...pk, index: Math.max(0, pk.index - 1) });
      else if (key.downArrow) setPicker({ ...pk, index: Math.min(pk.models.length - 1, pk.index + 1) });
      else if (key.escape || (key.ctrl && ch === 'c')) setPicker(null);
      else if (key.return) {
        const lv = pickLevel(pk);
        const on = !!lv?.effort;
        setThinking(on, on ? lv.id : undefined);
        setPicker(null);
        const picked = pk.models[pk.index];
        // A remote's row: that service, as /remote claude (computer, service) would. A model here while on a remote: back to this Mac.
        if (picked.remoteRow) {
          if (model.remote?.source === picked.source && remoteRef.current.conn) push({ type: 'note', text: `${model.name} · effort ${lv?.label.toLowerCase() ?? 'low'}.`, tone: 'dim' });
          else remoteTo(picked.source);
          return;
        }
        if (model.remote) { pickHere(picked); return; }
        // A different model — or the same edited copy with newer edits saved
        // since — restarts the model server in place; the window stays.
        const changed = picked.id !== model.id || (picked.edited && model.edited && picked.edited.saved !== model.edited.saved);
        switchBackRef.current = null; // your pick wins over a model coming back after a picture
        // A model whose file (or its own model server) is not here yet: say how to get it, keep the one in use.
        const missing = changed && !picked.edited ? [!existsSync(modelPath(picked)) && `downloads it (${(picked.bytes / 1e9).toFixed(1)} GB)`, picked.engine && !existsSync(serverBinOf(picked)) && (engineOf(picked).python ? 'sets up its Python (a few minutes)' : 'builds its model server (about 3 minutes)')].filter(Boolean) : [];
        if (missing.length) { push({ type: 'note', text: `${picked.name} is not ready on this Mac yet: coding setup --model ${picked.id} ${missing.join(' and ')}. Then pick it again.`, tone: 'warn' }); return; }
        if (changed) { saveSettings({ model: picked.id }); switchModel(picked); }
        else push({ type: 'note', text: `${picked.name} · effort ${lv?.label.toLowerCase() ?? 'low'}.`, tone: 'dim' });
      }
      return;
    }
    // /remote: ↑↓ a row, ←→ a choice row (More: open / fold), enter (or a
    // letter) edits a text row, opens or folds More, runs Connect or Save only,
    // and on a choice row goes to the next row; while a row is being edited, its
    // keys only. /web: the same form keys, its own rows (web-form.mjs), Test and Save.
    if (cur.picker?.kind === 'remote' || cur.picker?.kind === 'web') {
      const pk = cur.picker;
      const web = pk.kind === 'web';
      const kept = web ? 'Web settings kept as they were.' : 'Remote kept as it was.';
      if (pk.editing) {
        if (key.return) setPicker(commitEdit(pk));
        else if (key.escape) setPicker({ ...pk, editing: null });
        else if (key.ctrl && ch === 'c') { setPicker(null); push({ type: 'note', text: kept, tone: 'dim' }); }
        else setPicker({ ...pk, editing: editField(pk.editing, ch, key) });
        return;
      }
      if (!web && pk.pick) {
        const n = pk.pick.models.length;
        if (key.upArrow) setPicker(movePick(pk, -1));
        else if (key.downArrow || key.tab) setPicker(movePick(pk, 1));
        else if (key.leftArrow || key.rightArrow) setPicker(moveCopy(pk, key.leftArrow ? -1 : 1));
        else if (key.return) { const next = commitPick(pk); setPicker(next); connectForm(next); }
        else if (/^[1-9]$/.test(ch) && Number(ch) <= n) { const next = commitPick({ ...pk, pick: { ...pk.pick, index: Number(ch) - 1 } }); setPicker(next); connectForm(next); }
        else if (key.escape) setPicker(closePick(pk));
        else if (key.ctrl && ch === 'c') { setPicker(null); push({ type: 'note', text: kept, tone: 'dim' }); }
        return;
      }
      const rows = web ? WEB_ROWS : remoteRows(pk);
      const n = rows.length;
      const row = rows[Math.min(pk.index, n - 1)];
      // A key row with no search service picked has nothing to take.
      const text = (row.type === 'text' || row.type === 'secret') && !(web && pk.values.search === 'off');
      const typed = ch && !key.ctrl && !key.meta && !key.escape && !key.return && !key.tab && ch >= ' ';
      if (key.upArrow) setPicker({ ...pk, index: (pk.index + n - 1) % n });
      else if (key.downArrow || key.tab) setPicker({ ...pk, index: (pk.index + 1) % n });
      else if (key.leftArrow || key.rightArrow) setPicker((web ? moveWebRow : moveRow)(pk, row.id, key.rightArrow ? 1 : -1));
      else if (key.return && !web && row.id === 'model' && modelChoices(pk).length > 1) setPicker(openModelPick(pk));
      else if (key.return && text) setPicker(startEdit(pk, row.id));
      else if (key.return && web) (row.id === 'test' ? runWebTest : saveWeb)(pk);
      else if (key.return && row.id === 'more') setPicker({ ...pk, more: !pk.more });
      else if (key.return && row.id === 'go') { if (!pk.test?.running) connectForm(pk); }
      else if (key.return && row.id === 'keep') saveOnlyForm(pk);
      else if (key.return) setPicker({ ...pk, index: Math.min(n - 1, pk.index + 1) });
      // Typing on a text row starts it over with what you type (enter keeps the old text to change it).
      else if (typed && text) setPicker({ ...startEdit(pk, row.id), editing: pasteField({ id: row.id, value: '', cursor: 0 }, ch) });
      else if (key.escape || (key.ctrl && ch === 'c')) { setPicker(null); push({ type: 'note', text: kept, tone: 'dim' }); }
      return;
    }
    // /effort: ↑↓ a row (Effort first, then the limits), ←→ lower / raise it, enter saves all of it (on the last row: everything back to its default), esc keeps them.
    // /model's menu for a model on the service is the same panel with its own rows (pk.own): enter switches to it, esc goes back to the list.
    // On a service, s fills in the suggested values, and the last row puts the model back on the shared settings.
    if (cur.picker?.kind === 'limits') {
      const pk = cur.picker;
      const m = pk.model;
      const levels = m.thinkingLevels ?? [];
      const off = levels.length ? 1 : 0; // the Effort row, when the model has levels
      const shown = shownLimits(m, { own: Boolean(pk.own) });
      const rows = off + shown.length + 1;
      const step = key.rightArrow ? 1 : -1;
      const svc = Boolean(pk.own) || onService();
      if (key.upArrow) setPicker({ ...pk, index: (pk.index + rows - 1) % rows });
      else if (key.downArrow || key.tab) setPicker({ ...pk, index: (pk.index + 1) % rows });
      else if ((key.leftArrow || key.rightArrow) && off && pk.index === 0) setPicker({ ...pk, level: Math.max(0, Math.min(levels.length - 1, pk.level + step)) });
      else if ((key.leftArrow || key.rightArrow) && pk.index >= off && pk.index < rows - 1) setPicker({ ...pk, values: moveLimit(pk.values, shown[pk.index - off].id, step, m) });
      else if (ch === 's' && !key.ctrl && !key.meta && pk.suggested) setPicker(fillSuggested(pk));
      else if (key.return) {
        const reset = pk.index === rows - 1;
        if (pk.own) { saveOwnSettings(pk, { reset }); return; }
        setPicker(null);
        if (reset && svc) saveEffortLimits(off ? levels[pk.level]?.id : null, sharedValues(pk), { reset: true });
        else if (reset) saveEffortLimits(off ? defaultLevelId(m) : null, defaultLimits(m));
        else saveEffortLimits(off ? levels[pk.level]?.id : null, pk.values);
      }
      else if (key.escape && pk.own?.back) setPicker(pk.own.back);
      else if (key.escape || (key.ctrl && ch === 'c')) { setPicker(null); push({ type: 'note', text: pk.own && !pk.own.inUse ? `Not switched: still on ${model.remote?.model ?? model.name}.` : 'Effort and limits kept as they were.', tone: 'dim' }); }
      return;
    }
    // A choice menu (/mode, /meters, /mouse): ↑↓ or a number, enter picks, esc goes back unchanged
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
        // The message with the picture was not sent: it goes back into the prompt.
        if (pk.id === 'vision-switch') {
          const wait = visionWaitRef.current;
          visionWaitRef.current = null;
          if (wait) setInput((s) => withUndo(s, { value: wait.value, cursor: wait.value.length }));
          push({ type: 'note', text: 'Not sent: your message is back in the prompt.', tone: 'dim' });
          return;
        }
        const kept = pk.options.find((o) => o.id === pk.current);
        push({ type: 'note', text: `Kept ${pk.what} as ${kept ? kept.label.toLowerCase() : 'it was'}.`, tone: 'dim' });
      }
      return;
    }
    // /rewind: ↑↓ a message, enter shows what would go back; then ↑↓ or a
    // number picks what to put back, esc goes back to the list.
    if (cur.picker?.kind === 'rewind') {
      const pk = cur.picker;
      if (pk.stage === 'list') {
        const n = pk.items.length;
        if (key.upArrow) setPicker({ ...pk, index: Math.max(0, pk.index - 1) });
        else if (key.downArrow || key.tab) setPicker({ ...pk, index: Math.min(n - 1, pk.index + 1) });
        else if (key.return) chooseRewind(pk);
        else if (key.escape || (key.ctrl && ch === 'c')) setPicker(null);
        return;
      }
      const n = pk.options.length;
      if (key.upArrow) setPicker({ ...pk, choice: (pk.choice + n - 1) % n });
      else if (key.downArrow || key.tab) setPicker({ ...pk, choice: (pk.choice + 1) % n });
      else if (key.return) applyRewind(pk, pk.options[pk.choice].id);
      else if (/^[1-9]$/.test(ch) && Number(ch) <= n) applyRewind(pk, pk.options[Number(ch) - 1].id);
      else if (key.escape) setPicker({ ...pk, stage: 'list' });
      else if (key.ctrl && ch === 'c') setPicker(null);
      return;
    }
    // /settings: ↑↓ a row, enter runs its command, esc goes back
    if (cur.picker?.kind === 'settings') {
      const pk = cur.picker;
      const n = pk.rows.length;
      if (key.upArrow) setPicker({ ...pk, index: (pk.index + n - 1) % n });
      else if (key.downArrow || key.tab) setPicker({ ...pk, index: (pk.index + 1) % n });
      else if (key.return) { setPicker(null); runSlash(`/${pk.rows[pk.index].name}`); }
      else if (key.escape || (key.ctrl && ch === 'c')) setPicker(null);
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
    // ctrl+v: the clipboard's picture (a screenshot copied with ctrl+shift+cmd+4, say) attached as [Image #n].
    if (key.ctrl && ch === 'v') {
      try {
        const dir = join(HOME, 'attachments');
        mkdirSync(dir, { recursive: true });
        const n = pastedRef.current.n + 1;
        const file = join(dir, `${sessionRef.current.id}-${n}.png`);
        const info = clipboardImage(file);
        if (!info) { flash('No picture on the clipboard (text pastes with cmd+v)', 2500); return; }
        pastedRef.current.n = n;
        pastedRef.current.files.set(n, file);
        setInput((st) => withUndo(st, insertText(st, `[Image #${n}] `)));
        flash(`Picture ${info.w}×${info.h} attached as [Image #${n}]`, 2500);
      } catch (e) { flash(`Could not paste the picture: ${e.message}`, 3000); }
      return;
    }
    if (key.ctrl && ch === 'c') {
      if (agent.busy || cur.live.phase === 'working') { interrupt(); return; }
      if (cur.input.value) { setInput((s) => withUndo(s, { value: '', cursor: 0 })); return; } // ctrl+z brings it back
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
      if (selectedText(cur.input)) { setInput((s) => withUndo(s, { value: s.value, cursor: s.cursor })); return; } // drops the selection only
      // /agents goes on behind the chat: esc opens its tree again (/agents stop ends it).
      if (agentsRef.current?.running && cur.agentsView === 'chat' && !cur.input.value && !cur.perm) { openAgentsTree(); return; }
      if (agent.busy || cur.live.phase === 'working') { interrupt(); return; }
      if (cur.input.value) {
        if (Date.now() - escArmed.current < 1500) { setInput((s) => withUndo(s, { value: '', cursor: 0 })); return; } // ctrl+z brings it back
        escArmed.current = Date.now();
        flash('Press esc again to clear', 1500);
        return;
      }
      // On an empty prompt, esc twice opens /rewind (as in Claude Code).
      if (rewindArmed.current && Date.now() - rewindArmed.current < 1500) { rewindArmed.current = 0; openRewind(); return; }
      rewindArmed.current = Date.now();
      if (rewindRef.current?.points.length) flash('Press esc again to rewind', 1500);
      return;
    }
    if (key.tab && key.shift) { setMode(nextMode(cur.mode)); return; }
    // ctrl+t: the model on this Mac on or off (the footer's label says which, and how much memory it holds);
    // on a remote, the model list.
    if (key.ctrl && ch === 't') { toggleFnRef.current('ctrl+t'); return; }
    // ctrl+p: /compact now. ctrl+r: a second opinion on the last change now (2 Oct 2026, keys for big models).
    if (key.ctrl && ch === 'p') { runSlash('/compact'); return; }
    if (key.ctrl && ch === 'r') { secondOpinionNow(); return; }
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
    const pos = cursorLine(cur.input, rowsOf(cur.input)); // rows as drawn: ↑ ↓ move inside a long prompt first
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
    // ctrl+z takes back the last change to the prompt, ctrl+y puts it back
    if (key.ctrl && (ch === 'z' || ch === 'y')) {
      const back = ch === 'z';
      if (!(back ? cur.input.undo : cur.input.redo)?.length) { flash(back ? 'Nothing to undo' : 'Nothing to redo', 1500); return; }
      setInput((s) => (back ? undoEdit(s) : redoEdit(s)));
      return;
    }
    setInput((s) => withUndo(s, editInput(s, ch, key, rowsOf(s))));
  };

  // Items added some other way (a resumed conversation, /clear) or a resize:
  // measure after the frame, then draw once more with the space right.
  useEffect(() => {
    let on = true;
    queueMicrotask(() => { try { if (on && primeRows(itemsRef.current, measure.current)) bumpRows((n) => n + 1); } catch {} });
    return () => { on = false; };
  }, [items, width]);
  // What primeRows needs to measure items as they are printed.
  const start = { model: model.name, effort: thinkingLevel(model, thinking, effort).label.toLowerCase(), ctx, cwd: short(cwd), git: opts.start?.git, notes: opts.start?.notes ?? [], also: opts.start?.also ?? [], recent: recentRef.current, now: startedAt, off: modelOff, took: startTook, typical: typicalStart(timesRef.current[modelKey(model)]) };
  measure.current = { width, modelName: model.name, cwdShort: short(cwd), loaded: opts.loaded ?? '', start };
  itemsRef.current = items;
  // Held until your first message (sendPrompt lets it go). Let go for good, printed as it is, when
  // what came under it, the / menu or the shortcuts would not fit in the window beside it, or when a
  // panel, pop-up or question opens (the page and a tall panel would not fit together).
  const underRows = heldRows(items, measure.current) + (menu ? Math.min(menu.rows ?? MENU_ROWS, menu.items.length) : 0) + (showShortcuts ? shortcutRows(Boolean(model.remote)) : 0);
  if (holdRef.current && !(items[0]?.type === 'welcome' && !picker && !popup && !perm && !btw && underRows <= holdRoom(items, measure.current, rows ?? 40))) holdRef.current = false;
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
  const app = {
    agentsTree: agentsShown ? agentsState : null, agentsNow, agentsLine: agentsLiveLine,
    btw: btwShown ? btw : null, btwWaiting: Boolean(btw && !btwShown), argHint, leaving,
    items, live, perm, picker, popup, input, mode, width, rows: rows ?? 40, columns: columns ?? 100, tooSmall, redraw, cwd, cwdShort: short(cwd), loaded: opts.loaded ?? '', start, hold: holdRef.current, tip,
    modelName: model.name, modelOff, modelState, gauges, gaugeList: settings.footer?.remote, server: model.remote ? server : null, now, spinner: spinStyle((process.env.AGENTIC_SPINNER ?? process.env.BONSAI_SPINNER)), stats: { ...stats, ctxUsed: stats.ctxUsed ?? agent.ctxUsed }, ctx, ramGb, mac, meters, starting, startedAt, notice, queued, showShortcuts, placeholder,
    inputMode, menu: menu ? { ...menu, index: menuIdx } : null, waitingForYou: !!perm, thinking,
    thinkingLabel: thinkingLevel(model, thinking, effort).label.toLowerCase(), thinkingLevels: model.thinkingLevels ?? [], ...(picker?.kind === 'model' ? { pickLevels: pickLevels(picker), pickLevelId: pickLevel(picker).id } : {}), ...(picker?.kind === 'service' ? serviceProps(picker) : {}), ...(picker?.kind === 'subagents' ? { subagents: { models: catalog?.models ?? [], main: model.remote?.model ?? null, where: model.remote?.label ?? '' } } : {}), startPhase, startLeft: startLeftNow, waiting, battle, remoteSource: model.remote?.source ?? null,
    // The weights badge, lower right: edited weights saved and waiting, in
    // use, or newer ones saved than the copy loaded now.
    updateBadge: updateText(update),
    shareBadge: sharedOn ? `⇄ on ${sharedOn}` : null,
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
