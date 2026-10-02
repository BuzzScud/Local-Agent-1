// The rates service (slow in real life): each call is counted.
const RATES = { 'USD:EUR': 0.9, 'USD:GBP': 0.8, 'EUR:GBP': 0.88 };
let calls = 0;
export const callCount = () => calls;
export function fetchRate(from, to) {
  calls++;
  const r = RATES[`${from}:${to}`];
  if (r === undefined) throw new Error(`no rate ${from}->${to}`);
  return r;
}
