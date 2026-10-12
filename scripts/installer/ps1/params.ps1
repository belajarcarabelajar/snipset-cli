[CmdletBinding()]
param(
  [string]$Version,
  [string]$InstallDir = $(Join-Path $env:LOCALAPPDATA 'Snipset\bin'),
  [switch]$AddPath
)
