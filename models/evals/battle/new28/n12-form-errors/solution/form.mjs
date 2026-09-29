// The fields of a sign-up form that are wrong, in order (empty when it is right).
export function validate(form) {
  const bad = [];
  if (!form.name || !form.name.trim()) bad.push('name');
  if (!Number.isInteger(form.age) || form.age < 0 || form.age > 130) bad.push('age');
  if (!String(form.email ?? '').includes('@')) bad.push('email');
  return bad;
}
