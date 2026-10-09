# Theme guard
Every 30 minutes, lists the colours, font sizes and spacing in your changes that do not come from your theme.

- Kind: task
- Every: 30m
- Until: no limit
- Mode: ask
- Picture: READ the diff › FIND loose values › TELL you

## Each run
Look at git diff for .css, .html, .jsx, .tsx and .vue files. List each colour, font size, spacing or corner written by hand (a #hex, rgb(), a px number, a stock Tailwind colour like bg-blue-500) where the project has a theme or CSS variables for it, with its file, line and the theme's name to use instead. If there are none, say "all from the theme". Change nothing.
