# clonq

Sync and backup for macOS. clonq lives in the menu bar, runs rsync jobs between
folders, external drives and SSH hosts such as a Hetzner Storage Box, and keeps
a history with real numbers for every run.

Built with Tauri 2, Rust and React.

## Develop

```sh
pnpm install
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
