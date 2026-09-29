#!/bin/zsh
# A page saved to the Desktop of the (throwaway) home folder: timer.html
f=Desktop/timer.html
[ -f "$f" ] || { echo "no Desktop/timer.html"; exit 1; }
grep -Eqi '<meta[^>]+charset=["'"'"']?utf-8' "$f" || { echo 'no <meta charset="utf-8">'; exit 1; }
grep -Eqi -- '25:00' "$f" || { echo "the page does not show 25:00"; exit 1; }
grep -Eqi -- '>\s*Start\s*<|Start' "$f" || { echo "no Start button"; exit 1; }
grep -Eqi -- 'Pause' "$f" || { echo "no Pause button"; exit 1; }
grep -Eqi -- 'Reset' "$f" || { echo "no Reset button"; exit 1; }
grep -Eqi -- 'setInterval|setTimeout|requestAnimationFrame' "$f" || { echo "nothing counts down (no timer in the script)"; exit 1; }
grep -Eqi -- 'prefers-color-scheme|color-scheme' "$f" || { echo "it does not follow light or dark mode"; exit 1; }
