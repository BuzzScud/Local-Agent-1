// Products from cheapest to dearest.
export function byPrice(products) {
  return [...products].sort((a, b) => a.price - b.price);
}
