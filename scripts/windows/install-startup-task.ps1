<#
.SYNOPSIS
  Registers a Windows Scheduled Task so start-trame.ps1 (AUTOMATIC1111 +
  Ollama + the Tailscale Funnel bridge, all together) starts automatically
  at logon and restarts itself if it ever crashes.

.DESCRIPTION
  Run this ONCE (as the user who will be logged in when you want everything
  running -- not as a different admin account). After that, the whole
  stack starts on its own every time you log into Windows, with no console
  window popping up, and Windows itself relaunches it if it crashes while
  the PC stays on (see .NOTES for what this can't do).

  Uses "At log on" as an interactive trigger rather than "whether user is
  logged on or not", on purpose: the tray icon from ollama-watcher.ps1
  needs an actual desktop session to display in, and this is meant to run
  while you're using the PC anyway.

.PARAMETER TaskName
  Name of the Scheduled Task. Defaults to "TrameOllamaBridge".

.PARAMETER ScriptArgs
  Extra arguments forwarded to start-trame.ps1, e.g.
  "-Model qwen3:14b" or "-SkipChroma". Defaults to none (that
  script's own defaults apply).

.NOTES
  - Run this from a normal (not necessarily Administrator) PowerShell
    window logged in as yourself; if it fails with an access-denied error,
    retry from an Administrator window.
  - What this does NOT do: turn your PC on from fully off, or recover if
    Windows itself doesn't boot -- Wake-on-LAN needs its own separate setup
    (BIOS + router + something always-on on your home network to send the
    wake packet) and is a different, larger project on top of this one.
  - Not executed on a real Windows machine by the assistant that wrote it --
    built from documented Register-ScheduledTask/New-ScheduledTask* cmdlet
    behavior, but please report back anything that errors.

.EXAMPLE
  .\install-startup-task.ps1
  .\install-startup-task.ps1 -ScriptArgs "-Model llama3.1:8b"
#>

[CmdletBinding()]
param(
  [string]$TaskName = "TrameOllamaBridge",
  [string]$ScriptArgs = ""
)

$ErrorActionPreference = "Stop"

$mainScript = Join-Path $PSScriptRoot "start-trame.ps1"
if (-not (Test-Path $mainScript)) {
  Write-Host "ECHEC : start-trame.ps1 introuvable a cote de ce script ($PSScriptRoot)." -ForegroundColor Red
  exit 1
}

$argumentLine = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$mainScript`" $ScriptArgs".Trim()

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argumentLine
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# RestartCount/RestartInterval is Windows' own answer to "the script crashed,
# please try again" -- no need for retry logic inside the script itself for
# the case where the PC stays on but the process dies.
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable

# Interactive logon type (not "S4U"/"whether logged on or not") so the tray
# icon has a real desktop session to render into.
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null
} catch {
  Write-Host "ECHEC : impossible d'enregistrer la tache planifiee -- $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Relancez ce script depuis un PowerShell en mode Administrateur." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "OK : tache planifiee '$TaskName' enregistree." -ForegroundColor Green
Write-Host "Elle se lancera automatiquement a chaque ouverture de session Windows pour $env:USERNAME,"
Write-Host "et Windows la relancera seule si le script plante pendant que le PC reste allume."
Write-Host ""
Write-Host "Pour tester tout de suite sans redemarrer :"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "Pour la retirer plus tard :"
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
Write-Host ""
Write-Host "Journal de la derniere execution : $env:USERPROFILE\TrameOllamaBridge\bridge.log"
