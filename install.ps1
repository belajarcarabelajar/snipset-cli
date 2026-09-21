[CmdletBinding()]
param(
  [string]$Version,
  [string]$InstallDir = $(Join-Path $env:LOCALAPPDATA 'Snipset\bin'),
  [switch]$AddPath
)
$ErrorActionPreference = 'Stop'
$repo = 'belajarcarabelajar/snipset-cli'
$baseUrl = if ($env:SNIPSET_RELEASE_BASE_URL) { $env:SNIPSET_RELEASE_BASE_URL } else { "https://github.com/$repo/releases/download" }
if ($Version -and $Version -notmatch '^v?\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$') { throw 'install.ps1: invalid version' }
if ($Version -and $Version -notlike 'v*') { $Version = "v$Version" }
if (-not $Version) { $Version = (Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest").tag_name }
if ($Version -notmatch '^v\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$') { throw 'install.ps1: release version was not found' }
$target = 'x86_64-pc-windows-msvc'
$archive = "snipset-cli-$Version-$target.zip"
$releaseUrl = "$baseUrl/$Version"
$temp = Join-Path ([IO.Path]::GetTempPath()) ('snipset-install-' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $InstallDir ('.snipset-stage-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temp | Out-Null
try {
  $sums = Join-Path $temp 'SHA256SUMS'
  $zip = Join-Path $temp $archive
  Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/SHA256SUMS" -OutFile $sums
  Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/$archive" -OutFile $zip
  $line = Get-Content $sums | Where-Object { $_ -match "\s$([regex]::Escape($archive))$" } | Select-Object -First 1
  if (-not $line -or $line -notmatch '^([0-9a-fA-F]{64})\s+') { throw 'install.ps1: checksum entry missing' }
  $expected = $Matches[1].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw 'install.ps1: checksum mismatch' }
  $entries = [IO.Compression.ZipFile]::OpenRead($zip).Entries
  foreach ($entry in $entries) {
    if ([IO.Path]::IsPathRooted($entry.FullName) -or $entry.FullName -match '(^|[\\/])\.\.([\\/]|$)' -or $entry.FullName -match '(^|[\\/])\.git([\\/]|$)') { throw 'install.ps1: unsafe archive entry' }
  }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
  $candidate = Join-Path $stage 'snipset.exe'
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'install.ps1: archive has no snipset.exe' }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Move-Item -LiteralPath $candidate -Destination (Join-Path $InstallDir 'snipset.exe') -Force
  if ($AddPath) {
    $parts = [Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object { $_ }
    if ($parts -notcontains $InstallDir) { [Environment]::SetEnvironmentVariable('Path', (($parts + $InstallDir) -join ';'), 'User') }
  }
  Write-Output "Installed snipset $Version to $(Join-Path $InstallDir 'snipset.exe')"
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
