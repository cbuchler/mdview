# Development

## Look before you write

Before adding a helper, search existing code with `rg` and locate relevant
files with `fd` or `rg --files`. Read the matching implementations and their
call sites. Reuse or extend existing logic when it fits the requirement.
Do not add a parallel helper without explaining why the existing one cannot
serve the task.

## Code style

- Keep TypeScript strict mode enabled.
- Use 2-space indentation and Standard JS style without semicolons.
- Use single quotes, except when another quote style avoids escaping.
- Use PascalCase for components and classes; camelCase for functions and
  variables.
- Use kebab-case for directories and files. Preserve filenames required by
  tooling or established document conventions, such as `AGENTS.md`.
- Prefer named exports.

Apply these rules to new and changed code. Existing code uses semicolons;
this guidance does not authorize unrelated reformatting, renaming, or a
repository-wide style migration.

## Code comments

- Explain why, never what. The code states what it does.
- Never prefix a comment with a ticket or issue key.
- Never narrate the change being made or restate a property name in prose.
- Explain non-obvious business logic once, where the rule is defined, not
  at every call site.
- If the same WHAT comment appears in more than two places, look for a
  shared helper or named constant that expresses the concept. Do not add
  another copy of the comment or an abstraction that serves no requirement.
- Add a WHY comment when someone who did not write the PR needs it to
  understand a hidden constraint, subtle invariant, specific bug workaround,
  or surprising behavior. If removing the comment would not confuse that
  reader, omit it.

Follow the prose guidance in [Writing](writing.md).

## Project and code map

mdview is a terminal Markdown viewer with live reload. It uses TypeScript
ES modules, React/Ink, unified/remark, and chokidar. Node runs the CLI;
Bun builds standalone binaries. Read the relevant source and
[README](../../README.md) before changing behavior.

- `src/main.ts`, `src/config.ts`: startup, source selection, CLI options,
  YAML configuration, and help.
- `src/source.ts`, `src/bounded-reader.ts`: file, stdin, and HTTP input;
  byte limits, decoding, cancellation, and cleanup.
- `src/markdown.ts`, `src/markdown-depth.ts`: rendering, wrapping, and
  Markdown depth validation inside the render child.
- `src/render-supervisor.ts`, `src/render-worker.ts`, `src/render-protocol.ts`:
  child ownership, render deadlines, bounded protocol records, and validation.
  `src/render-text.ts` converts validated output to plain text.
- `src/app.tsx`, `src/terminal.ts`, `src/watcher.ts`: interactive display,
  keyboard input, terminal lifecycle, resize, and reload.
- `src/plain.ts`: noninteractive output. `src/version.ts`: CLI version.
- `test/fixtures/terminal-pty.py`: real terminal checks.
  `completions/`: Bash, Zsh, and Fish completions.

## Development and validation

Use Node.js 22.12 or newer and npm. Linux terminal tests require Python 3;
some runtime checks also need Bun.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install dependencies from the lockfile |
| `npm run dev -- README.md` | Run the viewer from source |
| `npm test` | Run the Vitest suite |
| `npx tsc --noEmit` | Type-check source and tests |
| `npm run build` | Build the Node CLI |
| `npm run package:binaries` | Build `release/mdview` using Bun |

Choose checks for the changed behavior; follow [TESTING.md](../../TESTING.md). Documentation
edits normally need reference and diff checks, not the application suite.
For terminal defects, use a real controlling PTY and inspect the latest
rendered frame. Accumulated output can contain stale frames. Check both
Node and Bun when changing behavior that differs between them, and report
skipped runtime checks explicitly.

`npm run install:binary` changes the installed executable. Run it only when
installation is part of the requested work.

## Related changes

- When CLI options change, update help, configuration documentation, and
  relevant completions together.
- Keep dependency changes targeted and update `package-lock.json` with npm.
  An npm audit result does not cover Bun's bundled runtime.
- Keep generated `dist/`, `release/`, `coverage/`, and `graphify-out/`
  artifacts out of source commits.
