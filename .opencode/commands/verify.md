---
description: Run the full snipset-cli installer verification (Linux tests, shell syntax, PowerShell contract).
agent: build
---

Verify the snipset-cli installers end to end. Run these in order and report exit codes:

1. `bun test tests/install.test.mjs` (must be 2 pass, 0 fail)
2. `bash -n install.sh` (must exit 0)
3. Static contract scan of `install.ps1`: tokens `SHA256SUMS`, `Get-FileHash`, `Expand-Archive`, `x86_64-pc-windows-msvc`, `LOCALAPPDATA` must all be present, and `Cargo|crates` must be absent.
4. If Windows `powershell.exe` is reachable, run the contract test: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$w=(wsl wslpath -w tests/install.Tests.ps1); & $w"`.

Do NOT download release archives, do NOT run Rust/Cargo, do NOT touch the real `~/.profile`. Fixture-based temp installs only. Summarize PASS/FAIL per step with fresh evidence.
