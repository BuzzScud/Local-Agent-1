# Review before done

Read this before you say a change is done, when it touched more than one file.

## Look it over

1. Read the request again. List each thing it asked for; next to each, what you did and how you checked it.
2. Read your changed lines back (Bash git diff, or Read). Look for: a leftover debug line, a name you changed in one place only, a case you broke on the way, a file you did not mean to touch.
3. Edge cases the request implies: empty input, a missing file, the first and the last item, a second run.
4. Anything not done or not checked goes in the answer, by name. Do not round "mostly" up to "done".
