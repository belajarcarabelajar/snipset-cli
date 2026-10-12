## 1. Delivery Metadata

| Field | Value |
|---|---|
| Session slot | `deferred-hardening` |
| Plan | `docs/code-plan/plans/2026-10-12-snipset-cli-deferred-hardening.md` (issue #7) |
| Base branch | `main` |
| Head branch | `2026-10-12-snipset-cli-deferred-hardening/deferred-hardening` |
| Type of change | bug fix, feature (Windows `-Database`), tests, docs |
| Reviewer | independent removal reviewers (`staid`); report in `docs/code-plan/sessions/2026-10-12-snipset-cli-deferred-hardening/review.md` |

## 2. What This Changes

Eight items deferred by PR #6, plus one new Windows finding.

- **Share-dir files (L1):** `install.sh` records the shell files it writes in `<share-dir>/.snipset-bundle` (sha256 per file). A `snipset.sh`, `completion.bash`, or `tab.sh` that it did not write, or that was edited, is kept on install and uninstall with `[KEEP]`, and the bashrc block is not added while one is kept. Before, install overwrote such a file and uninstall deleted it.
- **Directories (L2):** the install records each directory it creates in `<install-dir>/.snipset-dirs`; uninstall removes, deepest first, the recorded directories that the current flags could have created and that are empty. A directory that existed before, or holds a file, stays. A reinstall over an older install adopts the default share dir that install left, so uninstall still removes it.
- **curl | bash (L3):** a test pipes the bundle through `bash -s` with stateful harness stubs and proves no harness call reads the rest of the script; a bundle without the redirect is shown to lose the trailer.
- **Legacy tests (L4):** the 14 original install tests run with a PATH that holds none of the caller's entries.
- **Test helper (R4):** shell stubs, a piped runner, `linkTools`, and the star marker for the Windows fixture.
- **Homebrew (L5):** the README states the formula relies on the host's `libcrypto.so.3` and glibc 2.34 or newer (the binary has no RPATH and `openssl@3` is keg-only); the formula is unchanged.
- **Windows `-Database` (L7):** the database path for MCP install and uninstall, reported by `-Check`. `-Db` is PowerShell's alias of `-Debug`, so the parameter is `-Database` and binding is named only.
- **Windows asides (L10):** an in-use update renames to `snipset.exe.old-<pid>-<8 hex>`; install, update, and uninstall delete exact aside names only, keep locked ones with a NOTE, and never touch decoys, directories, or links.
- **Windows DLLs (W1, new):** the v0.2.0 `snipset.exe` imports `libcrypto-3-x64.dll` and `VCRUNTIME140.dll`, and the zip ships neither (import table read with `objdump -p`). When the smoke run fails with STATUS_DLL_NOT_FOUND the installer names both DLLs; the README says so.

**Non-goals:** a Windows `snipset init`; a formula `depends_on` or patchelf; changing the Windows build (the DLLs belong in the Snipset release build); CI changes.

## 3. Acceptance Criteria

| ID | Criterion | Check |
|---|---|---|
| AC-1, AC-2 | user shell files kept; a newer release still replaces the installer's own | `tests/install-shell.test.mjs -t 'share dir manifest:'` |
| AC-3 | only recorded empty directories removed | `tests/install-dirs.test.mjs` |
| AC-4 | harness calls cannot read the piped script | `tests/install-stdin.test.mjs` |
| AC-5 | legacy tests scrubbed | `tests/install.test.mjs` |
| AC-6 | Windows star marker fixture | `tests/install-sandbox.test.mjs`, `tests/install-ps1-platform.test.mjs` |
| AC-7 | `-Database` | `tests/install-ps1-db.test.mjs` |
| AC-8, AC-9 | aside cleanup; DLL message; one start of a failing exe | `tests/install-ps1-hardening.test.mjs` |
| AC-10 | README notes | `tests/readme-install.test.mjs -t 'deferred hardening:'` |
| AC-11 | no user file or pre-existing directory lost | review report |
| AC-12 | full local verification | section 4 |

## 4. Local Verification Evidence

Every row ran at `70bc688` on the machine holding the working tree, before the branch was pushed. PowerShell ran with `POWERSHELL_TELEMETRY_OPTOUT=1`.

| Gate | Command | Exit | Result |
|---|---|---|---|
| Plan runner | `SNIPSET_REAL_ASSETS=<dir> ultra-plan-runner.mjs <plan> --execute` (mirror current) | 0 | T01 to T08 SKIPPED-IDEMPOTENT by their own tests, T09 NEEDS-AGENT (the review below), T10 PASSED, empty error ledger |
| Full suite | `bun test --timeout 60000 tests/` | 0 | 581 pass, 6 skip, 0 fail |
| Without `snipset` and `pwsh` | `env PATH="$HOME/.bun/bin:/usr/bin:/bin" bun test --timeout 60000 tests/` | 0 | 430 pass, 157 skip, 0 fail |
| Real assets | `SNIPSET_REAL_ASSETS=<dir> bun test tests/install-real-assets.test.mjs` | 0 | 4 pass |
| Drift | `bun scripts/installer/build.mjs --check`, `bun scripts/packaging/render.mjs --check` | 0 | clean |
| Shell lint | `shellcheck -S warning` on `install.sh`, `scripts/snipset-live.sh`, every part; the PKGBUILD with `--shell=bash --exclude=SC2034,SC2154,SC2164` | 0 | 0 warnings |
| PowerShell contract | `pwsh -NoProfile -File tests/install.Tests.ps1` | 0 | passed |
| Copy rules | em dash scan of 27 changed files, attribution scan of 13 commit messages | 0 | 0 hits |

Every task started from a failing test (RED recorded in the plan checklist); guards on existing behaviour were proven by mutations.

## 5. Independent Review

- [x] Two independent removal reviewers on `3f46e61`, one per installer; report in `docs/code-plan/sessions/2026-10-12-snipset-cli-deferred-hardening/review.md`.
- [x] Linux `correct`: P2 (README overclaimed for the default share dir without a manifest) and P3 (`mv -f` into a directory or a link to one) fixed in `63055ce` with RED then GREEN tests. Windows `correct`, no qualifying findings.
- [x] Before the review, a parent probe of the real upgrade path (the previous `install.sh`, then the new install and uninstall) found the default share dir left behind; fixed in `241487a`.
- [x] Parent diff audit for every chunk; integration fixes recorded in the plan (T05 tool set, T07 single start).

**Reviewer verdict:** `correct`. It changes to `not correct` if any uninstall path removes or rewrites a file the installer did not write outside the documented default share dir exception, or if `bun test tests/` goes red on either PATH mode.

## 6. Risk, Rollout, Rollback

| Concern | Answer |
|---|---|
| Blast radius | Everyone who runs either installer. Linux: kept share files now block the bashrc block; uninstall now removes empty directories the install created. Windows: `-Database`, named-only binding, aside cleanup. |
| Compatibility | Installs made before this change: their share files are recognised in the default share dir; in a custom share dir a differing file is kept once with `[KEEP]`. Directories an older installer made are not in the record and can stay empty, except the default share dir it adopts. |
| Rollback | `git revert -m 1 <merge commit>`; a new install can be removed first with its own `--uninstall`. |
| Follow-up | the Snipset release build should link OpenSSL and the CRT statically or ship the two DLLs. |

## 7. Pre-Existing Issues and Deferred Debt

- A startup file the installer created (a custom `--bashrc` that did not exist, `$ZDOTDIR/.zshenv`) is left emptied after uninstall (pre-existing). `defer: record created files, a user report`.
- Uninstall with fewer flags than the install deletes the whole directory record, so recorded directories outside the current flags stay untracked (empty, safe direction). `defer: keep unremoved entries, a user report`.
- Two installs sharing one share dir leave it empty after both uninstall; directories made by an installer older than the record stay. `defer: documented, a user report`.
- Windows: a locked aside on uninstall prints a NOTE and is not counted in `kept`; check does not compare an MCP entry's `--db`. `defer: cosmetic, the next ps1 change`.
- Windows behaviour was not run on Windows: file locks, junctions, 8.3 names, a possible blocking "System Error" dialog before `-1073741515` reaches PowerShell, Windows PowerShell 5.1 argument passing. `defer: labelled not verified, a Windows host`.
- The v0.2.0 Windows build imports `libcrypto-3-x64.dll` and `VCRUNTIME140.dll`; the fix (static OpenSSL and CRT, or shipping the DLLs) is in the Snipset release build. `defer: other repository, the next Snipset distribution session`.
- Carried from PR #6: L6, L8, L9, L12, L13 (see the install-coverage debt sweep).

## 8. Checklist

- [x] Branch and worktree from `pr-registry claim`; nothing committed to `main`.
- [x] English body, no em dash, no attribution line.
- [x] Every acceptance criterion maps to evidence (plan checklist and section 4).
- [ ] Plan closeout decided before the merge.
- [ ] Posted with `--body-file`.
