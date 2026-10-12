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
function Test-SnipsetBinary {
  param([string]$Path)
  # Windows PowerShell 5.1 turns native stderr into a terminating error under 'Stop'; this scope only.
  $ErrorActionPreference = 'Continue'
  try { $out = @(& $Path --version 2>$null) } catch { return $false }
  ($LASTEXITCODE -eq 0) -and (($out -join "`n").StartsWith('snipset '))
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
function Install-SnipsetBinary {
  param([string]$Zip, [string]$Stage, [string]$InstallDir)
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
  $candidate = Join-Path $stage 'snipset.exe'
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'install.ps1: archive has no snipset.exe' }
  $windows = Test-SnipsetWindowsHost
  if ($windows) {
    if (-not (Test-SnipsetBinary -Path $candidate)) { throw 'install.ps1: the downloaded snipset.exe failed "snipset.exe --version"; the installed snipset.exe was not changed' }
  } else {
    Write-SnipsetReport -Status SKIP -Item 'smoke' -Detail 'not a Windows host'
  }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $exe = Join-Path $InstallDir 'snipset.exe'
  Move-Item -LiteralPath $candidate -Destination $exe -Force
  if ($windows) {
    # Mark of the Web on the zip may or may not reach the extracted exe; Unblock-File is a no-op when absent.
    Unblock-File -LiteralPath $exe
  } else {
    Write-SnipsetReport -Status SKIP -Item 'unblock' -Detail 'not a Windows host'
  }
}
