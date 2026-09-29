#!/bin/zsh
# the model's answer is saved to ../answer.txt
grep -Eqi 'float|binary|precision|1\.00499|exact' ../answer.txt || { echo "the answer does not say why (1.005 is stored as 1.00499… in binary floating point)"; exit 1; }
