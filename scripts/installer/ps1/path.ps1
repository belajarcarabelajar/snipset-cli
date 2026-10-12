function Test-SnipsetPathEntrySame {
  param([string]$Entry, [string]$Dir)
  [string]::Equals($Entry.TrimEnd('\'), $Dir.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
}

function Get-SnipsetPathEntries {
  param([string]$Raw)
  "$Raw" -split ';' | Where-Object { $_ -ne '' }
}

function Test-SnipsetPathEntry {
  param([string]$Raw, [string]$Dir)
  @(Get-SnipsetPathEntries -Raw $Raw | Where-Object { Test-SnipsetPathEntrySame -Entry $_ -Dir $Dir }).Count -gt 0
}

function Add-SnipsetPathEntry {
  param([string]$Raw, [string]$Dir)
  # @() keeps a value holding one entry an array; without it, appending joins two strings (C:\aC:\b).
  $parts = @(Get-SnipsetPathEntries -Raw $Raw)
  if (-not (Test-SnipsetPathEntry -Raw $Raw -Dir $Dir)) { $parts += $Dir }
  $parts -join ';'
}

function Remove-SnipsetPathEntry {
  param([string]$Raw, [string]$Dir)
  @(Get-SnipsetPathEntries -Raw $Raw | Where-Object { -not (Test-SnipsetPathEntrySame -Entry $_ -Dir $Dir) }) -join ';'
}

function Get-SnipsetUserPath {
  if (-not (Test-SnipsetWindowsHost)) {
    # Out-Host keeps the report line out of the value the caller assigns.
    Write-SnipsetReport -Status SKIP -Item 'path' -Detail 'not a Windows host' | Out-Host
    return $null
  }
  # The registry value, not [Environment]::GetEnvironmentVariable, so %USERPROFILE%-style entries stay unexpanded.
  (Get-Item 'HKCU:\Environment').GetValue('Path', '', 'DoNotExpandEnvironmentNames')
}

function Set-SnipsetUserPath {
  param([string]$Raw)
  if (-not (Test-SnipsetWindowsHost)) {
    Write-SnipsetReport -Status SKIP -Item 'path' -Detail 'not a Windows host'
    return
  }
  Set-ItemProperty -Path 'HKCU:\Environment' -Name Path -Value $Raw -Type ExpandString
  # Set-ItemProperty sends no WM_SETTINGCHANGE; SetEnvironmentVariable on a User variable does, so new shells see the PATH.
  $probe = 'SNIPSET_INSTALL_PATH_BROADCAST'
  [Environment]::SetEnvironmentVariable($probe, '1', 'User')
  [Environment]::SetEnvironmentVariable($probe, $null, 'User')
}

function Install-SnipsetPathEnv {
  param([string]$Dir)
  if (-not (Test-SnipsetWindowsHost)) {
    Write-SnipsetReport -Status SKIP -Item 'path' -Detail 'not a Windows host'
    return
  }
  $raw = Get-SnipsetUserPath
  if (Test-SnipsetPathEntry -Raw $raw -Dir $Dir) {
    Write-SnipsetReport -Status OK -Item 'path' -Detail "$Dir is already on the user PATH"
    return
  }
  Set-SnipsetUserPath -Raw (Add-SnipsetPathEntry -Raw $raw -Dir $Dir)
  Write-SnipsetReport -Status ADD -Item 'path' -Detail "added $Dir to the user PATH; open a new terminal to use it"
}

function Test-SnipsetPathEnv {
  param([string]$Dir)
  if (-not (Test-SnipsetWindowsHost)) {
    Write-SnipsetReport -Status SKIP -Item 'path' -Detail 'not a Windows host'
    return
  }
  if (Test-SnipsetPathEntry -Raw (Get-SnipsetUserPath) -Dir $Dir) {
    Write-SnipsetReport -Status OK -Item 'path' -Detail "$Dir is on the user PATH"
  } else {
    Write-SnipsetReport -Status MISSING -Item 'path' -Detail "$Dir is not on the user PATH"
  }
}

function Remove-SnipsetPathEnv {
  param([string]$Dir)
  if (-not (Test-SnipsetWindowsHost)) {
    Write-SnipsetReport -Status SKIP -Item 'path' -Detail 'not a Windows host'
    return
  }
  $raw = Get-SnipsetUserPath
  if (-not (Test-SnipsetPathEntry -Raw $raw -Dir $Dir)) {
    Write-SnipsetReport -Status SKIP -Item 'path' -Detail "$Dir is not on the user PATH"
    return
  }
  Set-SnipsetUserPath -Raw (Remove-SnipsetPathEntry -Raw $raw -Dir $Dir)
  Write-SnipsetReport -Status REMOVED -Item 'path' -Detail "$Dir from the user PATH"
}
