// The results page of the subagent check (agents-check.mjs), drawn by check-page.mjs
// (Result · The checks · How it was measured).
//   agentsPage({ summary, rows, prev, raw }) → html
import { buildCheckPage, sec } from './check-page.mjs';

export function agentsPage({ summary: s, rows, prev = null, raw = [] }) {
  const kept = s.keptTokens == null ? '—' : `${s.keptTokens} tokens`;
  return buildCheckPage({
    title: `Subagent check · ${s.name}`, summary: s, rows, prev, raw,
    yes: 'The model handed work to a helper that found the answer on the server’s side slot, the conversation’s place on the main slot was kept, a read-only helper changed nothing, a general one made its change, and esc stopped a helper in the window.',
    cards: [
      { k: 'An explore helper, start to answer', v: sec(s.exploreSecs), sub: prev ? `before: ${sec(prev.s.exploreSecs)}` : 'coding -p, the model loading included', dir: 'lower is faster' },
      { k: 'Read again after the helper', v: kept, sub: 'what the conversation’s next step had to process: small when its place was kept', dir: 'lower is faster' },
    ],
    how: [
      `The model: ${s.name}, with Who decides on Model (the Agent tool is offered then), through <b>coding -p --yes</b> (thinking off, no memory), in a throwaway home whose engine and model files are links to the ones in ~/.agentic-coder. The prompts ask for a helper by name, so each check measures what a helper does, not whether the model thinks of one.`,
      'The project: a few small files, one of them defining computeTax on a known line, and notes.mjs for the general helper to change.',
      'The side slot: the model server’s own log says which slot each request ran in; the helpers’ requests must be on slot 1 while the conversation stays on slot 0, and the conversation’s next request must process only what is new.',
      'The window: the real app in a pseudo-terminal (the tests’ own driver); once the helper’s line shows its first step, esc must stop it and the turn.',
      `Nothing in ~/.agentic-coder was written but this run’s line in the test record. The Mac’s load at the end: ${s.load}. Code: ${s.code}.`,
    ],
  });
}
