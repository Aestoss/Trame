<#
.SYNOPSIS
  Sets up a secured bridge between a local Ollama install (on this PC) and the
  Trame app hosted on Railway, then validates the whole chain end to end.

.DESCRIPTION
  Trame stays hosted on Railway (single save/database source of truth --
  running it locally too would fork your saves into a second, unsynced
  database). Only the text-generation call needs to reach this PC's GPU.

  Ollama itself has NO built-in authentication -- exposing its port directly
  to the internet lets anyone who finds the URL use your GPU for free. So
  this script puts a small authenticated reverse proxy (Caddy) in front of
  it, and a Tailscale Funnel (a stable https://<machine>.<tailnet>.ts.net
  hostname, free on Tailscale's Personal plan) in front of that, instead of
  exposing port 11434 directly:

      Phone -> Trame (Railway) -> Tailscale Funnel -> Caddy (checks a
      secret token) -> Ollama (127.0.0.1:11434)

  This replaces an earlier version of this script that used an anonymous
  Cloudflare "quick tunnel" (*.trycloudflare.com). That tunnel type has no
  uptime guarantee and no fixed hostname by design -- it turned out to fail
  unpredictably (intermittent 403s from Cloudflare's own edge, unrelated to
  anything in this script) with no reliable fix available on our side. See
  CHANGELOG.md for the full diagnosis. Tailscale Funnel gives a real,
  stable hostname instead, at the cost of a one-time interactive login (see
  GUIDE-TAILSCALE.md next to this script) -- there is no way to script that
  login step itself, Tailscale requires it to happen in a real browser.

  What it does, in order:
    1. Installs Ollama via winget if missing, makes sure its server is
       actually running, and pulls a default model if you don't have one yet.
    2. Downloads a portable Caddy binary into a local bin/ folder (no winget
       PATH guesswork -- see notes below), and checks that Tailscale itself
       is installed and logged in (see .NOTES -- unlike Caddy, Tailscale
       cannot be silently auto-installed/auto-logged-in by this script).
    3. Generates (once) or reuses a secret bearer token, writes a Caddyfile
       that only forwards requests carrying that token, and starts Caddy.
       Four routes share the one token: Ollama itself, the GPU watcher's
       /bridge/status, /sdapi/* for the main local Forge instance (NoobAI-XL,
       RealVisXL, Flux Safe, NSFW Flux -- run separately, see setup-forge.ps1),
       and /sdapi-chroma/* for a second, dedicated Forge-fork instance
       running Chroma (see setup-forge-chroma.ps1) -- neither is installed by
       this script, see .NOTES.
    4. Starts ollama-watcher.ps1 (a separate script next to this one), which
       polls nvidia-smi and shows a tray icon (green/orange) so you can see
       locally when the GPU is busy enough that a game might stutter.
    5. Points Tailscale Funnel at Caddy (a single 'tailscale funnel' call)
       and reads back the resulting stable public hostname via
       'tailscale funnel status --json' (no log-scraping involved -- unlike
       the old cloudflared approach, this is a structured, documented API).
    6. Validates the FULL path from the public internet: confirms a request
       without the token is rejected (401) and a request with it reaches
       Ollama and gets a real completion back.
    7. Pushes the new tunnel URL + secret to Trame's own Settings via its
       API (POST /api/settings) for BOTH Ollama and local image generation
       (same URL, same token -- Caddy tells the two apart by path), then
       reads them back to confirm. Trame polls /bridge/status through the
       same tunnel to show its own hors ligne/indisponible/disponible
       indicator and to decide, instantly and without any extra round trip,
       whether to offer your configured fallback provider for a given turn.
    8. Keeps running in the foreground (Caddy + Tailscale must stay alive for
       this to keep working) until you press Ctrl+C, then cleans up (Caddy
       and the watcher are stopped; the Funnel/serve config and Tailscale
       itself are deliberately left running -- see .NOTES).

  See install-startup-task.ps1 to have this run automatically at logon
  instead of by hand every time, with Windows itself restarting it if it
  ever crashes while the PC stays on.

  Run it again any time you want to start a session -- unlike the old
  cloudflared quick tunnel, the Tailscale hostname does NOT change between
  runs, so Trame's settings only need to be re-pushed if the secret token
  itself ever changes (it doesn't, once generated). The secret token is
  generated once and reused across runs, saved in config.json next to this
  script, so you never have to retype it in Trame's Settings after the
  first successful run.

.NOTES
  - Run from a normal PowerShell window: if execution policy blocks the
    script, run instead:
      powershell -ExecutionPolicy Bypass -File .\setup-ollama-bridge.ps1
  - If the Ollama install step fails, re-run this script from an
    Administrator PowerShell window and try again.
  - Tailscale is NOT installed automatically by this script, unlike Ollama
    and Caddy -- installing it silently is possible, but the mandatory
    interactive browser login ('tailscale up') is not scriptable at all (by
    Tailscale's own design, as an anti-phishing measure), so a fully silent
    install would just fail one step later anyway with a less clear error.
    See GUIDE-TAILSCALE.md next to this script for the one-time setup (a
    few minutes): install, log in, enable HTTPS certificates, confirm the
    Funnel permission. This script detects and clearly reports exactly
    which of those steps is missing if one is (see the diagnostics below).
  - This script never runs 'tailscale up' or 'tailscale down' -- it only
    ever runs 'tailscale serve' / 'tailscale funnel' (routing config) and
    reads status. It does not touch your Tailscale login state, and Ctrl+C
    does not log you out or disable Funnel -- only Caddy and the watcher are
    stopped on exit, so Trame keeps reaching the (now Ollama-less) proxy
    port with a connection-refused instead of a stale/misleading answer.
  - Local image generation (Forge / Stable Diffusion WebUI) is NOT installed
    by this script -- unlike Ollama, it's a much heavier, less standardized
    install (Python environment, multi-GB model checkpoints to download
    yourself). See setup-forge.ps1 (main instance: NoobAI-XL, RealVisXL,
    Flux Safe, NSFW Flux) and setup-forge-chroma.ps1 (separate, dedicated
    Chroma instance) next to this script for automated installs -- or
    install either by hand and start it with the --api flag (off by
    default), e.g.: webui-user.bat --api
    This script only adds the authenticated proxy routes for them -- if one
    isn't running, its route just fails until you start it; everything else
    (Ollama, text generation, the other image instance) works regardless.
  - If you used the old Cloudflare-based version of this script before, run
    cleanup-unused-tunnel-tools.ps1 next to this one to remove the
    now-unused cloudflared binary and its log files.
  - This script has not been run on a real Windows machine by the assistant
    that wrote it (no such access exists in that environment) -- it was
    built from verified package IDs and documented behavior, but please
    report back anything that errors so it can be fixed.

.PARAMETER TrameUrl
  Base URL of your Trame deployment. Defaults to the Railway production URL.

.PARAMETER Model
  Ollama model to ensure is pulled and to use for the validation test.
  Defaults to qwen3:14b (the recommended sweet-spot model for a 16GB-VRAM
  card like the RTX 5080 -- see TODO.md/CHANGELOG.md for the reasoning).

.PARAMETER SdPort
  Local port your main Forge instance's API listens on (NoobAI-XL,
  RealVisXL, Flux Safe, and your NSFW Flux fine-tune -- see setup-forge.ps1).
  Defaults to 7860. The proxy route is added either way; harmless and
  unused if you don't run one.

.PARAMETER ChromaPort
  Local port the dedicated Chroma instance's API listens on (see
  setup-forge-chroma.ps1). Defaults to 7862. Same as -SdPort: the proxy
  route is added either way, harmless and unused if you don't run one.

.PARAMETER SkipTrameUpdate
  If set, does everything except push settings to Trame automatically --
  use this if you'd rather copy the URL into Settings by hand.

.PARAMETER NoWatcher
  If set, skips starting the GPU watcher / tray icon entirely. Ollama and
  the tunnel still work without it -- you just lose the local busy/idle
  indicator and Trame's status indicator will show "offline" for the
  /bridge/status route specifically (Ollama generation itself is unaffected).

.PARAMETER Diagnose
  Runs only the Tailscale/Funnel prerequisite checks (installed, logged in,
  HTTPS certs, Funnel permission, existing serve/funnel config) and prints
  a clear report, then exits -- no Ollama/Caddy/tunnel setup is attempted.
  Use this first if a previous run failed on the Tailscale step, or any
  time you want to sanity-check the account setup from GUIDE-TAILSCALE.md
  without going through the whole bridge startup.
#>

[CmdletBinding()]
param(
  [string]$TrameUrl = "https://trame-production.up.railway.app",
  [string]$Model = "qwen3:14b",
  [int]$SdPort = 7860,
  [int]$ChromaPort = 7862,
  [switch]$SkipTrameUpdate,
  [switch]$NoWatcher,
  [switch]$Diagnose
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Setup / paths
# ---------------------------------------------------------------------------

$WorkDir      = Join-Path $env:USERPROFILE "TrameOllamaBridge"
$BinDir       = Join-Path $WorkDir "bin"
$CaddyExe     = Join-Path $BinDir "caddy.exe"
$ConfigPath   = Join-Path $WorkDir "config.json"
$CaddyfilePath = Join-Path $WorkDir "Caddyfile"
$TranscriptPath = Join-Path $WorkDir "bridge.log"
$WatcherScriptPath = Join-Path $PSScriptRoot "ollama-watcher.ps1"
$ProxyPort    = 8787
$OllamaPort   = 11434
$WatcherPort  = 8788
# Tailscale Funnel only accepts these three public-facing ports -- not a
# script limitation, a hard constraint of the Funnel feature itself.
$FunnelPort   = 443

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir  | Out-Null

# Mirrors everything below into a log file too, so a run launched hidden by
# the Windows Scheduled Task (see install-startup-task.ps1) leaves something
# inspectable -- Write-Host alone would otherwise vanish with no console
# attached. Doesn't suppress the normal console output when run by hand.
if (-not $Diagnose) {
  try { Start-Transcript -Path $TranscriptPath -Append | Out-Null } catch {}
}

$script:ChildProcesses = @()

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

# Guards native calls against two distinct real PowerShell traps that have
# nothing to do with the command actually failing:
#   1. Windows PowerShell 5.1 wraps ANY captured stderr (2>&1, 2>$null) into
#      a terminating ErrorRecord under $ErrorActionPreference = "Stop",
#      even for harmless stderr chatter a tool writes on a successful run.
#   2. PowerShell 7.3+'s $PSNativeCommandUseErrorActionPreference (on by
#      default) promotes ANY non-zero native exit code to a terminating
#      error regardless of stderr -- a problem here because several
#      Tailscale subcommands (e.g. checking Funnel status before Funnel is
#      configured yet) legitimately exit non-zero as their normal "not set
#      up yet" signal, which this script needs to detect and report nicely,
#      not have it explode into an unhandled exception.
function Invoke-NativeQuiet {
  param([Parameter(Mandatory)][scriptblock]$ScriptBlock)
  $prevErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $ScriptBlock } finally { $ErrorActionPreference = $prevErrorActionPreference }
}

function Stop-Bridge {
  foreach ($p in $script:ChildProcesses) {
    try {
      if ($p -and -not $p.HasExited) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
}

# Make sure a previous, uncleanly-stopped run doesn't leave stale processes
# holding the ports this run needs. Tailscale itself isn't tracked here --
# it runs as a persistent background service, not a process this script
# starts/owns, so it's never killed by this function.
function Stop-StaleBridge {
  if (Test-Path $ConfigPath) {
    try {
      $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
      foreach ($pidField in @('caddyPid', 'watcherPid')) {
        $procId = $cfg.$pidField
        if ($procId) {
          $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
          if ($proc) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
        }
      }
    } catch {}
  }
}

function Get-BridgeConfig {
  if (Test-Path $ConfigPath) {
    return Get-Content $ConfigPath -Raw | ConvertFrom-Json
  }
  return [pscustomobject]@{ secret = $null; caddyPid = $null; watcherPid = $null }
}

function Save-BridgeConfig($cfg) {
  $cfg | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8
}

# ---------------------------------------------------------------------------
# Tailscale: install/login/permission checks + Funnel control
#
# Each of these is a genuinely distinct, independently-reachable failure
# state a first-time (or re-)setup can land in -- not installed at all,
# installed but never logged in, logged in but on the wrong/no tailnet,
# logged in but missing the two admin-console toggles (HTTPS certs, Funnel
# permission). Reporting the actual state instead of a generic "Tailscale
# error" is the whole point of -Diagnose.
# ---------------------------------------------------------------------------

function Get-TailscaleExe {
  $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  # winget's default install location isn't always on PATH within the same
  # session it was installed in -- checked as a fallback before giving up.
  $fallback = "$env:ProgramFiles\Tailscale\tailscale.exe"
  if (Test-Path $fallback) { return $fallback }
  return $null
}

function Get-TailscaleStatusJson($tsExe) {
  try {
    $raw = Invoke-NativeQuiet { & $tsExe status --json 2>$null }
    if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
    return $raw | ConvertFrom-Json
  } catch { return $null }
}

# Returns one of: NotInstalled / NotRunning / NeedsLogin / LoggedIn
function Test-TailscaleState {
  param([string]$TsExe)
  if (-not $TsExe) { return "NotInstalled" }
  $status = Get-TailscaleStatusJson $TsExe
  if (-not $status) { return "NotRunning" }
  # BackendState is Tailscale's own documented state field: "NeedsLogin",
  # "NeedsMachineAuth", "Stopped", "Starting", "Running".
  if ($status.BackendState -eq "Running") { return "LoggedIn" }
  if ($status.BackendState -eq "NeedsLogin") { return "NeedsLogin" }
  return "NeedsLogin"
}

# Checks the two admin-console-side prerequisites (HTTPS certs, Funnel node
# attribute) by reading this node's own capability list from
# 'tailscale status --json', the same signal Tailscale's own CLI checks
# internally via ipn.NodeCanFunnel (node.HasCap("https") and
# node.HasCap("funnel")) -- verified directly against the tailscale/tailscale
# source, since 'tailscale funnel status --json' alone (an earlier version
# of this check) only reports the current serve config, not whether this
# node is actually allowed to use Funnel at all -- it can look empty/fine
# even when neither prerequisite is met yet.
# Returns $null if everything looks fine, or a human-readable explanation.
function Test-FunnelPrerequisites {
  param([string]$TsExe)
  $status = Get-TailscaleStatusJson $TsExe
  if (-not $status -or -not $status.Self) {
    return "Impossible de lire les capacites de cette machine (tailscale status --json a echoue)."
  }
  $capNames = New-Object System.Collections.Generic.HashSet[string]
  if ($status.Self.CapMap) {
    foreach ($name in $status.Self.CapMap.PSObject.Properties.Name) { [void]$capNames.Add($name) }
  }
  if ($status.Self.Capabilities) {
    foreach ($name in $status.Self.Capabilities) { [void]$capNames.Add($name) }
  }
  if (-not $capNames.Contains("https")) {
    return "Les certificats HTTPS ne sont pas actives pour votre tailnet (voir GUIDE-TAILSCALE.md, etape 'Activer HTTPS Certificates')."
  }
  if (-not $capNames.Contains("funnel")) {
    return "Ce compte n'a pas la permission Funnel activee dans la politique ACL du tailnet (voir GUIDE-TAILSCALE.md, etape 'Autoriser Funnel')."
  }
  return $null
}

if ($Diagnose) {
  Write-Step "Diagnostic Tailscale"

  $tsExe = Get-TailscaleExe
  if (-not $tsExe) {
    Write-Fail "Tailscale n'est pas installe (commande 'tailscale' introuvable, ni dans $env:ProgramFiles\Tailscale)."
    Write-Info "Suivez GUIDE-TAILSCALE.md, etape 1 (installation), puis relancez -Diagnose."
    exit 1
  }
  Write-Ok "Tailscale installe ($tsExe)."

  $state = Test-TailscaleState -TsExe $tsExe
  switch ($state) {
    "NotRunning" {
      Write-Fail "Le service Tailscale ne repond pas. Redemarrez le service 'Tailscale' (services.msc) ou reinstallez, puis relancez -Diagnose."
      exit 1
    }
    "NeedsLogin" {
      Write-Fail "Tailscale est installe mais vous n'etes pas connecte."
      Write-Info "Lancez : `"$tsExe`" up -- une page de connexion s'ouvre dans votre navigateur (voir GUIDE-TAILSCALE.md, etape 2)."
      exit 1
    }
    "LoggedIn" {
      Write-Ok "Connecte a un tailnet."
    }
  }

  $status = Get-TailscaleStatusJson $tsExe
  if ($status -and $status.Self -and $status.Self.DNSName) {
    $machineHost = $status.Self.DNSName.TrimEnd('.')
    Write-Ok "Nom de machine sur le tailnet : $machineHost"
  } else {
    Write-Fail "Connecte, mais impossible de lire le nom de machine (MagicDNS) -- verifiez GUIDE-TAILSCALE.md, etape 'Verifier MagicDNS'."
  }

  $funnelIssue = Test-FunnelPrerequisites -TsExe $tsExe
  if ($funnelIssue) {
    Write-Fail $funnelIssue
    exit 1
  }
  Write-Ok "Prerequis Funnel (HTTPS + permission) : OK."

  $existingFunnel = Invoke-NativeQuiet { & $tsExe funnel status --json 2>$null }
  Write-Info "Etat actuel de 'tailscale funnel status --json' :"
  Write-Host "    $existingFunnel"

  Write-Step "Diagnostic termine"
  Write-Info "Si tout est OK ci-dessus, relancez ce script sans -Diagnose pour demarrer le pont."
  exit 0
}

Write-Step "Verification de Tailscale (tunnel public stable)"

$TsExe = Get-TailscaleExe
if (-not $TsExe) {
  Write-Fail "Tailscale n'est pas installe."
  Write-Info "Ce script ne l'installe pas automatiquement : la connexion (etape suivante) demande obligatoirement"
  Write-Info "un navigateur, donc une installation silencieuse echouerait de toute facon a l'etape d'apres."
  Write-Info "Suivez GUIDE-TAILSCALE.md (a cote de ce script), puis relancez ce script."
  Write-Info "Vous pouvez verifier votre progression a tout moment avec : .\setup-ollama-bridge.ps1 -Diagnose"
  exit 1
}
Write-Ok "Tailscale installe ($TsExe)."

$TsState = Test-TailscaleState -TsExe $TsExe
if ($TsState -ne "LoggedIn") {
  Write-Fail "Tailscale est installe mais pas connecte a un compte."
  Write-Info "Lancez : `"$TsExe`" up  (une page de connexion s'ouvre dans votre navigateur)."
  Write-Info "Puis relancez ce script. Detail : GUIDE-TAILSCALE.md, etape 2."
  exit 1
}
Write-Ok "Connecte a un tailnet."

$TsStatus = Get-TailscaleStatusJson $TsExe
if (-not $TsStatus -or -not $TsStatus.Self -or -not $TsStatus.Self.DNSName) {
  Write-Fail "Connecte, mais MagicDNS ne semble pas actif (pas de nom de machine lisible)."
  Write-Info "Verifiez GUIDE-TAILSCALE.md, etape 'Verifier MagicDNS', puis relancez ce script."
  exit 1
}
$MachineHostName = $TsStatus.Self.DNSName.TrimEnd('.')
Write-Ok "Machine sur le tailnet : $MachineHostName"

$FunnelIssue = Test-FunnelPrerequisites -TsExe $TsExe
if ($FunnelIssue) {
  Write-Fail $FunnelIssue
  Write-Info "Vous pouvez revalider chaque etape avec : .\setup-ollama-bridge.ps1 -Diagnose"
  exit 1
}
Write-Ok "Prerequis Funnel (certificats HTTPS + permission ACL) : OK."

# ---------------------------------------------------------------------------
# 1. Ollama: install, start, pull model
# ---------------------------------------------------------------------------

Write-Step "Verification d'Ollama"

$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCmd) {
  Write-Host "    Ollama n'est pas installe -- installation via winget..."
  try {
    winget install --id Ollama.Ollama -e --silent --accept-package-agreements --accept-source-agreements
  } catch {
    Write-Fail "L'installation via winget a echoue. Relancez ce script depuis un PowerShell en mode Administrateur, ou installez Ollama manuellement depuis https://ollama.com puis relancez ce script."
    exit 1
  }
  # winget-installed apps sometimes need a fresh PATH to be visible in this
  # session -- add the common install location as a fallback.
  $env:PATH += ";$env:LOCALAPPDATA\Programs\Ollama"
  $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
  if (-not $ollamaCmd) {
    Write-Fail "Ollama a ete installe mais la commande 'ollama' n'est pas trouvee dans cette session. Fermez et rouvrez PowerShell, puis relancez ce script."
    exit 1
  }
}
Write-Ok "Ollama est installe."

function Test-OllamaRunning {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$OllamaPort" -TimeoutSec 3 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-OllamaRunning)) {
  Write-Host "    Le serveur Ollama ne repond pas encore -- demarrage..."
  Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
  $tries = 0
  while (-not (Test-OllamaRunning) -and $tries -lt 15) {
    Start-Sleep -Seconds 1
    $tries++
  }
}

if (-not (Test-OllamaRunning)) {
  Write-Fail "Impossible de joindre Ollama sur 127.0.0.1:$OllamaPort apres plusieurs tentatives."
  exit 1
}
Write-Ok "Le serveur Ollama repond sur le port $OllamaPort."

Write-Step "Verification du modele '$Model'"
$haveModel = $false
try {
  $listOutput = & ollama list 2>$null
  if ($listOutput -match [regex]::Escape($Model)) { $haveModel = $true }
} catch {}

if (-not $haveModel) {
  Write-Host "    Telechargement de '$Model' (peut prendre plusieurs minutes selon votre connexion)..."
  & ollama pull $Model
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "Le telechargement du modele a echoue. Verifiez le nom du modele (ollama pull $Model) et votre connexion internet."
    exit 1
  }
}
Write-Ok "Modele '$Model' disponible."

# ---------------------------------------------------------------------------
# 2. Caddy: portable binary, no winget/PATH guessing
# ---------------------------------------------------------------------------

Write-Step "Verification de Caddy (proxy avec authentification)"

if (-not (Test-Path $CaddyExe)) {
  Write-Host "    Telechargement de Caddy..."
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/caddyserver/caddy/releases/latest"
  $asset = $release.assets | Where-Object { $_.name -match "windows_amd64\.zip$" } | Select-Object -First 1
  if (-not $asset) {
    Write-Fail "Impossible de trouver l'archive Windows de Caddy sur GitHub. Telechargez-la manuellement depuis https://github.com/caddyserver/caddy/releases/latest et placez caddy.exe dans $BinDir"
    exit 1
  }
  $zipPath = Join-Path $BinDir "caddy.zip"
  Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $BinDir -Force
  Remove-Item $zipPath -Force
  if (-not (Test-Path $CaddyExe)) {
    Write-Fail "L'archive Caddy ne contenait pas caddy.exe a l'emplacement attendu. Verifiez $BinDir manuellement."
    exit 1
  }
}
Write-Ok "Caddy pret ($CaddyExe)."

# ---------------------------------------------------------------------------
# 3. Secret token + Caddyfile
# ---------------------------------------------------------------------------

Write-Step "Configuration du jeton secret et du proxy"

Stop-StaleBridge

$cfg = Get-BridgeConfig
if (-not $cfg.secret) {
  $cfg.secret = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
  Save-BridgeConfig $cfg
  Write-Host "    Nouveau jeton secret genere (reutilise automatiquement la prochaine fois)."
} else {
  Write-Host "    Jeton secret existant reutilise."
}
$Secret = $cfg.secret

# Four routes behind the same bearer token: /bridge/status* goes to the GPU
# watcher (ollama-watcher.ps1, a separate lightweight process -- see below);
# /sdapi-chroma/* goes to the dedicated Chroma instance (setup-forge-
# chroma.ps1, its own process/port -- see that script for why Chroma isn't
# just a 5th checkpoint on the main Forge instance); /sdapi/* goes to the
# main Forge instance (setup-forge.ps1: NoobAI-XL, RealVisXL, Flux Safe,
# NSFW Flux); everything else goes to Ollama itself, unchanged from before.
$caddyfileContent = @"
:$ProxyPort {
	@authorizedStatus {
		header Authorization "Bearer $Secret"
		path /bridge/status*
	}
	@authorizedSd {
		header Authorization "Bearer $Secret"
		path /sdapi/*
	}
	@authorizedChroma {
		header Authorization "Bearer $Secret"
		path /sdapi-chroma/*
	}
	@authorizedOllama {
		header Authorization "Bearer $Secret"
		not path /bridge/status*
		not path /sdapi/*
		not path /sdapi-chroma/*
	}

	# Caddy sorts directives of different kinds by its own fixed priority list,
	# not by the order they're written -- and "respond" sorts before
	# "reverse_proxy". Without this route{} block, the unconditional fallback
	# respond below would run FIRST on every request and always return 401,
	# even with a correct token (reverse_proxy would never get a chance to run).
	#
	# header_up Host localhost on every upstream: by default reverse_proxy
	# passes through the original inbound Host header (the public tunnel
	# hostname) unchanged. Ollama's own server has a built-in DNS-rebinding
	# protection (server/routes.go, allowedHostsMiddleware/allowedHost --
	# verified directly against the ollama/ollama source) that answers 403
	# to any request whose Host header isn't localhost/loopback/the machine's
	# own hostname -- it doesn't know or care about Caddy's own bearer-token
	# check in front of it, it just sees a public hostname and refuses on
	# principle. This is what silently turned "sans jeton = 401, avec jeton =
	# 403" into a months-long red herring across two unrelated tunnel
	# providers (Cloudflare, then Tailscale) -- confirmed by curl -v showing
	# a "Via: 1.1 Caddy" header on the 403 response, which Caddy only ever
	# adds on a reverse_proxy response (never on its own "respond" fallback),
	# proving the request really did reach Ollama and Ollama itself answered
	# 403. Rewriting just the Host header sent upstream avoids touching
	# Ollama's own listen address (still 127.0.0.1-only, unchanged).
	route {
		# The public path is /sdapi-chroma/* (distinct from /sdapi/* so Caddy
		# can tell the two Forge instances apart), but the Chroma instance
		# itself is just another Forge fork answering on its own native
		# /sdapi/* -- rewriting the prefix (not stripping it down to nothing)
		# is what makes the forwarded request match what it actually expects.
		# Confirmed as a real gap while writing this: a plain strip_prefix
		# here would have forwarded "/v1/txt2img" upstream instead of
		# "/sdapi/v1/txt2img", a 404 that would have looked like a broken
		# Chroma install rather than a proxy misconfiguration.
		uri @authorizedChroma replace /sdapi-chroma /sdapi

		reverse_proxy @authorizedStatus 127.0.0.1:$WatcherPort {
			header_up Host localhost
		}
		reverse_proxy @authorizedSd 127.0.0.1:$SdPort {
			header_up Host localhost
		}
		reverse_proxy @authorizedChroma 127.0.0.1:$ChromaPort {
			header_up Host localhost
		}
		reverse_proxy @authorizedOllama 127.0.0.1:$OllamaPort {
			header_up Host localhost
		}

		respond "Unauthorized" 401
	}
}
"@
Set-Content -Path $CaddyfilePath -Value $caddyfileContent -Encoding UTF8

# BUG FOUND ON A REAL RUN: this call was not wrapped in Invoke-NativeQuiet,
# despite that function existing specifically for this exact trap (see its
# own comment above) -- caddy validate's normal, harmless informational
# output on stderr got promoted to a terminating error under
# $ErrorActionPreference = "Stop", silently killing the whole bridge phase
# with no Write-Fail ever printed. See CHANGELOG.md.
$caddyValidateOutput = Invoke-NativeQuiet { & $CaddyExe validate --config $CaddyfilePath --adapter caddyfile 2>&1 }
if ($LASTEXITCODE -ne 0) {
  Write-Fail "Le Caddyfile genere n'est pas valide :"
  $caddyValidateOutput | ForEach-Object { Write-Host "    $_" }
  exit 1
}
Write-Ok "Caddyfile valide."

$caddyProcess = Start-Process -FilePath $CaddyExe -ArgumentList "run", "--config", $CaddyfilePath, "--adapter", "caddyfile" -WindowStyle Hidden -PassThru
$script:ChildProcesses += $caddyProcess
$cfg.caddyPid = $caddyProcess.Id
Save-BridgeConfig $cfg
Start-Sleep -Seconds 2

Write-Step "Demarrage du surveillant GPU (indicateur hors ligne/indisponible/disponible)"

if ($NoWatcher) {
  Write-Host "    Ignore (-NoWatcher)."
} elseif (-not (Test-Path $WatcherScriptPath)) {
  Write-Fail "ollama-watcher.ps1 introuvable a cote de ce script -- l'indicateur de statut ne fonctionnera pas, mais Ollama et le tunnel restent utilisables."
} else {
  $watcherProcess = Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$WatcherScriptPath`"", "-Port", $WatcherPort `
    -WindowStyle Hidden -PassThru
  $script:ChildProcesses += $watcherProcess
  $cfg.watcherPid = $watcherProcess.Id
  Save-BridgeConfig $cfg
  Start-Sleep -Seconds 2
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$WatcherPort/" -TimeoutSec 3 | Out-Null
    Write-Ok "Surveillant GPU actif sur le port $WatcherPort."
  } catch {
    Write-Fail "Le surveillant GPU ne repond pas encore sur le port $WatcherPort (regardez $WorkDir\watcher.log). Ollama et le tunnel restent utilisables sans lui."
  }
}

$script:LastHttpError = $null

# Reads the actual response body + Server header from a failed request, when
# available -- the status code alone can't tell apart a real Caddy/Ollama
# answer from one injected by something else entirely (a security product's
# HTTPS/DLP inspection, a corporate/ISP proxy) before the request ever
# reaches Tailscale or Caddy. Handles both Windows PowerShell 5.1
# (System.Net.WebException, body only readable via GetResponseStream()) and
# PowerShell 7+ (Invoke-RestMethod already populates $_.ErrorDetails.Message).
function Get-HttpErrorDetail($errorRecord) {
  $bodyText = $null
  $serverHeader = $null
  try {
    if ($errorRecord.ErrorDetails -and $errorRecord.ErrorDetails.Message) {
      $bodyText = $errorRecord.ErrorDetails.Message
    }
  } catch {}
  $webResponse = $errorRecord.Exception.Response
  if ($webResponse) {
    try { $serverHeader = $webResponse.Headers["Server"] } catch {}
    if (-not $bodyText) {
      try {
        $stream = $webResponse.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $bodyText = $reader.ReadToEnd()
        $reader.Close()
      } catch {}
    }
  }
  return [pscustomobject]@{ Body = $bodyText; Server = $serverHeader }
}

$script:LastHttpErrorDetail = $null

function Get-HttpStatus($uri, $headers) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $uri -Headers $headers -Method Post `
      -ContentType "application/json" `
      -Body '{"model":"__probe__","messages":[{"role":"user","content":"ping"}]}' `
      -TimeoutSec 15
    $script:LastHttpError = $null
    $script:LastHttpErrorDetail = $null
    return [int]$resp.StatusCode
  } catch {
    $script:LastHttpError = $_.Exception.Message
    $script:LastHttpErrorDetail = Get-HttpErrorDetail $_
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return -1
  }
}

Write-Step "Verification locale du proxy (avant d'ouvrir le tunnel)"

$statusNoAuth = Get-HttpStatus "http://127.0.0.1:$ProxyPort/v1/chat/completions" @{}
if ($statusNoAuth -eq 401) {
  Write-Ok "Sans jeton : correctement rejete (401)."
} else {
  Write-Fail "Sans jeton, le proxy a repondu $statusNoAuth au lieu de 401 -- verifiez le Caddyfile."
  Stop-Bridge
  exit 1
}

# Checked locally, not just through the tunnel further down: isolates
# whether a real problem seen later comes from Caddy's own token check
# (would already show up right here, before Tailscale is even involved) or
# from something Funnel/network-specific.
$statusWithAuth = Get-HttpStatus "http://127.0.0.1:$ProxyPort/v1/chat/completions" @{ Authorization = "Bearer $Secret" }
if ($statusWithAuth -ne 401) {
  Write-Ok "Avec jeton : accepte en local (reponse $statusWithAuth, transmise a Ollama)."
} else {
  Write-Fail "Avec jeton, le proxy repond quand meme 401 en local -- le Caddyfile ne reconnait pas ce jeton (verifiez qu'aucun ancien processus Caddy avec un jeton different ne tourne encore)."
  Stop-Bridge
  exit 1
}

Write-Step "Verification de la route image locale (/sdapi -- optionnelle)"

$sdStatusNoAuth = Get-HttpStatus "http://127.0.0.1:$ProxyPort/sdapi/v1/txt2img" @{}
if ($sdStatusNoAuth -eq 401) {
  Write-Ok "Route /sdapi correctement protegee (401 sans jeton)."
} else {
  Write-Fail "Route /sdapi : reponse $sdStatusNoAuth au lieu de 401 -- verifiez le Caddyfile."
}
$sdDetected = $false
try {
  Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$SdPort/" -TimeoutSec 3 | Out-Null
  $sdDetected = $true
  Write-Ok "Un serveur repond sur le port $SdPort (probablement Forge -- NoobAI-XL/RealVisXL/Flux Safe/NSFW)."
} catch {
  Write-Host "    Rien ne repond sur le port $SdPort pour l'instant -- normal si vous n'utilisez pas encore la generation d'image locale."
  Write-Host "    Pour l'activer : lancez setup-forge.ps1, puis relancez ce script."
}

Write-Step "Verification de la route image Chroma (/sdapi-chroma -- optionnelle)"

$chromaStatusNoAuth = Get-HttpStatus "http://127.0.0.1:$ProxyPort/sdapi-chroma/v1/txt2img" @{}
if ($chromaStatusNoAuth -eq 401) {
  Write-Ok "Route /sdapi-chroma correctement protegee (401 sans jeton)."
} else {
  Write-Fail "Route /sdapi-chroma : reponse $chromaStatusNoAuth au lieu de 401 -- verifiez le Caddyfile."
}
$chromaDetected = $false
try {
  Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$ChromaPort/" -TimeoutSec 3 | Out-Null
  $chromaDetected = $true
  Write-Ok "Un serveur repond sur le port $ChromaPort (l'instance Chroma dediee)."
} catch {
  Write-Host "    Rien ne repond sur le port $ChromaPort pour l'instant -- normal si vous n'utilisez pas Chroma."
  Write-Host "    Pour l'activer : lancez setup-forge-chroma.ps1, puis relancez ce script."
}

# ---------------------------------------------------------------------------
# 4. Tailscale Funnel: point it at Caddy, read back the stable hostname
# ---------------------------------------------------------------------------

Write-Step "Configuration du tunnel public stable (Tailscale Funnel)"

# A single 'tailscale funnel' call both configures the routing (public port
# -> local Caddy port) AND turns on public reachability for it -- current
# Tailscale versions merged what used to be a two-step 'serve' then
# 'funnel <port> on' dance into one command (confirmed against the
# tailscale/tailscale source: funnel's positional "<port> {on|off}" form is
# dead code no longer wired up by the CLI -- using it, as an earlier version
# of this script did, fails immediately with a usage error). --bg keeps it
# running in the background after this command returns, so it survives
# Ctrl+C on this script (see .NOTES). Idempotent -- safe to re-run.
$funnelOutput = Invoke-NativeQuiet { & $TsExe funnel --bg "--https=$FunnelPort" "http://127.0.0.1:$ProxyPort" 2>&1 }
if ($LASTEXITCODE -ne 0) {
  Write-Fail "'tailscale funnel' a echoue (code $LASTEXITCODE)."
  Write-Info "Message exact de Tailscale :"
  foreach ($line in $funnelOutput) { Write-Info "  $line" }
  Write-Info "Relancez avec : .\setup-ollama-bridge.ps1 -Diagnose  pour un rapport detaille."
  Stop-Bridge
  exit 1
}

$TunnelUrl = $null
$tries = 0
while (-not $TunnelUrl -and $tries -lt 15) {
  try {
    $funnelStatusRaw = Invoke-NativeQuiet { & $TsExe funnel status --json 2>$null }
    if ($LASTEXITCODE -eq 0 -and $funnelStatusRaw) {
      $funnelStatus = $funnelStatusRaw | ConvertFrom-Json
      # Documented shape: an object keyed by "hostname:port" whose value
      # describes that listener. There's only ever one here (this script
      # only ever configures the one on $FunnelPort), so the first key found
      # with Funnel actually enabled is the one we want.
      foreach ($key in $funnelStatus.AllowFunnel.PSObject.Properties.Name) {
        if ($funnelStatus.AllowFunnel.$key) {
          $TunnelUrl = "https://" + ($key -replace ":\d+$", "")
          break
        }
      }
    }
  } catch {}
  if (-not $TunnelUrl) {
    Start-Sleep -Seconds 1
    $tries++
  }
}

# Fallback if the JSON shape above doesn't match (Tailscale's own CLI output
# format has changed across versions before) -- MagicDNS already gave us the
# exact hostname earlier, and Funnel always publishes on that same hostname.
if (-not $TunnelUrl) {
  $TunnelUrl = "https://$MachineHostName"
  Write-Info "Impossible de confirmer via 'tailscale funnel status --json' (format inattendu) -- utilisation du nom de machine connu : $TunnelUrl"
}

Write-Ok "Tunnel public stable : $TunnelUrl"
Write-Info "Cette adresse ne changera pas d'une execution a l'autre (contrairement a l'ancien tunnel Cloudflare)."

# ---------------------------------------------------------------------------
# 5. End-to-end validation through the PUBLIC tunnel
# ---------------------------------------------------------------------------

Write-Step "Validation de bout en bout via l'URL publique"

$publicStatusNoAuth = $null
$tries = 0
$maxTries = 20
while ($tries -lt $maxTries) {
  $publicStatusNoAuth = Get-HttpStatus "$TunnelUrl/v1/chat/completions" @{}
  if ($publicStatusNoAuth -eq 401) { break }
  Start-Sleep -Seconds 3
  $tries++
  if ($tries % 5 -eq 0) {
    Write-Host "    ... toujours en attente de la propagation du tunnel ($tries/$maxTries)"
  }
}

if ($publicStatusNoAuth -eq 401) {
  Write-Ok "Sans jeton via le tunnel public : correctement rejete (401)."
} else {
  $detail = if ($script:LastHttpError) { " Detail : $($script:LastHttpError)" } else { "" }
  Write-Fail "Sans jeton via le tunnel public : reponse $publicStatusNoAuth (attendu 401) apres $($maxTries * 3)s d'attente.$detail"
  Write-Info "Causes les plus frequentes a ce stade :"
  Write-Info " - Le pare-feu Windows bloque Tailscale (rare, Tailscale cree ses propres regles a l'installation)."
  Write-Info " - Un antivirus tiers bloque le trafic HTTPS entrant sur cette machine."
  Write-Info " - Le certificat HTTPS n'a pas fini de se generer (peut prendre jusqu'a une minute la toute premiere fois)."
  Write-Info "Verifiez avec : .\setup-ollama-bridge.ps1 -Diagnose"
  Stop-Bridge
  exit 1
}

try {
  $body = @{
    model = $Model
    messages = @(@{ role = "user"; content = "Reponds uniquement par le mot OK, rien d'autre." })
  } | ConvertTo-Json -Depth 5

  $resp = Invoke-RestMethod -Method Post -Uri "$TunnelUrl/v1/chat/completions" `
    -Headers @{ Authorization = "Bearer $Secret" } `
    -ContentType "application/json" -Body $body -TimeoutSec 60

  $reply = $resp.choices[0].message.content
  Write-Ok "Avec jeton via le tunnel public : reponse recue d'Ollama -- '$reply'"
} catch {
  $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { $null }
  $errDetail = Get-HttpErrorDetail $_
  Write-Fail "Avec jeton via le tunnel public : la requete a echoue -- $($_.Exception.Message)"
  if ($errDetail.Server) { Write-Info "En-tete 'Server' de la reponse recue : $($errDetail.Server)" }
  if ($errDetail.Body) {
    Write-Info "Corps de la reponse recue (peut reveler qui a repondu a la place de Caddy) :"
    Write-Host "    $($errDetail.Body)"
  }
  Write-Info "Ce Caddyfile ne sait repondre que 401 (jeton refuse) ou transmettre a Ollama -- si ce n'est ni"
  Write-Info "l'un ni l'autre (ex : 403), la reponse vient forcement d'ailleurs avant meme d'atteindre Caddy."
  if ($statusCode -eq 403) {
    Write-Info ""
    if ($errDetail.Server -and $errDetail.Server -match "Caddy" -or ($_.Exception.Response -and $_.Exception.Response.Headers -and ($_.Exception.Response.Headers["Via"] -match "Caddy"))) {
      Write-Info "L'en-tete 'Via: ... Caddy' confirme que la requete a bien traverse ce Caddy et atteint"
      Write-Info "l'un des serveurs derriere (Ollama/Forge/Forge-Chroma/surveillant) -- ce n'est donc ni"
      Write-Info "Tailscale, ni un blocage reseau externe : ce serveur lui-meme a repondu 403. Ollama a sa"
      Write-Info "propre protection anti-DNS-rebinding qui refuse toute requete dont l'en-tete Host n'est"
      Write-Info "pas 'localhost'/loopback -- si cette version du script est a jour, le Caddyfile force deja"
      Write-Info "'header_up Host localhost' sur les trois routes ; si vous voyez quand meme ce 403,"
      Write-Info "supprimez $CaddyfilePath et relancez pour regenerer un Caddyfile a jour."
    } else {
      Write-Info "Piste possible pour un 403 precisement sur la requete AVEC le jeton (la requete SANS"
      Write-Info "jeton, elle, vient de passer normalement) : quelque chose entre ce PC et Tailscale"
      Write-Info "inspecte le trafic HTTPS sortant et reagit specifiquement a l'en-tete 'Authorization:"
      Write-Info "Bearer' -- antivirus/pare-feu tiers avec protection web, ou un logiciel de prevention de"
      Write-Info "fuite de donnees (DLP)."
    }
    Write-Info ""
    Write-Info "Le pont reste actif (Caddy + tunnel) pour que vous puissiez diagnostiquer EN DIRECT,"
    Write-Info "au lieu de devoir tout relancer a chaque test :"
    Write-Info " - Dans UNE AUTRE fenetre PowerShell, sur ce PC :"
    Write-Info "     `$secret = (Get-Content `"$ConfigPath`" | ConvertFrom-Json).secret"
    Write-Info "     curl.exe -v -H `"Authorization: Bearer `$secret`" -H `"Content-Type: application/json`" ``"
    Write-Info "       -d '{\`"model\`":\`"__probe__\`",\`"messages\`":[{\`"role\`":\`"user\`",\`"content\`":\`"ping\`"}]}' $TunnelUrl/v1/chat/completions"
    Write-Info "   (le corps et l'en-tete 'Server'/'Via' de la reponse peuvent identifier qui a repondu)"
    Write-Info " - Depuis un AUTRE appareil sur un AUTRE reseau (telephone en 4G/5G, pas le wifi de la"
    Write-Info "   maison) : si un test equivalent passe depuis cet appareil, la cause est locale a ce PC."
    Write-Info ""
    Write-Info "Appuyez sur Entree une fois vos tests termines pour tout arreter proprement..."
    try { Read-Host | Out-Null } catch {}
  }
  Write-Info "Verifiez avec : .\setup-ollama-bridge.ps1 -Diagnose"
  Stop-Bridge
  exit 1
}

if (-not $NoWatcher) {
  try {
    $statusResp = Invoke-RestMethod -Method Get -Uri "$TunnelUrl/bridge/status" -Headers @{ Authorization = "Bearer $Secret" } -TimeoutSec 15
    Write-Ok "Point de statut GPU joignable via le tunnel public -- etat actuel : $($statusResp.state)"
  } catch {
    # Not fatal: the actual text generation above already proved end to end --
    # this only means Trame's colored indicator will show "hors ligne"
    # until it's sorted out.
    Write-Fail "Point de statut /bridge/status injoignable via le tunnel -- $($_.Exception.Message). La generation de texte fonctionne ; seul l'indicateur de statut dans Trame sera incorrect."
  }
}

# ---------------------------------------------------------------------------
# 6. Push settings to Trame automatically
# ---------------------------------------------------------------------------

if (-not $SkipTrameUpdate) {
  Write-Step "Mise a jour automatique des reglages Trame ($TrameUrl)"
  try {
    # Same tunnel URL and secret for both -- Caddy tells Ollama and the
    # /sdapi image route apart by path, so there's only one address to push.
    # textProvider/imageProvider themselves are left untouched: you opt in
    # from Settings when ready, same reasoning as not auto-switching before.
    $settingsBody = @{
      ollamaBaseUrl = $TunnelUrl
      localImageBaseUrl = $TunnelUrl
      apiKeys = @{ ollama = $Secret; localsd = $Secret }
    } | ConvertTo-Json -Depth 5

    Invoke-RestMethod -Method Post -Uri "$TrameUrl/api/settings" `
      -ContentType "application/json" -Body $settingsBody -TimeoutSec 20 | Out-Null

    $confirm = Invoke-RestMethod -Method Get -Uri "$TrameUrl/api/settings" -TimeoutSec 20
    if ($confirm.ollamaBaseUrl -eq $TunnelUrl -and $confirm.localImageBaseUrl -eq $TunnelUrl) {
      Write-Ok "Trame confirme la nouvelle adresse (texte ET image locale)."
    } else {
      Write-Fail "Trame n'a pas confirme la mise a jour (ollamaBaseUrl : $($confirm.ollamaBaseUrl), localImageBaseUrl : $($confirm.localImageBaseUrl)). Verifiez manuellement dans Reglages."
    }
  } catch {
    Write-Fail "Impossible de contacter Trame pour mettre a jour les reglages -- $($_.Exception.Message). Vous pouvez le faire manuellement dans Reglages."
  }
} else {
  Write-Step "Mise a jour Trame ignoree (-SkipTrameUpdate)"
  Write-Host "    Adresse a coller dans Reglages -> Adresse du serveur Ollama ET Adresse du serveur Stable Diffusion : $TunnelUrl"
  Write-Host "    Cle a coller dans Reglages -> Cle API Ollama ET Cle API IA locale (images) : $Secret"
}

# ---------------------------------------------------------------------------
# Summary + keep running
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Yellow
Write-Host " Pont Ollama <-> Trame actif" -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Yellow
Write-Host " URL du tunnel   : $TunnelUrl  (stable -- ne change pas d'une execution a l'autre)"
Write-Host " Modele utilise  : $Model"
Write-Host " Trame        : $TrameUrl"
Write-Host ""
Write-Host " Surveillant GPU  : $(if ($NoWatcher) { 'desactive (-NoWatcher)' } else { 'actif (icone dans la barre des taches)' })"
Write-Host " Image locale (/sdapi) : route $(if ($sdStatusNoAuth -eq 401) { 'prete' } else { 'a verifier' }) sur le port $SdPort -- $(if ($sdDetected) { 'un serveur y repond' } else { 'rien detecte, lancez setup-forge.ps1 si besoin' })"
Write-Host " Image Chroma (/sdapi-chroma) : route $(if ($chromaStatusNoAuth -eq 401) { 'prete' } else { 'a verifier' }) sur le port $ChromaPort -- $(if ($chromaDetected) { 'un serveur y repond' } else { 'rien detecte, lancez setup-forge-chroma.ps1 si besoin' })"
Write-Host ""
Write-Host " Derniere etape (manuelle) : ouvrez Trame -> Reglages, mettez"
Write-Host " Fournisseur = 'Ollama (local)' et Modele = '$Model' pour le texte ;"
Write-Host " Fournisseur = 'IA locale (Stable Diffusion)' pour les images si vous en utilisez une ; puis Enregistrer."
Write-Host ""
Write-Host " Journal complet de cette execution : $TranscriptPath"
Write-Host " En cas de probleme : .\setup-ollama-bridge.ps1 -Diagnose"
Write-Host " Laissez cette fenetre ouverte tant que vous jouez avec Ollama."
Write-Host " Appuyez sur Ctrl+C pour arreter Caddy et le surveillant (Tailscale continue de tourner)."
Write-Host "=================================================================" -ForegroundColor Yellow

try {
  while ($true) { Start-Sleep -Seconds 5 }
} finally {
  Write-Host ""
  Write-Host "Arret du proxy et du surveillant (Tailscale et sa configuration Funnel restent actifs)..."
  Stop-Bridge
  try { Stop-Transcript | Out-Null } catch {}
}
