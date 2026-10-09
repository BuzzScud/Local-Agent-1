// The window's panels, the machine: memory, the service's models, saving the session (app-panels.mjs puts the parts together).
// Moved from app-panels.mjs word for word; a name from another part is read through own.
import { preloadOllama, endpointOf, macMemory, ollamaPs, OPEN_KEEP, OPEN_KEEP_MS } from '../../../models/index.mjs';
import { saveSession } from './store.mjs';

export function panelsMachine(self, own) {
  const readMacMemory = () => {
    if (!self.opts.macMem) return;
    const id = setInterval(() => {
      // On a remote the footer shows the service instead (remote-footer.mjs): nothing to read here.
      if (self.remoteRef.current.on) return;
      const m = macMemory();
      if (!m) return;
      const prev = self.macRef.current;
      self.macRef.current = m;
      if (!prev || prev.level !== m.level) self.redrawMac((n) => n + 1);
    }, Number(process.env.AGENTIC_MAC_EVERY) || 5000); // ms; the tests read it faster
    return () => clearInterval(id);
  };
  const readServicePs = () => {
    self.psRef.current = null;
    if (!self.psConn) return;
    const name = self.model.remote.model;
    let on = true;
    const read = async () => {
      const p = await ollamaPs({ url: self.psConn.url, model: name }).catch(() => null);
      if (!on) return;
      const prev = self.psRef.current;
      self.psRef.current = p;
      const spill = (x) => (x?.loaded ? (x.gpuPct ?? 100) < 100 : null);
      if (!prev || spill(prev) !== spill(p) || Boolean(prev.loaded) !== Boolean(p?.loaded)) self.redrawPs((n) => n + 1);
      // Keep loaded "while open": with less than two thirds of OPEN_KEEP left, the model is kept
      // another OPEN_KEEP (an empty request at the context the replies use, so nothing loads again),
      // and so is one kept for ever (keep_alive -1, an older version's). One the service already let
      // go of is not loaded back from here: the next reply does that.
      // Only while the window is still on this service: a look already under way as it went back to
      // this Mac (leaveService) would load the model it has just let go.
      const ep = endpointOf(self.psConn.url);
      const left = p?.loaded && p.until ? Date.parse(p.until) - Date.now() : NaN;
      if (self.remoteRef.current.conn === self.psConn && ep?.keepAlive === OPEN_KEEP && (left < OPEN_KEEP_MS * 2 / 3 || left > 24 * 3600_000)) {
        self.renewRef.current = preloadOllama({ url: self.psConn.url, model: name, numCtx: ep.numCtx ?? null, keepAlive: OPEN_KEEP, timeoutMs: 10_000 }).catch(() => {}).finally(() => { self.renewRef.current = null; });
      }
    };
    read();
    const id = setInterval(read, Number(process.env.AGENTIC_PS_EVERY) || 30_000); // ms; the tests read it faster
    return () => { on = false; clearInterval(id); };
  };

  const saveNowFn = () => {
    const s = self.sessionRef.current;
    if (!s.title) return;
    // lessons: what happened in each turn, for the memory's review at night.
    const slimImages = (m) => (m.images ? { ...m, images: m.images.map(({ data, ...rest }) => rest) } : m);
    try { saveSession(self.cwd, s.id, { title: s.title, messages: self.agent.messages.map(slimImages), items: s.items.slice(-300), mode: self.agent.mode, lessons: self.agent.lessons, open: s.open ?? [] }); } catch {}
  };
  return { readMacMemory, readServicePs, saveNowFn };
}
