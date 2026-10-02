# Order status

An order's `status` moves only along these steps:

| From      | To        | Notes                                   |
|-----------|-----------|-----------------------------------------|
| new       | paid      |                                         |
| new       | cancelled | `refund` is false                       |
| paid      | shipped   |                                         |
| paid      | cancelled | `refund` is true (the money goes back)  |
| shipped   | delivered |                                         |

- `delivered` and `cancelled` are final: nothing moves out of them.
- Any other move throws an Error with the message `cannot go from <from> to <to>`,
  for example `cannot go from new to shipped`.
- An unknown status (either side) throws `unknown status <name>`.
- `transition(order, to)` returns a new order object with the new `status`, an `at`
  list that has one more entry (`{ status, step }`, where step counts from 1), and
  `refund` only when moving to `cancelled`. It never changes the order passed in.
