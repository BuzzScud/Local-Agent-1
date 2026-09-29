// Whether a string looks like an email address.
export function isEmail(s) {
  if (/\s/.test(s)) return false;
  const parts = s.split('@');
  if (parts.length !== 2 || !parts[0]) return false;
  const domain = parts[1];
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.') && !domain.includes('..');
}
