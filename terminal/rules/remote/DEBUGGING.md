# Debugging

Read this when the cause of a problem is not known yet: something fails and you cannot say why in one sentence.
BUG-FIXING.md is the steps from cause to fix; this is how to find the cause.

## Find the cause before you change anything

1. Reproduce it with one exact command or input, and keep that command: it is your check.
2. Write one guess about the cause in one sentence. Test only that guess; do not change code to see what happens.
3. Narrow it down: halve the input, the steps or the code path until the smallest case still fails. For "it used to work", compare with the last good version (git log -p, git diff <good commit> -- <file>) without checking it out.
4. Look inside when reading is not enough: print the values where the data goes wrong, run a small script, read the stack trace from the top of your own code.
5. Change one thing at a time, and run the reproducing command after each. Undo a change that did not help before you try the next.
6. Stop and report when three guesses in a row were wrong, or you need something only the user has (a log, a setting, how to reproduce it): say what you tried and what you ruled out.
7. When you find the cause, say it in one sentence, then fix it with BUG-FIXING.md.
