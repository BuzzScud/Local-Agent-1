// The cost meter and the Claude API's usage in the window (App.jsx, moved here on 13 Oct 2026 so each file can be
// read whole): the footer's words (spendWatch), "$ left" and /usage worked out again whenever anything spends
// (usageWatch), r in /usage (askUsage) and a value typed in it (saveUsageEdit). self is the App's names, read at
// the moment a function uses them (app-common.mjs liveView); the state and refs these use stay in App.jsx.
import { mkdirSync, watch } from 'node:fs';
import { endpointOf } from '../../../models/index.mjs';
import { spendEvents, spendLabel, windowSpend, spendDir } from '../agent/spend.mjs';
import { usageNow, usageEvents, askLimits, usageDir, saveAdminKey, fetchBill, setOwn as setUsageOwn, dollarsOf, monthOf, clearBill, learnAccount, accountOf } from '../agent/claude-usage.mjs';

export function usagePart(self) {
  // The cost meter (/remote, spend.mjs): the footer's words, after each answer and every 15 s
  // (today's total counts the other windows too).
  const spendWatch = () => {
    const show = () => self.setSpend(spendLabel());
    spendEvents.on('change', show);
    const t = setInterval(() => { if (windowSpend().requests) show(); }, 15_000);
    t.unref?.();
    return () => { spendEvents.off('change', show); clearInterval(t); };
  };
  // The Claude API's usage (claude-usage.mjs): "$61.68 left" in the footer and /usage, while this window
  // runs on the Claude API (9 Oct 2026, the owner: "updated in real time and is true"). Worked out again the
  // moment anything spends: this window's answers (spendEvents), another window's or Anthropic's bill (their
  // files change: a watch on the spend and usage folders), and every 15 s for a new day or a missed change.
  // With an Admin key the bill is read once a minute over every window. Only a change of what shows
  // redraws (a redraw at rest breaks copying text off the screen).
  const usageWatch = () => {
    const claudeModel = self.claudeModel;
    if (!claudeModel) { self.setUsage(null); return undefined; }
    let shown = '';
    // The account of the key in use (19 Nov 2026, the owner: "i just changed the api key but my $ amount stayed the
    // same"): read at each look, so a key changed in /remote counts its own account's dollars at once; a key not
    // seen before is asked for its account for free (learnAccount), and its answer redraws (usageEvents).
    const apiKey = () => { const ep = endpointOf(self.agent.url); return ep?.kind === 'claude' ? ep.key ?? null : undefined; };
    let keyShown;
    const show = () => {
      const k = apiKey();
      keyShown = k;
      const u = usageNow({ model: claudeModel, admin: self.hasAdmin(), key: k });
      if (u.account?.pending && k) learnAccount({ url: self.agent.url, key: k }).catch(() => {});
      const key = JSON.stringify([u.spent.toFixed(2), u.left, u.cap, u.tierCap, u.capped, u.low, u.pace.beforeReset, u.pace.runsOut, u.today, u.window.toFixed(2), u.source, u.balance, u.limits?.at, u.admin, u.account, u.tier]);
      if (key !== shown) { shown = key; self.setUsage(u); }
    };
    const bill = () => { if (self.hasAdmin()) fetchBill().catch(() => {}); };
    let soon = null;
    const later = () => { if (!soon) soon = setTimeout(() => { soon = null; show(); }, 150); };
    const watches = [];
    for (const dir of [spendDir(), usageDir()]) {
      try { mkdirSync(dir, { recursive: true }); const w = watch(dir, { recursive: true }, later); w.on('error', () => {}); watches.push(w); } catch { /* the 15 s look still finds it */ }
    }
    show();
    bill();
    usageEvents.on('change', show);
    spendEvents.on('change', show);
    const t = setInterval(() => { show(); bill(); }, 15_000);
    t.unref?.();
    // A key changed (/remote key, the card's Change API key): the window's connection carries the new one; within a
    // second its account counts, not the old key's (a look at memory only, no file read unless it changed).
    const keyLook = setInterval(() => { if (apiKey() !== keyShown) show(); }, 1000);
    keyLook.unref?.();
    return () => { usageEvents.off('change', show); spendEvents.off('change', show); clearInterval(t); clearInterval(keyLook); clearTimeout(soon); for (const w of watches) { try { w.close(); } catch {} } };
  };
  // r in /usage: one tiny request for the limits now, and Anthropic's bill with an Admin key.
  const askUsage = async () => {
    const url = self.agent.url;
    const ep = endpointOf(url);
    if (!self.claudeModel || ep?.kind !== 'claude') return;
    self.setPicker((p) => (p?.kind === 'usage' ? { ...p, asking: true } : p));
    try { await Promise.all([askLimits({ url, ep }), self.hasAdmin() ? fetchBill({ force: true }) : null]); } catch (e) { self.flash(`could not ask Anthropic: ${String(e.message ?? e).slice(0, 120)}`, 4000); }
    self.setPicker((p) => (p?.kind === 'usage' ? { ...p, asking: false } : p));
  };
  // enter on a value typed in /usage (b your credit balance, l your limit, s the month's spend as the Console shows
  // it, k an Admin key), and /usage balance 201 · /usage limit 200 · /usage spent 112.40. Returns the words said, or null when the value was refused
  // (the box stays open to type it again).
  const saveUsageEdit = (e) => {
    const said = (text, tone = 'dim') => { self.setPicker((p) => (p?.kind === 'usage' ? { ...p, editing: null } : p)); self.push({ type: 'note', text, tone }); return text; };
    const v = e.value.trim();
    if (e.id === 'key') {
      if (v && !/^sk-ant-admin/.test(v)) { self.flash('An Admin key starts sk-ant-admin… (Console → Settings → Admin keys)', 4000); return null; }
      try { saveAdminKey(v || null); } catch (err) { self.flash(`could not keep it: ${String(err.message ?? err).slice(0, 120)}`, 4000); return null; }
      self.adminRef.current = Boolean(v);
      if (!v) { clearBill(); return said('/usage: Admin key taken out. The month’s spend is this Mac’s meter again (or the figure you typed).'); }
      fetchBill({ key: v, force: true }).catch(() => {});
      return said('/usage: Admin key kept in the Keychain. Anthropic’s bill is read once a minute; this Mac’s answers are added the moment they come.');
    }
    const off = !v || /^(off|none|clear)$/i.test(v);
    const usd = off ? null : dollarsOf(v);
    if (!off && usd == null) { self.flash('Type dollars, like 200 or 112.40', 3000); return null; }
    // Kept with the account of the key in use, so another account's key does not count from it (claude-usage.mjs).
    const ep = endpointOf(self.agent.url);
    const org = ep?.kind === 'claude' ? accountOf(ep.key ?? null).org : null;
    const tag = org ? { org } : {};
    if (e.id === 'balance') {
      setUsageOwn({ balance: usd > 0 ? { usd, at: Date.now(), ...tag } : null });
      return said(usd > 0 ? `/usage: your balance is $${usd.toFixed(2)} as of now. "$ left" counts down from it with each answer on this Mac.` : '/usage: your balance taken out; "$ left" counts from your limit, if you set one.');
    }
    if (e.id === 'limit') {
      setUsageOwn({ limit: usd > 0 ? usd : null, limitOrg: usd > 0 ? org : null });
      return said(usd > 0 ? `/usage: your limit is $${usd.toFixed(2)} a month. "$ left" counts down from it.` : '/usage: your own limit taken out.');
    }
    setUsageOwn({ spent: off ? null : { usd, at: Date.now(), month: monthOf(), ...tag } });
    return said(off ? '/usage: the typed figure taken out; the month’s spend is this Mac’s meter again.' : `/usage: this month’s spend is $${usd.toFixed(2)} as of now; this Mac’s answers are added to it as they come.`);
  };
  return { spendWatch, usageWatch, askUsage, saveUsageEdit };
}
