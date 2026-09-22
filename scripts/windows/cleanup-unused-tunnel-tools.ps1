<#
.SYNOPSIS
  Removes the now-unused cloudflared binary and logs left over from the old
  Cloudflare-quick-tunnel version of setup-ollama-bridge.ps1.

.DESCRIPTION
  setup-ollama-bridge.ps1 used to open an anonymous Cloudflare "quick tunnel"
  (*.trycloudflare.com) to reach this PC's Ollama bridge from the public
  internet. That tunnel type turned out to fail unpredictably (intermittent
  403s from Cloudflare's own edge, no fixed hostname, no uptime guarantee --
  see CHANGELOG.md for the full diagnosis) and has been replaced by Tailscale
  Funnel, which gives a real, stable hostname instead.

  After that switch, three things from the old setup are just dead weight:
    1. bin\cloudflared.exe inside the bridge's own working folder
       (%USERPROFILE%\TrameOllamaBridge\bin) -- a portable binary this
       repo's own script downloaded, never a system-wide install, so nothing
       else on the PC depends on it.
    2. Its log files (cloudflared.log, cloudflared.err.log) in the same
       working folder.
    3. A stale 'cloudflaredPid' entry in config.json, if present -- harmless
       (the new bridge script no longer reads that field at all), but
       cleared here too for a fully tidy config file.

  This does NOT touch Caddy, Ollama, the GPU watcher, AUTOMATIC1111, or
  Tailscale itself -- only the cloudflared-specific pieces above. If you
  never ran the old Cloudflare-based version of the bridge script, this will
  simply report that there is nothing to clean up.

  This script only REPORTS what it finds by default -- nothing is deleted
  unless you pass -Delete, and even then it asks for one final typed
  confirmation before removing anything.

.NOTES
  - Run from a normal PowerShell window: if execution policy blocks the
    script, run instead:
      powershell -ExecutionPolicy Bypass -File .\cleanup-unused-tunnel-tools.ps1
  - Safe to run at any time, including while the bridge is running: if a
    cloudflared.exe process happens to still be running (e.g. an old bridge
    session was never cleanly stopped), -Delete stops it first so the file
    isn't locked.
  - This script has not been run on a real Windows machine by the assistant
    that wrote it (no such access exists in that environment) -- it only
    reports by default, and even -Delete asks for a typed confirmation
    first, so a mistake here should be easy to back out of before anything
    is removed. Please report back anything that looks wrong.

.PARAMETER Delete
  After reporting what was found, ask for a typed confirmation and then
  actually remove it. Without this switch, the script only reports.
#>

[CmdletBinding()]
param(
  [switch]$Delete
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}
function Write-Ok($msg) {
  Write-Host "    OK: $msg" -ForegroundColor Green
}
function Write-Info($msg) {
  Write-Host "    $msg"
}

$WorkDir  = Join-Path $env:USERPROFILE "TrameOllamaBridge"
$BinDir   = Join-Path $WorkDir "bin"
$ConfigPath = Join-Path $WorkDir "config.json"

$foundItems = @()  # each: @{ Path = ...; Label = ... }

# ---------------------------------------------------------------------------
# 1. Stop any still-running cloudflared.exe process (so -Delete below can
#    actually remove the file, and so it stops holding a stale tunnel open).
# ---------------------------------------------------------------------------

Write-Step "Recherche d'un processus cloudflared.exe encore actif"

$cloudflaredExePath = Join-Path $BinDir "cloudflared.exe"
$runningProcesses = @()
try {
  $runningProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "cloudflared.exe" }
} catch {}

if ($runningProcesses.Count -gt 0) {
  foreach ($proc in $runningProcesses) {
    Write-Info "Trouve : processus cloudflared.exe actif (PID $($proc.ProcessId))."
  }
} else {
  Write-Ok "Aucun processus cloudflared.exe actif."
}

# ---------------------------------------------------------------------------
# 2. The binary + its log files.
# ---------------------------------------------------------------------------

Write-Step "Recherche des fichiers cloudflared laisses par l'ancienne version du pont"

$candidateFiles = @(
  @{ Path = $cloudflaredExePath; Label = "cloudflared.exe (binaire portable)" },
  @{ Path = (Join-Path $WorkDir "cloudflared.log"); Label = "cloudflared.log" },
  @{ Path = (Join-Path $WorkDir "cloudflared.err.log"); Label = "cloudflared.err.log" }
)

foreach ($candidate in $candidateFiles) {
  if (Test-Path $candidate.Path) {
    $sizeKB = [math]::Round((Get-Item $candidate.Path).Length / 1KB, 1)
    Write-Info "Trouve : $($candidate.Path) ($sizeKB Ko)"
    $foundItems += $candidate
  }
}

if ($foundItems.Count -eq 0 -and $runningProcesses.Count -eq 0) {
  Write-Ok "Aucun fichier cloudflared trouve."
}

# ---------------------------------------------------------------------------
# 3. Stale cloudflaredPid entry in config.json (informational -- the new
#    bridge script no longer reads or writes this field at all).
# ---------------------------------------------------------------------------

$hasStaleConfigField = $false
if (Test-Path $ConfigPath) {
  try {
    $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    if ($cfg.PSObject.Properties.Name -contains "cloudflaredPid") {
      $hasStaleConfigField = $true
      Write-Step "Champ obsolete dans config.json"
      Write-Info "config.json contient encore un champ 'cloudflaredPid' (valeur : $($cfg.cloudflaredPid)) -- inoffensif, le nouveau script ne le lit plus, mais peut etre nettoye."
    }
  } catch {}
}

# ---------------------------------------------------------------------------
# 4. Report, and delete only if -Delete was given and confirmed.
# ---------------------------------------------------------------------------

if ($foundItems.Count -eq 0 -and $runningProcesses.Count -eq 0 -and -not $hasStaleConfigField) {
  Write-Step "Rien a nettoyer"
  Write-Host "    Aucun element lie a l'ancien tunnel Cloudflare n'a ete trouve -- rien a faire."
  exit 0
}

Write-Step "Resume"
if ($runningProcesses.Count -gt 0) {
  Write-Host "    $($runningProcesses.Count) processus cloudflared.exe actif(s) a arreter."
}
if ($foundItems.Count -gt 0) {
  Write-Host "    $($foundItems.Count) fichier(s) a supprimer :"
  foreach ($item in $foundItems) {
    Write-Host "      - $($item.Path)"
  }
}
if ($hasStaleConfigField) {
  Write-Host "    1 champ obsolete a nettoyer dans config.json ('cloudflaredPid')."
}

if (-not $Delete) {
  Write-Host ""
  Write-Host "    Rien n'a ete supprime (mode rapport par defaut)." -ForegroundColor Yellow
  Write-Host "    Relancez avec -Delete pour proposer de les supprimer." -ForegroundColor Yellow
  exit 0
}

Write-Host ""
Write-Host "    Ceci va arreter le(s) processus cloudflared.exe actif(s) ci-dessus (s'il y en a) et" -ForegroundColor Yellow
Write-Host "    supprimer definitivement les $($foundItems.Count) fichier(s) et le champ obsolete listes ci-dessus." -ForegroundColor Yellow
$confirmation = Read-Host "    Tapez OUI (en majuscules) pour confirmer"

if ($confirmation -cne "OUI") {
  Write-Host "    Annule -- rien n'a ete supprime."
  exit 0
}

Write-Step "Nettoyage"

foreach ($proc in $runningProcesses) {
  try {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
    Write-Ok "Processus arrete (PID $($proc.ProcessId))."
  } catch {
    Write-Host "    ECHEC pour arreter le PID $($proc.ProcessId) -- $($_.Exception.Message)" -ForegroundColor Red
  }
}
if ($runningProcesses.Count -gt 0) {
  # Give the OS a moment to release the file handle before Remove-Item below.
  Start-Sleep -Seconds 1
}

foreach ($item in $foundItems) {
  try {
    Remove-Item -Path $item.Path -Force -ErrorAction Stop
    Write-Ok "Supprime : $($item.Path)"
  } catch {
    Write-Host "    ECHEC pour $($item.Path) -- $($_.Exception.Message)" -ForegroundColor Red
  }
}

if ($hasStaleConfigField) {
  try {
    $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    $cfg = $cfg | Select-Object * -ExcludeProperty cloudflaredPid
    $cfg | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8
    Write-Ok "Champ 'cloudflaredPid' retire de config.json."
  } catch {
    Write-Host "    ECHEC pour nettoyer config.json -- $($_.Exception.Message)" -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "    Nettoyage termine." -ForegroundColor Cyan
