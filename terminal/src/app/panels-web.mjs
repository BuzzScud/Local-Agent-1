// The window's panels, /web: what the model may do on the web (app-panels.mjs puts the parts together).
// Moved from app-panels.mjs word for word; a name from another part is read through own.
import { saveKey, removeKey } from '../../../models/index.mjs';
import { openWebForm, testWebForm, webWarning, toWebSettings, webSettings, searchKeyId } from './web-form.mjs';
import { PROVIDER_NAMES } from '../tools/web.mjs';
import { saveSettings } from './store.mjs';

export function panelsWeb(self, own) {
  // ---- /web: what the model may do on the web (web-form.mjs, tools/web.mjs) ----
  const openWebPicker = () => self.setPicker(openWebForm(self.settings.web, { claude: self.model.remote?.kind === 'claude' }));
  const runWebTest = (pk) => {
    const id = (self.remoteRef.current.tests = (self.remoteRef.current.tests ?? 0) + 1);
    self.setPicker({ ...pk, test: { running: true, id }, error: null });
    testWebForm(pk).then((res) => self.setPicker((p) => (p?.kind !== 'web' || p.test?.id !== id ? p : { ...p, test: { ...res, id } })));
  };
  // Save: the search service's key to the Keychain (its own entry), the rest to settings.json.
  // The tools change with it, so the next reply reads the instructions again.
  const saveWeb = (pk) => {
    if (webWarning(pk)?.tone === 'error') { self.setPicker({ ...pk, error: 'Nothing was saved: fix the line above first.' }); return; }
    const v = pk.values;
    if (v.search !== 'off' && pk.key !== null) {
      try { if (pk.key) saveKey(pk.key, searchKeyId(v.search), 'Agentic Coder web search'); else removeKey(searchKeyId(v.search)); } catch (e) { self.setPicker({ ...pk, error: `Nothing was saved: the key could not be kept (${e.message}).` }); return; }
    }
    const w = toWebSettings(pk);
    self.setPicker(null);
    self.settings.web = saveSettings({ web: w }).web;
    self.agent.web = webSettings(self.settings.web);
    self.push({ type: 'note', text: `Web saved: ${w.search === 'off' ? 'no search' : `search with ${PROVIDER_NAMES[w.search]}${w.keys[w.search] ? '' : ' (no key yet)'}`} · ${w.fetch ? 'pages can be read, each site asked about first' : 'no pages read'}${self.model.remote?.kind === 'claude' ? ` · on the Claude API: ${w.claude ? 'Claude’s own web tools' : 'none'}` : ''}.`, tone: 'dim' });
  };
  return { openWebPicker, runWebTest, saveWeb };
}
