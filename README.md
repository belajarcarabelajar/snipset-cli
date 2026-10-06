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

## Help

Linux installer and live wrapper print usage with `--help` and exit 0:

```sh
bash install-snipset.sh --help
bash install-snipset.sh -h
bash scripts/snipset-live.sh --help
```

Windows installer parameters are `-Version`, `-InstallDir`, and `-AddPath`. It requires TLS 1.2 for GitHub downloads and sets it automatically. Show local help with:

```powershell
Get-Help ./install.ps1
```

## Querying the live database (companion workflow)

`scripts/snipset-live.sh` runs the installed `snipset` CLI against a snapshot
of the Snipset Desktop database, so reads never fight the running app for the
live file:

```sh
export SNIPSET_LIVE_DB="$LOCALAPPDATA/Snipset/snipset.db"
bash scripts/snipset-live.sh --json snippet search "query"
bash scripts/snipset-live.sh --refresh snippet get <uuid>
```

Reads (`snippet list/get/search/expand`, `group list`, `stats`, `clipboard`,
`audio`, `reference`) use the snapshot in `$SNIPSET_LIVE_SNAPSHOT_DIR`
(default `/tmp/snipset-live`). `snippet expand` is a read and never touches
the live file. Writes (`snippet add/update/delete`, anything
else) target the live database, but only after `snipset doctor` proves it is
reachable. If the wrapper refuses a write, close Snipset Desktop and retry.

The snapshot is refreshed when it is missing, when `--refresh` is passed, or
when the live database is newer than the snapshot (stale copy). Use
`--refresh` to force a fresh copy, `--live-db PATH` instead of
`SNIPSET_LIVE_DB`, and `--snapshot-dir DIR` instead of
`SNIPSET_LIVE_SNAPSHOT_DIR`. Pass `--` before the snipset command when args
could look like wrapper flags. The wrapper owns `--db` (snapshot for reads,
live for gated writes) and drops any user supplied `--db` or `--db=...`
value; wrapper flags require a space and `--flag=value` is rejected.

## Manual downloads

Download the archive for your platform from the release page, download `SHA256SUMS`, verify the matching line, and extract only into a user-owned directory. The Linux asset is `snipset-cli-<version>-x86_64-unknown-linux-gnu.tar.gz` and holds the `snipset` executable plus the `shell/` terminal bundle (`snipset.sh`, `completion.bash`, `tab.sh`, `snipset-shims.sh`) in newer releases. The Windows asset is `snipset-cli-<version>-x86_64-pc-windows-msvc.zip` and holds `snipset.exe` only.

The CLI works against a standalone database created by `snipset init`, or against an existing compatible database created by Snipset Desktop; it never migrates a schema it does not own. Clipboard, journal, pomodoro, note, and task operations that use the live bridge require the desktop app to be running. Database-only operations can work while the app is closed.

## Updates and uninstall

Run the same installer with a newer pinned version. It validates the new archive before replacing the old executable.

Linux uninstall (the uninstall never deletes a database):

```sh
rm -f ~/.local/bin/snipset ~/.local/bin/snipset-shims
rm -f ~/.local/bin/<trigger-shim-name>
rm -rf ~/.local/share/snipset
```

Then edit `~/.bashrc` and delete the `snipset-terminal-integration` block, and edit `~/.profile` and delete the install dir PATH line if `--add-path` added one. If you used a custom `--install-dir`, `--share-dir`, or `--bashrc`, remove those paths instead. If you no longer know which trigger shims were generated, list the executable files next to the binary that are not `snipset` or `snipset-shims` and delete only the ones created as snippet triggers.

Windows uninstall (the uninstall never deletes a database):

```powershell
Remove-Item "$env:LOCALAPPDATA\Snipset\bin\snipset.exe"
```

If you passed `-AddPath`, remove the install directory from the User `Path` value (search Windows for environment variables, or run `[Environment]::GetEnvironmentVariable('Path','User')` to inspect it). If you used a custom `-InstallDir`, delete `snipset.exe` there instead. The Windows installer ships the binary only, so there is no shell bundle, shim set, or startup file block to clean up.

Initial support is Linux x64 and Windows x64. macOS and ARM builds are not published until native compatibility checks pass.
