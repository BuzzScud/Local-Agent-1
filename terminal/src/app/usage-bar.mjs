// The Claude API's usage drawn (8 Oct 2026, the owner's pick "1 · Fuel line": "use design 1 and
// ensure proper spacing and uniformity"; 9 Oct 2026, "3 · One row": the line under the footer is gone and
// "$61.68 left" sits in the footer's right side, usageChip): the footer's words and the /usage card. Pure:
// screen.jsx draws the rows this returns, and the tests read them. The numbers are claude-usage.mjs
// usageNow()'s.
//   - The card's line is what is LEFT of the month's cap, from the left, in a gradient that brightens to
//     its head; then today's spend in amber, then what was spent before today, faint.
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
// A cap as you set it: whole dollars, or with its cents when it has some.
const capMoney = (v) => (Number.isInteger(v) ? money0(v) : money(v));
const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString('en-US'));
const day = (ms) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric' });
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
export function rateOf(limits, now = Date.now()) {
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
export function fuelLine(w, left, today, { now = Date.now(), live = false } = {}) {
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
// A figure typed days ago adds "(3 d old)" in amber: /usage, then s, types it again.
export function usageChip(u) {
  if (u.capped) return [S('paused', C.bad, null, true)];
  const old = u.source?.stale ? [S(` (${u.source.days} d old)`, C.warn)] : [];
  if (u.cap == null) return [S(money(u.spent), C.value, null, true), S(' this month', C.dim), ...old];
  const tone = u.low ? C.bad : u.pace.beforeReset ? C.warn : null;
  return [S(money(u.left), tone ?? C.value, null, true), S(' left', tone ?? C.dim), ...old];
}

// Where the month's spend comes from, in words (the card's last row). since: this Mac's answers after it.
export function sourceWords(u, now = Date.now(), wide = true) {
  const s = u.source ?? { kind: 'meter' };
  const plus = s.since > 0.005 ? ` + ${money(s.since)} this Mac since` : ' + this Mac since';
  if (s.kind === 'bill') return `spent: Anthropic’s bill, read ${ago(now - s.at)}${plus}`;
  if (s.kind === 'typed') return `spent: the ${money(s.usd)} you typed ${ago(now - s.at)}${plus}${wide ? ' · other Macs after it not counted' : ''}`;
  return wide ? 'spent: this Mac’s meter only · s types the Console’s figure, k adds an Admin key for Anthropic’s bill' : 'spent: this Mac’s meter · s or k to match the Console';
}

const SPARK = '▁▂▃▄▅▆▇█';
function spark(values) {
  const max = Math.max(...values, 0.01);
  return values.map((v, i) => S(v > 0 ? SPARK[Math.max(1, Math.min(7, Math.round((v / max) * 7)))] : '▁', i === values.length - 1 ? 221 : v > 0 ? 179 : 238));
}

// The /usage card: the whole width, round corners, the title in the top border, text one cell in.
// Sections a blank row apart: THIS MONTH (the line), TODAY and 14 DAYS, THIS MINUTE (a meter a
// limit), then where the numbers come from. Every row is exactly `width` cells.
export const LABEL_W = 14;
// edit: a value being typed ({ id: 'limit' | 'spent' | 'key', value, cursor }), shown as the card's last row.
export const USAGE_EDITS = {
  limit: 'Your limit, as set in the Console ($ a month; 0 takes it out)',
  spent: 'Spent this month, as the Console’s Cost page shows it ($)',
  key: 'Admin key (sk-ant-admin…, Console → Settings → Admin keys; empty takes it out)',
};
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
  const keys = [S(asking ? ' asking Anthropic… ' : edit ? ' enter saves · esc back ' : wide ? ' r refresh · l limit · s spent · k admin key · esc ' : ' r · l · s · k · esc ', C.sep), S('─╮', B)];
  rows.push([...title, S('─'.repeat(Math.max(1, width - widthOf(title) - widthOf(keys))), B), ...keys]);
  blank();
  const capped = Boolean(u.capped);
  const known = u.cap != null;
  line(lr([label('THIS MONTH'), S(u.monthName, C.dim)], capped ? [S('paused', C.bad, null, true), S(` · back ${dayUtc(u.resetsOn)} (UTC)`, C.dim)] : known ? [S(money(u.left), u.low ? C.bad : u.pace.beforeReset ? C.warn : C.value, null, true), S(` left of ${capMoney(u.cap)}${u.ownLimit ? ', your limit' : ''}`, C.dim)] : [S(money(u.spent), C.value, null, true), S(' spent', C.dim)]));
  line(capped ? [S('─'.repeat(inner), C.bad)] : known ? fuelLine(inner, u.left / u.cap, Math.min(u.spent, u.today.usd) / u.cap, { now, live }) : [S('─'.repeat(inner), C.faint)]);
  const capWords = u.ownLimit ? (u.tierCap && wide ? ` · your limit (the ${u.tier} tier allows ${capMoney(u.tierCap)})` : ' · your limit') : known ? ` · ${u.tier}-tier cap · l sets your own` : ' · l sets your limit';
  line(lr([S(`${money(u.spent)} spent`, C.text), S(`${capWords} · resets ${dayUtc(u.resetsOn)} (UTC)`, C.dim)], known && wide ? [S('━', C.today), S(' today  ', C.dim), S('─', C.sep), S(' before', C.dim)] : []));
  if (capped) line([S('■ ', C.bad), S(u.capped.kind === 'own' ? 'Your own spend limit (set in the Console) is reached: raise it there, or wait for the 1st' : `The ${money0(u.cap ?? 0)} is used: the Claude API answers again on ${dayUtc(u.resetsOn)}, or raise the limit in the Console`, C.bad)]);
  else if (u.pace.beforeReset) line([S('▲ ', C.warn), S(wide ? `at ~${money0(u.pace.perDay)} a day it runs out around ${day(u.pace.runsOut)}, and the API stops until ${dayUtc(u.resetsOn)}` : `at ~${money0(u.pace.perDay)}/day it runs out ~${day(u.pace.runsOut)}, then stops until ${dayUtc(u.resetsOn)}`, C.warn)]);
  else if (known && u.pace.perDay > 0) line([S('✓ ', C.ok), S(`at ~${money0(u.pace.perDay)} a day it lasts the month`, C.dim)]);
  blank();
  line([label('TODAY'), S(money(u.today.usd), C.value, null, true), S(` on this Mac · ${u.today.windows} window${u.today.windows === 1 ? '' : 's'} · this window ${money(u.window)}`, C.dim)]);
  line([label('14 DAYS'), ...spark(u.last14), S(`  ${money(u.last14.reduce((a, b) => a + b, 0))}`, C.dim)]);
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
  if (u.source?.stale) line([S('▲ ', C.warn), S(wide ? `the figure you typed is ${u.source.days} days old: s types the Console’s figure again` : `typed ${u.source.days} days ago · s to update`, C.warn)]);
  if (u.source?.error) line([S('■ ', C.warn), S(`Anthropic’s bill: ${u.source.error.status ? `${u.source.error.status} · ` : ''}${u.source.error.message}${u.source.error.status === 401 || u.source.error.status === 403 ? ' (k: the key again)' : ''}`, C.warn)]);
  else if (u.admin && u.source?.kind !== 'bill') line([S('asking Anthropic for the bill…', C.sep)]);
  line([S(wide ? `limits from Anthropic’s last reply${u.limits ? `, ${ago(now - u.limits.at)}` : ''}` : `limits: last reply${u.limits ? `, ${ago(now - u.limits.at)}` : ''}`, C.sep)]);
  if (edit) {
    // The value being typed: a key shows its last four only.
    const shown = edit.id === 'key' ? (edit.value ? `${'•'.repeat(Math.min(12, edit.value.length))}${edit.value.length >= 12 ? edit.value.slice(-4) : ''}` : '') : edit.value;
    blank();
    line([S(USAGE_EDITS[edit.id], C.text)]);
    line([S('› ', C.ok), S(shown, C.value, null, true), S('▌', C.ok)]);
  }
  rows.push([S('╰', B), S('─'.repeat(width - 2), B), S('╯', B)]);
  return rows;
}
