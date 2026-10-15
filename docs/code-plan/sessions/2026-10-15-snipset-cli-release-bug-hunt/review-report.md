# Review report: release bug hunt fixes

Two independent `staid` reviewers read the uncommitted session diff on 2026-10-15 without seeing each other's report. Their findings are listed per axis in their own order, then the parent's resolution with evidence. A separate sibling-caller audit and an independent re-run are summarised after them.

## Axis 1: Standards

Verdict on the reviewed tree: `correct` (no P0 or P1). Evidence the reviewer ran: `build.mjs --check` exit 0, the 11 targeted test files 137 pass, `bun test tests/` 693 pass 0 fail, copy-rule scan of the diff 0 hits.

| # | Finding | Resolution | Evidence |
| --- | --- | --- | --- |
| S1 | [P2] Re-install with another `--db` (or without `--db`) left the old `export SNIPSET_DB` line in the bashrc block; `--check` stayed DRIFT. Introduced by this diff. | Fixed in `shell.sh`: `shell_block_scan` recognises an installer-shaped block whose only difference is the export line, and install rewrites it, uninstall removes it, `--check` names the case. | RED 8 pass 4 fail, GREEN 12 pass; neighbour suites 91 pass 0 fail; shellcheck exit 0 |
| S2 | [P3] An opencode file a v0.2.0 install wrote under `~/.config` was orphaned when `XDG_CONFIG_HOME` is set. | Fixed in `mcp.sh` and `mcp.ps1`: the older file is used while no `$XDG_CONFIG_HOME` file exists; `modes.sh` `dirs_candidates` also lists `~/.config/opencode` so uninstall removes the empty directories v0.2.0 recorded. | Parent RED with the fallback lines removed: `mcp probe: upgrade uninstall removes the empty v0.2.0 opencode dirs` and `ps1 mcp probe: an older opencode file ...` each 1 fail; GREEN targeted suites 111 pass 0 fail |
| S3 | [P3] README exit code 2 said "an empty value" but `--version ""` exits 0. | README row narrowed to "an empty path value or one that starts with `-`". | README diff; `tests/readme-install.test.mjs` 24 pass |

Design notes (non-blocking, harvested by the debt sweep): the no-final-newline rule exists twice (awk in `pathenv.sh`, bash in `shell.sh`); `shell_block_lines legacy` selects a shape by string flag. Pre-existing: `modes.sh` dry run always prints `[DRY] shell block: add to`, even when the block exists.

## Axis 2: Spec

Verdict on the reviewed tree: `not correct` (one P1). Every R-id was built; 25 of 30 new shell tests, 7 of 8 PowerShell tests, and 30 of 39 live-wrapper tests go red against HEAD-only bundles; the rest are declared regression guards.

| # | Finding | Resolution | Evidence |
| --- | --- | --- | --- |
| P1 | [P1] T08 probe regex `\{[^{}]*"command"` could not step over a nested object (`environment`, `env`) before `command`, so a valid opencode or cursor entry became `foreign` (HEAD said OK) and disagreed with the parsed `install.ps1` result. | Fixed: the object body is `\{([^{}]|\{[^{}]*\})*"command"`, one nested level stepped over, deeper nesting stays foreign; capture index moved to 2. | Parent probe before the fix: `foreign` for the nested entry, `mine` for the flat one. Test `mcp probe: an entry with a nested object before command is still ours`: RED 4 pass 1 fail, GREEN 30 pass 0 fail |

No scope creep needing action: `<leaf> --help`/`-h` skip the wrapper gate (help never opens the database; no v0.2.0 leaf rebinds `-h`), and the drift test gained `SNIPSET_DRIFT_BIN`.

## Sibling-caller audit

All consumers of the changed functions are OK for new installs: `args.sh` path values (every part), `shell_block_*` (7 call sites in `shell.sh`), `fetch_resolve_version` (dry run, install, update), `mcp_file`/`mcp_probe` state handling, the PowerShell siblings, the live wrapper docs, and the package manifests (they never call the installer). Two items, both recorded for the debt sweep:

- A v0.2.0 install made with relative paths keeps its relative bashrc block after a re-install with the new installer (the block matches neither shape, so it is kept as edited). Fail-safe (nothing deleted); that install never worked from another directory.
- The `install.sh --help` line for `--with-mcp` still named `~/.config/opencode`; fixed in `args.sh` and its pin in `tests/installer-build.test.mjs`.

## Independent re-run

`build.mjs --check` exit 0; the ten new test files each run twice with identical counts; `install-args-shape`, `install-shell-fixes`, `install-fetch-errors` go red on a HEAD-only bundle (first failures: relative path in bashrc, `touch: cannot touch ... bashrc`, `22 !== 1`); an end-to-end run with the real v0.2.0 assets from a relative cwd (`--install-dir rbin --share-dir rshare --db data/s.db --bashrc ~/.config/bash/bashrc --add-path`) gives `check: CURRENT`, `snipset` found from `/` in a clean login shell, `SNIPSET_DB` exported, and uninstall leaves only the database.

## Verdict after resolution

Both axes' blocking findings (P1) and the non-blocking ones (P2, P3) are resolved with a failing-then-passing test each. Final evidence is in the progress log and the PR body.

Not read: Windows PowerShell 5.1 at runtime (pwsh 7 only), zsh at runtime (not installed), real Windows.
