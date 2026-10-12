# The called functions read these locals and the parameters through dynamic scoping, never a script-scope prefix:
# the README one-liner runs install.ps1 as a scriptblock, where the script scope is the caller's session.

function Assert-SnipsetDatabase {
  param([string]$Database)
  # install.sh refuses the same character in --db.
  if ($Database -match '"') { throw "install.ps1: the database path must not contain `" (got $Database)" }
}

# Mirrors db_check in install.sh. There is no init step on Windows, so the file is only reported.
function Test-SnipsetDatabase {
  param([string]$Database)
  if (-not $Database) {
    Write-SnipsetReport -Status SKIP -Item 'database' -Detail 'the CLI default'
  } elseif (Test-Path -LiteralPath $Database) {
    Write-SnipsetReport -Status OK -Item 'database' -Detail $Database
  } else {
    Write-SnipsetReport -Status MISSING -Item 'database' -Detail $Database
  }
}

function Test-SnipsetExe {
  param([string]$InstallDir)
  $exe = Join-Path $InstallDir 'snipset.exe'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    Write-SnipsetReport -Status MISSING -Item 'binary' -Detail "$exe not found"
    return
  }
  if (-not (Test-SnipsetWindowsHost)) {
    Write-SnipsetReport -Status OK -Item 'binary' -Detail "$exe (version not checked off Windows)"
    return
  }
  $have = Get-SnipsetInstalledVersion -InstallDir $InstallDir
  $want = $Version -replace '^v', ''
  if (-not $have) {
    Write-SnipsetReport -Status DRIFT -Item 'binary' -Detail "$exe does not answer --version as snipset"
  } elseif ($want -and $have -ne $want) {
    Write-SnipsetReport -Status DRIFT -Item 'binary' -Detail "snipset $have at $exe, expected $want"
  } else {
    Write-SnipsetReport -Status OK -Item 'binary' -Detail "snipset $have at $exe"
  }
}

function Remove-SnipsetExe {
  param([string]$InstallDir)
  $exe = Join-Path $InstallDir 'snipset.exe'
  $item = Get-Item -LiteralPath $exe -Force -ErrorAction SilentlyContinue
  if (-not $item) {
    Write-SnipsetReport -Status SKIP -Item 'binary' -Detail "$exe not found"
    return
  }
  # A link answers --version for its target, which the installer never wrote.
  if ($item.PSIsContainer -or $item.LinkType) {
    Write-SnipsetReport -Status KEEP -Item 'binary' -Detail "$exe is not a regular file; left in place"
    return
  }
  if ((Test-SnipsetWindowsHost) -and -not (Test-SnipsetBinary -Path $exe)) {
    Write-SnipsetReport -Status KEEP -Item 'binary' -Detail "$exe does not answer --version as snipset; left in place"
    return
  }
  try {
    Remove-Item -LiteralPath $exe -Force
  } catch {
    $e = $_.Exception
    # Windows refuses to delete a running exe, for example one an MCP host started.
    $detail = if ($e -is [IO.IOException] -or $e -is [UnauthorizedAccessException]) { "in use (close the program using it): $exe" } else { $e.Message }
    Write-SnipsetReport -Status FAIL -Item 'binary' -Detail $detail
    return
  }
  Write-SnipsetReport -Status REMOVED -Item 'binary' -Detail $exe
}

function Remove-SnipsetInstallDir {
  param([string]$InstallDir)
  $item = Get-Item -LiteralPath $InstallDir -Force -ErrorAction SilentlyContinue
  if (-not $item -or -not $item.PSIsContainer -or $item.LinkType) { return }
  if ([IO.Directory]::GetFileSystemEntries($InstallDir).Length -gt 0) { return }
  # Best effort like rmdir in install.sh: a dir in use stays, and that is not a failed uninstall.
  try { [IO.Directory]::Delete($InstallDir) } catch { }
}

function Invoke-SnipsetInstall {
  param([string[]]$McpIds = @())
  Assert-SnipsetDatabase -Database $Database
  $run = @{ drift = 0; kept = 0; removed = 0; fail = 0; zip = $null }
  $Version = Resolve-SnipsetVersion
  $archive = "snipset-cli-$Version-$target.zip"
  $releaseUrl = "$baseUrl/$Version"
  $exe = Join-Path $InstallDir 'snipset.exe'
  $temp = Join-Path ([IO.Path]::GetTempPath()) ('snipset-install-' + [Guid]::NewGuid().ToString('N'))
  $stage = Join-Path $InstallDir ('.snipset-stage-' + [Guid]::NewGuid().ToString('N'))
  $fetch = if ($From) { "copy SHA256SUMS and $archive from $From" } else { "download SHA256SUMS and $archive from $releaseUrl" }
  try {
    Invoke-SnipsetAction -Description "$fetch and verify the checksum" -Action {
      New-Item -ItemType Directory -Force -Path $temp | Out-Null
      $run.zip = Get-SnipsetRelease -Temp $temp
    }
    Invoke-SnipsetAction -Description "check the entries of $archive" -Action { Test-SnipsetArchive -Zip $run.zip }
    Invoke-SnipsetAction -Description "install snipset.exe to $exe" -Action { Install-SnipsetBinary -Zip $run.zip -Stage $stage -InstallDir $InstallDir }
    if ($AddPath) { Invoke-SnipsetAction -Description "add $InstallDir to the user PATH" -Action { Install-SnipsetPathEnv -Dir $InstallDir } }
    $dbNote = if ($Database) { " with --db $Database" } else { '' }
    foreach ($id in $McpIds) { Invoke-SnipsetAction -Description "register the snipset MCP server for $id$dbNote" -Action { Install-SnipsetMcp -Ids @($id) -Bin $exe -Db $Database } }
    if ($run.fail -gt 0) { throw "install: $($run.fail) steps failed" }
    if ($DryRun) { Write-Output 'dry run: nothing was written' } else { Write-Output "Installed snipset $Version to $exe" }
  } finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function Invoke-SnipsetCheck {
  param([string[]]$McpIds = @())
  Assert-SnipsetDatabase -Database $Database
  $run = @{ drift = 0; kept = 0; removed = 0; fail = 0 }
  Test-SnipsetExe -InstallDir $InstallDir
  Test-SnipsetDatabase -Database $Database
  if ($AddPath) { Test-SnipsetPathEnv -Dir $InstallDir }
  if ($McpIds.Count) {
    Test-SnipsetMcp -Ids $McpIds -Bin (Join-Path $InstallDir 'snipset.exe')
  } else {
    Write-SnipsetReport -Status SKIP -Item 'mcp' -Detail 'no -WithMcp list'
  }
  # A check that could not run is not evidence of a current install.
  $n = $run.drift + $run.fail
  if ($n -gt 0) { throw "check: DRIFT ($n items)" }
  Write-Output 'check: CURRENT'
}

function Invoke-SnipsetUpdate {
  param([string[]]$McpIds = @())
  Assert-SnipsetDatabase -Database $Database
  if ($DryRun) {
    Invoke-SnipsetInstall -McpIds $McpIds
    return
  }
  # Invoke-SnipsetInstall resolves again, sees this local, and so asks GitHub at most once.
  $Version = Resolve-SnipsetVersion
  $have = Get-SnipsetInstalledVersion -InstallDir $InstallDir
  if ($have -and $have -eq ($Version -replace '^v', '')) {
    Write-SnipsetReport -Status OK -Item 'update' -Detail "snipset $have is current"
    return
  }
  Invoke-SnipsetInstall -McpIds $McpIds
}

function Invoke-SnipsetUninstall {
  param([string[]]$McpIds = @())
  # The remove functions delete for real, so there is nothing safe to preview.
  if ($DryRun) { throw 'install.ps1: -DryRun cannot preview -Uninstall; run -Check to see what is installed' }
  Assert-SnipsetDatabase -Database $Database
  $run = @{ drift = 0; kept = 0; removed = 0; fail = 0 }
  $exe = Join-Path $InstallDir 'snipset.exe'
  if ($McpIds.Count) {
    Remove-SnipsetMcp -Ids $McpIds -Bin $exe -Db $Database
  } else {
    Write-SnipsetReport -Status SKIP -Item 'mcp' -Detail 'no -WithMcp list'
  }
  Remove-SnipsetExe -InstallDir $InstallDir
  # The exe goes first: the PATH entry stays while a kept or locked exe still sits in the dir.
  $exeKept = [bool](Get-Item -LiteralPath $exe -Force -ErrorAction SilentlyContinue)
  Remove-SnipsetPathEnv -Dir $InstallDir -ExeKept:$exeKept
  Remove-SnipsetInstallDir -InstallDir $InstallDir
  Write-Output "uninstall: removed $($run.removed), kept $($run.kept)"
  if ($run.fail -gt 0) { throw "uninstall: $($run.fail) steps failed" }
}
