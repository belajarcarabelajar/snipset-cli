# T09 Adversarial Removal Review: snipset-cli deferred hardening

- **Reviewers:** two independent read-only reviewers (`staid`), 2026-10-12, on `3f46e61` over `1562bb1`: one for the Linux half (`scripts/installer/sh/`, `install.sh`), one for the Windows half (`scripts/installer/ps1/`, `install.ps1`). A first Linux reviewer was cut off by the session limit before reporting; its run is not counted.
- **Before the review:** a parent probe of the upgrade path (the previous `install.sh`, then the new install and uninstall) found the default share dir left behind; fixed in `241487a` before the reviewers started.
- **Verdicts:** Linux `correct` (one P2, one P3, both fixed in `63055ce`); Windows `correct` (no qualifying findings).

## Findings

| # | Finding | Introduced | Status |
|---|---|---|---|
| L-P2 | README said a share file the installer did not write is kept, and that a pre-existing directory stays; in the default share dir with no manifest (an older install, or a user's own `tab.sh` there) the file is replaced and the directory removed once empty, as on `1562bb1` | the README claims were new; the behaviour is old | fixed in `63055ce`: the README states the default share dir exception, pinned by `deferred hardening: the default share dir exception for older installs is stated` (RED 1 fail, GREEN 23 pass) |
| L-P3 | `mv -f` of the manifest or the dirs record into a path that is a directory, or a symlink to one, moved the temp file into that directory (measured: stray `.snipset-bundle.XXXXXX` in a user dir, the three shell files then reported `[KEEP]` forever) | new | fixed in `63055ce` with `mv -fT` at both sites; three tests (a manifest linked to a directory, a directory at the manifest path reported `[FAIL]`, a record linked to a directory) RED 3 fail, GREEN 3 pass |

## Probes that held (summary)

Linux: user shell files in a custom share dir; a default share dir holding only a user's file (not adopted); pre-existing empty share, install, and `~/.cursor` dirs; a record naming HOME, `HOME/`, `/`, a sibling, `..`, trailing slashes, relative paths; an unreadable record (`[FAIL]`, nothing removed); a record or manifest symlinked to a file; HOME with a trailing slash; install dir equal to share dir; `XDG_CONFIG_HOME` and `ZDOTDIR` at user dirs; symlinked share dirs; a truncated manifest; a user edit through reinstall, uninstall, a `--no-shell` uninstall, and reinstall; failed smoke runs; dry-run and check write nothing; the upgrade from the previous installer.

Windows: near-miss aside names (case, 7 or 9 hex, uppercase hex, trailing dot or space, `:x`, non-ASCII digits, `\n`, `\r`, signs); symlinks, hardlinks, dangling links, directories; a real delete failure (one NOTE, no throw); uninstall with unlocked asides, other programs' files, a symlinked install dir; two in-use updates in one session (no collision); `-Db x`, `-db x`, positional values, `-DB:x`, an empty `-Database` refused or reported; awkward `-Database` values passed literally; the DLL message on `-1073741515` with one start; dry run and check write nothing.

## Observations kept as designed (not findings)

- A locked aside on Windows uninstall prints a NOTE and is not counted in `kept`.
- `-Check -Database <path>` reports `[MISSING]` (drift) until the database exists, because Windows has no init step; the README says so.
- Check does not compare an MCP entry's `--db` (unchanged code, matches `install.sh`).
- Uninstall with fewer flags than the install deletes the whole record, so directories outside the current candidate set stay untracked (empty, safe direction).
- Two installs sharing one share dir leave it empty after both uninstall.

## Cannot be verified on Linux

Real Windows file locks and the exception a running exe raises; junctions, 8.3 names, real alternate data streams; whether Windows shows a blocking "System Error" dialog before returning `-1073741515` to PowerShell; Windows PowerShell 5.1 argument passing; `Test-Path` on UNC paths.
