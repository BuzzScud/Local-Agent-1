// Old fee code, kept for the 2024 reports. Nothing imports it any more.
export function oldFee(amount, kind) {
  if (kind === 'staff') return amount;
  return amount * 1.01;
}
