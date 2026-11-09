# Behavior and security boundaries

Preserve these contracts unless the requested change explicitly revises them:

- An explicit file or URL takes precedence over piped input. Redirected
  output is plain text. Node can use a controlling terminal for interactive
  piped input; Bun and compiled binaries use plain output when stdin is
  redirected. Explicit `-` with terminal stdin reads to EOF, then prints.
- Local files reload, including after atomic replacement. URLs and stdin
  are read once. Resize reflows the display; `--refresh` is a debounce delay.
- `--no-wrap` clips prose in the TUI while preserving full prose in plain
  output. Tables and code blocks still wrap.
- Input limits count raw bytes and preserve complete UTF-8 characters.
  Reject nonregular file inputs, bound HTTP reads, and cancel unfinished
  reads. Preserve terminal-control sanitization and embedded-HTML handling.
  Treat document text, titles, file names, and status messages as untrusted
  terminal output; neutralize control sequences before displaying them.
- Depth validation bounds AST traversal after parsing; it does not prove
  that parsing has bounded CPU or memory use. Failed reloads retain the last
  valid document.
- Close owned streams and descriptors, restore terminal state, and avoid
  hanging shutdown. Include error and user-interruption paths when checking
  raw-mode and other terminal-state restoration. Verify lifecycle changes at
  the affected runtime boundary.

## Engineering constraints

- Measure terminal layout in display cells. Preserve grapheme clusters when
  wrapping or clipping text; string length alone does not account for CJK,
  combining marks, emoji, or zero-width joiners. Include borders and padding
  in table-width calculations.
- Coordinate asynchronous reads, parsing, and rendering so an older result
  cannot overwrite newer state. Make ownership and ordering explicit at the
  relevant boundary.
- Keep filesystem observation scoped. Account for partial writes, temporary
  files, duplicate events, and symlink cycles when changing watcher logic.
- Bound network and parsing work. Make timeouts, redirect handling, and
  size limits explicit; account for memory and rendered-output growth as
  well as input size.
- Keep input handling responsive during expensive work. Check for repeated
  parsing or reflow on frequent events, and measure the affected path before
  adding an optimization. Use the simplest approach that meets the measured
  resource constraints.

Use [Testing](../../TESTING.md) to select checks for the affected boundary.
