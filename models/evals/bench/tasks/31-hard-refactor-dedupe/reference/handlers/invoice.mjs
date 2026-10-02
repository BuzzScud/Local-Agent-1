import { emailError } from '../validate.mjs';

// Invoices go to the address as the accounting system stores it: trimmed, lower case.
export function sendInvoice(rawEmail, amount) {
  const email = String(rawEmail ?? '').trim().toLowerCase();
  const bad = emailError(email);
  if (bad) return bad;
  if (!(amount > 0)) return { ok: false, error: 'bad amount' };
  return { ok: true, to: email, amount };
}
