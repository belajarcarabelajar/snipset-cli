# Session-Close Debt Sweep: snipset-cli stability hardening

## 1. Preconditions

| Check | Evidence | Status |
|---|---|---|
| Plan tasks T1 to T8 checked with evidence | plan section 0 | done |
| Verification gate green | `bun test tests/` exit 0 (104 pass); PATH without the binaries exit 0 (84 pass, 20 skip); shellcheck `-S warning`, `bash -n`, pwsh contract exit 0 | done |
| Diff audited, PR recorded | 14 planned paths; PR #4 registered, state `open` | done |
| Blocked items excluded | none blocked; items needing a Windows host or a running Desktop are `LATER` | done |

## 2. Harvested Debt Candidates

| # | Source | Candidate (outcome, path, finish line) | Class |
|---|---|---|---|
| D1 | Review risk, verification gap | `install.ps1:32` uses `[IO.Compression.ZipFile]`; on .NET Framework (Windows PowerShell 5.1) that type is in `System.IO.Compression.FileSystem.dll` (Microsoft .NET API reference, read 2026-10-12) and may not be loaded. Finish line: `Add-Type -AssemblyName System.IO.Compression.FileSystem` before `OpenRead`, contract entry in `tests/install.Tests.ps1` red then green, `tests/install-ps1.test.mjs` still green under pwsh 7 | NOW |
| D2 | Review verdict condition | No check stops a new write subcommand from matching the `stats *` wildcard or an allowlisted name. Finish line: `tests/snipset-live-cli-drift.test.mjs` compares `snipset <group> --help` subcommands against the known read and write tables, skips without the binary, and fails on an unknown subcommand | NOW |
| D3 | Pre-existing warning | `install.sh` has 4 ShellCheck notes (SC2016 x3, SC1003 x1) on intentionally literal strings. Finish line: targeted `# shellcheck disable=` lines with the reason, `shellcheck install.sh` at default severity exit 0 | NOW |
| D4 | Privacy observation | `pwsh` sends startup telemetry unless `POWERSHELL_TELEMETRY_OPTOUT` is set; only this session's commands set it. Finish line: export in `~/.bashrc` with a backup and revert note | NOW, global file, asked separately |
| D5 | Unmeasured performance risk | Refresh cost with Snipset Desktop running (how often `-wal` changes, so how often 199 MB is recopied) | LATER |
| D6 | `defer:` from T2 | Database then `-wal` copied with two `cp` calls; a write between them can tear the snapshot | LATER |
| D7 | `defer:` from T7 | Windows runtime check of the handle release and of D1 | LATER |
| D8 | Owner decision | `test` workflow red on every run (no binary on the runner) | LATER |
| D9 | Review note, other repository | vivera `scripts/check-copy-rules.mjs` scans vivera's own root even when run for another repository | LATER |
| D10 | Observed in setup, other projects | 38 vault mirrors missing or stale in Snipset, bcb, dawnbook, vivera (identical before and after this session) | LATER |

## 3. Ranked Follow-Up Set

1. D1: highest leftover risk (every Windows install), one line plus a contract entry.
2. D2: guards the review verdict's only open condition, small test, skips without the binary.
3. D3: cosmetic but cheap; makes a default-severity ShellCheck run clean.

D4 is asked on its own because it writes a global file.

## 4. The Question

Asked after the final recap as one multi-select question (header `Follow-ups`): D1, D2, D3, `Nothing, close session`.

## 5. Execution Record

| Item | Plan task | Acceptance | Verify command | Evidence | Status |
|---|---|---|---|---|---|
| D1 ZipFile assembly | F1 | AC-F1 | `bun test tests/install-ps1.test.mjs` | without the `Add-Type` line exit 1 (2 pass, 1 fail); with it exit 0 (3 pass); commit `ab99c80` | DONE (Windows PowerShell 5.1 run still deferred, D7) |
| D2 CLI drift guard | F2 | AC-F2 | `bun test tests/snipset-live-cli-drift.test.mjs` | exit 0 (10 pass); table mutation exit 1 naming the subcommand; without the binary 10 skip; commit `524cd8a` | DONE |
| D3 ShellCheck notes | F3 | AC-F3 | `shellcheck install.sh` | exit 1 before (4 notes), exit 0 after; comment-only diff; install tests 14 pass; commit `aa26e5d` | DONE |
| D4 pwsh telemetry opt-out | n/a | export in `~/.bashrc` | asked on its own (global file) | see the owner's answer in the session | ASKED SEPARATELY |

### Second sweep pass

- D11 (new): the read allowlist now exists in three copies (`scripts/snipset-live.sh`, `tests/snipset-live-routing.test.mjs`, `tests/snipset-live-cli-drift.test.mjs`) with nothing comparing them. Reported by the F2 owner. `LATER`: `defer: three hand-kept copies, an allowlist change that updates one copy and not the others`.
- Final state after the follow-ups: `bun test tests/` exit 0 (114 pass); without `snipset` and `pwsh` on PATH exit 0 (84 pass, 30 skip); `shellcheck install.sh scripts/snipset-live.sh` at default severity exit 0; `bash -n` exit 0; pwsh contract exit 0.

## 6. Deferred Backlog

| Item | Why deferred | Marker |
|---|---|---|
| D5 | needs Snipset Desktop running and writing | `defer: refresh cost unmeasured, the owner reports slow wrapper reads or runs Desktop during a session` |
| D6 | not reproduced | `defer: two-step copy, a reproduced inconsistent snapshot` |
| D7 | no Windows host | `defer: Linux cannot show it, next Windows verification session` |
| D8 | owner decision 2026-10-12 (billing limit) | `defer: CI out of scope, CI billing restored` |
| D9 | belongs to a vivera session | `defer: vivera tooling, next vivera session touching check-copy-rules` |
| D10 | other projects' plans | `defer: other projects, their next session or a vault-wide publish run` |
| D11 | found by the second pass | `defer: three hand-kept copies of the allowlist, an allowlist change that updates one copy and not the others` |

## 7. Plan Closeout Decision

| Field | Value |
|---|---|
| Readiness command | `bun ~/vivera/scripts/plan-closeout.mjs --readiness docs/code-plan/plans/2026-10-12-snipset-cli-stability-hardening.md` |
| Verdict and exit code | `NEEDS-HUMAN`, exit 3 |
| Open items | T3 and T8 `UNPROVEN` (`false` sentinel by design); 0 open NOW backlog rows |
| Question asked | `Close plan`: Keep it open (recommended on `NEEDS-HUMAN`), Mark Complete |
| Answer | `Mark Complete` (owner, 2026-10-12) |
| Evidence | readiness output above; runner `--execute` exit 0 with T3 and T8 `PASSED`; `plan-mark-done` ticked 11 of 11 tasks |
| Resulting status | `Complete`, committed on the session branch so it ships in PR #4 |

## 8. Graph Index and Final Sync

| Step | Command | Exit | Result |
|---|---|---|---|
| Code graph | `graphify update .` (session worktree) | 0 | `graphify-out/` created; ignored by the new `.gitignore` |
| Document sync preview | `bun ~/vivera/scripts/graphify-sync.mjs --root "$(pwd)" --dry-run` | 0 | eligible docs 20, heading nodes 165, nodes 287 -> 437 |
| Document sync | same without `--dry-run` | 0 | wrote `graphify-out/graph.json`, 437 nodes, 492 links |
| Check | `bun ~/vivera/scripts/graphify-sync.mjs --check --root "$(pwd)"` | 0 | nodes 437 -> 437 |
| Query | `graphify query "snipset-live read allowlist"` | 0 | returns `Task T1: Read allowlist routing` and the wrapper files |
| Mirror | `bun scripts/plan-publish.mjs <plan>` then `--check` (vivera) | 0, 0 | vault mirror current |
| Issue | `bun scripts/plan-issue-sync.mjs <plan>` then `--check` (vivera) | 0, 0 | `update-and-state`; issue #3 `CLOSED` |
