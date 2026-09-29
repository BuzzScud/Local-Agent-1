#!/bin/zsh
# A page saved to the Desktop of the (throwaway) home folder: preview.html
f=Desktop/preview.html
[ -f "$f" ] || { echo "no Desktop/preview.html"; exit 1; }
grep -Eqi '<meta[^>]+charset=["'"'"']?utf-8' "$f" || { echo 'no <meta charset="utf-8">'; exit 1; }
grep -Eqi -- '<textarea' "$f" || { echo "no text box"; exit 1; }
grep -Eqi -- 'addEventListener\(["\x27]input|oninput' "$f" || { echo "the preview does not update as you type"; exit 1; }
grep -Eqi -- '<h1|h1>|"h1"|\x27h1\x27|h\$\{' "$f" || { echo "no headings in the preview"; exit 1; }
grep -Eqi -- '<strong|<b>|strong' "$f" || { echo "no bold"; exit 1; }
grep -Eqi -- '<em|<i>|em>' "$f" || { echo "no italic"; exit 1; }
grep -Eqi -- '<ul|<li|li>' "$f" || { echo "no lists"; exit 1; }
