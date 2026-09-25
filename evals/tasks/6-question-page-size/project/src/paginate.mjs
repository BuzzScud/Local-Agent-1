// Splits a list into pages.
export const DEFAULT_PAGE_SIZE = 25;

export function paginate(items, { page = 1, size = DEFAULT_PAGE_SIZE } = {}) {
  const start = (page - 1) * size;
  return { page, size, total: items.length, items: items.slice(start, start + size) };
}
