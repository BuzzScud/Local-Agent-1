// Agentic Coder's memory: "update memory" (or "remember that …") saves what matters
// from the conversation, without asking where, into the file Agentic Coder already
// reads at every start (projectNotes in prompt.mjs):
//   the project folder's .bonsai/notes.md — the git repo's top when inside one,
//   ~/.bonsai/notes.md when Agentic Coder runs in the home folder (read everywhere under it).
// An existing .bonsai/notes.md keeps being used; a fresh project gets .agentic/.
const keepOld = (old, fresh) => (existsSync(old) ? old : fresh);
// The file is private: inside a git repo, .bonsai/ goes into .git/info/exclude.
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

// A message that asks to save to memory. Only whole requests count, so "update
// the memory usage in cache.mjs" stays a code change.
const ASKS = [
  /^(please\s+)?(update|save|refresh)\s+(your\s+|the\s+|my\s+|(?:bonsai|agentic coder|coder)'?s?\s+)?memory\s*(now|please)?\s*[.!]*$/i,
  /^(please\s+)?(save|add|put|write)\s+(this|that|it|these|those|everything)\s+(to|in|into)\s+(your\s+|the\s+|my\s+)?memory\b/i,
  /^(please\s+)?remember\s*(:|\s(this|that|these|to)\b)/i,
  /^(please\s+)?(update|save)\s+(your\s+|the\s+)?memory\s*(with|:)\s*\S/i,
];
export const isMemoryRequest = (text) => ASKS.some((re) => re.test(String(text).trim()));

// Where the memory lives for a folder.
export function memoryFile(cwd, home = homedir()) {
  const at = resolve(cwd);
  if (at === resolve(home)) return keepOld(join(home, '.bonsai', 'notes.md'), join(home, '.agentic', 'notes.md'));
  let dir = at;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, '.git'))) return keepOld(join(dir, '.bonsai', 'notes.md'), join(dir, '.agentic', 'notes.md'));
    const up = dirname(dir);
    if (up === dir || dir === resolve(home)) break;
    dir = up;
  }
  return keepOld(join(at, '.bonsai', 'notes.md'), join(at, '.agentic', 'notes.md'));
}

const HEADER = '# Agentic Coder memory\nKept by Agentic Coder for this folder and read at every start. Say "update memory" to add to it; edit or delete lines freely.\n';
const norm = (s) => s.toLowerCase().replace(/^[-*•]\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim();

// The saved facts, one per line (the "- " bullets of the file).
export function readMemory(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => /^\s*[-*•]\s+\S/.test(l)).map((l) => l.replace(/^\s*[-*•]\s+/, '').trim());
}

// Apply the model's answer: drop lines it names (exact, after tidying), add
// the new ones that are not already there. Answers what changed.
export function applyMemory(file, { add = [], drop = [] } = {}) {
  const before = readMemory(file);
  const dropSet = new Set(drop.map(norm).filter(Boolean));
  const kept = before.filter((l) => !dropSet.has(norm(l)));
  const dropped = before.filter((l) => dropSet.has(norm(l)));
  const have = new Set(kept.map(norm));
  const added = [];
  for (const raw of add) {
    const line = String(raw).replace(/\s+/g, ' ').replace(/^[-*•]\s*/, '').trim().slice(0, 300);
    if (line.length < 3 || have.has(norm(line))) continue;
    have.add(norm(line)); added.push(line);
  }
  if (!added.length && !dropped.length) return { file, added, dropped, lines: kept.length, chars: existsSync(file) ? readFileSync(file, 'utf8').length : 0 };
  // Anything in the file that is not a fact (the user's own headings or text) stays where it was.
  const old = existsSync(file) ? readFileSync(file, 'utf8') : HEADER;
  const other = old.split('\n').filter((l) => !/^\s*[-*•]\s+\S/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  const body = `${other || HEADER.trimEnd()}\n\n${[...kept, ...added].map((l) => `- ${l}`).join('\n')}\n`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  keepOutOfGit(file);
  return { file, added, dropped, lines: kept.length + added.length, chars: body.length };
}

// Inside a git repo the memory stays private: .bonsai/ in .git/info/exclude
// (this checkout only; no tracked file changes).
function keepOutOfGit(file) {
  const root = dirname(dirname(file));
  const git = join(root, '.git');
  if (!existsSync(git)) return;
  try {
    const ex = join(git, 'info', 'exclude');
    const cur = existsSync(ex) ? readFileSync(ex, 'utf8') : '';
    if (/^\/?\.agentic\/?\s*$/m.test(cur)) return;
    mkdirSync(dirname(ex), { recursive: true });
    appendFileSync(ex, `${cur && !cur.endsWith('\n') ? '\n' : ''}# Agentic Coder's private memory\n.bonsai/\n.agentic/\n`);
  } catch {}
}

// The conversation, short: what the user and Agentic Coder said (no tool output).
export function digest(messages, maxChars = 9000) {
  const lines = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c) => c.text ?? '').join(' ') : '';
    // Without the facts that were brought back for the request (recall.mjs).
    const t = text.replace(/\n\n\(From your memory,[\s\S]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
    if (!t || t.startsWith('[')) continue;
    lines.push(`${m.role === 'user' ? 'User' : 'Agentic Coder'}: ${t.slice(0, 700)}`);
  }
  let out = '';
  for (let i = lines.length - 1; i >= 0; i--) { if (out.length + lines[i].length > maxChars) break; out = `${lines[i]}\n${out}`; }
  return out.trim();
}

export const MEMORY_SCHEMA = {
  type: 'object',
  properties: {
    add: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    drop: { type: 'array', items: { type: 'string' }, maxItems: 8 },
  },
  required: ['add', 'drop'],
};

export function memoryPrompt({ request, saved, conversation, today }) {
  return {
    system: 'You keep Agentic Coder\'s memory for this folder: short facts that will help in future conversations here. Keep: how the user likes to work, their preferences, decisions made, where things are, commands that work, things to avoid. Leave out: finished task details, code, secrets or passwords, anything only true today. One fact per line, plain words, at most 25 words, dates written out (today is ' + today + '). If the user says what to remember, save exactly that. Put a saved line in drop only when the conversation shows it is wrong or replaced by a new line. Answer as JSON: {"add": [...], "drop": [...]}.',
    user: `Saved already:\n${saved.length ? saved.map((l) => `- ${l}`).join('\n') : '(nothing yet)'}\n\nThe conversation:\n${conversation || '(nothing before this)'}\n\nThe user now says: ${request}`,
  };
}
