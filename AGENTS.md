# mdview — agent guidance

mdview is a TypeScript terminal Markdown viewer with live reload. Node runs
its CLI; Bun builds standalone binaries.

## Always apply

- Inspect Git status first and preserve unrelated local edits.
- Keep project guidance in this repository, using relative links.
- Start responses with the answer or action. Omit filler, acknowledgements,
  restatements of the question, and closing summaries that repeat the answer.
  Match detail to complexity: short answers for simple questions and full
  explanations for complex tasks.
- Use ASD-STE100 for technical writing and Orwell's rules for prose. Apply
  them to responses, documentation, code comments, and commit messages.
- If intent, architecture, or requirements are unclear, ask before writing
  code. Never make silent assumptions. State uncertainty about an approach
  or technical detail before proceeding; do not present guesses as facts.
- Implement the simplest solution that meets the request. Do not add
  unrequested abstractions or flexibility. Do not modify files or functions
  unrelated to the task, even if they could be improved.
- Give candid status. Distinguish local, committed, pushed, merged, and
  published work. State what was verified and what remains uncertain.
- [GitHub issues](https://github.com/cbuchler/mdview/issues) are the source of
  truth for issues, plans, decisions, and progress.
- Before implementation, add a plan to every originating GitHub issue. Cover
  implementation, testing, technical choices, and pros, cons, and trade-offs.
  Keep the plan current and leave a resolution comment when work is complete.

## Progressive disclosure

Keep this file limited to universal rules and reading triggers. Read the
linked guidance when its trigger applies, before doing that work. Read only
relevant sections; do not load every reference by default. Follow additional
links only when needed. These are required instructions when applicable,
not optional background. Recheck the reading triggers if the task expands.

| When working on… | Read |
| --- | --- |
| Code, helpers, comments, dependencies, builds, or validation commands | [Development](docs/agents/development.md) |
| Input, rendering, terminal lifecycle, asynchronous work, performance, or security | [Runtime guidance](docs/agents/runtime.md) |
| Test design, changes, execution, or review | [Testing](TESTING.md) |
| Issues, implementation plans, delegation, commits, PR completion, or releases | [Delivery](docs/agents/delivery.md) |
| Documentation, code comments, commit messages, issue/PR text, or release notes | [Writing](docs/agents/writing.md) |
| User-facing behavior or configuration | Relevant sections of [README](README.md) |
| Release preparation | [Changelog](CHANGELOG.md) |

Put new task-specific guidance in the appropriate linked document and add a
clear reading trigger here when needed. Keep each rule in one place. Use
links rather than unconditional imports for supporting documents.
