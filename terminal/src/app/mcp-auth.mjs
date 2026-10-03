// Signing in to an MCP server at an address (OAuth, 3 Oct 2026): a browser page opens once, you sign
// in there, and the server's tokens are kept in the Keychain (mcp-<server>-signin: the app's
// registration with that server, and its tokens) and refreshed by themselves after that. The official
// client does the protocol (discovery, registration, PKCE, the code for tokens); this file is what
// it asks the app for, and the round trip through your browser:
//   - a page on this Mac takes the browser back (http://127.0.0.1:<port>/callback; the first free
//     port of SIGNIN_PORTS), and checks the state it was sent with;
//   - the browser is opened with `open` (a test gives its own opener, that follows the redirect);
//   - with nobody there (a hub starting a server, coding -p), nothing opens: the server is marked
//     "sign in needed", and /mcp does it when you ask.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { saveSecret, readSecret, removeKey } from '../../../models/index.mjs';

export const SIGNIN_PORTS = [17690, 17699];
export const SIGNIN_MS = 5 * 60_000;
const secretId = (server) => `${server.keyId}-signin`;

// What is kept for a server: { client, tokens } (JSON in the Keychain). {} when nothing is.
export function readSignin(server) {
  try { const t = readSecret(secretId(server)); return t ? JSON.parse(t) : {}; } catch { return {}; }
}
function writeSignin(server, data) {
  const keep = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  if (!Object.keys(keep).length) { removeKey(secretId(server)); return; }
  saveSecret(JSON.stringify(keep), secretId(server), `Agentic Coder MCP sign-in · ${server.name}`);
}
export const signedIn = (server) => Boolean(readSignin(server).tokens?.access_token);
export const signOut = (server) => removeKey(secretId(server));

// The provider the official client asks (its OAuthClientProvider). redirectUrl: where the browser
// comes back (null: nobody is there to sign in, so a sign-in that is needed is only noted).
export function oauthProvider(server, { redirectUrl = null, onRedirect = null } = {}) {
  let verifier = null;
  let discovery = null;
  let state = null;
  const saved = () => readSignin(server);
  const redirect = redirectUrl ?? `http://127.0.0.1:${SIGNIN_PORTS[0]}/callback`;
  return {
    // With nobody there, still an address (a client registered with one), but no browser opens.
    get redirectUrl() { return redirect; },
    get clientMetadata() {
      return { client_name: 'Agentic Coder', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
    },
    state() { state = randomBytes(16).toString('base64url'); return state; },
    expectedState: () => state,
    // A registration made for another way back (another port) is made again.
    clientInformation() { const c = saved().client; return c && (!Array.isArray(c.redirect_uris) || c.redirect_uris.includes(redirect)) ? c : undefined; },
    saveClientInformation(info) { writeSignin(server, { ...saved(), client: info }); },
    tokens() { return saved().tokens; },
    saveTokens(tokens) { writeSignin(server, { ...saved(), tokens }); },
    redirectToAuthorization(url) {
      if (!onRedirect) throw Object.assign(new Error('it needs you to sign in (/mcp, then s on the server)'), { signin: true });
      return onRedirect(url);
    },
    saveCodeVerifier(v) { verifier = v; },
    codeVerifier() { if (!verifier) throw new Error('the sign-in was not started here'); return verifier; },
    saveDiscoveryState(s) { discovery = s; },
    discoveryState() { return discovery ?? undefined; },
    invalidateCredentials(scope) {
      const s = saved();
      if (scope === 'all') writeSignin(server, {});
      else if (scope === 'client') writeSignin(server, { ...s, client: undefined });
      else if (scope === 'tokens') writeSignin(server, { ...s, tokens: undefined });
      else if (scope === 'verifier') verifier = null;
      else if (scope === 'discovery') discovery = null;
    },
  };
}

const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px -apple-system,sans-serif;padding:40px;max-width:560px"><h2>${title}</h2><p>${text}</p></body>`;

// The way back for the browser: the first free port of SIGNIN_PORTS. → { url, port, code: Promise, close }
async function callbackPage() {
  for (let port = SIGNIN_PORTS[0]; port <= SIGNIN_PORTS[1]; port++) {
    let done;
    const code = new Promise((resolve) => { done = resolve; });
    const server = createServer((req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const ok = Boolean(u.searchParams.get('code'));
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(ok ? page('Signed in', 'You can close this tab and go back to Agentic Coder.') : page('Not signed in', `The service said: ${(u.searchParams.get('error_description') ?? u.searchParams.get('error') ?? 'no code came back').replace(/[<>&]/g, '')}. Go back to Agentic Coder to try again.`));
      done(u.searchParams);
    });
    const up = await new Promise((resolve) => { server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => resolve(true)); });
    if (up) return { port, url: `http://127.0.0.1:${port}/callback`, code, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
  }
  throw new Error(`no free port for the way back (${SIGNIN_PORTS.join('–')})`);
}

export const openInBrowser = (url) => { spawn('open', [url], { stdio: 'ignore', detached: true }).unref(); };

// Sign in to one server: the client's own sign-in (auth) with the browser in the middle.
// open(url): opens the page (the browser). onStep(text): what is happening, for the screen.
// → { ok, already } · { ok: false, error }
export async function signIn(server, { open = openInBrowser, signal, timeoutMs = SIGNIN_MS, onStep = () => {} } = {}) {
  const { auth } = await import('@modelcontextprotocol/client');
  const back = await callbackPage();
  let timer;
  try {
    let opened = false;
    const provider = oauthProvider(server, { redirectUrl: back.url, onRedirect: (url) => { opened = true; onStep('Opened the sign-in page in your browser · waiting for you there (esc stops)'); open(String(url)); } });
    const serverUrl = new URL(server.url);
    const first = await auth(provider, { serverUrl });
    if (first === 'AUTHORIZED') return { ok: true, already: !opened };
    const stop = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer from the browser in ${Math.round(timeoutMs / 60_000)} minutes`)), timeoutMs);
      signal?.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
    });
    const params = await Promise.race([back.code, stop]);
    const code = params.get('code');
    if (!code) return { ok: false, error: `the service did not sign you in: ${params.get('error_description') ?? params.get('error') ?? 'no code came back'}` };
    if (params.get('state') !== provider.expectedState()) return { ok: false, error: 'the page that came back was not the one this sign-in opened (its state did not match)' };
    onStep('Signed in in the browser · getting the tokens…');
    const r = await auth(provider, { serverUrl, authorizationCode: code, iss: params.get('iss') ?? undefined });
    return r === 'AUTHORIZED' ? { ok: true } : { ok: false, error: 'the service asked for another sign-in' };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 240) };
  } finally {
    clearTimeout(timer);
    await back.close();
  }
}
