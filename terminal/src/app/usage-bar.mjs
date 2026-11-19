// The Claude API's usage drawn (8 Oct 2026, the owner's pick "1 · Fuel line": "use design 1 and
// ensure proper spacing and uniformity"; 9 Oct 2026, "3 · One row": the line under the footer is gone and
// "$61.68 left" sits in the footer's right side, usageChip): the footer's words and the /usage card. Pure:
// screen.jsx draws the rows this returns, and the tests read them. The numbers are claude-usage.mjs
// usageNow()'s. Since 19 Nov 2026 (the owner: "remove the balance overall from the agentic coder") no dollars
// "left" anywhere: the footer has none, the card the month's dollars spent.
//   - The meters of THIS MINUTE are the old fuel line, in a gradient that brightens to its head.
//   - The card's borders are the prompt box's (the whole width), its text one cell in, as the other panels.
//     Each label takes one column, the numbers end at one edge, and a section is one blank row from the next.
//   - While a reply runs a shine sweeps the line and its head blinks; at rest it holds still (a
//     redraw at rest would break copying text off the screen).
// A row is a list of { t: text, fg, bg, b }: colours as xterm-256 numbers, bg null for none.
import { HUE } from '../ui/theme.mjs';

const S = (t, fg = 252, bg = null, b = false) => ({ t, fg, bg, b });
export const widthOf = (segs) => segs.reduce((n, s) => n + [...s.t].length, 0);
export const textOf = (segs) => segs.map((s) => s.t).join('');
const gap = (n) => (n > 0 ? [S(' '.repeat(n))] : []);
function cut(segs, n) {
  const out = [];
  let left = n;
  for (const s of segs) {
    if (left <= 0) break;
    const ch = [...s.t];
    out.push(ch.length <= left ? s : { ...s, t: ch.slice(0, left).join('') });
    left -= Math.min(ch.length, left);
  }
  return out;
}
// Exactly n cells: cut, or filled out with spaces.
const exact = (segs, n) => { const c = cut(segs, n); return [...c, ...gap(n - widthOf(c))]; };

const money = (v) => `$${v.toFixed(2)}`;
const money0 = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString('en-US'));
const dayUtc = (ms) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const ago = (ms) => (ms < 90e3 ? `${Math.max(1, Math.round(ms / 1e3))} s ago` : ms < 5400e3 ? `${Math.round(ms / 60e3)} min ago` : ms < 129600e3 ? `${Math.round(ms / 3600e3)} h ago` : `${Math.round(ms / 86400e3)} days ago`);

// The colours: the line's three ramps (plenty: the app's own blue, a quarter to a half left, under
// a fifth), each with the shine that sweeps it; today's amber, the faint line, the card's border, the words.
const BLUE = [17, 24, 25, 31, 32, 38, 74, 117];
const AMBER = [94, 130, 136, 172, 178, 214, 220, 221];
const RED = [52, 88, 124, 160, 196, 203, 210];
const rampOf = (f) => (f > 0.5 ? BLUE : f > 0.2 ? AMBER : RED);
const SHINE = new Map([[BLUE, 195], [AMBER, 230], [RED, 224]]);
const C = { diamond: 173, value: 255, text: 252, dim: 245, sep: 240, faint: 237, today: 94, warn: 215, bad: 203, ok: HUE.accent, label: 244, border: 240 };

// The limits as of now: each part's room (a bucket past its reset is full again), and the tightest.
function rateOf(limits, now = Date.now()) {
  if (!limits) return null;
  const parts = ['requests', 'input', 'output'].filter((k) => limits[k]).map((k) => {
    const p = limits[k];
    const full = p.reset <= now;
    const remaining = full ? p.limit : p.remaining;
    return { k, limit: p.limit, remaining, frac: remaining / p.limit, secs: full ? 0 : Math.ceil((p.reset - now) / 1000) };
  });
  if (!parts.length) return null;
  const low = parts.reduce((a, b) => (b.frac < a.frac ? b : a));
  return { parts, pct: Math.floor(low.frac * 100), secs: Math.max(...parts.map((p) => p.secs)) };
}

// The fuel line, w cells. left/today: shares of the cap. live: a reply is running (the shine).
function fuelLine(w, left, today, { now = Date.now(), live = false } = {}) {
  const f = Math.max(0, Math.min(1, left));
  const ramp = rampOf(f);
  const filled = f * w;
  const n = Math.floor(filled);
  const half = filled - n >= 0.5 && n < w;
  const todayN = Math.min(w - n - (half ? 1 : 0), Math.max(today > 0 ? 1 : 0, Math.round(Math.max(0, today) * w)));
  const shine = live ? Math.round(((now % 1600) / 1600) * (n + 6)) - 3 : -99;
  const blink = live && Math.floor(now / 450) % 2 === 0;
  const out = [];
  for (let i = 0; i < w; i++) {
    if (i < n) {
      const head = i === n - 1;
      let fg = ramp[Math.min(ramp.length - 1, Math.floor((i / Math.max(1, n)) * ramp.length))];
      if (Math.abs(i - shine) <= 1) fg = SHINE.get(ramp);
      if (head) fg = blink ? 231 : ramp.at(-1);
      out.push(S('━', fg, null, head));
    } else if (i === n && half) out.push(S('╸', ramp.at(-1)));
    else if (i < n + (half ? 1 : 0) + todayN) out.push(S('━', C.today));
    else out.push(S('─', C.faint));
  }
  // Runs of one colour as one piece each (fewer pieces for Ink to draw).
  return out.reduce((acc, s) => { const last = acc.at(-1); if (last && last.fg === s.fg && last.b === s.b) last.t += s.t; else acc.push({ ...s }); return acc; }, []);
}
const thinMeter = (w, frac) => fuelLine(w, frac, 0);

// The footer's words on the Claude API (the owner's pick "3 · One row", 9 Oct 2026): "$61.68 left", amber when
// the month runs out before the 1st at its pace, red under a tenth of the cap left, "paused" at the cap;
// "$138.32 this month" with no cap known. The footer puts it after the model's name (screen.jsx).
// The key in use's name first, when it has one (/key name: "Work · paused").
// No dollars since 19 Nov 2026 (the owner, on "$168.88 left of $200": "the amount is wrong", then "remove the
// balance overall from the agentic coder"): the footer says only the key's name, and "paused" at the cap.
export function usageChip(u) {
  if (u.capped) return [...(u.account?.name ? [S(u.account.name, C.text), S(' · ', C.dim)] : []), S('paused', C.bad, null, true)];
  return u.account?.name ? [S(u.account.name, C.text)] : [];
}

// Where the month's spend comes from, in words (the card's last row). since: this Mac's answers after it.
export function sourceWords(u, now = Date.now(), wide = true) {
  const s = u.source ?? { kind: 'meter' };
  const plus = s.since > 0.005 ? ` + ${money(s.since)} this Mac since` : ' + this Mac since';
  if (s.kind === 'bill') return `spent: Anthropic’s bill, read ${ago(now - s.at)}${plus}`;
  if (s.kind === 'typed') return `spent: the ${money(s.usd)} you typed ${ago(now - s.at)}${plus}${wide ? ' · other Macs after it not counted' : ''}`;
  return wide ? 'spent: this Mac’s meter only · s types the Console’s figure, k adds an Admin key for Anthropic’s bill' : 'spent: this Mac’s meter · s or k to match the Console';
}

// Whose dollars these are (19 Nov 2026): the account of the key in use, or a new key's being checked; and the
// month's dollars from before accounts were kept, which no account counts. Its lines: none while no account is known.
export function accountWords(u, wide = true) {
  const a = u.account;
  if (a?.pending) return [wide ? 'account: checking which account the new key belongs to · nothing counted until it answers' : 'account: checking the new key…'];
  if (!a?.orgEnd) return [];
  const who = a.name ? `${a.name}, ` : '';
  const out = [wide ? `account: ${who}organization …${a.orgEnd}, the key in use’s · only its dollars count${u.keys?.length > 1 ? ' · /key switches' : ''}` : `account ${who}…${a.orgEnd} · its dollars only`];
  if (a.earlier > 0.005) out.push(wide ? `${money(a.earlier)} earlier this month came before keys were told apart: not counted` : `${money(a.earlier)} earlier: not counted`);
  return out;
}

const SPARK = '▁▂▃▄▅▆▇█';
function spark(values) {
  const max = Math.max(...values, 0.01);
  return values.map((v, i) => S(v > 0 ? SPARK[Math.max(1, Math.min(7, Math.round((v / max) * 7)))] : '▁', i === values.length - 1 ? 221 : v > 0 ? 179 : 238));
}

// The CACHE row (13 Oct 2026): how much of what went to Claude came from its prompt cache (a read from it
// costs 5% on Opus 5.5), today and over 14 days, and the dollars that saved. Amber under half: a cache
// that keeps missing is worth a look. Before the first kept answer it says what the row will show.
const share = (c) => Math.round((100 * c.hit) / c.sent);
export function cacheWords(cache, wide = true) {
  const today = cache?.today, all = cache?.last14;
  if (!all?.sent) return [S(wide ? 'the share of each request read from Claude’s cache shows here after the next reply' : 'shows after the next reply', C.dim)];
  const days = wide ? ` · 14 days ${share(all)}%, saved ${money(all.saved)}` : ` · 14 d ${share(all)}%`;
  if (!today?.sent) return [S('nothing sent today', C.dim), S(days, C.dim)];
  return [S(`${share(today)}%`, share(today) < 50 ? C.warn : C.value, null, true), S(wide ? ` of what was sent today came from the cache · saved ${money(today.saved)}` : ` from the cache today · saved ${money(today.saved)}`, C.dim), S(days, C.dim)];
}

// The /usage card: the whole width, round corners, the title in the top border, text one cell in.
// Sections a blank row apart: THIS MONTH (the line), TODAY and 14 DAYS, THIS MINUTE (a meter a
// limit), then where the numbers come from. Every row is exactly `width` cells.
export const LABEL_W = 14;
// edit: a value being typed ({ id: 'spent' | 'key', value, cursor }), shown as the card's last row.
const USAGE_EDITS = {
  spent: 'Spent this month, as the Console’s Cost page shows it ($)',
  key: 'Admin key (sk-ant-admin…, Console → Settings → Admin keys; empty takes it out)',
};
// /key add <name> (19 Nov 2026): another Claude API key, pasted in the last row, hidden but its last four.
const newKeyWords = (name, wide) => (wide ? `Another Claude API key${name ? ` for ${name}` : ''} (sk-ant-…, console.anthropic.com → API keys): enter checks it with Anthropic, then keeps it in the Keychain`
  : `Another Claude API key${name ? ` for ${name}` : ''} (sk-ant-…): enter checks and keeps it`);
export function usagePanel(u, width, { now = Date.now(), live = false, asking = false, edit = null } = {}) {
  const inner = width - 4;
  const B = u.capped ? C.bad : C.border;
  const wide = inner >= 80;
  const rows = [];
  const line = (segs) => rows.push([S('│', B), S(' '), ...exact(segs, inner), S(' '), S('│', B)]);
  const blank = () => line([]);
  const label = (t) => S(t.padEnd(LABEL_W), C.label, null, true);
  // Left and right in one row: the right part ends at the card's inner edge.
  const lr = (a, b) => [...a, ...gap(inner - widthOf(a) - widthOf(b)), ...b];
  const title = [S('╭─ ', B), S('◆', C.diamond), S(' Usage', C.value, null, true), S(` · Claude API · ${u.modelName} `, C.dim)];
  // The keys in the top border, the longest that fits (b balance and l limit went on 19 Nov 2026).
  const fits = (t) => widthOf(title) + t.length + 3 <= width;
  const keyWords = [' r refresh · s spent · k admin key · esc ', ' r · s · k · esc '].find(fits) ?? ' r · s · k · esc ';
  const keys = [S(asking ? ' asking Anthropic… ' : edit ? ' enter saves · esc back ' : keyWords, C.sep), S('─╮', B)];
  rows.push([...title, S('─'.repeat(Math.max(1, width - widthOf(title) - widthOf(keys))), B), ...keys]);
  blank();
  // The month's dollars spent, never what is "left" (19 Nov 2026, the owner: "remove the balance overall").
  const capped = Boolean(u.capped);
  line(lr([label('THIS MONTH'), S(u.monthName, C.dim)], capped ? [S('paused', C.bad, null, true), S(` · back ${dayUtc(u.resetsOn)} (UTC)`, C.dim)] : [S(money(u.spent), C.value, null, true), S(' spent', C.dim)]));
  line([S('─'.repeat(inner), capped ? C.bad : C.faint)]);
  line([S(`${money(u.spent)} spent`, C.text), S(` · resets ${dayUtc(u.resetsOn)} (UTC)`, C.dim)]);
  if (capped) line([S('■ ', C.bad), S(u.capped.kind === 'own' ? 'Your own spend limit (set in the Console) is reached: raise it there, or wait for the 1st' : `The ${money0(u.tierCap ?? 0)} is used: the Claude API answers again on ${dayUtc(u.resetsOn)}, or raise the limit in the Console`, C.bad)]);
  blank();
  line([label('TODAY'), S(money(u.today.usd), C.value, null, true), S(` on this Mac · ${u.today.windows} window${u.today.windows === 1 ? '' : 's'} · this window ${money(u.window)}`, C.dim)]);
  line([label('14 DAYS'), ...spark(u.last14), S(`  ${money(u.last14.reduce((a, b) => a + b, 0))}`, C.dim)]);
  line([label('CACHE'), ...cacheWords(u.cache, wide)]);
  blank();
  line([label('THIS MINUTE'), S(wide ? `Anthropic’s limits for ${u.modelName} · they refill all the time` : 'Anthropic’s limits · they refill all the time', C.dim)]);
  const r = rateOf(u.limits, now);
  if (r) {
    // One column of words for the three, so the meters end together and the words at the edge.
    const words = r.parts.map((p) => `${tok(p.remaining)} of ${tok(p.limit)}${p.k === 'requests' ? '' : ' tokens'}${p.secs ? ` · full in ${p.secs}s` : ''}`);
    const wordsW = Math.max(...words.map((w) => w.length));
    const meterW = Math.max(6, inner - LABEL_W - 2 - wordsW);
    r.parts.forEach((p, i) => line([S(p.k.padEnd(LABEL_W), C.dim), ...thinMeter(meterW, p.frac), ...gap(2), S(words[i].padStart(wordsW), C.text)]));
  } else line([S(''.padEnd(LABEL_W)), S('nothing yet: a reply brings them, or r asks now (a fraction of a cent)', C.dim)]);
  blank();
  line([S(sourceWords(u, now, wide), C.sep)]);
  for (const t of accountWords(u, wide)) line([S(t, u.account.pending ? C.warn : C.sep)]);
  if (u.source?.stale) line([S('▲ ', C.warn), S(wide ? `the figure you typed is ${u.source.days} days old: s types the Console’s figure again` : `typed ${u.source.days} days ago · s to update`, C.warn)]);
  if (u.source?.error) line([S('■ ', C.warn), S(`Anthropic’s bill: ${u.source.error.status ? `${u.source.error.status} · ` : ''}${u.source.error.message}${u.source.error.status === 401 || u.source.error.status === 403 ? ' (k: the key again)' : ''}`, C.warn)]);
  else if (u.admin && u.source?.kind !== 'bill') line([S('asking Anthropic for the bill…', C.sep)]);
  line([S(wide ? `limits from Anthropic’s last reply${u.limits ? `, ${ago(now - u.limits.at)}` : ''}` : `limits: last reply${u.limits ? `, ${ago(now - u.limits.at)}` : ''}`, C.sep)]);
  if (edit) {
    // The value being typed: a key shows its last four only.
    const secret = edit.id === 'key' || edit.id === 'newkey';
    const shown = secret ? (edit.value ? `${'•'.repeat(Math.min(12, edit.value.length))}${edit.value.length >= 12 ? edit.value.slice(-4) : ''}` : '') : edit.value;
    blank();
    line([S(edit.id === 'newkey' ? newKeyWords(edit.name, wide) : USAGE_EDITS[edit.id], C.text)]);
    line([S('› ', C.ok), S(shown, C.value, null, true), S('▌', C.ok)]);
  }
  rows.push([S('╰', B), S('─'.repeat(width - 2), B), S('╯', B)]);
  return rows;
}
