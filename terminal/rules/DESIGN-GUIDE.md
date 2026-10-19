# Design guide

How to make a page look designed, not generated. It comes with every request to make or restyle a page; the look
(the project's DESIGN.md, else the user's) says which colours and type to use, this says how to use them.

## Before you write
- Name the one thing the page is for. It goes first, biggest, and the eye lands on it before anything else.
- Pick the kind of page and its skeleton: a dashboard is a header, a row of numbers, then the detail; a settings
  screen is a side list and one form; a report puts the answer first and the evidence under it.
- Use real words and numbers from the request. Never lorem ipsum, "Item 1" or made-up placeholder blocks.

## Colour
- Every colour is a named token on :root (paper, surface, ink, muted, line, accent and the three states), redefined
  for dark mode under `@media (prefers-color-scheme: dark)`. Nothing is coloured outside the tokens.
- One accent, used for the main action and what is selected. Green, amber and red mean done, waiting and failed,
  and nothing else.
- Text keeps at least 4.5:1 contrast in light and dark. Muted text is for labels, never for content.

## Type
- One font stack and at most five sizes, from the same scale (for example 12, 14, 16, 20, 28). Body 15 to 17 px.
- Weight shows importance (400 body, 600 headings and numbers); never more than two weights in one card.
- Numbers line up: `font-variant-numeric: tabular-nums`, right-aligned in tables.

## Space and alignment
- One spacing step (4 or 8 px) and its multiples. Related things sit close; groups are separated by more space
  than the space inside them.
- Everything lines up on a few shared edges. Repeated cards and rows have the same parts, heights and ends.
- A card or widget is card-sized (about 320 to 440 px wide), centred or in a grid, never stretched across a wide
  window. A page keeps a readable column (about 1100 to 1280 px) or a deliberate full-width layout.

## Surfaces
- One corner radius for the page (for example 12 px for cards, 8 px for controls). Lines are 1 px; shadows, if
  any, are soft and the same everywhere. No thin coloured stripe down a card's edge.
- Buttons look like buttons: one primary per view, the rest quiet. A disabled button stays readable.
- Every state is designed: empty ("No invoices yet" and the next step), loading, error, and a long name.

## Make it work
- Every control does what its label says: a filter filters, a search searches, Next pages, Save saves and says so,
  Delete asks and offers Undo, Export writes a real file (a Blob). Something that needs a server says so in a toast;
  never a button that does nothing.
- Keep the data in one list and the view in one state object, and draw the page from them with one function, so every
  filter, sort, add and remove comes out right, and every count is counted, not typed.
- Forms check on submit, say what is wrong beside the field and focus the first one. A dialog is `<dialog>` with
  showModal; Esc closes it. Keys work: Enter sends, ← → move tabs, slides and charts.
- Zero results say so with a way back. `[hidden]` needs `display: none !important` when a class sets display.

## Phone
- From 390 px wide nothing scrolls sideways: grids use `minmax(0, 1fr)`, images `max-width: 100%`.
- On a phone it becomes one column in the same order; touch targets are at least 40 px tall.

## Finish
- Check it as a person would see it: desktop and phone, light and dark. Fix what looks cramped, unaligned,
  oversized or unfinished before calling it done.
