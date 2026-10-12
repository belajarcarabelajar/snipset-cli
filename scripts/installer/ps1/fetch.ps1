function Resolve-SnipsetVersion {
  if ($Version -and $Version -notmatch '^v?\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$') { throw 'install.ps1: invalid version' }
  if ($Version -and $Version -notlike 'v*') { $Version = "v$Version" }
  if (-not $Version) { $Version = (Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest").tag_name }
  if ($Version -notmatch '^v\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$') { throw 'install.ps1: release version was not found' }
  $Version
}
function Get-SnipsetRelease {
  param([string]$Temp)
  $sums = Join-Path $temp 'SHA256SUMS'
  $zip = Join-Path $temp $archive
  Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/SHA256SUMS" -OutFile $sums
  Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/$archive" -OutFile $zip
  $line = Get-Content $sums | Where-Object { $_ -match "\s$([regex]::Escape($archive))$" } | Select-Object -First 1
  if (-not $line -or $line -notmatch '^([0-9a-fA-F]{64})\s+') { throw 'install.ps1: checksum entry missing' }
  $expected = $Matches[1].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw 'install.ps1: checksum mismatch' }
  $zip
}
