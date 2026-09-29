// A tiny in-memory table store.
const tables = {};
export const db = {
  all: (t) => tables[t] ?? [],
  add: (t, row) => { (tables[t] ??= []).push(row); return row; },
};
