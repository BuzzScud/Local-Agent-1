#!/bin/zsh
# A page saved to the Desktop of the (throwaway) home folder: todo.html
f=Desktop/todo.html
[ -f "$f" ] || { echo "no Desktop/todo.html"; exit 1; }
grep -Eqi '<meta[^>]+charset=["'"'"']?utf-8' "$f" || { echo 'no <meta charset="utf-8">'; exit 1; }
grep -Eqi -- 'localStorage' "$f" || { echo "the list is not kept in local storage"; exit 1; }
grep -Eqi -- 'checkbox' "$f" || { echo "no checkbox to tick a to-do off"; exit 1; }
grep -Eqi -- 'Enter|keydown|submit' "$f" || { echo "Enter does not add a to-do"; exit 1; }
grep -Eqi -- 'delete|remove' "$f" || { echo "no way to delete a to-do"; exit 1; }
grep -Eqi -- 'prefers-color-scheme|color-scheme' "$f" || { echo "it does not follow light or dark mode"; exit 1; }
