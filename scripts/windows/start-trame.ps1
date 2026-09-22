<#
.SYNOPSIS
  One combined start/stop/verify script for Trame's whole local stack --
  stops anything already running, installs/verifies Ollama and BOTH Forge
  instances (main: NoobAI-XL/RealVisXL/Flux Safe/NSFW Flux; dedicated:
  Chroma) if needed, then starts the authenticated Tailscale Funnel bridge
  -- instead of juggling four scripts by hand in the right order every time.

.DESCRIPTION
  This script does NOT reimplement setup-forge.ps1, setup-forge-chroma.ps1
  or setup-ollama-bridge.ps1 -- it calls them, in order, as the three of
  them already existed and were already debugged against a real machine
  (or, for the two Forge scripts, built from the same real-machine lessons
  already learned via setup-automatic1111.ps1, which this supersedes now
  that Flux/Chroma are in the picture -- AUTOMATIC1111 has no Flux support
  at all). Every fix already made in any of them keeps applying here
  unchanged -- this script only adds the parts none of them own by itself:
  a clean stop-everything-first phase, running all three in the right
  order, and one place to look when something fails.

  What it does, in order:
    1. STOP -- looks for anything from a previous run still active (Caddy,
       the GPU watcher, either Forge instance, or another copy of one of
       these scripts left open in a different window) and stops it, or
       confirms nothing was running. Deliberately does NOT touch Ollama's
       own server or Tailscale -- those are shared background services this
       script uses, not things it owns the lifecycle of.
    2. MAIN FORGE (optional, never blocks the rest) -- runs setup-forge.ps1:
       installs Python/Git if missing, finds or clones Forge, finds or
       downloads NoobAI-XL/RealVisXL/Flux Safe (and your NSFW Flux fine-tune
       if -FluxedUpUrl is given), applies the Blackwell-CUDA/CLIP-setuptools
       fixes, enables --api, and launches it.
    3. CHROMA FORGE (optional, never blocks the rest) -- runs
       setup-forge-chroma.ps1 on its own separate port: same defensive
       fixes, downloads the three Chroma-specific files, enables --api,
       launches it, and actually tests generation since this fork's API
       isn't documented (see that script's own .NOTES for the one honest
       unknown in this whole project).
    4. OLLAMA BRIDGE (final step -- this is what keeps the window open) --
       runs setup-ollama-bridge.ps1: installs/starts Ollama, pulls the
       requested model, starts Caddy (authenticated proxy, now with FOUR
       routes: Ollama, GPU status, main Forge, Chroma) and the GPU watcher,
       verifies/starts the Tailscale Funnel tunnel, validates the whole
       chain end to end, and pushes the result to Trame's Settings.

  Ctrl+C in this window stops the whole stack cleanly: the bridge script's
  own cleanup stops Caddy and the watcher, and this script's own cleanup
  (in a finally block) then also stops both Forge instances it started --
  one script, one window, one Ctrl+C for everything.

.NOTES
  - Run from a normal PowerShell window: if execution policy blocks the
    script, run instead:
      powershell -ExecutionPolicy Bypass -File .\start-trame.ps1
  - First run can take well over an hour: Flux Safe alone is a ~17 Go
    download, Chroma's three files add up to a similar amount, plus
    dependency installs for two separate Python venvs. Later runs are much
    faster since everything is already installed and only gets verified.
  - See GUIDE-TAILSCALE.md (next to this script) for the one-time Tailscale
    account setup this all depends on, and -Diagnose (or
    setup-ollama-bridge.ps1 -Diagnose) if something looks wrong with the
    tunnel specifically.
  - This script has not been run on a real Windows machine by the assistant
    that wrote it -- it only orchestrates the three already-built scripts
    and adds its own stop/diagnose logic. Please report back anything that
    errors.

.PARAMETER TrameUrl
  Base URL of your Trame deployment. Forwarded to setup-ollama-bridge.ps1.

.PARAMETER Model
  Ollama model to ensure is pulled and used. Forwarded to
  setup-ollama-bridge.ps1. Defaults to qwen3:14b.

.PARAMETER SdPort
  Local port the main Forge instance's API listens on. Forwarded to both
  setup-forge.ps1 and setup-ollama-bridge.ps1 (keep this the only place you
  change it). Defaults to 7860.

.PARAMETER ChromaPort
  Local port the dedicated Chroma instance's API listens on. Forwarded to
  both setup-forge-chroma.ps1 and setup-ollama-bridge.ps1. Defaults to 7862.

.PARAMETER WebUiDir
  Skip main Forge auto-detection and use this exact folder. Forwarded to
  setup-forge.ps1.

.PARAMETER ChromaWebUiDir
  Skip Chroma instance auto-detection and use this exact folder. Forwarded
  to setup-forge-chroma.ps1.

.PARAMETER CopyModelsFrom
  Optional path to copy NoobAI-XL/RealVisXL/etc. from instead of
  re-downloading (e.g. an existing AUTOMATIC1111 install's models folder).
  Forwarded to setup-forge.ps1.

.PARAMETER FluxedUpUrl
  Direct download URL for your chosen NSFW Flux fine-tune. Forwarded to
  setup-forge.ps1 -- see that script's .NOTES for how to get one (Civitai
  login/API-token gated, cannot be auto-discovered).

.PARAMETER ModelUrl
  Optional extra Stable Diffusion checkpoint URL. Forwarded to
  setup-forge.ps1.

.PARAMETER NoAutoModel
  Skip Forge's default-checkpoint downloads. Forwarded to setup-forge.ps1.

.PARAMETER SkipForge
  Skip the main Forge instance entirely (no install/verify/launch/stop) --
  use this if you only want local text generation (Ollama), not local images.

.PARAMETER SkipChroma
  Skip the dedicated Chroma instance entirely. Use this if you only want
  the four main-instance models, or while troubleshooting Chroma
  separately from everything else.

.PARAMETER SkipTrameUpdate
  Don't push settings to Trame automatically. Forwarded to
  setup-ollama-bridge.ps1.

.PARAMETER NoWatcher
  Skip the GPU watcher tray icon / /bridge/status route. Forwarded to
  setup-ollama-bridge.ps1.

.PARAMETER Diagnose
  Report-only mode: checks Ollama, both Forge instances and the Tailscale
  Funnel bridge (via setup-ollama-bridge.ps1 -Diagnose) without stopping,
  installing or launching anything.
#>

[CmdletBinding()]
param(
  [string]$TrameUrl = "https://trame-production.up.railway.app",
  [string]$Model = "qwen3:14b",
  [int]$SdPort = 7860,
  [int]$ChromaPort = 7862,
  [string]$WebUiDir = "",
  [string]$ChromaWebUiDir = "",
  [string]$CopyModelsFrom = "",
  [string]$FluxedUpUrl = "",
  [string]$ModelUrl = "",
  [switch]$NoAutoModel,
  [switch]$SkipForge,
  [switch]$SkipChroma,
  [switch]$SkipTrameUpdate,
  [switch]$NoWatcher,
  [switch]$Diagnose
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}
function Write-Ok($msg) {
  Write-Host "    OK: $msg" -ForegroundColor Green
}
function Write-Fail($msg) {
  Write-Host "    ECHEC: $msg" -ForegroundColor Red
}
function Write-Info($msg) {
  Write-Host "    $msg"
}

$ForgeScript = Join-Path $PSScriptRoot "setup-forge.ps1"
$ForgeChromaScript = Join-Path $PSScriptRoot "setup-forge-chroma.ps1"
$BridgeScript = Join-Path $PSScriptRoot "setup-ollama-bridge.ps1"
$WorkDir = Join-Path $env:USERPROFILE "TrameOllamaBridge"
$BridgeConfigPath = Join-Path $WorkDir "config.json"
$ForgeConfigPath = Join-Path $WorkDir "forge-config.json"
$ForgeChromaConfigPath = Join-Path $WorkDir "forge-chroma-config.json"

if (-not $SkipForge -and -not (Test-Path $ForgeScript)) {
  Write-Fail "setup-forge.ps1 introuvable a cote de ce script ($PSScriptRoot) -- utilisez -SkipForge si c'est voulu, sinon replacez ce script a cote des autres."
  exit 1
}
if (-not $SkipChroma -and -not (Test-Path $ForgeChromaScript)) {
  Write-Fail "setup-forge-chroma.ps1 introuvable a cote de ce script ($PSScriptRoot) -- utilisez -SkipChroma si c'est voulu, sinon replacez ce script a cote des autres."
  exit 1
}
if (-not (Test-Path $BridgeScript)) {
  Write-Fail "setup-ollama-bridge.ps1 introuvable a cote de ce script ($PSScriptRoot) -- impossible de continuer."
  exit 1
}

# ---------------------------------------------------------------------------
# Resolves an installed WebUI's directory the same way its own setup script
# does (explicit -WebUiDir, else that script's own cached config), so the
# stop-phase and the post-launch cleanup can find its process by command
# line without needing that script to expose a PID. One shared helper for
# both instances (main Forge and Chroma), parameterized by which config
# file and which explicit override to consult.
# ---------------------------------------------------------------------------
function Get-KnownWebUiDir($configPath, $explicitDir) {
  if ($explicitDir -and (Test-Path (Join-Path $explicitDir "webui-user.bat"))) { return $explicitDir }
  if (Test-Path $configPath) {
    try {
      $savedCfg = Get-Content $configPath -Raw | ConvertFrom-Json
      if ($savedCfg.webuiDir -and (Test-Path (Join-Path $savedCfg.webuiDir "webui-user.bat"))) {
        return $savedCfg.webuiDir
      }
    } catch {}
  }
  return $null
}

# Confirmed for real on a live machine (see CHANGELOG.md): Get-CimInstance's
# CommandLine can come back EMPTY for a perfectly real, running process --
# Windows/WMI can silently withhold it when this script's own process
# doesn't have enough privilege relative to the target. Port-based lookup
# (Get-NetTCPConnection) is the fix: it finds whatever process is actually
# LISTENING on the given port via the network stack, not WMI's process
# table. Both signals are combined -- CommandLine still catches a process
# before it's even bound to its port yet. One shared helper for both
# instances, parameterized by directory and port so it works for either.
function Stop-WebUiProcesses($dir, $port) {
  $pidsToStop = New-Object System.Collections.Generic.HashSet[int]

  if ($dir) {
    # BUG FOUND ON A REAL RUN: without excluding $PID, this can match the
    # CURRENT process's own command line when -WebUiDir/-ChromaWebUiDir is
    # passed explicitly (its literal text is part of this very process's
    # CommandLine as seen by WMI) -- this would then kill the script
    # running RIGHT NOW, silently, well before it reaches Phase 2/3. See
    # CHANGELOG.md.
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine -like "*$dir*") } |
      ForEach-Object { [void]$pidsToStop.Add($_.ProcessId) }
  }
  try {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { [void]$pidsToStop.Add([int]$_.OwningProcess) }
  } catch {}

  if ($pidsToStop.Count -eq 0) { return $false }

  foreach ($procId in $pidsToStop) {
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
      Write-Info "Arret d'un processus Forge (PID $procId, port $port)..."
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  $waited = 0
  while ($waited -lt 10) {
    $stillRunning = $pidsToStop | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
    if (-not $stillRunning) { break }
    Start-Sleep -Milliseconds 500
    $waited += 0.5
  }
  return $true
}

# ---------------------------------------------------------------------------
# -Diagnose: report-only, no stop/install/launch of anything.
# ---------------------------------------------------------------------------

if ($Diagnose) {
  Write-Step "Diagnostic rapide (aucun arret, aucune installation, aucun lancement)"

  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:11434" -TimeoutSec 3 | Out-Null
    Write-Ok "Ollama repond sur le port 11434."
  } catch {
    Write-Fail "Ollama ne repond pas sur le port 11434."
  }

  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$SdPort/sdapi/v1/sd-models" -TimeoutSec 3 | Out-Null
    Write-Ok "Forge (principal) repond sur le port $SdPort."
  } catch {
    Write-Fail "Forge (principal) ne repond pas sur le port $SdPort (normal si -SkipForge a ete utilise)."
  }

  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$ChromaPort/sdapi/v1/sd-models" -TimeoutSec 3 | Out-Null
    Write-Ok "Forge-Chroma repond sur le port $ChromaPort."
  } catch {
    Write-Fail "Forge-Chroma ne repond pas sur le port $ChromaPort (normal si -SkipChroma a ete utilise)."
  }

  Write-Step "Diagnostic Tailscale / pont (delegue a setup-ollama-bridge.ps1 -Diagnose)"
  & $BridgeScript -Diagnose
  exit $LASTEXITCODE
}

# ---------------------------------------------------------------------------
# Phase 1/4 -- Stop anything already running, or confirm a clean start.
# ---------------------------------------------------------------------------

Write-Step "PHASE 1/4 -- Arret propre de tout ce qui tourne deja"

$stoppedAnything = $false

try {
  if (Test-Path $BridgeConfigPath) {
    $bridgeCfg = Get-Content $BridgeConfigPath -Raw | ConvertFrom-Json
    foreach ($pidField in @('caddyPid', 'watcherPid')) {
      $procId = $bridgeCfg.$pidField
      if ($procId -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
        Write-Info "Arret du processus $pidField (PID $procId)..."
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        $stoppedAnything = $true
      }
    }
  }
} catch {
  Write-Info "Impossible de lire $BridgeConfigPath ($($_.Exception.Message)) -- ignore, poursuite normale."
}

try {
  $preExistingForgeDir = Get-KnownWebUiDir $ForgeConfigPath $WebUiDir
  if (Stop-WebUiProcesses $preExistingForgeDir $SdPort) { $stoppedAnything = $true }
} catch {
  Write-Info "Verification des processus Forge (principal) impossible ($($_.Exception.Message)) -- ignore, poursuite normale."
}

try {
  $preExistingChromaDir = Get-KnownWebUiDir $ForgeChromaConfigPath $ChromaWebUiDir
  if (Stop-WebUiProcesses $preExistingChromaDir $ChromaPort) { $stoppedAnything = $true }
} catch {
  Write-Info "Verification des processus Forge-Chroma impossible ($($_.Exception.Message)) -- ignore, poursuite normale."
}

# Another window still running one of these scripts directly (not just
# leftover child processes) -- e.g. one launched by hand earlier and left
# open. Its own Caddy/watcher/Forge processes were likely just stopped
# above (same tracked PIDs/ports); this also closes that now-idle window.
try {
  $lingeringScripts = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and $_.CommandLine -and
      ($_.CommandLine -like "*setup-ollama-bridge.ps1*" -or $_.CommandLine -like "*setup-forge.ps1*" -or $_.CommandLine -like "*setup-forge-chroma.ps1*")
    }
  foreach ($p in $lingeringScripts) {
    Write-Info "Fermeture d'une fenetre de script Trame restee ouverte (PID $($p.ProcessId))..."
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    $stoppedAnything = $true
  }
} catch {
  Write-Info "Verification des fenetres de script restees ouvertes impossible ($($_.Exception.Message)) -- ignore."
}

if ($stoppedAnything) {
  Write-Ok "Anciens processus arretes."
  Start-Sleep -Seconds 1
} else {
  Write-Ok "Rien n'etait actif -- depart propre."
}

Write-Info "Ollama et Tailscale ne sont pas coupes ici : ce sont des services d'arriere-plan"
Write-Info "partages, pas quelque chose que ce script demarre/possede -- ils sont juste"
Write-Info "verifies (et demarres si besoin) dans les etapes suivantes."

# ---------------------------------------------------------------------------
# Phase 2/4 -- Main Forge instance (optional, never fatal to the rest).
# ---------------------------------------------------------------------------

$ForgeOk = $false
$ResolvedForgeDirAfterSetup = $null

if ($SkipForge) {
  Write-Step "PHASE 2/4 -- Forge (principal) ignore (-SkipForge)"
} else {
  Write-Step "PHASE 2/4 -- Installation/verification/lancement de Forge (principal)"
  $forgeParams = @{ SdPort = $SdPort }
  if ($WebUiDir) { $forgeParams.WebUiDir = $WebUiDir }
  if ($CopyModelsFrom) { $forgeParams.CopyModelsFrom = $CopyModelsFrom }
  if ($FluxedUpUrl) { $forgeParams.FluxedUpUrl = $FluxedUpUrl }
  if ($ModelUrl) { $forgeParams.ModelUrl = $ModelUrl }
  if ($NoAutoModel) { $forgeParams.NoAutoModel = $true }
  try {
    & $ForgeScript @forgeParams
    if ($LASTEXITCODE -eq 0) {
      $ForgeOk = $true
      $ResolvedForgeDirAfterSetup = Get-KnownWebUiDir $ForgeConfigPath $WebUiDir
      Write-Ok "Forge (principal) pret."
    } else {
      Write-Fail "setup-forge.ps1 a echoue (code $LASTEXITCODE) -- ces modeles ne seront pas disponibles cette fois. Le texte (Ollama) et Chroma continuent normalement ci-dessous."
    }
  } catch {
    Write-Fail "setup-forge.ps1 a leve une erreur inattendue -- $($_.Exception.Message). Ces modeles ne seront pas disponibles cette fois."
  }
}

# ---------------------------------------------------------------------------
# Phase 3/4 -- Dedicated Chroma instance (optional, never fatal to the rest).
# ---------------------------------------------------------------------------

$ChromaOk = $false
$ResolvedChromaDirAfterSetup = $null

if ($SkipChroma) {
  Write-Step "PHASE 3/4 -- Forge-Chroma ignore (-SkipChroma)"
} else {
  Write-Step "PHASE 3/4 -- Installation/verification/lancement de Forge-Chroma"
  $chromaParams = @{ ChromaPort = $ChromaPort }
  if ($ChromaWebUiDir) { $chromaParams.WebUiDir = $ChromaWebUiDir }
  try {
    & $ForgeChromaScript @chromaParams
    if ($LASTEXITCODE -eq 0) {
      $ChromaOk = $true
      $ResolvedChromaDirAfterSetup = Get-KnownWebUiDir $ForgeChromaConfigPath $ChromaWebUiDir
      Write-Ok "Forge-Chroma pret."
    } else {
      Write-Fail "setup-forge-chroma.ps1 a echoue (code $LASTEXITCODE) -- Chroma ne sera pas disponible cette fois. Le reste continue normalement ci-dessous."
    }
  } catch {
    Write-Fail "setup-forge-chroma.ps1 a leve une erreur inattendue -- $($_.Exception.Message). Chroma ne sera pas disponible cette fois."
  }
}

# ---------------------------------------------------------------------------
# Phase 4/4 -- Ollama bridge. Final step: this is what keeps the window
# open (Ctrl+C to stop everything) -- see setup-ollama-bridge.ps1 itself.
# ---------------------------------------------------------------------------

Write-Step "PHASE 4/4 -- Pont Ollama <-> Trame (Tailscale, Caddy, surveillant GPU)"
if (-not $ForgeOk) {
  Write-Info "Forge (principal) non disponible -- le pont continue quand meme."
}
if (-not $ChromaOk) {
  Write-Info "Forge-Chroma non disponible -- le pont continue quand meme."
}

$bridgeParams = @{ TrameUrl = $TrameUrl; Model = $Model; SdPort = $SdPort; ChromaPort = $ChromaPort }
if ($SkipTrameUpdate) { $bridgeParams.SkipTrameUpdate = $true }
if ($NoWatcher) { $bridgeParams.NoWatcher = $true }

$bridgeExitCode = 0
try {
  & $BridgeScript @bridgeParams
  $bridgeExitCode = $LASTEXITCODE
} finally {
  if ($ForgeOk) {
    Write-Step "Arret de Forge (principal) (fin du pont)"
    if (Stop-WebUiProcesses $ResolvedForgeDirAfterSetup $SdPort) {
      Write-Ok "Forge (principal) arrete."
    } else {
      Write-Info "Forge (principal) n'etait deja plus actif."
    }
  }
  if ($ChromaOk) {
    Write-Step "Arret de Forge-Chroma (fin du pont)"
    if (Stop-WebUiProcesses $ResolvedChromaDirAfterSetup $ChromaPort) {
      Write-Ok "Forge-Chroma arrete."
    } else {
      Write-Info "Forge-Chroma n'etait deja plus actif."
    }
  }
}

exit $bridgeExitCode
