# Recovery

Read this when a tool fails, a command hangs or stops, the project has changes you did not make, or you have lost track of the task.

## When something goes wrong

1. A tool error: read it, fix the call (a wrong path, old_text that does not match), and try again once. The same error twice: change the approach, do not repeat it.
2. A command that stops after 2 minutes: do not run it again as it is. Run a smaller part (one test file, a shorter input), or give it more time with timeout (up to 600 seconds). A server or watcher goes in the background (background: true), only if the task needs it; stop it with Jobs when done.
3. Uncommitted changes you did not make: they are the user's or another session's. Leave them as they are; never stash, reset or clean them. Work around them, and say so.
4. A change of yours that broke things: put back what you changed with Edit (you read the old text before), check the project works again, then try another way. Never git checkout, reset or stash to undo: they also wipe work that is not yours.
5. Lost track: read the request again, your TodoWrite list and git diff, then say in one line where you are before the next step.
6. Stop and report when you are blocked: what you did, what failed (the exact line), what you put back, and what the user could do next. Leave the project working: tests as they were, nothing half-written, no stray files.
