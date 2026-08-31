param(
  [string]$TaskName = 'TassureProposalWordQA'
)

$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-visual-qa-worker.ps1'
if (-not (Test-Path -LiteralPath $runner)) { throw "Missing worker runner: $runner" }

$quotedRunner = '"' + $runner.Replace('"', '""') + '"'
$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File $quotedRunner"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'Renders Tassure proposal DOCX files in Microsoft Word and releases only QA-approved files.' `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Output "Installed and started scheduled task: $TaskName"
