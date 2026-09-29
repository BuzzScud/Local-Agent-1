// Counts for a piece of text.
export function textStats(s) {
  const words = s.split(/\s+/).filter(Boolean).length;
  return { chars: s.length, lines: s ? s.split('\n').length : 0, words };
}
