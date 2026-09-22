# Snipset CLI

Install the `snipset` terminal companion on Linux x64 or Windows x64 from public release assets. This repository contains installation scripts and release documentation; the CLI implementation and native builds remain private.

## Linux x64

Inspect the installer before running it, then install a pinned release:

```sh
curl -fsSL https://raw.githubusercontent.com/belajarcarabelajar/snipset-cli/main/install.sh -o install-snipset.sh
less install-snipset.sh
bash install-snipset.sh --version v0.2.0 --add-path
```

The default destination is `~/.local/bin`. Use `--install-dir DIR` for another user-owned directory. The installer validates the archive checksum and executable before replacing an existing installation.

A fresh install also sets up a working station: it creates a standalone database (`snipset init`), installs the shell bundle (helpers, completion, TAB expansion, Enter trigger) with a marker-guarded block in `~/.bashrc`, and generates trigger shims next to the binary. Each step is idempotent and strictly opt-out:

```sh
bash install-snipset.sh --version v0.2.0 --add-path --with-mcp
bash install-snipset.sh --version v0.2.0 --no-init --no-shell --no-shims
```

| Flag | Effect |
| --- | --- |
| `--share-dir DIR` | Shell bundle destination (default `~/.local/share/snipset`). |
| `--db PATH` | Database used for init, shims, and the MCP config (default: the CLI default). |
| `--bashrc PATH` | Shell startup file for integration (default `~/.bashrc`). |
| `--no-init` | Skip creating the standalone database. |
| `--no-shell` | Skip shell integration. |
| `--no-shims` | Skip generating trigger shims. |
| `--with-mcp` | Write `~/.config/opencode/opencode.json` when absent (never overwrites). |

Releases before the shell bundle ship the binary only; the installer then skips the setup steps with a note and still exits zero.

## Windows x64

Run PowerShell without administrator privileges:

```powershell
& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/belajarcarabelajar/snipset-cli/main/install.ps1).Content)) -Version v0.2.0 -AddPath
```

The default destination is `$env:LOCALAPPDATA\Snipset\bin`. Download the script for review when your policy requires it. Use `-InstallDir` for another user-owned location. The PowerShell installer ships the binary only; terminal shell integration is a Linux feature.

## Querying the live database (companion workflow)

`scripts/snipset-live.sh` runs the installed `snipset` CLI against a snapshot
of the Snipset Desktop database, so reads never fight the running app for the
live file:

```sh
export SNIPSET_LIVE_DB="$LOCALAPPDATA/Snipset/snipset.db"
bash scripts/snipset-live.sh --json snippet search "query"
bash scripts/snipset-live.sh --refresh snippet get <uuid>
```

Reads (`snippet list/get/search`, `group list`, `stats`, `clipboard`, `audio`,
`reference`) use the snapshot in `$SNIPSET_LIVE_SNAPSHOT_DIR`
(default `/tmp/snipset-live`). Writes (`snippet add/update/delete`, anything
else) target the live database, but only after `snipset doctor` proves it is
reachable. If the wrapper refuses a write, close Snipset Desktop and retry.

## Manual downloads

Download the archive for your target from the release page, download `SHA256SUMS`, verify the matching line, and extract only into a user-owned directory. The Linux archive holds the executable, the `shell/` terminal bundle, required runtime files, and notices for the tested target.

The CLI works against a standalone database created by `snipset init`, or against an existing compatible database created by Snipset Desktop; it never migrates a schema it does not own. Clipboard, journal, pomodoro, note, and task operations that use the live bridge require the desktop app to be running. Database-only operations can work while the app is closed.

## Updates and removal

Run the same installer with a newer pinned version. It validates the new archive before replacing the old executable. To remove: delete the installed `snipset` and `snipset-shims` files, the generated trigger shims (tracked in `.snipset-shims` next to the binary), the `~/.local/share/snipset` directory, the `snipset-terminal-integration` block in `~/.bashrc`, and the optional PATH line from your user profile. The installer never deletes a database.

Initial support is Linux x64 and Windows x64. macOS and ARM builds are not published until native compatibility checks pass.
