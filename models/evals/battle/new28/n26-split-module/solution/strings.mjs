// Text helpers.
export const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
