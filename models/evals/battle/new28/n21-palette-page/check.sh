#!/bin/zsh
# A page saved to the Desktop of the (throwaway) home folder: palette.html
f=Desktop/palette.html
[ -f "$f" ] || { echo "no Desktop/palette.html"; exit 1; }
grep -Eqi '<meta[^>]+charset=["'"'"']?utf-8' "$f" || { echo 'no <meta charset="utf-8">'; exit 1; }
grep -Eqi -- 'Math\.random|crypto\.getRandomValues' "$f" || { echo "the colours are not random"; exit 1; }
grep -Eqi -- 'New palette' "$f" || { echo "no "New palette" button"; exit 1; }
grep -Eqi -- 'keydown|keyup|keypress' "$f" || { echo "the space bar does nothing"; exit 1; }
grep -Eqi -- 'clipboard|execCommand' "$f" || { echo "clicking does not copy the code"; exit 1; }
grep -Eqi -- 'toString\(16\)|padStart|#' "$f" || { echo "no hex codes"; exit 1; }
