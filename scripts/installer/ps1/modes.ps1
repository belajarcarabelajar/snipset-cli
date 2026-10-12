# The called functions read these locals and the parameters through dynamic scoping, never a script-scope prefix:
# the README one-liner runs install.ps1 as a scriptblock, where the script scope is the caller's session.

# Placeholders for functions that parts earlier in ORDER will define; an existing definition wins.
if (-not (Get-Command Assert-SnipsetPlatform -ErrorAction SilentlyContinue)) {
  function Assert-SnipsetPlatform {}
}
if (-not (Get-Command Install-SnipsetMcp -ErrorAction SilentlyContinue)) {
  function Install-SnipsetMcp {
    param([string[]]$Ids, [string]$Bin, [string]$Db)
    foreach ($id in $Ids) { Write-SnipsetReport -Status SKIP -Item $id -Detail 'not registered yet' }
  }
}
if (-not (Get-Command Test-SnipsetMcp -ErrorAction SilentlyContinue)) {
  function Test-SnipsetMcp {
    param([string[]]$Ids, [string]$Bin)
    foreach ($id in $Ids) { Write-SnipsetReport -Status SKIP -Item $id -Detail 'not checked yet' }
  }
}
if (-not (Get-Command Remove-SnipsetMcp -ErrorAction SilentlyContinue)) {
  function Remove-SnipsetMcp {
    param([string[]]$Ids, [string]$Bin)
    Write-SnipsetReport -Status SKIP -Item 'mcp' -Detail 'not removed yet'
  }
}

function Test-SnipsetExe {
  param([string]$InstallDir)
  Write-SnipsetReport -Status SKIP -Item 'binary' -Detail 'not checked yet'
}
function Test-SnipsetPathEnv {
  param([string]$Dir)
  Write-SnipsetReport -Status SKIP -Item 'path' -Detail 'not checked yet'
}
function Remove-SnipsetExe {
  param([string]$InstallDir)
  Write-SnipsetReport -Status SKIP -Item 'binary' -Detail 'not removed yet'
}
function Remove-SnipsetPathEnv {
  param([string]$Dir)
  Write-SnipsetReport -Status SKIP -Item 'path' -Detail 'not removed yet'
}

function Invoke-SnipsetInstall {
  param([string[]]$McpIds = @())
  $run = @{ drift = 0; kept = 0; removed = 0; fail = 0; zip = $null }
  $Version = Resolve-SnipsetVersion
  $archive = "snipset-cli-$Version-$target.zip"
  $releaseUrl = "$baseUrl/$Version"
  $exe = Join-Path $InstallDir 'snipset.exe'
  $temp = Join-Path ([IO.Path]::GetTempPath()) ('snipset-install-' + [Guid]::NewGuid().ToString('N'))
  $stage = Join-Path $InstallDir ('.snipset-stage-' + [Guid]::NewGuid().ToString('N'))
  try {
    Invoke-SnipsetAction -Description "download SHA256SUMS and $archive from $releaseUrl and verify the checksum" -Action {
      New-Item -ItemType Directory -Force -Path $temp | Out-Null
      $run.zip = Get-SnipsetRelease -Temp $temp
    }
    Invoke-SnipsetAction -Description "check the entries of $archive" -Action { Test-SnipsetArchive -Zip $run.zip }
    Invoke-SnipsetAction -Description "install snipset.exe to $exe" -Action { Install-SnipsetBinary -Zip $run.zip -Stage $stage -InstallDir $InstallDir }
    if ($AddPath) { Invoke-SnipsetAction -Description "add $InstallDir to the user PATH" -Action { Add-SnipsetToUserPath -Dir $InstallDir } }
    foreach ($id in $McpIds) { Invoke-SnipsetAction -Description "register the snipset MCP server for $id" -Action { Install-SnipsetMcp -Ids @($id) -Bin $exe } }
    if ($run.fail -gt 0) { throw "install: $($run.fail) steps failed" }
    if ($DryRun) { Write-Output 'dry run: nothing was written' } else { Write-Output "Installed snipset $Version to $exe" }
  } finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function Invoke-SnipsetCheck {
  param([string[]]$McpIds = @())
  $run = @{ drift = 0; kept = 0; removed = 0; fail = 0 }
  Test-SnipsetExe -InstallDir $InstallDir
  if ($AddPath) { Test-SnipsetPathEnv -Dir $InstallDir }
  if ($McpIds.Count) { Test-SnipsetMcp -Ids $McpIds -Bin (Join-Path $InstallDir 'snipset.exe') }
  if ($run.drift -gt 0) { throw "check: DRIFT ($($run.drift) items)" }
  Write-Output 'check: CURRENT'
}

function Invoke-SnipsetUpdate {
  param([string[]]$McpIds = @())
  Invoke-SnipsetInstall -McpIds $McpIds
}

function Invoke-SnipsetUninstall {
  param([string[]]$McpIds = @())
  $run = @{ drift = 0; kept = 0; removed = 0; fail = 0 }
  $exe = Join-Path $InstallDir 'snipset.exe'
  $mcpLabel = if ($McpIds.Count) { $McpIds -join ', ' } else { 'every harness' }
  Invoke-SnipsetAction -Description "remove the snipset MCP entries for $mcpLabel" -Action { Remove-SnipsetMcp -Ids $McpIds -Bin $exe }
  Invoke-SnipsetAction -Description "remove $InstallDir from the user PATH" -Action { Remove-SnipsetPathEnv -Dir $InstallDir }
  Invoke-SnipsetAction -Description "remove $exe" -Action { Remove-SnipsetExe -InstallDir $InstallDir }
  Write-Output "uninstall: removed $($run.removed), kept $($run.kept)"
  if ($run.fail -gt 0) { throw "uninstall: $($run.fail) steps failed" }
  if ($DryRun) { Write-Output 'dry run: nothing was written' }
}
