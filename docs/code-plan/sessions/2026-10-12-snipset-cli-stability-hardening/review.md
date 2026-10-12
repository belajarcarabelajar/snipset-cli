# Code Review: snipset-cli stability hardening

- **Diff:** `origin/main` `53f477f` to `d910b56`, 6 commits, 14 files
- **Reviewer:** independent reviewer agent (`staid`); it did not write any of the change
- **Contract:** `vivera/templates/code-review-template.md`
- **Date:** 2026-10-12

## Verdict

`correct`. No P0 or P1 findings; overall confidence 0.85. The verdict changes to `not correct` if a real `snipset` write subcommand matches a read pattern in `scripts/snipset-live.sh:67-77` (most likely a writing `stats` subcommand matching `"stats "*`), or if `bun test tests/` goes red on a host without `snipset`.

## Inputs consulted

| Input | Result |
|---|---|
| Full diff, `scripts/snipset-live.sh`, `install.ps1`, three new test files, `.github/workflows/test.yml`, plan and contracts | read |
| `snipset 0.2.0 --help` for top level, `snippet`, `group`, `clipboard`, `clipboard tag`, `clipboard export`, `audio`, `audio history`, `audio dictionary`, `audio tts`, `audio stats`, `stats`, `stats overview`, `reference` | read-only, used to check the allowlist against real subcommands |
| `bun test tests/` | exit 0, 103 pass, 0 fail |
| `bun test tests/` with `snipset` and `pwsh` removed from PATH | exit 0, 84 pass, 19 skip (17 + 2), 0 fail; each reason printed once |
| `shellcheck -S warning` on both scripts | exit 0 |
| `shellcheck` at all severities | 4 info hits, all on unchanged lines (pre-existing) |
| `bash -n` on both scripts | exit 0 |
| `pwsh -NoProfile -File tests/install.Tests.ps1` (telemetry opted out) | exit 0 |
| Em dash scan of the diff and commit messages | 0 hits |
| Attribution scan of commit messages | 0 hits; every commit authored by the repository owner |
| Repository `AGENTS.md` or `CLAUDE.md` | not consulted: neither exists in this repository |
| vivera `check-copy-rules.mjs --diff origin/main` | not usable: the script resolves its root to the vivera repository, so it scanned 0 lines of this branch; replaced by the two scans above |

## Claims checked

1. Read allowlist: every allowlisted read is a real read in 0.2.0; every real write (clipboard delete, favorite, update, clear, tag add/remove/set-color; audio history delete, clear, save; audio dictionary add, remove, approve; snippet add, update, delete; group add) takes the gated path. The only value-taking option at any level is `--db`, which the parser skips.
2. `-wal` refresh at `scripts/snipset-live.sh:43`: verified by its test.
3. Skips: exactly 17 binary tests plus 2 pwsh tests.
4. `curl_opts` on all three calls (`install.sh:71`, `:83`, `:84`), parsed per call by the test.
5. `Dispose` in `finally` at `install.ps1:32-39`; pwsh test passes under 7.6.6.
6. README and `.opencode/commands/snipset-live.md` match lines 13 and 43 to 47 of the wrapper.

## Findings

### [P3] Wire `install.Tests.ps1` into the suite so reverting `Dispose` goes red

- **Confidence:** 0.8
- **Location:** `tests/install-ps1.test.mjs:13-21`; `install.ps1:37-39`
- **Defect:** only `tests/install.Tests.ps1` asserts `Dispose`, and nothing in `tests/`, `package.json`, or the workflow runs it, so reverting the fix leaves `bun test` green. The Linux run cannot see the leak because Linux does not lock open files.
- **Remedy:** one `{ skip: pwshSkip }` case that runs `tests/install.Tests.ps1` and asserts exit 0.
- **Resolution:** fixed in `bed3b6e`. Parent reversal: with the `$zipArchive.Dispose()` line removed, `bun test tests/install-ps1.test.mjs` exits 1 (2 pass, 1 fail: `install.ps1 is missing required contract: Dispose`); restored, 3 pass.

## Test reversal

| Commit | Test that goes red when reverted |
|---|---|
| `f6596c8` curl limits | `tests/install.test.mjs` "curl calls carry retry and stall limits" |
| `c057955` skips | without `snipset`: 17 ENOENT failures; with it: none (by design) |
| `905fe66` allowlist | `tests/snipset-live-routing.test.mjs` write cases (34) |
| `affc65b` `-wal` | `tests/snipset-live-snapshot.test.mjs` "refreshes when the live -wal is newer" |
| `3918e76` docs | none; the repository has no doc tests |
| `d910b56` Dispose | after `bed3b6e`: `tests/install-ps1.test.mjs` "install.Tests.ps1 contract checks pass against install.ps1" |

## Observations (not findings)

- With Desktop writing, the `-wal` check triggers a full copy (about 199 MB) on most reads. The header comment at `scripts/snipset-live.sh:3` ("no repeated 200MB copies") became inaccurate. Resolution: corrected in `1feb6fa` (comment-only diff; wrapper suites 70 pass, shellcheck and `bash -n` exit 0).
- Copying the main file, `-wal`, and `-shm` in sequence is not atomic. Pre-existing; deferred in the plan backlog.

NOT READ: none (reviewer). The reviewer left `/tmp/opencode-review-buntest.log` outside the repository.
