# Changelog

## 0.3.0 — 2026-11-11

- Require sandboxed Markdown rendering on Linux and macOS. Refuse rendering when protection cannot start; allow an explicit `--no-sandbox` override for one invocation (#40).
- Enforce a 256 MiB parser memory budget through native OS controls. Linux also limits tasks and disables swap for the worker group. Failed reloads keep the last valid document visible (#41).
- Prepare standalone archives for Linux and macOS on x64 and ARM64, with checksums, shell completions, and an installer that verifies downloads before replacement (#42).
- Add Homebrew installation through `cbuchler/tap/mdview`, with native source-build, bottle, and public installation checks (#43).
- Simplify installation, usage, configuration, and runtime guidance in the README.

Native CI targets Ubuntu 26.04 and macOS 26. Linux requires Bubblewrap and a systemd user manager with cgroup v2 memory and task controls. macOS uses private memory APIs and the deprecated Seatbelt interface; the initial archives are not notarized. The memory budget applies to the parser, not the whole viewer. `--no-sandbox` disables sandbox and OS memory protection.

## 0.2.1 — 2026-11-10

- Restore rounded, theme-coloured borders and inner padding around the history header and footer. Each bar contains one text row; its top and bottom borders add two terminal rows (#36).
- Reserve the border rows when paging through history. Keep compact bars in very small terminals, with search, help, and confirmation in the body.
- Clarify the history layout in the README.

## 0.2.0 — 2026-11-10

- Search recent documents from the home screen, `--history`, or `h` in the reader. Store up to 200 entries and saved reading positions in SQLite, with support for concurrent sessions. Use `--no-history` to disable storage for an invocation (#2).
- Keep the current passage visible through terminal resize and file reload. Resume saved positions when reopening eligible documents (#1).
- Add padded borders to reader bars. Give history one-row bars, page navigation, a position counter, and secondary actions under `Tab` help (#30).
- Run Markdown parsing and layout in a child process with a deadline and bounded output. Reuse parsed documents on resize and keep the last valid content visible after a failed reload (#24).
- Preserve inline link styles in Markdown tables (#22).
- Cancel queued reloads when the file watcher is disposed.
- Refresh installation, usage, history, and configuration guidance in the README (#32).

The render child has no hard OS memory limit. Complex input can exhaust available memory before its deadline. Hard memory enforcement remains open in [issue #24](https://github.com/cbuchler/mdview/issues/24).

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
