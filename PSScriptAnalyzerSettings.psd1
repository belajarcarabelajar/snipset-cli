@{
  Severity     = @('Error', 'Warning')
  ExcludeRules = @(
    # Script-level parameters are read inside functions, which this rule cannot see.
    'PSReviewUnusedParameter',
    # The three empty catches are deliberate best-effort steps, each commented in place.
    'PSAvoidUsingEmptyCatchBlock',
    # The installer prints its report lines for a person at a console, often through the one-liner scriptblock.
    'PSAvoidUsingWriteHost',
    # Naming and -WhatIf plumbing: -DryRun is the installer's preview, and these helpers are internal.
    'PSUseSingularNouns',
    'PSUseShouldProcessForStateChangingFunctions'
  )
  Rules        = @{
    # install.ps1 runs on Windows PowerShell 5.1 as well as pwsh 7.
    PSUseCompatibleSyntax = @{
      Enable         = $true
      TargetVersions = @('5.1', '7.0')
    }
  }
}
