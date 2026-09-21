$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\install.ps1'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'install.ps1 is missing' }
$content = Get-Content -Raw -LiteralPath $script
foreach ($required in @('SHA256SUMS', 'Get-FileHash', 'Expand-Archive', 'x86_64-pc-windows-msvc', 'LOCALAPPDATA')) {
  if ($content -notmatch [regex]::Escape($required)) { throw "install.ps1 is missing required contract: $required" }
}
if ($content -match 'Cargo|crates') { throw 'public installer must not expose source installation' }
Write-Output 'PowerShell installer contract passed'
