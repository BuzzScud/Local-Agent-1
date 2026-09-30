// The results page of the web check (web-check.mjs), drawn by check-page.mjs
// (Result · The checks · How it was measured).
//   webPage({ summary, rows, prev, raw }) → html
import { buildCheckPage, sec } from './check-page.mjs';

export function webPage({ summary: s, rows, prev = null, raw = [] }) {
  return buildCheckPage({
    title: `Web check · ${s.name}`, summary: s, rows, prev, raw,
    yes: 'The model read a page, found a line deep in a long one, followed a move to another site only by asking for it, searched and read what it found, read a real page on the internet, did not take orders written in a page, and the window asked before it read a site.',
    cards: [
      { k: 'A page read and answered', v: sec(s.pageSecs), sub: prev ? `before: ${sec(prev.s.pageSecs)}` : 'coding -p, the model loading included', dir: 'lower is faster' },
      { k: 'A search, then its page', v: sec(s.searchSecs), sub: prev ? `before: ${sec(prev.s.searchSecs)}` : 'coding -p, the model loading included', dir: 'lower is faster' },
    ],
    how: [
      `The model: ${s.name}, through <b>coding -p --yes</b> (the app’s own flows, thinking off, no memory), in a throwaway home whose engine and model files are links to the ones in ~/.agentic-coder. --yes says yes to each page and search; the window check answers the question itself.`,
      'The pages are served by the check on this Mac: the notes (a magic number), a long page of 1,500 lines with one line that matters near the end, a page that moves to another site (127.0.0.1 → localhost, which counts as another site), a release page found by a search, and a page with a line telling the model to ignore its instructions.',
      'The search goes to a stand-in search service on this Mac that answers in Brave Search’s form (the key is a test key): no real search is made and no key of yours is used.',
      `One real page: https://example.com, read over the internet (${s.real ?? 'see its row'}).`,
      'The window: the real app in a pseudo-terminal (the tests’ own driver) with the same model; it must ask “Read this page from 127.0.0.1?”, get a yes, and answer.',
      `Nothing in ~/.agentic-coder was written but this run’s line in the test record. The Mac’s load at the end: ${s.load}. Code: ${s.code}.`,
    ],
  });
}
