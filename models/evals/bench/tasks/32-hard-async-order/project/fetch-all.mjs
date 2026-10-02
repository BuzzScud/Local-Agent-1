// Fetches every id with get(id), which returns a promise.
export async function fetchAll(ids, get) {
  const out = [];
  await Promise.all(ids.map(async (id) => {
    out.push(await get(id));
  }));
  return out;
}
