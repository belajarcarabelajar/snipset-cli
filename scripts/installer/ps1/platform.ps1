$target = 'x86_64-pc-windows-msvc'

function Test-SnipsetWindowsHost {
  # Windows PowerShell 5.1 has no $IsWindows and runs only on Windows; pwsh 7 defines it on every OS,
  # so OS=Windows_NT set by hand on Linux must not count.
  if ($null -ne $IsWindows) { return [bool]$IsWindows }
  $env:OS -eq 'Windows_NT'
}

function Get-SnipsetArchDecision {
  param([string]$Arch, [string]$Wow, [int]$Build)
  # A 32-bit process sees x86 in PROCESSOR_ARCHITECTURE and the real CPU in PROCESSOR_ARCHITEW6432.
  $effective = if ($Wow) { $Wow } else { $Arch }
  if ($effective -eq 'AMD64') { return 'ok' }
  if ($effective -eq 'ARM64') {
    # Windows 11 (build 22000) emulates x64 on Arm; Windows 10 on Arm emulates x86 only.
    if ($Build -ge 22000) { return 'ok-emulated' }
    return 'refuse:Windows 10 on Arm cannot run the x64 build; use Windows 11'
  }
  "refuse:unsupported CPU $(if ($effective) { $effective } else { 'unknown' })"
}

function Assert-SnipsetPlatform {
  param(
    [string]$Arch = $env:PROCESSOR_ARCHITECTURE,
    [string]$Wow = $env:PROCESSOR_ARCHITEW6432,
    [int]$Build = [Environment]::OSVersion.Version.Build
  )
  if (-not (Test-SnipsetWindowsHost)) {
    if ($env:SNIPSET_INSTALL_ALLOW_NON_WINDOWS -eq '1') {
      Write-SnipsetReport -Status SKIP -Item 'platform' -Detail 'non-Windows host (test switch)'
      return
    }
    throw 'install.ps1 installs the Windows build; on Linux use install.sh'
  }
  $cpu = if ($Wow) { $Wow } else { $Arch }
  $decision = Get-SnipsetArchDecision -Arch $Arch -Wow $Wow -Build $Build
  if ($decision -like 'refuse:*') { throw "install.ps1: $($decision.Substring('refuse:'.Length))" }
  if ($decision -eq 'ok-emulated') {
    Write-SnipsetReport -Status NOTE -Item 'platform' -Detail "Windows $cpu build $Build runs the x64 build under emulation"
  } else {
    Write-SnipsetReport -Status OK -Item 'platform' -Detail "Windows $cpu build $Build"
  }
}
