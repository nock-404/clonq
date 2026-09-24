#!/usr/bin/env sh
# Puts rsync and rclone into src-tauri/binaries, where Tauri bundles them into
# clonq.app/Contents/MacOS. Run once before `pnpm tauri dev` or a build; the
# release workflow runs it too.
#
# rclone: the official build, checked against its published SHA-256.
# rsync:  built from the official source without openssl, xxhash, zstd, lz4 and idn,
#         so the program needs nothing but macOS itself. rsync is GPLv3; its
#         source is at the address below.
set -eu

RCLONE_VERSION="1.75.1"
RCLONE_SHA256="c61d7a371c62bcbbe882c3423aa4b8bf63485c248dd0f692997b8f0c3f6d0c6f"
RSYNC_VERSION="3.5.1"
RSYNC_SHA256="c55f9c9dc10fb8bec397b399a0fdded53cc9a2d8e30891bb0d63724d25c37bef"
TRIPLE="aarch64-apple-darwin"

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/src-tauri/binaries"
mkdir -p "$out"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

check() {
	actual=$(shasum -a 256 "$1" | cut -d' ' -f1)
	[ "$actual" = "$2" ] || { echo "checksum mismatch for $1: $actual" >&2; exit 1; }
}

if [ ! -x "$out/rclone-$TRIPLE" ] || ! "$out/rclone-$TRIPLE" version 2>/dev/null | grep -q "v$RCLONE_VERSION\$"; then
	zip="rclone-v$RCLONE_VERSION-osx-arm64.zip"
	curl -fsSL -o "$work/$zip" "https://downloads.rclone.org/v$RCLONE_VERSION/$zip"
	check "$work/$zip" "$RCLONE_SHA256"
	unzip -q "$work/$zip" -d "$work"
	install -m 0755 "$work/rclone-v$RCLONE_VERSION-osx-arm64/rclone" "$out/rclone-$TRIPLE"
fi
echo "rclone: $("$out/rclone-$TRIPLE" version | head -1)"

if [ ! -x "$out/rsync-$TRIPLE" ] || ! "$out/rsync-$TRIPLE" --version 2>/dev/null | grep -q "version $RSYNC_VERSION "; then
	tar="rsync-$RSYNC_VERSION.tar.gz"
	curl -fsSL -o "$work/$tar" "https://download.samba.org/pub/rsync/src/$tar"
	check "$work/$tar" "$RSYNC_SHA256"
	tar -xzf "$work/$tar" -C "$work"
	(
		cd "$work/rsync-$RSYNC_VERSION"
		./configure --quiet --disable-openssl --disable-xxhash --disable-zstd --disable-lz4 --disable-idn --disable-md2man --with-included-popt --with-included-zlib
		make -j"$(sysctl -n hw.ncpu)" rsync >/dev/null
		strip rsync
	)
	install -m 0755 "$work/rsync-$RSYNC_VERSION/rsync" "$out/rsync-$TRIPLE"
fi
echo "rsync:  $("$out/rsync-$TRIPLE" --version | head -1)"

# Nothing outside macOS may be linked in, or the app breaks on a Mac without Homebrew.
for tool in rsync rclone; do
	if otool -L "$out/$tool-$TRIPLE" | tail -n +2 | grep -v -E '^\s+/(usr/lib|System)/' | grep -q .; then
		echo "$tool links a library outside macOS:" >&2
		otool -L "$out/$tool-$TRIPLE" >&2
		exit 1
	fi
done
