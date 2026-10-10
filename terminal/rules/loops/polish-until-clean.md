# Polish until clean
Fixes what the page check finds, run after run, and ends once nothing is broken (10 runs at most, $1 at most).

- Kind: debug
- Every: until done
- Until: 10 runs
- Mode: edits
- Cap: $1.00
- Page check: {page}
- Picture: CHECK the page › PICK the worst › FIX the layout › CHECK again
- Asks: page = index.html

## Each run
The page check of {page} is above. Fix the problems it lists in the code that draws the page (its HTML, CSS or components), the worst first: text cut off or on top of other text, sideways scrolling, faint text. Change no other page. If the check found nothing broken, change nothing and end with LOOP DONE.
