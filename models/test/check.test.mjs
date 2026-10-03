// `bun run check` (models/evals/tools/check.mjs): what it calls a secret, a
// file that stays out of git, a new place the code connects to, and a code
// file nothing uses. The samples are put together while the test runs, so
// this file holds nothing the check itself would find.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { findSecrets, looksMadeUp, riskyName, hostsIn, newHosts, listensWide, buildsCode, unusedFiles, isShipped } from '../evals/tools/check.mjs';

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
