#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(shasum contracts.test.mjs | cut -c1-12)" = "5425c3af405c" ] || { echo "contracts.test.mjs was changed (fix the code, not the tests)"; exit 1; }
node -e "import('./contracts.mjs').then(({ nextContract: n }) => { for (const [a, b] of [['ESZ9', 'ESH0'], ['MESM7', 'MESU7'], ['NQU6', 'NQZ6'], ['GCZ8', 'GCH9']]) if (n(a) !== b) { console.log(a + ' gives ' + n(a) + ', not ' + b); process.exit(1); } })" || exit 1
