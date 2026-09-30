// The results page of the Picture tokens test (picture-tokens.mjs), drawn by
// check-page.mjs (Result · The checks · How it was measured).
//   picturePage({ summary, rows, prev, raw }) → html
import { buildCheckPage, sec } from './check-page.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tok = (n) => (n == null ? '—' : `≈${Math.round(n)}`);

export function picturePage({ summary: s, rows, prev = null, raw = [] }) {
  const of = s.pictures;
  const verdict = s.pass
    ? `Yes: at the app’s setting (${esc(s.appLabel)}) ${esc(s.name)} read all ${of} pictures${s.engineRight != null ? `; at the engine’s own size it read ${s.engineRight} of ${of}` : ''}.`
    : `No: at the app’s setting (${esc(s.appLabel)}) ${esc(s.name)} read ${s.appRight} of ${of} pictures${s.engineRight != null ? `; at the engine’s own size ${s.engineRight} of ${of}` : ''}.`;
  const cards = [
    { k: 'Read right at the app’s setting', v: `${s.appRight} of ${of}`, sub: prev ? `before: ${prev.s.appRight} of ${prev.s.pictures}` : s.appLabel, dir: 'higher is better' },
    ...(s.engineRight != null ? [{ k: 'Read right at the engine’s own size', v: `${s.engineRight} of ${of}`, sub: 'no --image-min-tokens', dir: 'higher is better' }] : []),
    { k: 'Tokens a picture, app’s setting', v: tok(s.appTokens), sub: s.engineTokens != null ? `engine’s own: ${tok(s.engineTokens)}` : 'the question’s words included', dir: 'lower costs less' },
    { k: 'Seconds an answer, app’s setting', v: sec(s.appSecs), sub: s.engineSecs != null ? `engine’s own: ${sec(s.engineSecs)}` : 'coding -p, model loaded', dir: 'lower is faster' },
  ];
  return buildCheckPage({
    title: `Picture tokens · ${s.name}`, summary: { ...s, of: rows.length, checks: rows.length }, rows, prev, raw, cards, first: false, verdict,
    passRule: `all ${of} read right at the app’s setting`,
    how: [
      `The model: ${esc(s.name)} with its vision add-on, started straight from the engine (llama-server, the app’s own arguments) once for each setting: ${s.engineRight != null ? 'the engine’s own picture size (no --image-min-tokens), then ' : ''}the app’s setting, ${esc(s.appLabel)}.`,
      `The pictures are black text on white, drawn for this run by the app’s helper: ${s.list.map(esc).join(', ')}. The model cannot guess any of them.`,
      'Each question went through <b>coding -p --url</b> to that server (no flows, thinking off, no memory), as “What does the picture @name say? Reply with just the text on it.” A picture is read right when the answer holds all of its words and numbers.',
      'Tokens a picture: what the server processed for that request after the instructions it already had (the picture and the question’s few words), from its own log. Seconds: coding -p from start to answer, with the model already loaded.',
      `Why it matters: the engine warns that Qwen’s vision needs at least 1024 picture tokens; at its own size a small picture gets about 190. Code: ${esc(s.code)}. The Mac’s load at the end: ${s.load}.`,
    ],
  });
}
