# Batch Manifest and Subagent Contracts: snipset-cli stability hardening

- **Parent plan:** `docs/code-plan/plans/2026-10-12-snipset-cli-stability-hardening.md` (status Approved, Gate 2 on 2026-10-12)
- **Session slot:** `stability-hardening` (registry state `active`)
- **Working directory:** `/home/belajarcarabelajar/Proyek/snipset-cli-wt/stability-hardening` (every relative path below resolves here)
- **Head branch:** `2026-10-12-snipset-cli-stability-hardening/stability-hardening`
- **Delegation mode:** `isolated-files` inside one worktree

## Git boundary (applies to every chunk)

Subagents edit files and run tests. They never run `git commit`, `git add`, `git checkout`, `git switch`, `git merge`, `git rebase`, `git stash`, `git reset`, `git push`, `gh`, or any other command that writes git state. The parent stages by explicit path and commits. A file outside a chunk's permitted list is a report line, not an edit.

## Batch manifest

| Chunk | Plan task | Wave | Owner | Permitted target files | Expected output | Verification command |
|---|---|---|---|---|---|---|
| C1 | T1 | 1 | `chef` | `scripts/snipset-live.sh`, `tests/snipset-live-routing.test.mjs` (new) | Read allowlist over up to three positional words; routing test matrix | `bun test tests/snipset-live-routing.test.mjs tests/snipset-live.test.mjs tests/snipset-live-hardening.test.mjs` |
| C4 | T4 | 1 | `nappy` | `tests/snipset-bin.mjs` (new), `tests/dummy-db.test.mjs`, `tests/pentest-core.test.mjs`, `tests/pentest-aux.test.mjs` | 17 binary-dependent tests skip with a reason when `snipset` is absent | `env PATH="$(dirname "$(command -v bun)"):/usr/bin:/bin" bun test tests/` and `bun test tests/` |
| C5 | T5 | 1 | `hoggy` | `install.sh`, `tests/install.test.mjs` | `curl_opts` with retry and stall limits on all three curl calls; new test | `bun test tests/install.test.mjs` and `shellcheck -S warning install.sh` |
| C6 | T6 | 1 | parent, inline | none in the repository (`~/.local/opt/powershell/7.6.6`, `~/.local/bin/pwsh`) | pwsh 7.6.6 on PATH, digest verified | `pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'` |
| C2 | T2 | 2 | `chef` | `scripts/snipset-live.sh`, `tests/snipset-live-snapshot.test.mjs` (new) | Refresh when live `-wal` is newer than the snapshot | `bun test tests/snipset-live-snapshot.test.mjs tests/snipset-live-routing.test.mjs tests/snipset-live.test.mjs tests/snipset-live-hardening.test.mjs` |
| C7 | T7 | 2 | `nappy` | `install.ps1`, `tests/install.Tests.ps1`, `tests/install-ps1.test.mjs` (new) | Archive disposed in `finally`; installer runs under pwsh on Linux | `pwsh -NoProfile -File tests/install.Tests.ps1` and `bun test tests/install-ps1.test.mjs` |
| C3 | T3 | 3 | `hoggy` | `README.md`, `.opencode/commands/snipset-live.md` | Docs match the T1 allowlist, the real default directory, and the T2 rule | `bash -c '! rg -n --max-columns=0 "\x{2014}" README.md .opencode/commands/snipset-live.md'` |

- **Fan-out count:** 6 subagent chunks plus 1 inline. Below the floor of 10 because the work splits into exactly these disjoint file sets; C1 and C2 share `scripts/snipset-live.sh`, so they run in sequence under one owner.
- **Chunk boundary check:** every chunk has one owner; every plan task T1 to T7 is covered (T8 is parent verification); within a wave no two chunks write the same file.
- **Impact owners:** README and `.opencode/commands/snipset-live.md` (C3); existing wrapper suites (C1, C2 regression runs); README install line (unchanged interface, checked in T8); Windows handoff doc (backlog, `defer:` in the plan).
- **Re-dispatch rule:** a red chunk is re-chunked and re-dispatched alone.

## C1 (T1): Read allowlist routing, owner `chef`

**Target behavior.** In `scripts/snipset-live.sh`, the read decision (currently `scripts/snipset-live.sh:48-73`) uses the first three positional words of the forwarded args (skip `--db VALUE`, `--db=*`, and any other `-*` flag). A command is a read only if it matches this allowlist; everything else keeps the existing doctor-gated write path:

| First word | Read when |
|---|---|
| `snippet` | second word is `list`, `get`, `search`, `expand` |
| `group` | second word is `list` |
| `stats` | always (the CLI documents `stats` as read-only) |
| `reference` | second word is `list` |
| `clipboard` | second word is `list`, `get`, `search`, `export`; or second is `tag` and third is `list` |
| `audio` | `history list`, `history get`, `dictionary list`, `tts list`, `stats` |

Writes that must now take the gated path (measured from `snipset <cmd> --help`, snipset 0.2.0): `clipboard delete|favorite|update|clear`, `clipboard tag add|remove|set-color`, `audio history delete|clear|save`, `audio dictionary add|remove|approve`.

**RED.** Create `tests/snipset-live-routing.test.mjs`, reusing the stub-on-PATH fixture pattern of `tests/snipset-live.test.mjs` (stub logs argv; doctor can be made to fail). Assert: every read above runs exactly one command with `--db <snapshot>` and no doctor call; every write above runs `doctor` with `--db <live>` first and then the command with `--db <live>`; with doctor failing, every write exits 3 and the command never runs. Command: `bun test tests/snipset-live-routing.test.mjs`, expected exit 1 before the change (writes such as `clipboard delete 1` currently go to the snapshot).

**GREEN.** `bun test tests/snipset-live-routing.test.mjs tests/snipset-live.test.mjs tests/snipset-live-hardening.test.mjs` exit 0, 0 failures. Also `shellcheck -S warning scripts/snipset-live.sh` and `bash -n scripts/snipset-live.sh` exit 0.

**Invariants.** Keep the wrapper CLI, env vars, `--db` stripping, exit code 3 message, and `umask 077` unchanged. No comments that restate code. English identifiers.

## C4 (T4): Binary-dependent tests skip with a reason, owner `nappy`

**Target behavior.** Create `tests/snipset-bin.mjs` exporting `snipsetSkip`: `false` when `Bun.which("snipset")` returns a path, otherwise the string `"snipset binary not on PATH"`. In `tests/dummy-db.test.mjs` (1 test), `tests/pentest-core.test.mjs` (9), and `tests/pentest-aux.test.mjs` (7), pass `{ skip: snipsetSkip }` as the options argument of every test that runs the real binary (all 17, including the wrapper test at `pentest-aux.test.mjs:168` and the pomodoro test). Measured: Bun 1.4.3 honors `test(name, { skip: reason }, fn)` from `node:test`.

**RED.** `env PATH="$(dirname "$(command -v bun)"):/usr/bin:/bin" bun test tests/dummy-db.test.mjs tests/pentest-core.test.mjs tests/pentest-aux.test.mjs` exits 1 today (17 failures, ENOENT `snipset`).

**GREEN.** The same command exits 0 with 17 skips; `bun test tests/dummy-db.test.mjs tests/pentest-core.test.mjs tests/pentest-aux.test.mjs` with the binary on PATH exits 0 with 0 skips and 0 failures. Do not change assertions or `tests/dummy-db.mjs`.

## C5 (T5): install.sh curl retry and stall limits, owner `hoggy`

**Target behavior.** In `install.sh`, define one array `curl_opts=(--retry 3 --connect-timeout 15 --speed-limit 1024 --speed-time 60)` and use it in all three `curl` calls (`install.sh:70` latest-tag lookup, `:82` SHA256SUMS, `:83` archive), placed before the URL. Do not add `--max-time` (it would abort slow but healthy downloads) and do not add `--proto` (the `SNIPSET_RELEASE_BASE_URL` seam is used by tests).

**RED.** In `tests/install.test.mjs`, make the fake `curl` append its argv to a log file (keep its existing behavior: `-o` takes a value, the last other argument is the URL), and add a test named exactly `curl calls carry retry and stall limits` that runs the installer once without `--version` (so all three calls happen) and asserts every logged invocation contains `--retry 3`, `--connect-timeout 15`, `--speed-limit 1024`, and `--speed-time 60`. Command: `bun test tests/install.test.mjs -t 'curl calls carry retry and stall limits'`, expected exit 1 before the change.

**GREEN.** `bun test tests/install.test.mjs` exit 0 (all 14 tests); `shellcheck -S warning install.sh` exit 0; `bash -n install.sh` exit 0.

## C6 (T6): pwsh 7.6.6 user-local, parent inline

Reason for inline: writes outside the worktree and must keep the download digest in the parent's own log. Steps and revert are in the plan, Task T6.

## C2 (T2): WAL-aware staleness, owner `chef` (after C1 is integrated)

**Target behavior.** Extend the refresh condition in `scripts/snipset-live.sh` so the snapshot also refreshes when `"$live-wal"` exists and is newer than the snapshot database. Everything else in the refresh block stays as is.

**RED.** Create `tests/snipset-live-snapshot.test.mjs` (stub-on-PATH fixture as in C1). Sequence: first read creates the snapshot; overwrite the snapshot with a marker; set the live database mtime older than the snapshot and create `live-wal` with new content and an mtime newer than the snapshot (use `fs.utimes` with explicit times); run a read; assert the snapshot no longer holds the marker and the snapshot `-wal` holds the new content. Add a control case: with no `-wal` and live older than the snapshot, the marker survives. Expected exit 1 before the change.

**GREEN.** `bun test tests/snipset-live-snapshot.test.mjs tests/snipset-live-routing.test.mjs tests/snipset-live.test.mjs tests/snipset-live-hardening.test.mjs` exit 0; shellcheck and `bash -n` exit 0.

## C7 (T7): install.ps1 Dispose and Linux run, owner `nappy` (after C6)

**Target behavior.** In `install.ps1`, hold the archive from `[IO.Compression.ZipFile]::OpenRead($zip)` in a variable and dispose it in a `finally` block around the entry validation loop. Add `'Dispose'` to the contract list in `tests/install.Tests.ps1`.

**RED.** After adding `'Dispose'` to the contract list: `pwsh -NoProfile -File tests/install.Tests.ps1` exits 1. Then fix `install.ps1`; the same command exits 0.

**Linux run test.** Create `tests/install-ps1.test.mjs` that skips with reason `"pwsh not on PATH"` when `Bun.which("pwsh")` is null. It builds a zip holding a file `snipset.exe` with `pwsh -NoProfile -Command Compress-Archive ...`, serves `SHA256SUMS` (`<hex>  snipset-cli-v0.1.0-x86_64-pc-windows-msvc.zip`) and the zip from `Bun.serve` on `127.0.0.1` with an ephemeral port, then runs `pwsh -NoProfile -NonInteractive -File install.ps1 -Version v0.1.0 -InstallDir <tmp>/bin` with `SNIPSET_RELEASE_BASE_URL=http://127.0.0.1:<port>` and `TMPDIR=<tmp>/tmp`. Use an async child process (promisified `execFile`), never a synchronous spawn, so the server keeps serving. Assert exit 0, `<tmp>/bin/snipset.exe` exists, and no `snipset-install-*` in `<tmp>/tmp` and no `.snipset-stage-*` in `<tmp>/bin`. Second case: wrong checksum gives a non-zero exit and stderr containing `checksum mismatch`. Stop the server in `finally`.

**Boundary to report, not hide.** Linux does not lock open files, so the Linux run cannot fail for the leaked handle itself. If the Linux run exposes a real installer defect (for example a type that does not resolve under PowerShell 7), fix it minimally in `install.ps1`, keep the test that shows it, and report it as an `IMPACT:` line.

**GREEN.** `pwsh -NoProfile -File tests/install.Tests.ps1` exit 0 and `bun test tests/install-ps1.test.mjs` exit 0.

## C3 (T3): Docs match the wrapper, owner `hoggy` (after C1 and C2)

**Target behavior.** In `README.md` (wrapper section, currently lines 74 to 83) and `.opencode/commands/snipset-live.md` (lines 6 to 9): replace the read list with the C1 allowlist; state that every other command, including the clipboard and audio edits, is a doctor-gated write; correct the default snapshot directory to `${TMPDIR:-/tmp}/snipset-live-<uid>` (source: `scripts/snipset-live.sh:13`); state that a newer live `-wal` also triggers a refresh. In the opencode doc, drop "once per session" (the wrapper refreshes on staleness, not per session) and change "Clean up only snapshots you created in `/tmp`" to name the snapshot directory. Plain prose, no em dash, no new sections.

**Verification.** `bash -c '! rg -n --max-columns=0 "\x{2014}" README.md .opencode/commands/snipset-live.md'` exit 0; the parent reads the diff.

## Report format (every chunk)

1. Files changed (paths only) and a one-line summary per file.
2. RED command, exit code, and the failing assertion line.
3. GREEN commands with exit codes and pass/fail/skip counts.
4. `IMPACT: <surface> - <what breaks> - <evidence command>` lines, or `IMPACT: none`.
5. `NOT READ: <source> (<reason>)` lines, or `NOT READ: none`.
6. Questions for the owner, if any (the parent asks them).

## Gather checkpoints (parent)

- After wave 1: audit C1, C4, C5 diffs by path, rerun each verification command, commit each chunk by explicit path; confirm C6.
- After wave 2: same for C2 and C7.
- After wave 3: same for C3, then T8 and the `staid` review.
