# Snipset CLI

Install the `snipset` terminal companion on Linux x64 or Windows x64 from release assets. This repository holds the installers, the package manifests, and the release documentation. The CLI source and the native builds are private.

The v0.2.0 release is a Draft until it is published. Until then only the owner can download it, so every channel below fails for other users. See [Known limits](#known-limits).

## Install matrix

Status on 2026-10-25. CI (`.github/workflows/test.yml`) runs every check named below on each push.

| Channel | Status |
| --- | --- |
| `install.sh` on Arch Linux x86_64 | verified: the sandboxed installer suites (`tests/install*.test.mjs`) plus an install of the real v0.2.0 assets in a temp HOME (`tests/install-real-assets.test.mjs`) |
| `install.sh` on Debian, Ubuntu, Fedora, WSL | not verified: only Ubuntu runs, in CI on `ubuntu-latest` (the installer suites plus `tests/install-real-assets.test.mjs`); Debian, Fedora, and WSL have none; glibc 2.34 and OpenSSL 3 are required |
| `install.sh --from` (offline) | verified: same runs as above |
| `install.ps1` on Windows x64 | verified: CI on `windows-latest` installs the real v0.2.0 zip with `-From` under PowerShell 7 and Windows PowerShell 5.1, then runs `-Check`, `snipset --version`, and `-Uninstall`; the download path is not exercised while the release is a Draft |
| Scoop | not verified: CI does not run Scoop; the manifest passes the vendored Scoop schema |
| winget | not submitted: the manifests pass the vendored 1.12.0 schemas |
| AUR | not published: the package builds with makepkg on Arch from the real tarball, and its binary runs |
| Homebrew tap | verified: CI on `ubuntu-latest` installs the formula from a local tap with the verified tarball, then runs `brew test` and `brew audit --strict`; `brew tap` from this repo and the download are not exercised while the release is a Draft |
| Nix flake | not verified: CI runs `nix flake check`, which evaluates the flake but builds and runs nothing; structural checks and the hash |
| mise, eget, ubi | not verified: the tools are absent |
| `gh release download` | verified: owner account, Draft release |

## Linux x64

Download the installer, read it, then install a pinned release. The `v0.2.0` URL works once that tag exists; the tag is created when the Draft release is published.

```sh
curl -fsSL https://raw.githubusercontent.com/belajarcarabelajar/snipset-cli/v0.2.0/install.sh -o install-snipset.sh
less install-snipset.sh
bash install-snipset.sh --version v0.2.0 --add-path
```

The copy on `main` works too. It gets installer fixes before the next tag:

```sh
curl -fsSL https://raw.githubusercontent.com/belajarcarabelajar/snipset-cli/main/install.sh -o install-snipset.sh
```

The installer needs x86_64, glibc 2.34 or newer, OpenSSL 3 (`libcrypto.so.3`), bash 4.4 or newer, `tar`, `curl` or `wget`, and one of `sha256sum`, `shasum`, or `openssl`. It refuses another OS, CPU, or libc (macOS, ARM, musl, glibc older than 2.34) before it downloads anything. A missing `libcrypto.so.3` is caught when the new binary is test-run, after the download and before anything is replaced; an empty install directory can remain.

The default destination is `~/.local/bin`. The installer checks the archive against `SHA256SUMS` and runs the new binary before it replaces an existing one.

A fresh install also sets up a working station. It creates a standalone database (`snipset init`), installs the shell bundle (helpers, completion, TAB expansion, Enter trigger) with a marked block in `~/.bashrc`, and generates trigger shims next to the binary. Each step can run again without harm, and each one can be turned off:

```sh
bash install-snipset.sh --version v0.2.0 --add-path --with-mcp=claude,opencode
bash install-snipset.sh --version v0.2.0 --no-init --no-shell --no-shims
```

Releases without the shell bundle ship the binary only. The installer then skips shell integration and shims with a note and still exits 0; the database, PATH, and MCP steps still run.

### Setup flags

| Flag | Effect |
| --- | --- |
| `--version VERSION` | Release to install. Default: the latest release. |
| `--install-dir DIR` | Binary destination. Default: `~/.local/bin`. |
| `--add-path` | Add the install dir to PATH for bash, zsh, and fish. See [Shells and PATH](#shells-and-path). |
| `--share-dir DIR` | Shell bundle destination. Default: `~/.local/share/snipset`. |
| `--db PATH` | Database for init, shims, and MCP. The bashrc block then exports `SNIPSET_DB`, so shims, TAB expansion, and completion use it. Default: the CLI default. |
| `--bashrc PATH` | Shell startup file for the integration block. Default: `~/.bashrc`. |
| `--no-init` | Skip creating the standalone database. |
| `--no-shell` | Skip shell integration. |
| `--no-shims` | Skip generating trigger shims. |
| `--with-mcp` | Same as `--with-mcp=opencode`: write `$XDG_CONFIG_HOME/opencode/opencode.json` (default `~/.config/opencode/opencode.json`) when it is absent. |
| `--with-mcp=LIST` | Register MCP for a comma list of `claude`, `codex`, `gemini`, `opencode`, `cursor`, `vscode`, or `all`. See [MCP registration](#mcp-registration). |
| `--from DIR` | Install from `SHA256SUMS` and the archive in DIR. No download. See [Offline install](#offline-install). |
| `--dry-run` | Print every step and write nothing. |
| `--check` | Report drift of an install made with the same flags. |
| `--update` | Install the latest release (or `--version`) over the current one. |
| `--uninstall` | Remove what an install with the same flags wrote. |
| `--help`, `-h` | Show the help and exit 0. |

## Check, update, uninstall, dry run

| Mode | What it does |
| --- | --- |
| `--check` | Writes nothing (with `--with-mcp=claude`, the `claude` CLI updates its own state, see [Known limits](#known-limits)). Prints one line per item: binary, shell files, database, shims, PATH, MCP. Ends with `check: CURRENT` or `check: DRIFT (N items)`. |
| `--update` | Installs the latest release, or the one in `--version`, over the current one. Does nothing when that version is already installed. |
| `--uninstall` | Removes what an install with the same flags wrote, including MCP entries for the `--with-mcp` list you pass. Ends with `uninstall: removed N, kept N`. |
| `--dry-run` | Prints a `[DRY]` line for every install step and writes nothing. |

| Exit code | Meaning |
| --- | --- |
| 0 | Done. For `--check`: everything is current. |
| 1 | A required step failed (download, checksum, archive, binary test run, an `[FAIL]` line), the system was refused, or `--check` found drift. A failed `snipset init` or shim generation only prints a note. |
| 2 | Usage error: an unknown flag, a missing value, an empty path value or one that starts with `-`, an invalid `--version` (with or without `--dry-run`), two modes at once, or `--dry-run --uninstall`. |

Rules:

- `--check` and `--uninstall` look only where you point them. Pass the same `--install-dir`, `--share-dir`, `--bashrc`, `--db`, and `--with-mcp` flags you used for the install. `--check` also needs `--add-path` to check PATH.
- `--dry-run --uninstall` is refused, because the remove steps cannot be previewed. Run `--check` to see what is installed.
- A relative `--install-dir`, `--share-dir`, `--db`, `--bashrc`, or `--from` is made absolute against the current directory before anything is written, so the startup files and MCP configs never depend on the directory a later shell starts in.
- The database is never removed.
- Uninstall removes the directories the install created, deepest first, when they are empty. The install records them in `<install-dir>/.snipset-dirs`. A directory that existed before the install, or that still holds a file, stays, except the default share dir an older install left (next rule). Other directories made by an installer older than this record are not in it and can stay behind empty.
- The installer tracks the shell files it writes in `<share-dir>/.snipset-bundle`. A `snipset.sh`, `completion.bash`, or `tab.sh` there that it did not write, or that you edited, is kept: install and uninstall print `[KEEP]`, and the bashrc block is not added while one is kept, because it would source that file at every login. Delete the file to let the installer manage it again.
- A startup file the installer created, such as a `--bashrc` path or `~/.profile` that did not exist, is listed in `<install-dir>/.snipset-files`; uninstall removes it once only blank lines are left. A startup file you already had stays, even if it ends up empty.
- Installs older than the manifest: a default share dir (`~/.local/share/snipset`) with no `.snipset-bundle` is taken as an older install, so its `snipset.sh`, `completion.bash`, and `tab.sh` are replaced as before, and uninstall removes the directory once it is empty. Keep files of your own under those names in a custom `--share-dir`.

```sh
bash install-snipset.sh --check --add-path --with-mcp=claude,opencode
bash install-snipset.sh --update --add-path --with-mcp=claude,opencode
bash install-snipset.sh --uninstall --add-path --with-mcp=claude,opencode
```

## Offline install

`--from DIR` installs from a directory that holds `SHA256SUMS` and the Linux archive. Nothing is downloaded, and the checksum is still checked. Without `--version` the installer reads the version from the files in DIR.

```sh
gh release download v0.2.0 -R belajarcarabelajar/snipset-cli -D snipset-assets
bash install-snipset.sh --from snipset-assets --add-path
```

## Shells and PATH

`--add-path` writes two files, `<share-dir>/env` for sh, bash, and zsh, and `<share-dir>/env.fish` for fish. Each adds the install dir to PATH only when it is not there yet. Then it adds one line to your startup files:

```sh
. "<share-dir>/env" # snipset-path (managed by snipset installer; safe to remove)
```

| Shell | File | When |
| --- | --- | --- |
| sh and bash login | `~/.profile` | always |
| bash | `~/.bashrc`, `~/.bash_profile`, `~/.bash_login`, and the `--bashrc` file | when the file exists, and the `--bashrc` file also when shell integration is about to create it |
| zsh | `$ZDOTDIR/.zshenv`, or `~/.zshenv` without `ZDOTDIR` | when zsh is your `$SHELL` or is on PATH |
| fish | `~/.config/fish/conf.d/snipset.fish` (honours `XDG_CONFIG_HOME`), which sources `<share-dir>/env.fish` | when fish is your `$SHELL` or is on PATH |

A second run does not add the line twice. `--uninstall` removes the exact line from each file, and deletes the env files when they still match what the installer wrote.

If `<share-dir>/env`, `<share-dir>/env.fish`, or the fish file already exists and was not written by the installer, it is kept: the installer prints `[KEEP]` with the line to add by hand, and adds no source line that would run your file.

Older installers wrote `export PATH="<install-dir>:$PATH"` into `~/.profile`. That line has no marker and may be your own, so uninstall keeps it and prints a hint: `[KEEP] path legacy line: ... remove it by hand if the old installer added it`.

## MCP registration

`--with-mcp=LIST` on Linux and `-WithMcp LIST` on Windows register the `snipset mcp` server with these six ids. `all` means all six. `<bin>` is the installed binary; `--db PATH` is added when you pass it.

| Id | Install | Uninstall |
| --- | --- | --- |
| `claude` | `claude mcp add --scope user snipset -- <bin> mcp` | `claude mcp remove --scope user snipset` |
| `codex` | `codex mcp add snipset -- <bin> mcp` | `codex mcp remove snipset` |
| `gemini` | `gemini mcp add --scope user snipset <bin> mcp` | `gemini mcp remove --scope user snipset` |
| `opencode` | writes `$XDG_CONFIG_HOME/opencode/opencode.json` (default `~/.config/opencode/opencode.json`) when it is absent; a `~/.config/opencode/opencode.json` from an older install is still used while no `$XDG_CONFIG_HOME` file exists | deletes the file only when it still matches what the installer wrote |
| `cursor` | writes `~/.cursor/mcp.json` when it is absent; otherwise prints the entry to add by hand | deletes the file only when it still matches what the installer wrote |
| `vscode` | `code --add-mcp '{"name":"snipset","command":"<bin>","args":["mcp"]}'` | not removed; delete `snipset` from the VS Code `mcp.json` by hand |

- Nothing is overwritten. An existing `snipset` entry is kept, even when it points elsewhere. An existing `opencode.json` or `mcp.json` is left untouched.
- Claude and Gemini use user scope only. A project or local entry is reported and left alone.
- When a CLI (`claude`, `codex`, `gemini`, `code`) is not on PATH, that id is skipped with a note.
- The VS Code file is `~/.config/Code/User/mcp.json` on Linux and `%APPDATA%\Code\User\mcp.json` on Windows.

## Windows x64

Run PowerShell without administrator rights:

```powershell
& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/belajarcarabelajar/snipset-cli/v0.2.0/install.ps1).Content)) -Version v0.2.0 -AddPath
```

The default destination is `$env:LOCALAPPDATA\Snipset\bin`. Download the script and read it first when your policy requires it. The script sets TLS 1.2 for GitHub downloads. It ships the binary only; shell integration is a Linux feature.

| Parameter | Effect |
| --- | --- |
| `-Version` | Release to install, for example `v0.2.0`. Default: the latest release. |
| `-InstallDir` | Directory for `snipset.exe`. Default: `$env:LOCALAPPDATA\Snipset\bin`. |
| `-AddPath` | Add the install dir to the User `Path`. |
| `-WithMcp` | Register MCP for `claude`, `codex`, `gemini`, `opencode`, `cursor`, `vscode`, or `all`. One comma string or several strings. |
| `-Database` | Database the registered MCP servers use, passed as `--db`: the Windows form of `--db`. `-Check` reports whether the file exists. There is no `snipset init` step on Windows. `-Db` is not accepted, because PowerShell reserves it as the alias of `-Debug`. |
| `-From` | Install from a directory that holds `SHA256SUMS` and the release zip. No download. |
| `-DryRun` | Print one `[DRY]` line per step and write nothing. |
| `-Check` | Report whether the install is current. Throws on drift. |
| `-Update` | Install the requested or latest release over the current one. |
| `-Uninstall` | Remove `snipset.exe`, the MCP entries for the `-WithMcp` list, and the install dir from the User `Path` when the installer added it (and `snipset.exe` was removed). Never removes the database. |

```powershell
.\install.ps1 -Check -AddPath -WithMcp claude,codex
.\install.ps1 -Update
.\install.ps1 -Uninstall -WithMcp claude,codex
.\install.ps1 -Version v0.2.0 -From .\snipset-assets
```

- Use only one of `-Check`, `-Update`, `-Uninstall`. `-DryRun -Uninstall` is refused; run `-Check` instead.
- Usage errors, refusals, and drift throw, so `pwsh -File install.ps1` ends with status 1. The script never closes the session it runs in.
- User `Path`: the script reads and writes the raw value in `HKCU\Environment`, so entries such as `%USERPROFILE%\bin` stay unexpanded. It then tells Windows that the environment changed. Open a new terminal to use `snipset`.
- `-Check` looks at the User `Path` only when you pass `-AddPath`. Pass the same `-InstallDir`, `-WithMcp`, and `-Database` as the install.
- Parameters are named only; a positional value, such as a stray `-Db x`, is refused before anything is written.
- The v0.2.0 `snipset.exe` imports `libcrypto-3-x64.dll` (OpenSSL 3) and `VCRUNTIME140.dll` (the Microsoft Visual C++ runtime), and the zip ships neither. This was read from the import table with `objdump -p`, not run on Windows. Without both on the DLL search path the exe cannot start: the installer stops with a message naming them, and the installed `snipset.exe` stays as it was.
- An update over a `snipset.exe` that is in use renames it to `snipset.exe.old-<pid>-<8 hex>`. The next install, update, or uninstall deletes those files once the program using them has exited.

## Package managers

These install the binary only, plus on Linux the shims generator and bash completion (AUR and Homebrew also install `snipset.sh` and `tab.sh`). None of them runs the setup steps of `install.sh`.

Scoop (Windows), from the `bucket/snipset.json` manifest in this repo:

```powershell
scoop bucket add snipset https://github.com/belajarcarabelajar/snipset-cli
scoop install snipset/snipset
```

winget (Windows). The manifests are not submitted yet. After they are accepted:

```powershell
winget install BCBAcademy.SnipsetCLI
```

To test the manifests from a clone, enable local manifests once from an administrator prompt, then install from the directory:

```powershell
winget settings --enable LocalManifestFiles
winget install --manifest packaging/winget/manifests/b/BCBAcademy/SnipsetCLI/0.2.0
```

AUR (Arch Linux). The package is not published yet. After it is, install `snipset-cli` with your AUR helper. Until then, build it from `packaging/aur/snipset-cli`:

```sh
cd packaging/aur/snipset-cli
makepkg -si
```

Homebrew (Linux only), from `Formula/snipset.rb` in this repo:

```sh
brew tap belajarcarabelajar/snipset https://github.com/belajarcarabelajar/snipset-cli
brew install belajarcarabelajar/snipset/snipset
```

The formula installs the prebuilt binary, which needs the host's `libcrypto.so.3` (OpenSSL 3) and glibc 2.34 or newer. The formula does not install them: the binary has no RPATH and Homebrew's `openssl@3` is keg-only, so depending on it would not change which library loads.

Nix (x86_64-linux), from `flake.nix` in this repo:

```sh
nix run github:belajarcarabelajar/snipset-cli
```

The package is marked `unfree` because of the EULA in `LICENSE`. The flake imports nixpkgs with `allowUnfree = true` for its own package, so you do not change your Nix config for it. CI evaluates the flake with `nix flake check`; `nix run` has not been tried.

Maintainers: every manifest above is rendered from `packaging/VERSION` and `packaging/SHA256SUMS` by `bun scripts/packaging/render.mjs`, and `--check` fails when a committed file differs. After changing the version, delete the previous version's folder under `packaging/winget/manifests` before running `--check`.

## Version managers

These read the GitHub release directly and install the binary only.

```sh
mise use -g github:belajarcarabelajar/snipset-cli@0.2.0
eget belajarcarabelajar/snipset-cli --tag v0.2.0 --file snipset --to ~/.local/bin
ubi -p belajarcarabelajar/snipset-cli -t v0.2.0 -e snipset -i ~/.local/bin
```

mise checks the asset with the digest GitHub publishes. eget checks a checksum automatically only from a `<asset>.sha256` file, which this release does not have. ubi documents no checksum check. Compare with `SHA256SUMS` by hand when you use eget or ubi.

## Help

The Linux installer and the live wrapper print usage with `--help` and exit 0. A usage error exits 2; most print the usage text, and a few (such as `--dry-run --uninstall` or a malformed `--version`) print one line.

```sh
bash install-snipset.sh --help
bash install-snipset.sh -h
bash scripts/snipset-live.sh --help
```

The Windows installer has comment-based help:

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

Only these commands are reads: `snippet list/get/search/expand`, `group list`,
every `stats` command, `reference list`, `clipboard list/get/search/export`,
`clipboard tag list`, `audio history list/get`, `audio dictionary list`,
`audio tts list`, `audio stats`, `journal list/get/export`,
`task list/get/subtasks/stats`, `task project list`, `task folder list`,
`note list/get/search/count/stats`, `settings list/get/export`,
`support categories`, and `export`. `--version`, `-V`, `help`, and
`<command> --help` also skip the write check, because they never open the
database. `pomodoro` and `doctor` go through the write path. Reads use the snapshot in
`$SNIPSET_LIVE_SNAPSHOT_DIR` (default `${TMPDIR:-/tmp}/snipset-live-<uid>`,
where `<uid>` is your numeric user id). `snippet expand` is a read and never
touches the live file. Every other command is a write, including
`snippet add/update/delete` and the clipboard and audio commands that change
data. Writes target the live database, but only after `snipset doctor` proves
it is reachable. If the wrapper refuses a write (exit 3), it prints doctor's
reason after its own two lines; close Snipset Desktop and retry.

Before each command, the wrapper refreshes the snapshot when `--refresh` is
passed, when the snapshot is missing, or when the live database or its `-wal`
file is newer than the snapshot. Every refresh copies the whole live database,
plus its `-wal` and `-shm` files when they exist, into the snapshot directory.
Use `--refresh` to force a fresh copy, `--live-db PATH` instead of
`SNIPSET_LIVE_DB`, and `--snapshot-dir DIR` instead of
`SNIPSET_LIVE_SNAPSHOT_DIR`. Pass `--` before the snipset command when args
could look like wrapper flags. The wrapper owns `--db` (snapshot for reads,
live for gated writes) and drops any user supplied `--db` or `--db=...`
value; wrapper flags require a space and `--flag=value` is rejected.

## Manual downloads

Download the archive for your platform and `SHA256SUMS` from the release page. Check the archive against its line in `SHA256SUMS`, then extract it only into a directory you own.

The Linux asset `snipset-cli-v0.2.0-x86_64-unknown-linux-gnu.tar.gz` holds the `snipset` executable, `LICENSE`, and the `shell/` bundle (`snipset.sh`, `completion.bash`, `tab.sh`, `snipset-shims.sh`).

The Windows asset `snipset-cli-v0.2.0-x86_64-pc-windows-msvc.zip` holds `snipset.exe` and `LICENSE`.

The CLI works against a standalone database created by `snipset init`, or against an existing compatible database created by Snipset Desktop. It never migrates a schema it does not own. Clipboard, journal, pomodoro, note, and task operations that use the live bridge need the desktop app to be running. Database-only operations work while the app is closed.

## Known limits

- The release is a Draft: until it is published, only the owner can download it, and every channel above fails for others.
- Linux needs x86_64, glibc 2.34 or newer, `libcrypto.so.3` (OpenSSL 3), and bash 4.4 or newer.
- macOS, ARM, and musl (Alpine) are refused.
- Windows 10 on Arm is refused; Windows 11 on Arm runs the x64 build under emulation.
- The Windows exe is unsigned, so Smart App Control can block it.
- wget cannot refuse a redirect from https to http; curl can, and the installer uses curl when it is present.
- `--check` or `--uninstall` with `--with-mcp=claude` runs `claude mcp get`, which updates Claude's own state files.
- The output formats of `codex`, `gemini`, and VS Code were not observed, and the Windows config paths for Cursor, Codex, and Gemini are inferred.
- Uninstall removes only the empty directories the install created. A directory that existed before the install, still holds a file, or was made by an older installer stays; on Windows the empty install dir is removed.
- The Windows v0.2.0 exe needs `libcrypto-3-x64.dll` and `VCRUNTIME140.dll`, which the zip does not ship.
- The Homebrew formula relies on the host's `libcrypto.so.3` (OpenSSL 3) and glibc 2.34 or newer.
- `--check` needs the same flags as the install.
- The EULA in `LICENSE` applies to every channel.

## Updates and uninstall

Use `--update` and `--uninstall` on Linux, or `-Update` and `-Uninstall` on Windows, with the same flags as the install. See [Check, update, uninstall, dry run](#check-update-uninstall-dry-run) and [Windows x64](#windows-x64). Uninstall never deletes a database.

If the Windows installer cannot run, remove the install directory from the User `Path` value by hand. Search Windows for environment variables, or inspect the value with `[Environment]::GetEnvironmentVariable('Path','User')`. Then delete `snipset.exe` from the install directory.
