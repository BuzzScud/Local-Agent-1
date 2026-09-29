// The bank keeps each day's bars: store = { days: { 'YYYY-MM-DD': [bars] }, trash: {} }.

// Deletes a saved day.
export function removeDay(store, day) {
  delete store.days[day];
}
