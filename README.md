# mdview

`mdview` is a terminal markdown viewer with live reload, YAML config support, theme presets, and a plain-text fallback for non-TTY output.

## What It Does

- Renders GitHub-Flavored Markdown in an Ink-based TUI
- Auto-detects input from:
  - a local file path
  - piped stdin
  - a URL beginning with `http://` or `https://`
  - `-` as stdin shorthand
- Reloads local files automatically
- Supports YAML config files at `~/.config/mdview/config.yml` or `~/.config/mdview/config.yaml`
- Prints a readable plain-text view when stdout is not a TTY
- Sanitizes untrusted content before rendering so terminal control sequences do not leak through

## Quick Start

```bash
mdview README.md
mdview README.md --theme dracula --refresh 150ms
mdview https://example.com/readme.md
cat README.md | mdview
printf '# Hello from stdin\n' | mdview
mdview -
```

## CLI Reference

Use `mdview --help` for a compact summary. The current flags are:

- `--theme <name>`
- `--syntax-theme <name>`
- `--refresh <ms|1s|1m>`
- `--timeout <ms|1s|1m>`
- `--max-bytes <bytes|1mb|2mb>`
- `--padding <number>`
- `--wrap` / `--no-wrap`
- `--watch` / `--no-watch`
- `--config <path>`
- `--print-config`
- `--init-config`
- `-h`, `--help`
- `--version`

Examples:

```bash
mdview README.md --theme tempus-rift
mdview README.md --syntax-theme dracula
mdview README.md --no-wrap
mdview README.md --watch
mdview README.md --no-watch
mdview README.md --max-bytes 1mb
```

## Input Detection

`mdview` chooses the source automatically:

- If stdin is piped, it reads stdin.
- If the argument starts with `http://` or `https://`, it fetches that URL.
- Otherwise, it treats the argument as a file path.
- If you pass `-`, it is treated as stdin.

If you launch `mdview` with no input and no piped data, it prints help and exits.

## Themes

Built-in themes:

- `github`
- `dracula`
- `solarized`
- `tempus-rift`
- `midnight`
- `paper`

`tempus rift` and `tempusrift` are accepted as aliases for `tempus-rift`.

## Configuration

### Default Location

The default config file is:

```text
~/.config/mdview/config.yml
```

`mdview` also accepts `~/.config/mdview/config.yaml`.

### Precedence

Configuration is applied in this order:

1. CLI flags
2. YAML config file
3. built-in defaults

The built-in defaults are tuned for terminal use: `theme: tempus-rift` and `syntaxTheme: dracula`.

### Supported Keys

The config file supports these keys:

- `theme`
- `syntaxTheme`
- `wrap`
- `padding`
- `refreshIntervalMs`
- `timeoutMs`
- `maxInputBytes`
- `watch`

### Example Config

```yaml
# mdview configuration
# Default config path: ~/.config/mdview/config.yml

# Visual theme for the viewer and status bars.
theme: tempus-rift

# Theme used for code blocks and other syntax-adjacent surfaces.
syntaxTheme: dracula

# Whether lines wrap in the viewport.
wrap: true

# Horizontal padding around rendered content.
padding: 1

# File watch debounce in milliseconds.
refreshIntervalMs: 150

# Network timeout in milliseconds for URL input.
timeoutMs: 8000

# Maximum bytes to load before truncating.
maxInputBytes: 2097152

# Enable live reload for local files.
watch: true

# Supported themes: github, dracula, solarized, tempus-rift, midnight, paper
```

### Generate Config From the Binary

Print a commented template:

```bash
mdview --print-config
```

Write the template to the default config path only if it does not already exist:

```bash
mdview --init-config
```

Write a config template to a specific path:

```bash
mdview --print-config > /tmp/mdview.yml
```

Initialize a specific path only if it does not already exist:

```bash
mdview --init-config --config /tmp/mdview.yml
```

## Runtime Behavior

- Local files reload automatically with debounce.
- URLs are fetched with a timeout and a size guardrail.
- Long lines wrap by default.
- `--no-wrap` keeps lines unwrapped.
- Non-TTY output uses the same renderer but prints plain text instead of opening the TUI.
- Invalid flags, invalid values, unknown themes, malformed YAML, and unknown YAML keys are reported as concise CLI errors.

## Release Binaries

The repository includes a packaging script that uses Bun to produce a standalone binary:

```bash
npm run package:binaries
```

## Development

```bash
npm install
npm run dev -- README.md
npm test
npm run build
```

## Notes

- Markdown rendering is tuned for terminal display, so some complex browser-only Markdown features are intentionally out of scope.
- Terminal width, Unicode width, and emoji handling can still vary a bit by terminal emulator and font.
- If you see odd wrapping in a specific terminal, try `--no-wrap` to narrow down whether it is a width-calculation issue.
- License: GNU GPLv3 or later. See [`LICENSE`](/var/home/charles/Code/mdview/LICENSE).
