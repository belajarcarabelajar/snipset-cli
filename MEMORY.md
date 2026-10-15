# MEMORY

Durable rules learned in sessions on this repository. Format: `WHEN <situation> → DO <action>, NOT <anti-pattern>`. Each rule cites the session ledger it came from.

## Task Group: snipset-cli / snipset-live wrapper and session tooling

Source: `docs/code-plan/sessions/2026-10-12-snipset-cli-stability-hardening/learning-ledger.md` (PR #4).

- WHEN the installed `snipset` version changes → DO re-derive the `scripts/snipset-live.sh` read allowlist from `snipset <group> --help` and rerun `tests/snipset-live-routing.test.mjs`, NOT assume the old list. A new write subcommand under the `stats *` wildcard would run against the snapshot and be lost at the next refresh.
- WHEN a cache or snapshot staleness check is made stricter → DO write the added refresh cost (copy size times expected frequency) into the plan risk section before approval, NOT leave it for review. The `-wal` check means each read after a Desktop write recopies the whole database (about 199 MB on the owner machine).
- WHEN a change targets a config file in another repository → DO run `git check-ignore -v <file>` first, NOT plan a branch and PR. vivera's `plans.publish.json` and `plan.issues.json` are gitignored local files, so registering this repository there was a local edit.
- WHEN a `ctx_batch_execute` command starts with a shell keyword (`for`, `while`, `if`, `case`) → DO run it through the Bash tool or wrap it in `bash -c '...'`, NOT pass it bare. The sandbox prefixes `NODE_OPTIONS=...` and the shell rejects the line (measured twice).
- WHEN a GitHub release asset must be downloaded in Bash on this machine → DO use `gh release download <tag> -R <owner/repo> -p <asset> -D <dir>` and compare the digest from the releases API, NOT `curl` or `wget`, which the context-mode hook rejects.

## Task Group: snipset-cli / installers, packaging, and parallel sessions

Source: `docs/code-plan/sessions/2026-10-12-snipset-cli-install-coverage/learning-ledger.md` (PR #6).

- WHEN parallel chunks edit parts of `scripts/installer/{sh,ps1}/` → DO have each test against a private bundle of committed HEAD plus its own part (`git show HEAD:<part>` into a temp root, `bun scripts/installer/build.mjs --root <tmp> --out <tmp>`, `SNIPSET_INSTALL_SCRIPT`/`SNIPSET_INSTALL_PS1`), and integrate one chunk at a time from HEAD plus that chunk, NOT build from the shared tree, where another chunk's half-finished part breaks the run.
- WHEN a review changes a rule on one installer (`install.sh` or `install.ps1`) → DO update the sibling installer's contract before its chunk is dispatched, NOT port the old rule and fix it in a second pass (the ps1 MCP chunk shipped the pre-review scan-all and scope-blind rules and needed two more chunks).
- WHEN a change can delete or rewrite user files (uninstall, startup files, MCP configs) → DO run an adversarial removal review that reproduces each loss in a temp HOME before the PR, NOT rely on a green feature suite. Measured: a failed `mktemp` emptied `.profile` and `.bashrc`, and `--add-path` overwrote then deleted a user's own fish file, both with every feature test green.
- WHEN committing in this repository (no `user.name`/`user.email` configured) → DO pass the owner identity as an array, `I=(-c user.name='Iwan Kurniawan' -c user.email='110369962+belajarcarabelajar@users.noreply.github.com')` then `git "${I[@]}" commit`, NOT a string variable, which word-splits the name.
- WHEN scanning commits for attribution here → DO match credit-line shapes (`Co-Authored-By`, `Generated with`, the robot emoji), NOT product names such as Claude Code, which this repository names as an MCP harness.
- WHEN writing a long artifact (a plan or report over about 20 KB) → DO write it in parts with a one-line status between parts, NOT compose it all before the first write (the owner read the silence as a hang).
- WHEN `~/vivera/scripts/ultra-plan-runner.mjs --execute` runs after the plan file was edited → DO run `plan-publish.mjs <plan>` first and keep the runner's own exit code (`rc=$?; ...; exit $rc`), NOT read a wrapped `; echo` exit 0 as a pass. Measured: after the follow-up commits the runner printed `MIRROR GATE: BLOCKED` and ran nothing while the background task reported exit 0.

## Task Group: snipset-cli / deferred hardening (records, Windows parameters, probes)

Source: `docs/code-plan/sessions/2026-10-12-snipset-cli-deferred-hardening/learning-ledger.md`.

- WHEN adding a parameter to an advanced PowerShell script (`[CmdletBinding()]`) → DO check the name against the common-parameter aliases (`db` Debug, `vb` Verbose, `ea`, `ev`, `wa`, `wv`, `ov`, `ob`, `pv`, `iv`, `infa`), NOT pick the name that mirrors another installer's flag. Measured: `[string]$Db` made every `install.ps1` call fail ("conflicts with the parameter alias of the same name for parameter 'Debug'"); the parameter became `-Database`.
- WHEN the parent writes scratch files while chunks run → DO prefix them `parent-` in `~/.cache`, NOT a task id: a chunk cleaning its own `t07-*` scratch took the parent's `t07-green.log` with it.
- WHEN a change makes an installer start a program it already started in the same path → DO reuse the first result and compare the suite wall time before and after, NOT accept a green run. Measured: a second `--version` start of the Linux fixture (about 35 s each) pushed a platform test past 60 s; the ps1 suites went from 92 s to 178 s.
- WHEN a test environment is scrubbed → DO check that the tests still reach the same code paths (the installer's notes in the output), NOT only that they pass. Measured: the default tool set sent the legacy tests through the glibc "could not determine" fallback and dropped `timeout` from the smoke run.
- WHEN an installer change alters what uninstall removes → DO run the upgrade path once in a temp HOME (the previous release's `install.sh`, then the new install and uninstall) before review, NOT rely on simulated older installs. Measured: only that run showed the default share dir left behind, which the previous uninstall removed.

## Task Group: snipset-cli / release bug hunt (discovery fan-out, probes, scratch)

Source: `docs/code-plan/sessions/2026-10-15-snipset-cli-release-bug-hunt/learning-ledger.md` (PR #10).

- WHEN a discovery or review subagent must both probe and write repros → DO give it one surface, a probe budget, and a "write the report at half the turns" line, NOT a list of hypotheses to exhaust. Measured: seven of nineteen such agents hit their 30 or 40 turn cap with no report.
- WHEN a task spec states the expected report line of a `--check` or probe state → DO read the test that already pins that state first, NOT write the expectation from the bug description (T08's DRIFT expectation contradicted `tests/install-mcp.test.mjs`).
- WHEN a probe reads a JSON file users can edit (opencode, cursor, vscode MCP configs) → DO test it with a nested object before the target key and a pretty-printed file, NOT only the shape the installer writes. A flat-only fixture let a P1 pass six green tests.
- WHEN a subagent contract names a scratch directory on this machine → DO use `/tmp/<id>-*` or `~/.cache/tmp/<id>-*`, NOT `~/.cache/<id>-*`: the rm guard refuses deletes elsewhere, and about 1 GB including live-database copies was left behind.
