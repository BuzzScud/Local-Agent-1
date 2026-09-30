// The results page of the vision check (vision-check.mjs): one self-contained
// HTML file for the DOCS folder, opened from the run's line in the hub's Tests
// tab, drawn by check-page.mjs (Result · The checks · How it was measured).
//   visionPage({ summary, rows, prev, raw }) → html
import { buildCheckPage, sec } from './check-page.mjs';

export function visionPage({ summary: s, rows, prev = null, raw = [] }) {
  return buildCheckPage({
    title: `Vision check · ${s.name}`, summary: s, rows, prev, raw,
    yes: 'The model read the text on pictures and on a scanned page, took a picture dragged in from another folder, read a PDF, looked at a picture by itself with Read, said so plainly without its add-on, and the window turned its vision on at the first picture.',
    cards: [
      { k: 'The first picture, loading included', v: sec(s.firstSecs), sub: prev ? `before: ${sec(prev.s.firstSecs)}` : 'coding -p: the model and its add-on load, then it answers', dir: 'lower is faster' },
      { k: 'Turning vision on in the window', v: sec(s.reloadSecs), sub: prev ? `before: ${sec(prev.s.reloadSecs)}` : 'from Enter to “can look at pictures now”', dir: 'lower is faster' },
    ],
    how: [
      `The model: ${s.name}, with its vision add-on (${s.addOn})${s.minTokens ? `, at least ${s.minTokens} tokens a picture (the Picture tokens test shows why)` : ''}. Everything ran in a throwaway home whose engine and model files are links to the ones in ~/.agentic-coder; the picture and PDF helper was built there from its source with the Mac’s own Swift, as on a new Mac.`,
      'The pictures are black text on white, drawn for this run by the helper: HELLO 42 (hello.png), ORBIT 815 (a picture in another folder, <code>my shot 1.png</code>, named by its full path with the spaces escaped, the way a file dragged into Terminal arrives), WIDTH 64 (note.png, never named in the prompt as an attachment). The model cannot guess any of them.',
      'invoice.pdf has two pages of real text (the total due is 1,240 dollars). scan.pdf is a picture saved as a PDF with sips: it has no text at all (CODE 5519), so the model must look at the page as a picture.',
      'Each question went through <b>coding -p</b> (no flows, thinking off, no memory, no helpers), which loads the model for it and stops it after: the seconds include loading. A pass needs the answer and, where the model had to act, the tool it used (Read, and Read with a page for the scan).',
      'Without the add-on: a second throwaway home with every model file but the add-on. It must say the add-on is not here, send the words alone, and not come up with the picture’s text.',
      'The window: the real app in a pseudo-terminal (the tests’ own driver), started without vision; the prompt names @hello.png; it must turn vision on (a reload with the add-on), say it can look at pictures now, and answer HELLO 42.',
      `Nothing in ~/.agentic-coder was written but this run’s line in the test record. The Mac’s load at the end: ${s.load}. Code: ${s.code}.`,
    ],
  });
}
