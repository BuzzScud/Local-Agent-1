// The system prompt: short and concrete, written for a small model.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { instructionBlock } from './instructions.mjs';
import { RULES } from './rules.mjs';
import { memoryNotes, readState } from './facts.mjs';

// The home folder and its Desktop, Documents and Downloads: places to start
// from, not projects. Agentic Coder answers from what it knows there, and goes into a
// project when one is named (src/agent/projects.mjs).
export function isHomeFolder(cwd, home = homedir()) {
  return [home, join(home, 'Desktop'), join(home, 'Documents'), join(home, 'Downloads')].includes(cwd);
}

const HOME_NOTE = `Here: the user's home folder, not a project. Answer a general question (math, how something works) from what you know, without tools. Search, Read or List files only when the user asks about their own files, code or notes, or names a file. When the user asks you to make, change or look at a file or folder ("make a file on my Desktop"), do it straight away with the tools; Desktop, Documents and Downloads are folders here.`;

// AGENTS.md (or CLAUDE.md), and private .bonsai/notes.md files (kept out of
// git), from the project folder up to the home folder; then what the memory
// holds (facts.mjs): the rules that always apply and one line per fact.
// A notes file whose lines were carried over into the memory is not read
// twice. memory: false leaves the memory out (practice runs, tests).
export function projectNotes(cwd, maxChars = 6000, { memory = true, home: homeDir } = {}) {
  const found = [];
  let dir = cwd;
  const home = homeDir ?? homedir();
  for (let i = 0; i < 8; i++) {
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
      const p = join(dir, name);
      if (existsSync(p)) {
        const text = readFileSync(p, 'utf8').trim();
        // A CLAUDE.md that only points at AGENTS.md adds nothing.
        if (text && !/^@AGENTS\.md\s*$/.test(text) && !found.some((f) => f.text === text)) found.push({ path: p, text });
        break;
      }
    }
    const newer = join(dir, '.agentic', 'notes.md');
    const own = existsSync(newer) ? newer : join(dir, '.bonsai', 'notes.md');
    if (existsSync(own) && !(memory && readState(join(dir, '.agentic', 'memory')).notes)) {
      const text = readFileSync(own, 'utf8').trim();
      if (text && !found.some((f) => f.text === text)) found.push({ path: own, text });
    }
    if (dir === home || dir === dirname(dir)) break;
    dir = dirname(dir);
  }
  let out = '';
  for (const f of found) {
    const block = `From ${f.path.replace(home, '~')}:\n${f.text}\n\n`;
    if (out.length + block.length > maxChars) { out += `(${f.path.replace(home, '~')} cut to fit)\n${f.text.slice(0, Math.max(0, maxChars - out.length - 80))}\n`; break; }
    out += block;
  }
  const files = found.map((f) => f.path);
  if (memory) {
    let m = null;
    try { m = memoryNotes(cwd, { home }); } catch { /* a memory that cannot be read is left out, the start goes on */ }
    if (m?.text) { out = `${out.trim()}${out.trim() ? '\n\n' : ''}Memory\n${m.text}`; files.push(...m.files); }
  }
  return { text: out.trim(), files };
}

export function gitSummary(cwd) {
  const r = spawnSync('git', ['status', '--porcelain', '-b'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return 'not a git repository';
  const lines = r.stdout.split('\n').filter(Boolean);
  const branch = (lines[0] ?? '').replace(/^## /, '').split('...')[0];
  const changed = lines.length - 1;
  return `branch ${branch}, ${changed ? `${changed} changed file${changed === 1 ? '' : 's'}` : 'no uncommitted changes'}`;
}

// How this project runs its tests, so the model does not invent a check.
export function testCommand(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    const t = pkg.scripts?.test;
    if (t && !/no test specified/.test(t)) return existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock')) ? 'bun run test' : 'npm test';
  } catch {}
  const r = spawnSync('/bin/sh', ['-c', 'ls *.test.* *_test.* test_*.py tests test 2>/dev/null | head -20'], { cwd, encoding: 'utf8' });
  const out = r.stdout ?? '';
  if (/\.test\.(m?js|cjs)\b/.test(out)) return 'node --test';
  if (/\.test\.tsx?\b/.test(out)) return 'bun test';
  if (/test_\w+\.py|_test\.py/.test(out) || existsSync(join(cwd, 'pytest.ini')) || existsSync(join(cwd, 'pyproject.toml'))) return 'pytest';
  if (existsSync(join(cwd, 'Cargo.toml'))) return 'cargo test';
  if (existsSync(join(cwd, 'go.mod'))) return 'go test ./...';
  return null;
}

// A worked example of the loop, for small models (on when measured to help).
const EXAMPLE = `Example of good work (the names here are made up)
User: rename getUser to fetchUser
You: Search {"pattern": "getUser"}  → 2 files use it
You: Read {"path": "<first file>"}
You: Edit {"path": "<first file>", "old_text": "getUser", "new_text": "fetchUser", "replace_all": true}
You: Edit {"path": "<second file>", "old_text": "getUser", "new_text": "fetchUser", "replace_all": true}
You: Bash {"command": "<the test command>"}  → all pass
You: Renamed getUser to fetchUser in both files; the tests pass.
`;

// Where this session's details start. Everything before it is the same in
// every project and on every day, so the server can save the model's reading
// of it to disk and restore it in a fraction of a second (models/runtime/warmup.mjs).
export const SESSION_MARK = 'This session\n';

export function systemPrompt({ cwd, notes = '', git = 'unknown', date = new Date(), tests = testCommand(cwd), example = (process.env.AGENTIC_EXAMPLE ?? process.env.BONSAI_EXAMPLE) === '1', math = '', instructions }) {
  const today = date.toISOString().slice(0, 10);
  return `You are Agentic Coder, a coding assistant in the user's terminal on their Mac. You work inside one project folder and use tools to read, search, change and test code. You can see the files only through your tools.

You are inside the project's folder. Use paths relative to it, and "." for the folder itself. Never type a full path.

${instructionBlock(instructions)}

Tool use
- Use List, Search and Read to find the code; try a shorter search if needed.
- To change an existing file, use Edit with old_text copied exactly from Read, without line numbers. Include enough context to match once. Use Write for new files.
- Call one tool at a time and wait for its result.

${example ? `${EXAMPLE}\n` : ''}${RULES.always ? `Fixing a bug\n${RULES.always}\n\n` : ''}Rules
- Stay inside the project folder. Files and commands outside it (the home folder, the Desktop, other projects) are blocked; a vague request such as "fix the bug" means this folder only.
- These commands are blocked: rm -rf, sudo, git push, git reset --hard, kill, pkill, killall.
- If the user only asks a question, answer it from the code you read; do not change files or build scratch experiments to find out.

${math ? `${math}\n\n` : ''}${SESSION_MARK}Today: ${today}. macOS, zsh. Git: ${git}.${tests ? `\nRun the tests with: ${tests}` : ''}${isHomeFolder(cwd) ? `\n${HOME_NOTE}` : ''}
${notes ? `\nProject notes\n${notes}\n` : ''}`;
}
