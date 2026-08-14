$ErrorActionPreference = 'Stop'

$taskName = 'Hallmark Daily Operations Telegram Report'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$batchPath = Join-Path $scriptDirectory 'send-daily-operations-report.bat'

if (-not (Test-Path -LiteralPath $batchPath)) {
  throw "Missing $batchPath"
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

Write-Host "Installed '$taskName' for 9:00 AM every day."
