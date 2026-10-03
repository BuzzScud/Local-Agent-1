// The remote models in the Arena (3 Oct 2026, the owner's ask: "when /remote is connected, allow the
// remote models to participate in the arena"). While Agentic Coder is connected to a service with
// /remote (settings.json "remote", its `use` on), that service's models join the Arena's Who list
// beside the models on this Mac: a test on one of them alone, or a battle with any other.
//   An Ollama service         every model it has that can chat and call tools (its helpers left out)
//   The Claude API            the four Claude models /remote offers
//   Another service, or My other computer: the model /remote is set to
// An entrant's id is `remote:<service>:<the name the service knows it by>` (remote:openai:qwen3-coder-next:latest).
// The list is read in the background and kept 3 minutes (the page asks every second); a service that
// does not answer gives its last list (the hub's Remote tab keeps one, remote-seen/), or the one model in use.
// A run (run-one.mjs) connects the way the app does (connectRemote), nothing loads on this Mac, and a
// model that was cold on an Ollama service is let go of again when its run ends.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, CLAUDE_MODELS, claudeName, sourceOf, keyIdOf, readKey, remoteLabel, directUrl, openTunnel, SERVE_PORT, ollamaCatalog, connectRemote, preloadOllama, unloadOllama, endpointOf, setEndpoint, modelFetch } from '../../index.mjs';
import { loadSettings, readyRemote } from '../../../terminal/index.mjs';

const KEEP_MS = 3 * 60_000;
// The longest a run waits for the service to load its model (the runner's own guard allows 15 more).
const LOAD_MINS = Number(process.env.AGENTIC_ARENA_LOAD_MINS ?? 12);
export const isRemoteId = (id) => /^remote:(claude|machine|openai):./.test(String(id ?? ''));
const remoteIdOf = (source, model) => `remote:${source}:${model}`;
// { source, model } of an entrant's id, or null.
export function parseRemoteId(id) {
  const m = /^remote:(claude|machine|openai):(.+)$/.exec(String(id ?? ''));
  return m ? { source: m[1], model: m[2] } : null;
}

// The service /remote is connected to now: its saved profile, or null (none, or not ready to use).
export function connectedRemote(settings = loadSettings()) {
  const r = settings?.remote;
  return r?.use && readyRemote(r) ? { ...r, source: sourceOf(r) } : null;
}

// The names the service's models go by in the Arena: "Opus 5.5" for Claude, else the service's own name.
const nameOf = (source, model) => (source === 'claude' ? claudeName(model) : model);
// Its tag stays (a service has qwen2.5-coder:32b and :14b, laguna-xs-2.1 at three precisions); only :latest goes.
const shortOf = (source, model) => (source === 'claude' ? claudeName(model).split(' ')[0] : String(model).split('/').pop().replace(/:latest$/, ''));
const entrant = (r, model) => ({ id: remoteIdOf(r.source, model), name: `${nameOf(r.source, model)} · ${remoteLabel(r)}`, short: shortOf(r.source, model), remote: true, here: true });

// An Ollama service's models that can do a test: chat and call tools, no embedders, nothing under 1B.
const usable = (m) => m.chat !== false && m.tools !== false && !m.embedding && !/^\d+(\.\d+)?M$/i.test(String(m.params ?? '').trim());
async function readCatalog(r) {
  const key = r.key ? readKey(keyIdOf(r)) : null;
  let tunnel = null;
  try {
    const url = r.connect === 'ssh' ? (tunnel = await openTunnel({ dest: r.address.trim(), remotePort: r.port ?? SERVE_PORT })).url : directUrl(r);
    return await ollamaCatalog({ url, key, timeoutMs: 10_000 });
  } finally { tunnel?.stop(); }
}
const seenList = (source) => { try { return JSON.parse(readFileSync(join(HOME, 'remote-seen', `${source}.json`), 'utf8')); } catch { return null; } };

let kept = { sig: null, at: 0, models: [], reading: false };
// The entrants now: [{ id, name, short, remote: true, here: true }], [] when /remote is not connected.
// Never waits: a list older than 3 minutes is read again in the background.
export function remoteEntrants() {
  let r;
  try { r = connectedRemote(); } catch { r = null; }
  if (!r) return [];
  const sig = JSON.stringify([r.source, r.address, r.port, r.connect, r.kind, r.model]);
  const inUse = r.model ? [r.model] : [];
  if (r.source === 'claude') return [...new Set([...inUse, ...CLAUDE_MODELS.map((m) => m.id)])].map((m) => entrant(r, m));
  if (r.kind !== 'openai') return [entrant(r, r.model || 'its model')];
  if (kept.sig !== sig) {
    // A service not read yet: its last list from the hub's Remote tab, until this one is in.
    const seen = seenList(r.source);
    kept = { sig, at: 0, models: Array.isArray(seen?.models) ? seen.models.filter(usable).map((m) => m.id) : [], reading: false };
  }
  if (!kept.reading && Date.now() - kept.at > KEEP_MS) {
    kept.reading = true;
    const mine = kept;
    readCatalog(r).then((cat) => { if (cat && kept === mine) mine.models = cat.models.filter(usable).map((m) => m.id); })
      .catch(() => {}).finally(() => { mine.at = Date.now(); mine.reading = false; });
  }
  return [...new Set([...inUse, ...kept.models])].map((m) => entrant(r, m));
}

// A run's connection to an entrant: { conn, name, done() }. Throws, in plain words, when /remote is no
// longer connected to that service. On an Ollama service a cold model is loaded first (so the run's clock
// starts once it is up, as on this Mac) at the context `ctx` when given, and let go of by done().
export async function connectEntrant(id, { ctx = null, onLoading = () => {} } = {}) {
  const want = parseRemoteId(id);
  if (!want) throw new Error(`not a remote model: ${id}`);
  const r = connectedRemote();
  if (!r || r.source !== want.source) throw new Error(`${nameOf(want.source, want.model)} is on a service /remote is not connected to now: connect it again with /remote, then run this test again`);
  const conn = await connectRemote({ ...r, model: r.source === 'machine' ? r.model : want.model });
  const ep = endpointOf(conn.url);
  let cold = false;
  if (ep?.ollama) {
    if (ctx && ctx !== ep.numCtx) setEndpoint(conn.url, { ...ep, numCtx: ctx });
    cold = !conn.info.ollama?.loaded;
    if (cold) {
      // A model this run loads is kept 15 minutes past its last request, not for good (the app's -1): a run
      // killed part way (Stop while it loads) never leaves it filling the service. done() lets go of it at once.
      setEndpoint(conn.url, { ...endpointOf(conn.url), keepAlive: '15m' });
      // The models loaded there now. Where the new one does not fit beside them, the service waits until they are
      // idle, then puts them aside (3 Oct 2026, the real service: Qwen3.6 in use filled its 23 GB, and llama3.2:3b
      // waited behind it): the run says so, and stops after LOAD_MINS with that reason, never loading in silence.
      let others = [];
      try { others = ((await (await modelFetch(conn.url, '/api/ps', { signal: AbortSignal.timeout(5000) })).json())?.models ?? []).map((m) => m.name).filter((n) => n !== want.model); } catch {}
      const them = others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others.at(-1)} are` : `${others[0]} is`;
      onLoading(`loading ${want.model} on the service${others.length ? ` · ${them} loaded there too: if both do not fit, the service waits until ${others.length > 1 ? 'they are' : 'it is'} idle, then puts ${others.length > 1 ? 'them' : 'it'} aside` : ''}`);
      try { await preloadOllama({ url: conn.url, key: ep.key, model: conn.info.model ?? want.model, numCtx: ctx ?? ep.numCtx, keepAlive: '15m', timeoutMs: LOAD_MINS * 60_000 }); } catch (e) {
        conn.stop();
        const late = e?.name === 'TimeoutError' || /timed? ?out|aborted/i.test(e?.message ?? '');
        throw new Error(late ? `${want.model} did not load on the service in ${LOAD_MINS} minutes${others.length ? `: ${them} loaded there, likely busy, with no room for both` : ''}` : `${want.model} did not load on the service: ${e.message}`);
      }
    }
  }
  return {
    conn, name: conn.model.name,
    // A model this run loaded is let go of, unless it is the one /remote uses (a window may be on it).
    done: async () => {
      if (cold && conn.info.model !== connectedRemote()?.model) await unloadOllama({ url: conn.url, key: ep.key, model: conn.info.model }).catch(() => {});
      conn.stop();
    },
  };
}
