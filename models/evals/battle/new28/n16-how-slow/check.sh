#!/bin/zsh
# the model's answer is saved to ../answer.txt
grep -Eqi 'quadratic|n ?\^ ?2|n²|n squared|n ?\* ?n|o\(n2\)|square' ../answer.txt || { echo "the answer does not say that it grows with the square of the length"; exit 1; }
grep -Eqi 'loop' ../answer.txt || { echo "the answer does not say why (a loop inside a loop)"; exit 1; }
