## 1. Delivery Metadata

| Field | Value |
|---|---|
| Session slot | `release-bug-hunt` |
| Plan | `docs/code-plan/plans/2026-10-15-snipset-cli-release-bug-hunt.md` (issue #9) |
| Base branch | `main` |
| Head branch | `2026-10-15-snipset-cli-release-bug-hunt/release-bug-hunt` |
| Type of change | bug fix, tests, docs |
| Reviewer | two independent reviewers (standards, spec), report in `docs/code-plan/sessions/2026-10-15-snipset-cli-release-bug-hunt/review-report.md` |

## 2. What This Changes

A bug hunt against the v0.2.0 release assets found 15 defects in this repository (and 22 in the private CLI and shell bundle, which are out of scope here). This PR fixes the 13 that were approved, each with a test that fails on `main`:

- **Paths (R1 to R3):** `install.sh` makes a relative `--install-dir`, `--share-dir`, `--db`, `--bashrc`, or `--from` absolute before writing it into `.bashrc`, `.profile`, `<share>/env`, or MCP configs. Before, `--install-dir bin` put a cwd-relative `bin` on every later shell's PATH. An empty path value, or one that starts with `-` (`--db --dry-run`), is now a usage error (exit 2) before anything is written.
- **Dry run (R4):** `--dry-run --version garbage` exits 2 like the real run, and `0.2.0` is shown as `v0.2.0`.
- **`--bashrc` in a new directory (R5):** the parent directory is created and recorded; before, the install stopped after placing the binary, with no database and no shims.
- **`--db` reaches the shims (R6):** the bashrc block exports `SNIPSET_DB` when `--db` is given, so the generated shims, TAB expansion, and completion use that database. A block written by v0.2.0, or one exporting another database, is rewritten in place on reinstall and removed on uninstall.
- **Final newline (R15):** install plus uninstall leaves a startup file that had no final newline byte-identical.
- **Fetch errors (R8, R9):** a failed latest-release lookup (404, which is today's answer while v0.2.0 is a Draft, or 403) or a failed download exits 1 with an `install.sh:` message instead of curl's 22 or wget's silent 8; `install.ps1` gives `release version was not found (HTTP 404)` instead of GitHub's raw JSON.
- **`-Version V0.2.0` (R10):** refused by `install.ps1`, as `install.sh` already did.
- **MCP probes (R11, R12, both installers):** cursor, opencode, and vscode files count as registered only when their own `snipset` entry runs the installed binary (one nested object such as `env` is stepped over). The opencode file follows `XDG_CONFIG_HOME`, and a v0.2.0 file under `~/.config` is still found and removed.
- **Live wrapper (R7):** `scripts/snipset-live.sh` serves the read commands added in 0.2.0 (`journal`, `task`, `note`, `settings` reads, `support categories`, `export`) and `--version`/`help` from the snapshot instead of refusing them while the live file is locked. The drift test now walks every top-level command of the release.

**Non-goals:** R13 (`--check` comparing `--db` in MCP entries) and R14 (`--check` after `--no-init --db`) are kept as documented behaviour. Defects in the `snipset` binary and the shell bundle (writes ignoring `--db` when the control API answers, JSON export/import losing groups, `audio dictionary list` failing on app databases, and others) belong to the private Snipset repository and a new release.

## 3. Acceptance Criteria

| ID | Criterion | Task | Check | Evidence |
|---|---|---|---|---|
| AC-1 | relative, empty, and dash-led path values handled (R1 to R3) | T01 | `bun test tests/install-args-shape.test.mjs` | exit 0, 8 pass; 0 of 8 on `main` |
| AC-2 | dry run validates `--version` (R4) | T02 | `bun test tests/install-dryrun-validate.test.mjs` | exit 0, 4 pass; 1 of 4 on `main` |
| AC-3 | `--bashrc` parent, `SNIPSET_DB` export, block upgrade, final newline (R5, R6, R15) | T03 | `bun test tests/install-shell-fixes.test.mjs` | exit 0, 12 pass |
| AC-4 | PATH lines keep a missing final newline (R15) | T04 | `bun test tests/install-pathenv-eol.test.mjs` | exit 0, 2 pass; 1 of 2 on `main` |
| AC-5 | 0.2.0 reads and help bypass the write gate (R7) | T05 | `bun test tests/snipset-live-reads.test.mjs tests/snipset-live-cli-drift.test.mjs` | exit 0, 39 and 36 pass; 9 of 39 on `main` |
| AC-6 | fetch failures exit 1 with a message (R8) | T06 | `bun test tests/install-fetch-errors.test.mjs` | exit 0, 5 pass; 0 of 5 on `main` |
| AC-7 | `install.ps1` version case and lookup message (R9, R10) | T07 | `bun test tests/install-ps1-fetch-errors.test.mjs` | exit 0, 2 pass; 0 of 2 on `main` |
| AC-8 | MCP probe and opencode path (R11, R12) | T08, T10 | `bun test tests/install-mcp-probe.test.mjs tests/install-ps1-mcp-probe.test.mjs` | exit 0, 7 and 7 pass |
| AC-9 | bundles match parts, README states the behaviour | T09 | `bun scripts/installer/build.mjs --check`; `bun test tests/readme-install.test.mjs` | exit 0; 24 pass |

## 4. Local Verification Evidence

| Gate | Command | Exit | Result |
|---|---|---|---|
| Whole suite | `bun test tests/` | 0 | 702 pass, 6 skip, 0 fail, 708 tests in 49 files, 161 s |
| Real v0.2.0 assets | `SNIPSET_REAL_ASSETS=<gh release download dir> bun test tests/install-real-assets.test.mjs` | 0 | 4 pass |
| Bundles | `bun scripts/installer/build.mjs --check` | 0 | `install.sh` and `install.ps1` match their parts |
| Shell lint | `shellcheck -s bash scripts/installer/sh/*.sh scripts/snipset-live.sh` | 0 | except one SC2016 info in `pathenv.sh`, present on `main` too |

- **Before:** on `main` (8cd3341), 43 repro commands against the v0.2.0 assets exit non-zero, for example `--install-dir rbin --share-dir rshare --add-path` writes `. "rshare/env"` into `.profile`, and `install.sh` without `--version` exits 22 with only `curl: (22) The requested URL returned error: 404`.
- **After:** the repo-side repros exit 0 (the startup files hold absolute paths, a login shell started from `/` finds `snipset`; the lookup prints `install.sh: release version was not found` and exits 1). The new tests fail against bundles built from `main`'s parts and pass on this branch.
- The six skips: the four real-asset tests (run separately in the row above), the nix flake check (nix absent), and `ruby -c` on the formula (ruby absent).

## 5. Independent Review

- [x] Two reviewers that did not write the code read the diff on separate axes (standards, spec) without seeing each other's report.
- [x] The parent diff audit ran per chunk: `git diff -- <permitted paths>` read, targeted tests re-run in the parent, and the last two chunks' edits re-proved red with the fix lines removed.
- [x] Every qualifying finding is fixed in this PR with a failing-then-passing test: spec P1 (a nested `env` object made a valid entry look foreign), standards P2 (reinstall with another `--db` kept the old export), P3 (v0.2.0 opencode file orphaned under `XDG_CONFIG_HOME`), P3 (README exit code wording).

**Reviewer verdict:** `correct` after the fixes above. It would change if a supported upgrade path from a v0.2.0 install with relative paths is required to converge automatically (today it is kept as an edited block; see section 7).

## 6. Risk, Rollout, Rollback

| Concern | Answer |
|---|---|
| Blast radius | `install.sh`, `install.ps1`, and `scripts/snipset-live.sh` behaviour on fresh installs, reinstalls, `--check`, and `--uninstall`; package manifests are untouched |
| Door | two-way: reverting this PR restores the previous installers; files they write keep the same names |
| Rollout | default; `main` users get it on their next download of `install.sh`, tagged users with the next tag |
| Health signal | `install.sh --check` reports `check: CURRENT` right after an install with the same flags; the real-asset suite stays green |
| Rollback | `git revert` of the merge commit by the owner |
| Compatibility | users who installed with `--db` see one `--check` DRIFT line until they re-run the install, which upgrades the block in place; a v0.2.0 opencode file under `~/.config` keeps working with `XDG_CONFIG_HOME` set |

## 7. Pre-Existing Issues and Deferred Debt

- R13 `scripts/installer/sh/mcp.sh` `mcp_check` compares only the binary path, not `--db`. `defer: owner contract call, a user report of --check missing a --db change`
- R14 `scripts/installer/sh/db.sh` `db_check` reports MISSING after `--no-init --db`. `defer: owner contract call, a user report of drift after --no-init`
- A v0.2.0 install made with relative paths keeps its relative bashrc block after reinstall (kept as edited, nothing deleted). `defer: one user with such an install, a report of DRIFT after reinstall`
- `--dry-run --version X --from /missing` exits 0 while the real run fails. `defer: the --from existence check in tests/install-cli.test.mjs is reworked, the next dry-run change`
- `scripts/installer/sh/modes.sh` dry run always prints `[DRY] shell block: add to`, even when the block exists. `defer: next dry-run change, a user report`
- `scripts/installer/sh/pathenv.sh` SC2016 info on the awk program, present on `main`. `defer: next pathenv.sh edit, a shellcheck gate in CI`
- 22 defects in the `snipset` binary and shell bundle (three P1: writes ignore `--db` when the control API answers; JSON export/import drops group and settings; `audio dictionary list` fails on app databases). `defer: separate Snipset session, the next CLI release`

## 8. Checklist

- [x] Branch and worktree came from `pr-registry claim`.
- [x] Nothing was committed directly to the base branch.
- [x] Title is imperative and the body is in English, the codebase's language.
- [x] No em dash in this body, the commit messages, or any user-visible string in the diff (`check-copy-rules.mjs --diff origin/main` exit 0).
- [x] No attribution footer, watermark, badge, or co-author line.
- [x] No secrets, tokens, `.env` content, or unrelated cleanup in the diff.
- [x] Every acceptance criterion maps to a check and to evidence.
- [x] PR body written to a file and posted with `--body-file`.
