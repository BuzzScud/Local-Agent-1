// The results page of the Look first check (look-check.mjs), drawn by check-page.mjs
// (Result · The checks · How it was measured).
//   lookPage({ summary, rows, prev, raw }) → html
import { buildCheckPage, sec } from './check-page.mjs';

const signed = (s) => `${s >= 0 ? '+' : '−'}${Math.abs(Math.round(s))} s`;

export function lookPage({ summary: s, rows, prev = null, raw = [] }) {
  const v = s.verdict;
  const was = prev?.s?.verdict;
  const said = `${v.holds ? 'Yes' : 'No'}: with Look first ${s.name} got ${v.on.right} of ${v.on.n} answers right (without it: ${v.off.right}), ${signed(v.morePerQuestion)} a question${v.holds ? ', inside the rule.' : '; the rule asks for at least as many right and at most +60 s a question.'}`;
  return buildCheckPage({
    title: `Look first check · ${s.name}`, summary: s, rows, prev, raw, first: false,
    passRule: 'with Look first, at least as many right and at most 60 s more a question',
    verdict: `${said} It looked at ${v.off.looks} → ${v.on.looks} things, and was sent back to look further ${v.on.backs} time${v.on.backs === 1 ? '' : 's'}.`,
    cards: [
      { k: 'Right answers, off → on', v: `${v.off.right} → ${v.on.right} of ${v.on.n}`, sub: was ? `before: ${was.off.right} → ${was.on.right}` : 'the same four questions, one after the other', dir: 'higher is better' },
      { k: 'Time, all four questions', v: `${sec(v.off.secs)} → ${sec(v.on.secs)}`, sub: `${signed(v.morePerQuestion)} a question with Look first`, dir: 'lower is faster' },
      { k: 'Things looked at, off → on', v: `${v.off.looks} → ${v.on.looks}`, sub: 'Read, Search, List, Map and CodeSearch calls', dir: 'more is more gathered' },
      { k: 'Sent back to look further', v: String(v.on.backs), sub: 'answers that came before the 30 s minimum', dir: 'fewer is fewer early answers' },
    ],
    how: [
      `The model: ${s.name} at Effort High (thinking on), through <b>coding -p --yes</b> (no memory), in a throwaway home whose engine and model files are links to the ones in ~/.agentic-coder. A first request loads the model and is not counted.`,
      'Look first: the /effort row, off for one run of each question and auto for the other (30 s on High). With it on, the question goes with a note to look around first, and an answer before 30 s with nothing changed is sent back with what it has looked at, at most 3 times.',
      'The questions: four about a small shop whose answers need more than one file (the tax rate and free shipping are set in config.mjs, the rounding in money.mjs). An answer is right when it has every fact asked for: 0.0825 in config.mjs; 50 and 5.99; total, withTax and shippingFor; roundCents, to cents.',
      'The rule, written before the first run: with Look first at least as many right, and at most 60 s more a question on average (the owner’s “up to a minute”).',
      `Nothing in ~/.agentic-coder was written but this run’s line in the test record. The Mac’s load at the end: ${s.load}. Code: ${s.code}.`,
    ],
  });
}
