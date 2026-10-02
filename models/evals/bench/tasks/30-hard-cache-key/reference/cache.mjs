// Remembers what fn returned for each set of arguments, so the slow call is made once.
export function memo(fn) {
  const seen = new Map();
  return (...args) => {
    const key = JSON.stringify(args);
    if (!seen.has(key)) seen.set(key, fn(...args));
    return seen.get(key);
  };
}
