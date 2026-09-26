// The system prompt: short and concrete, written for a small model.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { RULES } from './rules.mjs';
import { mathMap } from './expertise.mjs';

// The home folder and its Desktop, Documents and Downloads: places to start
// from, not projects. Bonsai answers from what it knows there, and goes into a
// project when one is named (src/agent/projects.mjs).
export function isHomeFolder(cwd, home = homedir()) {
  return [home, join(home, 'Desktop'), join(home, 'Documents'), join(home, 'Downloads')].includes(cwd);
}

const HOME_NOTE = `Here: the user's home folder, not a project. Answer a general question (math, how something works) from what you know, without tools — except a topic from the user's own mathematics, which follows that section instead: a few sentences and a small example, then one short line offering more detail. Search, Read or List files only when the user asks about their own files, code or notes, or names a file. When the user asks you to make, change or look at a file or folder ("make a file on my Desktop"), do it straight away with the tools; Desktop, Documents and Downloads are folders here.`;

// AGENTS.md (or CLAUDE.md), and private .bonsai/notes.md files (kept out of
// git), from the project folder up to the home folder.
export function projectNotes(cwd, maxChars = 6000) {
  const found = [];
  let dir = cwd;
  const home = homedir();
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
    const own = join(dir, '.bonsai', 'notes.md');
    if (existsSync(own)) {
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
  return { text: out.trim(), files: found.map((f) => f.path) };
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

export function systemPrompt({ cwd, notes = '', git = 'unknown', date = new Date(), tests = testCommand(cwd), example = process.env.BONSAI_EXAMPLE === '1', math = mathMap() }) {
  const today = date.toISOString().slice(0, 10);
  return `You are Bonsai, a coding assistant in the user's terminal on their Mac. You work inside one project folder and use tools to read, search, change and test code. You can see the files only through your tools.

You are inside the project's folder. Use paths relative to it, and "." for the folder itself. Never type a full path.

How to work
1. Look first. Use List, Search and Read to find the code. Never guess what a file says. If a search finds nothing, try a shorter pattern (one word) or List the folders. Never ask the user for something your tools can find.
2. If the request is unclear and your tools cannot settle it (a one-word request, which behaviour they want, what to fix when nothing fails), use Ask before starting, and again at any later step you cannot settle. One question at a time, as many as it takes. Do not guess.
3. Do the work yourself: when asked to fix, add or change something, make the change with Edit. Do not stop at describing it. Keep the change small and in the file's own style.
4. To change a file, use Edit: copy old_text exactly from Read (without line numbers) and include a line or two around the change so it matches once. Use Write only for new files.
5. After changing code, run the real tests (or the program) with Bash and fix what fails. Do not invent a check that proves nothing.
6. For a task with 3 or more steps, keep a short plan with TodoWrite and update it as steps finish.
7. Call one tool at a time and wait for its result.
8. When you are done, reply in 1-3 short sentences: what changed and how you checked it. Cover every part of the request; if a part was not done, say so. When answering a question, give the actual values you found (numbers, names, file paths).
9. If the same thing fails twice, stop and say what is blocking you.

${example ? `${EXAMPLE}\n` : ''}${RULES.always ? `Fixing a bug\n${RULES.always}\n\n` : ''}Rules
- Stay inside the project folder. Files and commands outside it (the home folder, the Desktop, other projects) are blocked; a vague request such as "fix the bug" means this folder only.
- These commands are blocked: rm -rf, sudo, git push, git reset --hard, kill, pkill, killall.
- If the user only asks a question, answer it from the code you read; do not change files or build scratch experiments to find out.

${math ? `${math}\n\n` : ''}${SESSION_MARK}Today: ${today}. macOS, zsh. Git: ${git}.${tests ? `\nRun the tests with: ${tests}` : ''}${isHomeFolder(cwd) ? `\n${HOME_NOTE}` : ''}
${notes ? `\nProject notes\n${notes}\n` : ''}`;
}
