// /permissions: what runs without asking, what never runs, which files always
// ask, and the mode Agentic Coder starts in. This file is the command's words
// and panels; the rules themselves are judged in agent/permissions.mjs and
// kept by perm-store.mjs. Every function answers plain data for App.jsx:
//   { text, tone }        a line to print
//   { panel }             { title, pad, rows } as /helpers prints them
//   { open: 'panel' | 'mode' }   the picker to open
//   { mode }              switch to this mode now (the start-up mode was saved)
import { homedir } from 'node:os';
import { BLOCKED, PROTECTED, checkRule, judge, coverage, runsGitCommit, runsGitPush, ruleFor, modeOf } from '../agent/permissions.mjs';
import { MAX_RULES, entries, addRule, removeRule, promoteRule, setStartMode, startModeFor, readState, permissionsFile } from './perm-store.mjs';
import { trustedFolders, forgetTrust, realFolder } from './trust.mjs';

const tilde = (p) => (String(p).startsWith(homedir()) ? `~${String(p).slice(homedir().length)}` : p);
const MODE_WORDS = { auto: 'auto', ask: 'manual', edits: 'accept edits', plan: 'plan', bypass: 'bypass permissions' };
export const modeWord = (m) => MODE_WORDS[m] ?? 'manual';
const KIND_WORDS = { allow: 'allow', runs: 'allow', never: 'never', protect: 'protect', protected: 'protect' };
const HEAD = { allow: 'Runs without asking', never: 'Never runs', protect: 'Protected files' };
const FIXED = [...new Set(BLOCKED.map((b) => b.why))];

// Where a saved rule applies, in words.
const place = (e, cwd) => (e.where === 'everywhere' ? 'every folder' : e.here ? 'this folder' : `${tilde(e.key)} (above)`);

// The values the /permissions picker shows beside each row.
export function summary(cwd, { session } = {}) {
  const s = readState();
  const n = (kind) => entries(cwd, kind, s).length;
  const start = startModeFor(cwd, s);
  const now = session?.size ?? 0;
  return {
    mode: start ? `${modeWord(start.mode)} · ${start.where === 'everywhere' ? 'every folder' : 'this folder'}` : 'manual · not saved',
    allow: `${n('allow')} saved${now ? ` · ${now} this session` : ''}`,
    never: `${FIXED.length} fixed · ${n('never')} yours`,
    protect: `${PROTECTED.length} built in · ${n('protect')} yours`,
    folders: `${trustedFolders().length} trusted`,
  };
}

// The row shown in /settings.
export function settingsValue(cwd) {
  const s = readState();
  const saved = ['allow', 'never', 'protect'].reduce((t, k) => t + entries(cwd, k, s).length, 0);
  const start = startModeFor(cwd, s);
  return `${saved} saved · ${start ? modeWord(start.mode) : 'manual'}`;
}

function listRows(kind, cwd) {
  const list = entries(cwd, kind);
  const w = Math.max(0, ...list.map((e) => e.text.length));
  return list.map((e, i) => [`${i + 1}`, `${e.text.padEnd(w)}  ${place(e, cwd)}`]);
}

// One section of the picker as a panel: numbered, with how to change it.
export function section(what, cwd, { session } = {}) {
  const kind = KIND_WORDS[what];
  const state = readState();
  const broken = state.broken ? [[`${tilde(permissionsFile())} cannot be read (${state.broken}), so none of your saved rules apply until it is fixed.`]] : [];
  if (kind === 'allow') {
    const list = listRows('allow', cwd);
    const now = [...(session ?? [])];
    return { title: `${HEAD.allow} · ${list.length} saved · ${now.length} this session`, pad: 4, rows: [
      ...broken,
      ...(list.length ? list : [['', 'none saved yet: /permissions allow <command>, or pick "always allow" when it asks']]),
      ...(now.length ? [['now', `${now.join(' · ')}  (this session only, gone when you quit)`]] : []),
      ['Also runs without asking: commands that only read (ls, cat, grep, git status …). A commit always asks.'],
      ['A rule covers its command with options added ("npm test --watch"); end it with * for anything after it ("git add *").'],
      ['In a chain (a && b, a; b, a | b) every part has to be covered.'],
      ['/permissions allow <command> · /permissions remove allow <n> · /permissions everywhere allow <n> · /permissions test <command>'],
    ] };
  }
  if (kind === 'never') {
    const list = listRows('never', cwd);
    return { title: `${HEAD.never} · ${FIXED.length} fixed · ${list.length} yours`, pad: 4, rows: [
      ...broken,
      ['Fixed, in every mode; no rule can lift them:'],
      ...FIXED.map((why) => ['', why]),
      ['', 'a git commit always asks first'],
      ['', 'a git push always asks first'],
      ['Yours, in every mode too (also `coding -p --yes`):'],
      ...(list.length ? list : [['', 'none yet: /permissions never <command>']]),
      ['/permissions never <command> · /permissions remove never <n> · /permissions everywhere never <n>'],
    ] };
  }
  if (kind === 'protect') {
    const list = listRows('protect', cwd);
    return { title: `${HEAD.protect} · ${PROTECTED.length} built in · ${list.length} yours`, pad: 4, rows: [
      ...broken,
      ['They always ask before a change, even in Accept edits and Auto, with no "allow all edits"; so does a command that names one (cp x .env), whatever rule you saved. Reading them is unchanged.'],
      [`Built in: ${PROTECTED.join('  ')}`],
      ...(list.length ? list : [['', 'none of yours yet: /permissions protect config/prod.*']]),
      ['/permissions protect <file> · /permissions remove protect <n> · /permissions everywhere protect <n>'],
    ] };
  }
  if (what === 'folders') {
    const list = trustedFolders();
    const at = realFolder(cwd);
    return { title: `Trusted folders · ${list.length}`, pad: 4, rows: [
      ['The safety check\'s yes. A yes covers a folder and everything inside it.'],
      ...list.map((f, i) => [`${i + 1}`, `${tilde(f.path)}${at === realFolder(f.path) || at.startsWith(`${realFolder(f.path)}/`) ? '   ← you are in it' : ''}`]),
      ['/permissions forget <n>: the safety check asks again the next time Agentic Coder starts there.'],
    ] };
  }
  return null; // the start-up mode is a picker (/permissions mode), not a list
}

const part = (c) => c.by === 'reads' ? 'only reads' : c.by === 'cd' ? 'stays in the folder' : c.by === 'saved' ? `runs · your saved rule "${c.rule}"` : c.by === 'session' ? `runs · "${c.rule}" for this session` : c.protectedBy ? `asks · names a protected file (${c.protectedBy})` : runsGitCommit(c.part) ? 'asks · a commit always asks' : runsGitPush(c.part) ? 'asks · a push always asks' : 'asks · no rule covers it';

// /permissions test <command> · test edit <path>: the real check, and why.
function tryIt(cwd, text, { mode, session }) {
  const rules = (() => { const r = { allow: [], never: [], protect: [] }; for (const k of Object.keys(r)) r[k] = [...new Set(entries(cwd, k).map((e) => e.text))]; return r; })();
  const edit = /^edit\s+(.+)$/i.exec(text);
  let verdict;
  let shown;
  if (edit) {
    const path = edit[1].trim().replace(/^\.\//, '');
    const inside = !/^[/~]|(^|\/)\.\.(\/|$)/.test(path);
    shown = `edit ${path}`;
    verdict = judge('Write', { path }, { mode, inside, rel: path, rules });
  } else {
    shown = text;
    verdict = judge('Bash', { command: text }, { mode, cwd, rules, allowedPrefixes: session });
  }
  const word = verdict.decision === 'allow' ? 'RUNS' : verdict.decision === 'ask' ? 'ASKS' : 'REFUSED';
  const rows = [['', shown], [word, verdict.why ?? verdict.reason]];
  if (!edit && verdict.decision !== 'deny') {
    const c = coverage(text, { saved: rules.allow, session, protect: rules.protect });
    if (c.parts.length > 1) c.parts.forEach((p, i) => rows.push([`part ${i + 1}`, `${p.part}   ${part(p)}`]));
  }
  rows.push([`in ${modeWord(mode)} mode, this folder's rules and this session's. Nothing was run.`]);
  return { panel: { title: 'Try a command', pad: 8, rows } };
}

const saved = { allow: (r, w) => `Saved for ${w}: "${r}" runs without asking${r.endsWith('*') ? '' : ', with any options'}.`, never: (r, w) => `Saved for ${w}: "${r}" never runs, in any mode.`, protect: (r, w) => `Saved for ${w}: "${r}" always asks before a change, even in Accept edits and Auto.` };

// "/permissions <what> <rest>" → the answer for App.jsx.
export function changePermissions(cwd, arg, { mode, session } = {}) {
  // The text after the first word is kept as typed (a new line in a command to try is a new command).
  const [, word = '', tail = ''] = /^\s*(\S*)\s*([\s\S]*)$/.exec(String(arg ?? ''));
  const what = word.toLowerCase();
  const text = tail.trim();
  const rest = text ? text.split(/\s+/) : [];
  const warn = (t) => ({ text: t, tone: 'warn' });
  if (!what) return { open: 'panel' };
  if (KIND_WORDS[what] || what === 'folders') {
    const kind = KIND_WORDS[what];
    if (!text || !kind) return { panel: section(what, cwd, { session }) };
    const c = checkRule(kind, text, { protect: entries(cwd, 'protect').map((e) => e.text) });
    if (c.error) return warn(c.error);
    const r = addRule(cwd, kind, c.rule);
    if (r.error) return warn(r.error);
    if (r.duplicate) return { text: `Already saved for ${r.where === 'everywhere' ? 'every folder' : 'this folder'}: "${c.rule}".` };
    return { text: `${saved[kind](c.rule, 'this folder')}${c.note ? ` ${c.note}` : ''}`, tone: 'dim', changed: true };
  }
  if (what === 'remove' || what === 'everywhere') {
    const [k = '', n = ''] = rest;
    const kind = KIND_WORDS[k.toLowerCase()];
    const i = Number(n);
    if (!kind || !Number.isInteger(i) || i < 1) return warn(`Say which list and which number: /permissions ${what} allow 2 (the lists are allow, never and protect).`);
    if (what === 'remove') {
      const r = removeRule(cwd, kind, i);
      if (r.error) return warn(r.error);
      if (r.missing) return warn(`There is no ${kind} rule ${i}: /permissions ${kind} shows them.`);
      return { text: `Removed "${r.removed}" (${r.where === 'everywhere' ? 'every folder' : 'this folder'}).`, changed: true };
    }
    const r = promoteRule(cwd, kind, i);
    if (r.error) return warn(r.error);
    if (r.missing) return warn(`There is no ${kind} rule ${i}: /permissions ${kind} shows them.`);
    if (r.already) return { text: `"${r.text}" already applies to every folder.` };
    return { text: `"${r.promoted}" now applies to every folder, not only this one.`, changed: true };
  }
  if (what === 'mode') {
    const [m = '', ...more] = rest;
    const id = m.toLowerCase() === 'reset' ? 'reset' : modeOf(m) ?? m.toLowerCase();
    if (!id) return { open: 'mode' };
    const where = more.join(' ').toLowerCase().includes('every') ? 'everywhere' : 'folder';
    if (id === 'reset') {
      const r = setStartMode(cwd, null, { where });
      return r.error ? warn(r.error) : { text: `The saved start-up mode for ${where === 'everywhere' ? 'every folder' : 'this folder'} is gone: it starts in manual unless another one is saved.`, changed: true };
    }
    if (!MODE_WORDS[id]) return warn('The modes are auto, manual, edits, plan and bypass: /permissions mode edits (add "everywhere" for every folder, or use "reset").');
    const r = setStartMode(cwd, id, { where });
    if (r.error) return warn(r.error);
    const extra = id === 'edits' ? ' Accept edits still asks before commands, and protected files still ask.' : id === 'plan' ? ' It starts read-only.' : id === 'auto' ? ' The model checks what no rule covers; commits and protected files still ask.' : id === 'bypass' ? ' Nothing asks; blocked commands, the project fence and your never-list still hold.' : '';
    return { text: `Start-up mode: ${modeWord(id)} for ${where === 'everywhere' ? 'every folder' : 'this folder'}, and on now.${extra}`, mode: id, changed: true };
  }
  if (what === 'forget') {
    const list = trustedFolders();
    const i = Number(text);
    if (!Number.isInteger(i) || i < 1 || i > list.length) return warn(`Say which folder: /permissions forget 2 (/permissions folders numbers them).`);
    const f = list[i - 1];
    if (!forgetTrust(f.path)) return warn(`${tilde(f.path)} is not in the trusted list any more.`);
    const inIt = realFolder(cwd) === realFolder(f.path) || realFolder(cwd).startsWith(`${realFolder(f.path)}/`);
    return { text: `Forgot ${tilde(f.path)}: the safety check asks again the next time Agentic Coder starts there.${inIt ? ' This window keeps working until you leave it.' : ''}`, changed: true };
  }
  if (what === 'test') {
    if (!text) return warn('Say what to try: /permissions test npm test && git commit -m x · /permissions test edit .env');
    return tryIt(cwd, text, { mode, session });
  }
  return warn(`Unknown: /permissions ${word}. Try allow, never, protect, remove, everywhere, mode, forget, folders or test.`);
}

export { ruleFor, MAX_RULES };
