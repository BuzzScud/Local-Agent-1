// What asks for the memory, and where a folder's memory lives. "update memory"
// (or "remember that …") saves into the memory's facts (facts.mjs, lessons.mjs).
// Before the facts there was one notes file per folder, .agentic/notes.md,
// written by "update memory"; its lines were carried into
// the facts at the first start (openMemory). A file that is still there is no
// longer read as rules (30 Sep 2026: only AGENTS.md and CLAUDE.md are, in
// projectNotes in prompt.mjs), and nothing writes it any more: with the memory
// off, nothing is saved. memoryFile still names it: the memory's folders sit beside it.
import { existsSync } from 'node:fs';
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
  if (at === resolve(home)) return join(home, '.agentic', 'notes.md');
  let dir = at;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, '.git'))) return join(dir, '.agentic', 'notes.md');
    const up = dirname(dir);
    if (up === dir || dir === resolve(home)) break;
    dir = up;
  }
  return join(at, '.agentic', 'notes.md');
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
