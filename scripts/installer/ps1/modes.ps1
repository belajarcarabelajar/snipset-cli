# The called functions read these locals and the parameters through dynamic scoping, not $script:.
# The README one-liner runs install.ps1 as a scriptblock, where $script: is the caller's session.
function Invoke-SnipsetInstall {
  $Version = Resolve-SnipsetVersion
  $archive = "snipset-cli-$Version-$target.zip"
  $releaseUrl = "$baseUrl/$Version"
  $temp = Join-Path ([IO.Path]::GetTempPath()) ('snipset-install-' + [Guid]::NewGuid().ToString('N'))
  $stage = Join-Path $InstallDir ('.snipset-stage-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $temp | Out-Null
  try {
    $zip = Get-SnipsetRelease -Temp $temp
    Test-SnipsetArchive -Zip $zip
    Install-SnipsetBinary -Zip $zip -Stage $stage -InstallDir $InstallDir
    if ($AddPath) { Add-SnipsetToUserPath -Dir $InstallDir }
    Write-Output "Installed snipset $Version to $(Join-Path $InstallDir 'snipset.exe')"
  } finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
  }
}
