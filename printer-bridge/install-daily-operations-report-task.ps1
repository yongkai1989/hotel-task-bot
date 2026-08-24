$ErrorActionPreference = 'Stop'

$taskName = 'Hallmark Daily Operations Telegram Report'
$chambermaidTaskName = 'Hallmark Chambermaid Save Reminder'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$batchPath = Join-Path $scriptDirectory 'send-daily-operations-report.bat'
$chambermaidBatchPath = Join-Path $scriptDirectory 'send-chambermaid-reminder.bat'

if (-not (Test-Path -LiteralPath $batchPath)) {
  throw "Missing $batchPath"
}
if (-not (Test-Path -LiteralPath $chambermaidBatchPath)) {
  throw "Missing $chambermaidBatchPath"
}

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$batchPath`"`""
$trigger = New-ScheduledTaskTrigger -Daily -At '09:00'
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'Sends yesterday''s Hallmark daily operations summary to Telegram at 9:00 AM.' `
  -Force | Out-Null

$chambermaidAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$chambermaidBatchPath`"`""
$chambermaidTrigger = New-ScheduledTaskTrigger -Daily -At '17:00'

Register-ScheduledTask `
  -TaskName $chambermaidTaskName `
  -Action $chambermaidAction `
  -Trigger $chambermaidTrigger `
  -Settings $settings `
  -Description 'Checks Chambermaid entries at 5:00 PM and pushes one reminder only when rooms remain unsaved.' `
  -Force | Out-Null

Write-Host "Installed '$taskName' for 9:00 AM every day."
Write-Host "Installed '$chambermaidTaskName' for 5:00 PM every day."
