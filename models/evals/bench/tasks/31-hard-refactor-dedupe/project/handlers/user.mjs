export function createUser(name, email) {
  if (!name) return { ok: false, error: 'name required' };
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return { ok: false, error: 'bad email' };
  const domain = email.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return { ok: false, error: 'bad email' };
  return { ok: true, user: { name, email } };
}
