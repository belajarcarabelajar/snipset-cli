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
function Install-SnipsetBinary {
  param([string]$Zip, [string]$Stage, [string]$InstallDir)
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
  $candidate = Join-Path $stage 'snipset.exe'
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'install.ps1: archive has no snipset.exe' }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Move-Item -LiteralPath $candidate -Destination (Join-Path $InstallDir 'snipset.exe') -Force
}
