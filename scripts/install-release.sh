#!/bin/sh
set -eu

fail() { printf 'Install failed: %s\n' "$*" >&2; exit 1; }
version=latest
destination=${MDVIEW_INSTALL_DIR:-"$HOME/.local/bin"}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version|--install-dir)
      [ "$#" -ge 2 ] || fail "Missing value for $1"
      case "$1" in --version) version=$2 ;; --install-dir) destination=$2 ;; esac
      shift 2 ;;
    --help) printf '%s\n' 'Usage: sh install-release.sh [--version vX.Y.Z] [--install-dir DIRECTORY]'; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done
case "$(uname -s)" in Linux) platform=linux ;; Darwin) platform=darwin ;; *) fail 'Supported platforms: Linux and macOS' ;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) fail 'Supported architectures: x64 and arm64' ;; esac
for tool in curl tar mktemp; do command -v "$tool" >/dev/null 2>&1 || fail "Required command missing: $tool"; done
if command -v sha256sum >/dev/null 2>&1; then checksum=sha256sum
elif command -v shasum >/dev/null 2>&1; then checksum=shasum
else fail 'Install sha256sum or shasum first'; fi
base=https://github.com/cbuchler/mdview/releases
if [ "$version" = latest ]; then
  url=$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL -o /dev/null -w '%{url_effective}' "$base/latest") || fail 'Cannot resolve latest release'
  case "$url" in "$base/tag/"*) version=${url##*/} ;; *) fail 'Unexpected latest-release redirect' ;; esac
fi
version=v${version#v}
printf '%s\n' "$version" | LC_ALL=C grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail 'Use a stable version such as v0.3.0'
[ -n "$destination" ] || fail 'Install directory is empty'
case "$destination" in /*) ;; *) destination=$PWD/$destination ;; esac
mkdir -p "$destination"
destination=$(cd "$destination" && pwd -P)
target=$destination/mdview
[ ! -L "$target" ] || fail 'Refusing to replace a symlink; use its package manager'
case "$destination/" in */Cellar/*|*/Caskroom/*|*/Homebrew/*) fail 'Use Homebrew to update this installation' ;; esac
if command -v brew >/dev/null 2>&1; then
  prefix=$(brew --prefix 2>/dev/null) || fail 'Cannot determine the Homebrew prefix'
  case "$destination/" in "$prefix/"*) fail 'Use Homebrew to update this installation' ;; esac
fi
[ ! -e "$target" ] || [ -f "$target" ] || fail 'Install target is not a regular file'
workspace=$(mktemp -d)
staged=
cleanup() { rm -rf "$workspace"; if [ -n "$staged" ]; then rm -f "$staged"; fi; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
name=mdview-$version-$platform-$arch
archive=$name.tar.gz
for asset in "$archive" SHA256SUMS; do
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL "$base/download/$version/$asset" -o "$workspace/$asset" || fail "Cannot download $asset"
done
expected=$(awk -v file="$archive" '$2 == file { print $1 }' "$workspace/SHA256SUMS")
printf '%s\n' "$expected" | LC_ALL=C grep -Eq '^[0-9a-fA-F]{64}$' || fail 'Missing or ambiguous archive checksum'
if [ "$checksum" = sha256sum ]; then actual=$(sha256sum "$workspace/$archive")
else actual=$(shasum -a 256 "$workspace/$archive"); fi
[ "${actual%% *}" = "$expected" ] || fail 'Archive checksum mismatch'
tar -xzf "$workspace/$archive" -C "$workspace" "$name/mdview" || fail 'Cannot extract executable'
binary=$workspace/$name/mdview
[ -f "$binary" ] && [ ! -L "$binary" ] || fail 'Archive executable is not a regular file'
chmod 755 "$binary"
reported=$("$binary" --version) || fail 'Downloaded executable cannot run on this host'
[ "$reported" = "${version#v}" ] || [ "$reported" = "mdview ${version#v}" ] || fail 'Downloaded version does not match the requested release'
# Stage in the destination filesystem so replacement is atomic and running files stay intact.
staged=$(mktemp "$destination/.mdview.XXXXXX")
cp "$binary" "$staged"
chmod 755 "$staged"
[ ! -L "$target" ] || fail 'Install target changed to a symlink'
mv -f "$staged" "$target"
staged=
printf 'Installed mdview %s to %s\n' "${version#v}" "$target"
case ":$PATH:" in *":$destination:"*) ;; *) printf 'Add this directory to PATH: %s\n' "$destination" ;; esac
printf '%s\n' 'Rendering requires the sandbox dependencies documented in the README.'
