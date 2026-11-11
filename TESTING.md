# Tests

- Add a test only for a specific regression, meaningful contract, or
  plausible failure. First check whether existing tests cover it.
  Prefer extending an existing test over adding another harness.

- Test shared logic thoroughly at its own boundary. Adapter and CLI
  tests should cover integration differences, not repeat the shared
  logic's entire matrix. Add permutations only when they exercise
  distinct behavior or boundaries.

- Assert observable outcomes and invariants. Avoid duplicating
  implementation constants, exact internal call sequences, incidental
  data structures, or prose unless these are explicit contracts.

- Ensure the assertion proves the named behavior. A visible footer
  does not prove scrolling works; a source-string check does not prove
  a completion script works.

- Mock external dependencies and exceptional conditions when useful.
  Do not treat mocked runtime behavior as proof of actual filesystem,
  network, terminal, or platform behavior. Use focused, bounded real
  checks when the defect depends on those boundaries.

- For bug fixes, verify that the regression test fails against the
  broken behavior where practical. Use a small deliberate fault when
  needed to check an uncertain assertion; do not introduce a mutation
  testing framework by default.

- When delegating, assign ownership of shared test coverage. The
  integrating agent must review tests for overlap, weak assertions,
  and implementation coupling—not merely accept passing results.

- Report what validation establishes and what remains unverified.
  Test counts and coverage percentages are supporting information,
  not evidence of quality by themselves. Never inflate or consolidate
  cases merely to improve a reported number.

- After appropriate checks pass, rerun or broaden testing only for
  changed code, failures, or a specific unresolved concern.

## Terminal and packaging checks

- For layout changes, select fixtures that exercise the affected width
  boundary. Include relevant CJK, combining-mark, emoji, or zero-width-joiner
  cases. Check alignment and content preservation, including table borders
  and padding, rather than only checking that text appears.

- For terminal integration changes, distinguish a standalone terminal from
  a multiplexer. Check tmux or Zellij when the changed behavior depends on
  that environment, and state which environments were actually tested.

- For packaging changes, smoke-test the produced executable on each platform
  being claimed as supported. Verify startup and a basic document render.
  If an artifact is claimed to be standalone, verify that it runs without
  the development runtime installed. Source execution alone does not prove
  that a packaged artifact works.

The Linux sandbox syscall probe requires a C compiler (`cc`) during testing.
Installed mdview binaries do not require a compiler.
