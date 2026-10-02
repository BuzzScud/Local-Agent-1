export function placeOrder(email, items) {
  if (!items?.length) return { ok: false, error: 'no items' };
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return { ok: false, error: 'bad email' };
  const domain = email.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return { ok: false, error: 'bad email' };
  return { ok: true, order: { email, count: items.length } };
}
