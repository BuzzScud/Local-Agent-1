// `bun run pack`: builds the pack of Claude's notes (~/.agentic-coder/claude-pack, claude-pack.mjs)
// from Claude Code's memory folders on this Mac and the copies named once with --from (a "Claude
// memory …" folder and a "Claude skills and tools …" folder copied from another Mac); later runs use
// the same copies, kept in the pack's pack.json. Claude's own folders and the copies are only read.
//   bun run pack [--from <copy folder>]… [--no-copies] [--out <folder>]
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { buildPack, packDir, readIndex } from '../src/agent/claude-pack.mjs';

const args = process.argv.slice(2);
const out = (() => { const i = args.indexOf('--out'); return i >= 0 ? resolve(args[i + 1]) : packDir(); })();
const named = args.flatMap((a, i) => (args[i - 1] === '--from' ? [resolve(a.replace(/^~(?=\/)/, homedir()))] : []));
const kept = args.includes('--no-copies') ? [] : (readIndex(out)?.copies ?? []);
const copies = [...new Set([...kept, ...named])].filter((c) => {
  if (existsSync(c)) return true;
  console.log(`not found, left out: ${c.replace(homedir(), '~')}`);
  return false;
});
const t0 = Date.now();
const r = buildPack({ copies, out });
const ago = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`Built ${r.dir.replace(homedir(), '~')} in ${ago} s: ${r.notes} notes (${r.live} from this Mac, ${r.copy} from copies) in ${r.topics} topics, ${r.projects} projects; ${r.split} long notes cut to how they stand now (the whole of each in history/); ${r.skills} skill cards, ${r.tools} of Claude Code's tools; ${r.leftOut.length} left out (sign-ins, servers, secrets).`);
if (copies.length) console.log(`Copies: ${copies.map((c) => c.replace(homedir(), '~')).join(' · ')}`);
