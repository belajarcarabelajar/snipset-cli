function Test-SnipsetArchive {
  param([string]$Zip)
  # Windows PowerShell 5.1 runs on .NET Framework, where ZipFile lives in this assembly.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zipArchive = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    foreach ($entry in $zipArchive.Entries) {
      if ([IO.Path]::IsPathRooted($entry.FullName) -or $entry.FullName -match '(^|[\\/])\.\.([\\/]|$)' -or $entry.FullName -match '(^|[\\/])\.git([\\/]|$)') { throw 'install.ps1: unsafe archive entry' }
    }
  } finally {
    $zipArchive.Dispose()
  }
}
function Invoke-SnipsetVersionProbe {
  param([string]$Exe)
  # Windows PowerShell 5.1 turns native stderr into a terminating error under 'Stop'; this scope only.
  $ErrorActionPreference = 'Continue'
  try { $out = @(& $Exe --version 2>$null) } catch { return @{ ExitCode = $null; Output = '' } }
  @{ ExitCode = $LASTEXITCODE; Output = ($out -join "`n") }
}
function Test-SnipsetBinary {
  param([string]$Path)
  $probe = Invoke-SnipsetVersionProbe -Exe $Path
  # The caller's $run keeps the probe, so Install-SnipsetBinary reads the exit code without starting a failing exe twice.
  if ($run -is [hashtable]) { $run.probe = $probe }
  ($probe.ExitCode -eq 0) -and "$($probe.Output)".StartsWith('snipset ')
}
function Clear-SnipsetOldExe {
  param([string]$InstallDir, [string]$Status = 'NOTE')
  if (-not (Test-Path -LiteralPath $InstallDir -PathType Container)) { return }
  # A regex and not -Filter, whose wildcard also matches 8.3 short names; [0-9] and \z keep out other digits and a trailing newline.
  $pattern = '^snipset\.exe\.old-[0-9]+(-[0-9a-f]{8})?\z'
  foreach ($item in @(Get-ChildItem -LiteralPath $InstallDir -Force)) {
    if ($item.Name -cnotmatch $pattern -or $item.PSIsContainer -or $item.LinkType) { continue }
    try {
      Remove-Item -LiteralPath $item.FullName -Force
    } catch [IO.IOException], [UnauthorizedAccessException] {
      Write-SnipsetReport -Status NOTE -Item 'binary' -Detail "$($item.FullName) is still in use; it is deleted on the next install or uninstall after that program exits"
      continue
    }
    $detail = if ($Status -eq 'REMOVED') { $item.FullName } else { "deleted $($item.FullName), left by an earlier update" }
    Write-SnipsetReport -Status $Status -Item 'binary' -Detail $detail
  }
}
function Get-SnipsetInstalledVersion {
  param([string]$InstallDir)
  if (-not (Test-SnipsetWindowsHost)) { return $null }
  $exe = Join-Path $InstallDir 'snipset.exe'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { return $null }
  $ErrorActionPreference = 'Continue'
  try { $out = @(& $exe --version 2>$null) } catch { return $null }
  if ($LASTEXITCODE -eq 0 -and ($out -join "`n") -match '^snipset v?(\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?)') { return $Matches[1] }
  $null
}
function Move-SnipsetExe {
  param([string]$Candidate, [string]$Exe)
  # Windows refuses to overwrite a running exe but lets it be renamed, so a busy one is moved aside first.
  # Returns 'moved', 'in-use', or the path the old exe was moved to.
  try {
    Move-Item -LiteralPath $Candidate -Destination $Exe -Force
    return 'moved'
  } catch [IO.IOException], [UnauthorizedAccessException] { }
  # $PID alone repeats for two updates in one session, and the first aside may still be running.
  $aside = "$Exe.old-$PID-" + [guid]::NewGuid().ToString('N').Substring(0, 8)
  try { Move-Item -LiteralPath $Exe -Destination $aside -Force } catch [IO.IOException], [UnauthorizedAccessException] { return 'in-use' }
  try {
    Move-Item -LiteralPath $Candidate -Destination $Exe -Force
  } catch [IO.IOException], [UnauthorizedAccessException] {
    Move-Item -LiteralPath $aside -Destination $Exe -Force
    return 'in-use'
  }
  $aside
}
function Install-SnipsetBinary {
  param([string]$Zip, [string]$Stage, [string]$InstallDir)
  [void][IO.Directory]::CreateDirectory($InstallDir)
  # Expand-Archive tests an existing destination as a wildcard, so with a [ in the path it must create the stage itself.
  Expand-Archive -LiteralPath $Zip -DestinationPath $Stage -Force
  $candidate = Join-Path $stage 'snipset.exe'
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'install.ps1: archive has no snipset.exe' }
  $windows = Test-SnipsetWindowsHost
  if ($windows) {
    if ($run -is [hashtable]) { $run.probe = $null }
    if (-not (Test-SnipsetBinary -Path $candidate)) {
      # 0xC0000135, STATUS_DLL_NOT_FOUND: the loader stopped before snipset.exe ran.
      if (($run -is [hashtable]) -and $run.probe -and ($run.probe.ExitCode -eq -1073741515)) {
        throw 'install.ps1: snipset.exe could not start: it needs libcrypto-3-x64.dll and VCRUNTIME140.dll, which this release does not ship; see the README Windows notes'
      }
      throw 'install.ps1: the downloaded snipset.exe failed "snipset.exe --version"; the installed snipset.exe was not changed'
    }
  } else {
    Write-SnipsetReport -Status SKIP -Item 'smoke' -Detail 'not a Windows host'
  }
  $exe = Join-Path $InstallDir 'snipset.exe'
  # Uninstall later deletes what it finds here, so never put our exe over someone else's file or a link.
  # Off Windows the existing exe cannot be run, so only a link is refused there.
  $existing = Get-Item -LiteralPath $exe -Force -ErrorAction SilentlyContinue
  if ($existing -and ($existing.LinkType -or ($windows -and -not (Test-SnipsetBinary -Path $exe)))) {
    throw "install.ps1: $exe exists and is not a snipset install; move it aside or pass -InstallDir"
  }
  if ($windows) {
    Clear-SnipsetOldExe -InstallDir $InstallDir
    $moved = Move-SnipsetExe -Candidate $candidate -Exe $exe
    if ($moved -eq 'in-use') {
      Write-SnipsetReport -Status FAIL -Item 'binary' -Detail 'in use (close the program using it)'
      return
    }
    if ($moved -ne 'moved') { Write-SnipsetReport -Status NOTE -Item 'binary' -Detail "$exe was in use; the old one is now $moved, delete it once that program exits" }
  } else {
    Move-Item -LiteralPath $candidate -Destination $exe -Force
  }
  if ($windows) {
    # Mark of the Web on the zip may or may not reach the extracted exe; Unblock-File is a no-op when absent.
    Unblock-File -LiteralPath $exe
  } else {
    Write-SnipsetReport -Status SKIP -Item 'unblock' -Detail 'not a Windows host'
  }
}
