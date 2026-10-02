import { getItems } from './service.mjs';

export function handle(query = {}) {
  return { items: getItems() };
}
