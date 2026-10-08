// Every test prompt this Mac knows: the Arena's tests (the three sets of 28
// and yours), the practice tasks, and the design runs' page and component
// requests. The memory uses it to tell a test pasted into the app from real
// work (terminal: practiceWork in lessons.mjs): a test teaches nothing about
// you (29 Sep 2026: 2 of the first 3 saves came from test prompts).
// Read again at most once a minute; a folder that is not there is skipped.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME } from '../registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRESH_MS = 60_000;
let kept = null;

const text = (file) => { try { return readFileSync(file, 'utf8').trim(); } catch { return ''; } };
const json = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
// task.txt in each folder of a set (a test, a practice task).
const tasksIn = (dir) => {
  if (!existsSync(dir)) return [];
  try { return readdirSync(dir).map((id) => text(join(dir, id, 'task.txt'))); } catch { return []; }
};

// home: Agentic Coder's own folder (AGENTIC_HOME moves it, as for the Arena).
export function testPrompts({ home = HOME, now = Date.now() } = {}) {
  if (kept && kept.home === home && now - kept.at < FRESH_MS) return kept.list;
  const list = [
    ...tasksIn(join(home, 'battle', 'tests')),
    ...tasksIn(join(HERE, 'battle', 'new28')),
    ...tasksIn(join(HERE, 'battle', 'work28')),
    ...tasksIn(join(HERE, 'bench', 'tasks')),
    ...[join(HERE, 'bench', 'design', 'pages.json'), join(HERE, 'bench', 'design', 'components.json'), join(HERE, 'bench', 'design', 'library.json')].flatMap((f) => (json(f) ?? []).map((p) => String(p?.prompt ?? ''))),
  ].filter((p) => p.length >= 40);
  kept = { home, at: now, list: [...new Set(list)] };
  return kept.list;
}
