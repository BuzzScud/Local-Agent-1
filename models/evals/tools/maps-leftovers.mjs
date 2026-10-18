// The maps left over before pruning existed (15 Oct 2026, ~/.agentic-coder/maps: 54,418 files, 247 MB):
// code search indexes whose folder is gone, and project maps not changed for a week (cheap to make
// again: a project in use gets its map back the next time it is mapped). Counts them; --delete deletes.
//   bun models/evals/tools/maps-leftovers.mjs [--delete]
import { readdirSync, statSync, rmSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HOME } from '../../index.mjs';

const dir = join(HOME, 'maps');
const WEEK = 7 * 86_400_000;
const now = Date.now();
const go = process.argv.includes('--delete');
const folderOf = (file) => {
  const buf = Buffer.alloc(4096);
  const fd = openSync(file, 'r');
  let n = 0;
  try { n = readSync(fd, buf, 0, buf.length, 0); } finally { closeSync(fd); }
  const m = /"cwd":("(?:[^"\\]|\\.)*")/.exec(buf.subarray(0, n).toString('utf8'));
  return m ? JSON.parse(m[1]) : null;
};
const count = { indexGone: 0, indexKept: 0, mapOld: 0, mapKept: 0, bytes: 0 };
for (const name of readdirSync(dir)) {
  if (name === '.pruned') continue;
  const file = join(dir, name);
  // A file can go while this runs (a code search index is saved through a file that is then renamed).
  let st;
  try { st = statSync(file); } catch { continue; }
  if (!st.isFile()) continue;
  let drop;
  if (name.endsWith('.code.json')) {
    let cwd = null;
    try { cwd = folderOf(file); } catch { continue; }
    drop = cwd !== null && !existsSync(cwd);
    count[drop ? 'indexGone' : 'indexKept']++;
  } else {
    drop = now - st.mtimeMs > WEEK;
    count[drop ? 'mapOld' : 'mapKept']++;
  }
  if (drop) { count.bytes += st.size; if (go) rmSync(file, { force: true }); }
}
console.log(JSON.stringify({ ...count, mb: Math.round(count.bytes / 1048576), deleted: go }));
