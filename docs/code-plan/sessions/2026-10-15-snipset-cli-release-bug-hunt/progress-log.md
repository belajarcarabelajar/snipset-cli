# Progress Log: Snipset CLI v0.2.0 release bug hunt

> The checklist in `docs/code-plan/plans/2026-10-15-snipset-cli-release-bug-hunt.md` is the only to-do list. This file holds state, decisions, the error ledger, and evidence.

---

## Task Identity

- **Goal:** find, reproduce, and diagnose bugs in the Snipset CLI as shipped in release v0.2.0, then patch the approved ones.
- **Approved scope:** RCA approved 2026-10-15: F1 to F9 (R1 to R12, R15) here; R13, R14 unchanged; upstream U1 to U22 to a separate Snipset session.
- **Started:** 2026-10-15T19:05+07:00
- **Last updated:** 2026-10-15
- **Status:** `ACTIVE` (verified, delivering)

---

## Acceptance Criteria

- [x] Every surface of the release has an investigation chunk with a verdict. Evidence: 15 chunk reports (H01 to H15), one owner each.
- [x] Every claimed bug has a red-capable command re-run by the parent. Evidence: `bash ~/.cache/parent-verify.sh`, 43 of 43 non-zero, red reason confirmed from each log tail.
- [x] Root causes written with the violated invariant. Evidence: `debugging-log.md` section 3.
- [x] RCA approved through the `Root cause` gate. Evidence: plan section Approval.
- [x] Approved fixes land with a failing test first, then green, and `bun test tests/` 0 failures. Evidence: debugging-log sections 4 and 5; whole suite 702 pass 0 fail.

---

## Task Breakdown & Checklist

See the plan file checklist.

---

## Current Focus

**Now working on:** RCA gate.

**Last action taken:**
```
bash ~/.cache/parent-verify.sh
```

**Result / observation:**
```
43 repros, all non-zero (41 exit 1, H07-a and H07-b exit 3), slowest 3 s
```

---

## Decisions & Rejected Options

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Binary under test | the binary extracted from the verified v0.2.0 tarball | `~/.local/bin/snipset` | same version string, different sha256: a local build is not the release |
| Live data | `sqlite3 .backup` copy, then further copies | the live file | MEMORY.md protected path; the desktop app may hold it |
| Phase 0 shape | one red command per finding | one command for the session | no single user symptom existed; the request was a hunt |
| H15 | added after H10 reported the bridge path | leave it as a note | a silent write to the wrong database is a P1 data-integrity question that needed its own repro |
| Turn-limit stops (H04, H08, H10, H11, H14) | continued the same agent with a narrowed wrap-up message | re-dispatch a fresh agent | the agents were not stalled (they had made writes and progress); a fresh agent would redo the work |
| Upstream findings | report and hand to a separate session in `~/Proyek/Snipset` | patch here | the source and the release build are not in this repository |

---

## Blockers

| Blocker | Waiting on | Unblock by |
|---|---|---|
| Patching | owner | the `Root cause` gate answer |

---

## Error Ledger

| Task | Step | Classification | Exit | Expected | Transient | Root cause | Evidence (log tail) | Retry used | Fallback used | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| H04 | discovery | environment (agent turn limit) | n/a | report | false | 30-turn cap reached mid-probe | partial report | 1 continuation | narrowed scope | resolved |
| H08, H11 | discovery | environment (agent turn limit) | n/a | report | false | 30-turn cap | partial report | 1 continuation | wrap-up message | resolved |
| H10, H14 | discovery | environment (agent turn limit) | n/a | report | false | 40-turn cap | partial report | 1 continuation | wrap-up message | resolved |
| H04 | discovery | process | n/a | stubs only | false | one real `claude` call ran inside a temp HOME before the narrowing message | agent disclosure | 0 | stubs afterwards | contained |
| several | cleanup | environment | n/a | scratch removed | false | a hook blocks `rm` outside /tmp | agent notes | 0 | parent cleanup at session close | open |
| suite run 3 | `bun test tests/` | environment | 1 | 0 | true | `tests/pentest-core.test.mjs` spawned the PATH `snipset`, killed by SIGTERM at the 5 s test timeout, load average 7 to 9 | `Command failed: snipset --json snippet list ... signal: "SIGTERM"` | 1 | file alone 9/9, next whole run 702/0 | resolved |
| T08, T10 follow-ups | subagent | infrastructure | n/a | report | false | API session limit (HTTP 429) stopped both agents after their edits landed | `You've hit your session limit` | 0 | parent inline takeover: measured diff, RED with the fix lines removed, GREEN targeted 111/0 | resolved |
| spec review | T08 probe | code | 1 | 0 | false | regex `\{[^{}]*` could not pass a nested object before `command` | `[KEEP] opencode: snipset points elsewhere` | 0 | none | fixed, RED then GREEN |
| standards review | T03 block | code | 1 | 0 | false | a block with another `SNIPSET_DB` matched neither shape | `holds the marker with other lines` | 0 | none | fixed, RED then GREEN |

---

## Evidence Trail

| Checkpoint | Command | Exit | Evidence |
|---|---|---|---|
| Baseline | `bun test tests/` (8cd3341) | 0 | 590 pass, 6 skip, 0 fail, 210.13 s |
| Real assets | `SNIPSET_REAL_ASSETS=~/.cache/parent-v020 bun test tests/install-real-assets.test.mjs` | 0 | 4 pass |
| Release digests | `sha256sum -c SHA256SUMS` | 0 | both archives OK |
| Release binary vs live DB | `x/snipset --db live-copy.db doctor --json` | 0 | `schema_match: true` |
| Repro re-run | `bash ~/.cache/parent-verify.sh` | 0 (runner) | 43 of 43 repros red, reasons confirmed |
| Fixed repros | `bash ~/.cache/parent-verify-fixed.sh` | 0 (runner) | 21 of 22 green; H04-a harness line; R13, R14 stay red as approved |
| Whole suite after fix | `bun test tests/` | 0 | 702 pass, 6 skip, 0 fail, 161.09 s |
| Real assets after fix | `SNIPSET_REAL_ASSETS=... bun test tests/install-real-assets.test.mjs` | 0 | 4 pass |
| Bundles | `bun scripts/installer/build.mjs --check` | 0 | both targets |

---

## Follow-Up Backlog (Session-Close Debt Sweep)

Filled at the debt sweep.

---

## Session Log

| Session | Summary | Next |
|---|---|---|
| 2026-10-15 | fixes T01 to T10 landed test first, two-axis review findings fixed, whole suite green | commit, PR, debt sweep |
| 2026-10-15 | 15 chunks, 43 red repros, 37 unique defects (15 here, 22 upstream), RCA written | RCA gate |
