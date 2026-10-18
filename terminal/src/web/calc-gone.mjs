// The calculator link was taken out on 18 Oct 2026 (the owner: "remove the calculator link"): its background
// service, `coding calc`, /calc and the hub's Calculator tab. The web's calculator tools stay (tools/calculator.mjs:
// they sign in by themselves). A Mac that ran the link as its own background service still has its login item,
// which starts `coding calc run` and has launchd start it again whenever it ends with an error: this takes that
// item away for good and ends cleanly, so launchd lets it go.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

export const CALC_LABEL = 'com.agentic-coder.calc-link';
const launchDir = () => process.env.AGENTIC_LAUNCH_DIR ?? join(homedir(), 'Library', 'LaunchAgents');

// The login item gone, its file first: run as that very service, the bootout at the end stops this process. Only
// the real login items are booted out (a folder of a test's own never reaches launchd).
const REAL_DIR = join(homedir(), 'Library', 'LaunchAgents');
export function retireCalcLink({ dir = launchDir(), run = (args) => spawnSync('launchctl', args, { encoding: 'utf8' }), uid = process.getuid?.(), loaded = dir === REAL_DIR } = {}) {
  const plist = join(dir, `${CALC_LABEL}.plist`);
  const had = existsSync(plist);
  rmSync(plist, { force: true });
  if (loaded && process.platform === 'darwin' && uid !== undefined) run(['bootout', `gui/${uid}/${CALC_LABEL}`]);
  return { had };
}

// coding calc, whatever follows it: says so, takes the login item away, and the exit code is 0.
export function calcGone({ out = (s) => process.stdout.write(`${s}\n`), retire = retireCalcLink, had = existsSync(join(launchDir(), `${CALC_LABEL}.plist`)) } = {}) {
  out(`The calculator link was taken out of Agentic Coder on 18 Oct 2026${had ? '; its background service on this Mac goes too' : ''}. The web's calculator tools still work: they sign in by themselves.`);
  retire();
  return 0;
}
