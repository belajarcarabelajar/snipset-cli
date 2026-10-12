$ErrorActionPreference = 'Stop'
# Win PS 5.1 defaults to TLS 1.0; GitHub requires TLS 1.2 since 2018-02-01.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'belajarcarabelajar/snipset-cli'
$baseUrl = if ($env:SNIPSET_RELEASE_BASE_URL) { $env:SNIPSET_RELEASE_BASE_URL } else { "https://github.com/$repo/releases/download" }

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
  if ($InstallDir) { return $InstallDir }
  if (-not $env:LOCALAPPDATA) { throw 'install.ps1: LOCALAPPDATA is not set; pass -InstallDir <dir>' }
  Join-Path $env:LOCALAPPDATA 'Snipset\bin'
}
