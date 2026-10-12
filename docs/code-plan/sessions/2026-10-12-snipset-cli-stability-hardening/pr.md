## 1. Delivery Metadata

| Field | Value |
|---|---|
| Session slot | `stability-hardening` |
| Plan | `docs/code-plan/plans/2026-10-12-snipset-cli-stability-hardening.md` (issue #3) |
| Base branch | `main` |
| Head branch | `2026-10-12-snipset-cli-stability-hardening/stability-hardening` |
| Type of change | bug fix, test, docs |
| Reviewer | independent reviewer agent (`staid`) on the full diff; owner review requested |

## 2. What This Changes

`scripts/snipset-live.sh` no longer loses writes or serves stale reads, the test suite no longer fails on a host without the private `snipset` binary, and both installers are harder to break. The wrapper treated every `clipboard`, `audio`, and `reference` command as a read, so writes such as `clipboard delete 1` ran against the snapshot, printed success, and were discarded at the next refresh; reads are now an explicit allowlist over up to three positional words and every other command takes the existing doctor-gated write path. The snapshot also refreshes when the live `-wal` is newer, because in WAL mode new commits land there while the main file mtime stays put. The 17 tests that run the real binary skip with a printed reason when it is missing. `install.sh` retries and aborts stalled downloads, and `install.ps1` disposes the archive it opens for entry validation; a new test runs `install.ps1` under PowerShell 7 on Linux against a local release server.

**Non-goals:** CI workflow changes; new commands or flags; an atomic SQLite backup instead of `cp`; a Windows runtime check (no Windows host was used).

## 3. Acceptance Criteria

| ID | Criterion | Task | Check | Evidence |
|---|---|---|---|---|
| AC-1 | Every clipboard and audio write subcommand of snipset 0.2.0 runs doctor first against the live database and exits 3 when doctor fails | T1 | `bun test tests/snipset-live-routing.test.mjs` | exit 0; 34 write cases red against the old wrapper |
| AC-2 | Allowlisted reads run once against the snapshot with no doctor call | T1 | same file | exit 0, 21 read cases |
| AC-3 | Snapshot refreshes when the live `-wal` is newer than the snapshot | T2 | `bun test tests/snipset-live-snapshot.test.mjs` | exit 0, 3 pass; 1 fail against the old wrapper |
| AC-4 | README and `.opencode/commands/snipset-live.md` state the allowlist, the real default directory, and the refresh rule | T3 | em dash scan, diff review against `scripts/snipset-live.sh:13`, `:43`, `:67-77` | exit 0 |
| AC-5 | Without `snipset` on PATH the suite is green and the binary tests are skipped with a reason; with it, none are skipped | T4 | PATH-override run and normal run of `bun test tests/` | 84 pass, 20 skip, 0 fail; 104 pass, 0 skip, 0 fail |
| AC-6 | All three `curl` calls carry `--retry 3 --connect-timeout 15 --speed-limit 1024 --speed-time 60` | T5 | `bun test tests/install.test.mjs` | exit 0, 14 pass; new test red against the old `install.sh` |
| AC-7 | `install.ps1` disposes the archive; installer runs end to end under PowerShell 7.6.6 on Linux | T6, T7 | `bun test tests/install-ps1.test.mjs` (runs the install and the `tests/install.Tests.ps1` contract under pwsh) | exit 0, 3 pass; red without the `Dispose` line |
| AC-8 | Whole suite, ShellCheck at warning level, and `bash -n` clean | T8 | commands in section 4 | exit 0 each |

## 4. Local Verification Evidence

Every row ran on the machine holding the working tree, before the branch was pushed. PowerShell commands ran with `POWERSHELL_TELEMETRY_OPTOUT=1`.

| Gate | Command | Exit | Result |
|---|---|---|---|
| Full suite, binary present | `bun test tests/` | 0 | 104 pass, 0 fail |
| Full suite, binary absent | `env PATH="$(dirname "$(command -v bun)"):/usr/bin:/bin" bun test tests/` | 0 | 84 pass, 20 skip, 0 fail, 2 reason lines |
| Shell lint | `shellcheck -S warning install.sh scripts/snipset-live.sh` | 0 | 0 warnings |
| Shell syntax | `bash -n install.sh`, `bash -n scripts/snipset-live.sh` | 0 | clean |
| PowerShell contract | `pwsh -NoProfile -File tests/install.Tests.ps1` | 0 | contract passed |
| Plan runner | `ultra-plan-runner.mjs <plan> --execute` | 0 | T3, T8 PASSED; T1, T2, T4 to T7 SKIPPED-IDEMPOTENT by behavioral `skip_if`; empty error ledger |

The repository has no lint, type check, or build step besides these. Test reversal was run by the parent for every code commit: each new test was executed against the pre-change file and failed (routing 34 fail, snapshot 1 fail, curl 1 fail, PowerShell contract 1 fail).

## 5. Independent Review

- [x] Independent reviewer agent (`staid`) read the full diff, ran the suite in both PATH modes, and checked the read allowlist against `snipset 0.2.0 --help` for every command group. Report: `docs/code-plan/sessions/2026-10-12-snipset-cli-stability-hardening/review.md`.
- [x] Parent diff audit: every subagent change was read by path, its tests rerun in the parent, and its new test run against the pre-change file to confirm it goes red.
- [x] The one qualifying finding ([P3] the `Dispose` contract was not run by `bun test`) is fixed in `bed3b6e`; the reviewer's observation about the wrapper header comment is fixed in `1feb6fa`.

**Reviewer verdict:** `correct`. No P0 or P1 findings (confidence 0.85). It changes to `not correct` if a real `snipset` write subcommand matches a read pattern in `scripts/snipset-live.sh:67-77`, or if `bun test tests/` goes red on a host without `snipset`.

## 6. Risk, Rollout, Rollback

| Concern | Answer |
|---|---|
| Blast radius | Wrapper users: the clipboard and audio edits that were silently lost now need `snipset doctor` to pass, which means closing Snipset Desktop. Any read outside the allowlist is also gated. |
| Refresh cost | Each read after a new live `-wal` write copies the whole database again (about 199 MB on the owner machine). How often that happens with Desktop running was not measured. |
| Rollout | Default; no flag. |
| Health signal | `bash scripts/snipset-live.sh --json clipboard list` returns current rows; a clipboard edit through the wrapper either changes the live database or exits 3. |
| Rollback | `git revert -m 1 <merge commit>` on `main`. |
| Compatibility | Wrapper and installer interfaces unchanged. `tests/snipset-bin.mjs` uses the `Bun` global, so the three updated test files need `bun test` (already the `package.json` test command). |

## 7. Pre-Existing Issues and Deferred Debt

- `scripts/snipset-live.sh:44-47` copies the database and then its `-wal` with two `cp` calls, so a write between them can give an inconsistent snapshot. Not reproduced. `defer: two-step copy, a reproduced inconsistent snapshot`.
- `install.ps1:32` calls `[IO.Compression.ZipFile]::OpenRead`. On Windows PowerShell 5.1 that type may need `Add-Type -AssemblyName System.IO.Compression.FileSystem`; unverified, present since the first commit. `defer: no Windows host, next Windows verification session`.
- `install.ps1` handle release is not observable on Linux. `defer: same Windows session`.
- `install.sh` carries 4 ShellCheck notes (SC2016 x3, SC1003 x1), identical before and after this change; they flag intentionally literal strings.
- The `test` workflow is red on every run because the runner has no `snipset` binary; this PR removes that failure mode, but CI itself is out of scope here.

## 8. Checklist

- [x] Branch and worktree came from `pr-registry claim`.
- [x] Nothing was committed directly to the base branch.
- [x] Imperative title; body in English like the rest of the repository.
- [x] No em dash in this body, the commit messages, or the diff (scan: 0, 0, 0).
- [x] No attribution footer or co-author line in the body or the commits (scan: 0).
- [x] No secrets or unrelated cleanup in the diff; 14 planned paths plus the plan and its session notes.
- [x] Every acceptance criterion maps to a check and evidence.
- [x] PR body posted from a file.
