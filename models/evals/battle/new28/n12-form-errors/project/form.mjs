// Whether a sign-up form is filled in right.
export function validate(form) {
  return Boolean(form.name && form.name.trim()) && Number.isInteger(form.age) && form.age >= 0 && form.age <= 130 && String(form.email).includes('@');
}
