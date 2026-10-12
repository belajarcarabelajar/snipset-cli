# Session-Close Debt Sweep: snipset-cli deferred hardening

- **Session:** `deferred-hardening`, PR #8, issue #7. Shared question call with vivera `copy-rules-root` (PR #89).
- **Preconditions:** T01 to T10 checked with evidence; T10 green at `70bc688`; two independent removal reviewers `correct`; PR #8 open and recorded.

## 1. Candidates and decisions

| # | Candidate (outcome, file, finish line) | Class | Decision |
|---|---|---|---|
| S2 | Uninstall removes a startup file the installer created (a custom `--bashrc`, `~/.profile`, `.zshenv`) once only whitespace is left; finish: `tests/install-startup-files.test.mjs` red on HEAD, green after | NOW | owner selected (Recommended) |
| S3 | `install.ps1` uninstall counts a locked aside in `kept` | NOW | not selected: `defer: cosmetic summary count, upgrade-trigger: the next change to modes.ps1 uninstall` |
| S4 | Uninstall rewrites `.snipset-dirs` with the recorded dirs it could not remove, instead of deleting it | NOW | not selected: `defer: an empty install dir holding only the record would then stay, upgrade-trigger: a user report of untracked leftover directories` |
| L1 | Two installs sharing one share dir leave it empty after both uninstall | LATER | `defer: documented, upgrade-trigger: a user report` |
| L2 | Windows behaviour not run on Windows (locks, junctions, 8.3 names, a possible blocking "System Error" dialog before `-1073741515` reaches PowerShell, Windows PowerShell 5.1 argument passing) | LATER | `defer: labelled not verified, upgrade-trigger: a Windows host` |
| L3 | The v0.2.0 Windows build imports `libcrypto-3-x64.dll` and `VCRUNTIME140.dll` | LATER | `defer: other repository, upgrade-trigger: the next Snipset distribution session` |
| L4 | Check does not compare an MCP entry's `--db` (both installers) | LATER | `defer: unchanged behaviour, upgrade-trigger: a user report of a stale --db entry` |
| L5 | Carried from PR #6: L6, L8, L9, L12, L13 | LATER | unchanged markers in the install-coverage debt sweep |

## 2. Question and execution record

Question (2026-10-12, one call, two multi-select groups): `snipset-cli` S2, S3, S4; `vivera` S1, `Nothing, close session`. Owner selected S2 and S1.

| Item | Commit | Evidence |
|---|---|---|
| S2 | see the S2 commit on PR #8 | RED 6 fail on HEAD; GREEN 16 Linux suites 245 pass; six mutations each fail their own test |

## 3. Re-pass (debt from executing S2)

| # | Candidate | Class | Decision |
|---|---|---|---|
| R1 | An install without `ZDOTDIR`, uninstalled with `ZDOTDIR` set, leaves an emptied `~/.zshenv` (it is outside the recomputed startup set) | LATER | `defer: safe direction, upgrade-trigger: a user report` |
| R2 | A newline in `ZDOTDIR` leaves an empty `.snipset-files` behind | LATER | `defer: harmless, upgrade-trigger: none expected` |

No new `NOW` item, so no second question.
