// The Claude API's usage drawn (8 Oct 2026, the owner's pick "1 · Fuel line": "use design 1 and
// ensure proper spacing and uniformity"): the bar under the footer and the /usage card. Pure:
// screen.jsx draws the rows this returns, and the tests read them. The numbers are claude-usage.mjs
// usageNow()'s.
//   - The line is what is LEFT of the month's cap, from the left, in a gradient that brightens to
//     its head; then today's spend in amber, then what was spent before today, faint.
//   - Every row has the same ends: the bar starts and ends where the footer above it does (two cells
//     in), and the card's borders are the prompt box's (the whole width), its text one cell in, as
//     the other panels. In the card each label takes one column, the numbers end at one edge, and a
//     section is one blank row from the next.
//   - While a reply runs a shine sweeps the line and its head blinks; at rest it holds still (a
//     redraw at rest would break copying text off the screen).
// A row is a list of { t: text, fg, bg, b }: colours as xterm-256 numbers, bg null for none.

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
const day = (ms) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric' });
const dayUtc = (ms) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const ago = (ms) => (ms < 90e3 ? `${Math.max(1, Math.round(ms / 1e3))} s ago` : ms < 5400e3 ? `${Math.round(ms / 60e3)} min ago` : ms < 129600e3 ? `${Math.round(ms / 3600e3)} h ago` : `${Math.round(ms / 86400e3)} days ago`);

// The colours: the line's three ramps (plenty, a quarter to a half left, under a fifth), each
// with the shine that sweeps it; today's amber, the faint line, the card's border, the words.
const GREEN = [23, 29, 30, 36, 37, 43, 79, 115];
const AMBER = [94, 130, 136, 172, 178, 214, 220, 221];
const RED = [52, 88, 124, 160, 196, 203, 210];
const rampOf = (f) => (f > 0.5 ? GREEN : f > 0.2 ? AMBER : RED);
const SHINE = new Map([[GREEN, 195], [AMBER, 230], [RED, 224]]);
const C = { diamond: 173, value: 255, text: 252, dim: 245, sep: 240, faint: 237, today: 94, warn: 215, bad: 203, ok: 114, label: 244, border: 240 };
const rateColor = (pct) => (pct >= 50 ? C.ok : pct >= 20 ? C.warn : C.bad);

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

// The bar under the footer: "◆ ━━━━━━━━━──  $433.44 left of $500 · today $56.71 · out by Oct 22
// at ~$33/day · limits 100%". width: the window's; it starts and ends two cells in, as the footer.
// The words shorten as the window narrows; the line always stays (at least MIN_LINE cells).
export const MIN_LINE = 12;
export function usageRow(u, width, { now = Date.now(), live = false } = {}) {
  const avail = width - 4;
  const r = rateOf(u.limits, now);
  const capped = Boolean(u.capped);
  const known = u.cap != null;
  const sep = S(' · ', C.sep);
  const moneyLong = capped ? [S('paused', C.bad, null, true), sep, S(`cap reached · back ${dayUtc(u.resetsOn)}`, C.dim)]
    : known ? [S(money(u.left), C.value, null, true), S(' left', C.dim), S(` of ${money0(u.cap)}`, C.dim)]
      : [S(money(u.spent), C.value, null, true), S(' this month', C.dim)];
  const moneyShort = capped ? [S('paused', C.bad, null, true)] : known ? [S(money0(u.left), C.value, null, true), S(' left', C.dim)] : [S(money0(u.spent), C.value, null, true), S(' this month', C.dim)];
  const today = [sep, S('today ', C.dim), S(money(u.today.usd), C.text)];
  const warn = !capped && u.pace.beforeReset;
  const paceLong = warn ? [sep, S(`out by ${day(u.pace.runsOut)}`, C.warn), S(` at ~${money0(u.pace.perDay)}/day`, C.dim)] : [];
  const paceShort = warn ? [sep, S(`out ${day(u.pace.runsOut)}`, C.warn)] : [];
  const rate = r ? [sep, S('limits ', C.dim), S(`${r.pct}%`, rateColor(r.pct)), ...(r.secs ? [S(` · full in ${r.secs}s`, C.dim)] : [])] : [];
  const capNote = known || capped ? [] : [sep, S('the cap shows after a reply', C.dim)];
  const tries = [[moneyLong, today, paceLong, rate, capNote], [moneyLong, today, paceLong, capNote], [moneyLong, today, paceShort], [moneyLong, paceShort], [moneyShort, paceShort], [moneyShort]];
  const mark = [S('◆', C.diamond), S(' ')];
  let words = tries.at(-1).flat();
  // The line keeps a fifth of the row at least, so a wide window gives it room before more words.
  const least = Math.max(MIN_LINE, Math.round(avail * 0.2));
  for (const t of tries) { const w = t.flat(); if (avail - widthOf(mark) - 2 - widthOf(w) >= least) { words = w; break; } }
  const lineW = Math.max(1, avail - widthOf(mark) - 2 - widthOf(words));
  const line = capped ? [S('─'.repeat(lineW), C.bad)] : known ? fuelLine(lineW, u.left / u.cap, Math.min(u.spent, u.today.usd) / u.cap, { now, live }) : [S('─'.repeat(lineW), C.faint)];
  return [...gap(2), ...exact([...mark, ...line, ...gap(2), ...words], avail), ...gap(2)];
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
export function usagePanel(u, width, { now = Date.now(), live = false, asking = false } = {}) {
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
  const keys = [S(asking ? ' asking Anthropic… ' : ' r refresh · esc close ', C.sep), S('─╮', B)];
  rows.push([...title, S('─'.repeat(Math.max(1, width - widthOf(title) - widthOf(keys))), B), ...keys]);
  blank();
  const capped = Boolean(u.capped);
  const known = u.cap != null;
  line(lr([label('THIS MONTH'), S(u.monthName, C.dim)], capped ? [S('paused', C.bad, null, true), S(` · back ${dayUtc(u.resetsOn)} (UTC)`, C.dim)] : known ? [S(money(u.left), C.value, null, true), S(` left of ${money0(u.cap)}`, C.dim)] : [S(money(u.spent), C.value, null, true), S(' spent', C.dim)]));
  line(capped ? [S('─'.repeat(inner), C.bad)] : known ? fuelLine(inner, u.left / u.cap, Math.min(u.spent, u.today.usd) / u.cap, { now, live }) : [S('─'.repeat(inner), C.faint)]);
  line(lr([S(`${money(u.spent)} spent`, C.text), S(known ? ` · ${u.tier}-tier cap · resets ${dayUtc(u.resetsOn)} (UTC)` : ' · the cap shows after a reply', C.dim)], known && wide ? [S('━', C.today), S(' today  ', C.dim), S('─', C.sep), S(' before', C.dim)] : []));
  if (capped) line([S('■ ', C.bad), S(u.capped.kind === 'own' ? 'Your own spend limit (set in the Console) is reached: raise it there, or wait for the 1st' : `The ${money0(u.cap ?? 0)} is used: the Claude API answers again on ${dayUtc(u.resetsOn)}, or raise the limit in the Console`, C.bad)]);
  else if (u.pace.beforeReset) line([S('▲ ', C.warn), S(wide ? `at ~${money0(u.pace.perDay)} a day it runs out around ${day(u.pace.runsOut)}, and the API stops until ${dayUtc(u.resetsOn)}` : `at ~${money0(u.pace.perDay)}/day it runs out ~${day(u.pace.runsOut)}, then stops until ${dayUtc(u.resetsOn)}`, C.warn)]);
  else if (known && u.pace.perDay > 0) line([S('✓ ', C.ok), S(`at ~${money0(u.pace.perDay)} a day it lasts the month`, C.dim)]);
  blank();
  line([label('TODAY'), S(money(u.today.usd), C.value, null, true), S(` · ${u.today.windows} window${u.today.windows === 1 ? '' : 's'} · this window ${money(u.window)}`, C.dim)]);
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
  line([S(wide ? `spend counted by Agentic Coder on this Mac · limits from Anthropic’s last reply${u.limits ? `, ${ago(now - u.limits.at)}` : ''}` : `spend: Agentic Coder’s meter · limits: last reply${u.limits ? `, ${ago(now - u.limits.at)}` : ''}`, C.sep)]);
  rows.push([S('╰', B), S('─'.repeat(width - 2), B), S('╯', B)]);
  return rows;
}
