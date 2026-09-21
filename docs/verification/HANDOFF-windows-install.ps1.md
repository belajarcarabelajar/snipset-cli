# Windows Handoff: Verify & Complete snipset-cli PowerShell Installer

> Read this file FIRST. This hands off the remaining Windows-side verification task to an AI agent running on a Windows host.

## Identity

- **Task / Goal:** Verify and complete the snipset-cli `install.ps1` PowerShell installer verification that could not run on the Linux VPS (pwsh absent). Deliverable: a Windows verification report proving the PowerShell installer contract and behavior are correct, using manual source-code review only (no Rust/Cargo, no builds).
- **Plan file:** `docs/code-plan/plans/2026-09-21-verification.md`
- **Repo / branch:** `belajarcarabelajar/snipset-cli` on `main`
- **Skill active:** `super-ultra-code-plan`
- **Handoff written at:** 2026-09-21

---

## HARD CONSTRAINT: Resource-Limited Windows Target

The Windows host where you run is RAM/storage-constrained. This is a **non-negotiable constraint**:

- **PROHIBITED:** Rust builds, `cargo test`, `cargo build`, `cargo check`, `cargo nextest`, `sccache`, any heavy compilation, or installing Rust toolchains. This repo has no Rust source in the public tree anyway; never assume one.
- **PROHIBITED:** Downloading or running the release archive, invoking the real GitHub API, or any network-triggered execution of `install.ps1` that fetches binaries.
- **ALLOWED:** Manual, careful source-code review of `install.ps1` (and `tests/install.Tests.ps1`) directly in the editor. Static analysis. Optional lightweight PowerShell parsing (no network, no binary fetch) if `pwsh`/`powershell.exe` is available with enough RAM.
- **Preference:** If any command risks memory pressure or a long download, skip it. Manual verification previews over the source code are the primary method.

---

## Last Verified State (on the Linux VPS)

| Item | Command run | Exit code | Evidence |
|---|---|---|---|
| Linux installer tests | `bun test tests/install.test.mjs` | 0 | 2 pass, 0 fail |
| install.sh syntax | `bash -n install.sh` | 0 | no syntax errors |
| install.ps1 static contract | token scan | 0 | 5 tokens present, no Cargo/crates leak |
| install.ps1 runtime | `pwsh tests/install.Tests.ps1` | n/a | pwsh unavailable → this is YOUR task |

Artifacts already committed on the VPS (commit `558107c`, branch `main`):
- `docs/code-plan/plans/2026-09-21-verification.md`
- `docs/verification/2026-09-21-report.md`

---

## Completed Steps

- [x] Repository inventory: 2 installers (`install.sh`, `install.ps1`) + 2 tests (`tests/install.test.mjs`, `tests/install.Tests.ps1`)
- [x] Linux installer tests pass (2/2)
- [x] install.sh static contract verified
- [x] install.ps1 static contract verified (tokens present, no source leak)
- [x] Verification plan + report written and committed

## Current Position

- **Currently on:** Windows-side runtime verification of `install.ps1` / `tests/install.Tests.ps1`
- **Status:** BLOCKED on this VPS (pwsh absent); OPEN for Windows agent
- **Partial work in progress:** none — VPS commit is clean

## Next Immediate Action

Do exactly this first (manual review, no heavy execution):

1. Read `install.ps1` line-by-line. Confirm the flow: version parse → checksum fetch → checksum match → archive entry safety scan → stage → move `snipset.exe` → optional PATH.
2. Read `tests/install.Tests.ps1` and confirm the required tokens it asserts: `SHA256SUMS`, `Get-FileHash`, `Expand-Archive`, `x86_64-pc-windows-msvc`, `LOCALAPPDATA`; and the negative guard (no `Cargo`/`crates`).
3. Manually verify each token exists verbatim in `install.ps1` and that no `Cargo`/`crates` exposure exists.
4. Record findings in a new report `docs/verification/2026-09-21-windows-report.md` (see template below).

---

## Manual Review Checklist for `install.ps1`

Go token by token and confirm presence and correctness in the source:

| # | Contract point | Where to look in install.ps1 |
|---|---|---|
| 1 | `SHA256SUMS` | checksum file download + parse |
| 2 | `Get-FileHash` | actual checksum computation |
| 3 | `Expand-Archive` | archive extraction |
| 4 | `x86_64-pc-windows-msvc` | target triple / archive name |
| 5 | `LOCALAPPDATA` | default install dir |
| 6 | No `Cargo`/`crates` | public installer must not expose source install |
| 7 | Entry safety | reject rooted / `..` / `.git` entries in zip |
| 8 | Executable check | `snipset.exe` leaf exists before move |
| 9 | PATH add | user-level, de-duplicated |

For each: state `PASS`/`FAIL` with the line reference. If any FAIL, classify as code defect and describe the smallest fix (do not apply large rewrites).

## Windows Verification Report Template

Write to `docs/verification/2026-09-21-windows-report.md`:

```
# Snipset CLI Windows Verification Report
Date: <ISO date>
Environment: Windows host (RAM/storage constrained)
Method: manual source-code review (no Rust/Cargo, no builds, no network execution)

## Contract review
| # | Contract point | Verdict | Source line ref |
|---|---|---|---|
| 1 | SHA256SUMS | PASS/FAIL | install.ps1:L.. |
| ... (all 9 rows) |

## Negative guard
- Cargo/crates exposure: NONE (PASS)

## Tests cross-check
- tests/install.Tests.ps1 asserts tokens that install.ps1 satisfies: PASS/FAIL

## Optional (only if pwsh available and RAM-safe)
- `powershell.exe -NoProfile -Command "& { . tests/install.Tests.ps1 }"` result: <exit code>

## Findings
- <list any defects or confirm none>

## Verdict
- Production-ready for Windows x64: YES/NO (with reason)
```

---

## Open Decisions

- [ ] Should the Windows agent run the Pester test (`tests/install.Tests.ps1`) with `powershell.exe`, or rely purely on manual token review? (Default: manual review primary; runtime only if RAM-safe and no network fetch.)

## Blockers

- None for manual review. If the agent chooses to execute the test, it must NOT trigger `install.ps1` to download the release archive (that is out of scope here).

---

## Key Decisions Made

| Decision | Choice made | Rejected alternatives | Reason |
|---|---|---|---|
| Verification method | Manual source review | Full runtime install | RAM/storage-constrained target; no binary fetch |
| Rust/Cargo usage | Prohibited | None | Repo has no public Rust source; heavy toolchain wastes RAM |
| Deliverable | Windows report `.md` | Inline chat notes | Matches repo convention for verification artifacts |

## Files Modified This Session (on VPS)

```
A  docs/code-plan/plans/2026-09-21-verification.md
A  docs/verification/2026-09-21-report.md
```

## Git State

- **Last commit:** `558107c` — `docs(verification): verify snipset-cli production readiness`
- **Working tree clean:** Yes on VPS `main`; the Windows agent should pull this branch and commit its own Windows report.

---

## Resume Checklist (for next session)

- [ ] Read this handoff document fully
- [ ] Confirm you are on `belajarcarabelajar/snipset-cli` branch `main` (pull latest)
- [ ] Read `install.ps1` and `tests/install.Tests.ps1` before any conclusions
- [ ] Do the manual review checklist; do NOT run Rust/Cargo or fetch release binaries
- [ ] Write `docs/verification/2026-09-21-windows-report.md`
- [ ] Commit with a conventional message, author `Iwan Kurniawan <iwan@belajarcarabelajar.com>`, no co-author trailer
