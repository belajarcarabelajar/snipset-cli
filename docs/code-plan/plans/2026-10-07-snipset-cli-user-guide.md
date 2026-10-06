---
schema: ultra-plan/v1
plan_id: 2026-10-07-snipset-cli-user-guide
status: Complete
version: 1
runner_contract: false
defaults:
  retry_transient_max: 1
  step_timeout_s: 300
  on_precondition_fail: stop-task-continue-independent
tasks:
  - id: T1
    depends_on: []
    files: { create: [docs/user-guide/README.md], modify: [], test: [] }
    idempotency_key: "T1:user-guide-index"
    skip_if: "test -f docs/user-guide/README.md"
    verify_exit: 0
  - id: T2
    depends_on: [T1]
    files: { create: [docs/user-guide/getting-started.md], modify: [], test: [] }
    idempotency_key: "T2:getting-started"
    skip_if: "test -f docs/user-guide/getting-started.md"
    verify_exit: 0
  - id: T3
    depends_on: [T1]
    files: { create: [docs/user-guide/snippets.md], modify: [], test: [] }
    idempotency_key: "T3:snippets-workflow"
    skip_if: "test -f docs/user-guide/snippets.md"
    verify_exit: 0
  - id: T4
    depends_on: [T1]
    files: { create: [docs/user-guide/commands.md], modify: [], test: [] }
    idempotency_key: "T4:command-reference"
    skip_if: "test -f docs/user-guide/commands.md"
    verify_exit: 0
  - id: T5
    depends_on: [T1]
    files: { create: [docs/user-guide/mcp.md], modify: [], test: [] }
    idempotency_key: "T5:mcp-guide"
    skip_if: "test -f docs/user-guide/mcp.md"
    verify_exit: 0
  - id: T6
    depends_on: [T1]
    files: { create: [docs/user-guide/live-database.md], modify: [], test: [] }
    idempotency_key: "T6:live-database"
    skip_if: "test -f docs/user-guide/live-database.md"
    verify_exit: 0
  - id: T7
    depends_on: [T2, T3, T4, T5, T6]
    files: { create: [], modify: [README.md], test: [] }
    idempotency_key: "T7:readme-crosslink"
    skip_if: "grep -q 'docs/user-guide' README.md"
    verify_exit: 0
---

# Snipset CLI User Guide Plan

> Frontmatter above is the single source of truth for routing, dependency order, retry, and idempotency. Prose below only explains and must never contradict it.

## 1. Intent & Scope

- **Goal:** Add a task-oriented, user-facing `docs/user-guide/` set so a new user can install, create a standalone database, build snippet workflows, read every feature surface, run the MCP server, and query the live Desktop database, grounded entirely in the installed `snipset 0.2.0` binary's own `--help` output and real command runs.
- **Non-Goals:** Changing the private Rust CLI binary; documenting undocumented or private internals; duplicating the installer/uninstaller reference the README already owns; adding macOS or ARM content; shipping release notes.
- **Acceptance Criteria:**
  - [x] AC-1: `docs/user-guide/README.md` indexes the five guide pages, exit 0 on `test -f`.
  - [x] AC-2: Every top-level command named in the guide exists in `snipset --help` (17 commands), cross-checked against captured output.
  - [x] AC-3: Every flag and possible-value shown is copied from real `snipset <cmd> --help`, not invented. Spot-verified for `snippet add`, `import`, `export`, `snippet expand`.
  - [x] AC-4: All runnable examples use a throwaway `/tmp` database or `--db`, never the live Desktop database path, and the live-DB page routes reads through `scripts/snipset-live.sh`.
  - [x] AC-5: `README.md` cross-links the new guide; `grep -q 'docs/user-guide' README.md` exits 0.
  - [x] AC-6: Codebase language is English; no em dash in any new file.
  - [x] AC-7: Existing test suite stays green (`bun test tests/`, exit 0), proving the docs addition introduces no regression.

## 2. Evidence Base

- Authoritative command surface captured from installed `snipset 0.2.0`:
  top-level `doctor init snippet group clipboard audio journal task note pomodoro stats reference support settings import export mcp`; global flags `--db <PATH>`, `--json`, `-h/--help`, `-V/--version`.
- Real command runs on a throwaway `/tmp` database verified `init`, `doctor`
  (`journal_mode: wal`, `schema_match: true`), `group add`, `snippet add`,
  `snippet list`, `snippet list --json`, `stats overview`.
- MCP verified against its primary source
  (`https://modelcontextprotocol.io/introduction`, retrieved 2026-10-07): an
  open standard for connecting AI applications to external systems; matches the
  binary's `snipset mcp` description ("Run the Model Context Protocol server
  over stdio") and the installer's `~/.config/opencode/opencode.json` block.

## 3. Tasks

### Task T1: user-guide index (P2)
- Create `docs/user-guide/README.md` linking the five pages and stating the version the guide was written against.

### Task T2: getting started (P1)
- Install pointer to README, `snipset init`, `snipset doctor`, first snippet, where the default database lives, bridge-vs-DB-only distinction.

### Task T3: snippet workflow (P1)
- Groups, `snippet add/list/search/get/update/delete`, `snippet expand` template variables, `import`/`export` with real flags and possible values.

### Task T4: command reference (P2)
- One table per command group covering all 17 commands and their subcommands, with the bridge requirement called out per command.

### Task T5: MCP guide (P2)
- What MCP is (cited), `snipset mcp` over stdio, the opencode config block the installer writes, `--with-mcp`.

### Task T6: live database guide (P1)
- Read vs gated-write model of `scripts/snipset-live.sh`, snapshot staleness, bridge-dependent commands, never touching the live file for reads.

### Task T7: README cross-link (P3)
- Add a short "User guide" pointer in `README.md` to `docs/user-guide/`.

## 4. Verification Matrix Before Completion

| Check | Command | Exit Code | Fresh Evidence | Status |
|---|---|---|---|---|
| Index exists | `test -f docs/user-guide/README.md` | 0 | file present | Verified |
| No em dash | `! grep -rl "—" docs/user-guide` | 0 | 0 matches | Verified |
| README cross-link | `grep -q 'docs/user-guide' README.md` | 0 | match present | Verified |
| Command parity | manual cross-check vs captured `snipset --help` | n/a | 17/17 commands match | Verified |
| Full suite | `bun test tests/` | 0 | all pass / 0 fail | Verified |

## 5. Human Approval Gate

- [x] Partner / Human approval received: user directed delivery of this session's PR via the super-ultra-code-plan contract.
