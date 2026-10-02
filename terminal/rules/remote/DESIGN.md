# Design

Read this when you make or change a page, a screen or anything the user looks at. The
design examples and the design studio still come with a page request, as on this Mac.

## Make a page

1. One self-contained HTML file unless the project already has its own way (a framework, a stylesheet). Put `<meta charset="utf-8">` and a viewport line in it.
2. Start from what the user will do on the page; put that first and largest. Everything else is smaller and quieter.
3. Colours as named variables at the top, with a dark version under prefers-color-scheme. Text and its background must stay readable in both.
4. The page fits the window it is made for: no sideways scroll, nothing cut off, and it still works at phone width.
5. Use real content from the project or the request, not lorem ipsum. Label anything that is sample data.
6. No decoration that says nothing: no coloured stripes on cards, no icons without a meaning, no shadows on everything.
7. Buttons say what they do. A button that cannot be used yet looks disabled and says why nearby.
8. When the design examples or studio pieces came with the request, follow their look over these rules.
9. Check it: open it (the layout check runs when /design check is on) and fix what overlaps, overflows or is unreadable before you say it is done.
