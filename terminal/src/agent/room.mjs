// How much of your rules and of the files a question names is read before the
// first step: /effort's "Rules room" and "Up-front reading" rows. 0 = auto, a
// share of the Context, so a bigger Context reads more by itself (30 Sep 2026).
// Sizes are in characters, about 4 to a token. Measured that day on this repo:
// your rules (7,892 + 1,438 characters) did not fit the old 9,000, and the old
// flat 45,000 was about 70% of a 16k window but was never reached by 25 real
// questions, so the share keeps 45,000 at 32k and gives a small window less.
export const CHARS_PER_TOKEN = 4;
export const RULES_FLOOR = 12000; // never less: fits the two AGENTS.md files this was measured on
export const RULES_SHARE = 0.0687; // of the Context, from 32k up (9,000 at 32k, below the floor)
export const UPFRONT_SHARE = 0.343; // of the Context: 45,000 at 32k
export const rulesRoomFor = (ctx) => Math.max(RULES_FLOOR, Math.round((ctx * CHARS_PER_TOKEN * RULES_SHARE) / 500) * 500);
export const upFrontFor = (ctx) => Math.round((ctx * CHARS_PER_TOKEN * UPFRONT_SHARE) / 1000) * 1000;
