// The slash commands of the tests and pages: /arena, /test, /tests, /calc, /instructions, /docs (app-slash.mjs sends each its own).
// Moved word for word out of runSlashFn's switch: the same cases, in the same order.
import { existsSync } from 'node:fs';
import { findRunTest, RUN_TESTS, MODELS, readRecord, modelPath, DEFAULT_MODEL } from '../../../models/index.mjs';
import { listDocs } from './weights.mjs';

export const TOOLS_COMMANDS = ['arena', 'battle', 'test', 'tests', 'calc', 'instructions', 'weights', 'docs'];

export function slashTools(self) {
  return async (cmd, arg, busy, line) => {
    switch (cmd) {
      case 'arena':
      case 'battle': { // /battle: its name before 30 Sep 2026, still typed
        // The hub on its Arena tab: a test on one model, or a battle of two. The Arena runs on its own
        // (the hub starts it), so what runs there keeps going when this window closes.
        const hub = self.openHub('arena'); if (!hub) break;
        self.push({ type: 'note', text: `The Arena opened in the browser at ${hub.url} · run a test on one model, or battle two with it, one model at a time, each run stopped at 10 min · while something runs there, ${self.model.name} here is unloaded and comes back by itself when it ends`, tone: 'dim' });
        break;
      }
      case 'test': {
        // The Arena with this window's model as who runs it: pick a test (or name one: /test practice 28,
        // /test work28, /test 12 for practice test 12, /test 18b for your copy of it, /test sorting) and press
        // Run there. The run is the Arena runner's: this window lets go of its model while it runs, and it keeps
        // going when this window closes.
        const num = /^(?:task\s*)?(\d{1,2}[b-z]?)$/i.exec(arg);
        const t = arg ? (findRunTest(arg) ?? (num ? RUN_TESTS.find((x) => x.id === 'task') : null)) : null;
        if (arg && !t) { self.push({ type: 'note', text: `No test called "${arg}". Try one of: ${RUN_TESTS.map((x) => x.name.toLowerCase()).join(', ')}, or a practice task's number (/test 12). /test alone opens the list.`, tone: 'warn' }); break; }
        const mine = self.model.edited ? self.model.edited.base : self.model.id;
        const hub = self.openHub('arena', { run: '1', model: t && !t.model ? 'none' : MODELS[mine] ? mine : '', test: t?.id, n: num && t?.id === 'task' ? num[1] : '' });
        if (!hub) break;
        self.push({ type: 'note', text: `The Arena opened in the browser at ${hub.url} · ${t ? `${t.name}${num && t.id === 'task' ? ` ${num[1]}` : ''} is picked` : 'pick a test'}${t && !t.model ? '' : ` on ${self.model.name}`}, then press Run · while it runs, ${self.model.name} here is unloaded and comes back by itself when it ends`, tone: 'dim' });
        break;
      }
      case 'tests': {
        // The Arena with the test record over it: every test run and its result.
        const hub = self.openHub('arena', { record: '1' }); if (!hub) break;
        const runs = readRecord();
        self.push({ type: 'note', text: runs.length ? `The test record opened in the browser at ${hub.url} · ${runs.length} run${runs.length === 1 ? '' : 's'} recorded, the latest: ${runs[0].name} (${runs[0].total != null ? `${runs[0].passed} of ${runs[0].total}` : runs[0].result}) · it stays up while this window is open` : `The test record opened in the browser at ${hub.url} · no test has been recorded yet`, tone: 'dim' });
        break;
      }
      case 'calc': {
        // The calculator link (web/calc-link.mjs): alone, the hub's Calculator tab and a line on what it is
        // doing; on | off its own background service (off: inside Agentic Coder Web); reconnect; status.
        const { askLink } = await import('../web/calc-link.mjs');
        const { setWhere, statusLines } = await import('../web/calc-cmd.mjs');
        const word = arg.toLowerCase();
        if (word === 'on' || word === 'off') {
          const r = setWhere(word === 'on' ? 'service' : 'web');
          self.push({ type: 'note', text: r.ok ? (word === 'on' ? 'The calculator link runs as its own background service now: it starts with this Mac, web or no web.' : 'The background service is off: the calculator link runs inside Agentic Coder Web again (within 5 s while the web runs).') : r.error, tone: r.ok ? 'dim' : 'warn' });
          break;
        }
        if (word === 'reconnect') {
          const st = await askLink('/reconnect', { method: 'POST' });
          self.push({ type: 'note', text: st ? 'Calculator link: reconnecting now' : "The calculator link is not running: save a login in the hub's Calculator tab (/calc), then run it inside the web or with /calc on.", tone: st ? 'dim' : 'warn' });
          break;
        }
        if (word && word !== 'status') { self.push({ type: 'note', text: "/calc takes on, off, reconnect or status; alone it opens the hub's Calculator tab", tone: 'warn' }); break; }
        const lines = statusLines(await askLink('/status'));
        if (word === 'status') { self.push({ type: 'note', text: lines.join('\n'), tone: 'dim' }); break; }
        const hub = self.openHub('calc'); if (!hub) break;
        self.push({ type: 'note', text: `The calculator link opened in the browser at ${hub.url} · ${lines[0]}`, tone: 'dim' });
        break;
      }
      case 'instructions': {
        const hub = self.openHub('instructions'); if (!hub) break;
        self.push({ type: 'note', text: `Instructions opened at ${hub.url} · saved changes apply to the next task`, tone: 'dim' });
        break;
      }
      case 'weights':
      case 'docs': {
        // The hub in the browser: the same server as `coding weights` / `coding docs`,
        // inside this window. /weights opens it on the models' weights (every model in
        // /model, one alone or side by side), /docs on the harness diagram with
        // structure and every page one tab away.
        const here = Object.values(MODELS).filter((m) => m.format !== 'mlx' && existsSync(modelPath(m)));
        if (cmd === 'weights' && !here.length) { self.push({ type: 'note', text: `No model file is here yet (${modelPath(MODELS[DEFAULT_MODEL])}). Run coding setup first.`, tone: 'warn' }); break; }
        const hub = self.openHub(cmd === 'docs' ? 'harness' : 'weights'); if (!hub) break;
        const w = hub.server; const url = hub.url;
        if (cmd === 'docs') {
          const d = listDocs(w.docsDir);
          self.push({ type: 'note', text: d.missing ? `Docs opened at ${url}, but the DOCS folder was not found (docs/ in the repo; set AGENTIC_DOCS to point elsewhere)` : `Docs opened in the browser at ${url} · ${d.pages.length} pages from ${d.dir.replace(process.env.HOME, '~')}${d.pinned.harness ? ` · harness: ${d.pinned.harness.title}` : ''}${d.pinned.structure ? ` · structure: ${d.pinned.structure.title}` : ''} · it stays up while this window is open`, tone: d.missing ? 'warn' : 'dim' });
        } else self.push({ type: 'note', text: `Weights of ${here.map((m) => m.name).join(' and ')} opened in the browser at ${url} · it stays up while this window is open`, tone: 'dim' });
        break;
      }
    }
  };
}
