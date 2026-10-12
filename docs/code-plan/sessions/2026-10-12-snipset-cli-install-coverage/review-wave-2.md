# Review wave 2: Windows installer and package manifests (2026-10-12)

Two independent read-only `staid` reviewers at HEAD `a74cc7e`. Reports are inputs; each finding is tracked to a fix chunk or a backlog line.

## Reviewer D: package manifests and the renderer

Verdict: correct (no P0, P1, or P2).

| # | Sev | Status | Where | What happens | Fix |
|---|---|---|---|---|---|
| D1 | P3 | CONFIRMED | `packaging/aur/snipset-cli/PKGBUILD:9` | `depends` came from `ldd` (indirect libraries); `readelf -d` NEEDED is `libcrypto.so.3`, `libgcc_s.so.1`, `libm.so.6`, `libc.so.6`; `libgcc_s` is in `libgcc`, and `openssl` already pulls `zlib`, `brotli`, `zstd` | C17b: `depends=('glibc' 'libgcc' 'openssl')` |
| D2 | P3 | CONFIRMED | `flake.nix:22` | the same extra libraries in `buildInputs` (harmless) | C17b: `[ pkgs.openssl pkgs.stdenv.cc.cc.lib ]` |
| D3 | P3 | CONFIRMED | `render.mjs:8` | a pre-release version renders, then makepkg rejects `pkgver=0.3.0-rc.1` (exit 12) | C17b: the renderer refuses a pre-release version with a message |
| D4 | P3 | CONFIRMED | `render.mjs:221` | after a version bump `--check` reports the old winget folder as orphans and nothing says to delete it | C17b: usage text and README name the step |
| D5 | P3 | DERIVED | `Formula/snipset.rb:14` | no `depends_on "openssl@3"`; the formula relies on the host's OpenSSL 3 | backlog: `defer: Homebrew dependency on openssl@3, upgrade-trigger: a brew run on Linux shows the binary failing to load libcrypto.so.3` |
| D6 | n/a | CONFIRMED | evidence | `~/vivera/scripts/check-copy-rules.mjs --diff origin/main` run from this worktree scans vivera (its `ROOT` is hard-coded), so its "0 added lines" is not evidence here; the reviewer's own scan of 13652 added lines in 88 files and 37 commit messages found 0 em dashes and 0 attribution lines | learning ledger; T25 uses its own scans |

Safe cases D ran: both real assets match `packaging/SHA256SUMS`; the Nix SRI equals the real tarball's; the vendored schemas match `SOURCES.md`; `.SRCINFO` equals `makepkg --printsrcinfo` at 0.2.0 and after a 0.2.1 bump; a real makepkg build from the real tarball gives the six planned paths and an unstripped binary; Scoop `bin` matches the zip root; the Homebrew test expectation matches the real `--version`; LICENSE is identical to the tarball's; a 0.2.1 bump updates every output and moves the winget folder; packaging suites 86 pass, 2 skip; nothing in the repo redistributes the binary and every licence field is consistent with the EULA. The flake's own `allowUnfree = true` is a recorded plan choice.

Mutations: a wrong Scoop hash (2 red), a winget locale file name (7 red), an AUR completion path (1 red, only where makepkg exists), Nix `openssl` removed (1 red), Scoop licence `MIT` (1 red).

## Reviewer C: Windows installer

Verdict: correct (no P0 or P1). Runs under pwsh 7.6.6 on Linux with a temp HOME and the test switch; Windows itself and Windows PowerShell 5.1 were not available.

| # | Sev | Status | Where | What happens | Fix |
|---|---|---|---|---|---|
| C1 | P2 | CONFIRMED | `lib.ps1:12`, `platform.ps1:6` | with `Set-StrictMode` on in the caller, every mode throws on the unset `$run` (and `$IsWindows` on 5.1) before writing anything | C15b: `Set-StrictMode -Off` first in `lib.ps1`, guarded `$IsWindows` read |
| C2 | P2 | CONFIRMED (mocked registry) | `modes.ps1:119`, `path.ps1:80-92` | `-Uninstall` removes the install dir from the User Path even when the install found it already there, and even without `-AddPath`; a shared `C:\tools` would drop other tools | C15c: record ownership only when the entry is actually added, remove only a recorded entry, skip when the exe was kept |
| C3 | P2 | CONFIRMED | `mcp.ps1:109-112,262`, `mcp.sh:88-89` | Gemini "ours" test matches `"snipset"` and the bin path anywhere in settings.json, so a `snipset-dev` entry with our bin made a foreign `snipset` entry look ours and it was removed | C15c (ps1: `ConvertFrom-Json`), C11c (sh: the `snipset` object's own `command` field) |
| C4 | P3 | CONFIRMED (pre-existing) | `lib.ps1:3` | the TLS line overwrites the session's `SecurityProtocol` | C15b: add TLS 1.2 only when missing, on Desktop edition, and restore it at the end |
| C5 | P3 | CONFIRMED (pre-existing) | `binary.ps1:33`, `fetch.ps1:32,35` | `[` `]` in a path are wildcards; fails closed | C15b: `-LiteralPath`, `[IO.Directory]::CreateDirectory` |
| C6 | P3 | CONFIRMED | `lib.ps1:48-53`, `path.ps1:16-21` | `-InstallDir` with `;` becomes two PATH entries; relative dirs are written relative | C15b: resolve to a full path, refuse `;` and `"` |
| C7 | P3 | CONFIRMED (parity) | `lib.ps1:5`, `fetch.ps1:29-30` | an http base URL is accepted (Linux refuses since `0196143`) | C15b: refuse non-https unless `-From` |
| C8 | P3 | DERIVED | `binary.ps1:45`, `modes.ps1:45` | a running `snipset.exe` (for example under an MCP host) cannot be replaced or removed; raw IOException, no summary | C15b and C15c: `[FAIL] binary: in use` and the summary still prints |
| C9 | P3 | DERIVED | `modes.ps1:34-36` | the Windows branch removes a symlinked exe that answers `--version` | C15c: check `LinkType` on both branches |
| C10 | P3 | DERIVED (5.1) | `mcp.ps1:111,148` | 5.1 `ConvertTo-Json` escapes `'`; fails safe | C15c: covered by the JSON parse |
| C11 | P3 | DERIVED (5.1) | `fetch.ps1:29-30` | progress bar slows `Invoke-WebRequest` on 5.1 | C15b: `$ProgressPreference = 'SilentlyContinue'` in scriptblock scope |
| C12 | P3 | CONFIRMED (parity) | `modes.ps1:108-123` | the empty default `Snipset\bin` dir stays after uninstall; no `-Db` parameter | C15c: remove the install dir when empty; `-Db`: backlog, `defer: Windows has no database init step, upgrade-trigger: install.ps1 gains snipset init` |

Safe cases C ran: thirteen caller variables unchanged after install, `-Check`, and a failing run through the README one-liner; no `exit` anywhere and a throw is catchable; no PowerShell 6+ syntax; zip entries `../x`, `..\x`, `a/../../x`, `/abs`, `.git/config` refused; checksum mismatch throws before extraction with the old exe byte-identical; path entry functions keep `%VAR%`, forward-slash and quoted forms; OpenCode and Cursor files removed only when byte-identical; 0 em dashes and attribution lines.

### C15b (fixes C1, C4 to C8 install side, C11), owner `hoggy`

`lib.ps1`, `fetch.ps1`, `binary.ps1`, and tests in a new `tests/install-ps1-hardening.test.mjs`. `Set-StrictMode -Off` as the first statement of `lib.ps1`; read `$IsWindows` through `Get-Variable IsWindows -ValueOnly -ErrorAction SilentlyContinue`; TLS: on Desktop edition only, add TLS 1.2 with `-bor` when missing and restore the previous value in a `finally` of the mode dispatch (if that needs `main.ps1`, include it and say so); `$ProgressPreference = 'SilentlyContinue'` in scriptblock scope; resolve `-InstallDir` with `[IO.Path]::GetFullPath` against the current FileSystem location and refuse `;` and `"`; refuse a non-https `SNIPSET_RELEASE_BASE_URL` unless `-From` is set; `-LiteralPath` on `Get-Content` and `Get-FileHash`, `[IO.Directory]::CreateDirectory` for directories; on Windows, when the exe is in use, move it aside to `snipset.exe.old-<pid>` and retry, else report `[FAIL] binary: in use (close the program using it)`. Tests: strict mode in the caller (install, check, uninstall succeed); the caller's `SecurityProtocol` value is unchanged after a run; brackets in TMPDIR and `-InstallDir` work; a relative `-InstallDir` is resolved; `;` is refused; http base URL refused, `-From` with an http base URL works.

### C15c (fixes C2, C3 ps1, C8 uninstall side, C9, C10, C12), owner `chef`

`path.ps1`, `modes.ps1`, `mcp.ps1`, and their tests (`tests/install-ps1-lifecycle.test.mjs`, `tests/install-ps1-mcp.test.mjs`). PATH ownership: `Install-SnipsetPathEnv` writes `<InstallDir>\.snipset-path-added` only when it actually adds the entry; `Remove-SnipsetPathEnv` removes the entry only when that file exists and the exe was not kept, then deletes the file; an entry that was already there is `[KEEP] path: <dir> was on the user PATH before the install`. Gemini: `ConvertFrom-Json` on the settings file, ours only when `mcpServers.snipset.command -ceq $Bin`. Exe removal checks `LinkType` on both branches; an in-use exe gives `[FAIL] binary: in use` and the uninstall summary still prints. After uninstall, remove the install dir when it is empty. Tests (mocked registry like the existing ones): the C2 reproduction (dir already on PATH, uninstall keeps it), install then uninstall removes a recorded entry, the C3 reproduction (`snipset-dev` with our bin and a foreign `snipset`: nothing removed), the empty dir removed, a non-empty dir kept.

### C11c (fix C3 sh), owner `nappy`

`scripts/installer/sh/mcp.sh` and `tests/install-mcp.test.mjs`. The Gemini "ours" test reads the `"snipset"` object's own `command` value: match `"snipset"[[:space:]]*:[[:space:]]*\{[^}]*"command"[[:space:]]*:[[:space:]]*"<bin>"` (one object, no nested braces before `command`); anything else is `[KEEP]`. Test: the C3 reproduction (a `snipset-dev` entry with our bin and a `snipset` entry for another command: no remove call); the existing ours case still removes.
