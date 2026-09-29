// Loads this week's economic calendar (the news events) from its export URL.
// fetchImpl: the fetch to use (tests pass a stand-in). sleep(ms): waits, for retries.
// A 429 (too many requests) waits Retry-After seconds (5 when it has none) and tries again,
// up to 3 tries in all.
export async function loadWeek(url, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), tries = 3 } = {}) {
  for (let i = 1; ; i++) {
    const res = await fetchImpl(url);
    if (res.ok) return res.json();
    if (res.status !== 429 || i >= tries) throw new Error(`calendar: HTTP ${res.status}`);
    const secs = Number(res.headers?.get('Retry-After'));
    await sleep((Number.isFinite(secs) && secs > 0 ? secs : 5) * 1000);
  }
}
