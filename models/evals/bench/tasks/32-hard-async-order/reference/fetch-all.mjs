// Fetches every id with get(id), which returns a promise: at most `limit` at once, the
// results in the order of ids. The first failure rejects the whole call.
export async function fetchAll(ids, get, limit = 2) {
  const out = new Array(ids.length);
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const i = next++;
      out[i] = await get(ids[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker));
  return out;
}
