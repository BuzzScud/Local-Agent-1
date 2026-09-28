// How the user likes things done: thirteen lines, boiled down (28 Sep 2026)
// from the 52 notes Claude Code keeps on it, put in Agentic Coder's words and left
// out where Agentic Coder cannot do the thing at all (it cannot open an app). They
// hold everywhere and are read in full at every start, beside the two rules
// the user gave Agentic Coder directly (FIRST_FACTS in facts.mjs). Saved once: a
// line the user removed afterwards does not come back. The user read the
// fifteen and dropped two (28 Sep): "never rm -rf" and "commit only on my word"
// (the app's own blocks still refuse rm -rf and git push).
const from = "Claude's notes on how you like things done (28 Sep 2026)";
export const CLAUDE_RULES = [
  'Explain simply: the result first, then a few short steps. No file names or code unless the user asks.',
  'After you make a page or a file, say exactly where it is, with its full path.',
  'One step per command: do not chain stop, clean, restart and test in one line.',
  'A finished page or report is ONE self-contained .html file with <meta charset="utf-8">, on the Desktop unless told otherwise.',
  'When you revise a file you already handed over, keep the original and write a new one (name-v2).',
  'If a file the user named is missing, say so at once and ask where it went. Do not work around it.',
  'Before a job that takes more than a few minutes, say how long it will take.',
  'Never say a check passed unless you ran it and read what it printed.',
  'A simple request is done with few questions. Ask only what the files cannot tell you.',
  'Before you delete or move many files, make a backup first.',
  'A preview shows the real thing with real data, not a mock-up.',
  '"Uniform" means the same parts with the same ends and heights in every repeated piece.',
  'In a design: no thin coloured stripe on the edge of a card, and nothing that makes the page scroll sideways.',
].map((text) => ({ kind: 'you', always: true, from, text }));
