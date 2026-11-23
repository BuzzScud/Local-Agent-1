// A Write that would cut a file down to under half its lines, on hearth (23 Nov 2026). There a big page is written in
// parts, each next part with Write and append: true (tools-defs.mjs HEARTH_WRITE_DEF), and a part sent without append
// replaces the whole page with that part: the 27b's second part of sales-dashboard.html would have done just that.
// Claude Code has no such check (its Write may replace a file it has read, and its undo goes back to before your
// message, not to the page as it was a step ago), so this one is said the way its own checks are: a plain error that
// says what to send. The first such Write is turned back; the same Write sent again goes through, so a file made
// shorter on purpose still can be.
import { createHash } from 'node:crypto';

export const CUT_FROM = 40; // a file under this many lines is small: rewritten freely
const lineCount = (s) => (s ? String(s).replace(/\n$/, '').split('\n').length : 0);
const hashOf = (content) => createHash('sha1').update(String(content ?? '')).digest('hex');

// prepared: prepare's answer for a Write (tools.mjs: before, after, created, appended); asked: the Write turned back
// last, by file (a Map the agent keeps: path → its content's hash). Only the very next Write of that file can be the
// same Write again: any other that runs there forgets it. Answers { error, shown } to turn it back, or null.
export function cutWrite(prepared, content, asked) {
  if (!prepared?.abs) return null;
  const was = asked.get(prepared.abs);
  asked.delete(prepared.abs);
  if (prepared.created || prepared.appended) return null;
  const before = lineCount(prepared.before);
  const after = lineCount(prepared.after);
  if (before < CUT_FROM || after * 2 > before) return null;
  const hash = hashOf(content);
  if (was === hash) return null;
  asked.set(prepared.abs, hash);
  return {
    error: `Nothing was written: ${prepared.rel} has ${before} lines, and this Write without append would replace all of them with these ${after}. If this is the next part of the file, send it again with append: true, and it is added to the end. If you do mean to replace the whole file with these ${after} lines, send the same Write again.`,
    shown: `Turned back: would replace ${before} lines of ${prepared.rel} with ${after}; asked whether it meant append`,
  };
}
