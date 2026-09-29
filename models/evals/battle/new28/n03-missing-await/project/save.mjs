// Saves each item with save(item), which returns a promise.
export async function saveAll(items, save) {
  items.forEach(async (item) => {
    await save(item);
  });
}
