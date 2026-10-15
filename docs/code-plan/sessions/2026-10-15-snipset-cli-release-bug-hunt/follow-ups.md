# Session-Close Debt Sweep: release bug hunt

## 1. Preconditions

| Check | Evidence | Status |
|---|---|---|
| Plan tasks T01 to T10 done | plan checklist, each item with evidence | done |
| Verification gate green | `bun test tests/` exit 0, 702 pass, 0 fail; `build.mjs --check` exit 0; real-asset suite 4 pass | done |
| Final diff audited, PR open and registered | PR #10, `pr-registry status` shows `open #10` | done |
| Blocked items excluded | none blocked; upstream items are a separate repository, recorded as LATER | done |

## 2. Harvested Debt Candidates

| # | Source | Candidate (outcome + path + finish line) | Class | Est. |
|---|---|---|---|---|
| D1 | flaky test seen in this session | `tests/pentest-core.test.mjs`: the CLI-spawning tests use bun's 5 s default; give them an explicit timeout so a loaded machine does not kill `snipset --json snippet list`; finish: file passes, timeout visible in the test | NOW | S |
| D2 | T02 report, spec review | `scripts/installer/sh/modes.sh` dry run: `--dry-run --version X --from /missing` exits 0 while the real run fails; check `SHA256SUMS` and the archive exist and move the `install-cli` fixture to a real release dir; finish: new test red then green | NOW | S |
| D3 | H07 note | `scripts/snipset-live.sh:94`: the doctor gate discards doctor's stderr, so a refused write never says why; print it on refusal; finish: test asserts the doctor message reaches stderr | NOW | S |
| D4 | standards review, pre-existing | `scripts/installer/sh/modes.sh:70`: the dry run always prints `[DRY] shell block: add to`, even when the block exists or would be upgraded; finish: test for each case | NOW | S |
| D5 | pre-existing warning | `scripts/installer/sh/pathenv.sh` SC2016 info on the awk program; add a scoped `# shellcheck disable=SC2016` with the reason; finish: `shellcheck -s bash` exit 0 on every part | NOW | S |
| D6 | sibling audit | `tests/install-ps1-cli.test.mjs`, `tests/install-ps1-lifecycle.test.mjs` copy `process.env` without clearing `XDG_CONFIG_HOME`; finish: both scrub it, suites green | NOW | S |
| D7 | H08 note | README Windows section does not repeat that the `v0.2.0` one-liner URL 404s until the Draft is published; finish: README line plus `readme-install` pass | NOW | S |
| D8 | sibling audit | a v0.2.0 install made with relative paths keeps its relative bashrc block after reinstall | LATER | M |
| D9 | owner decision | R13 `mcp_check` ignores `--db`; R14 `db_check` after `--no-init` | LATER | S |
| D10 | design note | no-final-newline rule written twice (awk in `pathenv.sh`, bash in `shell.sh`) | LATER | M |
| D11 | design note | MCP probe steps over one nested object only; deeper nesting reads `foreign` | LATER | S |
| D12 | owner decision | `snipset-live.sh` keeps `pomodoro status/config/sessions` gated | LATER | S |
| D13 | H03 note | usage errors print the full help without naming the bad argument; `-h --bogus` exits 0 but `--bogus -h` exits 2 | LATER | S |
| D14 | upstream | U1 to U22 in `~/Proyek/Snipset` (three P1) | LATER | L |
| D15 | scratch | about 1 GB of scratch outside /tmp (`~/.cache/h0*`, `h1*`, `h04-work`, `h01-sbx-shims`, `parent-v020/live-copy.db`), including copies of the live database | asked separately (destructive) | S |

## 3. Ranked Follow-Up Set

Ranked by leftover risk x blast radius x cheapness:

1. D1 pentest-core timeout (a red run seen this session; whole-suite reliability) (recommended)
2. D2 dry run `--from` parity (the dry run still promises what the real run refuses)
3. D3 live wrapper doctor message (users see a refusal without the cause)
4. D4 dry run shell block line
5. D5 shellcheck SC2016

D6 and D7 are over the cap and go to section 6.

## 4. The Question

Asked with one `AskUserQuestion` call after the recap; options and answers recorded in section 5.

## 5. Execution Record

Answer (2026-10-15): all five selected.

| Item | Task | RED then GREEN | Neighbour evidence |
|---|---|---|---|
| D1 pentest-core timeout | FU3 | load-dependent, no deterministic RED; 9/9 twice idle and twice under load | whole suite 710 pass 0 fail |
| D2 dry run `--from` parity | FU1 | 2/6 then 6/6 | 42 pass 0 fail |
| D3 doctor reason | FU2 | 1/2 then 2/2 | live suites 147 pass 0 fail |
| D4 dry run shell block line | FU1 | included above | as above |
| D5 SC2016 | FU4 | shellcheck exit 1 then 0 | every part exit 0 |

Re-pass: executing the batch created no new debt. The README companion section changed twice (R7 list, D3 sentence); its pinned hash in `tests/readme-install.test.mjs` was updated each time, which is the pin working as designed.

Final: `bun test tests/` exit 0, 710 pass, 6 skip, 0 fail, 716 tests in 51 files; real-asset suite 4 pass; `build.mjs --check` exit 0.

## 6. Deferred Backlog

- D6 `defer: next edit of the ps1 test env helpers, a test that writes MCP files without -DryRun`
- D7 `defer: the Draft is published or the next README edit, whichever is first`
- D8 `defer: one user with a v0.2.0 relative-path install, a report of DRIFT after reinstall`
- D9 `defer: owner contract call, a user report of --check drift after --no-init or a --db change`
- D10 `defer: the next change to either strip, a third copy of the rule`
- D11 `defer: a user config with a two-level nested object before command`
- D12 `defer: owner decision, a report of pomodoro status refused while the app runs`
- D13 `defer: next args.sh change, a user report of an unclear usage error`
- D14 `defer: separate Snipset session, the next CLI release`
