# Review wave 3: README claims, lifecycle, PR hygiene (2026-10-12)

Three independent read-only `staid` reviewers at HEAD `b9d1fea` (one docs-only commit, `0209790`, followed).

## Reviewer F: lifecycle end to end

Verdict: not correct (one P1). Every cycle (default, `--add-path`, `--no-shell --add-path`, custom dirs, MCP files, `--db`, HOME with spaces, dry run per mode, pwsh default and `-WithMcp`, pwsh dry run per mode) ran with consistent exit codes (install 0, check 0, update 0, uninstall 0, check 1, second uninstall 0 with `removed 0`, reinstall 0) and summary counts. Interactions held: user lines around the bashrc block kept, an edited block kept with a hint, a deleted shim reported and the rest removed, double install then single uninstall back to the start plus the database, a removed `.profile` not recreated, a binary-only 0.1.0 updated to 0.2.0 then CURRENT, pre-existing OpenCode and Cursor files byte-identical.

| # | Sev | Status | Where | What happens | Fix |
|---|---|---|---|---|---|
| F1 | P1 | CONFIRMED, new on this branch | `pathenv.sh:84-86` | `--add-path` replaces a user's own `~/.config/fish/conf.d/snipset.fish` with the managed text; uninstall then deletes it | C10b: write only when absent or when line 1 is the marker; else `[KEEP]` and print the line to add |
| F2 | P2 | CONFIRMED, new on this branch | `pathenv.sh:70-71` | `<share-dir>/env` and `env.fish` are overwritten without a marker check (a user's `~/mystuff/env` was replaced, then removed) | C10b: same marker check |
| F3 | P2 | CONFIRMED, pre-existing (`main` `install.sh:102,110`) | `binary.sh:50,58`, `install.ps1` exe move | install replaces a foreign `snipset`, `snipset-shims`, or `snipset.exe`, and a symlink with a regular file that uninstall then deletes | C07c (sh) and C15d (ps1): refuse a foreign file or a symlink before placing, exit 1 |
| F4 | P2 | CONFIRMED, pre-existing (`main` `install.sh:122`) | `shell.sh:8` | `cp -f` overwrites a user's own file in a custom `--share-dir`, and uninstall removes it | backlog: `defer: keep a differing share file in a custom --share-dir, upgrade-trigger: the release bundle files carry a recognisable header` |
| F5 | P3 | CONFIRMED | uninstall | empty directories the installer created stay (documented in README "Empty directories may remain") | backlog: `defer: remove directories the install created when empty, upgrade-trigger: a user report of leftover directories` |

Not a finding: a reinstall over an existing database relays the CLI's `schema mismatch: database already exists ... pass --force`, which reads alarming for a healthy database (CLI message, private repo).

### C10b (fixes F1, F2), owner `hoggy`

`pathenv.sh` and `tests/install-pathenv.test.mjs`. The fish conf file and the two env files are written only when absent or when their first line is the `snipset-path` marker (then rewritten in place through `rewrite_file`); otherwise `[KEEP] path <file>: not written by the installer; add the line by hand: <line>` and nothing is written; uninstall already deletes only exact content. Tests: a user's own `snipset.fish` and a user's own `env` in a custom share dir survive install and uninstall byte-identical with a `[KEEP]` line; the managed case still works.

### C07c (fix F3, Linux), owner `chef`

`binary.sh` and `tests/install-binary.test.mjs`. Before `binary_place`, refuse when `<install_dir>/snipset` exists and is a symlink or is not snipset (`binary_is_snipset` false), and when `snipset-shims` exists and is a symlink or lacks the generator header: `die "<path> exists and is not a snipset install; move it aside or pass --install-dir"` (exit 1, nothing replaced). A genuine older snipset is still replaced. Tests: foreign file and symlink each refused with the file untouched; a genuine older binary replaced.

### C15d (fix F3, Windows), owner `nappy`

`binary.ps1` and `tests/install-ps1-platform.test.mjs` (or a new `tests/install-ps1-place.test.mjs`). Same rule for `snipset.exe`: refuse (throw) when it exists and is a link or, on Windows, its `--version` does not start with `snipset `; off Windows, refuse only a link (the exe cannot run there). Tests: a link refused off Windows; on a mocked Windows host a foreign exe refused and a genuine one replaced.

## Reviewer E: README claims

Pending.

## Reviewer G: PR hygiene and scope

Verdict: correct (no P0 or P1). Scope: 94 files, every one traced to a plan task or a review fix chunk; no logs, temp dirs, or `node_modules` tracked; the vendored schema digests match `SOURCES.md`. Sizes: `install.sh` 1329 and `install.ps1` 869 lines (generated bundles), largest parts `mcp.ps1` 293 and `mcp.sh` 280. Copy rules over 15985 added lines and 47 commit messages: 0 em dashes, 0 `Co-Authored-By`, 0 `Generated with`, 0 robot emoji ("Claude Code" appears only as a harness name). Three commits checked alone with `git archive` (`cc7b3f0`, `d9c514b`, `2950d24`): bundle check and targeted suites green. Full suite at `b9d1fea`: 498 tests, 0 fail, 6 skip (4 real-asset, nix flake check, `ruby -c`).

| # | Sev | Status | Where | What | Fix |
|---|---|---|---|---|---|
| G1 | P2 | DERIVED | `tests/packaging-homebrew.test.mjs:112`, CI | `ruby -c` never ran here; ubuntu-latest has ruby, so it first runs in CI. The ps1 suites also run in CI on an older pwsh than 7.6.6 and some assert 7.6 output | follow-up: read the PR's CI run as author evidence and fix any red; `defer: CI-specific skips, upgrade-trigger: the first CI run on the PR` |
| G2 | P3 | CONFIRMED | `tests/install-ps1-mcp.test.mjs` (503 lines) | stubs duplicated from `tests/install-mcp.test.mjs:27-92`; pwsh helpers repeated in five ps1 suites | backlog: `defer: move shared stubs and pwsh helpers into tests/helpers/, upgrade-trigger: the next change to either MCP suite` |
| G3 | P3 | CONFIRMED | `tests/readme-install.test.mjs` | the matrix test checks only the first status word, not that evidence or a reason follows | parent: assert `^<status>: \S` |
| G4 | P3 | CONFIRMED | the plan file (about 103 KB) | over the issue-body budget, so issue #5 shows a truncated prefix (the sync marks it) | backlog: `defer: move section 0 evidence prose into session files, upgrade-trigger: the next plan of this size` |

AC traceability (G's table, abridged): AC-1 to AC-6, AC-12, AC-13 proven by named tests; AC-7 to AC-11 proven by named tests with some sub-cases not itemized by G; AC-14 by `tests/install-real-assets.test.mjs` (opt-in); AC-15 partly (G3); AC-16 by T25.

CI impact (derived): pwsh suites run if the runner has pwsh; makepkg and fakeroot are absent there, so the AUR build cases skip; the shellcheck action does not pick up `PKGBUILD`, `.SRCINFO`, or `*.tmpl`.
