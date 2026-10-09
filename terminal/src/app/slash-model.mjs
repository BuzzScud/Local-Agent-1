// The slash commands of the model: /start, /stop, /autostart, /model, /profiles, /subagents, /usage, /stats, /doctor (app-slash.mjs sends each its own).
// Moved word for word out of runSlashFn's switch: the same cases, in the same order.
import { remoteLabel } from '../../../models/index.mjs';
import { kindWord } from './remote-form.mjs';
import { showLimit } from './limits.mjs';

export const MODEL_COMMANDS = ['start', 'stop', 'autostart', 'model', 'profiles', 'subagents', 'usage', 'stats', 'doctor'];

export function slashModel(self) {
  return async (cmd, arg, busy, line) => {
    switch (cmd) {
      case 'start':
        self.startFnRef.current();
        break;
      case 'stop':
        await self.stopFnRef.current();
        break;
      case 'autostart': {
        if (!arg.trim()) { self.openChoice('autostart'); break; }
        self.applyChoice('autostart', /^(on|yes|true)$/i.test(arg.trim()) ? 'on' : 'off');
        break;
      }
      case 'model': {
        self.openModelPicker();
        break;
      }
      case 'profiles': {
        self.openProfilesPanel();
        break;
      }
      // /subagents is a row group of /profiles now (8 Oct 2026, the owner's pick): typed, it opens there.
      case 'subagents': {
        self.openProfilesPanel({ group: 'ai' });
        break;
      }
      case 'usage': {
        // The Claude API's usage (claude-usage.mjs, usage-bar.mjs): a card over the prompt, esc closes it.
        if (self.model.remote?.kind !== 'claude') { self.push({ type: 'note', text: `/usage shows what the Claude API has left; this window runs on ${self.model.remote ? self.model.remote.label : 'this Mac'}. /remote claude connects it.`, tone: 'dim' }); break; }
        // /usage limit 200 · /usage spent 112.40 (off takes either out) · /usage key opens the card to paste an Admin key.
        const [what, ...rest] = arg.trim().split(/\s+/);
        if (/^(limit|spent)$/i.test(what ?? '') && rest.length) { self.saveUsageEdit({ id: what.toLowerCase(), value: rest.join(' ') }); break; }
        if (/^(limit|spent|key)$/i.test(what ?? '')) { self.setPicker({ kind: 'usage', asking: false, editing: { id: what.toLowerCase(), value: '', cursor: 0 } }); break; }
        self.setPicker({ kind: 'usage', asking: false });
        break;
      }
      case 'stats':
        self.push({ type: 'panel', title: 'Stats', pad: 20, rows: [
          ['model', `${self.model.name}${self.model.edited ? ` · ${self.model.edited.edits.length} edit${self.model.edited.edits.length === 1 ? '' : 's'} · saved ${new Date(self.model.edited.saved).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`],
          ['context used', `${(self.stats.ctxUsed ?? self.agent.ctxUsed).toLocaleString()} of ${self.agent.ctx.toLocaleString()} tokens`],
          ['writing speed', self.stats.tps ? `${self.stats.tps.toFixed(1)} tokens/s (last reply)` : '—'],
          ['reading speed', self.stats.pps ? `${Math.round(self.stats.pps)} tokens/s (last long read)` : '—'],
          ['written so far', `${(self.stats.outTokens ?? 0).toLocaleString()} tokens in ${self.stats.requests ?? 0} replies`],
          ['memory', `${self.ramGb ? `${self.ramGb.toFixed(1)} GB` : '—'}${self.memoryNote.current ? ` · ${self.memoryNote.current}` : ''}`],
          ['pictures', self.agent.canSee ? 'on: it can look at pictures' : self.model.vision ? 'off: turns on when you attach one (ctrl+v, a dragged file, @file.png)' : 'this model cannot look at pictures'],
          ['search', `embedder ${showLimit('embedder', self.limitsRef.current.embedder)} · retriever ${showLimit('retriever', self.limitsRef.current.retriever).toLowerCase()} · reranker ${showLimit('reranker', self.limitsRef.current.reranker)}${self.agent.reranker?.last ? ` (last ${(self.agent.reranker.last.ms / 1000).toFixed(1)} s for ${self.agent.reranker.last.pieces})` : ''} · /effort moves them`],
          ['limits', `context ${showLimit('context', self.limitsRef.current.context)} · thinking cap ${showLimit('thinking', self.limitsRef.current.thinking)} · ${self.limitsRef.current.tries} tries · ${self.limitsRef.current.steps} steps · /effort moves them`],
          ['loaded', self.modelOffNow() ? 'no: the model is off · /start loads it' : self.model.remote || self.opts.url ? 'not by Agentic Coder' : `yes · until /stop or you quit${self.settings.modelAtStart ? ' · loads as a window opens (/autostart)' : ''}`],
          ['server', self.model.remote ? `remote ${remoteLabel(self.settings.remote)} · ${kindWord(self.settings.remote?.kind)}${self.remoteRef.current.conn ? '' : ' · not connected'}` : self.serverRef.current?.port ? `port ${self.serverRef.current.port} · restarts ${self.serverRef.current.restarts}` : self.opts.url ?? (self.modelOffNow() ? 'off' : '—')],
        ] });
        break;
      case 'doctor':
        self.doctor();
        break;
    }
  };
}
