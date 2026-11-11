# Release artifacts

The distribution workflow builds on native Ubuntu 26.04 and macOS 26 hosts
for x64 and arm64. It pins Node 22.23.4 and Bun 1.4.4. Native macOS helpers
must be built on the matching architecture; cross-compilation alone is not
validation of sandbox or memory protection.

`npm run package:binaries` builds the executable for the current supported
host. `npm run package:release` checks package, lockfile and CLI versions,
then creates a versioned archive and its checksum in `release/`. Set
`MDVIEW_RELEASE_TAG` to the intended tag to check it against the source version.
Do not publish a source build under an older existing tag.

The `mdview-release-inputs` CI artifact contains four archives, SHA256SUMS,
and the inspectable shell installer. CI checks file and stdin rendering
without Node or Bun on PATH. Linux also runs the existing terminal lifecycle
checks. macOS terminal interaction is not established by these plain-output
checks.

## Verify and install an archive

Download the archive and SHA256SUMS from the same release. Select the checksum
line for your archive so other platform downloads are not required:

```sh
archive=mdview-v0.3.0-linux-x64.tar.gz
awk -v file="$archive" '$2 == file' SHA256SUMS > selected.sha256
test -s selected.sha256
sha256sum -c selected.sha256
# On macOS, use: shasum -a 256 -c selected.sha256
tar -xzf "$archive"
```

An empty checksum selection is not verification. The installer rejects a
missing or ambiguous entry. Checksums detect a changed download; they are
not an independent signature if the release account is compromised.

## Publication checks

1. Merge the reviewed source and synchronize package, lockfile and CLI versions.
2. Run the distribution workflow on the intended immutable release commit.
3. Download its complete artifact bundle and verify all four checksums. Confirm
   the workflow source SHA matches the intended tag, and the native jobs passed.
4. Prepare release notes from the changelog and the verified support matrix.
   Keep sandbox dependencies and the explicit override visible.
5. After publication approval, upload all archives, SHA256SUMS and the installer
   to the matching release. Do not overwrite assets under an existing stable tag.
6. Verify the real published downloads and install commands. Then replace the
   README's pending-release wording with links to those exact assets.
7. Prepare the Homebrew update only from that verified release.

The workflow prepares artifacts but does not publish a release automatically.
A published installer must be served over HTTPS. It refuses redirects to HTTP,
verifies the archive and executable version before replacement, and stages the
new executable in the destination filesystem for atomic rename. A failed
validation preserves the installed executable.

The initial macOS artifacts are not notarized. Do not weaken host security
policy as part of installation. A future signing configuration must also verify
that the native memory guard still loads; hardened-runtime options can affect
library injection.
