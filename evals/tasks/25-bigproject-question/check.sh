#!/bin/zsh
# the agent's final answer is saved to ../answer.txt by the runner
grep -qi 'testCommand\|prompt\.mjs' ../answer.txt || { echo "answer does not name testCommand / prompt.mjs"; exit 1; }
grep -q 'pytest' ../answer.txt || { echo "answer lacks pytest"; exit 1; }
[ -z "$(find . -newer ../started -type f)" ] || { echo "files were changed"; exit 1; }
