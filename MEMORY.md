# MEMORY

Durable rules learned in sessions on this repository. Format: `WHEN <situation> → DO <action>, NOT <anti-pattern>`. Each rule cites the session ledger it came from.

## Task Group: snipset-cli / snipset-live wrapper and session tooling

Source: `docs/code-plan/sessions/2026-10-12-snipset-cli-stability-hardening/learning-ledger.md` (PR #4).

- WHEN the installed `snipset` version changes → DO re-derive the `scripts/snipset-live.sh` read allowlist from `snipset <group> --help` and rerun `tests/snipset-live-routing.test.mjs`, NOT assume the old list. A new write subcommand under the `stats *` wildcard would run against the snapshot and be lost at the next refresh.
- WHEN a cache or snapshot staleness check is made stricter → DO write the added refresh cost (copy size times expected frequency) into the plan risk section before approval, NOT leave it for review. The `-wal` check means each read after a Desktop write recopies the whole database (about 199 MB on the owner machine).
- WHEN a change targets a config file in another repository → DO run `git check-ignore -v <file>` first, NOT plan a branch and PR. vivera's `plans.publish.json` and `plan.issues.json` are gitignored local files, so registering this repository there was a local edit.
- WHEN a `ctx_batch_execute` command starts with a shell keyword (`for`, `while`, `if`, `case`) → DO run it through the Bash tool or wrap it in `bash -c '...'`, NOT pass it bare. The sandbox prefixes `NODE_OPTIONS=...` and the shell rejects the line (measured twice).
- WHEN a GitHub release asset must be downloaded in Bash on this machine → DO use `gh release download <tag> -R <owner/repo> -p <asset> -D <dir>` and compare the digest from the releases API, NOT `curl` or `wget`, which the context-mode hook rejects.
