// The user's calculator (the Thesis web API, 8 Oct 2026) as tools for the web backend
// (terminal/src/web/) and, through its /mcp, for Agentic Coder itself. Its address is the
// user's own and is never written here (the repo is public): the web settings' calc row, or
// AGENTIC_CALC_URL.
//
// POST /api/calculate needs no sign-in; its answer is read with two fixes:
//   - a failed sum still answers HTTP 200 with a top-level ok: true, so the truth is
//     evaluation.ok (the answer or the error both sit in evaluation.value);
//   - the constant phi always fails there (it becomes Math.Math.sqrt), so it is sent as
//     ((1+sqrt(5))/2), which the calculator works out.
// log and ln are both the natural log there; there is no log10 (ln(x)/ln(10) is).
// Formulas (GET /api/formulas) need a session from POST /api/login: one login, kept by the
// backend, serves every user (the owner's pick).
const TIMEOUT_MS = 15_000;

export const fixExpression = (expression) => String(expression ?? '').replace(/\bphi\b/g, '((1+sqrt(5))/2)');

const baseOf = (url) => {
  const u = url ?? process.env.AGENTIC_CALC_URL;
  if (!u) throw new Error('no calculator address: set it in the web settings (Admin → Settings) or AGENTIC_CALC_URL');
  return String(u).replace(/\/+$/, '');
};

// The calculator takes a name → number map. A value written as plain arithmetic ("0.06/12", as
// a small model sent it on 8 Oct) is put into the expression in brackets instead, so the
// calculator works it out: { vars, inline }.
const ARITHMETIC = /^[0-9.+\-*/^()\se]+$/i;
function cleanVariables(variables) {
  const vars = {};
  const inline = {};
  for (const [k, v] of Object.entries(variables ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`a variable's name is letters and digits (got ${JSON.stringify(k)})`);
    const n = typeof v === 'number' ? v : String(v ?? '').trim() === '' ? NaN : Number(v);
    if (Number.isFinite(n)) vars[k] = n;
    else if (typeof v === 'string' && ARITHMETIC.test(v) && v.length <= 200) inline[k] = v.trim();
    else throw new Error(`variable ${k} must be a number or plain arithmetic (got ${JSON.stringify(v)})`);
  }
  return { vars, inline };
}
const putInline = (text, inline) => Object.entries(inline).reduce((t, [k, v]) => t.replace(new RegExp(`\\b${k}\\b`, 'g'), `(${v})`), text);

async function call(url, path, { method = 'GET', body, token, signal } = {}) {
  const t = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(`${baseOf(url)}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, t]) : t,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* said below */ }
  if (!res.ok) throw Object.assign(new Error(`the calculator answered ${res.status}: ${json?.error ?? json?.message ?? text.slice(0, 200)}`), { status: res.status });
  if (!json) throw new Error('the calculator did not answer with JSON');
  return json;
}

// One sum: { ok, value } or { ok: false, error, code?, suggestions? }, with the expression as the
// calculator read it and a few counts. Never throws for a wrong sum; throws when the calculator
// cannot be reached.
export async function calculate({ expression, variables, signal, url } = {}) {
  const text = String(expression ?? '').trim();
  if (!text) return { ok: false, error: 'Give an expression, e.g. 2*x+1.' };
  if (text.length > 2000) return { ok: false, error: 'The expression is longer than 2,000 characters.' };
  let vars, inline;
  try { ({ vars, inline } = cleanVariables(variables)); } catch (e) { return { ok: false, error: e.message }; }
  const sent = fixExpression(putInline(text, inline));
  const ms0 = Date.now();
  const r = await call(url, '/api/calculate', { method: 'POST', body: { expression: sent, ...(Object.keys(vars).length ? { variables: vars } : {}) }, signal });
  const ev = r.evaluation ?? {};
  const base = { expression: text, ...(sent !== text ? { sent } : {}), variables: vars, normalized: ev.normalized ?? null, ms: Date.now() - ms0 };
  if (ev.ok !== true || typeof ev.value !== 'number') {
    return { ok: false, error: String(ev.value ?? 'The calculator could not work it out.'), ...(ev.errorCode ? { code: ev.errorCode } : {}), ...(ev.functionSuggestions ? { suggestions: ev.functionSuggestions } : {}), ...base };
  }
  const a = r.analysis ?? {};
  return { ok: true, value: ev.value, ...base, analysis: { tokens: a.tokenCount, operators: a.operatorCount, complexity: a.complexityScore } };
}

// What it can do: its functions and constants.
export async function capabilities({ signal, url } = {}) {
  const r = await call(url, '/api/calculate/capabilities', { signal });
  return { functions: r.supportedFunctions ?? [], constants: r.supportedConstants ?? [], notes: ['log and ln are both the natural log; write ln(x)/ln(10) for log base 10.', '^ is a power: 2^10 = 1024.'] };
}

// The formulas, with one login kept for the backend: login() → its session, made again once
// when the calculator says it has run out (401). link (the calculator link, web/calc-link.mjs):
// its session first, and a 401 is told to it, so it signs in again for everyone; with no link
// for this login (null) or one that is down past its wait, the client signs in by itself.
export function formulasClient({ url, user, pass, link = null } = {}) {
  let token = null;
  const login = async (signal) => {
    if (!user || !pass) throw new Error('no calculator login: an admin sets it in Admin → Settings');
    const r = await call(url, '/api/login', { method: 'POST', body: { userName: user, password: pass }, signal });
    token = r.sessionId ?? r.token ?? r.session?.id ?? null;
    if (!token) throw new Error('the calculator signed in but gave no session');
    return token;
  };
  return {
    async search({ q, category, limit = 20, verifiedOnly, signal } = {}) {
      const qs = new URLSearchParams();
      if (q) qs.set('q', String(q));
      if (category) qs.set('category', String(category));
      qs.set('limit', String(Math.max(1, Math.min(200, Number(limit) || 20))));
      if (verifiedOnly) qs.set('verifiedOnly', 'true');
      for (let tries = 0; ; tries++) {
        let shared = null;
        if (link) try { shared = await link.session(); } catch (e) { if (!user || !pass) throw e; }
        const t = shared ?? token ?? await login(signal);
        try { return await call(url, `/api/formulas?${qs}`, { token: t, signal }); } catch (e) {
          if (e.status === 401 && tries === 0) { if (shared) await link.rejected(shared, { path: 'GET /api/formulas' }).catch(() => {}); else token = null; continue; }
          throw e;
        }
      }
    },
  };
}

// The tools as a model sees them (MCP shape: name, description, inputSchema).
export const CALC_TOOLS = [
  {
    name: 'calculate',
    description: "Work out a math expression on the user's calculator and get the exact number back. Use it for any arithmetic or formula you would otherwise do in your head. Functions: sin cos tan asin acos atan sinh cosh tanh abs sqrt log ln exp pow hypot floor ceil round min max det sum; constants pi e phi; ^ is a power. log is the natural log. Give letters' values in variables.",
    inputSchema: { type: 'object', properties: { expression: { type: 'string', description: 'e.g. pi*r^2 or (1+sqrt(5))/2' }, variables: { type: 'object', additionalProperties: { type: 'number' }, description: 'e.g. {"r": 3}' } }, required: ['expression'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'calculator_functions',
    description: "List the functions and constants the user's calculator knows.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'formulas',
    description: "Search the formulas kept in the user's calculator (by words, category, or only verified ones).",
    inputSchema: { type: 'object', properties: { q: { type: 'string' }, category: { type: 'string' }, limit: { type: 'number' }, verifiedOnly: { type: 'boolean' } } },
    annotations: { readOnlyHint: true },
  },
];

// One tool call: calc = { url, formulas } (formulas: a formulasClient, or null without a login).
export async function runCalcTool(name, args = {}, { signal, url, formulas = null } = {}) {
  if (name === 'calculate') return calculate({ ...args, signal, url });
  if (name === 'calculator_functions') return capabilities({ signal, url });
  if (name === 'formulas') {
    if (!formulas) return { ok: false, error: 'Formulas need the calculator login, which an admin sets in Admin → Settings.' };
    return formulas.search({ ...args, signal });
  }
  throw new Error(`no calculator tool called ${name}`);
}
