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
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { factsInFull } from './facts.mjs';
import { isHomeFolder } from './prompt.mjs';

export const OPENING_MEMORY_CHARS = 8000; // ~2,200 tokens of facts at most
export const OPENING_CHANGED = 20; // changed files listed
export const OPENING_COMMITS = 15;
export const OPENING_TOP = 40; // entries of the folder's top
const COMMIT_CHARS = 110; // a commit's line, cut (this repo's subjects run to paragraphs)
const SKIP = new Set(['.git', '.DS_Store', '.agentic', '.bonsai']);

export const openingOn = () => !['off', '0', 'false'].includes(String(process.env.AGENTIC_OPENING ?? 'on').toLowerCase());

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

// The step: { args (the command it stands for, for the screen), body (what the model gets), view (the screen's) }.
// memory: the agent's memory ({ home }) or null (a practice run: no memory, the rest still comes).
export function openingRead(cwd, { memory = null, home = homedir() } = {}) {
  const parts = [];
  const lines = []; // the screen's summary
  const commands = [];
  if (memory) {
    let m = { text: '', you: 0, project: 0, left: 0 };
    try { m = factsInFull(cwd, { home: memory.home ?? home, maxChars: OPENING_MEMORY_CHARS }); } catch { /* a memory that cannot be read is left out */ }
    commands.push('cat ~/.agentic/memory/facts/*.md .agentic/memory/facts/*.md');
    parts.push(m.text ? `Memory (every fact in use, in full; a fact can be out of date, so check a file or name it gives before you rely on it)\n${m.text}${m.left ? `\n(${m.left} more not shown, to keep this short.)` : ''}` : 'Memory: nothing saved yet.');
    lines.push(`${m.you} ${m.you === 1 ? 'fact' : 'facts'} about you · ${m.project} about this project${m.left ? ` · ${m.left} left out` : ''}`);
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
  // Nothing to say (no memory, not a git repository, an empty folder): no step.
  if (!parts.length) return null;
  const command = commands.join('; ');
  const body = `Agentic Coder read these for you before your first step; nothing has changed since, so do not read them again.\n\n${parts.join('\n\n')}`;
  return {
    args: { command, description: memory ? 'Reading all memory files' : 'Reading where the project stands' },
    body,
    view: { kind: 'opening', title: memory ? 'Reading all memory files' : 'Reading where the project stands', command, lines, content: body },
  };
}
