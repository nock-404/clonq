#!/usr/bin/env sh
# clonq, installed or updated with one command.
#
#   curl -fsSL https://raw.githubusercontent.com/nock-404/clonq/main/install.sh | sh
#
# What it does: asks GitHub for the newest release, downloads the app for Apple
# silicon, and puts it into /Applications (~/Applications when that is not
# writable). A running clonq is quit first and started again afterwards.
# clonq copies with rsync 3 and rclone from Homebrew; when one is missing, the
# script asks before installing it. Nothing else is touched.
set -eu

REPO="nock-404/clonq"
say() { printf '  %s\n' "$*"; }
die() { printf '  %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "clonq gibt es nur für macOS."
[ "$(uname -m)" = "arm64" ] || die "clonq gibt es nur für Macs mit Apple-Chip."
command -v curl >/dev/null 2>&1 || die "Dafür wird curl gebraucht."

# The download address of the app archive in the newest release. No token and
# no jq: the public API answers without one, and the address is one line of it.
api="https://api.github.com/repos/$REPO/releases/latest"
release=$(curl -fsSL "$api") || die "GitHub antwortet nicht: $api"
url=$(printf '%s\n' "$release" | grep -o '"browser_download_url": *"[^"]*\.app\.tar\.gz"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
tag=$(printf '%s\n' "$release" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
[ -n "$url" ] || die "Im neuesten Release liegt keine App."
say "clonq $tag"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
curl -fSL --progress-bar -o "$tmp/clonq.app.tar.gz" "$url" || die "Der Download ist fehlgeschlagen: $url"
tar -xzf "$tmp/clonq.app.tar.gz" -C "$tmp" || die "Das Archiv ließ sich nicht entpacken."
app=$(find "$tmp" -maxdepth 2 -name "*.app" -type d | head -1)
[ -n "$app" ] || die "Im Archiv liegt keine App."

dest="/Applications"
[ -w "$dest" ] || dest="$HOME/Applications"
mkdir -p "$dest"

running=0
if pgrep -xq clonq; then
	running=1
	say "beendet die laufende clonq …"
	osascript -e 'quit app "clonq"' >/dev/null 2>&1 || true
	# Give it a moment to finish; a run in progress stops cleanly on quit.
	for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -xq clonq || break; sleep 1; done
	pgrep -xq clonq && die "clonq läuft noch. Bitte beenden und den Befehl erneut ausführen."
fi

rm -rf "$dest/clonq.app"
cp -R "$app" "$dest/clonq.app"
# Downloaded by a script, not by the browser: without this the first start would
# ask about an unidentified developer.
xattr -dr com.apple.quarantine "$dest/clonq.app" 2>/dev/null || true
say "installiert: $dest/clonq.app"

# rsync 3 and rclone come from Homebrew; macOS ships only an old rsync.
missing=""
[ -x /opt/homebrew/bin/rsync ] || missing="$missing rsync"
[ -x /opt/homebrew/bin/rclone ] || missing="$missing rclone"
if [ -n "$missing" ]; then
	say "clonq braucht noch:$missing"
	if command -v brew >/dev/null 2>&1 && [ -r /dev/tty ]; then
		printf '  Mit Homebrew installieren? [j/N] '
		read -r answer </dev/tty || answer=""
		case "$answer" in
			j | J | ja | Ja | y | Y) brew install $missing ;;
			*) say "übersprungen. Später: brew install$missing" ;;
		esac
	else
		say "installieren mit: brew install$missing"
	fi
fi

if [ "$running" -eq 1 ]; then
	open -a "$dest/clonq.app"
	say "clonq läuft wieder."
else
	say "starten: open -a clonq"
fi
