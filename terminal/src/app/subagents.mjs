// The helper jobs of /subagents (2 Oct 2026, the user's ask and picks), one per helper model on an
// Ollama service. Since 8 Oct 2026 /profiles shows and sets them (each job is an AI row there, and today's
// jobs are its first profiles: profiles.mjs seedProfiles); /subagents typed opens it. Before that, the panel's
// rows: one per job. Each job is on or off and has its model; ←→ steps
// through the service's models that can do it, space switches it, enter loads it
// now. A helper loads the first time its job needs it (their pick), not as the
// window connects, so the main model keeps the most room. Saved in settings.json
// `subagents` by service address, so another service keeps its own.
//   pictures   looks at a picture when the main model cannot (llava, deepseek-ocr)
//   side       the small jobs: summaries, saved notes, /btw (llama3.2:3b)
//   search     the code search's meanings (embeddinggemma), in place of this Mac's
//   review     a second opinion on the plan and the finished change (gpt-oss:120b)
//   design     UI design, two halves (their pick "Both"): one model writes the page's
//              layout and styling, one that sees looks at a picture of it
// The jobs themselves run in the agent; this file is the list, the defaults and
// the panel's rows.
import { paramsB } from '../../../models/index.mjs';
import { copiesOf } from './remote-models.mjs';

// main: the main model may do the job itself ("same as main" heads its choices).
export const JOBS = [
  { id: 'pictures', label: 'Pictures', note: 'looks at a picture when your model cannot' },
  { id: 'side', label: 'Side jobs', note: 'summaries, saved notes, /btw', main: true },
  { id: 'search', label: 'Code search', note: 'finds the code closest to your request' },
  { id: 'review', label: 'Second opinion', note: 'checks the plan and the finished change' },
  { id: 'designWrite', label: 'UI design · writes', note: 'writes the layout and styling of a page', main: true },
  { id: 'designCheck', label: 'UI design · checks', note: 'looks at a picture of the page, lists what looks off' },
];
export const MAIN = 'main';

const B = (m) => paramsB(m.params);
const sees = (m) => m.known && m.chat && m.vision;
// The service's models that can do a job, the best first.
export function choicesFor(job, models = [], main = null) {
  const all = copiesOf(models).filter((m) => m.id !== main);
  const by = (f) => [...all].sort(f);
  let list;
  // a small one that only looks first; one made for reading text off a page (deepseek-ocr) after the others
  if (job === 'pictures') list = by((a, b) => (/ocr/i.test(a.id) - /ocr/i.test(b.id)) || (a.tools - b.tools) || B(a) - B(b)).filter(sees);
  else if (job === 'side') list = by((a, b) => B(a) - B(b)).filter((m) => m.chat && !m.embedding && m.known && B(m) >= 1 && B(m) <= 16);
  else if (job === 'search') list = by((a, b) => B(a) - B(b)).filter((m) => m.embedding);
  // one that thinks, the smallest of 30B or more first, so it fits beside the main model (the user's
  // pick, 2 Oct 2026: Qwen3.6 35B over gpt-oss 120b, which would unload the main model for each check)
  else if (job === 'review') list = by((a, b) => (b.thinking - a.thinking) || B(a) - B(b)).filter((m) => m.known && m.chat && !m.embedding && B(m) >= 30);
  else if (job === 'designWrite') list = by((a, b) => (/coder/i.test(b.id) - /coder/i.test(a.id)) || B(b) - B(a)).filter((m) => m.known && m.chat && m.tools && B(m) >= 7);
  else if (job === 'designCheck') list = by((a, b) => ((B(b) >= 20) - (B(a) >= 20)) || B(a) - B(b)).filter(sees); // the smallest big one that sees
  else list = [];
  const ids = list.map((m) => m.id);
  return JOBS.find((j) => j.id === job)?.main ? [MAIN, ...ids] : ids;
}

// What a model is, from its name and any extras the API sent (role, capabilities). A list of ids
// is enough to rematch helpers before /api/show lands: llava sees, embed searches, 3b is Fast.
const CLAUDE_SIZE = { haiku: '3B', sonnet: '17B', opus: '200B', fable: '200B' };
export function entryFromName(id, extra = {}) {
  const name = String(id ?? extra.id ?? extra.name ?? '');
  const lower = name.toLowerCase();
  const caps = Array.isArray(extra.capabilities) ? extra.capabilities : Array.isArray(extra.caps) ? extra.caps : null;
  const has = (c) => Boolean(caps?.includes(c));
  const visionName = /llava|bakllava|moondream|minicpm-v|pixtral|vision|qwen.*vl|deepseek-ocr|llama4|^claude-/.test(lower);
  const embedName = /embed|nomic-embed|bge-|e5-|minilm/.test(lower);
  const thinkName = /think|reasoner|\br1\b/.test(lower);
  const sizeHit = /(\d+(?:\.\d+)?)\s*b/i.exec(name.replace(/:latest$/i, ''));
  const claudeKind = /^claude-/.test(lower) ? (lower.match(/haiku|sonnet|opus|fable/) || [])[0] : null;
  const params = extra.params || extra.parameter_size || extra.details?.parameter_size || (sizeHit ? `${sizeHit[1]}B` : (claudeKind ? CLAUDE_SIZE[claudeKind] : '')) || '';
  const vision = extra.vision === true || has('vision') || visionName;
  const embedding = extra.embedding === true || has('embedding') || embedName;
  const thinking = extra.thinking === true || has('thinking') || thinkName;
  const chat = extra.chat === false ? false : embedding ? extra.chat === true || has('completion') : extra.chat ?? (caps ? has('completion') : true);
  const tools = extra.tools === false ? false : embedding ? extra.tools === true || has('tools') : extra.tools ?? (caps ? has('tools') : true);
  const known = extra.known === true || Boolean(caps) || vision || embedding || Boolean(params) || Boolean(claudeKind);
  const role = extra.role || (embedName ? 'search' : visionName ? 'vision' : undefined);
  return {
    id: name,
    family: extra.family ?? extra.details?.family ?? '',
    params,
    quant: extra.quant ?? extra.quantization_level ?? extra.details?.quantization_level ?? '',
    bytes: extra.bytes ?? extra.size ?? 0,
    digest: extra.digest ?? null,
    modified: extra.modified ?? extra.modified_at ?? null,
    ctx: extra.ctx ?? extra.max_input_tokens ?? extra.context_length ?? null,
    known,
    chat: Boolean(chat),
    tools: Boolean(tools),
    thinking: Boolean(thinking),
    vision: Boolean(vision),
    embedding: Boolean(embedding),
    loaded: Boolean(extra.loaded),
    loadedCtx: extra.loadedCtx ?? null,
    sameAs: extra.sameAs ?? [],
    ...(role ? { role } : {}),
    ...(caps ? { capabilities: caps } : {}),
  };
}
// Fill abilities the API omitted: a completion-only show of llava still sees; true flags stay.
export function fillEntry(m) {
  if (!m?.id) return m;
  const inferred = entryFromName(m.id, m);
  return {
    ...inferred,
    ...m,
    id: m.id,
    vision: Boolean(m.vision) || inferred.vision,
    embedding: Boolean(m.embedding) || inferred.embedding,
    thinking: Boolean(m.thinking) || inferred.thinking,
    tools: m.tools === false ? false : Boolean(m.tools) || inferred.tools,
    chat: m.chat === false ? false : Boolean(m.chat) || inferred.chat,
    known: Boolean(m.known) || inferred.known,
    params: m.params || inferred.params,
    role: m.role || inferred.role,
  };
}
export function catalogFromList(list = []) {
  return (Array.isArray(list) ? list : []).map((item) => (typeof item === 'string' ? entryFromName(item) : entryFromName(item.id ?? item.name, item))).filter((m) => m.id).map(fillEntry);
}

// The helper model each job should use on this catalog. An explicit role from the API wins, even
// when the model is bigger than choicesFor would pick (a 27B tagged fast). Pictures may be Main
// when that model sees; side, search and review stay put when their pick would be Main.
const ROLE_FOR = { pictures: ['vision', 'pictures'], side: ['fast', 'side'], search: ['search', 'embedding'], review: ['review'] };
export function roleModels(models = [], main = null) {
  const filled = catalogFromList(models);
  const pick = (job) => {
    const roles = ROLE_FOR[job];
    const tagged = filled.filter((m) => roles.includes(m.role));
    const from = (pool) => choicesFor(job, pool, main).filter((id) => id && id !== MAIN);
    let id = (tagged.length ? from(tagged) : from(filled))[0] ?? null;
    if (tagged.length && !id) {
      const rest = tagged.filter((m) => m.id !== main).sort((a, b) => B(a) - B(b));
      id = rest[0]?.id ?? null;
    }
    if (job === 'pictures') {
      if (id) return id;
      const mine = filled.find((m) => m.id === main);
      return mine && (mine.vision || roles.includes(mine.role)) ? main : null;
    }
    return !id || id === main ? null : id;
  };
  return { pictures: pick('pictures'), side: pick('side'), search: pick('search'), review: pick('review') };
}

// The jobs as saved for this service, a job never set getting its default: on, with
// its first choice (the UI design writer: the main model itself).
export function jobsOf(saved = {}, models = [], main = null) {
  return JOBS.map((j) => {
    const choices = choicesFor(j.id, models, main);
    const s = saved[j.id] ?? {};
    const def = j.id === 'designWrite' ? MAIN : choices.find((c) => c !== MAIN) ?? choices[0] ?? null;
    const model = s.model && (s.model === MAIN || models.some((m) => m.id === s.model)) ? s.model : def;
    return { ...j, choices, model, on: s.on ?? Boolean(model), missing: Boolean(s.model && model !== s.model) };
  });
}


