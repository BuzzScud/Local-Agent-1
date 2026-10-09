// Loops kept to load again (9 Oct 2026, the owner: "can we make pre made loops? that we can load? … can we
// also add a ui to create fresh loops from scratch? all in the loop command?"). Their picks: the full build,
// new loops made with the wizard and kept with Save, a one-page form for changing one you kept, yours kept
// for you in every project and a project's own kept in it (shared through git), and a loop you load opens
// at the wizard's last step to check before it starts.
// Three places, one shape (the shape of your helper-agent files, rules/remote/agents):
//   ready-made  terminal/rules/loops/*.md, shipped with the app (imported as text, so the built app has them)
//   yours       <home>/loop-library/*.md, saved for you, in every project
//   a project's <project>/.agentic/loops/*.md, saved in it and shared through git; one you did not save
//               there runs only after a yes to that very file (its fingerprint, kept in trusted.json)
// A file:
//   # Watch the tests
//   Runs the tests every 10 minutes and says what fails.      ← what it is, one line
//   - Kind: test                                              ← test · debug · web · task
//   - Every: 10m                                              ← 10m, 1h, until done, own pace
//   - Until: no limit                                         ← 5 runs · 18:30 · 2h · no limit
//   - Mode: ask · Cap: none · Steps: as /effort · Ask first: off
//   - Page check: {page}                                      ← the page checked in a hidden browser before each run,
//                                                               its findings above the message (· who can use it: and that)
//   - Picture: RUN the tests › READ what fails › TELL you     ← the three boxes in the wizard's picture
//   - Asks: page = <its ready answer>                         ← a {page} in the message, and its ready answer
//   ## Each run
//   Read {page}. If there is …                                ← what each run is told
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HOME } from '../../../models/index.mjs';

// The ready-made ones, read once: under Bun with literal paths, so the one-file app carries them inside it (as
// prompt-files.mjs does with TOOLS.md); under Node (the bench's scripts import the app's parts) from the disk.
const SHIPPED_IDS = ['watch-the-tests', 'fix-until-green', 'build-and-lint-guard', 'flaky-test-hunter', 'watch-ci', 'release-watch', 'dev-server-check', 'log-watcher', 'work-digest', 'docs-keeper', 'layout-watch', 'polish-until-clean', 'theme-guard', 'accessibility-pass', 'design-review'];
async function shippedText() {
  if (typeof Bun === 'undefined') return SHIPPED_IDS.map((id) => { try { return readFileSync(new URL(`../../rules/loops/${id}.md`, import.meta.url), 'utf8'); } catch { return ''; } });
  try {
    const texts = (await Promise.all([
      import('../../rules/loops/watch-the-tests.md', { with: { type: 'text' } }),
      import('../../rules/loops/fix-until-green.md', { with: { type: 'text' } }),
      import('../../rules/loops/build-and-lint-guard.md', { with: { type: 'text' } }),
      import('../../rules/loops/flaky-test-hunter.md', { with: { type: 'text' } }),
      import('../../rules/loops/watch-ci.md', { with: { type: 'text' } }),
      import('../../rules/loops/release-watch.md', { with: { type: 'text' } }),
      import('../../rules/loops/dev-server-check.md', { with: { type: 'text' } }),
      import('../../rules/loops/log-watcher.md', { with: { type: 'text' } }),
      import('../../rules/loops/work-digest.md', { with: { type: 'text' } }),
      import('../../rules/loops/docs-keeper.md', { with: { type: 'text' } }),
      import('../../rules/loops/layout-watch.md', { with: { type: 'text' } }),
      import('../../rules/loops/polish-until-clean.md', { with: { type: 'text' } }),
      import('../../rules/loops/theme-guard.md', { with: { type: 'text' } }),
      import('../../rules/loops/accessibility-pass.md', { with: { type: 'text' } }),
      import('../../rules/loops/design-review.md', { with: { type: 'text' } }),
    ])).map((m) => m.default);
    // Inside the one-file app the import gives the embedded file's path.
    return texts.map((t) => (t.startsWith('/$bunfs/') ? readFileSync(t, 'utf8') : t));
  } catch { return SHIPPED_IDS.map(() => ''); }
}
const SHIPPED = (await shippedText()).map((text, i) => [SHIPPED_IDS[i], text]);
export const yoursDir = (home = HOME) => join(home, 'loop-library');
export const projectDir = (folder) => join(folder, '.agentic', 'loops');
const trustFile = (home) => join(yoursDir(home), 'trusted.json');

// A name as a file name: letters, digits and hyphens.
export const slugOf = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'loop';
const fingerprint = (text) => createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
// The {words} a message asks for, each once, in order.
export const fillsIn = (message) => [...new Set([...String(message ?? '').matchAll(/\{([a-z][a-z0-9_-]{0,30})\}/gi)].map((m) => m[1]))];
// A message with its fill-ins answered; one with no answer keeps its {word}.
export const filledText = (message, values = {}) => String(message ?? '').replace(/\{([a-z][a-z0-9_-]{0,30})\}/gi, (all, k) => (values[k] ?? '').trim() || all);
// "RUN the tests › READ what fails › TELL you" → [['RUN', 'the tests'], …]; three parts or null.
export function pictureOf(text) {
  const parts = String(text ?? '').split(/\s*(?:›|>|→)\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 3) return null;
  return parts.map((s) => { const [verb, ...rest] = s.split(/\s+/); return [verb.toUpperCase().slice(0, 10), rest.join(' ').slice(0, 14)]; });
}
export const pictureText = (pic) => (pic ? pic.map(([v, w]) => `${v} ${w}`.trim()).join(' › ') : '');

// A file's words → { name, about, fields, picture, fills: [{ key, value }], message } (null when it has no message).
export function parseLoopFile(text, { id = null } = {}) {
  const t = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '');
  const name = /^#\s+(.+)$/m.exec(t)?.[1]?.trim() ?? '';
  const at = t.search(/^##\s+each run\b/im);
  if (at < 0) return null;
  const head = t.slice(0, at).replace(/^#\s+.*\n?/m, '');
  const message = t.slice(at).replace(/^##.*\n?/, '').trim();
  if (!message) return null;
  const lines = head.split('\n');
  const field = (key) => lines.find((l) => new RegExp(`^-\\s*${key}\\s*:`, 'i').test(l))?.replace(/^-[^:]*:\s*/, '').trim() ?? '';
  const about = lines.filter((l) => l.trim() && !/^-\s*[a-z ]+:/i.test(l)).join(' ').trim();
  const until = field('until') || 'no limit';
  const runs = /^(\d+)\s*runs?$/i.exec(until)?.[1] ?? 'no limit';
  const stopAt = runs === 'no limit' && !/^(no limit|none|never|-)$/i.test(until) ? until : 'none';
  const asks = field('asks').split(/\s*·\s*|\s*;\s*/).map((a) => /^\{?([a-z][a-z0-9_-]*)\}?\s*=\s*(.*)$/i.exec(a)).filter(Boolean);
  const answers = Object.fromEntries(asks.map((m) => [m[1], m[2].trim()]));
  return {
    id, name: name || 'A loop', about,
    fields: {
      kind: (field('kind') || '').toLowerCase() || null, every: field('every') || '10m', runs, stopAt,
      mode: (field('mode') || 'ask').toLowerCase(), cap: field('cap') || 'none', steps: field('steps') || 'as /effort',
      askFirst: /^(on|yes|true)$/i.test(field('ask first')),
      ...(field('page check') ? { check: field('page check') } : {}),
    },
    picture: pictureOf(field('picture')),
    fills: fillsIn(message).map((key) => ({ key, value: answers[key] ?? '' })),
    message,
  };
}
// A loop as a file's words (the shape parseLoopFile reads).
export function loopFileText(l) {
  const f = l.fields ?? {};
  const until = f.runs && f.runs !== 'no limit' ? `${f.runs} runs` : f.stopAt && f.stopAt !== 'none' ? f.stopAt : 'no limit';
  const asks = (l.fills ?? []).map((x) => `${x.key} = ${x.value ?? ''}`.trim()).join(' · ');
  return [
    `# ${String(l.name ?? 'A loop').replace(/\n/g, ' ').trim()}`,
    ...(l.about ? [String(l.about).replace(/\s+/g, ' ').trim()] : []),
    '',
    ...(f.kind ? [`- Kind: ${f.kind}`] : []),
    `- Every: ${f.every ?? '10m'}`,
    `- Until: ${until}`,
    `- Mode: ${f.mode ?? 'ask'}`,
    ...(f.cap && f.cap !== 'none' ? [`- Cap: ${f.cap}`] : []),
    ...(f.steps && f.steps !== 'as /effort' ? [`- Steps: ${f.steps}`] : []),
    ...(f.askFirst ? ['- Ask first: on'] : []),
    ...(f.check ? [`- Page check: ${f.check}`] : []),
    ...(l.picture ? [`- Picture: ${pictureText(l.picture)}`] : []),
    ...(asks ? [`- Asks: ${asks}`] : []),
    '',
    '## Each run',
    String(l.message ?? '').trim(),
    '',
  ].join('\n');
}

function mdIn(dir) {
  try { return readdirSync(dir).filter((f) => /^[a-z0-9][a-z0-9-]*\.md$/i.test(f)).sort(); } catch { return []; }
}
function trusted(home) { try { return JSON.parse(readFileSync(trustFile(home), 'utf8')); } catch { return {}; } }
// Yes to a project's loop file as it is now (Start in the wizard says it).
export function trustLoop(home, file, text) {
  const t = trusted(home);
  t[file] = fingerprint(text);
  mkdirSync(yoursDir(home), { recursive: true });
  writeFileSync(trustFile(home), `${JSON.stringify(t, null, 2)}\n`);
}

// Every loop that can be loaded: the ready-made ones, yours, then each project's (folders: [{ path, shown }]).
// Each: { id, from: 'ready'|'yours'|'project', project, folder, file, trusted, …parseLoopFile }.
export function libraryOf({ home = HOME, folders = [] } = {}) {
  const out = [];
  for (const [id, text] of SHIPPED) { const l = parseLoopFile(text, { id: `ready:${id}` }); if (l) out.push({ ...l, from: 'ready', file: null, trusted: true }); }
  for (const f of mdIn(yoursDir(home))) {
    const file = join(yoursDir(home), f);
    try { const l = parseLoopFile(readFileSync(file, 'utf8'), { id: `yours:${f.slice(0, -3)}` }); if (l) out.push({ ...l, from: 'yours', file, trusted: true }); } catch {}
  }
  const t = trusted(home);
  for (const p of folders) {
    for (const f of mdIn(projectDir(p.path))) {
      const file = join(projectDir(p.path), f);
      try {
        const text = readFileSync(file, 'utf8');
        const l = parseLoopFile(text, { id: `project:${p.path}:${f.slice(0, -3)}` });
        if (l) out.push({ ...l, from: 'project', project: p.shown, folder: p.path, file, trusted: t[file] === fingerprint(text) });
      } catch {}
    }
  }
  return out;
}

// Saves a loop for you or in a project (folder), as name.md; a loop of that name there is replaced
// only when `replace` names its file. Answers { file } or { error }.
export function saveLoop(l, { home = HOME, where = 'yours', folder = null, replace = null } = {}) {
  const name = String(l.name ?? '').trim();
  if (!name) return { error: 'Give it a name first' };
  if (!l.message?.trim()) return { error: 'Type what each run should do first' };
  if (where === 'project' && !folder) return { error: 'Pick the project at Where first' };
  const dir = where === 'project' ? projectDir(folder) : yoursDir(home);
  const file = join(dir, `${slugOf(name)}.md`);
  if (existsSync(file) && file !== replace) return { error: `There is already a loop called “${name}” ${where === 'project' ? 'in that project' : 'of yours'}: give it another name` };
  const text = loopFileText(l);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, text);
  if (replace && replace !== file) { try { rmSync(replace, { force: true }); } catch {} }
  // What you saved in a project is yours to run: no question at its first run.
  if (where === 'project') trustLoop(home, file, text);
  return { file };
}
export function removeLoop(file, { home = HOME, folders = [] } = {}) {
  const ok = file.startsWith(`${yoursDir(home)}/`) || folders.some((p) => file.startsWith(`${projectDir(p.path)}/`));
  if (!ok) return { error: 'That is not a loop you kept' };
  try { rmSync(file); return { file }; } catch (e) { return { error: e.message }; }
}

// A library loop by its name as typed after /loop ("watch the tests", "Watch CI"): case, spaces and
// punctuation aside. Yours first, then a project's, then the ready-made ones.
export function findByName(library, words) {
  const want = slugOf(words);
  if (!want || want === 'loop') return null;
  const order = { yours: 0, project: 1, ready: 2 };
  return [...library].sort((a, b) => order[a.from] - order[b.from]).find((l) => slugOf(l.name) === want) ?? null;
}
