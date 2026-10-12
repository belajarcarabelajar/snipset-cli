## 1. Delivery Metadata

| Field | Value |
|---|---|
| Session slot | `install-coverage` |
| Plan | `docs/code-plan/plans/2026-10-12-snipset-cli-install-coverage.md` (issue #5) |
| Base branch | `main` |
| Head branch | `2026-10-12-snipset-cli-install-coverage/install-coverage` |
| Type of change | feature, bug fix, test, docs |
| Reviewer | seven independent reviewer agents (`staid`) in three waves; owner review requested |

## 2. What This Changes

Both installers gain a full lifecycle and safer defaults, and the repository gains five package channels. `install.sh` and `install.ps1` are now generated from per-feature parts (`scripts/installer/`, checked for drift), so users still download one file. On Linux: `--check`, `--update`, `--uninstall`, and `--dry-run`; refusal of macOS, ARM, musl, and glibc below 2.34 before any download; the new binary is test-run before it replaces the old one; `wget`, `shasum`, and `openssl` fallbacks; offline installs with `--from DIR`; PATH for bash, zsh, and fish; MCP registration for Claude Code, Codex, Gemini CLI, OpenCode, Cursor, and VS Code that never overwrites an entry; uninstall removes only what the installer wrote and never the database. On Windows: the same modes, an architecture guard, `-From`, a raw-value User Path edit that keeps `%VAR%` entries, and safe behaviour inside the caller's session. Packaging: a Scoop bucket, winget 1.12 manifests, an AUR package, a Homebrew formula, and a Nix flake, all rendered from `packaging/SHA256SUMS`. The README now carries an install matrix where every row says verified with its evidence or not verified with its reason.

**Non-goals:** CI workflow changes (labels only); macOS or ARM builds; publishing the release or submitting to winget, the AUR, or a tap; code signing; a Docker image (the EULA forbids redistribution).

## 3. Acceptance Criteria

| ID | Criterion | Check | Evidence |
|---|---|---|---|
| AC-1 | `--dry-run` writes nothing | `tests/install-lifecycle.test.mjs` | 25 flag combinations, HOME snapshot identical |
| AC-2 | `--check` is read-only and names each drift | lifecycle, binary, shell, shims, pathenv suites | read-only HOME and four positive controls pass |
| AC-3 | `--uninstall` removes only installer-made items, never the database | lifecycle, binary, shell, shims, pathenv, mcp suites | full cycle restores seeded files byte for byte; second run `removed 0` |
| AC-4 | `--update` skips the download when current | lifecycle suite | no archive in the download log |
| AC-5 | unsupported platforms refused before download | `tests/install-platform.test.mjs` | 11 pass; download log empty on every refusal |
| AC-6 | a binary that cannot start leaves the old one | `tests/install-binary.test.mjs` | old binary byte-identical; loader error and `ldd` lines printed |
| AC-7 | `wget` and `shasum`/`openssl` fallbacks | `tests/install-fetch.test.mjs` | 12 pass |
| AC-8 | `--from DIR` with no downloader | same | pass |
| AC-9 | zsh and fish PATH, idempotent, exact removal | `tests/install-pathenv.test.mjs` | pass, including a user's own fish and env files kept |
| AC-10 | MCP for six harnesses, never overwrites | `tests/install-mcp.test.mjs`, `tests/install-ps1-mcp.test.mjs` | pass, including scope-safe Claude and Gemini removal |
| AC-11 | `install.ps1` lifecycle under pwsh 7.6.6 | five `tests/install-ps1-*.test.mjs` suites plus place and hardening | 95 pass at `cb41743`; registry and Windows itself not verified |
| AC-12 | bundles equal their parts | `tests/installer-build.test.mjs` | pass; `build.mjs --check` exit 0 |
| AC-13 | manifests correct and drift-checked | six `tests/packaging-*.test.mjs` suites | 107 pass; makepkg builds the package and `.SRCINFO` matches |
| AC-14 | real v0.2.0 assets install | `SNIPSET_REAL_ASSETS=<dir> bun test tests/install-real-assets.test.mjs` | 4 pass: install.sh full cycle, install.ps1 byte-identical exe, makepkg package runs |
| AC-15 | README matrix with evidence per row | `tests/readme-install.test.mjs` | 16 pass |
| AC-16 | full local verification | section 4 | every command exit 0 |

## 4. Local Verification Evidence

Every row ran at `2e4801a` on the machine holding the working tree, before the branch was pushed. PowerShell ran with `POWERSHELL_TELEMETRY_OPTOUT=1`.

| Gate | Command | Exit | Result |
|---|---|---|---|
| Full suite | `bun test --timeout 60000 tests/` | 0 | 511 pass, 6 skip, 0 fail |
| Without `snipset` and `pwsh` | `env PATH="$HOME/.bun/bin:/usr/bin:/bin" bun test --timeout 60000 tests/` | 0 | 380 pass, 137 skip, 0 fail |
| Real assets | `SNIPSET_REAL_ASSETS=<gh release download dir> bun test tests/install-real-assets.test.mjs` | 0 | 4 pass |
| Bundle drift | `bun scripts/installer/build.mjs --check` | 0 | clean |
| Manifest drift | `bun scripts/packaging/render.mjs --check` | 0 | clean |
| Shell lint | `shellcheck -S warning install.sh scripts/snipset-live.sh`, every part, the PKGBUILD | 0 | 0 warnings |
| Shell syntax | `bash -n install.sh` | 0 | clean |
| PowerShell contract | `pwsh -NoProfile -File tests/install.Tests.ps1` | 0 | contract passed |
| Plan runner | `ultra-plan-runner.mjs <plan> --execute` | 0 | T01 to T24 SKIPPED-IDEMPOTENT by their own suites, T25 PASSED, empty error ledger |
| Copy rules | em dash scan of 96 changed files, attribution scan of 55 commit messages | 0 | 0 hits |

The six skips: four real-asset tests (opt-in), `nix flake check` (needs nix and network), `ruby -c` (ruby absent). Every task started from a failing test (RED recorded in the plan checklist).

## 5. Independent Review

- [x] Three review waves by seven reviewers that did not write the code. Reports: `docs/code-plan/sessions/2026-10-12-snipset-cli-install-coverage/review-wave-1.md`, `review-wave-2.md`, `review-wave-3.md`.
- [x] Parent diff audit for every chunk: diff read by path, tests rerun against a bundle built from committed parts plus that chunk only, commits staged by explicit path.
- [x] Every P0 and P1 is fixed with a regression test: a failed `mktemp` emptying `.profile` and `.bashrc` on uninstall (`d09d57f`), `--uninstall --dry-run` deleting for real (`d46cc10`), Claude removal ignoring scope (`bb4ead7`), a user's own fish file overwritten then deleted (`f8441a6`). Every P2 is fixed or listed in section 7.

**Reviewer verdict:** `correct` on the final state: no open P0 or P1. It changes to `not correct` if any uninstall path removes or rewrites a file the installer did not write, or if `bun test tests/` goes red on either PATH mode.

## 6. Risk, Rollout, Rollback

| Concern | Answer |
|---|---|
| Blast radius | Everyone who runs either installer. New refusals: unsupported platforms, bash below 4.4, a non-https base URL, a foreign or linked binary at the install path. `--add-path` now writes `<share-dir>/env` files and lines for zsh and fish. |
| Rollout | Default. After this merges, publish the v0.2.0 Draft so its tag is cut from a `main` that holds these installers (the README's pinned URLs depend on it). |
| Health signal | `install.sh --check` with the install's flags prints `check: CURRENT`; `tests/install-real-assets.test.mjs` against the published assets. |
| Rollback | `git revert -m 1 <merge commit>`; an install made by the new installer can be removed first with its own `--uninstall`. |
| Compatibility | Old installs are recognised: the bashrc block is unchanged, the old `export PATH=` line is kept with a hint, a bare `--with-mcp` still means OpenCode only, and existing flags keep their meaning. |

## 7. Pre-Existing Issues and Deferred Debt

- `scripts/installer/sh/shell.sh:8` overwrites a user's own file in a custom `--share-dir` (pre-existing on `main`). `defer: keep a differing share file, the release bundle files carry a recognisable header`.
- Empty directories the install created can remain after uninstall (documented). `defer: remove them when empty, a user report`.
- Windows itself, Windows PowerShell 5.1, Scoop, winget, Homebrew, Nix, mise, eget, ubi, and non-Arch distros were not run (no host or tool). `defer: labelled not verified, a run on that host`.
- The output formats of `codex`, `gemini`, and VS Code were read from vendor docs and source, not observed; Gemini `--db` forwarding without `--` is unverified. `defer: CLIs absent, a host with those CLIs`.
- `install.ps1` does not accept the `*` marker in `SHA256SUMS` (the release does not use it) and has no `-Db`. `defer: parity gap, a release that writes the marker or a Windows database init step`.
- The archive entry check does not refuse a member named exactly `..` or hard-link members. `defer: GNU tar refuses escapes on extract, a hostile archive reaching a user`.
- The MCP stdin redirect has no test (the helper always gives stdin `ignore`); the 14 legacy Linux tests pass the full `process.env`; `tests/install-ps1-mcp.test.mjs` (503 lines) duplicates stubs from the Linux suite. `defer: test-only debt, the next change to those suites`.
- The ps1 suites assert pwsh 7.6 output and `ruby -c` has never run; both run on the CI runner for the first time. `defer: CI is the author's evidence here, the first CI run on this PR`.
- In the private Snipset repository (not changed here): `scripts/distribution/aur/PKGBUILD` declares `MIT` with empty checksums, `distribution/snipset-cli/` is a stale copy of these installers, `stage-public-cli.mjs` allows only six files, and `package-cli.mjs` could also emit per-asset `.sha256` files for eget. `defer: other repository, the next distribution session there`.

## 8. Checklist

- [x] Branch and worktree came from `pr-registry claim`.
- [x] Nothing was committed directly to the base branch.
- [x] Imperative title; body in English like the rest of the repository.
- [x] No em dash in this body, the commit messages, or the diff (scans: 0).
- [x] No attribution footer or co-author line in the body or the commits (scan: 0).
- [x] No secrets or unrelated cleanup in the diff; every changed file traces to a plan task or a review fix.
- [x] Every acceptance criterion maps to a check and evidence.
- [x] PR body posted from a file.
