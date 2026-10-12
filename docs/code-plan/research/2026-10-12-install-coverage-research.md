# Research for plan 2026-10-12-snipset-cli-install-coverage

Gathered 2026-10-12 by read-only researcher subagents (TinyFish `search` then `fetch_content`), deduplicated and checked by the parent. Every fact names its source and the fetch date. Lines marked "inference" were reasoned, not read. Parent-measured facts are marked "measured".

## Local facts (measured by the parent, 2026-10-12)

| Fact | Evidence |
|---|---|
| The only release is `v0.2.0` and it is a **Draft** | `gh release list -R belajarcarabelajar/snipset-cli` prints `Draft`; `gh release view` with no tag prints `release not found` while authenticated as the owner |
| Draft assets: `SHA256SUMS` (229 B), `snipset-cli-v0.2.0-x86_64-unknown-linux-gnu.tar.gz` (2621377 B), `snipset-cli-v0.2.0-x86_64-pc-windows-msvc.zip` (2133945 B) | `gh release view v0.2.0 --json assets`; `sha256sum -c SHA256SUMS` OK for both after `gh release download` |
| Linux tarball entries: `snipset`, `LICENSE`, `shell/snipset.sh`, `shell/completion.bash`, `shell/tab.sh`, `shell/snipset-shims.sh`; no symlinks | `tar -tzvf` |
| Windows zip entries: `snipset.exe`, `LICENSE`. README line 99 says "holds `snipset.exe` only", which is stale | `unzip -l` |
| The Linux binary is a glibc PIE, needs `GLIBC_2.34` at most, and links `libcrypto.so.3`, `libz`, `libbrotli*`, `libzstd` dynamically | `file`, `ldd`, `objdump -T` on `~/.local/bin/snipset` (0.2.0) |
| `LICENSE` is a paid EULA by PT BCB Academy Indonesia; section 2 forbids selling, renting, lending, or distributing the software to any third party | `LICENSE` sections 1 and 2 |
| Generated trigger shims carry the header `# snipset-shim for '<kw>' (... managed by snipset-shims; do not edit).` and are listed one per line in `<dir>/.snipset-shims` | private `Snipset/scripts/distribution/shims/snipset-shims.sh` lines 46-47, 90, 99, 113 |
| The private repo's staging copy `Snipset/distribution/snipset-cli/` is stale: 5 of 6 files differ from this repo (only `LICENSE` matches); last touched 2026-09-26 | `cmp` per file; `git log -- distribution/snipset-cli` |
| The private AUR draft `Snipset/scripts/distribution/aur/PKGBUILD` declares `license=('MIT')`, an empty `sha256sums`, and installs only the binary and LICENSE; its test asserts `MIT` | `cat PKGBUILD`; `aur.test.mjs` |
| Private `cli-distribution.yml` builds and uploads workflow artifacts only; it creates no release | `.github/workflows/cli-distribution.yml` |
| Machine tools: `pwsh` 7.6.6 (user-local), `shellcheck`, `makepkg`, `jq`, `gh`, `bun` 1.4.3 present; `docker`, `podman`, `brew`, `scoop`, `winget`, `nix`, `mise`, `aqua`, `eget`, `ubi`, `namcap`, `actionlint` absent | `command -v` per tool |

## Scoop (fetched 2026-10-12)

- Any git repo can be a bucket: `scoop bucket add snipset https://github.com/belajarcarabelajar/snipset-cli`, then `scoop install snipset/snipset`. `Find-BucketDirectory` uses `<clone>/bucket` when that folder exists, otherwise the repo root, and `manifest_path` searches it recursively for `<app>.json`. Source: `ScoopInstaller/Scoop` `lib/buckets.ps1`, `lib/manifest.ps1` (master); wiki "Buckets".
- Inference: without a `bucket/` folder, the tracked root files `package.json` and `opencode.json` would be offered as apps, so the manifest goes in `bucket/snipset.json`.
- `schema.json` (draft-07, `additionalProperties: false`) requires `version`, `homepage`, `license`; `description` is expected for every new manifest. Source: `schema.json` (master); wiki "App Manifests".
- `checkver: "github"` reads `<homepage>/releases/latest` and skips pre-releases, so `homepage` must be the repo URL. `autoupdate.hash: {"url": "$baseurl/SHA256SUMS"}` is enough: the default regex matches a `<hex>  <filename>` line. Source: wiki "App Manifest Autoupdate"; `lib/autoupdate.ps1`.
- The official validator is a .NET Framework 4.5 DLL run by Pester tests whose CI is Windows only. Inference: a draft-07 validator over `schema.json` is the offline check here.
- arm64 falls back to the `64bit` entry only on Windows 11 (build 22000+) and only when the manifest never mentions `arm64`. Source: `lib/manifest.ps1` `Get-SupportedArchitecture`.
- Uninstall removes shims, shortcuts, the `current` junction, and version folders, and touches PATH only for `env_add_path` entries. Source: `libexec/scoop-uninstall.ps1`, `lib/install.ps1`.

## AUR (fetched 2026-10-12)

- Name `snipset-cli`, **not** `snipset-cli-bin`: the nonfree guideline says the `-bin` suffix should not be used when sources are not available. Source: wiki "Nonfree applications package guidelines"; "AUR submission guidelines". No AUR package named `snipset` exists (AUR RPC v5 search, 0 results).
- Custom license identifier: `LicenseRef-<name>` or `custom:<name>`, text installed to `/usr/share/licenses/$pkgname`. Source: wiki "PKGBUILD"; Arch RFC 0016.
- Bash completion file for command `snipset` is `/usr/share/bash-completion/completions/snipset.bash`; the unsuffixed name is deprecated from bash-completion 2.18 (2.18.0-1 installed here). Source: `scop/bash-completion` README.
- `options=('!strip' '!debug')` for a vendor binary is inference (no primary source requires it).
- `.SRCINFO` comes from `makepkg --printsrcinfo`, which runs before any download (read in `/usr/bin/makepkg`, not run). The AUR refuses a push whose last commit lacks `.SRCINFO`. Source: wiki ".SRCINFO".
- Closed source is permitted in the AUR "as long as you are in compliance with the licensing terms". Source: wiki "Arch User Repository" FAQ. Inference: a PKGBUILD that downloads from the publisher's own release does not redistribute; the EULA wording is the publisher's call.
- Draft release assets are listed only to users with push access, so an anonymous `makepkg` cannot fetch them. Source: docs.github.com REST "Releases" and "Release assets".

## Homebrew (fetched 2026-10-12)

- homebrew-core is out: a formula there must be open source under a DFSG-compatible licence, and "proprietary or platform-specific binary-only software belongs in a cask". Source: docs.brew.sh "Acceptable Formulae". Third-party taps are "unsupported by default" and no rule found bans a binary formula in one (inference). Source: docs.brew.sh "Support Tiers".
- Taps: the one-argument `brew tap user/x` maps to `github.com/user/homebrew-x`; the two-argument `brew tap <user>/<name> <URL>` accepts any Git URL. Formulae are read from `Formula/`, `HomebrewFormula/`, or the root (first that exists). Non-official taps need `brew trust`. Source: docs.brew.sh "Taps", "How to Create and Maintain a Tap".
- Inference: a `Formula/` folder in this repo works only through the explicit-URL tap and clones the whole repo; a separate `belajarcarabelajar/homebrew-tap` repo allows `brew install belajarcarabelajar/tap/snipset`.
- `depends_on :linux` marks a formula (and now a cask) Linux-only; `bash_completion` resolves to `#{prefix}/etc/bash_completion.d`; `test do` runs in a temp `testpath`. Source: docs.brew.sh "Formula Cookbook", "Cask Cookbook".
- Homebrew on Linux Tier 1 covers ARM64 and x86_64 (glibc 2.39+); our x86_64-only asset leaves arm64 users with a clear refusal to write. Source: docs.brew.sh "Support Tiers".
- `livecheck` with `strategy :github_latest` fits a release-asset formula. Source: docs.brew.sh "Brew Livecheck".
- No offline check exists here: `brew`, `ruby`, and `rubocop` are absent (measured). `brew style` and `brew audit` need `Homebrew/actions/setup-homebrew` (ubuntu or macos runners) or brew on `vps-bcb`.

## winget (fetched 2026-10-12)

- Target schema 1.12.0 (1.10.0 also accepted; 1.28.0 is the newest documented). The community repo accepts multi-file manifests only, each file with a `# yaml-language-server: $schema=...` header; folder and file names must match the identifier and version exactly. Source: `microsoft/winget-pkgs` `doc/manifest/README.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `doc/ValidationFailureGuide.md`; `microsoft/winget-create` releases (v1.12.13.0 writes 1.12).
- Required fields: version file (PackageIdentifier, PackageVersion, DefaultLocale, ManifestType, ManifestVersion); defaultLocale file (adds PackageLocale, Publisher, PackageName, License, ShortDescription 3 to 256 chars); installer file (Installers with Architecture, InstallerType, InstallerUrl, InstallerSha256). Source: winget-pkgs `doc/manifest/schema/1.28.0/*.md`.
- Installer shape for our zip: `InstallerType: zip`, `NestedInstallerType: portable`, `NestedInstallerFiles: [{RelativeFilePath: snipset.exe, PortableCommandAlias: snipset}]` (alias at most 40 chars), `Architecture: x64`, 64-hex `InstallerSha256`; `ReleaseDate`, `UpgradeBehavior` optional. A merged example with this exact shape: `manifests/o/OpenCLICollective/cfl/1.0.24/`. Source: winget-cli `schemas/JSON/manifests/v1.12.0/manifest.installer.1.12.0.json`; winget-pkgs installer schema doc.
- Submission: one package version per PR under `manifests/<letter>/<Publisher>/<Package>/<version>/`, CLA required; the pipeline downloads the installer (publicly reachable URL, HTTPS, publisher's own location), checks SHA256, runs antivirus scans, installs non-elevated. No signing requirement found; a `Portable-Archive` label can block a PR. Source: learn.microsoft.com "Windows Package Manager policies", "Submit packages"; winget-pkgs `doc/Validation.md`, `CONTRIBUTING.md`.
- Offline on Linux: the draft-07 JSON schemas validate YAML converted to JSON, but they do not encode "zip needs NestedInstallerType", the path/name match, or the header; `winget validate` runs on Windows only (inference from client requirements). Local install for testing: `winget settings --enable LocalManifestFiles` (admin), then `winget install --manifest <dir>`. Source: winget-cli schemas README; learn.microsoft.com `winget install`.

## Zero-manifest channels: mise, ubi, eget, aqua, Nix (fetched 2026-10-12)

- Draft releases block all of them. Measured live by the researcher, unauthenticated: `/repos/belajarcarabelajar/snipset-cli/releases/latest` returned 404 and `/releases` returned `[]`. GitHub: "latest" is the newest published non-prerelease; drafts are listed only for users with push access. Source: docs.github.com REST "Releases". mise: "Draft releases are never listed".
- mise: use the `github:` backend; `ubi:` is deprecated since mise 2026.4.0 and removed in 2027.1.0. Command `mise use -g github:belajarcarabelajar/snipset-cli@0.2.0`. Asset choice scores OS, arch, and libc and skips checksum files; verification uses GitHub's per-asset `digest` (or a checksum file, names not documented). Source: mise.jdx.dev "github backend", "ubi backend" (pages dated 2026-10-08).
- ubi: needs `--exe snipset` because the binary name differs from the repo name; no checksum verification documented. Source: `houseabsolute/ubi` README, `src/github.rs`.
- eget: OS and arch regexes match our two names; automatic checksum only for a sibling `<asset>.sha256`, not a combined `SHA256SUMS`; `--verify-sha256=<hex>` checks by hand; use `-f snipset`. Source: `zyedidia/eget` README, DOCS.md, `detect.go`, `find.go`.
- aqua: requires a registry entry (standard registry PR, or a `local`/`github_content` registry allowed by `aqua policy`); checksum via a `checksum: {type: github_release, asset: SHA256SUMS, ...}` block, off by default. Source: aquaproj.github.io config, registry-config checksum, v2 upgrade guide.
- Nix: `stdenv.mkDerivation` with `fetchurl`, `autoPatchelfHook`, `installShellFiles`, `sourceRoot = "."` (the tarball's only directory is `shell/`, so unpack would otherwise enter it; inference from the stdenv doc), `meta.sourceProvenance = [ binaryNativeCode ]`. Source: nixpkgs `doc/hooks/autopatchelf.section.md`, `installShellFiles.section.md`, `doc/stdenv/stdenv.chapter.md`. Not evaluable here (nix absent).
- Inference: publishing a per-asset `<asset>.sha256` beside `SHA256SUMS` turns on eget's automatic check; that change belongs to the private release packaging (`package-cli.mjs`).

## Multi-shell PATH (fetched 2026-10-12)

- uv (cargo-dist installer): writes `~/.local/bin/env` and `env.fish`, sources the env file from `~/.profile` (always), existing bash rc files, and one zsh file (`.zshrc` or `.zshenv`), and always writes `~/.config/fish/conf.d/uv.env.fish`; guards with `grep -F` and skips when the dir is already on PATH. Its documented uninstall removes only binaries. Source: `astral.sh/uv/install.sh`; docs.astral.sh installation page.
- rustup: env files `~/.cargo/env` and `env.fish`; `~/.profile` always, existing bash files, exactly one `$ZDOTDIR/.zshenv` when zsh is `$SHELL` or on PATH, fish `conf.d/rustup.fish` when fish is `$SHELL` or on PATH; uninstall removes the exact line from every candidate file. Source: rustup `src/cli/self_update/shell.rs`, `unix.rs`, `env.sh`, `env.fish` (master).
- bun: one shell from `basename $SHELL`, appends to `config.fish`, `.zshrc`, or a bash file; no grep guard; uninstall leaves rc lines. Source: `bun.sh/install`; bun.com installation docs.
- zsh never reads `~/.profile` except in sh/ksh emulation; every zsh reads `$ZDOTDIR/.zshenv`, login shells `.zprofile`, interactive `.zshrc`. Source: zsh manual 5.9 "Files", "Invocation".
- fish runs `~/.config/fish/conf.d/*.fish` at every start, before `config.fish`; `fish_add_path` defaults to a universal variable that persists without a file (inference: it would outlive an uninstall). Source: fishshell.com docs 4.8.1 "Configuration files", `fish_add_path`.
- Windows: `[Environment]::SetEnvironmentVariable(..., 'User')` sends `WM_SETTINGCHANGE`; new processes from Explorer and new Windows Terminal tabs get the new value. uv and bun read the registry value with `DoNotExpandEnvironmentNames` and write `ExpandString`, because `GetEnvironmentVariable` expands `%VAR%` entries (inference backed by bun's source comment); bun's uninstaller drops the exact entry. Source: learn.microsoft.com `Environment.SetEnvironmentVariable`, Windows Terminal command-line arguments; `astral.sh/uv/install.ps1`; `bun.sh/install.ps1`; bun `src/runtime/cli/uninstall.ps1`.
- Implication: `install.sh:113-116` writes `~/.profile` only and `install.sh:125-134` writes `~/.bashrc` only, so zsh and fish users get no PATH. `install.ps1:49-50` reads the expanded User Path, which can rewrite `%VAR%` entries as literal paths (inference).

## Windows edge cases (fetched 2026-10-12)

- Windows 11 on Arm emulates x86 and x64 (Prism since 24H2); Windows 10 on Arm emulates x86 only. Source: learn.microsoft.com "How emulation works on Arm" (dated 2025-11-06).
- `PROCESSOR_ARCHITECTURE` is `AMD64`/`ARM64` in a 64-bit process; a 32-bit process sees `x86` with the real value in `PROCESSOR_ARCHITEW6432`. Source: learn.microsoft.com "WOW64 implementation details". `RuntimeInformation.OSArchitecture` returned X64 inside emulated processes before .NET 7. Source: learn.microsoft.com ".NET 7 breaking change: OSArchitecture". Inference: an x64 shell proves x64 emulation exists; an ARM64 or x86 shell on Windows 10 on Arm cannot run the build, so the installer refuses there.
- `Invoke-WebRequest` "may not" mark downloads with Mark of the Web; a third-party comparison shows PowerShell 7.6.4 `Expand-Archive` does not propagate it. `Unblock-File` is a no-op on an unblocked file. Sources: about_Execution_Policies (dated 2026-08-31); `nmantani/archiver-MOTW-support-comparison` (table 2026-08-02); `Unblock-File` docs.
- Smart App Control blocks unsigned executables without reputation regardless of origin, and `Unblock-File` does not help. Source: learn.microsoft.com "SmartScreen reputation" (2026-05-06), "Smart App Control overview". This is a documentation item (unsigned binary), not an installer fix.
- `windows-latest` is Windows Server 2025 (image 20260925.250.1) with PowerShell 7.6.6 and Pester 3.4.0 plus 5.9.0; Windows PowerShell 5.1 ships with Windows and is `shell: powershell` in workflows. Sources: `actions/runner-images` README and `Windows2025-VS2026-Readme.md`; learn.microsoft.com "What is Windows PowerShell"; docs.github.com workflow syntax.
- Execution policy does not apply to `irm | iex` or to `& ([scriptblock]::Create((irm <url>)))`, since neither loads a `.ps1` file (inference from about_Execution_Policies); only the scriptblock form binds `param()`, so it is the one that accepts `-Version`. Source: about_Script_Blocks, `Invoke-Expression` docs.
- `releases/latest` is the newest published non-prerelease, non-draft release; get-by-tag returns only published releases; `/releases/latest/download/<asset>` links to the latest asset. Source: docs.github.com REST "Releases", "Linking to releases".

## MCP registration per harness (read 2026-10-12; no add command was run, so overwrite behaviour comes from docs and source, not measurement)

| Harness | User config (Linux) | Add command | Existing name | Remove | Source |
|---|---|---|---|---|---|
| Claude Code 2.1.296 | `~/.claude.json` `mcpServers` | `claude mcp add --scope user snipset -- snipset mcp` | fails: already exists | `claude mcp remove --scope user snipset` | code.claude.com docs "mcp"; local `--help` |
| Codex CLI | `~/.codex/config.toml` `[mcp_servers.snipset]` | `codex mcp add snipset -- snipset mcp` | silently replaced | `codex mcp remove snipset` (exit 0 when absent) | learn.chatgpt.com MCP docs; `openai/codex` `codex-rs/cli/src/mcp_cmd.rs` |
| Gemini CLI | `~/.gemini/settings.json` `mcpServers` | `gemini mcp add --scope user snipset snipset mcp` | overwritten | `gemini mcp remove --scope user snipset` | geminicli.com MCP docs (2026-10-06); `packages/cli/src/commands/mcp/add.ts` |
| OpenCode v2.0.24 | `~/.config/opencode/opencode.json(c)`; V2 native shape `mcp.servers.snipset`, V1 `mcp.snipset` still read | `opencode mcp add --global snipset -- snipset mcp` | not established | none (edit the file) | opencode.ai v2 docs "mcp-servers", "migrate-v1"; local `--help` |
| Cursor | `~/.cursor/mcp.json` `mcpServers` (`type` required) | none | n/a | none | cursor.com docs "mcp", "cli/mcp" |
| VS Code (Copilot) | `~/.config/Code/User/mcp.json` `servers` (deprecated in favour of `~/.copilot/mcp-config.json`) | `code --add-mcp '<json>'` | silently overwritten | none | code.visualstudio.com MCP docs (2026-10-07); `mcpManagementCli.ts` |

- Implication: a "never overwrite" promise needs a presence check before every `add` (`claude mcp get`, `codex mcp get`, `gemini mcp list`, `opencode mcp list`), a file-absent-only write where no CLI exists, and no hand edit of `~/.claude.json` or of existing JSONC. Each harness reports added, skipped (exists), or not found.
- The harness flagged the report's JSON examples as instruction-shaped text; they are configuration samples only and nothing in them was followed.

## Release tag (measured 2026-10-12)

- `git ls-remote --tags origin` lists no tag; the draft's `target_commitish` is `main`. Publishing the draft after this plan's PR merges creates `v0.2.0` at a `main` that already holds the new installers, so a tag-pinned installer URL serves them.

## Not read

Scoop `lib/core.ps1`, the validator DLL directory, and `ScoopInstaller/Install`; aurweb `update.py` (bot wall) and the local `PKGBUILD(5)` man page (not installed); Homebrew "Tap Trust", test-bot `--only-tap-syntax`, the `depends_on arch:` rubydoc, cask `binary` stanza; mise asset-matching source, ubi OS/CPU regex source, nixpkgs `setup.sh`; `rustup-init.sh` and the cargo-dist template (generated installers read instead); the `OSArchitecture` "Applies to" table, `IsWow64Process2` and `GetMachineTypeAttributes` pages, any primary source on SmartScreen for terminal launches; the Gemini configuration reference (Windows path inferred), OpenCode `mcp add` source (duplicate-name behaviour unknown); the winget `LocalManifestFiles` settings entry and Komac.
