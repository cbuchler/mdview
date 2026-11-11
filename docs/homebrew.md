# Homebrew delivery

The proposed tap is `cbuchler/homebrew-tap`. It is not yet published. Do not
advertise `brew install cbuchler/tap/mdview` until the source and bottles are
available and the public installation has passed.

The formula template is [mdview.rb.in](../packaging/homebrew/mdview.rb.in).
It builds from immutable source with locked npm dependencies and a checksummed
Bun resource. Node and Bun are build tools, not installed runtime dependencies.
Bottles contain the standalone executable, notices and shell completions.

Linux requires distro Bubblewrap at `/usr/bin/bwrap` and systemd user-session
support at `/usr/bin/systemd-run`. The formula checks those prerequisites;
mdview verifies the active memory controls before rendering. The tap does not
change AppArmor policy or install/start a privileged service. On macOS, source
builds need Apple command-line tools. The initial validation targets macOS 26.

Homebrew already sandboxes its formula tests and can block nested sandbox
setup. The formula therefore uses explicit `--no-sandbox` only for its fixed
test document. Separate native CI checks render through the installed source
build and poured bottle with default protection outside that test wrapper.
The formula test alone is not containment evidence.

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

Reinstalling one version does not prove an upgrade. The initial draft's CI
checks source builds and local bottle pours; public URLs, tap publication and
cross-version upgrades remain separate acceptance checks.
