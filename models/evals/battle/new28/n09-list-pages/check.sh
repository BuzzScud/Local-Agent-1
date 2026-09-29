#!/bin/zsh
node -e "import('./list.mjs').then(({ listItems }) => {
  const a = Array.from({ length: 23 }, (_, i) => i + 1);
  const eq = (x, y, what) => { if (JSON.stringify(x) !== JSON.stringify(y)) { console.log(what + ': got ' + JSON.stringify(x)); process.exit(1); } };
  eq(listItems(a), { items: a.slice(0, 10), page: 1, pages: 3, total: 23 }, 'default');
  eq(listItems(a, { page: 3 }), { items: [21, 22, 23], page: 3, pages: 3, total: 23 }, 'page 3');
  eq(listItems(a, { page: 2, pageSize: 5 }), { items: [6, 7, 8, 9, 10], page: 2, pages: 5, total: 23 }, 'size 5');
  eq(listItems(a, { page: 9 }).items, [], 'past the end');
  eq(listItems([]), { items: [], page: 1, pages: 1, total: 0 }, 'empty');
})" || exit 1
