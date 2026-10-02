// Two decimal places, the way the spreadsheet shows money: half a cent rounds up.
export function round2(x) {
  return Math.round(x * 100) / 100;
}
