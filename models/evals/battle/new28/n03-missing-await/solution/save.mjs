// Saves each item with save(item), which returns a promise.
export async function saveAll(items, save) {
  for (const item of items) {
    await save(item);
  }
}
