// What the A/B checks of 30 Sep share (look-check.mjs, habits-check.mjs): the real model through
// `coding -p --yes` in a throwaway home whose engine and model files are links to the ones in
// ~/.agentic-coder, a small shop project to work in, the tool lines `coding -p` prints, and the
// run before this one for its results page.
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { MODELS, HOME, contextCheck, hasDraft } from '../../index.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // the repo
export const CLI = join(ROOT, 'terminal', 'src', 'cli.jsx');
const pad = (n) => String(n).padStart(2, '0');
export const stampOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
export const subOf = (d, code) => `${d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(d.getHours())}:${pad(d.getMinutes())} · ${code}`;
export const short = (s, n = 90) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
// The tool lines `coding -p` prints on stderr ("⏺ Read(cart.mjs)", "✗ …"), without the mark.
export const toolLines = (err) => String(err ?? '').split('\n').filter((l) => /^[⏺✗] /.test(l)).map((l) => l.slice(2));
// The model's own: not what the app read for it before its first step (those end " [app]").
export const ownToolLines = (err) => toolLines(err).filter((t) => !t.endsWith(' [app]'));
// Its notes ("· Looking first: …").
export const noteLines = (err) => String(err ?? '').split('\n').filter((l) => l.startsWith('· ')).map((l) => l.slice(2));

// One big model at a time, and room for this one: a reason to refuse, or null.
export async function refusal(model, ctx) {
  const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
  const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
  if (big.length) return `${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`;
  for (let i = 0; i < 24 && !contextCheck(model, ctx, { draft: hasDraft(model) }).fits; i++) { if (!i) console.log('waiting for memory to free up (up to 2 minutes)…'); await new Promise((r) => setTimeout(r, 5000)); }
  const fit = contextCheck(model, ctx, { draft: hasDraft(model) });
  return fit.fits ? null : fit.note;
}

export const bunPath = () => (process.versions.bun ? process.execPath : [join(process.env.HOME ?? '', '.bun', 'bin', 'bun'), '/opt/homebrew/bin/bun', '/usr/local/bin/bun'].find((p) => existsSync(p)) ?? 'bun');

// A throwaway home: the engine and the models linked from ~/.agentic-coder, and these settings.
export function throwawayHome(dir, settings) {
  mkdirSync(dir, { recursive: true });
  symlinkSync(join(HOME, 'engine'), join(dir, 'engine'));
  symlinkSync(join(HOME, 'models'), join(dir, 'models'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings));
  return dir;
}
export const setSettings = (home, settings) => writeFileSync(join(home, 'settings.json'), JSON.stringify(settings));
export const trust = (home, cwd) => writeFileSync(join(home, 'trust.json'), JSON.stringify({ [cwd]: new Date().toISOString() }));

// The small shop the checks work in: the tax rate and free shipping live in config.mjs, the
// rounding in money.mjs, so a right answer needs more than the first file. A second test file
// leaves a mark when the whole suite runs, so a run of just one file is told apart.
export function makeShop(dir) {
  for (const d of ['src', 'test']) mkdirSync(join(dir, d), { recursive: true });
  const files = {
    'package.json': '{\n  "name": "shop",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
    'src/config.mjs': '// Store settings.\nexport const RATE = 0.0825;\nexport const FREE_SHIPPING = 50;\nexport const SHIPPING = 5.99;\n',
    'src/money.mjs': '// Money is kept in whole cents.\nexport const roundCents = (x) => Math.round(x * 100) / 100;\n',
    'src/cart.mjs': "import { RATE } from './config.mjs';\nimport { roundCents } from './money.mjs';\n\n// The sum of the items' prices.\nexport const total = (items) => items.reduce((s, i) => s + i.price, 0);\n\n// The total with tax.\nexport const withTax = (items) => roundCents(total(items) * (1 + RATE));\n",
    'src/shipping.mjs': "import { FREE_SHIPPING, SHIPPING } from './config.mjs';\n\nexport function shippingFor(amount) {\n  return amount >= FREE_SHIPPING ? 0 : SHIPPING;\n}\n",
    'src/checkout.mjs': "import { total, withTax } from './cart.mjs';\nimport { shippingFor } from './shipping.mjs';\n\nexport function checkout(items) {\n  const sub = total(items);\n  return { subtotal: sub, withTax: withTax(items), shipping: shippingFor(sub) };\n}\n",
    'src/price.mjs': '// A price after a discount in percent.\nexport function applyDiscount(price, percent) {\n  return price - (price * percent) / 100;\n}\n',
    'test/cart.test.mjs': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from '../src/cart.mjs';\n\ntest('total adds the prices', () => {\n  assert.equal(total([{ price: 2 }, { price: 3 }]), 5);\n});\n",
    'test/shipping.test.mjs': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { writeFileSync } from 'node:fs';\nimport { shippingFor } from '../src/shipping.mjs';\n\nwriteFileSync(new URL('../.suite-ran', import.meta.url), 'yes');\ntest('free over the limit', () => {\n  assert.equal(shippingFor(60), 0);\n});\n",
  };
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  const git = (...a) => spawnSync('git', ['-c', 'user.name=check', '-c', 'user.email=check@example.invalid', ...a], { cwd: dir });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'start');
  return dir;
}

// One `coding -p --yes` run: its answer (stdout), its lines (stderr), exit code and seconds.
export function codingP({ cwd, prompt, home, env = {}, args = [], ms = 480_000 }) {
  return new Promise((ok) => {
    const t = Date.now();
    const quiet = { AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1', AGENTIC_HELPERS: 'off', AGENTIC_NO_OPEN: '1', AGENTIC_HOME: home };
    const p = spawn(bunPath(), [CLI, '-p', prompt, '--yes', ...args], { cwd, env: { ...process.env, ...quiet, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = '';
    p.stdout.on('data', (d) => { o += d; });
    p.stderr.on('data', (d) => { e += d; });
    const timer = setTimeout(() => p.kill('SIGTERM'), ms);
    p.on('exit', (code) => { clearTimeout(timer); ok({ code, out: o.trim(), err: e.trim(), secs: (Date.now() - t) / 1000 }); });
  });
}

// The model servers this home started: stopped at the end.
export function stopServers(home) {
  const lines = spawnSync('ps', ['-axwwo', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n');
  for (const l of lines) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(l);
    if (m && /llama-server\s/.test(m[2]) && m[2].includes(home)) { try { process.kill(Number(m[1]), 'SIGTERM'); } catch {} }
  }
}

// The newest finished run before this one, on the same model, for the page's Before.
export function previous(out, prefix, summary) {
  let best = null;
  for (const d of readdirSync(dirname(out))) {
    const dir = join(dirname(out), d);
    if (!d.startsWith(prefix) || dir === out || !existsSync(join(dir, 'summary.json'))) continue;
    try {
      const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
      if (s.stopped || s.model !== summary.model || !(s.finished < summary.finished)) continue;
      if (!best || s.finished > best.s.finished) best = { s, rows: JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')) };
    } catch { /* a folder being written: skipped */ }
  }
  return best;
}
export const rawOf = (dir) => (dir.startsWith(`${ROOT}/`) ? relative(ROOT, dir) : /\/(models\/[^/]+\/results\/.+)$/.exec(dir)?.[1] ?? dir.replace(homedir(), '~'));
