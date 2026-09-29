// Whether a string is a valid ticket code.
export const isCode = (s) => /^[A-Z]{3}-\d{4}$/.test(s);
