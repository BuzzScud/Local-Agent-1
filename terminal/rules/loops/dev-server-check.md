# Dev server check
Opens your dev server every 5 minutes and says only when something changed: down, slow or an error on the page.

- Kind: web
- Every: 5m
- Until: no limit
- Mode: ask
- Picture: OPEN the server › CHECK for errors › TELL what changed
- Asks: url = http://localhost:5173

## Each run
Open {url}. Say whether it answers, how long it took and any error on the page. Say only what changed since the last run. Change nothing.
