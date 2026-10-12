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

Pending.
