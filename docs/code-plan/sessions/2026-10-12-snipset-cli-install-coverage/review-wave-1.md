# Review wave 1: Linux installer (2026-10-12)

Two independent read-only `staid` reviewers. Reports are inputs; each finding below was reproduced by the reviewer in a temp HOME unless marked DERIVED, and each fix is tracked to a chunk and a commit.

## Reviewer A: removal and check paths (HEAD `ff07a9b`)

Verdict: not correct (one P0, two P1).

| # | Sev | Status | Where | What happens | Fix |
|---|---|---|---|---|---|
| A1 | P0 | CONFIRMED | `pathenv.sh:60-67` | with `TMPDIR` missing, `mktemp` fails and `cat "" > "$file"` empties `.profile` (1804 to 0 bytes) and `.bashrc`, reports `[REMOVED]`, exits 0 | C12b: `rewrite_file` with a backup beside the file, `cmp`, restore on failure, `[FAIL]` and exit 1 |
| A2 | P1 | CONFIRMED | `modes.sh:82-89` | `--uninstall --dry-run` removes for real | C12 (`d46cc10`): refused with exit 2 |
| A3 | P1 | CONFIRMED | `mcp.sh:56-67,197` | Claude probe reads any scope, removal uses `--scope user`: a user-scope entry pointing elsewhere was deleted | C11b: ours only when `Scope:` is the user config and `Command:` is the installed binary |
| A4 | P2 | DERIVED | `mcp.sh:68-81,199` | same pattern for Gemini | C11b: scope decided from `~/.gemini/settings.json` |
| A5 | P2 | CONFIRMED | `mcp.sh:57,165` | `--check` with Claude on PATH runs `claude mcp get`, which writes Claude's own state files | documented as a known limit (T23); no CLI call without `--with-mcp` (C11b) |
| A6 | P2 | CONFIRMED | `mcp.sh:189` | uninstall probes all six harnesses without `--with-mcp` | C11b: only the listed ids; C12 help text updated |
| A7 | P2 | CONFIRMED | `shell.sh:95-102,125` | `--no-shell` uninstall deletes a user's share-dir files and the dir | C12b: skip when `--no-shell`; symlinks kept |
| A8 | P3 | CONFIRMED | `pathenv.sh:144,152` | the unmarked legacy line may be the user's own | C12b: kept with a hint |
| A9 | P3 | CONFIRMED | `binary.sh:107-108` | a symlinked `snipset` is removed | C12b: kept |
| A10 | P3 | DERIVED | `shell.sh:122` | `printf > "$bashrc"` truncates before a write that can fail | C12b: `rewrite_file` |

Safe cases the reviewer ran (kept for the record): exact byte restore of `.bashrc` and `.profile` (case A); symlinked `.bashrc` with the block mid-file and no final newline (H); `.profile` without a final newline (I); HOME with spaces, a quote, brackets, and `*` (G); hostile shim manifest names `../outside`, `..`, empty, a directory, a symlink, `*`, `-rf` (L); OpenCode file removed only when byte-identical (M); `--check` without Claude leaves the snapshot identical (F2); `snipset 0.2.0 --version` writes nothing (O); the database is never touched.

## Reviewer B: platform, fetch, CLI, tests (HEAD `ff07a9b`)

Verdict: no P0 or P1.

| # | Sev | Status | Where | What happens | Fix |
|---|---|---|---|---|---|
| B1 | P2 | CONFIRMED (fakeroot) | `binary.sh:19` | as root, `tar -xzf` keeps the archive's owner (`4242:4242` seen), so a root install is owned by the packer's uid | C06b: `--no-same-owner --no-same-permissions` |
| B2 | P3 | CONFIRMED | `binary.sh:8-11` | the entry listing is read through process substitution, so a failing `tar` lists nothing and an unsafe `-x` member installs | C06b: capture the listing with an explicit failure check |
| B3 | P3 | CONFIRMED | `binary.sh:12` | a failing `tar -tvzf` reads as "no symlinks" | C06b: same |
| B4 | P2 | DERIVED | `fetch.sh:13-23` | nothing forces HTTPS; `curl -L` follows an https to http redirect, `SNIPSET_RELEASE_BASE_URL` accepts http | C06b: curl `--proto '=https' --proto-redir '=https'`; refuse a non-https base URL unless it is the test fixture host; document the wget redirect limit |
| B5 | P3 | DERIVED | bundle (`mapfile`, empty arrays under `set -u`) | real minimum is bash 4.4, unchecked; plan said "bash 4+" | C06b: `BASH_VERSINFO` check in `lib.sh`; plan corrected |
| B6 | P2 | CONFIRMED (mutation) | tests | the archive entry and symlink guard has no test (reverted, 139 still pass) | C06b: tests for a `-x`, a `../`, and a symlink member |
| B7 | P2 | CONFIRMED (mutation) | tests | the SHA256SUMS version check, the only thing keeping `--from` inside its dir, has no test | C06b: a `--from` test with `/../` in the name |
| B8 | P3 | CONFIRMED (mutation) | tests | `</dev/null` on harness CLIs is untestable because the helper always gives stdin `ignore` | backlog: `defer: a bash -s pipe test with a stdin-counting stub, upgrade-trigger: a report of a curl | bash install hanging on a harness CLI` |
| B9 | P3 | CONFIRMED (pre-existing) | `tests/install.test.mjs:72` | the `snipset-archive-*` staging dir leaks, 13 per run | C06b: remove it after packing |
| B10 | P3 | DERIVED | `tests/install.test.mjs:129-176` | full `process.env` and the real PATH reach the installer; isolation holds by luck | backlog: `defer: the 14 legacy tests keep process.env, upgrade-trigger: an installer path that reaches a real harness CLI or wget from those tests` |

Mutation table (baseline 139 pass): checksum compare reverted, 2 red; smoke reverted, 3 red; entry and symlink guard reverted, 0 red (B6); glibc floor reverted, 2 red; SHA256SUMS version check reverted, 0 red (B7); MCP stdin reverted, 0 red (B8).

Safe cases B ran: install order fetch, verify, stage, smoke, place; smoke runs only the staged binary; GNU tar refuses `-x` and symlink members; a `/../` name gives `invalid version`; `cat install.sh | bash -s` reads 0 stdin bytes; a truncated pipe gives a syntax error at the final `case` with nothing installed; glibc strings `2.39.9000`, `(GNU libc) 2.35`, Ubuntu `2.35-0ubuntu3`, Debian 2.36 parse right; one EXIT trap; six suites in parallel stay green; no real HOME, no outside network; no em dash or attribution line in the commits.

### C06b (fixes B1 to B7, B9), owner `nappy`, after C12b lands

`scripts/installer/sh/binary.sh`, `fetch.sh`, `lib.sh`, `tests/install.test.mjs` (only B9), and a new `tests/install-archive.test.mjs`.
- `binary.sh`: list the archive once into a variable with an explicit failure check (`die 'install.sh: cannot list the archive'`), run the entry and symlink checks on that variable, extract with `tar --no-same-owner --no-same-permissions -xzf`.
- `fetch.sh`: curl gains `--proto '=https' --proto-redir '=https'`; a `base_url` not starting with `https://` is refused unless it is `https://fixture.invalid` style already (tests use that) or `--from` is set; the README notes wget cannot refuse an http redirect (T23).
- `lib.sh`: refuse bash older than 4.4 at the top (`BASH_VERSINFO`), with a message naming the found version.
- `tests/install-archive.test.mjs`: a release with a `-x` member, a `../escape` member, and a symlink member each exit 1 with the install dir unchanged; a `--from` SHA256SUMS whose archive name holds `/../` exits 1 with `invalid version`; with fakeroot present, a root-style install leaves the binary owned by the running uid (skip with a reason when fakeroot is absent); curl calls carry `--proto '=https'`.
- `tests/install.test.mjs`: remove the `snipset-archive-*` staging dir after packing; leave the rest unchanged.
