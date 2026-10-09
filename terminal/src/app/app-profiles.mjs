// /profiles, /model's profile step and the router in the window (profiles.mjs has what a profile is,
// profile-router.mjs which server and model a request goes to). The panels open while a reply runs: a
// change is saved at once and the next request reads it, so a long task moves to another model from
// its next step (8 Oct 2026, the owner: "what if it's mid response working for an hour and I want to
// switch to another model?").
// Its functions are put on App by profilesPart(self), as the other parts are.
import { CLAUDE_MODELS } from '../../../models/index.mjs';
import { readProfiles, writeProfiles, openProfiles, profileStepRows, listRows, stepUse, serverOf, sameServer, serverWord, validProfileName, SPILL_STEPS, spillWord, groupsNow, MAIN_PROFILE, profilesSaved, withMain, helpersAway, remoteOfMain } from './profiles.mjs';
import { saveSettings } from './store.mjs';
import { ProfileRouter, serverKey } from './profile-router.mjs';
import { modelWithLimits, ownOf } from './limits.mjs';
import { RemoteEmbedder } from '../agent/helper-models.mjs';
import { flushMeters } from '../agent/profile-meters.mjs';

export function profilesPart(self) {
  // One router for the window, kept on its agent; it reads the window through `app`, the latest render's.
  const router = (self.agent.router ??= new ProfileRouter({
    settings: () => router.app?.settings,
    jobs: () => router.app?.agent.helperJobs ?? null,
    withLimits: (m) => modelWithLimits(m, router.app?.limitsRef.current ?? {}),
  }));
  router.app = self;
  const data = () => readProfiles(self.settings, self.agent.helperJobs);
  const save = (d) => { writeProfiles(d); applyProfiles(); return d; };
  const now = () => ({ url: self.agent.url, model: self.agent.modelName() });
  // The window's models a profile row can step through: the Claude API's, else its service's.
  const modelsOf = (server) => (server?.kind === 'claude' ? CLAUDE_MODELS.map((m) => m.id)
    : (sameServer(server, serverOf(self.settings.remote)) ? self.catalog?.models ?? [] : router.pool.get(serverKey(server))?.catalog ?? []).map((m) => m.id));

  // ---- /profiles ----------------------------------------------------------------------------------

  // /profiles (and /subagents, which it took the place of: on its AIs group).
  const openProfilesPanel = ({ group = null } = {}) => {
    if (!self.settings.remote?.use) { self.push({ type: 'note', text: 'Profiles are for models on /remote (a service, the Claude API, your other computer): connect one first, then /profiles.', tone: 'warn' }); return; }
    const groups = groupsNow();
    const pk = openProfiles(data(), { groups });
    const tab = Math.max(0, groups.findIndex((g) => g.id === group));
    self.setPicker({ ...pk, tab });
  };

  // A pick moved in the panel is saved at once: every window reads the file at its next request.
  const keep = (pk, next) => {
    self.setPicker(next);
    if (next.data === pk.data) return;
    const mainOf = (d) => { const n = d.uses['ai:main'] ?? MAIN_PROFILE; return `${n}|${d.profiles[n]?.model}`; };
    if (mainOf(next.data) !== mainOf(pk.data)) self.agent.pinned = null;
    save(next.data);
  };

  // ←→ on a profile row: its model, the next one its server has (the Claude API's, the service's).
  const stepModel = (pk, name, dir) => {
    const p = pk.data.profiles[name];
    const list = modelsOf(p.server);
    if (list.length < 2) { self.flash(`${name}: its server lists no other model here`, 2500); return pk; }
    const i = list.indexOf(p.model);
    const model = list[(i + dir + list.length) % list.length];
    return { ...pk, data: { ...pk.data, profiles: { ...pk.data.profiles, [name]: { ...p, model } } } };
  };

  const profilesKey = (pk, ch, key) => {
    if (key.escape || (key.ctrl && ch === 'c')) { self.setPicker(null); return; }
    const rows = listRows(pk);
    const row = rows[pk.at];
    if (key.upArrow) self.setPicker({ ...pk, at: Math.max(0, pk.at - 1) });
    else if (key.downArrow) self.setPicker({ ...pk, at: Math.min(rows.length - 1, pk.at + 1) });
    else if (key.tab) { const tab = (pk.tab + 1) % pk.groups.length; const first = rows.findIndex((r) => r.kind === 'use'); self.setPicker({ ...pk, tab, at: pk.at >= first ? first : pk.at }); }
    else if ((key.leftArrow || key.rightArrow) && row?.kind === 'use') keep(pk, stepUse(pk, row.row.key, key.leftArrow ? -1 : 1));
    else if ((key.leftArrow || key.rightArrow) && row?.kind === 'profile') keep(pk, stepModel(pk, row.name, key.leftArrow ? -1 : 1));
    else if (key.return && row?.kind === 'profile') editProfile(row.name, pk);
    else if (key.return && row?.kind === 'new') { self.setPicker(null); self.openModelPicker(); }
  };

  // Enter on a profile: its settings (/model's step 3) when its model is on the window's service;
  // a profile elsewhere changes its model with ←→ here.
  const editProfile = (name, back) => {
    const p = back.data.profiles[name];
    const entry = sameServer(p?.server, serverOf(self.settings.remote)) ? self.catalog?.models?.find((m) => m.id === p?.model) : null;
    if (!entry) { self.flash(`${name} is on ${p?.server?.kind === 'claude' ? 'the Claude API' : 'another server'}: ←→ on its row picks its model`, 3500); return; }
    self.openOwnSettings(entry, { back, profile: profileRows(name, back.data, false) });
  };

  // ---- /model's step 2 ----------------------------------------------------------------------------

  // Which profile uses the model picked in step 1 (entry); back: step 1 as it was.
  const openProfileStep = (entry, back) => {
    const d = data();
    const rows = profileStepRows(d);
    // It starts on the conversation's own profile: /model has always been the conversation's model.
    const main = Object.keys(d.profiles).indexOf(d.uses['ai:main'] ?? MAIN_PROFILE);
    self.setPicker({ kind: 'profile-step', entry, back, data: d, rows, at: Math.max(0, main), naming: null });
  };

  const profileStepKey = (pk, ch, key) => {
    const row = pk.rows[pk.at];
    if (pk.naming !== null) {
      if (key.escape) self.setPicker({ ...pk, naming: null });
      else if (key.backspace || key.delete) self.setPicker({ ...pk, naming: pk.naming.slice(0, -1) });
      else if (key.return) {
        const name = pk.naming.trim();
        if (!validProfileName(name)) { self.flash('A profile name starts with a letter: up to 20 letters, digits, spaces, dots or dashes', 3000); return; }
        if (pk.data.profiles[name]) { self.flash(`There is a profile called ${name} already: pick it in the list`, 3000); return; }
        self.openOwnSettings(pk.entry, { back: { ...pk, naming: null }, profile: profileRows(name, pk.data, true) });
      } else if (ch && !key.ctrl && !key.meta && !key.tab && !key.upArrow && !key.downArrow) self.setPicker({ ...pk, naming: (pk.naming + ch.replace(/[\x00-\x1f\x7f]/g, '')).slice(0, 20) });
      return;
    }
    if (key.upArrow) self.setPicker({ ...pk, at: (pk.at + pk.rows.length - 1) % pk.rows.length });
    else if (key.downArrow || key.tab) self.setPicker({ ...pk, at: (pk.at + 1) % pk.rows.length });
    else if (key.escape) self.setPicker(pk.back);
    else if (key.ctrl && ch === 'c') self.setPicker(null);
    else if (key.return && row?.kind === 'profile') self.openOwnSettings(pk.entry, { back: pk, profile: profileRows(row.name, pk.data, false) });
    else if (key.return && row?.kind === 'new') self.setPicker({ ...pk, naming: '' });
    // Today's switch: this window's main model, no profile, once the reply has ended.
    else if (key.return && row?.kind === 'window') {
      if (self.agent.busy) { self.flash('Just this window switches when the reply ends: pick a profile to change it from the next step', 3500); return; }
      // It holds (9 Oct 2026, the owner's pick): the router leaves this window's conversation on it until a
      // profile is picked here or in /profiles, or /remote connects (agent-model.mjs followProfile).
      self.agent.pinned = { model: pk.entry.id };
      self.openOwnSettings(pk.entry, { back: pk });
    }
  };

  // Step 3's profile rows (Backup, Spill after), kept on the settings menu (pk.own.profile). A backup is
  // a profile that can take a conversation: not an embedder, not a model that only looks at pictures.
  const profileRows = (name, d, isNew) => {
    const p = d.profiles[name] ?? {};
    const can = (n) => { const m = self.catalog?.models?.find((x) => x.id === d.profiles[n].model); return d.profiles[n].server?.kind === 'claude' || !m || Boolean(m.tools && !m.embedding); };
    const backups = [null, ...Object.keys(d.profiles).filter((n) => n !== name && can(n))];
    return { name, isNew, data: d, backups, backup: Math.max(0, backups.indexOf(p.backup ?? null)), spills: SPILL_STEPS, spill: Math.max(0, SPILL_STEPS.indexOf(p.spillAfter ?? 30)) };
  };

  // Enter on step 3: the profile saved with this model, and the model's own settings kept as /model
  // keeps them (by model, in the service's set-up). Nothing loads here: the next request that uses the
  // profile goes there, from the next step in the middle of a reply too.
  const saveProfileStep = (pk, { reset = false } = {}) => {
    const pr = pk.own.profile;
    self.agent.pinned = null;
    const d = data();
    const before = d.profiles[pr.name];
    const levels = pk.model.thinkingLevels ?? [];
    const server = serverOf(self.settings.remote);
    d.profiles[pr.name] = { ...(before ?? {}), server, model: pk.own.id, backup: pr.backups[pr.backup], spillAfter: pr.spills[pr.spill] };
    // A new profile while there is no Main becomes the conversation's.
    if (pr.isNew && !d.profiles[MAIN_PROFILE] && !d.uses['ai:main']) d.uses['ai:main'] = pr.name;
    const isMain = pr.name === (d.uses['ai:main'] ?? MAIN_PROFILE);
    const users = Object.values(d.uses).filter((n) => n === pr.name).length;
    const moved = !before || before.model !== pk.own.id;
    const when = self.agent.busy ? 'from its next step: the step under way finishes on the one before' : 'from the next request';
    const reads = moved && isMain && self.agent.busy && (self.agent.ctxUsed ?? 0) > 2000 ? ` It reads the conversation once first (about ${Math.round((self.agent.ctxUsed ?? 0) / 1000)}k tokens).` : '';
    const lv = levels.length > 1 ? levels[pk.level] : null;
    const line = `${pr.name} ${pr.isNew ? 'made' : 'saved'}: ${pk.own.id}${lv ? ` · thinking ${lv.label}` : ''} · backup ${pr.backups[pr.backup] ?? 'none'}${pr.backups[pr.backup] ? ` after ${spillWord(pr.spills[pr.spill])}` : ''}. ${users ? `${users} job${users === 1 ? '' : 's'} use${users === 1 ? 's' : ''} it, ${when}, in every window on this Mac.` : 'Nothing uses it yet: /profiles gives it jobs.'}${reads}`;
    writeProfiles(d);
    self.push({ type: 'note', tone: 'dim', text: line });
    // The conversation's own profile while it is idle: the switch /model always made (the model loaded on the
    // service, its notes, a smaller context when it does not fit). Mid-task, or another profile: its settings
    // are kept for the model, and the next request that uses the profile goes there.
    if (isMain && !self.agent.busy && !self.busyNow?.()) { self.saveOwnSettings(pk, { reset }); applyProfiles(); return; }
    self.setPicker(null);
    self.keepOwnSettings(pk, { reset });
    applyProfiles();
  };

  // ---- /remote ------------------------------------------------------------------------------------

  // /remote connected (or the window started on it): the conversation's profile is that server and model
  // now, in the file every window reads (9 Oct 2026, the owner's picks: "Connect makes the new model Main",
  // the other windows follow from their next step, the helpers keep their own profiles). Before, the
  // router moved the conversation back to Main at the next step: /remote looked as if it did nothing.
  const mainToRemote = (r, model) => {
    self.agent.pinned = null;
    if (!profilesSaved()) return;
    const d = data();
    const moved = withMain(d, { ...r, model });
    const now = moved ? moved.data : d;
    if (moved) {
      writeProfiles(now);
      router.seenStamp = router.stamp();
      const was = moved.was ? `${moved.was.model} · ${serverWord(moved.was.server)}` : 'none';
      self.push({ type: 'note', tone: 'dim', text: `${moved.name} → ${model} · ${serverWord(serverOf(r))} (was ${was}): your conversation, and every other window on this Mac from its next step. /profiles changes it.` });
    }
    self.agent.routeName = moved?.name ?? router.mainName();
    const away = helpersAway(now);
    const one = away.every((h) => h.where === away[0]?.where);
    if (away.length) self.push({ type: 'note', tone: 'dim', text: `The helpers keep their own profiles: ${away.map((h) => `${h.label} → ${h.model}${one ? '' : ` (${h.where})`}`).join(' · ')}${one ? ` (on the ${away[0].where})` : ''}. /profiles moves them.` });
  };

  // ---- following the file -------------------------------------------------------------------------

  // The profiles as they are now, put to work: the code search's embedder (its profile's model, on its
  // profile's server), and, while the window is idle, the conversation's model (the footer shows it).
  const applyProfiles = () => {
    if (!router.active()) return;
    const u = self.agent.profileUse('search');
    const model = u?.model ?? null;
    const want = model && self.catalog?.models?.find((m) => m.id === model)?.embedding !== false ? `${u.url}|${model}` : null;
    if (!want) self.agent.searchEmbedder = null;
    else if (self.agent.searchEmbedder?.key !== want) { self.agent.searchEmbedder = new RemoteEmbedder({ url: u.url, model }); self.agent.searchEmbedder.key = want; }
    if (!self.agent.busy && !self.modelOffNow?.()) self.agent.followProfile({ idle: true }).catch(() => {});
  };
  // Every 2 s (App.jsx): a change made in another window or the hub, picked up here while idle.
  const followProfiles = () => {
    if (!router.active()) return;
    const s = router.stamp();
    if (s === router.seenStamp) return;
    router.seenStamp = s;
    applyProfiles();
  };

  // The conversation moved to another profile's model (agent followProfile): the window shows it, the
  // model's own limits and thinking apply, and its connection is the one the footer's gauges read.
  const onRoute = (ev) => {
    if (ev.helper) return;
    const m = ev.model;
    // Moved to Main (changed in /profiles, the hub or another window): /remote's set-up names it too, so the
    // next start begins there and does not put Main back (mainToRemote).
    if (ev.name === router.mainName()) { const r = remoteOfMain(self.settings, router.data()); if (r) self.settings.remote = saveSettings({ remote: r }).remote; }
    if (ev.conn) self.remoteRef.current.conn = ev.conn;
    self.setModel(m);
    self.relimit(m);
    self.agent.model = modelWithLimits(m, self.limitsRef.current);
    self.ownLevel?.(m, ownOf(self.settings, m.remote?.model));
    self.setCtx(ev.ctx);
    self.applyKeep();
    // The model list of the window's own service (another server's is the router's own: profile-router.mjs reach).
    if (ev.conn?.info?.ollama && sameServer(ev.server, serverOf(self.settings.remote))) self.refreshCatalog(ev.conn);
  };

  // The window's own connection: its server is reached through it.
  const lendConn = (r, conn) => router.lend(serverOf(r), conn);
  const closeProfiles = () => { router.stop(); flushMeters(); };

  return { openProfilesPanel, profilesKey, openProfileStep, profileStepKey, saveProfileStep, followProfiles, applyProfiles, onRoute, lendConn, closeProfiles, mainToRemote };
}
