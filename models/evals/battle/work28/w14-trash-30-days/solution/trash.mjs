// The bank keeps each day's bars: store = { days: { 'YYYY-MM-DD': [bars] }, trash: {} }.
// A deleted day waits in the trash for 30 days before it is gone.
export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Moves a saved day to the trash.
export function removeDay(store, day, now = Date.now()) {
  if (!(day in store.days)) return;
  store.trash ??= {};
  store.trash[day] = { bars: store.days[day], deletedAt: now };
  delete store.days[day];
}

// Puts a day from the trash back.
export function restoreDay(store, day) {
  const t = store.trash?.[day];
  if (!t) return;
  store.days[day] = t.bars;
  delete store.trash[day];
}

// Empties what has been in the trash for more than 30 days.
export function purgeTrash(store, now = Date.now()) {
  for (const [day, t] of Object.entries(store.trash ?? {})) if (now - t.deletedAt > TRASH_DAYS * DAY_MS) delete store.trash[day];
}
