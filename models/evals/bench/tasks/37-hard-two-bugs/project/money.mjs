// Two decimal places, the way the spreadsheet shows money.
export function round2(x) {
  return Math.floor(x * 100) / 100;
}
