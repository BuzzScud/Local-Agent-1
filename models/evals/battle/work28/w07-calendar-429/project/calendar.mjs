// Loads this week's economic calendar (the news events) from its export URL.
// fetchImpl: the fetch to use (tests pass a stand-in). sleep(ms): waits, for retries.
export async function loadWeek(url, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`calendar: HTTP ${res.status}`);
  return res.json();
}
