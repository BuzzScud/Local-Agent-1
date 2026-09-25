#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
grep -q 'titleCase' strings.test.mjs || { echo "no test for titleCase"; exit 1; }
node -e '
import("./strings.mjs").then(({ titleCase }) => {
  const cases = [["hello world", "Hello World"], ["hELLO wORLD", "Hello World"], ["nq futures", "Nq Futures"], ["a", "A"]];
  for (const [i, o] of cases) if (titleCase(i) !== o) { console.log("titleCase(" + i + ") = " + titleCase(i)); process.exit(1); }
}).catch((e) => { console.log(e.message); process.exit(1); })' || exit 1
