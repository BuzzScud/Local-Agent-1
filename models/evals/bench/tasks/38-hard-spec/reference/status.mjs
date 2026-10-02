// See SPEC.md.
const STATUSES = ['new', 'paid', 'shipped', 'delivered', 'cancelled'];
const MOVES = { new: ['paid', 'cancelled'], paid: ['shipped', 'cancelled'], shipped: ['delivered'], delivered: [], cancelled: [] };

export function transition(order, to) {
  const from = order.status;
  for (const s of [from, to]) if (!STATUSES.includes(s)) throw new Error(`unknown status ${s}`);
  if (!MOVES[from].includes(to)) throw new Error(`cannot go from ${from} to ${to}`);
  const at = [...(order.at ?? [])];
  at.push({ status: to, step: at.length + 1 });
  const next = { ...order, status: to, at };
  if (to === 'cancelled') next.refund = from === 'paid';
  return next;
}
