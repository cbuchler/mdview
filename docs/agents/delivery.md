# Issues and delivery

GitHub issues are the source of truth for project issues and their plans.
Keep issue status, decisions, and progress there; do not maintain a competing
local issue backlog.

When asked to file issues, include the problem, impact, implementation
direction, and observable acceptance criteria. Apply the appropriate existing
labels; feature requests should be identifiable as such.

Before implementing an issue, add a plan to each GitHub issue the work
originates from. A local plan or a plan in the conversation alone is not
sufficient. Scale the detail to the change, but cover:

- Implementation: scope, affected components, steps, and acceptance criteria.
- Testing: existing coverage to reuse, necessary new regression checks,
  runtime or manual validation, and any known validation limits.
- Technical choices: the proposed approach, relevant alternatives, and
  why the chosen approach fits the project.
- Trade-offs: advantages, disadvantages, risks, and compatibility or
  maintenance costs.

For work spanning several issues, record each issue's relevant plan and
cross-link shared details. Update the plans when scope or technical choices
change. Do not require a separate approval pause unless the user requests
one or the action otherwise requires approval.

When completing issue work, leave a resolution comment with the fix,
validation, relevant PR or commit, and remaining limitations. Verify merge
and issue state before reporting completion; automatic closure alone does
not provide a useful resolution record.

For an authorized release, synchronize `package.json`, lockfile version
metadata, and `src/version.ts`; update [CHANGELOG.md](../../CHANGELOG.md). Build fresh artifacts,
smoke-test the compiled binary, generate checksums, and verify that the tag
and uploaded assets match the intended reviewed source. Report whether the
release is draft, prerelease, or published stable.

## Commit messages

- Write descriptive commit messages in Conventional Commit format:
  `feat:`, `fix:`, `refactor:`, `chore:`, or another appropriate type.
  An optional scope can identify the affected component.
- Make the subject state the concrete change. Include a body that explains
  what changed and why; do not merely restate the file diff.
- Give enough context for a reader unfamiliar with the code to understand
  the problem and user-facing impact. If the change has no user-facing
  effect, explain its development or maintenance impact instead.
- Follow [Writing](writing.md). Be descriptive without padding the message.

## Delegation

When delegation is requested, honor the requested models and effort, assign
file and shared-test ownership, and review the resulting diff and behavior.
Passing checks alone do not establish that the task was fulfilled. Follow
[TESTING.md](../../TESTING.md) when reviewing delegated tests.
