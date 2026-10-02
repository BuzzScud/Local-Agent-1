# Security

Read this when your code handles input from outside (users, files, the network), runs commands, builds queries or paths, or touches secrets, logins or permissions.

## Write it safe

1. Treat all outside input as untrusted: check its type, size and shape where it comes in, and refuse what does not fit.
2. Never build a shell command, SQL query or HTML from strings. Pass arguments as a list (execFile, subprocess with a list), use query parameters, and escape what goes into HTML.
3. Paths from input: resolve them and check they stay inside the folder they belong in (no ../, no absolute paths from the user).
4. Never parse untrusted data with eval, new Function, pickle, yaml.load or similar: use JSON or a safe loader.
5. Secrets: read them from the environment or a config the project already uses; never hard-code them, never log them, never print them in errors.
6. Logins and permissions: check on the server side, on every request, and deny by default.
7. When you fix a security bug, add a test with the bad input that proves it is refused.
