// formatMoney(1234.5) → '$1,234.50'; formatMoney(-0.5) → '-$0.50'
export function formatMoney(amount) {
  const fixed = Math.abs(amount).toFixed(2);
  const [whole, cents] = fixed.split('.');
  return `${amount < 0 ? '-' : ''}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}
