// What a model on a service is good at, for the hub's Remote tab. A service
// says what a model CAN do (tools, thinking, pictures, its size and context),
// not what it is good at, so this is two parts, each marked where it comes from:
//   worked out  from what the service said (abilities, size, a name like "coder")
//   a note      a line kept here for the families we know; a new family has none
// Works with no internet. A name is matched by its part before the ":" tag.
import { paramsB } from '../../../models/index.mjs';

// [pattern on the name (or family), what the family is, what it is best at]. First match wins,
// so a narrower name (qwen3-coder) comes before its family (qwen3).
export const FAMILY_NOTES = [
  [/qwen3-coder/i, 'Qwen 3 Coder (Alibaba)', 'Made for coding agents: reading a repository, calling tools, editing files over many steps.'],
  [/qwen2\.5-coder/i, 'Qwen 2.5 Coder (Alibaba)', 'Code writing, completion and fixes; an older model that often writes tool calls as plain text.'],
  [/qwen3-vl|qwen2\.5vl|qwen2\.5-vl/i, 'Qwen VL (Alibaba)', 'Reading pictures: screenshots, documents and charts, then answering about them.'],
  [/qwen3|qwen3\.5/i, 'Qwen 3 (Alibaba)', 'General work and code; can think before answering or answer straight away, and calls tools.'],
  [/qwen2\.5|qwen2/i, 'Qwen 2.5 (Alibaba)', 'General chat and simple code; an older generation.'],
  [/gpt-?oss/i, 'gpt-oss (OpenAI, open weights)', 'Reasoning: always thinks first, at low, medium or high effort; calls tools.'],
  [/llama4/i, 'Llama 4 (Meta)', 'General chat with pictures; a mixture of experts, so quick for its size.'],
  [/llama3\.2-vision/i, 'Llama 3.2 Vision (Meta)', 'Describing and answering about pictures.'],
  [/llama3/i, 'Llama 3 (Meta)', 'General chat and simple tool use; an older generation.'],
  [/deepseek-ocr/i, 'DeepSeek OCR', 'Reading the text out of pictures and scanned pages.'],
  [/deepseek-coder/i, 'DeepSeek Coder', 'Code completion and fixes; V2 is a mixture of experts.'],
  [/deepseek-r1/i, 'DeepSeek R1', 'Reasoning: thinks at length before answering; maths and logic.'],
  [/deepseek-v3|deepseek-v4/i, 'DeepSeek V3 (and later)', 'Large general model: code, reasoning and tool use.'],
  [/devstral/i, 'Devstral (Mistral)', 'Made for coding agents: exploring a codebase and editing many files.'],
  [/codestral/i, 'Codestral (Mistral)', 'Code completion and filling in the middle of a file.'],
  [/magistral/i, 'Magistral (Mistral)', 'Reasoning: thinks step by step before answering.'],
  [/mistral|mixtral/i, 'Mistral', 'General chat and tool use.'],
  [/functiongemma/i, 'FunctionGemma (Google)', 'Tiny: turns a request into a function call; not for conversation.'],
  [/embeddinggemma/i, 'EmbeddingGemma (Google)', 'Search helper: turns text into numbers to find similar text; cannot chat.'],
  [/gemma4/i, 'Gemma 4 (Google)', 'General work with pictures; strong for its size.'],
  [/gemma3n/i, 'Gemma 3n (Google)', 'Small and quick, made for phones and laptops.'],
  [/gemma3|gemma2|gemma/i, 'Gemma (Google)', 'General chat; the 4B and larger Gemma 3 models read pictures.'],
  [/glm/i, 'GLM (Zhipu)', 'General work and code, built for agent use and tool calls.'],
  [/kimi/i, 'Kimi (Moonshot)', 'A very large mixture of experts built for agent work and code.'],
  [/minimax/i, 'MiniMax', 'Agent work and code with a long context.'],
  [/granite/i, 'Granite (IBM)', 'Business tasks, tool calls and documents.'],
  [/phi/i, 'Phi (Microsoft)', 'Small models that reason well for their size.'],
  [/starcoder/i, 'StarCoder', 'Code completion across many languages.'],
  [/llava|bakllava/i, 'LLaVA', 'Describing pictures; an older model with no tools.'],
  [/moondream/i, 'Moondream', 'Tiny picture model: captions and simple questions about an image.'],
  [/minicpm-v/i, 'MiniCPM-V', 'Small picture model: documents, screenshots, text in images.'],
  [/nomic-embed|mxbai-embed|bge-|snowflake-arctic-embed|all-minilm|granite-embedding/i, 'An embedder', 'Search helper: turns text into numbers to find similar text; cannot chat.'],
  [/olmo/i, 'OLMo (Ai2)', 'Fully open model: general chat.'],
  [/hermes/i, 'Hermes (Nous Research)', 'General chat, role-play and tool calls.'],
  [/dolphin/i, 'Dolphin', 'General chat, tuned to follow instructions without refusing.'],
];

const nameOf = (id) => String(id ?? '').split(':')[0];
export function familyNote(m) {
  const hay = `${nameOf(m?.id)} ${m?.family ?? ''}`;
  const hit = FAMILY_NOTES.find(([re]) => re.test(nameOf(m?.id))) ?? FAMILY_NOTES.find(([re]) => re.test(hay));
  return hit ? { family: hit[1], text: hit[2] } : null;
}

// The worked-out part: one short tag each, with the reason in plain words.
// m: ollama.mjs's entry (id, params, family, ctx, tools, thinking, vision, embedding, known).
export function workedOut(m) {
  const out = [];
  const add = (tag, why) => out.push({ tag, why });
  const name = nameOf(m?.id);
  const b = paramsB(m?.params ?? '');
  if (m?.embedding) add('Search helper', 'the service says it makes embeddings: it finds similar text, it cannot chat');
  if (/coder|code|devstral|codestral/i.test(name)) add('Coding', 'its name says it was trained for code');
  if (m?.known && m.tools && !m.embedding) add('Runs the agent', 'it can call tools, so it can read files, edit and run commands here');
  if (m?.known && !m.tools && m.chat && !m.embedding) add('Chat only', 'it cannot call tools, so it can answer but not work in your files');
  if (m?.thinking) add('Thinks first', 'it can reason before answering (Effort High), slower but better on hard steps');
  if (m?.vision) add('Reads pictures', 'it can look at screenshots and images you paste');
  if (/moe/i.test(m?.family ?? '') || /-a\d+b|moe/i.test(name)) add('Quick for its size', 'a mixture of experts: only part of it works on each word');
  if (b >= 30) add('Big', `${m.params}: more knowledge and steadier on long tasks; Agentic Coder gives it more room`);
  else if (b && b < 1) add('Tiny', `${m.params}: fast, for small helper jobs only`);
  else if (b && b <= 8) add('Small', `${m.params}: quick, but weaker on long or tricky tasks`);
  if ((m?.ctx ?? 0) >= 128_000) add('Long context', `it can hold up to ${Math.round(m.ctx / 1024)}k tokens: whole files and long conversations`);
  return out;
}

export const specialtiesOf = (m) => ({ note: familyNote(m), tags: workedOut(m) });
