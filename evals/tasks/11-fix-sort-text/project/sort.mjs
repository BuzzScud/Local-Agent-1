// Products from cheapest to dearest.
export function byPrice(products) {
  return [...products].sort((a, b) => String(a.price).localeCompare(String(b.price)));
}
