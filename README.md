# mdview

Read Markdown in your terminal and return to where you left off.

- Open a file, fetch an HTTP(S) URL, or read piped text.
- Search recent documents and resume saved reading positions.
- Reload local files on save and reflow content when the terminal resizes.
- Read tables, task lists, and code blocks, or redirect output as plain text.

[Install](#install) · [Quick start](#quick-start) · [Recent documents](#recent-documents) · [Configure](#configure) · [Options](#options)

## Install

Current source builds require Linux sandbox dependencies before rendering. See
[sandbox requirements and the explicit override](#limits-and-failure-recovery).
Published release behavior is described in that release's notes.

### Linux binary

Download `mdview-linux-x64.tar.gz` and `SHA256SUMS` from the same [GitHub release](https://github.com/cbuchler/mdview/releases/latest). Verify the archive, extract it, then install the binary:

```bash
sha256sum -c SHA256SUMS
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

To build and try a standalone binary, install Bun and run from the repository:

```bash
npm run package:binaries
./release/mdview README.md
```

To install that binary:

```bash
npm run install:binary
```

This installs `release/mdview` as `~/.local/bin/mdview`. Set `MDVIEW_INSTALL_DIR` to choose another directory.

## Quick start

```bash
mdview README.md
mdview
mdview --history
mdview README.md --theme dracula
mdview https://example.com/readme.md
cat README.md | mdview
mdview README.md > README.txt
```

Open a document, press `h` to search recent documents, then press `Enter` to reopen one at its saved position. Run `mdview` with no argument in a terminal to start in history.

Use `--no-history` for an invocation that must not read or update history:

```bash
mdview --no-history private-notes.md
```

<details>
<summary>Pipes, redirected output, and explicit stdin</summary>

Use `-`, or omit the argument when piping, to read stdin. An explicit file or URL takes precedence over piped input. Redirecting output always produces plain text.

The Node CLI opens piped input interactively when a controlling terminal is available for keyboard input. Otherwise, it prints plain text. Bun and compiled binaries print plain text whenever stdin is redirected, because Bun cannot safely close a separate terminal keyboard reader. Normal file and URL viewing with terminal stdin remains interactive in both runtimes. Running `mdview -` with terminal input reads until EOF (`Ctrl+D`), then prints plain text.

</details>

## Reading

The reader has padded borders around its title/status bar and key hints. Small terminals use compact bars to leave room for content.

| Key | Action |
| --- | --- |
| `q` or `Ctrl+C` | Quit |
| `j` / `k` or down / up arrow | Scroll one line |
| `Space` or `Page Down` | Scroll down one page |
| `b` or `Page Up` | Scroll up one page |
| `g` / `G` | Go to the top / bottom |
| `h` | Open recent documents |

## Recent documents

Run `mdview` or `mdview --history` in a terminal to search recent documents. Press `h` in the reader to open the same picker. Type to filter titles and locations by matching characters in order, including Unicode text. Entries remain in most-recent-first order.

History has a padded, bordered header and footer. Each bar contains one text row; its top and bottom borders add two terminal rows. The search prompt sits below the header, above the list. Short or very narrow terminals use compact bars to leave room for content. Each entry shows its title and location. Dates appear beside titles when space permits, and the footer shows your position in the results.

Press `Tab` for help with secondary actions. Press `Tab` or `Escape` to return to the list with your search and selection preserved. Clearing history opens a separate confirmation view.

| Picker key | Action |
| --- | --- |
| Up / down arrow | Select an entry |
| `Page Up` / `Page Down` | Move through results one page at a time |
| `Enter` | Open the selected document and resume reading |
| `Tab` | Show or hide help |
| `Escape` | Close help or confirmation; from the list, return to the reader or quit |
| `Backspace` | Remove the last query character |
| `Ctrl+C` | Quit |

All printable keys, including `q`, `h`, `j`, and `k`, enter the query while the list is visible. Missing files are marked and remain in the list until removed. URLs are not fetched just to draw the list.

<details>
<summary>Secondary controls and history maintenance</summary>

Press `Tab` in history to reveal secondary controls. They also work directly from the list.

| Key | Action |
| --- | --- |
| `Ctrl+P` / `Ctrl+N` | Select the previous / next entry |
| `Ctrl+D` | Remove the selected history entry |
| `Ctrl+X`, then `y` | Clear all history and saved positions; another key cancels |

Removing an entry or clearing history does not delete your files. Opening a missing file reports the read error; press `h` to return to history.

</details>

<details>
<summary>Storage, privacy, and recovery</summary>

History retains up to 200 distinct file or URL entries. It uses `$XDG_STATE_HOME/mdview/history.sqlite3`, or `~/.local/state/mdview/history.sqlite3` when that variable is unset or not absolute. SQLite transactions handle concurrent sessions. The directory is private (0700), and the database uses mode 0600. It stores location, title, time, and reading position; it does not cache document bodies. This metadata is not encrypted.

Stdin and failed opens are excluded. URLs with credentials, any query, or a fragment are also excluded, with a notice. This conservative rule can omit harmless URLs. `--no-history` disables all history reads and writes for that invocation. `--history` cannot be combined with an input or `--no-history`, and requires terminal input and output.

Successful redirected file/URL output updates recency while keeping any saved reading position. Normal reader exit flushes position changes; abrupt termination can lose the latest change. Edited or identical repeated passages retain the matching limits described below.

History errors do not prevent reading. A busy database is retried briefly without blocking keyboard input. Corrupt or unsafe storage is left intact. To recover it, close all mdview sessions, move the mdview state directory aside, and restart. Do not replace a live database while another session is using it.

</details>

## Reloading and resizing

Local files reload on save. Use `--no-watch` to turn this off. `--refresh 150ms` sets the delay used to group file changes; it does not poll URLs. URLs and stdin are read once. Redirected output is also written once.

Resizing the terminal rewraps the text, code blocks, and table cells. If a table cannot fit, each row becomes a list of header/value pairs.

While you scroll, mdview remembers the passage at the top of the view. Resize and reload keep that passage visible when it survives the edit. History saves the position for eligible documents unless `--no-history` is set.

Long lines wrap by default. `--no-wrap` leaves prose unwrapped and clips it to the terminal width. Code blocks and tables still wrap.

<details>
<summary>How reading positions survive edits</summary>

Repeated resizes keep the same logical point. Scrolling during a pending render sets the new reading position.

If the passage is removed, mdview tries the following block, then the preceding block, then the nearest source position. Edited passages and identical repeated sections use best-effort matching. The view stays within the document bounds. This does not follow new content at the end.

</details>

## Limits and failure recovery

Rendering requires a sandbox on every platform. The current backend supports Linux
with Bubblewrap at `/usr/bin/bwrap`, `ldd` at `/usr/bin/ldd`, and permission to
create unprivileged user namespaces. Bubblewrap must support `--disable-userns`
and `--assert-userns-disabled`. The verified environment uses Bubblewrap 0.12.0
on Linux x64. Install these system dependencies before using a standalone binary.

On an unsupported platform, or when sandbox setup fails, mdview refuses to render.
To explicitly accept unrestricted rendering for one invocation, use
`mdview --no-sandbox README.md`. This override also applies to files opened from
history during that invocation. It is not a saved configuration option, and mdview
never retries without protection automatically. Help and version commands do not
need a sandbox.

<details>
<summary>What the parser sandbox protects</summary>

Local files, HTTP/HTTPS documents, and stdin use the same sandboxed worker. The
parent reads documents and fetches URLs, then sends text through pipes. Local
reload and remote reading therefore remain available without giving the parser
access to the source filesystem or host network.

The worker sees read-only runtime libraries and application assets, a private
temporary directory, and isolated process and network namespaces. It receives
three pipes and an explicit environment. User files, history, credentials, host
sockets, and the terminal are not mounted. Capabilities are removed, privilege
gains are blocked, and nested user namespaces are disabled. The launcher uses
`ldd` only on the trusted runtime executable to locate individual library files.
Source and Node builds also expose their application modules and dependencies
read-only; do not store secrets among those runtime assets.

These restrictions limit what code could access after a parser compromise. They
do not prove that the parser cannot execute code. The worker can still produce
incorrect output, and it shares the host kernel. There is no custom seccomp
syscall filter or protection against kernel exploits. Resource limits are a
separate requirement. Node, Bun source, and the standalone binary have been
checked on Linux x64; no macOS or Windows sandbox backend is implemented.

</details>

Input defaults to a 2 MiB limit and an 8-second URL timeout. Invalid or timed-out reloads keep the last valid document visible. Character widths can vary with your terminal and font.

Markdown rendering runs in a separate process with a deadline, but it has no hard OS memory limit. Large or complex input can exhaust available memory. Hard memory enforcement remains open in [issue #24](https://github.com/cbuchler/mdview/issues/24).

<details>
<summary>Render deadlines, input handling, and output limits</summary>

`mdview` removes terminal control sequences from input and skips embedded HTML. Markdown nesting is limited to 128 AST child levels, including structural and inline nodes (root = 0).

Markdown parsing and layout run in one child process in both interactive and plain output. Each render has a 5-second wall-clock deadline, including child startup and response transfer. This deadline is separate from the URL timeout. A resize reuses the child's latest parsed document. A new request cancels unfinished work. Quit and catchable termination signals stop the child; normal CLI shutdown waits for its exit. An invalid or timed-out reload keeps the last valid title and content. Resize can reflow that content while the error remains visible.

Each result is limited to 16 MiB of protocol data, 8 MiB of decoded text, 50,000 lines, 50,000 source blocks, and 100,000 styled segments. Titles and error messages are limited to 4 KiB; child diagnostics are limited to 8 KiB. These fixed output limits also apply when `maxInputBytes` is increased. Source text travels as bounded UTF-8 bytes, without a JSON copy. Protocol records are checked before display. These limits bound communication and retained output; they do not bound parser memory.

Bubblewrap is configured to terminate the worker when its parent dies. Without
sandboxing, a busy child can continue after an uncatchable parent `SIGKILL` until
it finishes or fails. Idle children exit when their input pipe closes. Hard
memory limits and complete abnormal-exit validation remain tracked in
[issue #24](https://github.com/cbuchler/mdview/issues/24).

</details>

## Options

Run `mdview --help` for help.

| Option | Purpose |
| --- | --- |
| `--theme <name>` | Set the text and status bar theme |
| `--syntax-theme <name>` | Set the code theme |
| `--refresh <duration>` | Set the file reload delay, such as `150ms` |
| `--timeout <duration>` | Set the URL timeout, such as `8s` |
| `--max-bytes <size>` | Limit input size, such as `1mb` |
| `--padding <number>` | Set left and right document padding |
| `--wrap[=<boolean>]` / `--no-wrap` | Turn prose wrapping on or off |
| `--watch` / `--no-watch` | Turn file reloads on or off |
| `--no-sandbox` | Explicitly permit unrestricted rendering for this invocation |
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

# Left and right document padding, in terminal columns.
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
npx tsc --noEmit
npm run build
```

See [TESTING.md](TESTING.md) for validation guidance and [AGENTS.md](AGENTS.md) for project conventions. Report bugs and feature requests in [GitHub Issues](https://github.com/cbuchler/mdview/issues). See the [changelog](CHANGELOG.md) for release history.

## License

[GNU GPLv3 or later](LICENSE).
