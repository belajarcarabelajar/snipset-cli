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

## Reviewer B: platform, fetch, CLI, tests

Pending (resumed after its turn limit).
