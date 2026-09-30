// Pictures in the conversation. A message (yours, or a Read's result) can carry
// `images` beside its text: [{ path, mime, data, w, h }] (data: base64). The
// code that works on text never sees them: each request puts them in the form
// its server takes (openAIMessages here for llama.cpp and OpenAI-compatible
// servers, claude.mjs for the Claude API). Only the latest KEEP_IMAGES go with a
// request; an older one becomes a line of text, so a long session does not
// carry every screenshot it was ever shown.
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { isImage, isPdf } from '../tools/media.mjs';

export const KEEP_IMAGES = 3;
// About what one picture costs a request, for the context estimate (a 1280 px
// screenshot is roughly this on Qwen and Gemma; the server's own count corrects it).
export const IMAGE_TOKENS = 1100;

// The pictures that still go with a request: the latest KEEP_IMAGES, counted from the end.
export function keptImages(messages, keep = KEEP_IMAGES) {
  const kept = new Set();
  for (let i = messages.length - 1; i >= 0 && kept.size < keep; i--) {
    const imgs = messages[i]?.images ?? [];
    for (let j = imgs.length - 1; j >= 0 && kept.size < keep; j--) if (imgs[j]?.data) kept.add(imgs[j]);
  }
  return kept;
}
export const imageLabel = (img) => `[a picture shown earlier: ${img.path}${img.w ? ` (${img.w}×${img.h})` : ''}]`;
export const dataUrl = (img) => `data:${img.mime};base64,${img.data}`;

// The conversation as an OpenAI-format server takes it: your message with
// pictures → content parts; a tool result with pictures → its text, then a user
// message holding them (a tool message carries text only).
export function openAIMessages(messages) {
  if (!messages.some((m) => m?.images?.length)) return messages;
  const kept = keptImages(messages);
  const out = [];
  for (const m of messages) {
    if (!m?.images?.length) { out.push(m); continue; }
    const { images, ...rest } = m;
    const live = images.filter((i) => kept.has(i));
    const text = [typeof m.content === 'string' ? m.content : '', ...images.filter((i) => !kept.has(i)).map(imageLabel)].filter(Boolean).join('\n');
    const parts = live.map((i) => ({ type: 'image_url', image_url: { url: dataUrl(i) } }));
    if (m.role === 'user') out.push({ ...rest, content: parts.length ? [{ type: 'text', text }, ...parts] : text });
    else {
      out.push({ ...rest, content: text });
      if (parts.length) out.push({ role: 'user', content: [{ type: 'text', text: `(The picture${parts.length > 1 ? 's' : ''} that result showed.)` }, ...parts] });
    }
  }
  return out;
}

// Pictures and PDFs named in what you typed. A file dragged into Terminal
// arrives as its path, with spaces and brackets escaped by \ (or in quotes);
// a macOS screenshot's name has a narrow space before AM/PM (U+202F).
// Answers [{ raw (as typed), path (absolute), kind: 'image' | 'pdf' }].
export function droppedFiles(text, cwd) {
  const found = [];
  const re = /'([^'\n]+)'|"([^"\n]+)"|((?:~\/|\/)(?:\\.|[^\s\\]| )+)/g;
  for (const m of String(text ?? '').matchAll(re)) {
    const raw = m[1] ?? m[2] ?? m[3];
    const p = (m[3] ? raw.replace(/\\(.)/g, '$1') : raw).replace(/^~(?=\/)/, homedir());
    if (!isImage(p) && !isPdf(p)) continue;
    const abs = isAbsolute(p) ? p : resolve(cwd, p);
    try { if (existsSync(abs) && statSync(abs).isFile()) found.push({ raw: m[0], path: abs, kind: isImage(abs) ? 'image' : 'pdf' }); } catch { /* not a file */ }
  }
  return found;
}

// Where a pasted picture sits in the prompt: "[Image #2]".
export const IMAGE_TOKEN = /\[Image #(\d+)\]/g;
