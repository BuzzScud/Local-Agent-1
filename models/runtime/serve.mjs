// `coding serve`: this machine's model for another machine's /remote. It starts
// llama-server open to the network (or to this machine only, for an SSH
// tunnel: --local) behind an API key, and prints what to type into /remote
// over there. It runs until ctrl+c; the model stops with it.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { networkInterfaces, hostname } from 'node:os';
import { join } from 'node:path';
import { HOME, MODELS, DEFAULT_MODEL, withVision, visionPath } from '../registry.mjs';
import { ModelServer, hasDraft } from './server.mjs';
import { chooseContext } from './memory.mjs';
import { SERVE_PORT } from './remote.mjs';

// The key the server asks for, one line, readable by you only. Made once and
// kept, so /remote on the other machine keeps working after a restart.
export const SERVE_KEY_FILE = join(HOME, 'serve.key');
export function serveKey({ fresh = false, file = SERVE_KEY_FILE } = {}) {
  if (!fresh && existsSync(file)) {
    const k = readFileSync(file, 'utf8').split('\n')[0].trim();
    if (k) return { key: k, made: false };
  }
  const key = `ac-${randomBytes(24).toString('base64url')}`;
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return { key, made: true };
}

// The addresses another machine can reach this one at: the home network's,
// and Tailscale's (100.64.0.0/10) when it is on.
export function lanAddresses(ifaces = networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list ?? []) {
      if (a.internal || a.family !== 'IPv4' && a.family !== 4) continue;
      const [x, y] = a.address.split('.').map(Number);
      const tailscale = x === 100 && y >= 64 && y <= 127;
      if (x === 169 && y === 254) continue; // a link-local address nobody else uses
      out.push({ address: a.address, where: tailscale ? 'Tailscale' : `${name}, this network` });
    }
  }
  return out.sort((a, b) => Number(a.where === 'Tailscale') - Number(b.where === 'Tailscale'));
}

// What `coding serve` adds to the model server: where it listens, the key, https.
export function serveArgs({ local = false, keyFile = SERVE_KEY_FILE, cert = null, certKey = null } = {}) {
  return {
    host: local ? '127.0.0.1' : '0.0.0.0',
    keyFile,
    https: Boolean(cert),
    args: ['--api-key-file', keyFile, ...(cert ? ['--ssl-cert-file', cert, '--ssl-key-file', certKey] : [])],
  };
}

// Starts it and prints the form's values. say(text) prints a line. Answers
// { server, key, port, stop() }; the caller keeps the process alive.
export async function serve({ modelId = DEFAULT_MODEL, port = SERVE_PORT, local = false, ctx = null, cert = null, certKey = null, newKey = false, say = (t) => process.stdout.write(`${t}\n`) } = {}) {
  const base = MODELS[modelId];
  if (!base) throw new Error(`no model called ${modelId}; there are ${Object.keys(MODELS).join(', ')}`);
  // Another machine's /remote may attach a picture at any time, so a served model
  // loads its vision add-on whenever that file is here (coding setup gets it).
  const model = base.vision && existsSync(visionPath(base)) ? withVision(base) : base;
  if (cert && !(existsSync(cert) && certKey && existsSync(certKey))) throw new Error('--https needs a certificate file and its key file that exist (coding serve --https cert.pem key.pem)');
  const { key, made } = serveKey({ fresh: newKey });
  const c = ctx ? { ctx, reason: null } : chooseContext(model);
  const listen = { ...serveArgs({ local, cert, certKey }), port };
  say(`Loading ${model.name} (${Math.round(c.ctx / 1024)}k context${hasDraft(model) ? ', speed helper on' : ''})…`);
  if (c.reason) say(`· ${c.reason}`);
  const server = new ModelServer(model);
  const st = await server.start({ ctx: c.ctx, listen, share: false });
  const scheme = cert ? 'https' : 'http';
  const pad = (s) => s.padEnd(10);
  say('');
  say(`Serving ${model.name} for /remote on another machine · ${st.slots} slot${st.slots === 1 ? '' : 's'} · ${Math.round(c.ctx / 1024)}k context · ${model.visionOn ? 'it can look at pictures' : 'no pictures (coding setup gets its vision add-on)'}`);
  say('');
  say('Type this into /remote over there:');
  say(`  ${pad('Run on')}My other computer`);
  if (local) {
    say(`  ${pad('Address')}${process.env.USER ?? 'you'}@${hostname()}   (or this machine's name in ~/.ssh/config)`);
    say(`  ${pad('Reach by')}SSH tunnel`);
  } else {
    const addrs = lanAddresses();
    if (!addrs.length) say(`  ${pad('Address')}${hostname()}   (no network address found: is Wi-Fi on?)`);
    addrs.forEach((a, i) => say(`  ${pad(i ? '' : 'Address')}${a.address.padEnd(17)}${a.where}`));
    say(`  ${pad('Reach by')}${cert ? 'Internet (https)' : 'Home network (http)   (an SSH tunnel works too: coding serve --local)'}`);
  }
  say(`  ${pad('API key')}${key}`);
  if (port !== SERVE_PORT) say(`  ${pad('Port')}${port}   (behind More)`);
  say('');
  say(`The key ${made ? 'was made now and ' : ''}is kept in ${SERVE_KEY_FILE.replace(process.env.HOME ?? '', '~')} (coding serve --new-key makes another).`);
  if (!local) say('The first time, macOS may ask whether llama-server may accept incoming connections: allow it.');
  if (!local && !cert) say('Plain http is for a home network or Tailscale. Across the internet, use --https cert.pem key.pem or --local with an SSH tunnel.');
  say('ctrl+c stops it.');
  return { server, key, port, stop: () => server.stop() };
}
