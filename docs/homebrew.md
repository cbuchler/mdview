# Homebrew delivery

The [cbuchler/homebrew-tap](https://github.com/cbuchler/homebrew-tap) tap publishes
mdview bottles for Linux and macOS, on x64 and ARM64:

```sh
brew install cbuchler/tap/mdview
brew upgrade cbuchler/tap/mdview
```

The v0.3.0 source builds and local bottle checks passed on all four native hosts.
[Public installation checks](https://github.com/cbuchler/homebrew-tap/actions/runs/43123350705)
also passed: bottle installation, protected rendering without Node or Bun on
PATH, shell completion files, and uninstall. Validation hosts were Ubuntu 26.04
and macOS 26. Other OS versions are not validated.

The formula template is [mdview.rb.in](../packaging/homebrew/mdview.rb.in).
It builds from immutable source with locked npm dependencies and checksummed
Node and Bun resources. These build tools are not installed runtime dependencies.
The Node resource avoids relying on Homebrew's macOS Intel dependency bottles.
Bottles contain the standalone executable, notices and shell completions.

Linux requires `bwrap` and `systemd-run` on absolute `PATH` entries, plus
`/usr/bin/ldd`. The formula follows mdview's executable lookup but checks
availability only. A successful installation does not prove that namespaces,
the systemd user session, or cgroup v2 memory/task controls work on that host.
mdview verifies the active controls before rendering. The tap does not
change AppArmor policy or install/start a privileged service. On macOS, source
builds need Apple command-line tools. The initial validation targets macOS 26.

Homebrew already sandboxes its formula tests and can block nested sandbox
setup. The formula therefore uses explicit `--no-sandbox` only for its fixed
test document. Separate native CI checks render through the installed source
build and poured bottle with default protection outside that test wrapper.
The formula test alone is not containment evidence.

After installation, check protected rendering in your normal login session:

```sh
mdview --no-history /path/to/document.md > /dev/null
```

Use an existing Markdown file. A failed check requires fixing the reported host
prerequisite; do not add `--no-sandbox` to treat it as a successful protection check.

## Prepare a formula update

Use the reviewed release tag and the checksum of its source archive:

```sh
version=v0.3.0
curl --proto '=https' --proto-redir '=https' -fsSL \
  "https://github.com/cbuchler/mdview/archive/$version.tar.gz" -o source.tar.gz
checksum=$(shasum -a 256 source.tar.gz | cut -d ' ' -f 1)
node scripts/prepare-homebrew.mjs "$version" "$checksum"
```

The generator writes `release/homebrew-tap/Formula/mdview.rb`. It rejects a
release version that differs from package.json. For pre-release CI only, it
also accepts a full immutable commit ID. Do not publish a CI formula under
an existing stable release number.

After the stable release is published and the tap exists, the preparation
script can open a draft update PR from a clean checkout of that release tag:

```sh
sh scripts/prepare-homebrew-update.sh v0.3.0
```

It verifies the checkout/tag and published release state, downloads and hashes
the immutable source archive, generates the formula, then pushes a new tap
branch and opens a draft PR. It does not merge or publish bottles. The script
requires GitHub authentication with write access to the maintained tap.

Alternatively, copy the generated formula into a tap branch and open a PR.
Build native bottles from that exact formula and source revision. The mdview
Homebrew workflow demonstrates the source-build, bottle-pour, completion and
uninstall checks. A formula syntax check is not installation proof.

## Publish after review

1. Verify the source tag belongs to the approved mdview release and its direct
   archives passed native validation.
2. Create the public tap from the reviewed files if it does not exist.
3. Submit the formula update as a tap PR and build bottles for each supported
   native platform. Retain their JSON metadata and exact checksums.
4. Use Homebrew's bottle metadata merge and reviewed `brew pr-pull` flow to
   publish the exact approved tap commit. Supply `--head-sha` so a later PR
   update cannot change which commit is published. See the
   [Homebrew tap guide](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap).
5. Test public bottle installation, protected document rendering, completions,
   upgrade from the prior published formula when one exists, and uninstall.
6. Add the verified install command and tap link to README and release notes.

Reinstalling one version does not prove an upgrade. v0.3.0 is the first published
formula, so cross-version upgrade validation must accompany the next release.
