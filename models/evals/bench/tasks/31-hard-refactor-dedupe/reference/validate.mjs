// The one email check the handlers share: null when it is fine, else the error result.
export function emailError(email) {
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return { ok: false, error: 'bad email' };
  const domain = email.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return { ok: false, error: 'bad email' };
  return null;
}
