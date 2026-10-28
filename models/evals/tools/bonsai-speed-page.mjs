// The results page of the Bonsai speed test (bonsai-speed.mjs): one self-contained HTML file for the DOCS
// folder, opened from the run's line in the hub's Tests tab, drawn by check-page.mjs
// (Result · The checks · How it was measured).
//   speedPage({ summary, rows, prev, raw }) → html
// With no run before it, a card says what the logging relay measured on 27 Oct 2026, before this test.
import { buildCheckPage, sec } from './check-page.mjs';

export function speedPage({ summary: s, rows, prev = null, raw = [] }) {
  const per = (x, u) => (x == null ? '—' : `${x} ${u}`);
  const was = (k, u, then) => (prev ? `before: ${per(prev.s[k], u)}` : `on 27 Oct 2026, through a logging relay: ${then}`);
  return buildCheckPage({
    title: `Bonsai speed test · ${s.model} on this Mac’s Ollama`, summary: s, rows, prev, raw,
    yes: 'It answers, reads the app’s instructions and tools from the start in under 30 s, and a later step reuses what it read.',
    passRule: 'all 3 checks',
    cards: [
      { k: 'Reads a prompt', v: per(s.readTokS, 'tokens/s'), sub: was('readTokS', 'tokens/s', '~210 tokens/s'), dir: 'higher is faster' },
      { k: 'Writes', v: per(s.writeTokS, 'tokens/s'), sub: was('writeTokS', 'tokens/s', '~28 tokens/s'), dir: 'higher is faster' },
      { k: `A fresh prompt (${(s.freshTok ?? 0).toLocaleString('en-US')} tokens)`, v: sec(s.freshSecs), sub: prev ? `before: ${sec(prev.s.freshSecs)}` : 'on 27 Oct 2026: 20–24 s for 4.5–5k tokens', dir: 'lower is faster' },
      { k: 'A later step, reading', v: sec(s.laterReadSecs), sub: prev ? `before: ${sec(prev.s.laterReadSecs)}` : 'on 27 Oct 2026: 0.2–1 s', dir: 'lower is faster' },
    ],
    how: [
      `Two requests to <code>${s.url}</code>’s <code>/api/chat</code>, not streamed, the way a window’s first two steps go: the app’s own instructions (<code>systemPrompt</code>) and its tools (<code>toolSchemas('app')</code>), with a first line of their own (the time) so nothing an earlier request read is reused, and a short question; then the same with the answer and one more question.`,
      `Asked at the context the model is loaded at (${(s.ctx ?? 0).toLocaleString('en-US')}; another size would load it again), thinking off, at most 160 tokens written: it measures reading and writing, not how long it chooses to think.`,
      'The figures are Ollama’s own: prompt_eval_count and prompt_eval_duration (reading), eval_count and eval_duration (writing), load_duration. Reads a prompt = the fresh prompt’s tokens over its reading time; Writes = the first answer’s tokens over its writing time.',
      'The rules, written before the first run: both requests answered with words; the fresh prompt read in under 30 s (the relay measured 20–24 s on 27 Oct 2026); the later step read in under 3 s (what was read kept: read again it would take about as long as the fresh one).',
      `The hub’s Bonsai tab runs the same test (its Test speed button, <code>terminal/src/app/bonsai-speed.mjs</code>), kept in <code>~/.agentic-coder/bonsai/speed.json</code>. Loading took ${sec(s.loadSecs)}; the whole run ${sec(s.secs)}. Code: ${s.code}.`,
    ],
  });
}
