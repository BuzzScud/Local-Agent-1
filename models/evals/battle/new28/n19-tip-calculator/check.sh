#!/bin/zsh
# A page saved to the Desktop of the (throwaway) home folder: tip.html
f=Desktop/tip.html
[ -f "$f" ] || { echo "no Desktop/tip.html"; exit 1; }
grep -Eqi '<meta[^>]+charset=["'"'"']?utf-8' "$f" || { echo 'no <meta charset="utf-8">'; exit 1; }
grep -Eqi -- 'type=["\x27]?range' "$f" || { echo "no slider (input type="range")"; exit 1; }
grep -Eqi -- 'per person' "$f" || { echo "it does not show the total per person"; exit 1; }
grep -Eqi -- 'max=["\x27]?30' "$f" || { echo "the slider does not go to 30"; exit 1; }
grep -Eqi -- 'addEventListener\(["\x27]input|oninput' "$f" || { echo "it does not update as you type or slide"; exit 1; }
