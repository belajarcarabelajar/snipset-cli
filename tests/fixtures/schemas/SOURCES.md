# Vendored schemas

Fetched 2026-10-12 with `gh api -H 'Accept: application/vnd.github.raw' repos/<owner>/<repo>/contents/<path>?ref=<commit>`. Tests read these files offline; refresh them only by refetching at a newer commit and updating this table.

| File | Source | Commit | Licence | sha256 | Bytes |
|---|---|---|---|---|---|
| `scoop.schema.json` | `ScoopInstaller/Scoop` `schema.json` | `e6aa3b366bdee8ed138c1e0f7b85192ebdd35d0f` | Unlicense or MIT | `64ec829c70758d3fba2c8c168a5901a64408a6493efda25f172b0fe4505caac0` | 22218 |
| `winget-1.12.0/manifest.version.1.12.0.json` | `microsoft/winget-cli` `schemas/JSON/manifests/v1.12.0/` | `3d9083c062c1e7a7086e05becb414d4e005e4ab6` | MIT | `0cdf9c17a0d19221a3612980c95a47d120c4ce532157177aa6af4368a8a78273` | 1590 |
| `winget-1.12.0/manifest.installer.1.12.0.json` | same | same | MIT | `47de5aefdea4e7ccbc8ab4e32e8230671300054bd4f688cd7ca8bdebf459f006` | 28515 |
| `winget-1.12.0/manifest.defaultLocale.1.12.0.json` | same | same | MIT | `b87eaa2252daf0bc9b2d495a3f7f5547b8b36236bdcc0543cf9f7403bd56707e` | 7860 |
