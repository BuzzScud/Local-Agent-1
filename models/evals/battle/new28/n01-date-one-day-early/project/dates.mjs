// formatDay('2026-09-29') → '9/29/2026' (month/day/year, no leading zeros)
export function formatDay(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}
