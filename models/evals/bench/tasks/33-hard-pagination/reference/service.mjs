import { listItems } from './store.mjs';

// What the API may show of an item.
export function getItems(opts) {
  return listItems(opts).map(({ id, name }) => ({ id, name }));
}
