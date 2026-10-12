# Session Learning Ledger: snipset-cli install coverage

## 1. Identity

- **Session:** `install-coverage` (PR #6, issue #5)
- **Plan file:** `docs/code-plan/plans/2026-10-12-snipset-cli-install-coverage.md`
- **Written at:** 2026-10-12
- **Preconditions:** all 25 plan tasks and every review fix checked with evidence; T25 green at `2e4801a`; runner `--execute` exit 0.

## 2. Mistake Log

| # | Category | Trigger (what I did) | Signal | Cost | Correct move |
|---|---|---|---|---|---|
| 1 | `premature-guess` | Composed the whole 25-task plan (about 70 KB) before the first write, with no output for a long time | The owner interrupted: "its stuck" | one interrupted turn | Write a long artifact in parts (frontmatter, contract and map, tasks, record) with a one-line status between parts |
| 2 | `tool-misfire` | Stored the commit identity in `G="git -c user.name=Iwan Kurniawan ..."` and ran `$G commit` | `git: 'Kurniawan' is not a git command` | 1 call, nothing committed | Use an array, `I=(-c user.name='Iwan Kurniawan' -c user.email=...)`, and `git "${I[@]}" commit` |
| 3 | `premature-guess` | Wrote "17 existing tests" for `tests/install.test.mjs` into the plan and two contracts | A subagent counted 14 (the 17 included the three ps1 tests) | 6 text fixes | Derive a count with a command (`rg -c '^test\('`) in the step that writes it |
| 4 | `rule-miss` | After review wave 1 changed the Linux MCP rules (uninstall only the `--with-mcp` list, scope-safe Claude removal), dispatched the ps1 MCP chunk with the old rules | The ps1 MCP report described scan-all-six and no scope check | two extra chunks (C15 call-site change, C16b) | When a review changes a rule on one installer, update the sibling installer's contract before its dispatch |
| 5 | `rule-miss` | Sent the "uninstall uses the `--with-mcp` list" amendment to C12 while its first run was finishing | The first report still printed "scans all six" in the help text | one resumed run | Amend a running chunk only through `SendMessage` and wait for the second report before integrating |
| 6 | `tool-misfire` | Planned the T25 attribution scan as `rg -i "co-authored-by|generated with|claude code"` | The scan flagged a commit body that lists Claude Code as an MCP harness | 1 plan edit | Scan for credit-line shapes (`Co-Authored-By`, `Generated with`, the robot emoji), not product names that are content here |
| 7 | `rule-miss` | Accepted unit-level green for the uninstall paths before an adversarial review | Review wave 1 reproduced a P0 (a failed `mktemp` emptied `.profile` and `.bashrc`), review wave 3 a P1 (a user's own fish file overwritten then deleted) | four fix chunks | For code that deletes or rewrites user files, run an adversarial removal review with reproductions before the PR |
| 8 | `rule-miss` | After the follow-up commits, ran `ultra-plan-runner.mjs --execute ...; echo "runner rc=$?"` as a background task | The task reported exit 0; the log said `MIRROR GATE: BLOCKED` (mirror hash differed after the plan edits) and nothing had run | one wasted run and a false green signal | Publish the plan (`plan-publish.mjs`) before the runner, and keep the runner's own exit code (`rc=$?; ...; exit $rc`), per global rule A2 |
| 9 | `tool-misfire` | Retyped the PKGBUILD lint as `shellcheck -S warning -s bash PKGBUILD` | exit 1 with eleven SC2034, SC2154, SC2164 notes that the real gate excludes | 1 call | Copy a gate's command from the plan's `run[]` or its test (`tests/packaging-aur.test.mjs:130`), never retype it |
| 10 | `rule-miss` | Reran the runner without `SNIPSET_REAL_ASSETS`, which the passing run had set | T24 `FAILED-BLOCKING` exit 127 (`SNIPSET_REAL_ASSETS: set SNIPSET_REAL_ASSETS`), classified `environment`; T23 and T25 halted | one runner run | Rerun the runner with the environment the plan's own evidence line records for the last passing run |
| 11 | `premature-guess` | The debt sweep said `tests/install-ps1-mcp.test.mjs` was 503 lines, copied from a reviewer report | The F04 chunk measured 538 before its change | none (the finish line was "under 500") | Measure a count in the step that writes it (rule 7, NO-OP) |

Confirmed approaches (kept because they worked, not because they failed):

| # | Approach | Evidence |
|---|---|---|
| A | Parallel chunks that edit parts of one generated bundle each test against a private bundle of committed HEAD plus their own part, and the parent integrates one chunk at a time from HEAD plus that chunk | seven wave 4 chunks integrated with no cross-contamination; every intermediate commit kept its bundle consistent with its parts (three spot-checked with `git archive` by reviewer G) |
| B | Every review finding reproduced on HEAD as a failing test before its fix | each of the 4 P0/P1 findings has a RED run recorded in the plan checklist |

Facts measured this session that belong to the machine, not to this repository:

| # | Fact | Evidence |
|---|---|---|
| F1 | TinyFish `fetch_content` now requires a sixth parameter, `iframe_links`; `~/AGENTS.md` lists five | the C21 subagent's call without it was rejected; with all six `false` it worked |
| F2 | `~/vivera/scripts/check-copy-rules.mjs --diff origin/main` hard-codes vivera as its root, so run from another repository it scans vivera and reports 0 | reviewer D: "0 added line(s) since 47f87828", which is vivera's `origin/main` |
| F3 | Shell `rm` is denied for agents on this machine, so scratch dirs from subagents accumulate in `/tmp` and `~/.cache` | every subagent report listed scratch it could not delete |

## 3. Distilled Rules

| # | Candidate rule | Minimum-Signal | 30-Day Horizon | Keep? |
|---|---|---|---|---|
| 1 | WHEN writing a long artifact (a plan or report over about 20 KB) → DO write it in parts with a one-line status between parts, NOT compose it all before the first write | Y (the owner interrupted) | Y | KEEP |
| 2 | WHEN committing in snipset-cli (no `user.name` or `user.email` in its git config) → DO pass the owner identity through an array `I=(-c user.name='Iwan Kurniawan' -c user.email='110369962+belajarcarabelajar@users.noreply.github.com')` and `git "${I[@]}" commit`, NOT a string variable that word-splits the name | Y | Y | KEEP |
| 3 | WHEN parallel chunks edit parts of `scripts/installer/{sh,ps1}/` → DO have each test against a private bundle of committed HEAD plus its own part, and integrate one chunk at a time by building from HEAD plus that chunk, NOT build from the shared tree | Y | Y | KEEP |
| 4 | WHEN a review changes a rule on one installer (`install.sh` or `install.ps1`) → DO update the sibling installer's contract before its chunk is dispatched, NOT port the old rule and fix it in a second pass | Y | Y | KEEP |
| 5 | WHEN a change can delete or rewrite user files (uninstall, startup-file edits, MCP config) → DO run an adversarial removal review that reproduces each loss in a temp HOME before the PR, NOT rely on the feature suite being green | Y | Y | KEEP |
| 6 | WHEN scanning commits for attribution in this repository → DO match credit-line shapes (`Co-Authored-By`, `Generated with`, the robot emoji), NOT product names such as Claude Code, which this repository names as an MCP harness | Y | Y | KEEP |
| 7 | WHEN a plan states a count → DO derive it with a command in the same step | marginal (covered by the verification rule) | Y | NO-OP |
| 8 | WHEN amending a running chunk → DO wait for its next report before integrating | N (the harness already delivers a second report) | N | NO-OP |
| 9 | WHEN `ultra-plan-runner.mjs --execute` runs after the plan file changed → DO run `plan-publish.mjs <plan>` first and read the runner's own exit code, NOT trust a wrapper's exit 0 | Y (the gate prints `MIRROR GATE: BLOCKED` and runs nothing) | Y | KEEP |
| 10 | WHEN rerunning a verification gate by hand → DO copy its command from the plan's `run[]` or its test | marginal (covered by the verification rule) | Y | NO-OP |

## 4. Promotion Decision

| Item | Destination | Why | Approval |
|---|---|---|---|
| Rules 1 to 6 and 9 | in-repo `MEMORY.md` (auto) | rules 2, 3, 4, 6 are specific to this repository; 1 and 5 are general but were measured here first | not required |
| F1 (TinyFish six parameters) | `~/AGENTS.md` correction of the "TinyFish fetch_content" block | machine-wide; the global note was wrong (live schema `required` re-read 2026-10-12) | approved 2026-10-12 (`Promote`); applied, backup `~/AGENTS.md.bak-20261012-tinyfish-iframe` |
| F2 (vivera copy-rules root) | `~/AGENTS.md` block with rule A27 | applies to every repository that borrows vivera's scripts (`check-copy-rules.mjs:55` and `mainDiff` re-read 2026-10-12) | approved 2026-10-12 (`Promote`); appended, backup `~/AGENTS.md.bak-20261012-copy-rules-root` |
| F3 (scratch with rm denied) | none | a property of the current permission setting, recorded in `~/AGENTS.md` already | not required |
