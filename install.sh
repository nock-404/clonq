#!/usr/bin/env sh
# clonq, installed or updated with one command.
#
#   curl -fsSL https://raw.githubusercontent.com/nock-404/clonq/main/install.sh | sh
#
# What it does: asks GitHub for the newest release, downloads the app for Apple
# silicon, and puts it into /Applications (~/Applications when that is not
# writable). A running clonq is quit first and started again afterwards.
# rsync and rclone ship inside the app. Nothing else is touched.
set -eu

REPO="nock-404/clonq"
say() { printf '  %s\n' "$*"; }
die() { printf '  %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "clonq runs on macOS only."
[ "$(uname -m)" = "arm64" ] || die "clonq needs a Mac with Apple silicon."
command -v curl >/dev/null 2>&1 || die "This needs curl."

# The download address of the app archive in the newest release. No token and
# no jq: the public API answers without one, and the address is one line of it.
api="https://api.github.com/repos/$REPO/releases/latest"
status=$(curl -sSL -o /dev/null -w '%{http_code}' "$api") || die "GitHub cannot be reached."
[ "$status" = "404" ] && die "There is no finished release yet. One is being built; please try again in a few minutes."
release=$(curl -fsSL "$api") || die "GitHub answered unexpectedly (HTTP $status)."
url=$(printf '%s\n' "$release" | grep -o '"browser_download_url": *"[^"]*\.app\.tar\.gz"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
tag=$(printf '%s\n' "$release" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
[ -n "$url" ] || die "The newest release has no app in it."
say "clonq $tag"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
curl -fSL --progress-bar -o "$tmp/clonq.app.tar.gz" "$url" || die "The download failed: $url"
tar -xzf "$tmp/clonq.app.tar.gz" -C "$tmp" || die "The archive could not be unpacked."
app=$(find "$tmp" -maxdepth 2 -name "*.app" -type d | head -1)
[ -n "$app" ] || die "There is no app in the archive."

dest="/Applications"
[ -w "$dest" ] || dest="$HOME/Applications"
mkdir -p "$dest"

running=0
if pgrep -xq clonq; then
	running=1
	say "quitting the running clonq …"
	osascript -e 'quit app "clonq"' >/dev/null 2>&1 || true
	# Give it a moment to finish; a run in progress stops cleanly on quit.
	for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -xq clonq || break; sleep 1; done
	pgrep -xq clonq && die "clonq is still running. Please quit it and run the command again."
fi

rm -rf "$dest/clonq.app"
cp -R "$app" "$dest/clonq.app"
# Downloaded by a script, not by the browser: without this the first start would
# ask about an unidentified developer.
xattr -dr com.apple.quarantine "$dest/clonq.app" 2>/dev/null || true
say "installed: $dest/clonq.app"

if [ "$running" -eq 1 ]; then
	open -a "$dest/clonq.app"
	say "clonq is running again."
else
	say "start it:  open -a clonq"
fi
