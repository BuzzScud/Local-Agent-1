#!/bin/zsh
# The notes page: one file on the Desktop of the (throwaway) home folder that
# works offline and does what the prompt asks: first the words a check without
# a browser can see, its own scripts must parse (check-page.cjs), then the page
# used in a real browser as the prompt describes it (click-check.mjs, 27 Oct
# 2026: the words passed a page whose Save never added the note). With no
# Chrome on the machine the click-through says so and passes.
f=Desktop/notes.html
[ -f "$f" ] || { echo "no Desktop/notes.html"; exit 1; }
grep -Eqi '<meta[^>]+charset=["'"'"']?utf-8' "$f" || { echo 'no <meta charset="utf-8">'; exit 1; }
grep -Eqi '<(script|link|img)[^>]+(src|href)=["'"'"']?(https?:)?//' "$f" && { echo "it loads something from the internet"; exit 1; }
grep -qi 'new note' "$f" || { echo 'no "+ New note" button'; exit 1; }
grep -q 'localStorage' "$f" || { echo "the notes are not kept in local storage"; exit 1; }
grep -q 'prefers-color-scheme' "$f" || { echo "it does not follow light or dark mode"; exit 1; }
grep -q 'Escape' "$f" || { echo "the Escape key does not close the modal"; exit 1; }
node "${0:A:h}/check-page.cjs" "$f" || exit 1
node "${0:A:h}/click-check.mjs" "$f" || exit 1
