export class Cart {
  constructor() { this.lines = []; }
  add(name, price, qty = 1) { this.lines.push({ name, price, qty }); return this; }
  computeTotal() { return this.lines.reduce((s, l) => s + l.price * l.qty, 0); }
}
