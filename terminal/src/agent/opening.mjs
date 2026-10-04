// The opening read (3 Oct 2026, the owner's ask "make them read memory like this too", with a picture of
// Claude Code's "Reading all memory files" step): before the first step of a conversation, a model on
// another machine (the remote set) gets the memory whole and where the project stands, read by the app
// in one go. It goes in as a step the model did not have to take (agent.mjs giveOpening), so it costs
// no round trip to the service: the model starts from it instead of finding it a step at a time.
//   the memory     every fact in use, about the user and this project, in full (facts.mjs factsInFull);
//                  the prompt has only their short lines
//   git            the branch and the changed files (git status), the last commits (git log)
//   the folder     what is at its top
// Not in the home folder (it is not a project: only the memory there), not for a helper (its task is
// part of the parent's). AGENTIC_OPENING=off leaves it out.
// Whose machine it is decides the memory (3 Oct 2026): facts about the user go in full only to the
// owner's own other computer (model.remote.mine: coding serve at a private address or over SSH); any
// other service gets the project's facts in full and none about the user (the prompt's short lines are
// as before). settings.json "memoryToRemote" (/remote's Memory sent row): mine (the default) · all · none.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { factsInFull } from './facts.mjs';
import { isHomeFolder } from './prompt.mjs';
import { readLadder, fitLines, nearestPart, openPart, mapRoom } from './ladder.mjs';
import { HOME } from '../../../models/index.mjs';

const OPENING_MEMORY_CHARS = 8000; // ~2,200 tokens of facts at most
const OPENING_CHANGED = 20; // changed files listed
export const OPENING_COMMITS = 15;
const OPENING_TOP = 40; // entries of the folder's top
const COMMIT_CHARS = 110; // a commit's line, cut (this repo's subjects run to paragraphs)
const SKIP = new Set(['.git', '.DS_Store', '.agentic']);

export const openingOn = () => !['off', '0', 'false'].includes(String(process.env.AGENTIC_OPENING ?? 'on').toLowerCase());

export const MEMORY_TO = ['mine', 'all', 'none'];
export function memoryToRemote(home = HOME) {
  try { const v = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).memoryToRemote; return MEMORY_TO.includes(v) ? v : 'mine'; } catch { return 'mine'; }
}
// What of the memory goes to this model: 'all' (about the user and the project), 'project' or 'none'.
export function memorySent(model, setting = memoryToRemote()) {
  if (setting === 'none') return 'none';
  return setting === 'all' || model?.remote?.mine ? 'all' : 'project';
}

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 });
  return r.status === 0 ? r.stdout.replace(/\s+$/, '') : null;
};

// What is at the top of the folder: folders first (with a /), then files, dot files left out but .github.
function topOf(cwd) {
  let names = [];
  try { names = readdirSync(cwd); } catch { return { text: '', count: 0 }; }
  const entries = names.filter((n) => !SKIP.has(n) && (!n.startsWith('.') || n === '.github')).map((n) => {
    let dir = false;
    try { dir = statSync(join(cwd, n)).isDirectory(); } catch {}
    return { n, dir };
  }).sort((a, b) => Number(b.dir) - Number(a.dir) || a.n.localeCompare(b.n));
  const shown = entries.slice(0, OPENING_TOP).map((e) => (e.dir ? `${e.n}/` : e.n));
  return { text: `${shown.join('  ')}${entries.length > shown.length ? `  … and ${entries.length - shown.length} more` : ''}`, count: entries.length };
}

// The maps (3 Oct 2026, ladder.mjs): the project's code map (docs/map/MAP.md, tools/codemap.mjs) and the
// map of Claude's notes (claude-pack.mjs), as much of each as the model's context has room for
// (mapRoom: 32k the map lines, 128k and up the code map's part nearest the request too). The same for
// every model: a model of the remote set gets them in its opening read, one of the local set as a step
// of their own (agent.mjs giveMaps). notes: the pack as this model may see it (packView: Memory sent).
// → { parts, lines, commands } or null when there is neither.
const MAP_PATH = 'docs/map';
export function mapsRead(cwd, { ctx = 32768, request = '', notes = null, home = homedir() } = {}) {
  const room = mapRoom(ctx);
  const parts = [];
  const lines = [];
  const commands = [];
  const body = (t) => String(t).replace(/^# .*\n+/, '');
  if (!isHomeFolder(cwd, home)) {
    const code = readLadder(join(cwd, MAP_PATH));
    if (code) {
      parts.push(`The code map (${MAP_PATH}/MAP.md: a line per top folder; open a part with Map {"part": "<name>"} or Read ${MAP_PATH}/<name>.md, then the file)\n${fitLines(body(code.text), room.chars)}`);
      commands.push(`cat ${MAP_PATH}/MAP.md`);
      lines.push(`code map: ${code.parts.length} top ${code.parts.length === 1 ? 'folder' : 'folders'}`);
      const near = room.part ? nearestPart(code, request) : null;
      const p = near ? openPart(code.dir, near.part.file) : null;
      if (p) {
        parts.push(`The part of the code map nearest the request (${MAP_PATH}/${p.file})\n${fitLines(body(p.text), room.part)}`);
        commands.push(`cat ${MAP_PATH}/${p.file}`);
        lines.push(`and its part ${p.file}`);
      }
    }
  }
  const map = notes?.map?.() ?? null;
  if (map) {
    const topics = (map.match(/^- /gm) ?? []).length;
    parts.push(`The map of Claude's notes (NOTES/MAP.md${notes.sent === 'project' ? ": only the topics about this project; Claude's notes about the user stay on their Mac" : ''})\n${fitLines(body(map), room.chars)}`);
    commands.push('cat NOTES/MAP.md');
    lines.push(`Claude's notes: ${topics} ${topics === 1 ? 'topic' : 'topics'}${notes.sent === 'project' ? ' about this project' : ''}`);
  }
  return parts.length ? { parts, lines, commands } : null;
}

// The step: { args (the command it stands for, for the screen), body (what the model gets), view (the screen's) }.
// memory: the agent's memory ({ home }) or null (a practice run, or memoryToRemote none: no memory, the
// rest still comes). you: false sends only the project's facts (memorySent 'project'). maps: mapsRead's,
// put after the rest.
export function openingRead(cwd, { memory = null, home = homedir(), you = true, maps = null } = {}) {
  const parts = [];
  const lines = []; // the screen's summary
  const commands = [];
  let title = memory ? 'Reading all memory files' : 'Reading where the project stands';
  if (memory) {
    let m = { text: '', you: 0, project: 0, left: 0 };
    try { m = factsInFull(cwd, { home: memory.home ?? home, maxChars: OPENING_MEMORY_CHARS, you }); } catch { /* a memory that cannot be read is left out */ }
    commands.push(you ? 'cat ~/.agentic/memory/facts/*.md .agentic/memory/facts/*.md' : 'cat .agentic/memory/facts/*.md');
    if (you) {
      parts.push(m.text ? `Memory (every fact in use, in full; a fact can be out of date, so check a file or name it gives before you rely on it)\n${m.text}${m.left ? `\n(${m.left} more not shown, to keep this short.)` : ''}` : 'Memory: nothing saved yet.');
      lines.push(`${m.you} ${m.you === 1 ? 'fact' : 'facts'} about you · ${m.project} about this project${m.left ? ` · ${m.left} left out` : ''}`);
    } else {
      parts.push(m.text ? `Memory about this project (every fact in use, in full; the facts about the user stay on their Mac; a fact can be out of date, so check a file or name it gives before you rely on it)\n${m.text}${m.left ? `\n(${m.left} more not shown, to keep this short.)` : ''}` : 'Memory about this project: nothing saved yet.');
      lines.push(`${m.project} ${m.project === 1 ? 'fact' : 'facts'} about this project · ${m.you} about you stay on this Mac${m.left ? ` · ${m.left} left out` : ''}`);
      title = `Reading the project's memory${m.you ? ` · ${m.you} ${m.you === 1 ? 'fact' : 'facts'} about you stay on this Mac` : ''}`;
    }
  }
  if (!isHomeFolder(cwd, home)) {
    const status = git(cwd, ['status', '--short', '--branch']);
    // Not a git repository: nothing said (a line saying so sent Qwen to try git anyway).
    if (status != null) {
      commands.push(`git status --short --branch | head -${OPENING_CHANGED}`, `git log --oneline -${OPENING_COMMITS}`);
      const [head = '', ...changed] = status.split('\n');
      const branch = head.replace(/^## /, '').split('...')[0];
      const shown = changed.slice(0, OPENING_CHANGED);
      const log = (git(cwd, ['log', '--oneline', '--no-decorate', `-${OPENING_COMMITS}`]) ?? '').split('\n').filter(Boolean)
        .map((l) => (l.length > COMMIT_CHARS ? `${l.slice(0, COMMIT_CHARS - 1).trimEnd()}…` : l));
      parts.push(`Git: branch ${branch}, ${changed.length ? `${changed.length} changed ${changed.length === 1 ? 'file' : 'files'} (not committed)` : 'nothing changed since the last commit'}${shown.length ? `\n${shown.join('\n')}${changed.length > shown.length ? `\n… and ${changed.length - shown.length} more` : ''}` : ''}${log.length ? `\n\nThe last ${log.length === 1 ? 'commit' : `${log.length} commits`}:\n${log.join('\n')}` : '\n\nNo commits yet.'}`);
      lines.push(`git: ${branch}, ${changed.length ? `${changed.length} changed` : 'clean'} · last ${log.length} ${log.length === 1 ? 'commit' : 'commits'}`);
    }
    const top = topOf(cwd);
    if (top.count) {
      commands.push('ls');
      parts.push(`At the top of the folder:\n${top.text}`);
      lines.push(`${top.count} ${top.count === 1 ? 'entry' : 'entries'} at the top of the folder`);
    }
  }
  if (maps) { parts.push(...maps.parts); lines.push(...maps.lines); commands.push(...maps.commands); }
  // Nothing to say (no memory, not a git repository, an empty folder): no step.
  if (!parts.length) return null;
  const command = commands.join('; ');
  const body = `Agentic Coder read these for you before your first step; nothing has changed since, so do not read them again.\n\n${parts.join('\n\n')}`;
  return {
    args: { command, description: title },
    body,
    view: { kind: 'opening', title, command, lines, content: body },
  };
}
