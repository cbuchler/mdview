# mdview

Read Markdown in your terminal. `mdview` reloads local files when you save them and adjusts the layout when you resize the window.

It supports GitHub-Flavored Markdown, including tables, task lists, and code blocks. You can read a file, fetch a URL, or pipe in text. Redirect output to get plain text.

## Install

### Linux binary

Download `mdview-linux-x64.tar.gz` from [GitHub Releases](https://github.com/cbuchler/mdview/releases/latest). Extract it, then install the binary:

```bash
tar -xzf mdview-linux-x64.tar.gz
mkdir -p ~/.local/bin
install -m 755 mdview ~/.local/bin/mdview
```

Make sure `~/.local/bin` is on your `PATH`. The binary runs on Linux x86-64. For other platforms, build from source.

### From source

Use Node.js 22.13 or newer and npm to build from source:

```bash
git clone https://github.com/cbuchler/mdview.git
cd mdview
npm ci
npm run build
node dist/main.js README.md
```

To build a standalone binary, install Bun and run:

```bash
npm run package:binaries
npm run install:binary
```

This installs `release/mdview` as `~/.local/bin/mdview`. Set `MDVIEW_INSTALL_DIR` to choose another directory.

## Use

```bash
mdview README.md
mdview README.md --theme dracula
mdview https://example.com/readme.md
cat README.md | mdview
mdview - < README.md
```

Pass a file path or an HTTP(S) URL. With no argument and terminal input, `mdview` opens recent documents. Use `-`, or omit the argument when piping, to read stdin. An explicit file or URL takes precedence over piped input.

The Node CLI opens piped input interactively when a controlling terminal is available for keyboard input. Otherwise, it prints plain text. Bun and compiled binaries print plain text whenever stdin is redirected, because Bun cannot safely close a separate terminal keyboard reader. Normal file and URL viewing with terminal stdin remains interactive in both runtimes. Running `mdview -` with terminal input reads until EOF (`Ctrl+D`), then prints plain text.

### Keys

| Key | Action |
| --- | --- |
| `q` or `Ctrl+C` | Quit |
| `j` / `k` or down / up arrow | Scroll one line |
| `Space` or `Page Down` | Scroll down one page |
| `b` or `Page Up` | Scroll up one page |
| `g` / `G` | Go to the top / bottom |
| `h` | Open recent documents |

### Recent documents

Run `mdview` or `mdview --history` in a terminal to search recent documents. Press `h` in the reader to open the same picker. Type to filter titles and locations by matching characters in order, including Unicode text. Entries remain in most-recent-first order.

The reader and history picker have bordered headers and footers with inner padding. Small terminals use compact bars to leave room for content.

| Picker key | Action |
| --- | --- |
| Up / down arrow or `Ctrl+P` / `Ctrl+N` | Select an entry |
| `Enter` | Open the selected document and resume reading |
| `Escape` | Return to the current document, or exit from the home screen |
| `Backspace` | Remove the last query character |
| `Ctrl+D` | Remove the selected history entry |
| `Ctrl+X`, then `y` | Clear all history; another key cancels |
| `Ctrl+C` | Quit |

All printable keys, including `q`, `h`, `j`, and `k`, enter the query. The picker shows the title, location, last successful open, and missing local files. Missing entries remain until removed. Opening a missing file reports the read error; `h` returns to history. URLs are never fetched just to draw the list.

History retains up to 200 successful file/URL opens in `$XDG_STATE_HOME/mdview/history.sqlite3`, or `~/.local/state/mdview/history.sqlite3` when that variable is unset or not absolute. SQLite transactions handle concurrent sessions. The directory is private (0700), and the database uses mode 0600. It stores location, title, time, and a reading anchor; it does not cache document bodies. This is local plaintext metadata, not encrypted storage.

Stdin and failed opens are excluded. URLs with credentials, any query, or a fragment are also excluded, with a notice. This conservative rule can omit harmless URLs. `--no-history` disables all history reads and writes for that invocation. `--history` cannot be combined with an input or `--no-history`, and requires terminal input and output.

Successful redirected file/URL output updates recency while keeping any saved reading position. Normal reader exit flushes position changes; abrupt termination can lose the latest change. Edited or identical repeated passages retain the matching limits described below.

History errors do not prevent reading. A busy database is retried briefly without blocking keyboard input. Corrupt or unsafe storage is left intact. To recover it, close all mdview sessions, move the mdview state directory aside, and restart. Do not replace a live database while another session is using it.

### Reloading and resizing

Local files reload on save. Use `--no-watch` to turn this off. `--refresh 150ms` sets the delay used to group file changes; it does not poll URLs. URLs and stdin are read once. Redirected output is also written once.

Resizing the terminal rewraps the text, code blocks, and table cells. If a table cannot fit, each row becomes a list of header/value pairs.

While you scroll, mdview remembers the source passage at the top of the view. Resize and reload keep that passage visible when it survives the edit. Repeated resizes keep the same logical point. Scrolling during a pending render sets the new reading position.

If the passage is removed, mdview tries the following block, then the preceding block, then the nearest source position. Edited passages and identical repeated sections use best-effort matching. The view stays within the document bounds. This does not follow new content at the end. History saves the reading position for eligible documents unless `--no-history` is set.

Long lines wrap by default. `--no-wrap` leaves prose unwrapped and clips it to the terminal width. Code blocks and tables still wrap.

URLs have a timeout and an input size limit. `mdview` removes terminal control sequences from input and skips embedded HTML. Markdown nesting is limited to 128 AST child levels, including structural and inline nodes (root = 0). Character widths can vary with your terminal and font.

Markdown parsing and layout run in one child process in both interactive and plain output. Each render has a 5-second wall-clock deadline, including child startup and response transfer. This deadline is separate from the URL timeout. A resize reuses the child's latest parsed document. A new request cancels unfinished work. Quit and catchable termination signals stop the child; normal CLI shutdown waits for its exit. An invalid or timed-out reload keeps the last valid title and content. Resize can reflow that content while the error remains visible.

Each result is limited to 16 MiB of protocol data, 8 MiB of decoded text, 50,000 lines, 50,000 source blocks, and 100,000 styled segments. Titles and error messages are limited to 4 KiB; child diagnostics are limited to 8 KiB. These fixed output limits also apply when `maxInputBytes` is increased. Source text travels as bounded UTF-8 bytes, without a JSON copy. Protocol records are checked before display. These limits bound communication and retained output; they do not bound parser memory.

The child has no hard OS memory limit. It can exhaust available memory before the deadline. Hard memory enforcement remains open in [issue #24](https://github.com/cbuchler/mdview/issues/24). If the parent receives an uncatchable termination such as `SIGKILL`, a busy child can continue until it finishes its synchronous work or fails. Idle children exit when their input pipe closes. No systemd service or native launcher is required.

## Options

Run `mdview --help` for help.

| Option | Purpose |
| --- | --- |
| `--theme <name>` | Set the text and status bar theme |
| `--syntax-theme <name>` | Set the code theme |
| `--refresh <duration>` | Set the file reload delay, such as `150ms` |
| `--timeout <duration>` | Set the URL timeout, such as `8s` |
| `--max-bytes <size>` | Limit input size, such as `1mb` |
| `--padding <number>` | Set left and right padding |
| `--wrap[=<boolean>]` / `--no-wrap` | Turn prose wrapping on or off |
| `--watch` / `--no-watch` | Turn file reloads on or off |
| `--history` | Open recent documents in a terminal |
| `--no-history` | Disable history reads and writes |
| `--config <path>` | Use a config file |
| `--print-config` | Print the config template |
| `--init-config` | Create a config file without overwriting one |
| `-h`, `--help` | Show help |
| `--version` | Show the version |

Durations accept milliseconds, seconds, or minutes: `150`, `150ms`, `8s`, `1m`. Sizes accept bytes, KB, MB, or GB: `1024`, `1kb`, `2mb`, `1gb`.

Bare `--wrap` enables wrapping. Explicit values such as `--wrap=false` and `--wrap false` are also accepted. For a file named `false`, use `./false` after `--wrap`, or put the filename first.

## Configure

`mdview` reads `~/.config/mdview/config.yml`, or `config.yaml` if there is no `.yml` file. Command-line options override the config file; the config file overrides defaults.

These are the supported keys and their defaults:

```yaml
# Text and status bar theme.
theme: tempus-rift

# Code theme.
syntaxTheme: dracula

# Wrap prose.
wrap: true

# Left and right padding, in terminal columns.
padding: 1

# Delay used to group file changes, in milliseconds.
refreshIntervalMs: 150

# URL timeout, in milliseconds.
timeoutMs: 8000

# Input size limit, in bytes.
maxInputBytes: 2097152

# Reload local files on save.
watch: true
```

Choose from `github`, `dracula`, `solarized`, `tempus-rift`, `midnight`, and `paper`. `tempus rift` and `tempusrift` also mean `tempus-rift`.

Create the default config file:

```bash
mdview --init-config
```

Or choose a path:

```bash
mdview --init-config --config ./mdview.yml
```

Use `mdview --print-config` to print a commented template. Invalid options, values, themes, YAML, and unknown config keys produce an error.

## Shell completion

Completion scripts are in `completions/`. Replace `/path/to/mdview` below with the directory where you cloned or extracted mdview.

### Bash

Add this to your shell profile:

```bash
source /path/to/mdview/completions/bash/mdview
```

### Zsh

Add this to `.zshrc`, before any existing `compinit` call:

```zsh
fpath+=(/path/to/mdview/completions/zsh)
autoload -Uz compinit
compinit
```

### Fish

```fish
mkdir -p ~/.config/fish/completions
cp /path/to/mdview/completions/fish/mdview.fish ~/.config/fish/completions/
```

## Develop

Use Node.js 22.13 or newer. The Linux terminal tests also require Python 3; they check Bun behavior when Bun is installed. Shell completion tests use Bash and check Zsh and Fish when installed. Missing optional shells are reported as skipped tests.

```bash
npm ci
npm run dev -- README.md
npm test
npm run build
```

## License

[GNU GPLv3 or later](LICENSE).
