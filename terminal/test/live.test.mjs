import { test, expect } from 'bun:test';
import { countTries } from '../src/app/live.mjs';

// Feeds 'tries' events in order, the way App.jsx does.
const feed = (events, start = { tokens: 0 }) => events.reduce((l, ev) => countTries(l, ev), start);

test('the Musing count includes tokens written in tries', () => {
  const l = feed([
    { label: 'Writing a test', n: 1, tokens: 0 },
    { label: 'Writing a test', n: 1, tokens: 40 },
    { label: 'Writing a test', n: 1, tokens: 2457 },
  ]);
  expect(l.tokens).toBe(2457);
  expect(l.tries.tokens).toBe(2457);
});

test('each new try adds on top, and a ✓ report (0 tokens) adds nothing', () => {
  const l = feed([
    { label: 'Drafting versions', n: 1, tokens: 300 },
    { label: 'Drafting versions', n: 1, tokens: 0, marks: ['✓'] },
    { label: 'Drafting versions', n: 2, tokens: 0 },
    { label: 'Drafting versions', n: 2, tokens: 250 },
  ], { tokens: 12 });
  expect(l.tokens).toBe(12 + 300 + 250);
});

test('tries side by side on two slots are counted separately', () => {
  const l = feed([
    { label: 'Writing a test', n: 1, tokens: 100 },
    { label: 'Drafting versions', n: 1, tokens: 50 },
    { label: 'Writing a test', n: 1, tokens: 180 },
    { label: 'Drafting versions', n: 1, tokens: 90 },
  ]);
  expect(l.tokens).toBe(180 + 90);
});

test('a second round that reuses a label starts again from 0', () => {
  const l = feed([
    { label: 'Drafting versions', n: 1, tokens: 400 },
    { label: 'Drafting versions', n: 1, tokens: 0 },
    { label: 'Drafting versions', n: 1, tokens: 120 },
  ]);
  expect(l.tokens).toBe(520);
});
