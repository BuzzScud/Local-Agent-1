# Changelog

## 1.3.0

- get() gives up after a timeout (timeoutMs, 10 s by default).
- get() retries a failed request (retries, 2 by default).
- getSync() is removed: use get().
- fetchUrl is a new name for get(), deprecated already; it goes in 2.0.

## 1.2.0

- get() follows redirects.
