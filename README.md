# mdview

Read Markdown in your terminal and return to where you left off.

- Open files, HTTP(S) URLs, or piped text.
- Search recent documents and resume reading.
- Reload files on save and reflow text when the terminal resizes.
- Read tables, task lists, and code blocks, or export plain text.

[Install](#install) · [Quick start](#quick-start) · [Reading](#reading) · [Configure](#configure) · [Options](#options)

## Install

The latest stable release is [v0.3.0](https://github.com/cbuchler/mdview/releases/tag/v0.3.0).
Check the [runtime requirements](#limits-and-failure-recovery) before installation.

### Published binary

Download and inspect [install-release.sh](https://github.com/cbuchler/mdview/releases/download/v0.3.0/install-release.sh), then run:

```sh
sh install-release.sh --version v0.3.0
```

The installer selects the Linux or macOS archive for x64 or ARM64, verifies its
checksum and version, and installs it in `~/.local/bin`. Add that directory to
your `PATH`. Use `--install-dir` to choose another directory. Run the installer
again to upgrade; use Homebrew for Homebrew-managed installations.

For manual installation, download the matching archive and `SHA256SUMS` from
the [release](https://github.com/cbuchler/mdview/releases/tag/v0.3.0),
[verify the checksum](docs/distribution.md#verify-and-install-an-archive), and extract it.
Archives include the executable, license, third-party notices, and shell
completions. Node, npm, Bun, and a compiler are not needed to run them.

Homebrew delivery is being prepared in
[cbuchler/homebrew-tap](https://github.com/cbuchler/homebrew-tap).
See [Homebrew delivery](docs/homebrew.md) for its publication status.

### From source

Use Node.js 22.13 or newer and npm. macOS builds also need Apple command-line tools.
Check the [runtime requirements](#limits-and-failure-recovery) before running mdview.

```sh
git clone https://github.com/cbuchler/mdview.git
cd mdview
npm ci
npm run build
node dist/main.js README.md
```

With Bun installed, build and try a standalone executable:

```sh
npm run package:binaries
./release/mdview README.md
```

Run `npm run install:binary` to install it in `~/.local/bin`.
Set `MDVIEW_INSTALL_DIR` to use another directory.
To uninstall a direct installation, remove its executable; history and configuration remain.

## Quick start

```sh
mdview README.md
mdview                              # Open recent documents
mdview README.md --theme dracula
mdview https://example.com/readme.md
cat README.md | mdview
mdview README.md > README.txt
mdview --no-history private-notes.md
```

Use `-` to read stdin explicitly. A file or URL argument takes precedence over
piped input. Redirected output is always plain text.

The standalone binary and Bun print plain text when stdin is redirected.
The Node CLI can open piped input interactively if a controlling terminal is
available. With terminal input, `mdview -` reads until `Ctrl+D`, then prints plain text.

## Reading

| Key | Action |
| --- | --- |
| `q` or `Ctrl+C` | Quit |
| `j` / `k` or down / up arrow | Scroll one line |
| `Space` / `Page Down` | Scroll down one page |
| `b` / `Page Up` | Scroll up one page |
| `g` / `G` | Go to the top / bottom |
| `h` | Open recent documents |

Local files reload on save. Use `--no-watch` to disable reloads, or
`--refresh 150ms` to set the delay used to group file changes.
URLs and stdin are read once; URLs are not polled.

Resize and reload keep the current passage visible when it can still be matched.
If it was removed, mdview uses a nearby passage. Repeated or edited passages use
best-effort matching.

Long lines wrap by default. `--no-wrap` clips prose to the terminal width in the
reader and preserves full prose in plain output. Code blocks and tables still
wrap. Tables that cannot fit become lists of header/value pairs.

## Recent documents

Run `mdview` or `mdview --history` in a terminal, or press `h` in the reader.
Type to search titles and locations. Results stay in most-recent-first order.

| Key | Action |
| --- | --- |
| Up / down arrow | Select an entry |
| `Page Up` / `Page Down` | Move one page |
| `Enter` | Open the document at its saved position |
| `Tab` | Show or hide help |
| `Escape` | Close help or confirmation; from the list, return to the reader or quit |
| `Ctrl+D` | Remove the selected entry |
| `Ctrl+X`, then `y` | Clear history and saved positions |
| `Ctrl+C` | Quit |

Printable keys, including `q`, enter the search query. Removing entries does not
delete files. Missing files stay listed until removed.

### History and privacy

History stores up to 200 file or URL locations, titles, timestamps, and reading
positions. It does not store document bodies. The metadata is not encrypted.

The database is `$XDG_STATE_HOME/mdview/history.sqlite3`, or
`~/.local/state/mdview/history.sqlite3` when that variable is unset or not absolute.

Stdin, failed opens, and URLs with credentials, queries, or fragments are excluded.
Use `--no-history` to disable all history reads and writes for an invocation.
`--history` requires terminal input and output and cannot be combined with an input
or `--no-history`.

History errors do not prevent reading. To recover corrupt storage, close all
mdview sessions, move the state directory aside, and restart.

## Configure

Create a config file with `mdview --init-config`, or print a commented template
with `mdview --print-config`.

mdview reads `~/.config/mdview/config.yml`, falling back to `config.yaml`.
Use `--config <path>` to select another file. Command-line options override the
file; the file overrides these defaults:

```yaml
theme: tempus-rift
syntaxTheme: dracula
wrap: true
padding: 1
refreshIntervalMs: 150
timeoutMs: 8000
maxInputBytes: 2097152
watch: true
```

Themes: `github`, `dracula`, `solarized`, `tempus-rift`, `midnight`, and `paper`.
Invalid values and unknown config keys produce an error.

## Options

Run `mdview --help` for usage and examples.

| Option | Purpose |
| --- | --- |
| `--theme <name>` | Set the text and status bar theme |
| `--syntax-theme <name>` | Set the code theme |
| `--refresh <duration>` | Set the file reload delay, such as `150ms` |
| `--timeout <duration>` | Set the URL timeout, such as `8s` |
| `--max-bytes <size>` | Limit input size, such as `1mb` |
| `--padding <number>` | Set horizontal padding in terminal columns |
| `--wrap[=<boolean>]` / `--no-wrap` | Enable or disable prose wrapping |
| `--watch` / `--no-watch` | Enable or disable file reloads |
| `--history` | Open recent documents |
| `--no-history` | Disable history reads and writes |
| `--no-sandbox` | Disable sandbox and OS memory protection for this invocation |
| `--config <path>` | Select a config file |
| `--print-config` | Print the config template |
| `--init-config` | Create a config file without overwriting one |
| `-h`, `--help` | Show help |
| `--version` | Show the version |

Durations accept milliseconds, seconds, or minutes: `150`, `150ms`, `8s`, `1m`.
Sizes accept bytes, KB, MB, or GB: `1024`, `1kb`, `2mb`, `1gb`.
Bare `--wrap` enables wrapping; `--wrap=false` disables it.

## Limits and failure recovery

Since v0.3.0, mdview requires sandbox and OS memory protection before rendering.

| Platform | Runtime requirements |
| --- | --- |
| Linux | Bubblewrap with permitted user/network namespaces, `/usr/bin/ldd`, and `systemd-run` connected to a systemd user manager with cgroup v2 memory/task controls |
| macOS | System `/usr/bin/sandbox-exec` and `/bin/bash`; native helpers are included in standalone builds |
| Windows | Not supported |

Native CI targets Ubuntu 26.04 and macOS 26, on x64 and ARM64. Other OS versions
are not validated. Host security policy can still prevent sandbox setup.
Initial macOS archives are not notarized. The macOS sandbox and memory controls
use private or deprecated Apple interfaces; OS changes can make setup fail.

The parser runs in a separate process with restricted filesystem and network
access. The parent reads files and fetches URLs. Protection differs between
Linux and macOS and is not a guarantee against all parser or kernel exploits.

Default limits are:

- 2 MiB of input and an 8-second URL timeout, adjustable through options.
- A 5-second deadline per render.
- A 256 MiB parser memory budget, using different OS accounting rules on Linux
  and macOS. This is not a limit on the whole viewer.

Complex documents can exceed render limits even below the input size limit.
Failed reloads keep the last valid document visible. Terminal control sequences
are removed from input, and embedded HTML is skipped.

If protection cannot start, mdview refuses to render. To explicitly allow
unrestricted rendering for one invocation, use:

```sh
mdview --no-sandbox README.md
```

This disables sandbox and OS memory protection, including for documents opened
from history during that invocation. It is not a saved setting, and mdview never
falls back to it automatically. Help and version commands do not need a sandbox.

## Shell completion

Completion scripts are in `completions/`. Replace `/path/to/mdview` with your
clone or extracted archive directory.

- **Bash:** add `source /path/to/mdview/completions/bash/mdview` to your shell profile.
- **Zsh:** add `fpath+=(/path/to/mdview/completions/zsh)` before your `compinit` call.
  If needed, initialize completion with `autoload -Uz compinit && compinit`.
- **Fish:** copy `completions/fish/mdview.fish` to `~/.config/fish/completions/`.

## Develop

```sh
npm ci
npm run dev -- README.md
npm test
npx tsc --noEmit
npm run build
```

See [development guidance](docs/agents/development.md), [TESTING.md](TESTING.md),
and [project conventions](AGENTS.md). Report bugs and feature requests in
[GitHub Issues](https://github.com/cbuchler/mdview/issues).
See the [changelog](CHANGELOG.md) for release history.

## License

[GNU GPLv3 or later](LICENSE).
