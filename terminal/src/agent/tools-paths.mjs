// Where a path a model typed points (tools.mjs): a near name when it is not there, the shelves
// outside the project, and resolvePath. Moved from tools.mjs word for word.
import { resolve, relative, isAbsolute, dirname, sep, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { walk, nearPath } from '../tools/fs.mjs';
import { mathPathFor, mathDir } from './expertise.mjs';
import { designPathFor, designDir, inDesignDir } from './design.mjs';
import { studioPathFor, studioDir, inStudioDir } from './studio.mjs';
import { scriptsPathFor, inScripts } from './scripts.mjs';
import { oldSteps } from './tools-defs.mjs';

// A path that does not exist, but whose file name appears exactly once near the
// project's top, most likely means that file ("src/stats.mjs" for "stats.mjs").
// Only NEAR folders down, and never from the home folder (or a folder above it):
// from the home folder a guessed notes.txt was taken for one seven folders down
// in another project's test files ("nothing here"), and the model read it over
// and over (2 Oct). Nothing found: Read says File not found, use List or Search.
const NEAR = 3;
export function didYouMean(cwd, p, { home = homedir() } = {}) {
  const name = p.split('/').pop();
  if (!name) return [];
  const real = (d) => { try { return realpathSync(d); } catch { return resolve(d); } };
  const at = real(cwd), h = real(home);
  if (at === h || h.startsWith(at === sep ? sep : `${at}${sep}`)) return [];
  const hits = [];
  let n = 0;
  for (const f of walk(cwd, cwd, 0, NEAR)) {
    if (!f.dir && f.path.split('/').pop() === name) hits.push(f.path);
    if (++n > 20000 || hits.length > 5) break;
  }
  return hits;
}

// A path that is not there, set right (4 Oct 2026): first the closest name in the folder it names
// (nearPath: one clear match per missing part, safe from the home folder), then the same file name
// near the project's top (didYouMean). { path, note } when one fits; { picks } (maybe empty) when not.
// A path typed from the home folder or as a full path stays one; a relative one stays relative.
export function settlePath(cwd, typed, { home = homedir(), work = null } = {}) {
  const p = resolvePath(cwd, typed);
  if (p.shelf || existsSync(p.abs)) return null;
  const near = nearPath(p.abs);
  const shown = (abs) => (isAbsolute(String(typed)) ? abs : String(typed).startsWith('~/') ? `~${abs.slice(home.length)}` : relative(cwd, abs) || '.');
  if (near.fixed) return { path: shown(near.fixed), note: `(${typed} does not exist; this is ${shown(near.fixed)}, the closest name in its folder)\n` };
  // From the home folder the walk is off (didYouMean says why); the folder the request names (work) takes its place.
  const alt = work ? didYouMean(work, basename(String(typed)), { home }).map((r) => shown(join(work, r))) : didYouMean(cwd, typed, { home });
  if (alt.length === 1) return { path: alt[0], note: `(${typed} does not exist; this is ${alt[0]})\n` };
  return { picks: [...new Set([...near.picks.map(shown), ...alt])].slice(0, 5) };
}
// Not there: when the request names that path, a wall too (asking beats guessing another file).
export function missing(text, typed, env, message) {
  const wall = env.blocked !== false && named(typed, env.request) ? { kind: 'missing', url: String(typed), why: `${typed}, which the user named, is not there` } : null;
  return { text: `${text}${wall ? wallLine(wall) : ''}`, error: true, view: { kind: 'error', message }, ...(wall ? { wall } : {}) };
}
export const notThere = (typed, picks, what = 'File') => `${what} not found: ${typed}.${picks.length ? ` Did you mean one of: ${picks.join(', ')}?` : ' Use List or Search to find the right path.'}`;

// Folders of the user's that the tools can read but never change, reached by a
// name at the start of a path: what each is called and where it really is.
const MATH_SHELF = () => ({ name: 'MATH', root: mathDir(), what: "the user's math notes" });
const DESIGN_SHELF = () => ({ name: 'DESIGN', root: designDir(), what: "the user's design examples" });
const STUDIO_SHELF = () => ({ name: 'STUDIO', root: studioDir(), what: "the user's design studio" });

// A path as it really is: the nearest folder of it that exists, with its links followed, and the rest.
const realOf = (p) => {
  const rest = [];
  let head = p;
  while (!existsSync(head) && dirname(head) !== head) { rest.unshift(basename(head)); head = dirname(head); }
  return join(realpathSync(head), ...rest);
};

// open: Bypass permissions, where any folder may be listed or searched, so a parent of the project
// named in full is that folder, not a retyped project path (18 Oct 2026: a List of ~/Desktop by its
// full path, from a project on the Desktop, gave the project's files and the model took them for the Desktop's).
export function resolvePath(cwd, p, { open = false } = {}) {
  // "~" and "~/…" mean the home folder, as in the shell: a Write to
  // "~/Desktop/notes.html" once made a folder named "~" in the home folder,
  // and Bash's "ls ~/Desktop/notes.html" then could not find the page.
  // Such a path is exact, so the retyped-path guesses below leave it alone
  // (from home, a new ~/Desktop/notes.html was once taken for ~/notes.html).
  const fromHome = p === '~' || p?.startsWith('~/');
  if (fromHome) p = homedir() + p.slice(1);
  // "MATH/…" is the user's math notes folder (src/agent/expertise.mjs),
  // read-only, unless the project really has a MATH folder of its own.
  if ((p === 'MATH' || p.startsWith('MATH/')) && !existsSync(resolve(cwd, p))) {
    const m = mathPathFor(p);
    if (m) return { abs: m.abs, rel: p, inside: true, math: true, shelf: MATH_SHELF() };
  }
  // "DESIGN/…" is the user's design examples (src/agent/design.mjs), read-only the same way.
  if ((p === 'DESIGN' || p.startsWith('DESIGN/')) && !existsSync(resolve(cwd, p))) {
    const d = designPathFor(p);
    if (d) return { abs: d.abs, rel: p, inside: true, design: true, shelf: DESIGN_SHELF() };
  }
  // "STUDIO/…" is the user's design studio (src/agent/studio.mjs), read-only the same way.
  if ((p === 'STUDIO' || p.startsWith('STUDIO/')) && !existsSync(resolve(cwd, p))) {
    const d = studioPathFor(p);
    if (d) return { abs: d.abs, rel: p, inside: true, design: true, shelf: STUDIO_SHELF() };
  }
  // "SCRIPTS/…" is this window's saved scripts (scripts.mjs): the model's own, so it may change them.
  const sc = scriptsPathFor(p, cwd);
  if (sc) return { abs: sc.abs, rel: p, inside: true, scripts: true };
  // One named by a longer path that is not there, ending in SCRIPTS/… (9 Oct 2026: a Read of
  // /…/worktrees/x/SCRIPTS/out-29.txt was "File not found"): that saved file, when it is there.
  const tail = /(?:^|\/)(SCRIPTS\/[^/].*)$/.exec(p)?.[1];
  const scTail = tail && tail !== p && !existsSync(isAbsolute(p) ? p : resolve(cwd, p)) ? scriptsPathFor(tail, cwd) : null;
  if (scTail && existsSync(scTail.abs)) return { abs: scTail.abs, rel: tail, inside: true, scripts: true };
  // The folder's own name used as a path ("project", "project/a.js") means the folder.
  const own = cwd.split(sep).pop();
  if (!isAbsolute(p) && own && (p === own || p.startsWith(`${own}/`)) && !existsSync(resolve(cwd, p))) p = p === own ? '.' : p.slice(own.length + 1);
  // So does the end of the folder's own path ("Desktop/project/src" from inside project; 9 Oct 2026:
  // a window that had worked from ~ went on in the project, and its Search was "No such path").
  else if (!isAbsolute(p) && !existsSync(resolve(cwd, p))) {
    const at = cwd.split(sep).filter(Boolean);
    const ps = p.split('/').filter(Boolean);
    for (let k = Math.min(at.length, ps.length); k >= 2; k--) {
      if (at.slice(-k).join('/') === ps.slice(0, k).join('/')) { p = ps.slice(k).join('/') || '.'; break; }
    }
  }
  let abs = isAbsolute(p) ? resolve(p) : resolve(cwd, p);
  // Small models retype the project's full path and get it slightly wrong.
  // A parent of the project folder means the project folder; otherwise try
  // the end of the path inside the project.
  if (fromHome) { /* exact: no guessing */ }
  else if (isAbsolute(p) && abs !== cwd && `${cwd}${sep}`.startsWith(`${abs}${sep}`)) { if (!open) abs = cwd; }
  else if (isAbsolute(p) && !existsSync(abs)) {
    {
      const parts = abs.split(sep).filter(Boolean);
      let found = false;
      for (let i = 1; i < parts.length; i++) {
        const candidate = resolve(cwd, parts.slice(i).join(sep));
        if (existsSync(candidate)) { abs = candidate; found = true; break; }
      }
      // A new file at a made-up place (6 Oct 2026: Qwen3.6 on the service wrote
      // /home/logan/AI_Projects/calculator/handlers/validate.mjs, refused as outside, three steps lost):
      // the end of the path whose folder is in the project, when no more than the first folder of the
      // path it named is there (/home is; ~/Desktop/new/x.mjs names a real place and is left as it is).
      let real = dirname(abs);
      while (!existsSync(real) && dirname(real) !== real) real = dirname(real);
      if (!found && !oldSteps() && real.split(sep).filter(Boolean).length <= 1) {
        for (let i = 1; i < parts.length - 1; i++) {
          const candidate = resolve(cwd, parts.slice(i).join(sep));
          const folder = dirname(candidate);
          if (folder !== cwd && existsSync(folder) && statSync(folder).isDirectory()) { abs = candidate; break; }
        }
      }
    }
  }
  const within = (base, p) => { const r = relative(base, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
  // The project under its real name (6 Oct 2026: a new file by /private/var/… was outside a project
  // opened as /var/…; on a Mac /var and /tmp are links into /private).
  if (isAbsolute(p) && !fromHome && !within(cwd, abs) && !oldSteps()) {
    try {
      const rc = realpathSync(cwd);
      const ra = realOf(abs);
      if (within(rc, ra)) abs = resolve(cwd, relative(rc, ra));
    } catch {}
  }
  const rel = relative(cwd, abs);
  // A link inside the project that points outside it is outside too.
  let inside = within(cwd, abs);
  // realRel: where a link inside the project really points (notes.md → .env),
  // so a protected file is still protected under another name (permissions.mjs).
  let realRel;
  if (inside && existsSync(abs)) {
    try {
      const rc = realpathSync(cwd);
      const ra = realpathSync(abs);
      inside = within(rc, ra);
      if (inside && relative(rc, ra) !== rel) realRel = relative(rc, ra);
    } catch {}
  }
  // A full path into the math notes folder still means the notes, read-only.
  if (!inside && existsSync(abs) && within(mathDir(), abs)) {
    const r = relative(mathDir(), abs);
    return { abs, rel: `MATH${r ? `/${r}` : ''}`, inside: true, math: true, shelf: MATH_SHELF() };
  }
  const script = !inside ? inScripts(abs) : null;
  if (script) return { abs, rel: script, inside: true, scripts: true };
  const inDesign = !inside && existsSync(abs) ? inDesignDir(abs) : null;
  if (inDesign) return { abs, rel: inDesign, inside: true, design: true, shelf: DESIGN_SHELF() };
  const inStudio = !inside && existsSync(abs) ? inStudioDir(abs) : null;
  if (inStudio) return { abs, rel: inStudio, inside: true, design: true, shelf: STUDIO_SHELF() };
  return { abs, rel: rel || '.', inside, ...(realRel ? { realRel } : {}) };
}

export const wallLine = (w) => `\n\n(Blocked: ${w.why}. Do not do a different task instead. Tell the user what blocked you and ask how to go on, with Ask; go on another way only if they say so.)`;
// A path the request names that is not there (and no close name was found): asking beats guessing.
export const named = (typed, request) => { const t = String(typed ?? '').replace(/\/$/, ''); const r = String(request ?? ''); return t.length >= 4 && (r.includes(t) || (t.split('/').pop().length >= 6 && r.includes(t.split('/').pop()))); };
