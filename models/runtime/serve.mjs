// `coding serve`: this machine's model for another machine's /remote. It starts
// llama-server behind an API key, on this machine's Tailscale address and this machine
// itself (none of the home network's: --host 0.0.0.0 opens it there on purpose; --local:
// this machine only, for an SSH tunnel), and prints what to type into /remote over
// there. It runs until ctrl+c; the model stops with it.
import net from 'node:net';
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

// Where it listens (18 Nov 2026, the audit: it was every address, over http, with the key printed at each start).
// llama-server takes one address, and this machine's own checks reach it at 127.0.0.1, so it listens there and
// each other address passes its connections on to it (relayTo). Answers { llama, relays, wide }:
//   --local                   127.0.0.1 only
//   no --host                 127.0.0.1 + this machine's Tailscale address, when Tailscale is on
//   --host 0.0.0.0 (or ::)    every address, as before 18 Nov 2026: on purpose, with a warning
//   --host <an address>       127.0.0.1 + that address
export function serveHosts({ local = false, host = null, ifaces } = {}) {
  if (local || host === '127.0.0.1' || host === 'localhost') return { llama: '127.0.0.1', relays: [], wide: false };
  if (host === '0.0.0.0' || host === '::') return { llama: host, relays: [], wide: true };
  if (host) return { llama: '127.0.0.1', relays: [host], wide: false };
  const ts = lanAddresses(ifaces).find((a) => a.where === 'Tailscale')?.address;
  return { llama: '127.0.0.1', relays: ts ? [ts] : [], wide: false };
}
// An address that passes every connection on to the model server at 127.0.0.1:port, byte for byte (https too: the
// certificate is the server's own). Answers the listener.
export function relayTo(address, port) {
  const server = net.createServer((c) => {
    const up = net.connect({ host: '127.0.0.1', port });
    c.pipe(up).pipe(c);
    c.on('error', () => up.destroy());
    up.on('error', () => c.destroy());
  });
  return new Promise((res, rej) => { server.once('error', rej); server.listen({ host: address, port }, () => res(server)); });
}

// What `coding serve` adds to the model server: where it listens, the key, https.
export function serveArgs({ local = false, host = null, keyFile = SERVE_KEY_FILE, cert = null, certKey = null } = {}) {
  return {
    host: serveHosts({ local, host, ifaces: {} }).llama,
    keyFile,
    https: Boolean(cert),
    args: ['--api-key-file', keyFile, ...(cert ? ['--ssl-cert-file', cert, '--ssl-key-file', certKey] : [])],
  };
}

// Starts it and prints the form's values. say(text) prints a line. Answers
// { server, key, port, stop() }; the caller keeps the process alive.
// host: where it listens (serveHosts; AGENTIC_SERVE_HOST, until `coding serve` takes --host); showKey: the key printed
// although it was made before.
export async function serve({ modelId = DEFAULT_MODEL, port = SERVE_PORT, local = false, host = process.env.AGENTIC_SERVE_HOST || null, ctx = null, cert = null, certKey = null, newKey = false, showKey = false, ifaces, say = (t) => process.stdout.write(`${t}\n`) } = {}) {
  const base = MODELS[modelId];
  if (!base) throw new Error(`no model called ${modelId}; there are ${Object.keys(MODELS).join(', ')}`);
  // Another machine's /remote may attach a picture at any time, so a served model
  // loads its vision add-on whenever that file is here (coding setup gets it).
  const model = base.vision && existsSync(visionPath(base)) ? withVision(base) : base;
  if (cert && !(existsSync(cert) && certKey && existsSync(certKey))) throw new Error('--https needs a certificate file and its key file that exist (coding serve --https cert.pem key.pem)');
  const { key, made } = serveKey({ fresh: newKey });
  const c = ctx ? { ctx, reason: null } : chooseContext(model);
  const plan = serveHosts({ local, host, ifaces });
  const listen = { ...serveArgs({ local, host: plan.llama, cert, certKey }), port };
  say(`Loading ${model.name} (${Math.round(c.ctx / 1024)}k context${hasDraft(model) ? ', speed helper on' : ''})…`);
  if (c.reason) say(`· ${c.reason}`);
  const server = new ModelServer(model);
  const st = await server.start({ ctx: c.ctx, listen, share: false });
  const relays = [];
  try { for (const a of plan.relays) relays.push(await relayTo(a, port)); } catch (e) { for (const r of relays) r.close(); await server.stop(); throw new Error(`could not listen on ${plan.relays.join(', ')}:${port} (${e.message})`); }
  const pad = (s) => s.padEnd(10);
  say('');
  say(`Serving ${model.name} for /remote on another machine · ${st.slots} slot${st.slots === 1 ? '' : 's'} · ${Math.round(c.ctx / 1024)}k context · ${model.visionOn ? 'it can look at pictures' : 'no pictures (coding setup gets its vision add-on)'}`);
  say('');
  say('Type this into /remote over there:');
  say(`  ${pad('Run on')}My other computer`);
  if (local || (!plan.wide && !plan.relays.length)) {
    say(`  ${pad('Address')}${process.env.USER ?? 'you'}@${hostname()}   (or this machine's name in ~/.ssh/config)`);
    say(`  ${pad('Reach by')}SSH tunnel`);
  } else if (plan.wide) {
    const addrs = lanAddresses(ifaces);
    if (!addrs.length) say(`  ${pad('Address')}${hostname()}   (no network address found: is Wi-Fi on?)`);
    addrs.forEach((a, i) => say(`  ${pad(i ? '' : 'Address')}${a.address.padEnd(17)}${a.where}`));
    say(`  ${pad('Reach by')}${cert ? 'Internet (https)' : 'Home network (http)   (an SSH tunnel works too: coding serve --local)'}`);
  } else {
    const where = Object.fromEntries(lanAddresses(ifaces).map((a) => [a.address, a.where]));
    plan.relays.forEach((a, i) => say(`  ${pad(i ? '' : 'Address')}${a.padEnd(17)}${where[a] ?? 'the address asked for'}`));
    say(`  ${pad('Reach by')}${cert ? 'https' : where[plan.relays[0]] === 'Tailscale' ? 'Tailscale (http)' : 'Home network (http)'}`);
  }
  // The key is printed when it is made (and with --key), not at every start: a start in a shared or recorded
  // Terminal showed it each time (18 Nov 2026).
  if (made || showKey) say(`  ${pad('API key')}${key}`);
  else say(`  ${pad('API key')}the first line of ${SERVE_KEY_FILE.replace(process.env.HOME ?? '', '~')} (made before; unchanged)`);
  if (port !== SERVE_PORT) say(`  ${pad('Port')}${port}   (behind More)`);
  say('');
  say(`The key ${made ? 'was made now and ' : ''}is kept in ${SERVE_KEY_FILE.replace(process.env.HOME ?? '', '~')} (coding serve --new-key makes another).`);
  if (!local && !plan.relays.length && !plan.wide) say('Tailscale is not on here, so only this machine (and an SSH tunnel) can reach it. Turn Tailscale on and start it again, or open it to every network on purpose: coding serve --host 0.0.0.0');
  if (plan.relays.length) say('The first time, macOS may ask whether Agentic Coder may accept incoming connections: allow it.');
  if (plan.wide) say('The first time, macOS may ask whether llama-server may accept incoming connections: allow it.');
  if (plan.wide) say('! Open on every network this machine is on, not only Tailscale (asked for with 0.0.0.0): anyone there can try the key.');
  if (plan.wide && !cert) say('Plain http is for a home network or Tailscale. Across the internet, use --https cert.pem key.pem or --local with an SSH tunnel.');
  say('ctrl+c stops it.');
  return { server, key, port, listen: plan, stop: async () => { for (const r of relays) r.close(); await server.stop(); } };
}
