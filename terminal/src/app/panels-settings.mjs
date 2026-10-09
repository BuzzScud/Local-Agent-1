// The window's panels, /settings, and the choices its rows save (app-panels.mjs puts the parts together).
// Moved from app-panels.mjs word for word; a name from another part is read through own.
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { HOOKS } from '../agent/way.mjs';
import { MODELS, modelPath, withVision, readRecord, battleCounts, battleHold, availableBytes, getVision } from '../../../models/index.mjs';
import { copyDiff } from './copies.mjs';
import { webSettings } from './web-form.mjs';
import { PROVIDER_NAMES } from '../tools/web.mjs';
import { SETTINGS } from './commands.mjs';
import { listDocs, findDocsDir } from './weights.mjs';
import { VERSION, MODE_OPTIONS } from './help.mjs';
import { memoryDirs, readFacts } from '../agent/facts.mjs';
import { rulesList } from './rules.mjs';
import { saveSettings } from './store.mjs';
import { settingsValue, changePermissions } from './perms.mjs';
import { readInstructions } from '../agent/instructions.mjs';

export function panelsSettings(self, own) {
  const turnVisionOn = (...a) => own.turnVisionOn(...a);
  const openOwnSettings = (...a) => own.openOwnSettings(...a);
  // /settings: the commands kept out of the / menu, each row with what it
  // holds right now (none reads blank); enter runs the row's command.
  const openSettings = () => {
    const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
    const tokK = (t) => `${(t / 1024).toFixed(t < 10240 ? 1 : 0)}k`;
    const dirs = self.agent.memory ? memoryDirs(self.cwd) : null;
    const facts = (d) => (d ? readFacts(d).length : 0);
    let ins = null;
    try { ins = readInstructions(); } catch {}
    const steps = (t) => (String(t ?? '').match(/^\d+\./gm) ?? []).length;
    const docs = listDocs(findDocsDir());
    const runs = readRecord();
    const last = runs[0];
    const bc = battleCounts();
    const value = {
      meters: self.S.current.meters ? 'on' : 'off',
      mouse: self.S.current.mouse ? 'on' : 'off',
      autostart: self.settings.modelAtStart ? 'on · loads at once' : 'off · /start loads it',
      helpers: `${self.agent.helpers.size} of 4 on`,
      hooks: self.agent.way === 'app' ? 'all run: App decides' : `${self.agent.hooks.size} of ${HOOKS.length} on`,
      permissions: settingsValue(self.agent.cwd),
      web: (() => { const w = webSettings(self.settings.web); return `${w.search === 'off' ? 'no search' : PROVIDER_NAMES[w.search]} · pages ${w.fetch ? 'on' : 'off'}`; })(),
      rules: dirs ? n(rulesList(dirs).always.length, 'rule') : 'memory off here',
      instructions: ins ? `${steps(ins.sections.general)} general · ${steps(ins.sections.planning)} planning` : 'could not read',
      memory: dirs ? `${facts(dirs.you)} about you · ${facts(dirs.project)} here` : 'off here',
      weights: (() => { const here = Object.values(MODELS).filter((m) => m.format !== 'mlx' && existsSync(modelPath(m))); return here.length > 1 ? here.map((m) => m.name).join(' · ') : here.length ? `${here[0].name} · ${(statSync(modelPath(here[0])).size / 1e9).toFixed(2)} GB` : 'no model file here yet'; })(),
      docs: docs.missing ? 'DOCS folder not found' : n(docs.pages.length, 'page'),
      tests: last ? `${n(runs.length, 'run')} · last ${last.total != null ? `${last.passed}/${last.total}` : last.result}` : 'no runs yet',
      arena: battleHold() ? 'something is running there' : `${n(bc.tests, 'test')} · ${n(bc.battles, 'run')}`,
      stats: `${tokK(self.agent.ctxUsed ?? 0)} of ${tokK(self.agent.ctx)} context`,
      doctor: `${(availableBytes() / 1e9).toFixed(1)} GB free now`,
      init: existsSync(join(self.cwd, 'AGENTS.md')) ? 'AGENTS.md is here' : 'no AGENTS.md yet',
      update: self.update ? (self.update.kind === 'pull' ? 'new code on GitHub' : 'new code waiting') : `${VERSION} · nothing new`,
    };
    const groups = SETTINGS.map((g) => ({ group: g.group, rows: g.rows.map((r) => ({ ...r, value: value[r.name] })) }));
    self.setPicker({ kind: 'settings', groups, rows: groups.flatMap((g) => g.rows), index: 0 });
  };
  const applyChoice = (id, value) => {
    if (id === 'memory-save') { const p = self.pendingSaveRef.current; self.pendingSaveRef.current = null; p?.resolve(value === 'save'); return; }
    if (id === 'vision-get') {
      const wait = self.visionWaitRef.current;
      if (value === 'skip') { self.visionWaitRef.current = null; if (wait) setTimeout(() => self.remoteFnRef.current.send?.(wait.value, wait.shown, { visionAsked: true }), 50); return; }
      self.push({ type: 'note', text: `Downloading ${self.model.name}'s vision add-on…`, tone: 'dim' });
      getVision(self.model, (t) => self.flash(String(t).trim(), 4000))
        .then(() => turnVisionOn())
        .catch((e) => { self.visionWaitRef.current = null; self.push({ type: 'note', text: `The vision add-on did not download: ${e.message}. The message goes without the picture.`, tone: 'error' }); if (wait) setTimeout(() => self.remoteFnRef.current.send?.(wait.value, wait.shown, { visionAsked: true }), 50); });
      return;
    }
    if (id === 'vision-switch') {
      const wait = self.visionWaitRef.current;
      self.visionWaitRef.current = null;
      const go = () => { if (wait) setTimeout(() => self.remoteFnRef.current.send?.(wait.value, wait.shown, { visionAsked: true }), 50); };
      const seer = String(value).startsWith('use:') ? MODELS[String(value).slice(4)] : null;
      if (!seer) { go(); return; }
      const back = self.model;
      (async () => {
        await self.switchModel(withVision(seer), () => `${seer.name} looks at the picture; ${back.name} comes back after its reply.`);
        self.switchBackRef.current = back;
        // It did not load (or loaded without its add-on): the message goes to the model you had.
        if (!self.agentRef.current?.canSee) { self.push({ type: 'note', text: `${seer.name} could not take the picture; back to ${back.name}, and the message goes without it.`, tone: 'warn' }); await self.remoteFnRef.current.switchBack(); }
        go();
      })();
      return;
    }
    if (id === 'service-chat-only') {
      const pick = self.chatOnlyRef.current;
      self.chatOnlyRef.current = null;
      if (value !== 'switch' || !pick) return;
      openOwnSettings(pick.m, { back: pick.back });
      return;
    }
    if (id === 'same-folder') {
      if (value !== 'copy') { self.push({ type: 'note', text: 'Sharing this folder with the other window: both can change the same files.', tone: 'dim' }); return; }
      if (self.agent.busy) { self.push({ type: 'note', text: 'Wait for the reply to finish, then type /copy to work in your own copy.', tone: 'warn' }); return; }
      self.startCopy();
      return;
    }
    if (id === 'copy-back') {
      if (value === 'show') {
        let diff = '';
        try { diff = copyDiff(self.copyRef.current); } catch (e) { diff = `Could not show them: ${e.message}`; }
        self.push({ type: 'note', text: diff || 'Nothing changed in the copy.', tone: 'dim' });
        setTimeout(() => self.openChoice('copy-back'), 60);
      } else if (value === 'back') self.doPutBack();
      else self.push({ type: 'note', text: 'Your changes stay in the copy for now. /copy brings the question back.', tone: 'dim' });
      return;
    }
    if (id === 'copy-conflict') {
      if (value === 'mine') self.doPutBack({ only: self.copyAsk.current.conflicts, force: true });
      else self.push({ type: 'note', text: `Left ${self.copyAsk.current.conflicts.join(', ')} as they are in the real folder; /copy asks again later.`, tone: 'dim' });
      return;
    }
    if (id === 'remote-saved') {
      const a = self.savedAskRef.current;
      self.savedAskRef.current = null;
      if (!a) return;
      if (value !== 'connect') { self.push({ type: 'note', text: `Left saved, not connected. /remote ${self.remoteWord(a.source)} connects it any time.`, tone: 'dim' }); return; }
      // The one in use with new settings connects again; any other is switched to as /remote service would.
      if (a.again) self.useRemote(self.settings.remote);
      else self.remoteTo(a.source);
      return;
    }
    if (id === 'remote-down') {
      if (value === 'retry') self.useRemote(self.settings.remote);
      else if (value === 'local') self.useLocal({ note: 'This window uses the model on this Mac for now; /remote is still on for the next start.', load: true });
      else self.openRemoteForm();
      return;
    }
    if (id === 'mode') {
      const o = MODE_OPTIONS.find((x) => x.id === value); if (!o) return;
      self.setMode(o.id);
      const MODE_SAYS = {
        auto: 'Mode is auto: reading, searching and edits inside the project go through; a command or web page no rule covers is checked by the model against your request first, and runs only when it fits and can be undone. Commits and protected files still ask.',
        ask: 'Mode is manual: Agentic Coder asks before every change and every command that can change things.',
        edits: 'Mode is accept edits: file edits go through without asking; commands still ask.',
        plan: 'Mode is plan: it only reads and searches, then replies with a plan.',
        bypass: 'Bypass permissions is on: nothing asks. A git push asks first (unless the model is Claude). Still never: rm -rf, sudo, a force push, stopping processes, a change to Agentic Coder’s own settings, your never-list, secrets outside the project (keys, .ssh, .env), or reaching what already runs on this Mac. Files and commands may use any folder, and commands the internet. shift+tab goes back to manual.',
      };
      self.push({ type: 'note', text: MODE_SAYS[o.id], tone: o.id === 'bypass' ? 'warn' : 'dim' });
    } else if (id === 'meters') {
      const on = value === 'on';
      self.setMeters(on);
      saveSettings({ meters: on });
      self.push({ type: 'note', text: on ? 'Status bar on: model, speed, memory and effort under the prompt.' : 'Status bar off. /stats has the numbers; a memory note appears only when it runs low.', tone: 'dim' });
    } else if (id === 'mouse') {
      const on = value === 'on';
      self.setMouse(on);
      saveSettings({ mouse: on });
      self.push({ type: 'note', text: on ? 'Mouse on: a click in the prompt box puts the cursor there and a drag highlights (copied at once; delete removes it); a click on the model’s label in the footer starts or stops it. Hold fn to highlight the way Terminal does.' : 'Mouse off: the mouse is Terminal’s again. option+click, shift+arrows and ctrl+t still work.', tone: 'dim' });
    } else if (id === 'autostart') {
      const on = value === 'on';
      self.settings.modelAtStart = on;
      saveSettings({ modelAtStart: on });
      self.push({ type: 'note', text: on ? `Model at start on: ${self.model.name} loads as soon as a window opens. /stop still unloads it.` : 'Model at start off: a window opens with the model off, and /start loads it.', tone: 'dim' });
    } else if (id === 'startmode') {
      const r = changePermissions(self.agent.cwd, `mode ${value}`, { mode: self.agent.mode, session: self.agent.allowedPrefixes });
      if (r.mode) self.setMode(r.mode);
      self.push({ type: 'note', text: r.text, tone: r.tone ?? 'dim' });
    }
  };
  return { openSettings, applyChoice };
}
