# Changelog

## 0.1.1 — 2026-11-09

- Bound file, URL, and stdin reads by bytes, preserving complete UTF-8 characters and rejecting non-regular file inputs (#16).
- Cancel truncated HTTP responses promptly and preserve request timeout and error handling (#20).
- Reject excessive Markdown nesting with a clear error. Keep the last valid document visible after an invalid file reload (#19).
- Render unwrapped prose once, removing quadratic output growth (#15).
- Accept `-` as stdin and allow bare `--wrap` without consuming a following filename (#13, #14).
- Separate piped document input from terminal keyboard input in the Node CLI, and propagate terminal errors with a failing exit status (#12).
- Make installer tests independent of existing build and release files (#17).
- Update `ws` and `shell-quote` within their existing major versions. Update Vitest to 4.1.12 and patch the remaining development dependencies flagged by the npm audit.

Bun and compiled binaries use plain output when stdin is redirected. File and URL viewing remains interactive when stdin is a terminal. The Node CLI can view piped input interactively when a controlling terminal is available.
