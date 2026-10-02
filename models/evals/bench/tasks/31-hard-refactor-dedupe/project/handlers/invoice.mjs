// Invoices go to the address as the accounting system stores it: trimmed, lower case.
export function sendInvoice(rawEmail, amount) {
  const email = String(rawEmail ?? '').trim().toLowerCase();
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return { ok: false, error: 'bad email' };
  const domain = email.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return { ok: false, error: 'bad email' };
  if (!(amount > 0)) return { ok: false, error: 'bad amount' };
  return { ok: true, to: email, amount };
}
