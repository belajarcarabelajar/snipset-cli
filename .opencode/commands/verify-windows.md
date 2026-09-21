---
description: Run the Windows PowerShell installer contract test via powershell.exe.
agent: build
---

Verify `install.ps1` on this machine without fetching any release binary:

1. Confirm each contract token exists verbatim in `install.ps1`: `SHA256SUMS`, `Get-FileHash`, `Expand-Archive`, `x86_64-pc-windows-msvc`, `LOCALAPPDATA`. Confirm `Cargo|crates` is absent.
2. Run only the static contract script (it never downloads or executes the installer): `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$w=(wsl wslpath -w tests/install.Tests.ps1); & $w"`.
3. Expected output is `PowerShell installer contract passed` with exit 0.

Do NOT invoke `install.ps1` itself (that would fetch binaries). Report the exit code and output.
