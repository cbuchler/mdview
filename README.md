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

With Node.js and npm installed:

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

Pass a file path or an HTTP(S) URL. Use `-`, or omit the argument, to read stdin. An explicit file or URL takes precedence over piped input. With no argument or piped input, `mdview` prints help.

### Keys

| Key | Action |
| --- | --- |
| `q` or `Ctrl+C` | Quit |
| `j` / `k` or down / up arrow | Scroll one line |
| `Space` or `Page Down` | Scroll down one page |
| `b` or `Page Up` | Scroll up one page |
| `g` / `G` | Go to the top / bottom |

### Reloading and resizing

Local files reload on save. Use `--no-watch` to turn this off. `--refresh 150ms` sets the delay used to group file changes; it does not poll URLs. URLs and stdin are read once. Redirected output is also written once.

Resizing the terminal rewraps the text, code blocks, and table cells. If a table cannot fit, each row becomes a list of header/value pairs.

Long lines wrap by default. `--no-wrap` leaves prose unwrapped and clips it to the terminal width. Code blocks and tables still wrap.

URLs have a timeout and an input size limit. `mdview` removes terminal control sequences from input and skips embedded HTML. Character widths can vary with your terminal and font.

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
| `--wrap` / `--no-wrap` | Turn prose wrapping on or off |
| `--watch` / `--no-watch` | Turn file reloads on or off |
| `--config <path>` | Use a config file |
| `--print-config` | Print the config template |
| `--init-config` | Create a config file without overwriting one |
| `-h`, `--help` | Show help |
| `--version` | Show the version |

Durations accept milliseconds, seconds, or minutes: `150`, `150ms`, `8s`, `1m`. Sizes accept bytes, KB, MB, or GB: `1024`, `1kb`, `2mb`, `1gb`.

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

```bash
npm ci
npm run dev -- README.md
npm test
npm run build
```

## License

[GNU GPLv3 or later](LICENSE).
