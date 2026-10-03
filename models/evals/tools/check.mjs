// `bun run check`: is anything in Agentic Coder that should not be? One line per
// check, in plain words: ✓ fine, ! worth a look, ✗ wrong. It changes nothing in
// the repo: it reads the files, git, what is installed on this Mac, and asks
// GitHub and npm. Ends with code 1 when a check is wrong; the run goes in the
// test record.
//   node models/evals/tools/check.mjs [--fast] [--no-tests] [--offline]
//   --fast      without the two slow checks (the model files, the unit tests)
//   --no-tests  without the unit tests only
//   --offline   without the checks that need the network (GitHub, npm)
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync, lstatSync, mkdtempSync, mkdirSync, cpSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { recordTest, codeLabel } from '../record.mjs';
import { published, ownerMarks } from '../../../docs/tools/to-docs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ---- what counts as a secret ---------------------------------------------------------------
// Shapes of real keys. A value that is plainly made up (abcdefgh…, 123456…,
// xxxx) is a test's sample and is left alone.
const SHAPES = [
  ['a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g],
  ['an API key', /\bsk-[A-Za-z0-9_-]{20,}/g],
  ['an AWS key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['a Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['a Hugging Face token', /\bhf_[A-Za-z0-9]{30,}/g],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:\\n|\s)*[A-Za-z0-9+/=]{40,}/g],
  ['a broker setting', /\b(?:PROJECTX|TOPSTEP)_[A-Z]{2,}\w*/g],
  ['a password or key written out', /\b(?:api[_-]?key|secret|passwd|password|auth[_-]?token)["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi],
];

export function looksMadeUp(value) {
  const body = String(value).replace(/^(?:gh[pousr]_|github_pat_|sk-|hf_|xox[baprs]-|AKIA)/, '');
  if (body.length < 8) return true;
  if (/example|sample|dummy|placeholder|changeme|your[-_]|\$\{|<|\.\.\./i.test(body)) return true;
  if (new Set(body.toLowerCase()).size <= 3) return true;
  // runs of letters or digits in order: abcdef…, 123456…
  let runs = 1;
  for (let i = 1; i < body.length; i++) if (body.charCodeAt(i) !== body.charCodeAt(i - 1) + 1) runs++;
  return runs <= body.length / 4;
}

// Every secret-shaped thing in a text: [{ what, line, show }]. `show` is cut
// short, so a finding never prints the whole secret.
export function findSecrets(text) {
  const found = [];
  for (const [what, shape] of SHAPES) {
    for (const m of text.matchAll(shape)) {
      const value = m[1] ?? m[0];
      if (what !== 'a private key' && what !== 'a broker setting' && looksMadeUp(value)) continue;
      found.push({ what, line: text.slice(0, m.index).split('\n').length, show: `${value.slice(0, 10)}…` });
    }
  }
  return found;
}

// A file that never belongs in git, by its name.
export function riskyName(path) {
  const name = path.split('/').pop();
  if (/^\.env(\.|$)/.test(name) && !/\.(example|sample)$/.test(name)) return 'a settings file with secrets (.env)';
  if (/\.(pem|key|p12|pfx)$/.test(name) || /^id_(rsa|ed25519|ecdsa)/.test(name)) return 'a key file';
  if (/^credentials?(\.|$)/i.test(name)) return 'a credentials file';
  if (/\.(gguf|safetensors)$/.test(name)) return 'a model file';
  if (/\.(sqlite3?|db)$/.test(name)) return 'a database';
  if (/\.(zip|tgz|tar|gz|bundle|dmg)$/.test(name)) return 'an archive';
  if (name === '.DS_Store') return 'a Finder file';
  if (name === 'history.jsonl' || /(^|\/)sessions\//.test(path)) return 'your conversations';
  return null;
}

// ---- where the code connects ---------------------------------------------------------------
// The places Agentic Coder's own code names. A new one is looked at before it ships.
// www.apple.com: the first lines every scheduler file on a Mac carries (the
// night review's, terminal/src/app/review.mjs). A name in a header: nothing connects to it.
// api.search.brave.com and api.tavily.com: the web search services /web offers, used only with your key (30 Sep 2026).
export const KNOWN_HOSTS = ['127.0.0.1', 'localhost', 'github.com', 'api.github.com', 'huggingface.co', 'claude.ai', 'www.w3.org', 'www.apple.com', 'host', 'api.search.brave.com', 'api.tavily.com'];
export const hostsIn = (text) => [...new Set([...text.matchAll(/\bhttps?:\/\/([A-Za-z0-9][A-Za-z0-9.-]*)/g)].map((m) => m[1].toLowerCase().replace(/\.$/, '')))];
export const newHosts = (text, known = KNOWN_HOSTS) => hostsIn(text).filter((h) => !known.includes(h));
// A server open to the network instead of this Mac only.
export const listensWide = (text) => /['"`]0\.0\.0\.0['"`]|hostname:\s*['"`](?!127\.0\.0\.1|localhost)[^'"`]+['"`]|--host['"`],\s*['"`](?!127\.0\.0\.1)[^'"`]+['"`]|\.listen\(\s*\w+\s*,\s*[A-Za-z_]\w*\s*,/.test(text);
// Code built from text while running. The one known use reads the weights
// page's own script, which is part of the repo (the edit writer and the weights
// reader check both get it from there).
export const BUILDS_CODE_OK = ['terminal/src/app/weights-core.mjs'];
// Opens a server to the network on purpose: `coding serve`, the model for another
// machine's /remote, only when it is run, and only behind its API key.
// coding serve (the model, behind its key) and coding door (the background sessions, on the
// Tailscale address only, behind its key) open a server to other machines on purpose.
export const LISTENS_WIDE_OK = ['models/runtime/serve.mjs', 'terminal/src/app/door.mjs'];
export const buildsCode = (text) => /\beval\s*\(|\bnew Function\s*\(/.test(text);

// ---- a server's address ------------------------------------------------------------------------
// A public internet address (1.2.3.4, with or without :port) written in a file or a commit message
// names a real machine to anyone who reads the repo (3 Oct 2026: a shared model service's address
// was in two pages and a commit message). This Mac, the home network, Tailscale and link-local
// addresses name nothing a stranger can reach, and the ranges kept for documentation are made up.
// Numbers that only look like one are left alone: a version (Chrome/120.0.0.0, v1.2.3.4), and the
// drawing numbers of a page's pictures (an SVG path's d="…").
// An address a test made up, or one that is public knowledge, is listed here on purpose.
export const KNOWN_ADDRESSES = ['1.2.3.4', '1.1.1.1', '8.8.8.8', '8.8.4.4', '9.9.9.9', '164.92.10.7', '172.32.0.1', '100.128.0.1'];
const DRAWN = /\b(?:d|points|transform|viewBox|values|keyTimes|keySplines|stroke-dasharray)=(?:"[^"]*"|'[^']*')/g;
const ADDRESS = /(?<![\w.-])(?<!(?:^|[^/])\/)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{2,5}))?(?![\w-]|\.\d)/g;
const reachable = ([a, b, c]) => !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
  || (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
export function publicAddresses(text, known = KNOWN_ADDRESSES) {
  const out = new Set();
  for (const m of String(text ?? '').replace(DRAWN, '').matchAll(ADDRESS)) {
    const parts = m.slice(1, 5).map(Number);
    if (parts.some((n) => n > 255) || !reachable(parts)) continue;
    const ip = parts.join('.');
    if (!known.includes(ip)) out.add(m[5] ? `${ip}:${m[5]}` : ip);
  }
  return [...out];
}

// ---- which files are the app ---------------------------------------------------------------
const isCode = (f) => /\.(mjs|js|jsx)$/.test(f);
export const isShipped = (f) => /^terminal\/(src\/|app\/|index\.mjs$)/.test(f) || (/^models\//.test(f) && !/^models\/(evals|test)\//.test(f));
const STARTS = ['terminal/src/cli.jsx', 'terminal/index.mjs', 'models/index.mjs'];
const NAMES_A_FILE = /(?:from\s*|import\s*\(\s*|import\s+|require\(\s*)['"`](\.{1,2}\/[^'"`]+)['"`]/g;

// The shipped code files nothing uses: not reached from where the app starts,
// and not named by any other file (a script, a test, package.json, a README).
export function unusedFiles(dir, files) {
  const seen = new Set();
  const walk = (file) => {
    const abs = resolve(dir, file);
    if (seen.has(abs) || !existsSync(abs) || !statSync(abs).isFile()) return;
    seen.add(abs);
    if (!isCode(abs)) return;
    for (const m of readFileSync(abs, 'utf8').matchAll(NAMES_A_FILE)) {
      const base = resolve(dirname(abs), m[1]);
      const hit = [base, `${base}.mjs`, `${base}.js`, `${base}.jsx`, `${base}/index.mjs`].find((p) => existsSync(p) && statSync(p).isFile());
      if (hit) walk(relative(dir, hit));
    }
  };
  STARTS.forEach(walk);
  const texts = files.filter((f) => /\.(mjs|js|jsx|json|sh|md)$/.test(f) && !f.startsWith('docs/') && existsSync(join(dir, f))).map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
  return files.filter((f) => isCode(f) && isShipped(f) && existsSync(join(dir, f)) && !seen.has(resolve(dir, f)))
    .filter((f) => { const name = f.split('/').pop(); return !texts.some(([g, t]) => g !== f && t.includes(name)); });
}

// ---- helpers ---------------------------------------------------------------------------------
function run(cmd, args, { cwd = root, timeout = 120_000, env = process.env } = {}) {
  return new Promise((done) => {
    let out = '', err = '', child;
    try { child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { done({ code: 1, out, err: e.message }); return; }
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => { if (out.length < 64 << 20) out += d; });
    child.stderr.on('data', (d) => { if (err.length < 1 << 20) err += d; });
    child.on('error', (e) => { clearTimeout(timer); done({ code: 1, out, err: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code: code ?? 1, out, err }); });
  });
}
const git = (...a) => run('git', ['-C', root, ...a]);
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const tilde = (p) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);
const few = (list, n = 4) => [...list.slice(0, n), ...(list.length > n ? [`and ${list.length - n} more`] : [])];
const isText = (buf) => !buf.subarray(0, 8000).includes(0);
const fine = (text, more = []) => ({ mark: 'fine', text, more });
const look = (text, more = []) => ({ mark: 'look', text, more });
const wrong = (text, more = []) => ({ mark: 'wrong', text, more });
const skipped = (text) => ({ mark: 'skip', text, more: [] });
const sha256 = (file) => new Promise((done, fail) => { const h = createHash('sha256'); createReadStream(file).on('data', (d) => h.update(d)).on('end', () => done(h.digest('hex'))).on('error', fail); });
function filesUnder(dir, skip = () => false, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name), rel = relative(base, p);
    if (skip(rel, e)) continue;
    if (e.isDirectory()) filesUnder(p, skip, base, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

// ---- the checks ------------------------------------------------------------------------------
async function sameAsGitHub({ offline }) {
  const asked = offline ? null : await run('git', ['-C', root, 'fetch', '--quiet', 'origin'], { timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const head = (await git('rev-parse', '--short', 'HEAD')).out.trim();
  const branch = (await git('rev-parse', '--abbrev-ref', 'HEAD')).out.trim();
  const theirs = await git('rev-parse', '--short', 'origin/main');
  if (theirs.code !== 0) return look(`${branch} ${head}: this copy knows no GitHub main to compare with`);
  const ahead = Number((await git('rev-list', '--count', 'origin/main..HEAD')).out), behind = Number((await git('rev-list', '--count', 'HEAD..origin/main')).out);
  const open = (await git('status', '--porcelain')).out.split('\n').filter(Boolean);
  const notes = [ahead ? `${ahead} commit${ahead > 1 ? 's here are' : ' here is'} not on GitHub yet` : '', behind ? `GitHub is ${behind} commit${behind > 1 ? 's' : ''} ahead of this copy` : '',
    open.length ? `${open.length} changed file${open.length > 1 ? 's' : ''} not committed: ${few(open.map((l) => l.slice(3)), 3).join(', ')}` : '',
    asked && asked.code !== 0 ? 'GitHub could not be asked just now; compared with what was last fetched' : ''].filter(Boolean);
  return notes.length ? look(`${branch} ${head}, GitHub main ${theirs.out.trim()}`, notes) : fine(`${branch} ${head} is exactly what GitHub has`);
}

// The repo is public on purpose (the owner's choice, 28 Sep 2026): a stranger reading it is the
// expected answer, so it is fine, not a red line every push is made past. Private again, the line
// says so until PUBLIC_SINCE is set to null; with null, a public repo is wrong, as before.
export const PUBLIC_SINCE = '28 Sep 2026';
// What a stranger's request for the repo says about it: status is GitHub's answer without a login.
export function visibility(status, repo, since = PUBLIC_SINCE) {
  if (status === 404) return since ? look(`${repo} is private now, but the repo says it is public on purpose since ${since} (PUBLIC_SINCE in check.mjs): set it to null`) : fine(`a stranger asking for ${repo} gets "not found"`);
  if (status === 200) return since ? fine(`${repo} is public, on purpose (since ${since}): anyone can read it`) : wrong(`${repo} is PUBLIC: anyone can read it`);
  return look(`GitHub answered ${status}; could not tell`);
}
async function whoCanRead({ offline }) {
  if (offline) return skipped('not asked (offline)');
  const url = (await git('remote', 'get-url', 'origin')).out.trim();
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (!m) return look(`the repo's home is not GitHub: ${url || 'none set'}`);
  try {
    const r = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}`, { headers: { 'User-Agent': 'agentic-coder-check' }, signal: AbortSignal.timeout(10_000) });
    return visibility(r.status, `${m[1]}/${m[2]}`);
  } catch { return look('GitHub could not be reached'); }
}

// Addresses no one can own: the example domains kept for docs and tests (with their
// subdomains), and one-letter stand-ins such as a@b.co in a test's cases.
const madeUpMail = (a) => /@(?:[a-z0-9-]+\.)*example\.(?:com|net|org)$|\.(?:test|example|invalid|localhost)$/i.test(a) || /^[a-z]@(?:[a-z]\.)+[a-z]{2,3}$/i.test(a);

function secretsInFiles({ files }) {
  const hits = [], paths = [], mail = new Set();
  const me = homedir();
  for (const f of files) {
    const p = join(root, f);
    if (!existsSync(p) || statSync(p).size > 3 << 20) continue;
    const buf = readFileSync(p);
    if (!isText(buf)) continue;
    const text = buf.toString('utf8');
    for (const s of findSecrets(text)) hits.push(`${f}:${s.line}  ${s.what} (${s.show})`);
    if (text.includes(`${me}/`)) paths.push(f);
    for (const m of text.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}\b/g)) if (!/@(example\.com|x\.com|users\.noreply\.github\.com|anthropic\.com)$|^git@github\.com$/.test(m[0]) && !madeUpMail(m[0]) && !/\.(png|jpg|svg|mjs|js)$/.test(m[0])) mail.add(`${m[0]} in ${f}`);
  }
  if (hits.length) return wrong(`${hits.length} secret-looking value${hits.length > 1 ? 's' : ''} in the files`, few(hits, 8));
  const notes = [paths.length ? `your home folder's path is written in ${paths.length} file${paths.length > 1 ? 's' : ''} (fine while the repo is private): ${few(paths, 3).join(', ')}` : '',
    mail.size ? `email addresses: ${few([...mail], 3).join(', ')}` : ''].filter(Boolean);
  return notes.length ? look(`no keys, tokens or passwords in ${files.length} files`, notes) : fine(`no keys, tokens or passwords in ${files.length} files`);
}

function filesThatBelong({ files }) {
  const bad = files.map((f) => [f, riskyName(f)]).filter(([, why]) => why).map(([f, why]) => `${f}  ${why}`);
  const big = files.filter((f) => existsSync(join(root, f)) && statSync(join(root, f)).size > 3 << 20).map((f) => `${f}  ${(statSync(join(root, f)).size / 1048576).toFixed(1)} MB`);
  if (bad.length) return wrong(`${bad.length} file${bad.length > 1 ? 's' : ''} that should not be in git`, few(bad, 8));
  const size = files.reduce((n, f) => n + (existsSync(join(root, f)) ? statSync(join(root, f)).size : 0), 0);
  return big.length ? look(`${files.length} files, ${(size / 1048576).toFixed(1)} MB; some are large`, few(big)) : fine(`${files.length} files, ${(size / 1048576).toFixed(1)} MB, none of a kind that stays out of git`);
}

async function history() {
  const count = Number((await git('rev-list', '--count', '--all')).out) || 0;
  const names = [...new Set(lines((await git('log', '--all', '--name-only', '--format=')).out))].map((f) => [f, riskyName(f)]).filter(([, why]) => why).map(([f, why]) => `${f}  ${why}`);
  const quick = 'gh[pousr]_[A-Za-z0-9]{20}|github_pat_[A-Za-z0-9_]{20}|sk-[A-Za-z0-9_-]{20}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10}|hf_[A-Za-z0-9]{30}|PRIVATE KEY-----|(PROJECTX|TOPSTEP)_[A-Z]{2}';
  const log = await run('git', ['-C', root, 'log', '--all', '-p', '--no-color', '--unified=0', '-G', quick, '--format=%x01%h %s'], { timeout: 180_000 });
  const hits = [];
  let commit = '';
  for (const l of log.out.split('\n')) {
    if (l.startsWith('\x01')) commit = l.slice(1, 60);
    else if (l.startsWith('+') && !l.startsWith('+++')) for (const s of findSecrets(l)) hits.push(`${commit}  ${s.what} (${s.show})`);
  }
  if (hits.length || names.length) return wrong('something that should not be in git was committed at some point', few([...hits, ...names], 8));
  return fine(`nothing secret in any of the ${count} commits, on any branch`);
}

// A server's address in a file is wrong (take it out); one in a commit message stays in the history
// until the history is rewritten, so it is a line to look at, with the commit it is in.
async function addresses({ files }) {
  const inFiles = [];
  for (const f of files) {
    const p = join(root, f);
    if (!existsSync(p) || statSync(p).size > 16 << 20) continue;
    const buf = readFileSync(p);
    if (!isText(buf)) continue;
    const hits = publicAddresses(buf.toString('utf8'));
    if (hits.length) inFiles.push(`${f}  ${few(hits, 3).join(', ')}`);
  }
  const inMessages = [];
  for (const c of (await git('log', '--all', '--format=%x01%h%x02%B')).out.split('\x01').filter(Boolean)) {
    const [id, message = ''] = c.split('\x02');
    const hits = publicAddresses(message);
    if (hits.length) inMessages.push(`commit ${id}'s message  ${few(hits, 3).join(', ')} (only a rewrite of the history takes it out)`);
  }
  if (inFiles.length) return wrong(`a server's address is written in ${inFiles.length} file${inFiles.length > 1 ? 's' : ''}: anyone reading the repo can find that machine`, few([...inFiles, ...inMessages], 8));
  if (inMessages.length) return look(`no server's address in ${files.length} files; ${inMessages.length} commit message${inMessages.length > 1 ? 's name' : ' names'} one`, few(inMessages, 8));
  return fine(`no server's address in ${files.length} files or in any commit message`);
}

// A package the repo holds itself (a "file:" one: the react-devtools-core stand-in) is installed as
// a link by npm and as a copy by bun. A copy is compared with the repo's own folder, file by file, not
// with npm (which never published it): the same is fine, a changed one is named.
export function localCopyDiff(rootDir, mods, links) {
  const bad = [];
  for (const [name, from] of Object.entries(links)) {
    const here = join(mods, name), own = join(rootDir, from);
    if (!existsSync(here) || lstatSync(here).isSymbolicLink() || !existsSync(own)) continue;
    const skip = (rel, e) => e.isSymbolicLink() || /(^|\/)(\.DS_Store|node_modules)$/.test(rel);
    const mine = filesUnder(here, skip), theirs = new Set(filesUnder(own, skip));
    for (const f of mine) if (!theirs.has(f) || !readFileSync(join(here, f)).equals(readFileSync(join(own, f)))) bad.push(`${name}/${f} differs from the repo's own copy (${from})`);
    for (const f of theirs) if (!existsSync(join(here, f))) bad.push(`${name}/${f} is in the repo's own copy (${from}) but not installed`);
  }
  return bad;
}

async function packages({ offline }) {
  const lockFile = join(root, 'package-lock.json'), mods = join(root, 'node_modules');
  if (!existsSync(lockFile) || !existsSync(mods)) return look('packages are not installed here (bun install)');
  const lock = JSON.parse(readFileSync(lockFile, 'utf8')).packages ?? {};
  const bad = [], notes = [];
  const local = [];
  const links = {}; // an installed name → the repo's own folder it comes from
  for (const [path, p] of Object.entries(lock)) {
    if (!path) continue;
    if (p.link && p.resolved && path.startsWith('node_modules/')) links[path.slice('node_modules/'.length)] = p.resolved;
    if (p.link || !p.resolved) { if (!path.startsWith('node_modules/')) local.push(path); continue; }
    let host = ''; try { host = new URL(p.resolved).host; } catch { host = p.resolved; }
    if (host !== 'registry.npmjs.org') bad.push(`${path.replace('node_modules/', '')} comes from ${host}, not from npm`);
    const own = join(root, path, 'package.json');
    if (!existsSync(own)) { bad.push(`${path.replace('node_modules/', '')} is in the list but not installed`); continue; }
    const pkg = JSON.parse(readFileSync(own, 'utf8'));
    if (pkg.version !== p.version) bad.push(`${pkg.name} is ${pkg.version}, the list says ${p.version}`);
    const hooks = ['preinstall', 'install', 'postinstall'].filter((k) => pkg.scripts?.[k]);
    if (hooks.length) bad.push(`${pkg.name} runs a script when installed (${hooks.join(', ')})`);
  }
  const listed = new Set(Object.keys(lock));
  for (const d of readdirSync(mods)) {
    if (d.startsWith('.')) continue;
    for (const name of d.startsWith('@') ? readdirSync(join(mods, d)).map((s) => `${d}/${s}`) : [d]) if (!listed.has(`node_modules/${name}`)) bad.push(`${name} is installed but not in the list`);
  }
  const total = Object.keys(lock).filter((k) => k.startsWith('node_modules/')).length;
  bad.push(...few(localCopyDiff(root, mods, links), 5));
  const ownCopy = (f) => Object.keys(links).some((name) => f === name || f.startsWith(`${name}/`));
  if (offline) return bad.length ? wrong(`${bad.length} package problem${bad.length > 1 ? 's' : ''}`, few(bad, 8)) : fine(`${total} packages match the list, none runs a script at install (npm not asked: offline)`);

  // Known problems, then a fresh copy from npm (each file checked against the
  // list's fingerprints by npm) compared with what is installed, file by file.
  const audit = await run('npm', ['audit', '--json'], { timeout: 60_000 });
  try { const n = JSON.parse(audit.out).metadata?.vulnerabilities?.total; if (n) bad.push(`${n} known problem${n > 1 ? 's' : ''} in the packages (npm audit)`); else if (n == null) notes.push('npm could not be asked for known problems'); } catch { notes.push('npm could not be asked for known problems'); }
  const tmp = mkdtempSync(join(tmpdir(), 'agentic-check-'));
  try {
    copyFileSync(join(root, 'package.json'), join(tmp, 'package.json'));
    copyFileSync(lockFile, join(tmp, 'package-lock.json'));
    for (const l of local) { mkdirSync(dirname(join(tmp, l)), { recursive: true }); cpSync(join(root, l), join(tmp, l), { recursive: true }); }
    const ci = await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: tmp, timeout: 120_000 });
    if (ci.code !== 0) notes.push('a fresh copy could not be fetched from npm to compare with');
    else {
      const skip = (rel, e) => e.isSymbolicLink() || /(^|\/)(\.bin|\.cache|\.package-lock\.json|\.DS_Store)$/.test(rel);
      const mine = filesUnder(mods, skip), fresh = new Set(filesUnder(join(tmp, 'node_modules'), skip));
      const diff = mine.filter((f) => !ownCopy(f) && (!fresh.has(f) || !readFileSync(join(mods, f)).equals(readFileSync(join(tmp, 'node_modules', f)))));
      const missing = [...fresh].filter((f) => !existsSync(join(mods, f)));
      for (const f of few([...diff, ...missing], 5)) bad.push(`${f} differs from what npm publishes`);
      if (!diff.length && !missing.length) notes.unshift(`${mine.length.toLocaleString()} installed files are the same as a fresh copy from npm`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  if (bad.length) return wrong(`${bad.length} package problem${bad.length > 1 ? 's' : ''}`, few(bad, 8));
  const asked = notes.filter((n) => /could not/.test(n));
  if (asked.length) return look(`${total} packages match the list, none runs a script at install`, asked);
  return fine(`${total} packages from npm: no install scripts, no known problems${notes.length ? ', files same as a fresh copy' : ''}`);
}

function connections({ files }) {
  const places = new Set(), strange = [], wide = [], builds = [];
  for (const f of files) {
    if (!isShipped(f) || !/\.(mjs|js|jsx|html|sh|applescript|json)$/.test(f) || !existsSync(join(root, f))) continue;
    const text = readFileSync(join(root, f), 'utf8');
    hostsIn(text).forEach((h) => places.add(h));
    for (const h of newHosts(text)) strange.push(`${f} names ${h}`);
    if (listensWide(text) && !LISTENS_WIDE_OK.includes(f)) wide.push(`${f} opens a server to the network, not to this Mac only`);
    if (isCode(f) && buildsCode(text) && !BUILDS_CODE_OK.includes(f)) builds.push(`${f} builds code from text while running (eval / new Function)`);
  }
  const bad = [...strange, ...wide, ...builds];
  if (bad.length) return wrong(`${bad.length} thing${bad.length > 1 ? 's' : ''} in how the code connects or runs`, few(bad, 8));
  const out = [...places].filter((h) => !['127.0.0.1', 'localhost', 'host', 'www.w3.org'].includes(h)).sort();
  return fine(`names only this Mac, ${out.join(', ')}; servers open to this Mac only (coding serve opens the model and coding door the sessions on purpose, each behind its key)`);
}

function leftovers({ files }) {
  const unused = unusedFiles(root, files);
  return unused.length ? look(`${unused.length} code file${unused.length > 1 ? 's' : ''} nothing uses`, few(unused, 8)) : fine('every code file of the app is used by something');
}

async function modelFiles({ fast }) {
  const { MODELS, DEFAULT_MODEL, EMBEDDERS, RERANKERS, MODELS_DIR, modelPath, draftPath, readEditedAll } = await import('../../index.mjs');
  const m = MODELS[DEFAULT_MODEL];
  // The default model and its helper, then the small models (the memory's
  // matcher, the search's reranker, which `coding setup` downloads too).
  const want = [[m.name, modelPath(m), m.sha256], ...(m.draft && !m.draft.inFile ? [[`${m.name}'s guessing helper`, draftPath(m), m.draft.sha256]] : []),
    ...[...Object.values(EMBEDDERS), ...Object.values(RERANKERS)].map((x) => [x.name, modelPath(x), x.sha256])];
  const missing = want.filter(([, file]) => !existsSync(file));
  if (!existsSync(want[0][1])) return look('the model is not on this Mac yet (coding setup)');
  // each model may have an edited copy of its own, beside its manifest
  let edited = []; try { edited = Object.values(readEditedAll?.() ?? {}).map((e) => e.file); } catch { /* no edited copy */ }
  // Every file the registry names is one the code uses (the other models in /model too).
  const named = Object.values(MODELS).flatMap((x) => [modelPath(x), x.draft && !x.draft.inFile ? draftPath(x) : null]);
  const known = new Set([...want.map(([, file]) => file), ...named].filter(Boolean).map((file) => file.split('/').pop()).concat([...edited, 'edited.json', ...Object.keys(MODELS).map((id) => `edited-${id}.json`)]));
  const extra = existsSync(MODELS_DIR) ? readdirSync(MODELS_DIR).filter((f) => !f.startsWith('.') && !f.endsWith('.part') && !known.has(f)).map((f) => `${f} (${(statSync(join(MODELS_DIR, f)).size / 1e9).toFixed(2)} GB) is in ${tilde(MODELS_DIR)} but the code does not use it`) : [];
  if (fast) return skipped('not checked (--fast)');
  const bad = [];
  for (const [name, file, sha] of want) if (existsSync(file) && (await sha256(file)) !== sha) bad.push(`${name} is not the file the repo names (${tilde(file)})`);
  if (bad.length) return wrong('a model file is not the real one', bad);
  const notes = [...missing.map(([name]) => `${name} is not on this Mac`), ...edited.map((f) => `${f} is your own edited copy of the weights`), ...extra].filter(Boolean);
  const text = `${want.length - missing.length} model file${want.length - missing.length > 1 ? 's' : ''} match the fingerprints (SHA-256) written in the repo`;
  return extra.length || missing.length ? look(text, notes) : fine(text, notes);
}

// The launcher's own rule for "the code changed since the app was built".
function newerThanApp(app) {
  const since = statSync(app).mtimeMs;
  const kinds = /\.(mjs|js|jsx|json|md|html)$/;
  const skip = (rel, e) => (e.isDirectory() ? /^(node_modules|results|evals|test)$/.test(e.name) : !kinds.test(e.name) || e.name === 'README.md');
  for (const dir of ['terminal/src', 'terminal/rules', 'models']) {
    if (!existsSync(join(root, dir))) continue;
    const hit = filesUnder(join(root, dir), skip).find((f) => statSync(join(root, dir, f)).mtimeMs > since);
    if (hit) return `${dir}/${hit}`;
  }
  // and the two single files: package.json, and the test record (the one file under evals/ the app holds)
  return ['package.json', join('models', 'evals', 'record.mjs')].find((f) => existsSync(join(root, f)) && statSync(join(root, f)).mtimeMs > since) ?? null;
}

async function installedApp() {
  const home = (process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME) ?? join(homedir(), '.agentic-coder');
  const app = join(home, 'app', 'agentic-coder'), launcher = join(homedir(), '.local', 'bin', 'coding');
  if (!existsSync(app) || !existsSync(launcher)) return look('coding is not installed on this Mac (bun run install-cli)');
  const bad = [], notes = [];
  for (const f of [app, launcher]) if (statSync(f).mode & 0o022) bad.push(`${tilde(f)} can be changed by other accounts on this Mac (chmod 755 "${tilde(f)}")`);
  const have = readFileSync(launcher, 'utf8');
  const repo = /^REPO="\$\{AGENTIC_REPO:-\$\{BONSAI_REPO:-(.*)\}\}"$/m.exec(have)?.[1] ?? /^REPO="\$\{BONSAI_REPO:-(.*)\}"$/m.exec(have)?.[1];
  const source = join(root, 'terminal', 'app', 'agentic-coder-launcher.sh');
  if (!repo) bad.push(`${tilde(launcher)} is not Agentic Coder's launcher`);
  else if (resolve(repo) !== resolve(root)) notes.push(`the installed app is built from another folder: ${tilde(repo)}`);
  else if (have !== readFileSync(source, 'utf8').replace('__REPO__', repo)) notes.push('the launcher differs from the repo\'s (bun run install-cli installs the current one)');
  const changed = newerThanApp(app);
  if (changed) notes.push(`the app is older than the code (${changed}); it rebuilds itself at the next start`);
  else if (repo && resolve(repo) === resolve(root)) {
    // The output's name is written into the file, so the fresh build gets the
    // same name; then the two files must be the same, byte for byte.
    const name = /\/\$bunfs\/root\/((?:agentic-coder|bonsai)[A-Za-z0-9._-]*)/.exec(readFileSync(app).toString('latin1'))?.[1] ?? 'agentic-coder';
    const tmp = mkdtempSync(join(tmpdir(), 'agentic-check-'));
    try {
      const bun = existsSync(join(homedir(), '.bun', 'bin', 'bun')) ? join(homedir(), '.bun', 'bin', 'bun') : 'bun';
      const built = await run(bun, ['build', '--compile', '--minify', 'terminal/src/cli.jsx', '--outfile', join(tmp, name)], { timeout: 120_000 });
      if (built.code !== 0) notes.push('the code does not build just now, so the app could not be compared');
      else if (!readFileSync(join(tmp, name)).equals(readFileSync(app))) bad.push('the installed app is not what this code builds (bun run install-cli rebuilds it; a bun update also causes this)');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  if (bad.length) return wrong(bad[0], [...bad.slice(1), ...notes]);
  return notes.length ? look(notes[0], notes.slice(1)) : fine('byte for byte what this code builds; only you can change it');
}

// docs/ holds the pages, which are published, and docs/private/, which is the owner's and
// never in git. Wrong when git tracks a file of docs/ outside the page groups (the index
// and the tools aside), or when a page that is or will be committed holds the home
// folder's path or name (ownerMarks): the repo is public.
async function docsStayPrivate({ files }) {
  const own = (f) => f === 'README.md' || f.startsWith('tools/');
  const tracked = (await git('ls-files', '-z', '--', 'docs')).out.split('\0').filter(Boolean).map((f) => f.slice('docs/'.length));
  const strays = tracked.filter((f) => !published(f) && !own(f));
  const pages = [...new Set(files.filter((f) => f.startsWith('docs/')).map((f) => f.slice('docs/'.length)).filter(published))].filter((f) => existsSync(join(root, 'docs', f)));
  const marked = pages.map((f) => [f, ownerMarks(readFileSync(join(root, 'docs', f), 'latin1'))]).filter(([, m]) => m.length);
  const bad = [...strays.map((f) => `docs/${f}  tracked, but it belongs on this Mac only (git rm --cached -- <file> keeps the file)`), ...marked.map(([f, m]) => `docs/${f}  ${m.join(', ')}`)];
  return bad.length ? wrong(`${bad.length} file${bad.length > 1 ? 's' : ''} in docs/ would show this Mac's private things on GitHub`, few(bad, 8))
    : fine(`${pages.length} pages; nothing of docs/private/ tracked, no home folder path or name in a page`);
}

async function onlyOnThisMac() {
  const trees = (await git('worktree', 'list', '--porcelain')).out.split('\n\n').map((b) => /^worktree (.+)$/m.exec(b)?.[1]).filter((p) => p && resolve(p) !== resolve(root) && existsSync(p));
  const notes = [];
  for (const t of trees) {
    const open = lines((await run('git', ['-C', t, 'status', '--porcelain'])).out).length;
    const ahead = Number((await run('git', ['-C', t, 'rev-list', '--count', 'origin/main..HEAD'])).out) || 0;
    notes.push(open || ahead ? `${tilde(t)}: ${[ahead ? `${ahead} commit${ahead > 1 ? 's' : ''}` : '', open ? `${open} changed file${open > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ')} not on GitHub` : `${tilde(t)}: nothing new in it, can be removed`);
  }
  return notes.length ? look(`${trees.length} other working cop${trees.length > 1 ? 'ies' : 'y'} of the repo on this Mac`, notes) : fine('no other working copies of the repo on this Mac');
}

// The environment the unit tests run in from here: no colours, by NO_COLOR alone. With FORCE_COLOR
// set as well (even to 0), node warns on stderr in every process it starts, and a test that expects
// a command to say nothing there fails: the check's own Unit tests line could never be green.
export function suiteEnv(env = process.env) {
  const out = { ...env, NO_COLOR: '1' };
  delete out.FORCE_COLOR;
  return out;
}
async function unitTests() {
  const r = await run('node', [join(root, 'models', 'evals', 'tools', 'run-suite.mjs')], { timeout: 15 * 60_000, env: suiteEnv() });
  const tail = r.out.slice(-3000);
  const pass = Number(/^\s*(\d+) pass$/m.exec(tail)?.[1] ?? NaN), fail = Number(/^\s*(\d+) fail$/m.exec(tail)?.[1] ?? NaN);
  if (Number.isNaN(pass)) return wrong('the unit tests did not run', lines(r.err || r.out).slice(-3));
  if (fail || r.code !== 0) return wrong(`${fail || 'some'} of ${pass + (fail || 0)} unit tests fail`, lines(r.out).filter((l) => l.startsWith('(fail)')).slice(0, 6));
  // Tests skipped for want of a tool on this Mac (run-suite.mjs): green, and said.
  const skipped = /^\s*skipped for want of a tool: (.+)$/m.exec(tail)?.[1];
  return fine(`${pass} of ${pass} unit tests pass`, skipped ? [`skipped for want of a tool on this Mac: ${skipped}`] : []);
}

// ---- the run ---------------------------------------------------------------------------------
const MARK = { fine: ['✓', 32], look: ['!', 33], wrong: ['✗', 31], skip: ['–', 2] };

export async function check({ fast = false, tests = true, offline = false, say = (s) => process.stdout.write(`${s}\n`), color = process.stdout.isTTY && !process.env.NO_COLOR } = {}) {
  const t0 = Date.now();
  const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const files = (await git('ls-files', '-z', '--cached', '--others', '--exclude-standard')).out.split('\0').filter(Boolean);
  const opts = { files, fast, offline };
  say(`\n${paint(1, 'Agentic Coder check')}  ${paint(2, `${codeLabel(root)} · ${new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`)}\n`);
  // Everything but the unit tests runs at once; the lines come in this order.
  const safe = (name, job) => [name, Promise.resolve().then(() => job(opts)).catch((e) => look('this check could not run', [String(e.message ?? e).slice(0, 200)]))];
  const list = [
    safe('Same as GitHub', sameAsGitHub), safe('Who can read it', whoCanRead), safe('No secrets in the files', secretsInFiles), safe('Only files that belong', filesThatBelong),
    safe('No secrets in the history', history), safe('No server addresses', addresses), safe('Packages', packages), safe('Where the code connects', connections), safe('No leftover code', leftovers),
    safe('The model files', modelFiles), safe('The installed app', installedApp), safe('Private pages stay private', docsStayPrivate), safe('Only on this Mac', onlyOnThisMac),
  ];
  const results = [];
  const show = (name, r) => {
    results.push({ name, ...r });
    say(` ${paint(MARK[r.mark][1], MARK[r.mark][0])} ${name.padEnd(26)} ${r.mark === 'skip' ? paint(2, r.text) : r.text}`);
    for (const m of r.more) say(`   ${' '.repeat(26)} ${paint(2, `· ${m}`)}`);
  };
  for (const [name, job] of list) show(name, await job);
  if (tests && !fast) show('Unit tests', await unitTests().catch((e) => wrong('the unit tests did not run', [String(e.message ?? e)])));
  else show('Unit tests', skipped(`not run (${fast ? '--fast' : '--no-tests'})`));

  const n = (mark) => results.filter((r) => r.mark === mark).length;
  const secs = (Date.now() - t0) / 1000;
  const done = results.length - n('skip');
  say(`\n ${done} checks: ${paint(32, `${n('fine')} fine`)} · ${paint(n('look') ? 33 : 2, `${n('look')} to look at`)} · ${paint(n('wrong') ? 31 : 2, `${n('wrong')} wrong`)}${n('skip') ? paint(2, ` · ${n('skip')} skipped`) : ''}   ${paint(2, `${Math.round(secs)} s`)}\n`);
  return { results, secs, wrong: n('wrong'), look: n('look'), fine: n('fine'), done };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const flags = new Set(process.argv.slice(2));
  const fast = flags.has('--fast');
  const r = await check({ fast, tests: !flags.has('--no-tests'), offline: flags.has('--offline') });
  if (!process.env.CI && !(process.env.AGENTIC_NO_RECORD ?? process.env.BONSAI_NO_RECORD)) {
    recordTest({ kind: 'check', name: `Repo check${fast ? ' (fast)' : ''}`, code: codeLabel(root), passed: r.done - r.wrong, total: r.done, secs: r.secs, result: r.wrong ? 'fail' : 'pass',
      note: [...r.results.filter((x) => x.mark === 'wrong').map((x) => `wrong: ${x.name}`), ...r.results.filter((x) => x.mark === 'look').map((x) => `to look at: ${x.name}`)].join(' · '), raw: '' });
  }
  process.exit(r.wrong ? 1 : 0);
}
