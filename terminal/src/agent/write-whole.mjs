// A file written whole or not at all (18 Nov 2026, the audit): written to a file beside it and renamed over it, so
// a full disk or a crash mid-write leaves the old file, never half of the new one. A link is followed: the file it
// points to is the one replaced, and the link stays. The file's permissions are kept.
import { writeFileSync, renameSync, rmSync, statSync, realpathSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

export function writeWhole(abs, text) {
  let target = abs;
  try { if (existsSync(abs)) target = realpathSync(abs); } catch {}
  let mode;
  try { mode = statSync(target).mode & 0o7777; } catch {}
  const tmp = join(dirname(target), `.${basename(target)}.agentic-${process.pid}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  try {
    writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
    renameSync(tmp, target);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch {}
    throw e;
  }
}
