import { MAX_ITEMS } from './limits.mjs';

export function push(queue, item) {
  if (queue.length >= MAX_ITEMS) throw new Error(`queue is full (${MAX_ITEMS})`);
  return [...queue, item];
}
