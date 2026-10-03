// `bun run check` (models/evals/tools/check.mjs): what it calls a secret, a
// file that stays out of git, a new place the code connects to, and a code
// file nothing uses. The samples are put together while the test runs, so
// this file holds nothing the check itself would find.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { findSecrets, looksMadeUp, riskyName, hostsIn, newHosts, listensWide, buildsCode, unusedFiles, isShipped, publicAddresses, KNOWN_ADDRESSES, visibility, localCopyDiff, suiteEnv } from '../evals/tools/check.mjs';

const real = 'Zk3vQ9xT7mB2nL5cR8wY1dF6hJ4s';
const what = (text) => findSecrets(text).map((s) => s.what);

test('real-looking keys are found, each with its line; the finding never shows the whole value', () => {
  const token = ['gh', 'p_', real].join('');
  const found = findSecrets(`first line\nconst t = "${token}";\n`);
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ what: 'a GitHub token', line: 2 });
  expect(found[0].show.length).toBeLessThan(token.length);
  expect(what(['s', 'k-', real].join(''))).toEqual(['an API key']);
  expect(what(['h', 'f_', real, real].join(''))).toEqual(['a Hugging Face token']);
  expect(what(['AK', 'IA', 'Q7ZK2M9XW4RT8PLC'].join(''))).toEqual(['an AWS key']);
  expect(what(['-----BEGIN RSA PRIV', 'ATE KEY-----\n', real, real].join(''))).toEqual(['a private key']);
  expect(what(['PROJECT', 'X_API_KEY=1'].join(''))).toEqual(['a broker setting']);
  expect(what(['pass', `word: "${real}"`].join(''))).toEqual(['a password or key written out']);
});

test('a made-up sample in a test is not a secret', () => {
  for (const s of ['abcdefghijklmnopqrstuvwxyz123456', '0123456789abcdef0123456789', 'xxxxxxxxxxxxxxxxxxxxxxxx', 'your-key-goes-here-please', 'short']) expect([s, looksMadeUp(s)]).toEqual([s, true]);
  expect(looksMadeUp(real)).toBe(false);
  expect(what(['s', 'k-', 'abcdefghijklmnopqrstuvwxyz123456'].join(''))).toEqual([]);
  expect(what(['pass', 'word = "${process.env.PASS}"'].join(''))).toEqual([]);
  expect(what('the header of a key, -----BEGIN RSA PRIVATE KEY-----, named in a sentence')).toEqual([]);
  expect(what('plain words about a password and an api key')).toEqual([]);
});

test('files that stay out of git are known by name', () => {
  for (const f of ['.env', 'server/.env.local', 'keys/deploy.pem', 'id_rsa', 'credentials.json', 'models/x.gguf', 'data/app.sqlite', 'backups/old.zip', 'a/.DS_Store', 'history.jsonl']) expect([f, Boolean(riskyName(f))]).toEqual([f, true]);
  for (const f of ['.env.example', 'README.md', 'terminal/src/agent/keys.mjs', 'docs/report.html', 'package.json']) expect([f, riskyName(f)]).toEqual([f, null]);
});

test('a place the code names for the first time is reported; the known ones are not', () => {
  const port = '${port}';
  expect(hostsIn(`fetch(\`http://127.0.0.1:${port}/health\`); see https://GitHub.com/x and https://api.github.com/y.`)).toEqual(['127.0.0.1', 'github.com', 'api.github.com']);
  expect(newHosts('https://huggingface.co/a http://127.0.0.1:1 https://github.com')).toEqual([]);
  expect(newHosts('https://stats.elsewhere.io/collect')).toEqual(['stats.elsewhere.io']);
});

test('a server open to the network, and code built from text, are noticed', () => {
  expect(listensWide("Bun.serve({ hostname: '127.0.0.1', port })")).toBe(false);
  expect(listensWide("['--host', '127.0.0.1', '--port', String(port)]")).toBe(false);
  expect(listensWide("Bun.serve({ hostname: '0.0.0.0', port })")).toBe(true);
  expect(listensWide("['--host', '192.168.1.4']")).toBe(true);
  // node:net with a host named by a variable (the door's Tailscale address) counts; a unix socket or 127.0.0.1 does not.
  expect(listensWide('server.listen(port, host, () => res(server));')).toBe(true);
  expect(listensWide('server.listen(socket, res);')).toBe(false);
  expect(listensWide("s.listen(0, '127.0.0.1', () => {});")).toBe(false);
  expect(buildsCode('const f = new Function("a", body);')).toBe(true);
  expect(buildsCode('const evaluate = (x) => x; evaluate(1);')).toBe(false);
});

test('a code file nothing uses is found; one a script or a test names is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-check-'));
  const put = (parts, text) => { const p = join(dir, ...parts); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); return parts.join('/'); };
  const uses = (name) => ['imp', `ort './${name}';\n`].join('');
  const files = [
    put(['terminal', 'src', 'cli.jsx'], uses('used.mjs')),
    put(['terminal', 'src', 'used.mjs'], uses('deeper')),
    put(['terminal', 'src', 'deeper.mjs'], 'export const a = 1;\n'),
    put(['terminal', 'src', 'stray.mjs'], 'export const b = 2;\n'),
    put(['terminal', 'src', 'tool.mjs'], 'export const c = 3;\n'),
    put(['terminal', 'scripts', 'demo.mjs'], '// runs tool.mjs by hand\n'),
    put(['terminal', 'index.mjs'], 'export const d = 4;\n'),
    put(['models', 'index.mjs'], 'export const e = 5;\n'),
    put(['models', 'evals', 'probe.mjs'], 'export const f = 6;\n'),
  ];
  expect(unusedFiles(dir, files)).toEqual([files[3]]);
  expect(isShipped(files[8])).toBe(false);
});

test('the check finds nothing in its own source or in this test', () => {
  for (const f of [join(import.meta.dir, '..', 'evals', 'tools', 'check.mjs'), import.meta.path]) expect([f, findSecrets(readFileSync(f, 'utf8'))]).toEqual([f, []]);
});

// The addresses are put together here, so this file holds none the check would find.
const ip = (...parts) => parts.join('.');
test("a server's public address is found, with its port; this Mac, the home network, Tailscale and made-up ranges are not", () => {
  const real = ip(134, 199, 192, 90), other = ip(52, 14, 9, 3);
  expect(publicAddresses(`your real one (${real}:60009) still cut every request`)).toEqual([`${real}:60009`]);
  expect(publicAddresses(`Model: coder on http://${real}:60009, 256k context`)).toEqual([`${real}:60009`]);
  expect(publicAddresses(`ssh root@${other}\nthen again ${other}`)).toEqual([other]); // once, however often it is written
  for (const fine of [ip(127, 0, 0, 1), ip(10, 0, 0, 5), ip(172, 16, 4, 1), ip(172, 31, 255, 1), ip(192, 168, 1, 40), ip(169, 254, 1, 1), ip(100, 77, 240, 86), ip(0, 0, 0, 0), ip(255, 255, 255, 0), ip(192, 0, 2, 7), ip(198, 51, 100, 7), ip(203, 0, 113, 7)]) {
    expect([fine, publicAddresses(`the door listens on ${fine}:7790, also http://${fine}/x`)]).toEqual([fine, []]);
  }
  // just outside the kept ranges: found (172.32, 100.128 are test samples, so they are tried under other numbers)
  expect(publicAddresses(`${ip(172, 33, 0, 1)} and ${ip(100, 129, 0, 1)}`)).toEqual([ip(172, 33, 0, 1), ip(100, 129, 0, 1)]);
});

test('numbers that only look like an address are left alone: a version, a drawing, a longer number; a known sample is listed on purpose', () => {
  const v = ip(120, 0, 0, 0);
  expect(publicAddresses(`Mozilla/5.0 Chrome/${v} Safari/537.36`)).toEqual([]);
  expect(publicAddresses(`package v${ip(11, 2, 3, 4)} and tool-${ip(11, 2, 3, 4)}`)).toEqual([]);
  expect(publicAddresses(`<path d="M${ip(12, 5, 3, 2)} 0 ${ip(11, 5, 5, 5)}z" transform="matrix(${ip(11, 5, 5, 5)})"/>`)).toEqual([]);
  expect(publicAddresses(`${ip(11, 2, 3, 4)}.5 and 9${ip(11, 2, 3, 4)}`)).toEqual([]); // five parts, or the tail of a longer number
  expect(publicAddresses(ip(300, 2, 3, 4))).toEqual([]); // not an address at all
  for (const k of KNOWN_ADDRESSES) expect([k, publicAddresses(`the server at ${k} answers`)]).toEqual([k, []]);
  expect(publicAddresses(`the server at ${ip(11, 2, 3, 4)} answers`, [ip(11, 2, 3, 4)])).toEqual([]); // a list of one's own
});

test('a public repo is fine while the repo says it is public on purpose, and a private one is then named; with no such line, public is wrong', () => {
  expect(visibility(200, 'me/repo', '28 Sep 2026')).toMatchObject({ mark: 'fine', text: 'me/repo is public, on purpose (since 28 Sep 2026): anyone can read it' });
  expect(visibility(404, 'me/repo', '28 Sep 2026').mark).toBe('look');
  expect(visibility(404, 'me/repo', '28 Sep 2026').text).toContain('private now');
  expect(visibility(200, 'me/repo', null)).toMatchObject({ mark: 'wrong', text: 'me/repo is PUBLIC: anyone can read it' });
  expect(visibility(404, 'me/repo', null).mark).toBe('fine');
  expect(visibility(503, 'me/repo', '28 Sep 2026').mark).toBe('look');
});

test("a package the repo holds itself, installed as a copy, is compared with the repo's own folder: the same is fine, a change is named", () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-check-own-'));
  const put = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
  put('shims/stand-in/index.js', 'export default {};\n');
  put('shims/stand-in/package.json', '{"name":"stand-in"}\n');
  put('node_modules/stand-in/index.js', 'export default {};\n');
  put('node_modules/stand-in/package.json', '{"name":"stand-in"}\n');
  const links = { 'stand-in': 'shims/stand-in' };
  expect(localCopyDiff(dir, join(dir, 'node_modules'), links)).toEqual([]);
  put('node_modules/stand-in/index.js', 'export default { changed: true };\n');
  put('node_modules/stand-in/extra.js', '// not in the repo\n');
  expect(localCopyDiff(dir, join(dir, 'node_modules'), links).sort()).toEqual(["stand-in/extra.js differs from the repo's own copy (shims/stand-in)", "stand-in/index.js differs from the repo's own copy (shims/stand-in)"]);
  put('shims/stand-in/more.js', '// only in the repo\n');
  expect(localCopyDiff(dir, join(dir, 'node_modules'), links)).toContain("stand-in/more.js is in the repo's own copy (shims/stand-in) but not installed");
  expect(localCopyDiff(dir, join(dir, 'node_modules'), { gone: 'shims/gone' })).toEqual([]); // not installed as a copy: npm's link is checked by npm
});

test('the check runs the unit tests with colours off by NO_COLOR alone, never with FORCE_COLOR beside it (node then warns on stderr in a command a test expects to be quiet)', () => {
  expect(suiteEnv({ PATH: '/bin', FORCE_COLOR: '3', OTHER: 'kept' })).toEqual({ PATH: '/bin', NO_COLOR: '1', OTHER: 'kept' });
  expect(suiteEnv({ FORCE_COLOR: '0' })).toEqual({ NO_COLOR: '1' });
  expect(suiteEnv({})).toEqual({ NO_COLOR: '1' });
});

