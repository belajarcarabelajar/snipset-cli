# Session-Close Debt Sweep: snipset-cli install coverage

- **Session:** `install-coverage`, PR #6 (open, `MERGEABLE`), issue #5
- **Preconditions:** plan tasks T01 to T25 and every review fix checked with evidence; T25 green at `2e4801a`; runner `--execute` exit 0; CI on the PR (author's evidence, not verification) green on both runs: `test` and `shellcheck` pass.

## 1. Candidates

| # | Source | Candidate (outcome, file, finish line) | Class |
|---|---|---|---|
| N1 | C06b report | `binary.sh` refuses an archive member named exactly `..` or ending in `/..`, and hard-link members; finish: new cases in `tests/install-archive.test.mjs` red on HEAD, green after | NOW |
| N2 | reviewer F note | `db.sh` stops relaying the CLI's `schema mismatch ... pass --force` on a reinstall over an existing database and prints only the installer's note; finish: a reinstall case in `tests/install-shell.test.mjs` asserts the stderr | NOW |
| N3 | C14 report | `install.ps1` accepts the `*` binary-mode marker in `SHA256SUMS` like `install.sh`; finish: a `-From` case with the marker in `tests/install-ps1-platform.test.mjs` | NOW |
| N4 | reviewer G (G2) | shared MCP stubs and pwsh helpers move into `tests/helpers/`, bringing `tests/install-ps1-mcp.test.mjs` under 500 lines with the same test names and counts | NOW |
| N5 | sweep re-check | a test pins `shims.sh:38` (a symlink at a listed shim name is kept by uninstall); finish: new case in `tests/install-shims.test.mjs` | NOW |
| L1 | reviewer F (F4) | a user's own file in a custom `--share-dir` is overwritten (pre-existing) | LATER |
| L2 | reviewer F (F5) | empty directories the install created remain (documented) | LATER |
| L3 | reviewer B (B8) | the MCP stdin redirect has no test | LATER |
| L4 | reviewer B (B10) | the 14 legacy Linux tests pass the full `process.env` | LATER |
| L5 | reviewer D (D5) | the Homebrew formula has no `depends_on "openssl@3"` | LATER |
| L6 | reviewer G (G4) | the plan (about 103 KB) is over the issue-body budget | LATER |
| L7 | reviewer C (C12) | `install.ps1` has no `-Db` | LATER |
| L8 | C11 report | Gemini `--db` forwarding without `--` is unverified; Codex, Gemini, VS Code output formats unobserved | LATER |
| L9 | plan labels | Windows, Windows PowerShell 5.1, Scoop, winget, Homebrew, Nix, mise, eget, ubi, non-Arch distros not run | LATER |
| L10 | C15b report | `snipset.exe.old-<pid>` files from an in-use update are never cleaned | LATER |
| L11 | reviewer D (D6) | vivera `check-copy-rules.mjs` scans vivera when run from another repository | LATER |
| L12 | plan impacts | private Snipset repo: AUR draft says `MIT` with empty sums, stale `distribution/snipset-cli/`, six-file `stage-public-cli` allowlist, no per-asset `.sha256` | LATER |
| L13 | T22 | no `flake.lock` (nix absent) | LATER |
| G1 | reviewer G | CI might go red on pwsh or ruby | closed: CI green on both runs |

## 2. Ranking (leftover risk x blast radius x cheapness)

1. N1: a hostile archive is the installer's main trust boundary; one part file and one test file.
2. N2: every reinstall prints an alarming message for a healthy database; one part, one test.
3. N4: maintainability of the largest test file; test-only, no behaviour change.
4. N5: guards an existing safety rule with a test; one test.
5. N3: parity only; the release does not write the marker today.

## 3. Deferred Backlog

- L1 `defer: keep a differing share file in a custom --share-dir, upgrade-trigger: the release bundle files carry a recognisable header`
- L2 `defer: remove directories the install created when empty, upgrade-trigger: a user report of leftover directories`
- L3 `defer: a bash -s pipe test with a stdin-counting stub, upgrade-trigger: a report of curl | bash hanging on a harness CLI`
- L4 `defer: the 14 legacy tests keep process.env, upgrade-trigger: an installer path that reaches a real harness CLI or wget from those tests`
- L5 `defer: Homebrew dependency on openssl@3, upgrade-trigger: a brew run on Linux shows the binary failing to load libcrypto.so.3`
- L6 `defer: move section 0 evidence prose into session files, upgrade-trigger: the next plan of this size`
- L7 `defer: Windows has no database init step, upgrade-trigger: install.ps1 gains snipset init`
- L8 `defer: CLIs absent here, upgrade-trigger: a host with codex, gemini, and code`
- L9 `defer: labelled not verified in README, upgrade-trigger: a run on that host or tool`
- L10 `defer: Windows-only cleanup, upgrade-trigger: the first Windows run`
- L11 `defer: other repository, upgrade-trigger: the next vivera session touching check-copy-rules`
- L12 `defer: other repository, upgrade-trigger: the next distribution session in Snipset`
- L13 `defer: nix absent, upgrade-trigger: nix on vps-bcb`

## 4. Question and Execution Record

**Question (2026-10-12, one call, two multi-select groups):** Code: N1, N2, N3; Tests: N4, N5, `Nothing, close session`. **Owner selected:** all five (N1 to N5).

| Item | Plan task | Commit | Evidence |
|---|---|---|---|
| N5 | F05 | `d0903a8` | `tests/install-shims.test.mjs` 10 pass; mutation of `shims.sh:38` turns the new test red (`ENOENT lstat .../,k1`) |
| N2 | F02 | `e36fe8a` | RED 2 fail on HEAD; GREEN on HEAD plus `db.sh`; the real v0.2.0 binary prints `schema mismatch: database already exists: ...; pass --force ...` on a second `init`, and two `install.sh --from` runs over that database print only the installer's note |
| N1 | F01 | `cbafc75` | RED 4 fail on HEAD; GREEN 63 pass; each guard removed alone reddens only its own test; the real v0.2.0 archive holds six regular files and still installs (4 pass) |
| N3 | F03 | `84620f2` | RED 3 fail; GREEN 40 pass; pwsh contract passed |
| N4 | F04 | `f7978a6` | 25 and 25 pass before and after; name lists identical; test bodies hash identical to HEAD; ps1 suite 538 to 425 lines |

## 5. Re-pass (debt created by executing N1 to N5)

| # | Candidate | Class | Decision |
|---|---|---|---|
| R1 | `binary.sh` keeps the untested `.-*` pattern next to the new `./-*` (intent unknown) | NO-OP | removing it would loosen a refusal; no release member starts with `.-` |
| R2 | `install.ps1` matches the archive name case-insensitively (`-match`), `install.sh` exactly | NO-OP | pre-existing, and Windows file names are case-insensitive |
| R3 | on a successful `init`, the CLI's stderr is now printed after its stdout | NO-OP | ordering only; no consumer parses it |
| R4 | `tests/install-ps1-platform.test.mjs` rewrites `SHA256SUMS` itself because `fakeWindowsRelease` has no star-marker option | LATER | `defer: a local useStarMarker helper, upgrade-trigger: a second suite needs the marker` |

No new `NOW` item, so no second question.
