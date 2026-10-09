# Accessibility pass
Every hour, checks your page for what stops people using a keyboard or a screen reader, and for text too faint to read.

- Kind: web
- Every: 1h
- Until: no limit
- Mode: ask
- Page check: {page} · who can use it
- Picture: CHECK the page › READ the code › LIST each fix
- Asks: page = index.html

## Each run
The page check of {page} is above, with what it found about who can use the page. Then read the page's code for what the check cannot see: a focus outline taken away, a click handler on something that is not a button or a link. List each problem with its file and line and its fix in one line, the worst first. Say only what is new since the last run. Change nothing.
