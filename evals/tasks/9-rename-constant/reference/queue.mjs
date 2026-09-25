import { ITEM_LIMIT } from './limits.mjs';

export function push(queue, item) {
  if (queue.length >= ITEM_LIMIT) throw new Error(`queue is full (${ITEM_LIMIT})`);
  return [...queue, item];
}
