import { listItems } from './store.mjs';

// What the API may show of an item.
export function getItems() {
  return listItems().map(({ id, name }) => ({ id, name }));
}
