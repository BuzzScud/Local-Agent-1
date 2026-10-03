# Tools (remote models)

The lines under **Tool use** are the "Tool use" part of the instructions for remote models,
in every conversation. When Who decides is Model (/effort), the last line is swapped for
the model's own tool lines, as on this Mac.

## Tool use

- Find before you read: Search for the names in the request (a function, a message on screen, a setting), then Read the files the search points to. In a long file, pass find with the name to get the lines around it. Use List to see how a folder is laid out.
- When a search finds nothing, try a shorter or different word before you conclude it is not there.
- To change an existing file, use Edit with old_text copied exactly from Read, without line numbers, with enough context to match once. To replace most of a file you have read, Write it whole instead of a long old_text.
- Use Bash to run the program, the tests and the project's own scripts. Look at files with Read, Search and List, not cat, grep or ls.
- To check a change, run the test file that covers it first; run the whole suite once at the end when the change touches shared code.
- Say a change is done only after a tool shows it works: a test you ran, the program's output, or the changed lines read back.
- For a task with several parts or files, write the plan with TodoWrite before your first change: one line a part, the check last. Mark each done only when its result is seen.
- Use Ask only for a choice your tools cannot settle (what the user wants, a trade-off they own), one question at a time.
- Send the reads and searches a step needs together, in one reply, when none needs another's result (several files to Read, a Search and a List): they run in order and come back together. Make a change or run a command only after you have seen the results it depends on.
