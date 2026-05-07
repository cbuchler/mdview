# mdview v1 Plan

  ## Summary
  Build `mdview` as a Node/TypeScript terminal app using Ink, with a first release that includes:

  - local files, stdin, and URL input
  - live reload with debounce
  - full config support
  - syntax themes
  - standalone binaries for Linux and macOS
  - CI-backed release artifacts and docs

  This is a feature-complete v1 rather than a pared-down MVP.

  ## Key Changes
  - Core app architecture:
    - source resolver for file/stdin/URL inputs
    - markdown parse/render pipeline for GFM
    - Ink-based viewport, status bar, and key handling
    - resize-aware wrapping and scroll preservation
  - Configuration:
    - CLI flags, environment variables, config file, defaults
    - config file at `~/.config/mdview/config.json`
    - support for theme, wrap, padding, refresh interval, syntax theme, and keybinding remapping
  - Live reload:
    - file watcher with debounce
    - partial-write resilience and error-state UI
    - rerender without full app reset when possible
  - Packaging/release:
    - standalone binary build pipeline
    - release artifacts for Linux x64, Linux ARM64, macOS Intel, and macOS Apple Silicon
    - no runtime Node/npm dependency for end users

  ## Implementation Shape
  - `src/cli` handles argument parsing, input selection, and startup.
  - `src/config` merges config sources in priority order: CLI > env > config file > defaults.
  - `src/markdown` owns parsing, syntax highlighting, and render output.
  - `src/filewatch` watches local files and drives reloads.
  - `src/ui` owns viewport, status bar, error state, and keyboard navigation.
  - Keep the first pass modular but not over-abstracted so the rendering loop stays easy to reason about.

  ## Test Plan
  - Unit tests for:
    - config precedence and validation
    - source resolution for file/stdin/URL
    - debounce and reload state transitions
    - keybinding handling and scroll math
  - Integration tests for:
    - resize behavior
    - invalid/missing file errors
    - URL fetch failures
    - config parsing failures
  - Packaging smoke tests for:
    - produced binaries start successfully
    - `mdview README.md` works on each supported platform target
    - no Node runtime is required on the test machine

  ## Risks and Terminal Constraints
  - Unicode width is a hard dependency: emoji, CJK, combining marks, and ZWJ sequences can break wrapping and alignment if width handling is naïve.
  - Table rendering is fragile in terminals because wrapping a single cell can misalign the whole row.
  - Resize handling must recompute wrapping from current terminal width and preserve scroll position when possible.
  - Reload, parse, and render need serialized state transitions to avoid stale frames and flicker.
  - File saves often arrive as partial writes, so debounce and retry behavior must be part of the reload path.
  - tmux and zellij can behave differently from standalone terminals, so they need explicit verification.
  - Raw mode, alternate screen, and signal cleanup must always restore the terminal on exit, crash, or Ctrl-C.
  - Long lines need a deliberate policy early, because soft wrap vs overflow affects scroll math and viewport design.
  - URL input introduces latency and failure states, so fetch errors must be shown in the UI without blocking interaction.

  ## Security and Performance Guardrails
  - Enforce conservative URL fetch behavior:
    - reasonable timeout
    - explicit redirect policy
    - clear failure handling in the UI
  - Add size and memory guardrails for very large inputs so the app degrades predictably instead of thrashing.
  - Treat untrusted markdown as potentially hostile to the terminal:
    - sanitize or neutralize escape sequences in rendered text, titles, file names, and status output
    - avoid passing raw control codes through from content
  - Keep file watching scoped and resilient:
    - ignore noisy temporary files and partial-save artifacts
    - avoid symlink loops and duplicate watch events
  - Define a render budget for large documents:
    - avoid unbounded reparse/reflow work on every keystroke or resize
    - prefer incremental or bounded updates where possible
  - Keep fetch and parse work off the UI path so interaction stays responsive during slow network or large-file cases.
  - If caching is added for URLs, make the cache policy explicit so stale data and memory growth are controlled.

  ## Assumptions
  - v1 includes URL input and syntax themes, not just local files.
  - Windows is deferred unless you want it added after the Linux/macOS release path is stable.
  - Search, bookmarks, and mouse interaction stay out of v1 unless explicitly added later.
  - The project will start from the current empty repo state, so the first milestone is scaffolding and architecture, not refactoring existing code.
