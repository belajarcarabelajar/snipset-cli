function Get-SnipsetMcpCliName {
  param([string]$Id)
  @{ claude = 'claude'; codex = 'codex'; gemini = 'gemini'; vscode = 'code' }[$Id]
}

function Find-SnipsetMcpCli {
  param([string]$Id)
  $name = Get-SnipsetMcpCliName -Id $Id
  if (-not $name) { return $null }
  # Applications only: npm also installs a .ps1 shim, which would run in-process under the caller's execution policy.
  $found = Get-Command -Name $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $found.Source }
}

function Get-SnipsetMcpFile {
  param([string]$Id)
  $onWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
  switch ($Id) {
    'opencode' { [IO.Path]::Combine($HOME, '.config', 'opencode', 'opencode.json') }
    'cursor' { [IO.Path]::Combine($HOME, '.cursor', 'mcp.json') }
    'vscode' {
      if ($onWindows) { [IO.Path]::Combine($env:APPDATA, 'Code', 'User', 'mcp.json') }
      else { [IO.Path]::Combine($HOME, '.config', 'Code', 'User', 'mcp.json') }
    }
  }
}

function Get-SnipsetMcpServerArgs {
  param([string]$Db)
  if ($Db) { @('mcp', '--db', $Db) } else { @('mcp') }
}

function Get-SnipsetMcpCursorEntry {
  param([string]$Bin, [string]$Db)
  [ordered]@{ type = 'stdio'; command = $Bin; args = @(Get-SnipsetMcpServerArgs -Db $Db) }
}

function Get-SnipsetMcpFileContent {
  param([string]$Id, [string]$Bin, [string]$Db)
  if ($Id -eq 'opencode') {
    $command = @($Bin) + @(Get-SnipsetMcpServerArgs -Db $Db)
    $doc = [ordered]@{ '$schema' = 'https://opencode.ai/config.json'; mcp = [ordered]@{ snipset = [ordered]@{ type = 'local'; command = $command; enabled = $true } } }
  } else {
    $doc = [ordered]@{ mcpServers = [ordered]@{ snipset = (Get-SnipsetMcpCursorEntry -Bin $Bin -Db $Db) } }
  }
  (ConvertTo-Json -InputObject $doc -Depth 5 -Compress) + "`n"
}

function Invoke-SnipsetMcpCli {
  param([string]$Path, [string[]]$Arguments)
  # Windows PowerShell 5.1 turns redirected native stderr into a terminating error under 'Stop'.
  $ErrorActionPreference = 'Continue'
  $PSNativeCommandUseErrorActionPreference = $false
  # Legacy passing (Windows PowerShell 5.1, pwsh before 7.3, and pwsh 7.3+ for .cmd shims such as code.cmd)
  # drops inner double quotes unless they are escaped the way the C runtime parses them.
  $passing = Get-Variable -Name PSNativeCommandArgumentPassing -ValueOnly -ErrorAction SilentlyContinue
  if ((-not $passing) -or ("$passing" -eq 'Legacy') -or ("$passing" -eq 'Windows' -and $Path -match '\.(bat|cmd)$')) {
    $Arguments = @($Arguments | ForEach-Object { $_ -replace '(\\*)"', '$1$1\"' })
  }
  $output = @(& $Path @Arguments 2>&1)
  $code = $LASTEXITCODE
  $stdout = @($output | Where-Object { $_ -isnot [Management.Automation.ErrorRecord] } | ForEach-Object { "$_" })
  $stderr = @($output | Where-Object { $_ -is [Management.Automation.ErrorRecord] } | ForEach-Object { "$_" })
  $err = if ($stderr.Count -and $stderr[0].Trim()) { $stderr[0].Trim() } else { "exit status $code" }
  [pscustomobject]@{ Code = $code; Out = $stdout; Err = $err }
}

function Get-SnipsetMcpGeminiSettings {
  [IO.Path]::Combine($HOME, '.gemini', 'settings.json')
}

# Only a user-scope entry is the installer's: "remove --scope user" never touches
# another scope, and an entry in another scope can shadow the user one.
function Get-SnipsetMcpClaudeState {
  param([string]$Cli, [string]$Bin)
  $result = Invoke-SnipsetMcpCli -Path $Cli -Arguments @('mcp', 'get', 'snipset')
  if ($result.Code -ne 0) { return 'absent' }
  $scope = ''
  $first = ''
  $mine = $false
  $binSeen = $false
  foreach ($line in $result.Out) {
    if ($line -match '^\s*scope:\s*(.*?)\s*$') {
      $scope = switch -Regex ($Matches[1]) {
        '^user' { 'user' }
        '^local' { 'local' }
        '^project' { 'project' }
        default { ($_ -split '\s+')[0] }
      }
      if (-not $first) { $first = $scope }
    } elseif ($line -match '^\s*command:\s*(.*?)\s*$') {
      if ($Matches[1] -ceq $Bin) {
        $binSeen = $true
        if ($scope -eq 'user') { $mine = $true }
      }
      $scope = ''
    }
  }
  if (-not $first) { $first = 'unknown' }
  if ($mine) { return 'mine user' }
  if ($binSeen) { return "scoped $first" }
  "foreign $first"
}

# The user settings file decides ownership; "gemini mcp list" merges every scope.
function Get-SnipsetMcpGeminiState {
  param([string]$Cli, [string]$Bin)
  $settings = Get-SnipsetMcpGeminiSettings
  $text = if ([IO.File]::Exists($settings)) { [IO.File]::ReadAllText($settings) } else { '' }
  if ($text.Contains('"snipset"')) {
    if ($text.Contains((ConvertTo-Json -InputObject $Bin -Compress))) { return 'mine' }
    return 'foreign'
  }
  $result = Invoke-SnipsetMcpCli -Path $Cli -Arguments @('mcp', 'list')
  if ($result.Code -eq 0 -and ($result.Out | Where-Object { $_ -match '(^|\s)snipset:' })) { return 'scoped' }
  'absent'
}

# Detail for an entry the installer leaves alone because it sits in another scope.
function Get-SnipsetMcpScopedDetail {
  param([string]$Id, [string]$Scope)
  if ($Id -eq 'claude') { return "$Scope entry left untouched" }
  "snipset is registered outside $(Get-SnipsetMcpGeminiSettings); left untouched"
}

# Returns nocli, absent, other (file without snipset), mine, foreign, or scoped (the bin
# is registered in a scope the installer does not own); claude adds a second word naming the scope.
function Get-SnipsetMcpState {
  param([string]$Id, [string]$Bin)
  $cli = Find-SnipsetMcpCli -Id $Id
  if ($Id -in 'claude', 'codex', 'gemini') {
    if (-not $cli) { return 'nocli' }
    if ($Id -eq 'claude') { return Get-SnipsetMcpClaudeState -Cli $cli -Bin $Bin }
    if ($Id -eq 'gemini') { return Get-SnipsetMcpGeminiState -Cli $cli -Bin $Bin }
    $result = Invoke-SnipsetMcpCli -Path $cli -Arguments @('mcp', 'get', 'snipset')
    if ($result.Code -ne 0) { return 'absent' }
    $command = ''
    foreach ($line in $result.Out) {
      if ($line -match '^\s*command:\s*(.*?)\s*$') { $command = $Matches[1]; break }
    }
    if ($command -ceq $Bin) { return 'mine' }
    return 'foreign'
  }
  $file = Get-SnipsetMcpFile -Id $Id
  if (-not [IO.File]::Exists($file)) { return 'absent' }
  $text = [IO.File]::ReadAllText($file)
  # The files hold the path JSON-encoded, so Windows backslashes appear doubled.
  if ($text.Contains((ConvertTo-Json -InputObject $Bin -Compress))) { return 'mine' }
  if ($text.Contains('"snipset"')) { return 'foreign' }
  'other'
}

function Install-SnipsetMcp {
  param([string[]]$Ids, [string]$Bin, [string]$Db)
  foreach ($id in $Ids) {
    try {
      $cliName = Get-SnipsetMcpCliName -Id $id
      if ($cliName -and -not (Find-SnipsetMcpCli -Id $id)) {
        Write-SnipsetReport -Status SKIP -Item $id -Detail "$cliName not on PATH"
        continue
      }
      $state = ("$(Get-SnipsetMcpState -Id $id -Bin $Bin)" -split ' ')[0]
      $file = Get-SnipsetMcpFile -Id $id
      if ($id -in 'opencode', 'cursor') {
        if ($state -eq 'absent') {
          [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))
          [IO.File]::WriteAllText($file, (Get-SnipsetMcpFileContent -Id $id -Bin $Bin -Db $Db), (New-Object Text.UTF8Encoding $false))
          Write-SnipsetReport -Status ADD -Item $id -Detail "wrote $file"
          continue
        }
        if ($id -eq 'opencode') {
          Write-Host "MCP config exists; leaving $file untouched"
        } else {
          $entry = ConvertTo-Json -InputObject (Get-SnipsetMcpCursorEntry -Bin $Bin -Db $Db) -Depth 5 -Compress
          Write-Host "Cursor config exists; add this to mcpServers in ${file}: `"snipset`":$entry"
        }
        if ($state -eq 'other') {
          Write-SnipsetReport -Status KEEP -Item $id -Detail "$file exists; left untouched"
        } else {
          Write-SnipsetReport -Status KEEP -Item $id -Detail 'snipset is already registered'
        }
        continue
      }
      if ($state -in 'mine', 'foreign', 'scoped') {
        Write-SnipsetReport -Status KEEP -Item $id -Detail 'snipset is already registered'
        continue
      }
      $server = @($Bin) + @(Get-SnipsetMcpServerArgs -Db $Db)
      $argv = switch ($id) {
        'claude' { @('mcp', 'add', '--scope', 'user', 'snipset', '--') + $server }
        'codex' { @('mcp', 'add', 'snipset', '--') + $server }
        'gemini' { @('mcp', 'add', '--scope', 'user', 'snipset') + $server }
        'vscode' {
          $json = ConvertTo-Json -InputObject ([ordered]@{ name = 'snipset'; command = $Bin; args = @(Get-SnipsetMcpServerArgs -Db $Db) }) -Depth 5 -Compress
          @('--add-mcp', $json)
        }
      }
      $result = Invoke-SnipsetMcpCli -Path (Find-SnipsetMcpCli -Id $id) -Arguments $argv
      if ($result.Code -eq 0) {
        Write-SnipsetReport -Status ADD -Item $id -Detail 'snipset registered'
      } else {
        Write-SnipsetReport -Status FAIL -Item $id -Detail $result.Err
      }
    } catch {
      Write-SnipsetReport -Status FAIL -Item $id -Detail $_.Exception.Message
    }
  }
}

function Test-SnipsetMcp {
  param([string[]]$Ids, [string]$Bin)
  if (-not $Ids) {
    Write-SnipsetReport -Status SKIP -Item 'mcp' -Detail 'no -WithMcp list'
    return
  }
  foreach ($id in $Ids) {
    try {
      $cliName = Get-SnipsetMcpCliName -Id $id
      if ($cliName -and -not (Find-SnipsetMcpCli -Id $id)) {
        Write-SnipsetReport -Status SKIP -Item $id -Detail "$cliName not on PATH"
        continue
      }
      $state, $scope = "$(Get-SnipsetMcpState -Id $id -Bin $Bin)" -split ' ', 2
      switch ($state) {
        'mine' { Write-SnipsetReport -Status OK -Item $id -Detail "snipset points at $Bin" }
        'foreign' { Write-SnipsetReport -Status KEEP -Item $id -Detail 'snipset points elsewhere' }
        'scoped' { Write-SnipsetReport -Status KEEP -Item $id -Detail (Get-SnipsetMcpScopedDetail -Id $id -Scope $scope) }
        default { Write-SnipsetReport -Status MISSING -Item $id -Detail 'snipset is not registered' }
      }
    } catch {
      Write-SnipsetReport -Status FAIL -Item $id -Detail $_.Exception.Message
    }
  }
}

function Remove-SnipsetMcp {
  param([string[]]$Ids, [string]$Bin, [string]$Db)
  if (-not $Ids) { $Ids = @('claude', 'codex', 'gemini', 'opencode', 'cursor', 'vscode') }
  foreach ($id in $Ids) {
    try {
      $state, $scope = "$(Get-SnipsetMcpState -Id $id -Bin $Bin)" -split ' ', 2
      $file = Get-SnipsetMcpFile -Id $id
      if ($state -eq 'nocli') {
        Write-SnipsetReport -Status SKIP -Item $id -Detail "$(Get-SnipsetMcpCliName -Id $id) not on PATH"
      } elseif ($state -eq 'scoped' -or ($id -eq 'claude' -and $state -eq 'foreign')) {
        Write-SnipsetReport -Status KEEP -Item $id -Detail (Get-SnipsetMcpScopedDetail -Id $id -Scope $scope)
      } elseif ($state -eq 'foreign') {
        Write-SnipsetReport -Status KEEP -Item $id -Detail 'snipset points elsewhere'
      } elseif ($state -ne 'mine') {
        Write-SnipsetReport -Status SKIP -Item $id -Detail 'snipset is not registered'
      } elseif ($id -eq 'vscode') {
        Write-SnipsetReport -Status KEEP -Item $id -Detail "remove snipset from $file by hand"
      } elseif ($file) {
        $expected = (New-Object Text.UTF8Encoding $false).GetBytes((Get-SnipsetMcpFileContent -Id $id -Bin $Bin -Db $Db))
        if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($file)) -ceq [Convert]::ToBase64String($expected)) {
          [IO.File]::Delete($file)
          Write-SnipsetReport -Status REMOVED -Item $id -Detail $file
        } else {
          Write-SnipsetReport -Status KEEP -Item $id -Detail "$file differs from what the installer writes; remove snipset by hand"
        }
      } else {
        $argv = @{ claude = @('mcp', 'remove', '--scope', 'user', 'snipset'); codex = @('mcp', 'remove', 'snipset'); gemini = @('mcp', 'remove', '--scope', 'user', 'snipset') }[$id]
        $result = Invoke-SnipsetMcpCli -Path (Find-SnipsetMcpCli -Id $id) -Arguments $argv
        if ($result.Code -eq 0) {
          Write-SnipsetReport -Status REMOVED -Item $id -Detail 'snipset'
        } else {
          Write-SnipsetReport -Status FAIL -Item $id -Detail $result.Err
        }
      }
    } catch {
      Write-SnipsetReport -Status FAIL -Item $id -Detail $_.Exception.Message
    }
  }
}
