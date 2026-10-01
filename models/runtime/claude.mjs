// The Claude API as a /remote (Run on: Claude API): Anthropic's Messages API
// through its official SDK (@anthropic-ai/sdk), loaded only when a Claude
// remote is used. Here: the client, what each model takes, and the check
// the form's Connect and connecting run. The chat itself is
// terminal/src/agent/claude.mjs.
export const CLAUDE_HOST = 'api.anthropic.com';
// The model used when the Model row is blank: Anthropic's default today.
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
// The context used when the form leaves it to the server: Claude takes up to
// 1M tokens, but every step sends the conversation again, so a session is
// kept to this much (the Context row can raise it).
export const CLAUDE_CTX = 200_000;
// The models /remote's Model row steps through for the Claude API (←→), most
// used first; a Test or a connect adds any other the key lists. Prices are per
// million tokens in / out, as Anthropic lists them (Sep 2026).
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', note: 'the default, strong at code · $4 / $20' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', note: 'quicker, half the price · $2 / $10' },
  { id: 'claude-fable-5-1', name: 'Fable 5.1', note: 'the most capable, the dearest · $10 / $50' },
  { id: 'claude-haiku-4-5', name: 'Haiku 4.5', note: 'the quickest and cheapest · $1 / $5' },
];
// A model's short name (Opus 5.5), else its id as the API gives it.
export const claudeName = (id) => CLAUDE_MODELS.find((m) => m.id === id)?.name ?? id;

let sdk = null;
export async function claudeSdk() {
  sdk ??= (await import('@anthropic-ai/sdk')).default;
  return sdk;
}

// One client per address and key. With no key, the SDK finds one itself:
// ANTHROPIC_API_KEY, or an `ant auth login` profile.
const clients = new Map();
export async function claudeClient(url, key = null) {
  const id = `${url}\0${key ?? ''}`;
  if (!clients.has(id)) {
    const Anthropic = await claudeSdk();
    const base = String(url ?? '').replace(/\/+$/, '');
    clients.set(id, new Anthropic({ ...(key ? { apiKey: key } : {}), ...(base && !/\/\/api\.anthropic\.com$/.test(base) ? { baseURL: base } : {}), maxRetries: 2 }));
  }
  return clients.get(id);
}

// What a model takes, by its id (claude-opus-5-5, claude-sonnet-4-6, claude-haiku-4-5…):
//   adaptive     thinking {type: 'adaptive'} (4.6 and later)
//   alwaysThinks thinking cannot be turned off (Opus 5.5, Fable, Mythos): effort low is the least
//   binding      thinking blocks are bound to the conversation (preserved thinking):
//                the app trims old tool output, so a block that no longer matches is dropped, not refused
//   effort       output_config.effort (not Haiku 4.5 or Sonnet 4.5)
//   budget       an older model that thinks only with thinking {type: 'enabled', budget_tokens}
//   structured   output_config.format (JSON answers held to a schema)
//   fallbacks    the server-side fallback when the model declines (fallbacks: 'default')
export function claudeCaps(id = '') {
  const m = String(id).toLowerCase();
  const five = /claude-(opus|sonnet)-5|claude-(fable|mythos)/.test(m);
  const adaptive = five || /claude-(opus|sonnet)-4-[6-9]/.test(m);
  return {
    adaptive,
    alwaysThinks: /claude-opus-5-5|claude-(fable|mythos)/.test(m),
    binding: /claude-(opus-5-5|sonnet-5-5|fable-5-1|mythos-5-1)/.test(m),
    effort: adaptive || /claude-opus-4-5/.test(m),
    budget: !adaptive && /claude-(haiku-4-5|sonnet-4-5|opus-4-5|opus-4-1)/.test(m),
    structured: /claude-(fable|mythos|opus-5|opus-4-8|sonnet-5|haiku-4-5)/.test(m),
    fallbacks: /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/.test(m),
    // Anthropic's web tools: the 2026-02-09 versions (they filter results with code first) where
    // the model takes them, the earlier ones elsewhere.
    webTools: five || /claude-(opus|sonnet)-4-[6-9]/.test(m) ? '20260209' : 'basic',
  };
}

// The check: the key works (the model list answers), the model is there
// (its context from the list), and with reply one word comes back.
// why(e): the network error in plain words (remote.mjs).
export async function claudeProbe({ url, key = null, model = '', reply = false, signal, timeoutMs = 8000, why = (e) => e.message }) {
  const steps = [];
  const want = model || DEFAULT_CLAUDE_MODEL;
  const out = { ok: false, steps, ctx: null, slots: 1, models: [], model: want, file: null, ms: null, error: null };
  const fail = (text) => { steps.push({ ok: false, text }); out.error = text; return out; };
  const Anthropic = await claudeSdk();
  let client;
  try { client = await claudeClient(url, key); } catch (e) { return fail(key ? e.message : 'it needs an API key: enter one in the API key row, or set ANTHROPIC_API_KEY'); }
  const t0 = Date.now();
  try {
    const page = await client.models.list({ limit: 100 }, { signal, timeout: timeoutMs, maxRetries: 0 });
    out.ms = Date.now() - t0;
    steps.push({ ok: true, text: `reached in ${out.ms} ms · the key was accepted` });
    const list = page.data ?? [];
    out.models = list.map((x) => x.id);
    const picked = list.find((x) => x.id === want);
    if (!picked && list.length) steps.push({ ok: true, text: `"${want}" is not in its list of ${list.length}; it is asked for anyway` });
    out.ctx = picked?.max_input_tokens ?? null;
    steps.push({ ok: true, text: `model ${want}${out.ctx ? ` · ${Math.round(out.ctx / 1000)}k context` : ''}` });
    if (reply) {
      const t1 = Date.now();
      const caps = claudeCaps(want);
      const r = await client.messages.create({ model: want, max_tokens: 2048, messages: [{ role: 'user', content: 'Reply with the single word: ready' }], ...(caps.effort ? { output_config: { effort: 'low' } } : {}) }, { signal, timeout: 60_000 });
      if (r.stop_reason === 'refusal') return fail(`it declined to answer${r.stop_details?.category ? ` (${r.stop_details.category})` : ''}`);
      const said = r.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim().replace(/\s+/g, ' ').slice(0, 24);
      steps.push({ ok: true, text: `answered "${said || '…'}" in ${((Date.now() - t1) / 1000).toFixed(1)} s` });
    }
    out.ok = true;
    return out;
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return fail(key ? 'the API key was not accepted' : 'it needs an API key: enter one in the API key row, or set ANTHROPIC_API_KEY');
    if (e instanceof Anthropic.NotFoundError) return fail(`there is no model "${want}": pick another in the Model row (←→)`);
    if (e instanceof Anthropic.RateLimitError) return fail('the API key is rate limited right now (429): try again in a moment');
    if (e instanceof Anthropic.APIConnectionError) return fail(why(e.cause ?? e));
    return fail(`${e.status ? `${e.status} ` : ''}${String(e.message ?? e).slice(0, 160)}`);
  }
}
