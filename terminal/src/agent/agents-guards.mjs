// /agents' stop list (2 Oct 2026, the owner's picks): before a step of the model runs, these say
// whether it must ask first. The poster's list (auth, payments, deploys, migrations, secrets,
// deletions), the math guards (a test's expected value or tolerance changed), a new package, and a
// big diff (over 100 lines or 3 files in one task). Verify, Review and Ship only read, so an edit
// there is turned away without asking, and so is a change to the test a task is making pass.
// guardStep → null (go on), { key, title, detail } (ask you) or { deny, title } (turned away).
import { basename } from 'node:path';

export const GUARD_OPTS = {
  default: ['No: do it another way', 'Allow it this once', 'Tell it what to do (type it)'],
  pkg: ['No: use what is installed', 'Allow it this once', 'Tell it what to do (type it)'],
  big: ['No: keep the change smaller', 'Allow it this once', 'Tell it what to do (type it)'],
  list: ['No: keep the file', 'Allow it this once', 'Tell it what to do (type it)'],
  secret: ["No: don't touch it", 'Allow it this once', 'Tell it what to do (type it)'],
};

const TEST_FILE = (rel) => /(^|\/)(tests?|__tests__|spec)\//.test(rel) || /[._-](test|spec)\.[a-z]+$/i.test(rel) || /^test_.*\.py$/.test(basename(rel));
const SECRET = /(^|\/|\s|['"])(\.env(\.[\w-]+)?|[\w-]*\.pem|[\w-]*\.key|id_rsa\w*|id_ed25519\w*|credentials(\.\w+)?|secrets?\.(json|ya?ml|toml)|\.npmrc|\.pypirc|\.netrc)(\s|$|['"])/i;
const POSTER = [
  ['auth', 'Auth', /(^|\/)(auth|oauth|login|logout|sessions?|passwords?|jwt)([._/-]|$)/i],
  ['payments', 'Payments', /(payment|billing|stripe|checkout|invoice|subscription)/i],
  ['deploys', 'Deploys', /(^|\/)(\.github\/workflows\/|deploy|Dockerfile|docker-compose|k8s\/|helm\/|terraform\/|fly\.toml|vercel\.json|netlify\.toml|Procfile|app\.ya?ml$)/i],
  ['migrations', 'Migrations', /(^|\/)(migrations?|db\/migrate|alembic)\//i],
];
const DEPLOY_CMD = /\b(kubectl\s+(apply|delete|rollout)|terraform\s+(apply|destroy)|fly\s+deploy|vercel(\s|$)|netlify\s+deploy|docker\s+push|gh\s+workflow\s+run|heroku\s|serverless\s+deploy|sam\s+deploy|cdk\s+deploy)/i;
const MIGRATE_CMD = /\b(prisma\s+migrate|alembic\s+(upgrade|downgrade)|rails\s+db:(migrate|rollback)|knex\s+migrate|manage\.py\s+migrate|sequelize\s+db:migrate|flyway\s+migrate)/i;
const PKG_CMD = /\b((npm|pnpm|yarn|bun)\s+(add|install|i)\s+(?!-)[@\w]|pip3?\s+install\s+(?!-r\b)(?!-e\s+\.)[\w-]|python3?\s+-m\s+pip\s+install\s+(?!-r\b)[\w-]|poetry\s+add\s|uv\s+(add|pip\s+install)\s|cargo\s+add\s|go\s+get\s|gem\s+install\s|brew\s+install\s)/i;
const DELETE_CMD = /(^|[;&|]\s*|\s)(rm|rmdir|unlink|trash|shred)\s|\bgit\s+(rm|clean)\b/;
// Numbers in the lines of a test that check something.
const CHECK_LINE = /\b(assert\w*|expect|toBe\w*|toEqual|isclose|allclose|approx|tol|rtol|atol|abs_tol|rel_tol|eps\w*|places|delta|tolerance)\b/i;
const NUM = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi;

const linesOf = (s) => String(s ?? '').split('\n');
// Lines in one text and not in the other, both ways: how much a step changes.
export function changedLines(before, after) {
  const a = linesOf(before), b = linesOf(after);
  if (!String(before ?? '')) return b.length;
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const ca = count(a), cb = count(b);
  let n = 0;
  for (const [x, k] of cb) n += Math.max(0, k - (ca.get(x) ?? 0));
  for (const [x, k] of ca) n += Math.max(0, k - (cb.get(x) ?? 0));
  return n;
}
// The checking numbers a test loses and gains: "1e-12 → 1e-6", or null when none changed.
export function checkNumbersChanged(before, after) {
  const nums = (text) => linesOf(text).filter((l) => CHECK_LINE.test(l)).flatMap((l) => l.match(NUM) ?? []);
  const was = nums(before), now = nums(after);
  if (!was.length) return null;
  const gone = was.filter((x) => !now.includes(x)), came = now.filter((x) => !was.includes(x));
  if (!gone.length || !came.length) return null;
  return `${gone.slice(0, 2).join(', ')} → ${came.slice(0, 2).join(', ')}`;
}
// New names in package.json's dependencies, or in a requirements file.
export function newPackages(rel, before, after) {
  if (basename(rel) === 'package.json') {
    const deps = (t) => { try { const j = JSON.parse(t || '{}'); return new Set(Object.keys({ ...j.dependencies, ...j.devDependencies, ...j.peerDependencies, ...j.optionalDependencies })); } catch { return null; } };
    const a = deps(before), b = deps(after);
    if (!a || !b) return [];
    return [...b].filter((x) => !a.has(x));
  }
  if (/requirements[\w.-]*\.txt$/.test(rel) || /^Pipfile$/.test(basename(rel))) {
    const names = (t) => new Set(linesOf(t).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('-')).map((l) => l.split(/[<>=~!\[; ]/)[0].toLowerCase()));
    const a = names(before);
    return [...names(after)].filter((x) => !a.has(x));
  }
  return [];
}

export function guardStep(step, ctx = {}) {
  const { name, args = {}, before = '' } = step ?? {};
  const rel = String(args.path ?? '').replace(/^\.\//, '');
  const writes = name === 'Edit' || name === 'Write';
  const cmd = name === 'Bash' ? String(args.command ?? '') : '';
  // Verify, Review and Ship only read and run.
  if (writes && ctx.stage >= 3) return { deny: `${ctx.stage === 3 ? 'Verify' : ctx.stage === 4 ? 'Review' : 'Ship'} only reads and runs: no file is changed here. Report what should change instead.`, title: 'This stage only reads' };
  // The test a task is making pass stays as it was written.
  if (writes && ctx.cover && ctx.node === 1 && rel === ctx.cover) return { deny: `${rel} is the test this task is making pass: change the code, not the test.`, title: 'The test stays' };
  // What the step would leave in the file.
  const after = name === 'Write' ? String(args.content ?? '') : name === 'Edit' ? (args.replace_all ? String(before).split(String(args.old_text ?? '')).join(String(args.new_text ?? '')) : String(before).replace(String(args.old_text ?? ''), String(args.new_text ?? ''))) : null;
  // Secrets: reading or changing them, or a command that names one.
  if ((name === 'Read' || writes) && SECRET.test(` ${rel} `)) return { key: 'secret', title: 'Secrets', detail: `It wants to ${name === 'Read' ? 'read' : 'change'} ${rel}.` };
  if (cmd && SECRET.test(` ${cmd} `)) return { key: 'secret', title: 'Secrets', detail: `The command names a secret file: ${cmd.slice(0, 120)}` };
  // The poster's list.
  if (writes) for (const [key, title, re] of POSTER) if (re.test(rel)) return { key, title, detail: `It wants to change ${rel}.` };
  if (cmd && DEPLOY_CMD.test(cmd)) return { key: 'deploys', title: 'Deploys', detail: `It wants to run: ${cmd.slice(0, 120)}` };
  if (cmd && MIGRATE_CMD.test(cmd)) return { key: 'migrations', title: 'Migrations', detail: `It wants to run: ${cmd.slice(0, 120)}` };
  // New packages.
  if (cmd && PKG_CMD.test(cmd)) return { key: 'pkg', title: 'New package', detail: `It wants to run: ${cmd.slice(0, 120)}` };
  if (writes) { const added = newPackages(rel, before, after); if (added.length) return { key: 'pkg', title: 'New package', detail: `It wants to add ${added.slice(0, 3).join(', ')} to ${rel}.` }; }
  // Deletions: a command that removes files, or a file written empty.
  if (cmd && DELETE_CMD.test(cmd)) return { key: 'list', title: 'Deletion', detail: `It wants to run: ${cmd.slice(0, 120)}` };
  if (name === 'Write' && String(before).trim() && !after.trim()) return { key: 'list', title: 'Deletion', detail: `It wants to empty ${rel}.` };
  // Math guards: a checking number of a test changed.
  if (writes && TEST_FILE(rel) && String(before).trim()) {
    const moved = checkNumbersChanged(before, after);
    if (moved) return { key: 'tol', title: ctx.math === false ? 'Test guard' : 'Math guard', detail: `${rel} changes what it checks: ${moved}.` };
  }
  // A big diff, while it builds: over 100 lines or 3 files in one task.
  if (writes && ctx.stage === 2 && ctx.task) {
    const lim = ctx.limits ?? { lines: 100, files: 3 };
    const add = changedLines(before, after);
    const files = new Set([...(ctx.task.filesTouched ?? []), rel]);
    const lines = (ctx.task.lines ?? 0) + add;
    if ((lines > lim.lines || files.size > lim.files) && !(ctx.task.allowed ?? []).includes('big')) {
      return { key: 'big', title: 'Big diff', detail: `This task would be at ${lines} lines in ${files.size} file${files.size === 1 ? '' : 's'} (the limit: ${lim.lines} lines, ${lim.files} files).`, lines, files: [...files] };
    }
    ctx.task.lines = lines;
    ctx.task.filesTouched = [...files];
  }
  return null;
}
