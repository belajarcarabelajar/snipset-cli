# Session Learning Ledger: snipset-cli deferred hardening

## 1. Identity

- **Session:** `deferred-hardening` (snipset-cli, issue #7), run alongside `copy-rules-root` (vivera PR #89, issue #88)
- **Plan file:** `docs/code-plan/plans/2026-10-12-snipset-cli-deferred-hardening.md`
- **Written at:** 2026-10-12

## 2. Mistake Log

| # | Category | Trigger (what I did) | Signal | Cost | Correct move |
|---|---|---|---|---|---|
| 1 | `premature-guess` | Planned T06 as `[string]$Db` on a `[CmdletBinding()]` script without checking the common-parameter aliases | The chunk measured every call failing: "conflicts with the parameter alias of the same name for parameter 'Debug'" (45 pass, 25 fail) | one blocked chunk, one extra owner question, a plan amendment | Before naming a PowerShell parameter on an advanced script, check it against the common-parameter aliases (`db` Debug, `vb` Verbose, `ea`, `ev`, `wa`, `wv`, `ov`, `ob`, `pv`, `iv`, `infa`) |
| 2 | `premature-guess` | Wrote T03's gate as "the share-dir `rmdir` runs only when a record exists" next to "with no record, today's behaviour stays" | The chunk followed the dispatch prompt and named the contradiction | one plan edit | Re-read every gate condition in a task contract as a boolean before dispatch |
| 3 | `tool-misfire` | Wrote the vivera V2 step as `check-copy-rules.mjs README.md scripts/check-copy-rules.mjs` | exit 1: 31 pre-existing README em dashes and the script's own quoted patterns | one plan edit | Use the added-lines mode (`--diff origin/main`) for a copy check of a change, never whole-file mode on long-lived files |
| 4 | `tool-misfire` | Named a parent scratch log `~/.cache/t07-green.log` while chunk T07 cleaned its own `t07-*` scratch | The log was gone after the chunk finished; the green counts had to be rerun | one 3-minute rerun | Give parent scratch a prefix no chunk uses (`parent-`), never a task id |
| 5 | `rule-miss` | Ran the T10 runner with `--skip-mirror-gate` instead of publishing the plan first, the rule written earlier the same day | The runner printed the skip warning | none (republished before the PR) | Publish, then run the runner without the flag (MEMORY rule from install-coverage) |
| 6 | `rule-miss` | Accepted the T07 chunk's design of a second `--version` start to read the exit code | An existing platform test timed out at 60 s (one start of the Linux fixture takes about 35 s); the suites took 178 s instead of 92 s | one fix and one pin test | When a change starts a program a second time in the same path, reuse the first result and compare the suite wall time before and after |
| 7 | `rule-miss` | Accepted the T05 chunk's default tool set for the legacy tests | The chunk itself reported the glibc check now took its "could not determine" fallback and the smoke run lost `timeout` | one parent edit | When scrubbing a test environment, check that the tests still take the same code paths (the installer's notes in the output), not only that they pass |

Confirmed approaches:

| # | Approach | Evidence |
|---|---|---|
| A | When subagents died with a 429 session limit, the remaining chunks (T07 finish, T08) ran inline instead of a new wave (global rule A16) | T07 and T08 committed while the limit held |
| B | RED for a chunk whose files are mid-edit, taken on a `git archive HEAD` export with only the new test copied in | T07 RED 6 fail with the tree untouched |
| C | A chunk that stops on a contract-changing choice instead of picking one (T06 `-Db`) | the owner chose `-Database, strict`; no rework of a guessed design |
| D | A parent runtime probe of the upgrade path (old `install.sh`, new reinstall, new uninstall) before the review | found the share-dir regression that no unit test modelled |

## 3. Distilled Rules

| # | Candidate rule | Minimum-Signal | 30-Day Horizon | Keep? |
|---|---|---|---|---|
| 1 | WHEN adding a parameter to an advanced PowerShell script (`[CmdletBinding()]`) → DO check its name and every prefix-free alias against the common-parameter aliases (`db`, `vb`, `ea`, `ev`, `wa`, `wv`, `ov`, `ob`, `pv`, `iv`, `infa`), NOT pick the name that mirrors another installer's flag | Y | Y | KEEP |
| 2 | WHEN the parent writes scratch files while chunks run → DO prefix them `parent-` in `~/.cache`, NOT a task id a chunk also uses | Y | Y | KEEP |
| 3 | WHEN a change makes an installer start a program it already started in the same path → DO reuse the first result and compare the suite wall time before and after, NOT accept a green run (the Linux fixture probe takes about 35 s) | Y | Y | KEEP |
| 4 | WHEN a test environment is scrubbed → DO check the tests still reach the same code paths (installer notes in the output), NOT only that they pass | Y | Y | KEEP |
| 5 | WHEN an installer change alters what uninstall removes → DO run the upgrade path once (the previous release's `install.sh`, then the new install and uninstall) in a temp HOME before review, NOT rely on simulated older installs | Y | Y | KEEP |
| 6 | WHEN a copy check verifies a change → DO use `--diff <base>` | marginal (vivera-specific tool) | Y | NO-OP |
| 7 | WHEN writing a gate condition → DO re-read it as a boolean | N (generic) | Y | NO-OP |

## 4. Promotion Decision

| Item | Destination | Why | Approval |
|---|---|---|---|
| Rules 1 to 5 | in-repo `MEMORY.md` (auto) | measured here; rule 1 is PowerShell-general | not required |
| Rule 1 | `~/AGENTS.md` candidate | applies to every PowerShell script on this machine | asked separately (`Promote`) |
