// slugify('Hello World') → 'hello-world'
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s/g, '-');
}
