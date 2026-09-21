# Snipset CLI

Install the `snipset` terminal companion on Linux x64 or Windows x64 from public release assets. This repository contains installation scripts and release documentation; the CLI implementation and native builds remain private.

## Linux x64

Inspect the installer before running it, then install a pinned release:

```sh
curl -fsSL https://raw.githubusercontent.com/belajarcarabelajar/snipset-cli/main/install.sh -o install-snipset.sh
less install-snipset.sh
bash install-snipset.sh --version v0.1.0 --add-path
```

The default destination is `~/.local/bin`. Use `--install-dir DIR` for another user-owned directory. The installer validates the archive checksum and executable before replacing an existing installation.

## Windows x64

Run PowerShell without administrator privileges:

```powershell
& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/belajarcarabelajar/snipset-cli/main/install.ps1).Content)) -Version v0.1.0 -AddPath
```

The default destination is `$env:LOCALAPPDATA\Snipset\bin`. Download the script for review when your policy requires it. Use `-InstallDir` for another user-owned location.

## Manual downloads

Download the archive for your target from the release page, download `SHA256SUMS`, verify the matching line, and extract only into a user-owned directory. The release includes only the executable, required runtime files, and notices for the tested target.

The CLI uses an existing compatible database created by Snipset Desktop. It does not create or migrate that database. Clipboard, journal, pomodoro, note, and task operations that use the live bridge require the desktop app to be running. Database-only operations can work while the app is closed.

## Updates and removal

Run the same installer with a newer pinned version. It validates the new archive before replacing the old executable. Remove the installed `snipset` file and the optional PATH line from your user profile to uninstall. The installer never deletes a database.

Initial support is Linux x64 and Windows x64. macOS and ARM builds are not published until native compatibility checks pass.
