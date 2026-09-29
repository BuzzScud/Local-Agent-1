// One page of items: { items, page, pages, total }.
export function listItems(items, { page = 1, pageSize = 10 } = {}) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pages, total: items.length };
}
