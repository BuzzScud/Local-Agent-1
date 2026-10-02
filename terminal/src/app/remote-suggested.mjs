// The values /model's menu suggests for a model on an Ollama service (2 Oct 2026, the user's pick:
// "use this to help you", Grok's "Local model ranks" page, its Effort and Limits tabs). They are
// published lab figures and the model makers' own advice, not measured here, so they are only
// suggested: the menu shows them beside each row, and s fills them in. Matched by the name the
// service knows the model by; a model not listed has none. The Thinking cap is not among them:
// Ollama has no thinking limit (the menu leaves that row out on a service).
import { shownLimits } from './limits.mjs';

const SOURCE = 'ranks page, not measured here';

// level: an id of the model's own levels (remoteLevels: Max on Laguna, On on Qwen3.6). limits: rows of /effort.
const SUGGESTED = [
  { match: /^laguna-s-2\.1(:|$)/, level: 'high', limits: { context: 131072, replyTokens: 32768, steps: 80, outputLines: 160, timeoutSecs: 600 }, why: 'starved by the defaults: it thinks long, runs long tool loops and long builds' },
  { match: /^laguna-xs-2\.1(:|$)/, level: 'high', limits: { context: 131072, replyTokens: 32768, steps: 80, outputLines: 160, timeoutSecs: 600 }, why: 'the same pinch as Laguna S at laptop size: the same raises' },
  { match: /^qwen3\.6(:|$)/, level: 'high', limits: { context: 131072, replyTokens: 32768, steps: 80 }, why: 'wants 128k of room, 32k out and 80 steps; raise Presence penalty if it loops' },
  { match: /^ornith(:|$)/, level: 'high', limits: { context: 65536, replyTokens: 8192, steps: 80 }, why: 'give it 4–8k out so its thinking does not eat the answer; 40 steps is tight' },
  { match: /^qwen3-coder-next(:|$)/, limits: { context: 65536, steps: 80 }, why: 'cannot think, so all of it goes to the edit; 32k cuts its 256k repo window' },
  { match: /^qwen3-coder:30b/, limits: { context: 65536, steps: 80, tries: 12, outputLines: 160 }, why: 'a 30B coder: big-model limits, and more than 32k of its 256k window' },
  { match: /^gpt-oss(:|$)/, level: 'medium', limits: {}, why: 'always thinks: Medium is its own default; High is slow and can loop' },
  { match: /^llama4(:|$)/, limits: { context: 131072 }, why: 'cannot think; more context to read many pages at once, 40 steps is enough' },
  { match: /^deepseek-coder-v2(:|$)/, limits: { context: 65536 }, why: '128k of its own, so 32k is short; 40 steps is enough' },
  { match: /^llama3\.1:70b/, limits: {}, why: 'slow: the 2 min command timeout matters; more context only to use it as a reader' },
  { match: /^qwen2\.5(-coder)?:/, limits: {}, why: 'its window is 32k: the shared settings fit it' },
  { match: /^(llama3\.1(:latest|:8b)?|phi4(:latest)?)$/, limits: {}, why: 'a small model: the shared settings fit it' },
];

// { level, limits, why, source } for a model, the values kept to the ones its rows can take
// (a context longer than the model's own is left out), or null when it is not listed.
export function suggestedFor(name, model) {
  const s = SUGGESTED.find((x) => x.match.test(String(name ?? '').toLowerCase()));
  if (!s) return null;
  const rows = shownLimits(model, { own: true });
  const limits = Object.fromEntries(Object.entries(s.limits).filter(([id, v]) => rows.some((l) => l.id === id && l.steps(model).includes(v))));
  const levels = model?.thinkingLevels ?? [];
  const level = levels.length > 1 && levels.some((l) => l.id === s.level) ? s.level : null;
  return { level, limits, why: s.why, source: SOURCE };
}
