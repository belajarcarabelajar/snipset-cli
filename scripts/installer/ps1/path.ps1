function Add-SnipsetToUserPath {
  param([string]$Dir)
  $parts = [Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object { $_ }
  if ($parts -notcontains $Dir) { [Environment]::SetEnvironmentVariable('Path', (($parts + $Dir) -join ';'), 'User') }
}
