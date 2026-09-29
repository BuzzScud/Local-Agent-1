// Counts for a piece of text.
export function textStats(s) {
  return { chars: s.length, lines: s ? s.split('\n').length : 0 };
}
