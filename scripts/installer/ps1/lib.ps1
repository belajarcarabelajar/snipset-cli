# The one-liner runs inside the caller's session, whose strict mode would otherwise reach every part.
Set-StrictMode -Off
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 redraws a progress bar per downloaded chunk, which slows Invoke-WebRequest many times over.
$ProgressPreference = 'SilentlyContinue'
$repo = 'belajarcarabelajar/snipset-cli'
$baseUrl = if ($env:SNIPSET_RELEASE_BASE_URL) { $env:SNIPSET_RELEASE_BASE_URL } else { "https://github.com/$repo/releases/download" }

function Enable-SnipsetTls12 {
  param([string]$Edition = $PSVersionTable.PSEdition)
  # Windows PowerShell may offer only TLS 1.0 while GitHub requires TLS 1.2 since 2018-02-01; pwsh (Core) negotiates
  # it already. The setting is process-wide, so the previous value is returned for Restore-SnipsetTls.
  if ($Edition -eq 'Core') { return $null }
  $previous = [Net.ServicePointManager]::SecurityProtocol
  if ($previous -band [Net.SecurityProtocolType]::Tls12) { return $null }
  [Net.ServicePointManager]::SecurityProtocol = $previous -bor [Net.SecurityProtocolType]::Tls12
  $previous
}

function Restore-SnipsetTls {
  param($Previous)
  if ($null -ne $Previous) { [Net.ServicePointManager]::SecurityProtocol = $Previous }
}

function Write-SnipsetReport {
  param([string]$Status, [string]$Item, [string]$Detail)
  Write-Output "[$Status] ${Item}: $Detail"
  # $run is the hashtable of the Invoke-Snipset* function on the call stack, found by dynamic scoping;
  # unit tests that dot-source a part call this without one.
  if ($run -is [hashtable]) {
    $counter = @{ DRIFT = 'drift'; MISSING = 'drift'; KEEP = 'kept'; REMOVED = 'removed'; FAIL = 'fail' }[$Status]
    if ($counter) { $run[$counter] = [int]$run[$counter] + 1 }
  }
}

function Invoke-SnipsetAction {
  param([string]$Description, [scriptblock]$Action)
  if ($DryRun) {
    Write-Output "[DRY] $Description"
    return
  }
  & $Action
}

function Get-SnipsetMode {
  param([switch]$Check, [switch]$Update, [switch]$Uninstall)
  $picked = @(@{ check = $Check; update = $Update; uninstall = $Uninstall }.GetEnumerator() | Where-Object { $_.Value } | ForEach-Object { $_.Key })
  if ($picked.Count -gt 1) { throw 'install.ps1: use only one of -Check, -Update, -Uninstall' }
  if ($picked.Count -eq 1) { $picked[0] } else { 'install' }
}

function Resolve-SnipsetMcpIds {
  param([string[]]$WithMcp)
  $known = @('claude', 'codex', 'gemini', 'opencode', 'cursor', 'vscode')
  $ids = [Collections.Generic.List[string]]::new()
  $requested = if ($WithMcp) { @($WithMcp | ForEach-Object { "$_" -split ',' } | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ }) } else { @() }
  foreach ($id in $requested) {
    if ($id -eq 'all') { $expanded = $known }
    elseif ($known -contains $id) { $expanded = @($id) }
    else { throw "install.ps1: unknown MCP id $id (known: $($known -join ', '), all)" }
    foreach ($one in $expanded) { if (-not $ids.Contains($one)) { $ids.Add($one) } }
  }
  , $ids.ToArray()
}

function Resolve-SnipsetInstallDir {
  param([string]$InstallDir)
  if (-not $InstallDir) {
    if (-not $env:LOCALAPPDATA) { throw 'install.ps1: LOCALAPPDATA is not set; pass -InstallDir <dir>' }
    $InstallDir = Join-Path $env:LOCALAPPDATA 'Snipset\bin'
  }
  # PATH splits entries at ; and a " changes how the entry is quoted, so either would point PATH somewhere else.
  $refusal = "install.ps1: the install directory must not contain ; or `" (got $InstallDir)"
  if ($InstallDir -match '[;"]') { throw $refusal }
  # [IO.Path] alone resolves against the process directory, which Set-Location does not move.
  $here = (Get-Location -PSProvider FileSystem).ProviderPath
  $full = [IO.Path]::GetFullPath([IO.Path]::Combine($here, $InstallDir))
  if ($full -match '[;"]') { throw $refusal }
  $full
}
