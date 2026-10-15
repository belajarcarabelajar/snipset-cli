function Get-SnipsetFromVersion {
  param([string]$From)
  $sums = Join-Path $From 'SHA256SUMS'
  if (-not (Test-Path -LiteralPath $sums -PathType Leaf)) { throw "install.ps1: $sums is missing" }
  $pattern = '^[0-9a-fA-F]{64}\s+\*?snipset-cli-(v\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?)-' + [regex]::Escape($target) + '\.zip$'
  $found = @(Get-Content -LiteralPath $sums | ForEach-Object { if ($_ -match $pattern) { $Matches[1] } } | Sort-Object -Unique)
  if ($found.Count -ne 1) { throw "install.ps1: expected one snipset-cli-v<VERSION>-$target.zip in $sums, found $($found.Count); pass -Version" }
  $found[0]
}
function Resolve-SnipsetVersion {
  # Case-sensitive: release tags are lowercase vX.Y.Z, so V0.2.0 names a tag that does not exist.
  if ($Version -and $Version -cnotmatch '^v?\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$') { throw 'install.ps1: invalid version' }
  if ($Version -and $Version -cnotlike 'v*') { $Version = "v$Version" }
  if (-not $Version -and $From) { $Version = Get-SnipsetFromVersion -From $From }
  if (-not $Version) {
    try { $Version = (Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest").tag_name }
    catch {
      $status = $_.Exception.Response.StatusCode
      if ($status) { throw "install.ps1: release version was not found (HTTP $([int]$status))" }
      throw 'install.ps1: release version was not found'
    }
  }
  if ($Version -cnotmatch '^v\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$') { throw 'install.ps1: release version was not found' }
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
    # A loopback http URL is a local mirror or a test server, so nothing crosses the network unencrypted.
    $loopback = $baseUrl -match '^http://(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?(/|$)'
    if ($baseUrl -notlike 'https://*' -and -not $loopback) { throw "install.ps1: SNIPSET_RELEASE_BASE_URL must start with https:// (got $baseUrl); use -From <dir> for local files" }
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/SHA256SUMS" -OutFile $sums
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/$archive" -OutFile $zip
  }
  # `*` is the binary-mode marker that `sha256sum -b` writes before the name.
  $entry = '^([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($archive) + '$'
  $line = Get-Content -LiteralPath $sums | Where-Object { $_ -match $entry } | Select-Object -First 1
  if (-not $line -or $line -notmatch $entry) { throw 'install.ps1: checksum entry missing' }
  $expected = $Matches[1].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw 'install.ps1: checksum mismatch' }
  $zip
}
