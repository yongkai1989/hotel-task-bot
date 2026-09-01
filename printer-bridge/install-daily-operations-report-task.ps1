$ErrorActionPreference = 'Stop'

$taskName = 'Hallmark Daily Operations Telegram Report'
$hkMorningReviewTaskName = 'Hallmark HK Morning Review'
$chambermaidTaskName = 'Hallmark Chambermaid Save Reminder'
$linenVarianceTaskName = 'Hallmark Linen Difference Follow-up'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$batchPath = Join-Path $scriptDirectory 'send-daily-operations-report.bat'
$hkMorningReviewBatchPath = Join-Path $scriptDirectory 'send-hk-morning-review.bat'
$chambermaidBatchPath = Join-Path $scriptDirectory 'send-chambermaid-reminder.bat'
$linenVarianceBatchPath = Join-Path $scriptDirectory 'send-linen-variance-reminder.bat'

if (-not (Test-Path -LiteralPath $batchPath)) {
  throw "Missing $batchPath"
}
if (-not (Test-Path -LiteralPath $hkMorningReviewBatchPath)) {
  throw "Missing $hkMorningReviewBatchPath"
}
if (-not (Test-Path -LiteralPath $chambermaidBatchPath)) {
  throw "Missing $chambermaidBatchPath"
}
if (-not (Test-Path -LiteralPath $linenVarianceBatchPath)) {
  throw "Missing $linenVarianceBatchPath"
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

$hkMorningReviewAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$hkMorningReviewBatchPath`"`""
$hkMorningReviewTrigger = New-ScheduledTaskTrigger -Daily -At '08:30'

Register-ScheduledTask `
  -TaskName $hkMorningReviewTaskName `
  -Action $hkMorningReviewAction `
  -Trigger $hkMorningReviewTrigger `
  -Settings $settings `
  -Description 'Sends yesterday''s HK morning review to the HK Telegram chat at 8:30 AM.' `
  -Force | Out-Null

$linenVarianceAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$linenVarianceBatchPath`"`""
$linenVarianceTrigger = New-ScheduledTaskTrigger -Daily -At '18:00'

Register-ScheduledTask `
  -TaskName $linenVarianceTaskName `
  -Action $linenVarianceAction `
  -Trigger $linenVarianceTrigger `
  -Settings $settings `
  -Description 'Sends all Block and Level linen differences of plus or minus 2 or more to the HK Telegram chat at 6:00 PM.' `
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
Write-Host "Installed '$hkMorningReviewTaskName' for 8:30 AM every day."
Write-Host "Installed '$chambermaidTaskName' for 5:00 PM every day."
Write-Host "Installed '$linenVarianceTaskName' for 6:00 PM every day."
