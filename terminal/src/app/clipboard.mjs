// The Mac clipboard, for text selected in the prompt (copied as soon as it
// is selected, like Claude Code). AGENTIC_CLIPBOARD names a file to write
// instead, so tests never touch the real clipboard.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

export function copyToClipboard(text) {
  if (process.env.AGENTIC_CLIPBOARD) { try { writeFileSync(process.env.AGENTIC_CLIPBOARD, text); return true; } catch { return false; } }
  try { return spawnSync('pbcopy', { input: text }).status === 0; } catch { return false; }
}
