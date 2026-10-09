// The window's panels, The helpers: /subagents jobs, the profiles, what the service offers (app-panels.mjs puts the parts together).
// Moved from app-panels.mjs word for word; a name from another part is read through own.
import { DEFAULT_REMOTE } from '../../../models/index.mjs';
import { jobsOf, MAIN } from './subagents.mjs';
import { serverOf } from './profiles.mjs';
import { RemoteEmbedder } from '../agent/helper-models.mjs';
import { serviceKey, readTryouts } from './tryouts.mjs';
import { saveSettings } from './store.mjs';

export function panelsHelpers(self, own) {
  // The /subagents jobs as saved (settings.json `helperModels`, by service address): today's helpers, and
  // the first profiles when there is no profiles.json yet (/profiles shows and sets them since 8 Oct 2026).
  const subagentsKey = () => serviceKey(self.settings.remote?.address ?? '');
  // The jobs the agent works with (helper-models.mjs): each with the service's entry for its
  // model, and the code search's embedder from the service when that job is on.
  const applyHelpers = (c = self.catalog) => {
    const conn = self.remoteRef.current.conn;
    if (!(self.model.remote?.ollama && conn?.info?.ollama && c?.models?.length)) { self.agent.helperJobs = null; self.agent.searchEmbedder = null; return; }
    const jobs = jobsOf(self.settings.helperModels?.[subagentsKey()] ?? {}, c.models, self.model.remote.model);
    self.agent.helperJobs = Object.fromEntries(jobs.map((j) => [j.id, { on: j.on, model: j.model, entry: c.models.find((m) => m.id === j.model) ?? null }]));
    // Profiles saved (/profiles): they decide the helpers and the code search's model (app-profiles.mjs).
    self.agent.router?.setCatalog(serverOf(self.settings.remote), c.models);
    if (self.agent.router?.active()) { self.applyProfiles(); return; }
    const search = self.agent.helperJobs.search;
    const want = search?.on && search.model && search.model !== MAIN ? `${conn.url}|${search.model}` : null;
    if (!want) self.agent.searchEmbedder = null;
    else if (self.agent.searchEmbedder?.key !== want) { self.agent.searchEmbedder = new RemoteEmbedder({ url: conn.url, model: search.model }); self.agent.searchEmbedder.key = want; }
  };
  // What the service's /model draws from: what was set as it opened, and what moves (the list, the chat).
  const serviceOf = (pk) => ({ ...pk.sv, catalog: self.catalog, version: self.catalog?.version ?? self.model.remote?.ollama ?? null, inUse: self.model.remote?.model ?? null, used: self.agent.ctxUsed ?? 0, tried: readTryouts(self.settings.remote?.address) });
  // The screen's part of it: the list.
  const serviceProps = (pk) => ({ service: serviceOf(pk) });
  // A model on this Mac picked while on a remote: back to this Mac with it (the remote stays saved, off).
  const pickHere = (picked) => {
    self.localModelRef.current = picked;
    self.settings.remote = saveSettings({ model: picked.id, remote: { ...(self.settings.remote ?? DEFAULT_REMOTE), use: false } }).remote;
    self.useLocal({ note: `Now on ${picked.name}, on this Mac. /remote turns the remote back on.` });
  };
  return { subagentsKey, applyHelpers, serviceOf, serviceProps, pickHere };
}
