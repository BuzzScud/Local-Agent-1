// formatDay('2026-09-29') → '9/29/2026' (month/day/year, no leading zeros)
export function formatDay(iso) {
  const [y, m, day] = iso.split('-').map(Number);
  return `${m}/${day}/${y}`;
}
