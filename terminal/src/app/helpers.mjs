// /helpers: the context helpers (agent/helpers.mjs), numbered and by codename
// (Scout, Medic, Oracle, Sentry), each on or off with one line on what it
// brings and what it brought to the last request. "/helpers off 3",
// "/helpers off oracle", "/helpers on rag" (its id), "/helpers off all" switch them, kept in
// settings.json ("helpers": the ones on) so they last; the next message uses
// them. AGENTIC_HELPERS, when set, decides instead (practice runs set it), and
// /helpers says so rather than change nothing quietly.
import { HELPER_NAMES, HELPER_OF, CODENAMES, helpersOn } from '../agent/helpers.mjs';

export const HELPER_INFO = [
  { name: 'named', label: 'Files you name', what: 'read whole before the first step (Read first)' },
  { name: 'tests', label: 'Tests and changes', what: 'on a fix request: the failing tests first, and what is not committed yet' },
  { name: 'rag', label: 'Code by meaning', what: 'the closest files read first, then the closest functions of long ones (bge-m3)' },
  { name: 'lsp', label: 'Light checks', what: 'a syntax check after every edit; where the names you use are defined and used' },
].map((h) => ({ ...h, code: CODENAMES[h.name] }));
const CODE_W = Math.max(...HELPER_INFO.map((h) => h.code.length));

export const helpersEnv = (env = process.env) => env.AGENTIC_HELPERS ?? env.BONSAI_HELPERS;

// Which are on: AGENTIC_HELPERS when set, else settings.json's "helpers", else all four.
export function helpersFrom(settings = {}, env = process.env) {
  if (helpersEnv(env) !== undefined) return helpersOn(helpersEnv(env));
  if (Array.isArray(settings.helpers)) return helpersOn(settings.helpers);
  return helpersOn('all');
}

// "/helpers <on|off> <number|codename|name|all>" → { on, changed, text, tone }.
export function changeHelpers(on, what, arg, env = process.env) {
  const set = helpersEnv(env);
  if (set !== undefined) return { text: `AGENTIC_HELPERS=${set} is set where Agentic Coder started, so it decides which helpers are on. Start it without that (unset AGENTIC_HELPERS) to switch them here.`, tone: 'warn' };
  if (what !== 'on' && what !== 'off') return { text: 'Say on or off, and which one: /helpers off 3, /helpers on oracle, /helpers off all.', tone: 'warn' };
  const a = String(arg ?? '').trim().toLowerCase();
  if (!a) return { text: `Say which one: /helpers ${what} 3, /helpers ${what} oracle, /helpers ${what} all.`, tone: 'warn' };
  let picked;
  if (a === 'all') picked = HELPER_INFO;
  else {
    const n = Number(a);
    const h = Number.isInteger(n) ? HELPER_INFO[n - 1] : HELPER_INFO.find((x) => x.code.toLowerCase() === a || x.name === a || x.label.toLowerCase() === a);
    if (!h) return { text: `There is no helper "${String(arg).trim()}": the four are ${HELPER_INFO.map((x, i) => `${i + 1} ${x.code}`).join(', ')}.`, tone: 'warn' };
    picked = [h];
  }
  const next = new Set(on);
  for (const h of picked) { if (what === 'on') next.add(h.name); else next.delete(h.name); }
  const after = new Set(HELPER_NAMES.filter((n) => next.has(n)));
  const changed = after.size !== on.size || [...after].some((n) => !on.has(n));
  const said = picked.length > 1 ? 'All four helpers' : picked[0].code;
  if (!changed) return { on: after, changed: false, text: `${said} ${picked.length > 1 ? 'are' : 'is'} already ${what}.` };
  return { on: after, changed: true, text: `${said} ${what}: the next message uses ${picked.length > 1 ? 'them' : 'it'}. Kept for next time (settings.json).` };
}

// The panel: one row a helper, its codename in bold before the label (the
// left cell as parts, [text, bold]), then how to switch them.
//   last: what the helpers brought to the last request ([{ from, text, tokens }]).
//   ragPaused: /effort's Embedder row is Off, so Oracle (on or not) finds nothing.
export function helperRows(on, last = [], { ragPaused = false } = {}) {
  const rows = HELPER_INFO.map((h, i) => {
    const got = last.filter((x) => HELPER_OF[x.from] === h.name);
    const tokens = got.reduce((s, x) => s + (x.tokens ?? 0), 0);
    const brought = got.length ? ` · last request: ${got.length} item${got.length === 1 ? '' : 's'}, ${tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens` : '';
    const paused = ragPaused && h.name === 'rag' && on.has('rag') ? ' · paused: Embedder is Off in /effort' : '';
    return [[[`${i + 1}  ${on.has(h.name) ? 'on ' : 'off'}  `], [h.code.toUpperCase().padEnd(CODE_W), true], [`  ${h.label}`]], `${h.what}${paused}${brought}`];
  });
  return [...rows, ['', '/helpers off 3 · /helpers on oracle · /helpers off all · kept in settings.json']];
}
