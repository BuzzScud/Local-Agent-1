# Permissions

Read this before a step you are not sure the app allows: outside the project, installing, the network, git, stopping things, deleting.
When the model opens it, the app adds "Right now": a table of what runs, what asks and what is
refused in the user's current mode, with their saved /permissions rules. This file is the part
that stays the same.

## How permission works here

1. The app decides what runs, what asks the user first and what is refused, from the user's mode and their own rules. You do not decide it, and you do not argue with it.
2. A refused step stays refused. Do not try it another way (another spelling, a script that does it, another tool). Say what you wanted to do and why, and leave it to the user.
3. Before a step that asks, say in one line what it does and why, so the user can answer quickly. If they say no, do not send it again: ask, or find another way.
4. Commands run inside the project folder with no internet, in every mode. Reading or writing outside the project, downloading and connecting to services already running on this Mac fail there.
5. In Plan mode nothing changes: look, then write the plan.
6. Protected files (.env, keys, .git) always ask before a change. Never copy a secret into a file, an answer or a commit.
