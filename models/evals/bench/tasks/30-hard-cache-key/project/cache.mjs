// Remembers what fn returned, so the slow call is made once.
export function memo(fn) {
  const seen = new Map();
  return (...args) => {
    const key = args[0];
    if (!seen.has(key)) seen.set(key, fn(...args));
    return seen.get(key);
  };
}
