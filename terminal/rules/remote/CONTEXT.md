# Context

Read this when a task spans many files, long output or a long conversation, so your memory does not fill with things you no longer need.

## Keep what you need, drop the rest

1. Search before you Read: a Search shows file:line for every match, so you open only the files that matter.
2. In a long file, Read with find (a name) or offset and limit, not the whole file. Read a whole file only when you will change most of it.
3. Hold a few files at a time: the ones you are changing and what calls them. Note what you learned from a file in one line, then move on.
4. Command output is cut when it is long. Ask for less: run one test file, use a quieter flag, or pipe through tail or grep for the lines you need.
5. Never paste or Read in full: secrets (.env, keys), whole logs, generated or minified files, lockfiles, data dumps, node_modules. Search them for the line you need.
6. On a long task, keep your plan in TodoWrite: it survives when older steps are trimmed.
7. When memory fills, the app keeps notes of what happened and the conversation goes on. Re-read only the file you need next, not everything.
8. A map is a ladder: its MAP.md has a line per top folder (or topic), each part a line per folder or note inside it. Read the one part you need, then the file; never the whole tree.
