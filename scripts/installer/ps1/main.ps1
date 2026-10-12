$mode = Get-SnipsetMode -Check:$Check -Update:$Update -Uninstall:$Uninstall
$mcpIds = Resolve-SnipsetMcpIds -WithMcp $WithMcp
$InstallDir = Resolve-SnipsetInstallDir -InstallDir $InstallDir
Assert-SnipsetPlatform
switch ($mode) {
  'check' { Invoke-SnipsetCheck -McpIds $mcpIds }
  'update' { Invoke-SnipsetUpdate -McpIds $mcpIds }
  'uninstall' { Invoke-SnipsetUninstall -McpIds $mcpIds }
  default { Invoke-SnipsetInstall -McpIds $mcpIds }
}
