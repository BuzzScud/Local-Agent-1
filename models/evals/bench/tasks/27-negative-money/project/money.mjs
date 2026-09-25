// formatMoney(1234.5) → '$1,234.50'
export function formatMoney(amount) {
  const fixed = amount.toFixed(2);
  const [whole, cents] = fixed.split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}
