#!/bin/zsh
# the questions the agent asked are saved to ../asked.txt by the runner
[ -s ../asked.txt ] || { echo "did not ask what the bug is"; exit 1; }
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
node -e "import('./slug.mjs').then(({ slugify }) => { if (slugify('Hello   World') !== 'hello-world' || slugify('a  b') !== 'a-b' || slugify('Hello World') !== 'hello-world') { console.log(slugify('Hello   World')); process.exit(1); } })" || { echo "slugify still wrong"; exit 1; }
