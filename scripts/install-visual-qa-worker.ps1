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
# RestartCount/RestartInterval are the LAST-RESORT safety net for a fatal,
# uncatchable process death (OOM, a Node runtime crash) — the ordinary case
# (a hung render, a Supabase network blip) is now caught inside the
# --watch loop itself (see visual-qa-worker.ts's main()) and never reaches
# a process exit at all. Before that in-process fix existed, 5 retries at
# 1-minute intervals (a 5-minute total budget) was not enough to outlast
# contention from another process also using Word for more than ~5
# minutes, and once exhausted the worker stayed dead until someone
# manually restarted the scheduled task. 999 is Task Scheduler's maximum
# allowed restart count, kept here purely as defense in depth.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
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
