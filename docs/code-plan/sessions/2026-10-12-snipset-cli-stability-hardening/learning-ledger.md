# Session Learning Ledger: snipset-cli stability hardening

## 1. Identity

- **Session:** `stability-hardening` (PR #4, issue #3)
- **Plan file:** `docs/code-plan/plans/2026-10-12-snipset-cli-stability-hardening.md`
- **Written at:** 2026-10-12
- **Preconditions:** all eight plan tasks checked with evidence; T8 verification green after the review fixes.

## 2. Mistake Log

| # | Category | Trigger (what I did) | Signal | Cost | Correct move |
|---|---|---|---|---|---|
| 1 | `tool-misfire` | Ran a `for ... do ... done` loop as a `ctx_batch_execute` command, twice | `syntax error near unexpected token 'do'`: the sandbox prefixes `NODE_OPTIONS=... ` to the command, which breaks a command that starts with a shell keyword | 2 calls | Run loops through the Bash tool, or wrap them as `bash -c '...'` |
| 2 | `wrong-tool` | Downloaded the PowerShell tarball with `curl` in Bash | context-mode PreToolUse hook rejected `curl`/`wget` | 1 call | For a GitHub release asset, use `gh release download <tag> -R <owner/repo> -p <asset> -D <dir>`, then check the digest |
| 3 | `premature-guess` | Assumed registering `snipset-cli` in vivera needed a vivera branch and PR; claimed a session and created a worktree | `plans.publish.json` was absent from the fresh worktree; `git check-ignore -v` showed both configs are gitignored | 3 calls, one claim closed unused | Run `git check-ignore -v <file>` before planning a PR for a config change in another repository |
| 4 | `premature-guess` | Reported 18 binary-dependent failures from one run with a different PATH order | Recount in the worktree gave 17, stable over 4 runs in two directories | 1 correction to the owner | Quote a count only from the exact command the plan uses, run twice |
| 5 | `rule-miss` | Planned the stricter `-wal` staleness check without stating its refresh cost | Independent reviewer noted each read after a Desktop write recopies about 199 MB, and the wrapper header still promised no repeated copies | 1 extra fix commit (`1feb6fa`) | State size times expected frequency in the plan risk section when tightening a staleness check |
| 6 | `rule-miss` | Froze T3 scope to `README.md` only | The T1 impact check found `.opencode/commands/snipset-live.md` repeating the same wrong read list | 1 plan edit mid-execution | Before freezing a docs task, `rg -n '<surface name>'` across the whole repository, not only the README |
| 7 | `tool-misfire` | Wrote the C3 contract with line range "6 to 9" while also asking for a change on line 12 | Subagent flagged the inconsistency | none (subagent resolved it) | Derive line ranges from the edits requested, or omit them |

## 3. Distilled Rules

| # | Candidate rule | Minimum-Signal | 30-Day Horizon | Keep? |
|---|---|---|---|---|
| 1 | WHEN a `ctx_batch_execute` command starts with a shell keyword (`for`, `while`, `if`, `case`) → DO run it through the Bash tool or wrap it in `bash -c '...'`, NOT pass it bare, because the sandbox prefixes `NODE_OPTIONS=...` and the shell rejects it | Y (measured twice) | Y (until context-mode changes its prefix) | KEEP |
| 2 | WHEN a binary must be downloaded in Bash on this machine and it is a GitHub release asset → DO use `gh release download` and compare the digest from the releases API, NOT `curl`/`wget` (the context-mode hook rejects them) | Y | Y | KEEP |
| 3 | WHEN a change targets a config file in another repository → DO run `git check-ignore -v <file>` first, NOT plan a branch and PR; vivera's `plans.publish.json` and `plan.issues.json` are gitignored local files | Y | Y | KEEP |
| 4 | WHEN the installed `snipset` version changes → DO re-derive the `snipset-live.sh` read allowlist from `snipset <group> --help` and rerun `tests/snipset-live-routing.test.mjs`, NOT assume the old list; a new write under the `stats *` wildcard would be routed to the snapshot and lost | Y | Y | KEEP |
| 5 | WHEN a cache or snapshot staleness check is made stricter → DO write the added refresh cost (copy size times expected frequency) into the plan risk section before approval, NOT leave it for review | Y | Y | KEEP |
| 6 | WHEN reporting a test count from a modified environment → DO quote it from the exact plan command, run twice | marginal (covered by the existing verification rule) | Y | NO-OP |
| 7 | WHEN writing a subagent contract → DO derive line ranges from the requested edits | N (one-off, harmless) | N | NO-OP |

## 4. Promotion Decision

| Rule # | Destination | Why | Approval |
|---|---|---|---|
| 1, 2 | in-repo `MEMORY.md` (auto); `~/AGENTS.md` candidate | machine-wide tool behavior, recurs in every project | asked separately (header `Promote`) |
| 3 | in-repo `MEMORY.md` (auto) | about vivera configuration used by this repository's plan publishing | not required |
| 4, 5 | in-repo `MEMORY.md` (auto) | specific to this repository's wrapper | not required |

## 5. Carry-Forward Pointer

- [x] `KEEP` rules written in-repo: `MEMORY.md`, Task Group `snipset-cli / snipset-live wrapper and session tooling`.
- [ ] Global rules 1 and 2: pending the owner's `Promote` answer.
