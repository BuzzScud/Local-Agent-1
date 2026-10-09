// The slash commands of what the model makes: /math and /design (app-slash.mjs sends each its own).
// Moved word for word out of runSlashFn's switch: the same cases, in the same order.
import { homedir } from 'node:os';
import { mathTopics } from '../agent/expertise.mjs';
import { designSettings, styleWords, designSummary, STYLES as DESIGN_STYLES, readCards, designDir } from '../agent/design.mjs';
import { studioSummary, studioDir, ensureStudioDir, studioLooks, checkPiece, readTheme } from '../agent/studio.mjs';
import { updateLibrary, librarySummary, SOURCES as LIBRARY_SOURCES } from '../agent/library.mjs';
import { saveSettings } from './store.mjs';
import { IDLE } from './app-common.mjs';

export const DESIGN_COMMANDS = ['math', 'design'];

export function slashDesign(self) {
  return async (cmd, arg, busy, line) => {
    switch (cmd) {
      case 'math': {
        // Alone: the topics of ~/Desktop/MATH. With a question: ask it with
        // the notes attached even when no topic word matches.
        const topics = mathTopics();
        if (!topics.length) { self.push({ type: 'note', text: 'No math notes found (~/Desktop/MATH is missing or has no .md files).', tone: 'warn' }); break; }
        if (!arg) { self.push({ type: 'panel', title: 'Math topics (~/Desktop/MATH)', pad: 28, rows: topics }); break; }
        if (busy) { self.flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        self.agent.mathForce = true;
        self.sendPrompt(arg, `/math ${arg}`);
        break;
      }
      case 'design': {
        // Alone: the folder, set by set, and what is on. on|off: the cards with
        // page requests; check on|off: the browser check; ask on|off: a saved
        // page asks you before it is checked (or not); sets all|a,b: which
        // sets; style auto|opus|fable|mix: which set's cards win; studio
        // [on|off]: the design studio's pieces; polish, plan, learn on|off: the
        // check and the look before you are asked, the page plan, keeping a page
        // you call good (8 Oct 2026). Anything else is a request sent with the cards.
        const saved = { ...(self.settings.design ?? {}) };
        const keep = (patch) => {
          const next = { ...saved, ...patch };
          self.settings.design = next;
          if (self.agent) self.agent.designSaved = next;
          saveSettings({ design: next });
          const now = designSettings(next);
          self.push({ type: 'note', text: `Design examples ${now.auto ? 'on' : 'off'} with page requests · layout check ${now.check ? 'on' : 'off'} · ${now.ask ? 'asks you first' : 'checks by itself'} · studio ${now.studio ? 'on' : 'off'} · library ${now.library ? 'on' : 'off'} · look: ${now.look ?? 'your own'} · polish ${now.polish ? 'on' : 'off'} · plan ${now.brief ? 'on' : 'off'} · learn ${now.learn ? 'on' : 'off'} · sets: ${now.sets === 'all' ? 'all' : now.sets.join(', ')} · style: ${styleWords(now.style)}${process.env.AGENTIC_DESIGN || process.env.AGENTIC_DESIGN_LIBRARY || process.env.AGENTIC_DESIGN_LOOK || process.env.AGENTIC_LAYOUT || process.env.AGENTIC_LAYOUT_ASK || process.env.AGENTIC_DESIGN_SETS || process.env.AGENTIC_DESIGN_STYLE || process.env.AGENTIC_DESIGN_POLISH || process.env.AGENTIC_DESIGN_BRIEF || process.env.AGENTIC_DESIGN_LEARN ? ' (an AGENTIC_DESIGN… setting in the environment decides over this)' : ''}.`, tone: 'dim' });
        };
        const a = arg.trim();
        if (!a) {
          const now = designSettings(saved);
          const sum = designSummary(now);
          if (!sum.dir) { self.push({ type: 'note', text: 'No design examples folder (make "design examples" in docs/private/, one subfolder per set of .md cards).', tone: 'warn' }); break; }
          self.push({ type: 'panel', title: `Design examples · ${now.auto ? 'on' : 'off'} with page requests · layout check ${now.check ? 'on' : 'off'} · ${now.ask ? 'asks you first' : 'checks by itself'} (/design ask) · studio ${now.studio ? 'on' : 'off'} (/design studio) · polish ${now.polish ? 'on' : 'off'} · plan ${now.brief ? 'on' : 'off'} · learn ${now.learn ? 'on' : 'off'} · style: ${styleWords(now.style)} · ${sum.dir.replace(homedir(), '~')}`, pad: 18, rows: sum.rows });
          break;
        }
        if (/^(on|off)$/i.test(a)) { keep({ auto: /^on$/i.test(a) }); break; }
        const chk = /^check\s+(on|off)$/i.exec(a);
        if (chk) { keep({ check: /^on$/i.test(chk[1]) }); break; }
        // ask on: a saved page stops the turn and asks you before any check; off: it checks by itself.
        const ask = /^ask\s+(on|off)$/i.exec(a);
        if (ask) { keep({ ask: /^on$/i.test(ask[1]) }); break; }
        // polish: the layout check and a look at a picture before you are asked; plan: six lines before
        // writing; learn: "Looks good" offers to keep the page as one of your picks (agent-pages.mjs).
        const part = /^(polish|plan|learn)\s+(on|off)$/i.exec(a);
        if (part) { keep({ [{ polish: 'polish', plan: 'brief', learn: 'learn' }[part[1].toLowerCase()]]: /^on$/i.test(part[2]) }); break; }
        const sty = /^style(?:\s+(\S+))?$/i.exec(a);
        if (sty) {
          const want = sty[1]?.toLowerCase();
          if (!want || !DESIGN_STYLES.includes(want)) { self.push({ type: 'note', text: `The styles: ${DESIGN_STYLES.map((x) => `${x} (${styleWords(x)})`).join(' · ')}. Now: ${styleWords(designSettings(saved).style)}.`, tone: want ? 'warn' : 'dim' }); break; }
          keep({ style: want });
          break;
        }
        // studio: the design studio's pieces (agent/studio.mjs), alone its list; on|off: switch.
        const stu = /^studio(?:\s+(on|off))?$/i.exec(a);
        if (stu) {
          if (stu[1]) {
            const on = /^on$/i.test(stu[1]);
            const next = { ...saved, studio: on };
            self.settings.design = next;
            if (self.agent) self.agent.designSaved = next;
            saveSettings({ design: next });
            const now = designSettings(next);
            self.push({ type: 'note', text: `Design studio ${now.studio ? 'on' : 'off'}: ${now.studio ? 'a page request gets the pieces that fit it, and the page its built styles' : 'page requests get the design cards only'}${now.auto ? '' : ' (the design examples are off: /design on)'}${process.env.AGENTIC_STUDIO ? ' (AGENTIC_STUDIO in the environment decides over this)' : ''}.`, tone: 'dim' });
            break;
          }
          const sum = studioSummary();
          if (!sum.dir) { self.push({ type: 'note', text: 'No design studio folder (make "design studio" in docs/private/: styles/theme.css and components/<kind>/<piece>.html).', tone: 'warn' }); break; }
          const now = designSettings(saved);
          self.push({ type: 'panel', title: `Design studio · ${now.studio && now.auto ? 'on' : 'off'} with page requests · ${sum.dir.replace(homedir(), '~')}`, pad: 12, rows: sum.rows.length ? sum.rows : [['(none)', 'no pieces in components/ yet']] });
          break;
        }
        // library: the downloaded pieces, looks and skills (agent/library.mjs), alone its list; on|off: picked or not.
        const lib = /^library(?:\s+(on|off))?$/i.exec(a);
        if (lib) {
          if (lib[1]) { keep({ library: /^on$/i.test(lib[1]) }); break; }
          const sum = librarySummary(studioDir());
          self.push({ type: 'panel', title: `Design library · ${designSettings(saved).library ? 'picked with page requests' : 'off (/design library on)'} · ${sum.updated ? `updated ${sum.updated.slice(0, 10)}` : 'not downloaded yet: /design update'}${sum.dir ? ` · ${sum.dir.replace(homedir(), '~')}` : ''}`, pad: 18, rows: sum.rows });
          break;
        }
        // look <name>: every page in that look (a brand's or a theme's colours, type and corners); off: your own.
        const lk = /^looks?(?:\s+(.+))?$/i.exec(a);
        if (lk) {
          const looks = studioLooks();
          const want = lk[1]?.trim().toLowerCase();
          if (!want) {
            const now = designSettings(saved).look;
            self.push({ type: 'panel', title: `Looks · now ${now ?? 'your own'} · a request that says "like Linear" takes that look for its page · /design look <name> | off`, pad: 18, rows: looks.length ? looks.sort((x, y) => x.name.localeCompare(y.name)).map((l) => [l.name, `${l.mode} · page ${l.vars.paper}, text ${l.vars.ink}, accent ${l.vars.accent}${l.font ? ` · ${l.font.split(',')[0]}` : ''}`]) : [['(none)', 'no looks yet: /design update downloads them']] });
            break;
          }
          if (/^(off|none|mine|yours|own)$/.test(want)) { keep({ look: null }); break; }
          const hit = looks.find((l) => l.id === want || l.name.toLowerCase() === want || l.id.replace(/\.(app|ai|com)$/, '') === want);
          if (!hit) { self.push({ type: 'note', text: `No look named ${want}. ${looks.length ? `The looks: ${looks.map((l) => l.name).sort().join(', ')}.` : 'None yet: /design update downloads them.'}`, tone: 'warn' }); break; }
          keep({ look: hit.id });
          break;
        }
        // update [source,…] [force]: the newest of each library from GitHub, made into pieces and checked in a browser.
        const up = /^update(?:\s+(.+))?$/i.exec(a);
        if (up) {
          if (busy || self.S.current.live.phase === 'working') { self.flash('Wait for Agentic Coder to finish, or press esc first'); break; }
          const words = (up[1] ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean);
          const force = words.includes('force');
          const recheck = words.includes('recheck');
          const only = words.filter((w) => w !== 'force' && w !== 'recheck');
          const bad = only.filter((w) => !LIBRARY_SOURCES.some((x) => x.id === w));
          if (bad.length) { self.push({ type: 'note', text: `No source named ${bad.join(', ')}. The sources: ${LIBRARY_SOURCES.map((x) => x.id).join(', ')}.`, tone: 'warn' }); break; }
          const dir = ensureStudioDir();
          if (!dir) { self.push({ type: 'note', text: 'No design studio folder, and none could be made (docs/private/ is missing).', tone: 'warn' }); break; }
          const ac = new AbortController();
          self.abortRef.current = ac;
          self.setLive({ phase: 'working', turnStart: Date.now(), verb: 'Updating the design library', tokens: 0 });
          try {
            const theme = readTheme(dir);
            const r = await updateLibrary({ studio: dir, only: only.length ? only : null, force, recheck, signal: ac.signal, baseTheme: theme, check: (text) => checkPiece(text, { dir, theme }), say: (line) => self.push({ type: 'note', text: line, tone: 'dim' }) });
            self.push({ type: 'panel', title: `Design library updated in ${Math.round(r.took)} s · /design library lists it`, pad: 18, rows: r.sources.map((x) => [x.name, x.error ? `not updated: ${x.error}` : x.same ? `already the newest (${String(x.ref).slice(0, 7)})` : [x.pieces ? `${x.pieces} pieces: ${x.added} new, ${x.changed} changed, ${x.removed} gone; ${x.ok} pass the check` : null, x.looks ? `${x.looks} looks` : null, x.skills ? `${x.skills} skills` : null].filter(Boolean).join(' · ')]) });
          } catch (e) {
            self.push({ type: 'note', text: ac.signal.aborted ? 'Design library update stopped; what was done is kept.' : `Design library: ${e.message}`, tone: ac.signal.aborted ? 'dim' : 'error' });
          } finally {
            self.setLive(IDLE);
          }
          break;
        }
        const sets = /^sets?\s+(.+)$/i.exec(a);
        if (sets) {
          const known = readCards(designDir()).sets.map((x) => x.name);
          const want = /^all$/i.test(sets[1].trim()) ? 'all' : sets[1].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
          const unknown = want === 'all' ? [] : want.filter((x) => !known.includes(x));
          if (unknown.length) { self.push({ type: 'note', text: `No set named ${unknown.join(', ')}. The sets: ${known.join(', ') || 'none yet'}.`, tone: 'warn' }); break; }
          keep({ sets: want });
          break;
        }
        if (busy) { self.flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        self.agent.designForce = true;
        self.sendPrompt(a, `/design ${a}`);
        break;
      }
    }
  };
}
