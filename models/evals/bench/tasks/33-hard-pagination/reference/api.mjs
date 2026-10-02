import { getItems } from './service.mjs';

// One page: limit 20 by default, 100 at most; nextCursor is null on the last page.
export function handle(query = {}) {
  const limit = Math.min(Math.max(1, Number(query.limit) || 20), 100);
  const after = Number(query.after) || 0;
  const rows = getItems({ after, limit: limit + 1 });
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items.at(-1).id : null };
}
