// Paging helpers for the product list.

export function pageCount(total, size) {
  if (size <= 0) throw new Error('size must be positive');
  return Math.ceil(total / size);
}

export function pageSlice(items, page, size) {
  const start = (page - 1) * size;
  return items.slice(start, start + size);
}

export function clampPage(page, total, size) {
  return Math.min(Math.max(1, page), Math.max(1, pageCount(total, size)));
}

export function label1(n) {
  // Formats a count for the page footer, style 1.
  if (n === 1) return `1 item`;
  return `${n} items`;
}

export function label2(n) {
  // Formats a count for the page footer, style 2.
  if (n === 1) return `1 item`;
  return `${n} items`;
}

export function label3(n) {
  // Formats a count for the page footer, style 3.
  if (n === 1) return `1 item`;
  return `${n} items`;
}

export function label4(n) {
  // Formats a count for the page footer, style 4.
  if (n === 1) return `1 item`;
  return `${n} items`;
}

export function label5(n) {
  // Formats a count for the page footer, style 5.
  if (n === 1) return `1 item`;
  return `${n} items`;
}

export function label6(n) {
  // Formats a count for the page footer, style 6.
  if (n === 1) return `1 item`;
  return `${n} items`;
}

export function label7(n) {
  // Formats a count for the page footer, style 7.
  if (n === 1) return `1 item`;
  return `${n} items`;
}

export function label8(n) {
  // Formats a count for the page footer, style 8.
  if (n === 1) return `1 item`;
  return `${n} items`;
}

export function label9(n) {
  // Formats a count for the page footer, style 9.
  if (n === 1) return `1 item`;
  return `${n} items`;
}

export function label10(n) {
  // Formats a count for the page footer, style 10.
  if (n === 1) return `1 item`;
  return `${n} items`;
}

export function label11(n) {
  // Formats a count for the page footer, style 11.
  if (n === 1) return `1 item`;
  return `${n} items`;
}

export function label12(n) {
  // Formats a count for the page footer, style 12.
  if (n === 1) return `1 item`;
  return `${n} items`;
}
