#!/bin/sh
set -eu

fail() { printf 'Tap update failed: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 1 ] || fail 'Usage: sh scripts/prepare-homebrew-update.sh vX.Y.Z'
tag=$1
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
version=$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')
[ "$tag" = "v$version" ] || fail 'Tag does not match this checkout version'
[ -z "$(git status --porcelain)" ] || fail 'Use a clean release checkout'
[ "$(git rev-parse HEAD)" = "$(git rev-parse "$tag^{commit}")" ] || fail 'Check out the reviewed release tag first'
state=$(gh release view "$tag" --repo cbuchler/mdview --json isDraft,isPrerelease --jq '[.isDraft,.isPrerelease]|join(",")')
[ "$state" = false,false ] || fail 'The mdview release must be published stable first'
workspace=$(mktemp -d)
trap 'rm -rf "$workspace"' EXIT
trap 'exit 1' HUP INT TERM
curl --proto '=https' --proto-redir '=https' -fsSL "https://github.com/cbuchler/mdview/archive/$tag.tar.gz" -o "$workspace/source.tar.gz"
checksum=$(shasum -a 256 "$workspace/source.tar.gz" | cut -d ' ' -f 1)
gh repo clone cbuchler/homebrew-tap "$workspace/tap"
node scripts/prepare-homebrew.mjs "$tag" "$checksum" "$workspace/tap"
cd "$workspace/tap"
git switch -c "update/mdview-$version"
git add Formula/mdview.rb
git commit -m "feat(mdview): update to $version" -m "Build the reviewed mdview release from its immutable source archive. Native bottle CI must pass before publishing the tap update."
git push -u origin "update/mdview-$version"
printf 'Update mdview to %s from the published stable release.\n\nSource SHA-256: `%s`.\n\nRun native source-build, bottle-pour and lifecycle checks before publication. Publish only the reviewed PR head and its matching bottles.\n' "$version" "$checksum" > "$workspace/body.md"
gh pr create --draft --repo cbuchler/homebrew-tap --title "feat: update mdview to $version" --body-file "$workspace/body.md"
