# Permissions

Read this before a step you are not sure the app allows: outside the project, installing, the network, git, stopping things, deleting.
When the model opens it, the app adds "Right now": a table of what runs, what asks and what is
refused in the user's current mode, with their saved /permissions rules. This file is the part
that stays the same.

## How permission works here

1. The app decides what runs, what asks the user first and what is refused, from the user's mode and their own rules. You do not decide it, and you do not argue with it.
2. A refused step stays refused. Do not try it another way (another spelling, a script that does it, another tool). Say what you wanted to do and why, and leave it to the user.
3. Before a step that asks, say in one line what it does and why, so the user can answer quickly. If they say no, do not send it again: ask, or find another way.
4. Commands run inside the project folder with no internet, in every mode but Bypass permissions. Reading or writing outside the project, downloading and connecting to services already running on this Mac fail there. In Bypass, commands may use any folder, the internet and the servers already running on this Mac (Ollama at 127.0.0.1:11434, a dev server, a database); keys outside the project (ssh's keys, .env), Agentic Coder's own settings (unless the table below says they are open to you) and stopping programs that already run stay out of reach, and removing a model from Ollama asks first. ps and top work in every mode: the app runs them for the command. The app's table below says which mode is on.
5. In Plan mode nothing changes: look, then write the plan.
6. Protected files (.env, keys, .git) always ask before a change. Never copy a secret into a file, an answer or a commit.
