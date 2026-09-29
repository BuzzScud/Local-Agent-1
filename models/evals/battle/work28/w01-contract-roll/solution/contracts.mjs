// Futures contract codes: root + month letter + one-digit year, e.g. NQZ6 = NQ December 2026.
// The index futures have four contracts a year: H (March), M (June), U (September), Z (December).
const MONTHS = ['H', 'M', 'U', 'Z'];

// The next quarterly contract after this one: NQH6 -> NQM6, NQZ6 -> NQH7 (and Z9 -> H0).
export function nextContract(code) {
  const m = /^([A-Z]+?)([HMUZ])(\d)$/.exec(code);
  if (!m) throw new Error(`not a contract code: ${code}`);
  const [, root, month, year] = m;
  const i = MONTHS.indexOf(month);
  const nextYear = month === 'Z' ? (Number(year) + 1) % 10 : Number(year);
  return `${root}${MONTHS[(i + 1) % 4]}${nextYear}`;
}
