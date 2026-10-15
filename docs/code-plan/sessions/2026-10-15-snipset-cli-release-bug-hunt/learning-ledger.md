# Session Learning Ledger: release bug hunt

## 1. Identity

- **Session:** `release-bug-hunt`
- **Plan file:** `docs/code-plan/plans/2026-10-15-snipset-cli-release-bug-hunt.md`
- **Written at:** 2026-10-15
- **Preconditions:** plan tasks done, whole suite green (702 pass, 0 fail), PR #10 open.

## 2. Mistake Log

| # | Category | Trigger (what I did) | Signal (how it surfaced) | Cost | Correct move |
|---|---|---|---|---|---|
| 1 | `rule-miss` | Gave discovery chunks a broad hypothesis list plus "write a red repro for each" | H04, H08, H10, H11, H14 and the spec and sibling reviewers hit their 30 or 40 turn caps with no report | 7 continuation messages | One surface per chunk, an explicit probe budget, and "write the report when half the turns are used" |
| 2 | `premature-guess` | Wrote T08's expected `--check` result (DRIFT) without reading the test that already pins that state | T08 found `tests/install-mcp.test.mjs` asserting KEEP, not DRIFT; plan text amended | 1 plan revision | Read the existing test for a state before writing a task's expected output |
| 3 | `rule-miss` | Accepted T08's structural JSON probe with only flat fixtures | Spec reviewer: a valid entry with `env` before `command` became `foreign` (P1) | 1 follow-up chunk | Fixtures for a user-edited file include a nested object and pretty-printing |
| 4 | `wrong-tool` | Put subagent scratch under `~/.cache/<id>-*` | The rm guard blocks deletes outside /tmp and ~/.cache/tmp; about 1 GB, including live-database copies, was left behind | cleanup question at close | Scratch under `/tmp/<id>-*` or `~/.cache/tmp/<id>-*` |
| 5 | `tool-misfire` | Chained `sed && rg -c ... && cd ~/vivera && bun ...` | `rg -c` printed nothing, the chain stopped before `cd`, the later commands ran from the wrong directory (exit 1) | 2 calls | Separate state checks from the command that changes directory, or use absolute script paths |

## 3. Distilled Rules

| # | Candidate rule | Minimum-Signal | 30-Day Horizon | Keep? | Kind |
|---|---|---|---|---|---|
| 1 | WHEN a discovery or review subagent must both probe and write repros → DO give it one surface, a probe budget, and a "report at half the turns" line, NOT a list of hypotheses to exhaust | Y (seven caps this session) | Y | KEEP | judgement |
| 2 | WHEN a task spec states the expected report line of a check or probe state → DO read the test that already pins that state first, NOT write the expectation from the bug description | Y | Y | KEEP | judgement |
| 3 | WHEN a probe reads a JSON file users can edit → DO test it with a nested object before the target key and a pretty-printed file, NOT only the shape the installer writes | Y (a P1 slipped past six green tests) | Y | KEEP | judgement |
| 4 | WHEN a subagent contract names a scratch directory on this machine → DO use `/tmp/<id>-*` or `~/.cache/tmp/<id>-*`, NOT `~/.cache/<id>-*`, because the rm guard refuses deletes elsewhere | Y | Y | KEEP | mechanical (a contract lint could flag `~/.cache/<id>`); global candidate, it applies to every repository here |
| 5 | WHEN chaining shell commands → DO avoid `rg -c` and other zero-output checks as `&&` links before a `cd` | N (generic shell knowledge) | Y | NO-OP | |

## Environment Improvements

| # | Kind | What happened | Proposed change | Keep? |
|---|---|---|---|---|
| 1 | `information-access` | `tests/install-real-assets.test.mjs` skips in a plain `bun test tests/`, so the baseline never touched the real release | none here: the skip message names `SNIPSET_REAL_ASSETS`; the plan profile now records it | NO-OP |
| 2 | `tool-economy` | discovery repros lived in scratch and had to be re-pointed at the new bundle by copying `install.sh` into two repro dirs | repro scripts take the installer path from an env var (H01, H02, H12 already did) | NO-OP (scratch, not repository) |

Steering no-ops: none found.
