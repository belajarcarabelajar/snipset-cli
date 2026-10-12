function Get-SnipsetFromVersion {
  param([string]$From)
  $sums = Join-Path $From 'SHA256SUMS'
  if (-not (Test-Path -LiteralPath $sums -PathType Leaf)) { throw "install.ps1: $sums is missing" }
  $pattern = '^[0-9a-fA-F]{64}\s+snipset-cli-(v\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?)-' + [regex]::Escape($target) + '\.zip$'
  $found = @(Get-Content -LiteralPath $sums | ForEach-Object { if ($_ -match $pattern) { $Matches[1] } } | Sort-Object -Unique)
  if ($found.Count -ne 1) { throw "install.ps1: expected one snipset-cli-v<VERSION>-$target.zip in $sums, found $($found.Count); pass -Version" }
  $found[0]
}
function Resolve-SnipsetVersion {
  if ($Version -and $Version -notmatch '^v?\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$') { throw 'install.ps1: invalid version' }
  if ($Version -and $Version -notlike 'v*') { $Version = "v$Version" }
  if (-not $Version -and $From) { $Version = Get-SnipsetFromVersion -From $From }
  if (-not $Version) { $Version = (Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest").tag_name }
  if ($Version -notmatch '^v\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$') { throw 'install.ps1: release version was not found' }
  $Version
}
function Get-SnipsetRelease {
  param([string]$Temp)
  $sums = Join-Path $temp 'SHA256SUMS'
  $zip = Join-Path $temp $archive
  if ($From) {
    foreach ($name in 'SHA256SUMS', $archive) {
      $source = Join-Path $From $name
      if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "install.ps1: $source is missing" }
      Copy-Item -LiteralPath $source -Destination (Join-Path $temp $name)
    }
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/SHA256SUMS" -OutFile $sums
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/$archive" -OutFile $zip
  }
  $line = Get-Content $sums | Where-Object { $_ -match "\s$([regex]::Escape($archive))$" } | Select-Object -First 1
  if (-not $line -or $line -notmatch '^([0-9a-fA-F]{64})\s+') { throw 'install.ps1: checksum entry missing' }
  $expected = $Matches[1].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw 'install.ps1: checksum mismatch' }
  $zip
}
