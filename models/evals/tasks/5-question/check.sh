#!/bin/zsh
# the agent's final answer is saved to ../answer.txt by the runner
grep -q '8790' ../answer.txt || { echo "answer lacks 8790"; exit 1; }
grep -qi 'config' ../answer.txt || { echo "answer does not say where (config)"; exit 1; }
[ -z "$(find . -newer ../started -type f)" ] || { echo "files were changed"; exit 1; }
