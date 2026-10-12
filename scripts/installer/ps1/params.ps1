# Get-Help skips a help block that touches the comment above it (the bundle notice), so keep the blank line below.

<#
.SYNOPSIS
Installs, checks, updates, or removes the snipset CLI on Windows.

.DESCRIPTION
Downloads the snipset-cli release zip for x86_64-pc-windows-msvc, verifies it against SHA256SUMS,
and places snipset.exe in the install directory. Every step prints one report line. Usage errors,
refusals, and drift throw, so "pwsh -File install.ps1" ends with status 1. The script never closes the
session it runs in, because the documented one-liner runs it as a scriptblock inside your own session.

.PARAMETER Version
Release to install, for example v0.1.0 or 0.1.0. Defaults to the latest GitHub release.

.PARAMETER InstallDir
Directory for snipset.exe. Defaults to $env:LOCALAPPDATA\Snipset\bin.

.PARAMETER AddPath
Also add the install directory to the user PATH.

.PARAMETER WithMcp
Register the snipset MCP server with these harnesses: claude, codex, gemini, opencode, cursor, vscode,
or all. Accepts one comma-separated string or several strings.

.PARAMETER Database
Path to the Snipset database that registered MCP servers should use (passed as --db). The Windows form
of install.sh --db. Defaults to the CLI's own location.

.PARAMETER From
Install from a local directory holding SHA256SUMS and the release zip instead of downloading.

.PARAMETER DryRun
Print one [DRY] line per step and write nothing.

.PARAMETER Check
Report whether the installation is current; throws on drift. Cannot be combined with -Update or -Uninstall.

.PARAMETER Update
Install the requested or latest release over the current one. Cannot be combined with -Check or -Uninstall.

.PARAMETER Uninstall
Remove what the installer added. Cannot be combined with -Check or -Update.

.EXAMPLE
& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/belajarcarabelajar/snipset-cli/main/install.ps1).Content)) -Version v0.2.0 -AddPath

Installs v0.2.0 into $env:LOCALAPPDATA\Snipset\bin and adds that directory to the user PATH.

.EXAMPLE
.\install.ps1 -Version v0.1.0 -WithMcp claude,codex -DryRun

Prints the steps for installing v0.1.0 and registering MCP for Claude Code and Codex, without writing anything.
#>
# Named only: -Db is the alias of the common -Debug, so "-Db x" would otherwise quietly bind x to -Version.
[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Version,
  [string]$InstallDir,
  [switch]$AddPath,
  [string[]]$WithMcp,
  [string]$From,
  [switch]$DryRun,
  [switch]$Check,
  [switch]$Update,
  [switch]$Uninstall,
  [string]$Database
)
