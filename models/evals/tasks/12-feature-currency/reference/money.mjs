// Formats an amount of money for the screen.
const SYMBOLS = { USD: '$', EUR: '€', GBP: '£' };
export function formatMoney(amount, { currency = 'USD' } = {}) {
  return (SYMBOLS[currency] ?? currency + ' ') + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
