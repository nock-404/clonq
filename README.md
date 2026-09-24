# clonq

Sync and backup for macOS. clonq lives in the menu bar, runs rsync and rclone jobs between
folders, external drives, SSH hosts such as a Hetzner Storage Box, network shares and clouds, and keeps
a history with real numbers for every run.

Built with Tauri 2, Rust and React.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/nock-404/clonq/main/install.sh | sh
```

For Macs with Apple silicon, macOS 13 or newer. The same command updates an
installed clonq; the app also finds new releases by itself and installs them
on request. rsync 3.5.1 (built from source) and rclone 1.75.1 ship inside the
app; nothing else needs to be installed.

## Release

Set the new version in `package.json`, `src-tauri/Cargo.toml` and
`src-tauri/tauri.conf.json`, commit, then tag and push:

```sh
git tag v0.2.0 && git push origin main v0.2.0
```

The `release` workflow builds the app on macOS 26, signs the update with the
key in the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and publishes the release with
`latest.json` for the updater.

## Develop

```sh
pnpm install
./scripts/fetch-tools.sh   # rsync and rclone into src-tauri/binaries, once
pnpm tauri dev
```

`/preview.html?window=popover&scene=running` in the dev server renders a window
with a mocked backend, one scene at a time.

## Test

```sh
cd src-tauri && cargo test
```

The engine tests run the real rsync (`/opt/homebrew/bin/rsync`, 3.x) against
temporary folders.
