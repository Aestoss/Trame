<#
.SYNOPSIS
  Installs and starts AUTOMATIC1111 (Stable Diffusion WebUI) for Trame's
  local image generation, auto-detecting folders you may already have
  instead of asking you to type paths by hand.

.DESCRIPTION
  This is the missing piece for local image generation: setup-ollama-bridge.ps1
  already prepares an authenticated proxy route for it (/sdapi/*) and detects
  whether something answers on port 7860, but does NOT install AUTOMATIC1111
  itself -- that's what this script does. Run this first, then re-run
  setup-ollama-bridge.ps1 to wire it into the public tunnel and push the
  address to Trame's Settings.

  What it does, in order:
    1. Makes sure Python 3.10 and Git are installed (via winget if missing).
    2. Looks for an existing AUTOMATIC1111 install before cloning a new one --
       searches your user profile, Desktop, Downloads and Documents for a
       "webui-user.bat" file (the one file every real install has) up to 3
       folders deep, and remembers what it finds (or where it cloned a fresh
       copy) in a small config file next to setup-ollama-bridge.ps1's own, so
       later runs don't need to search again.
    3. Looks for Stable Diffusion checkpoints (.safetensors/.ckpt) already
       sitting in Downloads or Desktop and moves any found into the
       install's models folder. Then, unless -NoAutoModel is set, downloads
       whichever of two default checkpoints is still missing so both an
       illustration and a photorealistic option are available side by side
       (Trame's "Image model" field switches between them per world) --
       NoobAI-XL v1.1 (SDXL/anime/illustration, uncensored, ~7.1 GB) and
       RealVisXL V5.0 (photorealistic, uncensored, ~6.9 GB). -ModelUrl adds
       one further custom model on top of those two.
    4. Redirects AUTOMATIC1111's own Stable Diffusion dependency clone away
       from the official Stability-AI repo (taken down/made private in
       Dec 2025) to a working community mirror, via the same environment
       variable override AUTOMATIC1111 already reads for this -- see the
       comment above that step for the full story.
    5. Detects an RTX 50xx (Blackwell) GPU and, if found, overrides this
       webui's default (outdated) PyTorch install command so it actually
       runs on that hardware instead of crashing on the first generation --
       see the comment above that step for why this is needed.
    6. Pre-installs CLIP into the venv with a pinned setuptools version,
       working around a real, current (Sept 2026) compatibility break
       between setuptools 82+ and CLIP's legacy setup.py -- see the comment
       above that step for the full story and why the obvious PIP_CONSTRAINT
       fix doesn't actually work.
    7. Edits webui-user.bat to add the --api flag if it isn't already there
       (idempotent -- running this script again never adds it twice).
    8. Launches webui-user.bat and waits for its API to actually answer --
       the very first launch installs several GB of dependencies (PyTorch
       etc.) and can take 10-15 minutes, so this polls patiently instead of
       declaring success too early.

.NOTES
  - Run from a normal PowerShell window: if execution policy blocks the
    script, run instead:
      powershell -ExecutionPolicy Bypass -File .\setup-automatic1111.ps1
  - Iterated against a real Windows machine over several rounds (an RTX
    5080/Blackwell system) -- every fix in this script's history was made
    against an actual failure log from that machine, not guessed in
    advance. Still, if you hit something new, please report it back.
  - Launches the WebUI as a hidden, detached background process (not
    attached to this console) and returns once its API answers -- this
    script does NOT stay running or block on it, unlike setup-ollama-bridge.ps1
    (which keeps running in the foreground until Ctrl+C). AUTOMATIC1111
    keeps running after this script exits; see start-trame.ps1 for a
    single entry point that starts (and cleanly stops) both together.
  - Known limitation: an existing install with a custom checkpoints folder
    (a --ckpt-dir argument in COMMANDLINE_ARGS, or a setting in config.json)
    isn't auto-detected -- models are always downloaded/placed under this
    install's own models\Stable-diffusion. VENV_DIR (a more common
    customization) IS auto-detected. If you use a custom --ckpt-dir, either
    remove it or move the downloaded checkpoints there by hand.

.PARAMETER WebUiDir
  Skip auto-detection and use this exact AUTOMATIC1111 folder (must contain
  webui-user.bat). Use this if you already know where it's installed, or if
  auto-detection picked the wrong one of several installs.

.PARAMETER ModelUrl
  Optional direct download URL for an additional Stable Diffusion checkpoint
  (.safetensors) to fetch on top of the two default profiles (illustration
  + photorealistic), e.g. a specific style you want alongside them.

.PARAMETER SdPort
  Port the WebUI's API should listen on. Defaults to 7860 (AUTOMATIC1111's
  own default) -- matches setup-ollama-bridge.ps1's default -SdPort, keep
  them in sync if you change one.

.PARAMETER NoAutoModel
  Skip downloading the two default checkpoints (illustration + photo-
  realistic, ~14 GB together) -- only moves in whatever's already sitting
  in Downloads/Desktop, and stops with manual instructions if that leaves
  the models folder empty. Use this if you'd rather pick your own model(s)
  without that download.

.PARAMETER SkipLaunch
  Set everything up (install, detect, place model, add --api) but don't
  actually start the WebUI -- use this if you'd rather launch it yourself.
#>

[CmdletBinding()]
param(
  [string]$WebUiDir = "",
  [string]$ModelUrl = "",
  [int]$SdPort = 7860,
  [switch]$NoAutoModel,
  [switch]$SkipLaunch
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Setup / paths -- reuses the same work folder as setup-ollama-bridge.ps1
# (this machine's one shared "Trame PC bridge" folder) rather than
# inventing a second one, since the two scripts are two halves of the same
# setup.
# ---------------------------------------------------------------------------

$WorkDir       = Join-Path $env:USERPROFILE "TrameOllamaBridge"
$ConfigPath    = Join-Path $WorkDir "automatic1111-config.json"
$DefaultCloneParent = $env:USERPROFILE
$WebUiLogPath  = Join-Path $WorkDir "automatic1111.log"
$WebUiErrLogPath = Join-Path $WorkDir "automatic1111.err.log"
$WebUiStdinPath = Join-Path $WorkDir "automatic1111-stdin.empty"

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

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

# Runs $ScriptBlock with $ErrorActionPreference temporarily relaxed to
# "Continue", then restores it. Guards against two separate PowerShell
# version-specific traps that both turn a harmless or already-handled
# native-command outcome into an uncaught crash of the whole script,
# because this script's global $ErrorActionPreference = "Stop" (set for
# real cmdlet failures elsewhere -- see that line's own comment) also
# reaches native commands in ways that don't behave like a normal cmdlet:
#   1. Windows PowerShell 5.1 wraps ANY captured stderr (2>&1, 2>$null,
#      2>somefile) into an ErrorRecord the instant it's captured -- even
#      when the command succeeded and the stderr text was routine chatter
#      (a pip notice, a deprecation warning), not a real failure. A native
#      command whose stderr is left unredirected is NOT at risk here
#      (PowerShell only wraps it once something captures it).
#   2. PowerShell 7.3+'s $PSNativeCommandUseErrorActionPreference (on by
#      default) promotes a non-zero exit code from ANY native command --
#      regardless of stderr -- into the same kind of terminating error,
#      pre-empting a caller's own "if ($LASTEXITCODE -ne 0)" handling
#      before it can even run.
# Used at every native-command call site in this script that either
# redirects stderr (found by grepping for "2>") or is a real, plausible
# failure point with its own $LASTEXITCODE check meant to handle that
# failure gracefully (git clone, venv creation) -- not needed for calls
# with no meaningful failure mode to protect (e.g. `py -3.10 --version`
# succeeding is the whole point of calling it). $LASTEXITCODE still
# reflects the command's real exit code and should be checked as usual.
function Invoke-NativeQuiet {
  param([Parameter(Mandatory)][scriptblock]$ScriptBlock)
  $prevErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $ScriptBlock } finally { $ErrorActionPreference = $prevErrorActionPreference }
}

# Finds this install's running process(es) two ways and combines them.
# Confirmed for real on a live machine: Get-CimInstance's CommandLine can
# come back EMPTY for a perfectly real, running process -- Windows/WMI can
# silently withhold it when this script's own process doesn't have enough
# privilege relative to the target (e.g. one of the two was ever launched
# from an elevated window and the other wasn't). When that happens, the
# directory-based match below finds nothing even though the process is
# very much alive -- confirmed directly against a real "port already in
# use" failure right after this reported nothing to stop. Port-based
# lookup (Get-NetTCPConnection) is the fix: it finds whatever process is
# actually LISTENING on this port via the network stack, not WMI's process
# table, so it doesn't depend on being able to read that process's command
# line at all. Both signals are combined -- the directory match still
# catches a process before it's even bound to the port yet.
function Get-A1111ProcessIds {
  param([string]$Dir, [int]$Port)
  $pidsFound = New-Object System.Collections.Generic.HashSet[int]
  if ($Dir) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$Dir*") } |
      ForEach-Object { [void]$pidsFound.Add($_.ProcessId) }
  }
  try {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { [void]$pidsFound.Add([int]$_.OwningProcess) }
  } catch {}
  return @($pidsFound)
}

function Stop-A1111ProcessIds {
  param([int[]]$ProcessIds)
  if (-not $ProcessIds -or $ProcessIds.Count -eq 0) { return $false }
  foreach ($procId in $ProcessIds) {
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
      Write-Info "Arret d'un processus AUTOMATIC1111 (PID $procId)..."
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  $waited = 0
  while ($waited -lt 10) {
    $stillRunning = $ProcessIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
    if (-not $stillRunning) { break }
    Start-Sleep -Milliseconds 500
    $waited += 0.5
  }
  return $true
}

function Get-A1111Config {
  if (Test-Path $ConfigPath) {
    try { return Get-Content $ConfigPath -Raw | ConvertFrom-Json } catch {}
  }
  return [pscustomobject]@{ webuiDir = $null }
}
function Save-A1111Config($cfg) {
  $cfg | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8
}

# ---------------------------------------------------------------------------
# 1. Python 3.10 + Git
# ---------------------------------------------------------------------------

Write-Step "Verification de Python 3.10"

function Test-Python310 {
  try {
    $v = Invoke-NativeQuiet { & py -3.10 --version 2>&1 }
    if ($LASTEXITCODE -eq 0 -and $v -match "3\.10") { return "py -3.10" }
  } catch {}
  try {
    $v = Invoke-NativeQuiet { & python --version 2>&1 }
    if ($v -match "3\.10") { return "python" }
  } catch {}
  return $null
}

$PythonLauncher = Test-Python310
if (-not $PythonLauncher) {
  Write-Host "    Python 3.10 n'est pas installe -- installation via winget..."
  try {
    winget install --id Python.Python.3.10 -e --silent --accept-package-agreements --accept-source-agreements
  } catch {
    Write-Fail "L'installation via winget a echoue. Relancez ce script depuis un PowerShell en mode Administrateur, ou installez Python 3.10 manuellement depuis https://www.python.org/downloads/release/python-3106/ (cochez 'Add to PATH'), puis relancez ce script."
    exit 1
  }
  $env:PATH += ";$env:LOCALAPPDATA\Programs\Python\Python310;$env:LOCALAPPDATA\Programs\Python\Python310\Scripts"
  $PythonLauncher = Test-Python310
  if (-not $PythonLauncher) {
    Write-Fail "Python a ete installe mais n'est pas trouve dans cette session. Fermez et rouvrez PowerShell, puis relancez ce script."
    exit 1
  }
}
Write-Ok "Python 3.10 disponible ($PythonLauncher)."

Write-Step "Verification de Git"

$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
  Write-Host "    Git n'est pas installe -- installation via winget..."
  try {
    winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
  } catch {
    Write-Fail "L'installation via winget a echoue. Relancez ce script depuis un PowerShell en mode Administrateur, ou installez Git manuellement depuis https://git-scm.com/download/win, puis relancez ce script."
    exit 1
  }
  $env:PATH += ";$env:ProgramFiles\Git\cmd"
  $gitCmd = Get-Command git -ErrorAction SilentlyContinue
  if (-not $gitCmd) {
    Write-Fail "Git a ete installe mais n'est pas trouve dans cette session. Fermez et rouvrez PowerShell, puis relancez ce script."
    exit 1
  }
}
Write-Ok "Git est installe."

# ---------------------------------------------------------------------------
# 2. Find (or clone) AUTOMATIC1111 -- the "detection automatique des
#    dossiers" this script exists for: never make you type a path unless
#    auto-detection genuinely can't find one and none was cloned yet.
# ---------------------------------------------------------------------------

Write-Step "Recherche d'une installation d'AUTOMATIC1111 existante"

function Find-ExistingWebUi {
  $searchRoots = @(
    $env:USERPROFILE,
    (Join-Path $env:USERPROFILE "Desktop"),
    (Join-Path $env:USERPROFILE "Downloads"),
    (Join-Path $env:USERPROFILE "Documents")
  ) | Where-Object { Test-Path $_ } | Select-Object -Unique

  foreach ($root in $searchRoots) {
    $found = Get-ChildItem -Path $root -Filter "webui-user.bat" -Recurse -Depth 3 -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.Directory.FullName }
  }
  return $null
}

$cfg = Get-A1111Config
$ResolvedWebUiDir = $null

if ($WebUiDir) {
  if (-not (Test-Path (Join-Path $WebUiDir "webui-user.bat"))) {
    Write-Fail "Le dossier indique avec -WebUiDir ($WebUiDir) ne contient pas de webui-user.bat -- verifiez le chemin."
    exit 1
  }
  $ResolvedWebUiDir = $WebUiDir
  Write-Ok "Utilisation du dossier indique : $ResolvedWebUiDir"
} elseif ($cfg.webuiDir -and (Test-Path (Join-Path $cfg.webuiDir "webui-user.bat"))) {
  $ResolvedWebUiDir = $cfg.webuiDir
  Write-Ok "Installation deja connue d'une execution precedente : $ResolvedWebUiDir"
} else {
  Write-Info "Recherche dans le profil utilisateur, Bureau, Telechargements et Documents (jusqu'a 3 sous-dossiers de profondeur)..."
  $detected = Find-ExistingWebUi
  if ($detected) {
    $ResolvedWebUiDir = $detected
    Write-Ok "Installation existante trouvee : $ResolvedWebUiDir"
  } else {
    Write-Info "Aucune installation existante trouvee -- clonage d'une nouvelle copie."
    $cloneTarget = Join-Path $DefaultCloneParent "stable-diffusion-webui"
    if (Test-Path $cloneTarget) {
      Write-Fail "$cloneTarget existe deja mais ne contient pas de webui-user.bat valide -- renommez ou supprimez ce dossier, puis relancez ce script."
      exit 1
    }
    Invoke-NativeQuiet { & git clone --depth 1 https://github.com/AUTOMATIC1111/stable-diffusion-webui.git $cloneTarget }
    if ($LASTEXITCODE -ne 0) {
      Write-Fail "Le clonage a echoue (voir le detail ci-dessus). Verifiez votre connexion internet et relancez ce script."
      exit 1
    }
    $ResolvedWebUiDir = $cloneTarget
    Write-Ok "Clone dans $ResolvedWebUiDir."
  }
}

$cfg.webuiDir = $ResolvedWebUiDir
Save-A1111Config $cfg

$ModelsDir = Join-Path $ResolvedWebUiDir "models\Stable-diffusion"
New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

# ---------------------------------------------------------------------------
# 3. Find (or fetch) checkpoints -- two default profiles are kept side by
#    side on purpose (illustration and photorealistic use different base
#    models; no single checkpoint does both well), same auto-detection
#    spirit: only ask you to do something by hand if you explicitly opted
#    out with -NoAutoModel.
# ---------------------------------------------------------------------------

Write-Step "Verification des modeles Stable Diffusion (illustration + photorealiste)"

function Get-ExistingCheckpointNames($dir) {
  # -Include only takes effect with -Recurse, or with a trailing wildcard on
  # -Path like this -- without either, PowerShell silently ignores -Include
  # and returns every file in the folder, not just checkpoints.
  return Get-ChildItem -Path (Join-Path $dir "*") -Include "*.safetensors","*.ckpt" -File -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Name
}

$existingNames = Get-ExistingCheckpointNames $ModelsDir
if ($existingNames.Count -gt 0) {
  Write-Ok "Modele(s) deja en place : $($existingNames -join ', ')"
}

Write-Info "Recherche de modeles supplementaires dans Telechargements et Bureau..."
$candidateRoots = @(
  (Join-Path $env:USERPROFILE "Downloads"),
  (Join-Path $env:USERPROFILE "Desktop")
) | Where-Object { Test-Path $_ }
$candidates = @()
foreach ($root in $candidateRoots) {
  $candidates += Get-ChildItem -Path $root -Include "*.safetensors","*.ckpt" -File -Recurse -Depth 1 -ErrorAction SilentlyContinue
}
foreach ($file in $candidates) {
  $dest = Join-Path $ModelsDir $file.Name
  if (-not (Test-Path $dest)) {
    Move-Item -Path $file.FullName -Destination $dest -Force
    Write-Ok "Deplace vers le dossier des modeles : $($file.Name)"
  }
}

$existingNames = Get-ExistingCheckpointNames $ModelsDir

# The two default profiles Trame expects to be able to switch between
# per world (see providers/imageProviders.js's sd_model_checkpoint override
# and public/app.js's "Image model" field) -- their exact filenames matter,
# since that's what gets typed into that field.
$DefaultModels = @(
  @{ Label = "illustration (NoobAI-XL v1.1, anime/illustration, non censure, ~7.1 Go)"; File = "NoobAI-XL-v1.1.safetensors"; Url = "https://huggingface.co/Laxhar/noobai-XL-1.1/resolve/main/NoobAI-XL-v1.1.safetensors" },
  @{ Label = "photorealiste (RealVisXL V5.0, non censure, ~6.9 Go)"; File = "RealVisXL_V5.0_fp16.safetensors"; Url = "https://huggingface.co/SG161222/RealVisXL_V5.0/resolve/main/RealVisXL_V5.0_fp16.safetensors" }
)

if ($NoAutoModel) {
  if ($existingNames.Count -eq 0) {
    Write-Fail "Aucun modele trouve, et -NoAutoModel est actif."
    Write-Host "    Telechargez un modele Stable Diffusion (fichier .safetensors, plusieurs Go)"
    Write-Host "    depuis Civitai (https://civitai.com) ou Hugging Face (https://huggingface.co),"
    Write-Host "    placez-le dans :"
    Write-Host "      $ModelsDir"
    Write-Host "    puis relancez ce script -- il le detectera automatiquement."
    exit 1
  }
} else {
  $modelsToFetch = @($DefaultModels | Where-Object { $existingNames -notcontains $_.File })
  if ($ModelUrl) {
    $customName = Split-Path -Leaf ([Uri]$ModelUrl).LocalPath
    if (-not $customName) { $customName = "model.safetensors" }
    if ($existingNames -notcontains $customName) {
      $modelsToFetch = @($modelsToFetch) + @(@{ Label = "modele personnalise (-ModelUrl)"; File = $customName; Url = $ModelUrl })
    }
  }

  if ($modelsToFetch.Count -eq 0) {
    Write-Ok "Les deux profils par defaut (illustration + photorealiste) sont deja presents."
  }

  foreach ($m in $modelsToFetch) {
    Write-Info "Telechargement de $($m.Label)..."
    Write-Info "Cela peut prendre plusieurs minutes selon votre connexion."
    # Downloaded to a temporary name, promoted to the real one only after a
    # sanity check -- confirmed as a real gap by an independent review: a
    # connection drop mid-download (very plausible for a multi-GB file)
    # left a truncated file at the real name, and every later run's
    # presence check (filename only, not size) mistook that for a complete
    # model and never retried -- surfacing only much later as an
    # unexplained "corrupt checkpoint" failure inside AUTOMATIC1111 itself.
    $finalDest = Join-Path $ModelsDir $m.File
    $tempDest = "$finalDest.part"
    if (Test-Path $tempDest) { Remove-Item $tempDest -Force -ErrorAction SilentlyContinue }
    $prevProgressPreference = $ProgressPreference
    $ProgressPreference = "SilentlyContinue"
    try {
      $response = Invoke-WebRequest -Uri $m.Url -OutFile $tempDest -UseBasicParsing -PassThru

      # A URL with no .safetensors/.ckpt extension (Civitai's generic
      # /api/download/models/<id> links look like this -- the real
      # filename only appears in the response's Content-Disposition
      # header) would otherwise get saved under a name AUTOMATIC1111
      # can't recognize as a checkpoint at all, while this script still
      # reports the download as a success -- also confirmed as a real gap
      # by the same review, not assumed.
      if ($m.File -notmatch "\.(safetensors|ckpt)$") {
        $contentDisposition = $response.Headers["Content-Disposition"]
        $nameMatch = if ($contentDisposition) { [regex]::Match($contentDisposition, 'filename\*?=(?:UTF-8[^A-Za-z0-9]*)?"?([^";]+)"?') } else { $null }
        $m.File = if ($nameMatch -and $nameMatch.Success) { [System.Uri]::UnescapeDataString($nameMatch.Groups[1].Value) } else { "$($m.File).safetensors" }
        $finalDest = Join-Path $ModelsDir $m.File
      }

      $downloadedSizeMB = [math]::Round((Get-Item $tempDest).Length / 1MB, 1)
      if ($downloadedSizeMB -lt 100) {
        throw "fichier telecharge anormalement petit ($downloadedSizeMB Mo) -- telechargement probablement interrompu ou incomplet."
      }

      Move-Item -Path $tempDest -Destination $finalDest -Force
      Write-Ok "Modele telecharge : $($m.File)"
    } catch {
      if (Test-Path $tempDest) { Remove-Item $tempDest -Force -ErrorAction SilentlyContinue }
      Write-Fail "Le telechargement de $($m.File) a echoue -- $($_.Exception.Message)."
      Write-Host "    Si Hugging Face demande une connexion (modele marque 'contenu mature'),"
      Write-Host "    telechargez-le a la main depuis un navigateur ou vous etes connecte :"
      Write-Host "      $($m.Url)"
      Write-Host "    Placez le fichier dans $ModelsDir (sous le nom $($m.File)) puis relancez ce script."
    } finally {
      $ProgressPreference = $prevProgressPreference
    }
  }
}

$existingNames = Get-ExistingCheckpointNames $ModelsDir
if ($existingNames.Count -eq 0) {
  Write-Fail "Aucun modele n'est present dans $ModelsDir (recherche/telechargement infructueux ci-dessus) -- AUTOMATIC1111 ne pourra rien generer sans au moins un checkpoint. Corrigez le probleme ci-dessus puis relancez ce script."
  exit 1
}

# ---------------------------------------------------------------------------
# 4. Stability-AI/stablediffusion (one of AUTOMATIC1111's own hardcoded
#    dependency repos, cloned into repositories\stable-diffusion-stability-ai
#    on first launch) was taken down/made private in Dec 2025 -- confirmed
#    via multiple real AUTOMATIC1111 GitHub issues (#17204, #17205, #17213,
#    #17216, #17218...) from that exact time, not assumed, and confirmed
#    against a real failure log from this exact install: "remote:
#    Repository not found. fatal: repository
#    'https://github.com/Stability-AI/stablediffusion.git/' not found".
#    AUTOMATIC1111's own dev branch already works around this by pointing
#    at a community fork (w-e-w/stablediffusion.git) that mirrors the same
#    commit history -- verified this fork actually contains the exact
#    commit this webui checks out (cf1d67a6..., same author/content as the
#    original) before relying on it, not just that the repo exists.
#    launch_utils.py already reads this URL from a STABLE_DIFFUSION_REPO
#    environment variable if set (the same override mechanism used for
#    CLIP_PACKAGE), so this only needs setting that variable -- no need to
#    pre-clone anything ourselves or patch AUTOMATIC1111's own code.
#    Other Stability-AI-owned dependency repos this webui clones
#    (generative-models for SDXL) were checked and are NOT affected --
#    only this one specific repo was found taken down, so only this one is
#    redirected.
# ---------------------------------------------------------------------------

Write-Step "Correctif : depot Stable Diffusion officiel indisponible"

$env:STABLE_DIFFUSION_REPO = "https://github.com/w-e-w/stablediffusion.git"
Write-Ok "STABLE_DIFFUSION_REPO redirige vers un miroir fonctionnel (le depot officiel Stability-AI a ete retire)."

# ---------------------------------------------------------------------------
# 5. RTX 50xx (Blackwell) needs a newer PyTorch than this webui pins by
#    default. AUTOMATIC1111's launch_utils.py still hardcodes torch==2.1.2
#    (CUDA 12.1), which has no compiled kernels for the 50-series' sm_120
#    architecture -- confirmed by real user reports, not assumed -- and
#    fails on the very first generation with "no kernel image is available
#    for execution on the device", well after the lengthy first-run install
#    already succeeded. Detected and overridden here via webui-user.bat's
#    own TORCH_COMMAND mechanism, which replaces that pinned install
#    command with one pointed at PyTorch's cu128 (Blackwell-compatible)
#    wheels -- everyone else's webui-user.bat is left untouched.
# ---------------------------------------------------------------------------

Write-Step "Verification de la compatibilite GPU (RTX 50xx / Blackwell)"

function Test-BlackwellGpu {
  try {
    $names = Get-CimInstance Win32_VideoController -ErrorAction Stop | Select-Object -ExpandProperty Name
    return [bool]($names | Where-Object { $_ -match "RTX 50\d0" })
  } catch {
    return $false
  }
}

$WebUiUserBat = Join-Path $ResolvedWebUiDir "webui-user.bat"
$batContent = Get-Content $WebUiUserBat -Raw

$IsBlackwellGpu = Test-BlackwellGpu
if ($IsBlackwellGpu) {
  Write-Info "GPU RTX 50xx (Blackwell) detecte -- le PyTorch installe par defaut par ce webui n'a pas de noyaux compiles pour cette architecture et plante a la premiere generation d'image."
  $torchLine = "set TORCH_COMMAND=pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128"
  if ($batContent -match "(?m)^set TORCH_COMMAND=[^\r\n]*cu128") {
    Write-Ok "TORCH_COMMAND est deja configure pour cu128 (compatible Blackwell)."
  } elseif ($batContent -match "(?m)^set TORCH_COMMAND=[^\r\n]*") {
    $batContent = $batContent -replace "(?m)^set TORCH_COMMAND=[^\r\n]*", $torchLine
    Set-Content -Path $WebUiUserBat -Value $batContent -Encoding ASCII
    Write-Ok "TORCH_COMMAND remplace par la version compatible cu128."
  } else {
    Add-Content -Path $WebUiUserBat -Value "`r`n$torchLine" -Encoding ASCII
    $batContent = Get-Content $WebUiUserBat -Raw
    Write-Ok "TORCH_COMMAND (cu128) ajoute a webui-user.bat."
  }
  Write-Info "Si le venv existant (dossier 'venv') a deja installe l'ancien torch, supprimez ce dossier avant de relancer pour forcer sa reinstallation."
} else {
  Write-Ok "Pas de GPU Blackwell (RTX 50xx) detecte -- aucun changement necessaire."
}

# ---------------------------------------------------------------------------
# 6. Pre-install CLIP into the venv myself, working around a real,
#    reproduced-twice failure: setuptools 82.0 (Feb 2026) deleted
#    pkg_resources entirely, and OpenAI's CLIP package -- an unpinned
#    git-based dependency this webui installs into every fresh venv --
#    still imports it in its legacy setup.py. pip's isolated build
#    environment always grabs the newest setuptools regardless of what's
#    installed elsewhere, so CLIP's build fails with "ModuleNotFoundError:
#    No module named 'pkg_resources'" on any fresh install done today,
#    independent of GPU.
#
#    PIP_CONSTRAINT (this step's previous approach) turned out NOT to
#    apply here -- confirmed both by the identical failure on a real
#    re-run and by pip's own changelog: constraints files (including
#    PIP_CONSTRAINT) no longer affect isolated build environments as of a
#    recent pip version; PIP_BUILD_CONSTRAINT is the replacement, but
#    isn't guaranteed present in whatever pip version this venv's Python
#    bootstrapped. The combination below is what's actually confirmed
#    working in AUTOMATIC1111's own GitHub issues for this exact error:
#    pin an older setuptools IN the venv, then install CLIP with
#    --no-build-isolation so pip reuses that already-installed setuptools
#    instead of creating a fresh isolated env with the newest one. Doing
#    this ourselves, before webui-user.bat's own install step runs, means
#    that step finds CLIP already importable and skips reinstalling it.
#
#    Placed before -SkipLaunch's early exit further down (unlike an earlier
#    version of this fix) -- this is genuinely part of "setting everything
#    up", not something that should be skipped along with the actual launch.
# ---------------------------------------------------------------------------

Write-Step "Pre-installation de CLIP (contourne un bug reel de compatibilite setuptools)"

# AUTOMATIC1111 supports pointing its venv elsewhere via a VENV_DIR line in
# webui-user.bat (a real, plausible setting on exactly the kind of
# already-existing, already-customized install this script is built to
# auto-detect) -- confirmed as a real gap by an independent review:
# assuming the default "venv" subfolder unconditionally would create and
# patch a second, unused venv while the install's real one keeps failing.
$VenvDir = Join-Path $ResolvedWebUiDir "venv"
$venvDirMatch = [regex]::Match($batContent, '(?m)^set VENV_DIR=([^\r\n]+)')
if ($venvDirMatch.Success -and $venvDirMatch.Groups[1].Value.Trim() -and $venvDirMatch.Groups[1].Value.Trim() -ne "-") {
  # AUTOMATIC1111 resolves a relative VENV_DIR against webui-user.bat's own
  # folder, not against wherever this script happens to be running from.
  $customVenvDir = $venvDirMatch.Groups[1].Value.Trim()
  $VenvDir = if ([System.IO.Path]::IsPathRooted($customVenvDir)) { $customVenvDir } else { Join-Path $ResolvedWebUiDir $customVenvDir }
  Write-Info "VENV_DIR personnalise detecte dans webui-user.bat : $VenvDir"
}
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
  Write-Info "Pas encore de venv -- creation..."
  # Wrapped in Invoke-NativeQuiet not for stderr (none redirected here) but
  # for the PowerShell 7.3+ exit-code-promotion trap that helper's own
  # comment describes -- and $LASTEXITCODE is now actually checked here
  # too, instead of only relying on the Test-Path fallback message below to
  # notice indirectly.
  Invoke-NativeQuiet { if ($PythonLauncher -eq "py -3.10") { & py -3.10 -m venv $VenvDir } else { & python -m venv $VenvDir } }
  if ($LASTEXITCODE -ne 0) {
    Write-Info "La creation du venv a echoue (code $LASTEXITCODE) -- ce correctif sera tente par le webui lui-meme au lancement."
  }
}

# Capturing full output (merged via 2>&1, not discarded via 2>$null) so a
# failure here shows the REAL pip error immediately instead of a black box
# that only says "failed, hoping the webui's own attempt does better" --
# confirmed necessary for real: an earlier version of this step silently
# swallowed a failure here, giving no way to tell why without a separate
# round-trip. Also written to its own log file for the same reason
# automatic1111.log/.err.log exist -- something to paste back if this ever
# needs diagnosing again.
$ClipInstallLogPath = Join-Path $WorkDir "clip-preinstall.log"
function Write-ClipInstallLog($lines) {
  $lines | ForEach-Object { "$_" } | Set-Content -Path $ClipInstallLogPath -Encoding UTF8
}

if (Test-Path $VenvPython) {
  Invoke-NativeQuiet { & $VenvPython -c "import clip" 2>$null }
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "CLIP est deja installe dans le venv."
  } else {
    Write-Info "Fixation de setuptools a une version compatible (69.5.1) dans le venv..."
    # wheel too, not just setuptools -- confirmed as a real, distinct
    # second failure once the pkg_resources one was actually fixed:
    # --no-build-isolation skips pip's normal isolated build environment,
    # which is what would otherwise provide "wheel" (and its bdist_wheel
    # setuptools command) automatically. Without it already present in
    # this venv, CLIP's build fails with "error: invalid command
    # 'bdist_wheel'" -- a different, well-documented error, not a sign the
    # setuptools pin itself failed (confirmed: it was actually a
    # DeprecationWarning about pkg_resources this time, not the
    # ModuleNotFoundError from before -- the original fix did work).
    $setuptoolsOutput = Invoke-NativeQuiet { & $VenvPython -m pip install "setuptools==69.5.1" wheel 2>&1 }
    if ($LASTEXITCODE -ne 0) {
      Write-Fail "Impossible de fixer setuptools==69.5.1/wheel -- la suite de cette etape va probablement aussi echouer. Detail :"
      Write-ClipInstallLog $setuptoolsOutput
      $setuptoolsOutput | Select-Object -Last 15 | ForEach-Object { Write-Host "    $_" }
      Write-Info "Journal complet : $ClipInstallLogPath"
    }

    # Read the exact URL AUTOMATIC1111 itself would install, straight from
    # its own launch_utils.py, so this keeps working if that pinned commit
    # ever changes -- falls back to the last-known-good URL (the one seen
    # failing in a real log) only if that file's shape changed too much to
    # find it automatically.
    $ClipPackageUrl = "https://github.com/openai/CLIP/archive/d50d76daa670286dd6cacf3bcd80b5e4823fc8e1.zip"
    $LaunchUtilsPath = Join-Path $ResolvedWebUiDir "modules\launch_utils.py"
    if (Test-Path $LaunchUtilsPath) {
      $launchUtilsContent = Get-Content $LaunchUtilsPath -Raw
      $urlMatch = [regex]::Match($launchUtilsContent, "https://github\.com/openai/CLIP/archive/[a-f0-9]+\.zip")
      if ($urlMatch.Success) { $ClipPackageUrl = $urlMatch.Value }
    }

    Write-Info "Installation de CLIP avec --no-build-isolation..."
    $clipOutput = Invoke-NativeQuiet { & $VenvPython -m pip install $ClipPackageUrl --no-build-isolation --prefer-binary 2>&1 }
    Write-ClipInstallLog $clipOutput
    if ($LASTEXITCODE -eq 0) {
      # pip succeeding doesn't guarantee the module is actually importable
      # (a stale build, a partial install) -- confirmed worth checking for
      # real: this is exactly what happened once already, silently, with no
      # way to tell without this recheck.
      Invoke-NativeQuiet { & $VenvPython -c "import clip" 2>$null }
      if ($LASTEXITCODE -eq 0) {
        Write-Ok "CLIP installe avec succes."
      } else {
        Write-Fail "pip a rapporte un succes mais 'import clip' echoue toujours -- inattendu. Journal : $ClipInstallLogPath"
      }
    } else {
      Write-Fail "Echec de la pre-installation de CLIP -- le lancement plus bas tentera quand meme (et echouera probablement pareil). Dernieres lignes :"
      $clipOutput | Select-Object -Last 15 | ForEach-Object { Write-Host "    $_" }
      Write-Info "Journal complet : $ClipInstallLogPath"
    }
  }
} else {
  Write-Info "Venv introuvable meme apres tentative de creation -- ce correctif sera tente par le webui lui-meme au lancement."
}

# ---------------------------------------------------------------------------
# 6b. Verify the ALREADY-INSTALLED torch (if any) actually has Blackwell
#     kernels -- confirmed as a real, distinct gap from Step 5 above: on an
#     existing venv from before this script's cu128 fix existed (or from any
#     other install path), webui-user.bat's TORCH_COMMAND is only ever
#     consulted by AUTOMATIC1111 itself when it thinks torch isn't installed
#     yet -- it never re-checks or upgrades an already-importable torch, so
#     Step 5's edit silently does nothing for that case. Confirmed for real
#     on a live install: server started fine, --api responded fine, and the
#     first actual image generation failed with "CUDA error: no kernel image
#     is available for execution on the device" -- exactly this scenario.
#     Rather than guess from version strings (fragile -- cu128 wheels could
#     themselves someday drop sm_120, or a future architecture could need a
#     newer index), this actually runs a GPU op and looks for that exact
#     failure signature, then force-reinstalls only if it reproduces.
#
#     A first version of this check used torch.zeros(1)+1 -- confirmed too
#     weak for real: it kept reporting success on a venv whose actual image
#     generation still failed with the identical CUDA error afterwards, run
#     after run. Root cause traced to timing: AUTOMATIC1111 has typically
#     been running continuously across this whole session (confirmed by
#     "server responds on port 7860" showing up on essentially every run),
#     so the FIRST time this script's reinstall ran, that live process very
#     likely still had torch's own .dll files loaded/locked -- Windows can't
#     overwrite a loaded DLL out from under a running process, so pip's
#     --force-reinstall silently kept some of the old, non-Blackwell files
#     in place while replacing others. zeros()+1 resolves to one of the
#     simplest possible kernels and kept passing on that inconsistent mix;
#     Stable Diffusion's real convolution/attention kernels did not. Two
#     fixes together: (a) stop any already-running instance of THIS install
#     before touching its venv at all, so a reinstall can never again race a
#     live process for the same files; (b) verify with an actual
#     convolution in half precision -- much closer to what Stable Diffusion
#     itself runs -- plus torch.cuda.synchronize(), since CUDA errors can be
#     reported asynchronously on a LATER call rather than the one that
#     actually caused them (torch's own error message says so directly).
# ---------------------------------------------------------------------------

if ($IsBlackwellGpu -and (Test-Path $VenvPython)) {
  Write-Step "Verification que le PyTorch installe fonctionne reellement sur ce GPU Blackwell"

  $torchCheckScript = "import torch; import torch.nn.functional as F; x = torch.randn(1, 3, 8, 8, device='cuda', dtype=torch.float16); w = torch.randn(4, 3, 3, 3, device='cuda', dtype=torch.float16); y = F.conv2d(x, w, padding=1); torch.cuda.synchronize(); print('CONV_OK', float(y.sum().item()))"

  $torchCheckOutput = Invoke-NativeQuiet { & $VenvPython -c $torchCheckScript 2>&1 }
  $torchCheckOk = ($LASTEXITCODE -eq 0) -and (($torchCheckOutput -join "`n") -match "CONV_OK")

  if ($torchCheckOk) {
    Write-Ok "PyTorch fonctionne correctement sur ce GPU (convolution CUDA reelle reussie)."
  } else {
    $torchCheckText = $torchCheckOutput -join "`n"
    if ($torchCheckText -match "no kernel image is available") {
      Write-Fail "Confirme : le PyTorch deja installe dans ce venv n'a pas de noyaux compiles pour ce GPU (meme erreur qu'a la premiere generation d'image reelle)."
    } else {
      Write-Fail "Le test PyTorch/CUDA a echoue pour une raison differente -- reinstallation quand meme tentee au cas ou. Detail :"
      $torchCheckOutput | Select-Object -Last 10 | ForEach-Object { Write-Host "    $_" }
    }

    # Stop any live process from THIS install before touching its venv --
    # otherwise a reinstall can silently leave a locked-file mix behind
    # exactly as described above, passing a weak check while real
    # generation keeps failing.
    $preReinstallPids = Get-A1111ProcessIds -Dir $ResolvedWebUiDir -Port $SdPort
    if ($preReinstallPids.Count -gt 0) {
      Write-Info "AUTOMATIC1111 tourne encore -- arret avant de toucher a son venv (sinon la reinstallation peut echouer partiellement en silence sur des fichiers verrouilles)."
      Stop-A1111ProcessIds -ProcessIds $preReinstallPids | Out-Null
      Start-Sleep -Milliseconds 500
    }

    Write-Info "Reinstallation de torch/torchvision/torchaudio depuis l'index cu128 (peut prendre plusieurs minutes, gros telechargement)..."
    # --no-cache-dir too: guarantees a genuinely fresh download/extract
    # instead of possibly reusing a wheel pip cached during an earlier,
    # partially-failed attempt.
    $torchReinstallOutput = Invoke-NativeQuiet {
      & $VenvPython -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128 --force-reinstall --no-cache-dir 2>&1
    }
    if ($LASTEXITCODE -ne 0) {
      Write-Fail "La reinstallation de torch a echoue. Dernieres lignes :"
      $torchReinstallOutput | Select-Object -Last 15 | ForEach-Object { Write-Host "    $_" }
    } else {
      $recheckOutput = Invoke-NativeQuiet { & $VenvPython -c $torchCheckScript 2>&1 }
      if ($LASTEXITCODE -eq 0 -and (($recheckOutput -join "`n") -match "CONV_OK")) {
        Write-Ok "PyTorch reinstalle (cu128) et verifie fonctionnel sur ce GPU (convolution CUDA reelle)."
      } else {
        Write-Fail "PyTorch reinstalle mais le test CUDA echoue encore -- signalez ceci, ce n'est plus le cas connu couvert par ce script."
        ($recheckOutput | Select-Object -Last 10) | ForEach-Object { Write-Host "    $_" }
      }
    }
  }
}

# ---------------------------------------------------------------------------
# 7. Make sure --api is enabled (idempotent: never adds it twice)
# ---------------------------------------------------------------------------

Write-Step "Activation du flag --api"

# (?!\S) after --api, not a bare substring match: without it, an existing
# "--api-log" or "--api-auth" (both real AUTOMATIC1111 flags) would match
# "--api" as a substring and be mistaken for the flag already being active
# -- confirmed as a real gap by an independent review of this script, not
# assumed. (?!\S) requires --api to be followed by whitespace or end of
# line, not immediately by another non-space character.
if ($batContent -match "(?m)^set COMMANDLINE_ARGS=[^\r\n]*--api(?!\S)") {
  Write-Ok "--api est deja active dans webui-user.bat."
} elseif ($batContent -match "(?m)^set COMMANDLINE_ARGS=([^\r\n]*)") {
  # [^\r\n]* instead of .* -- avoids swallowing the line's trailing \r into
  # the match (regex $ matches before \n, not \r), which would otherwise
  # leave this one line LF-only in an otherwise CRLF batch file.
  $existingArgs = $Matches[1].Trim()
  $newArgs = if ($existingArgs) { "$existingArgs --api" } else { "--api" }
  $batContent = $batContent -replace "(?m)^set COMMANDLINE_ARGS=[^\r\n]*", "set COMMANDLINE_ARGS=$newArgs"
  Set-Content -Path $WebUiUserBat -Value $batContent -Encoding ASCII
  Write-Ok "--api ajoute a la ligne COMMANDLINE_ARGS existante."
} else {
  Add-Content -Path $WebUiUserBat -Value "`r`nset COMMANDLINE_ARGS=--api" -Encoding ASCII
  $batContent = Get-Content $WebUiUserBat -Raw
  Write-Ok "Ligne COMMANDLINE_ARGS=--api ajoutee (absente du fichier d'origine)."
}

# Keeps AUTOMATIC1111's actual listening port in sync with -SdPort, which
# this script polls below (and which setup-ollama-bridge.ps1 is told to
# match) -- confirmed missing entirely by an independent review: -SdPort
# was documented and polled but never actually written into
# COMMANDLINE_ARGS, so passing a non-default -SdPort silently produced a
# guaranteed 15-minute false "not responding" timeout while AUTOMATIC1111
# kept listening on its own real default (7860) the whole time. Always
# ensured (even at the default 7860) rather than only when non-default, so
# there's exactly one code path instead of two.
$portMatch = [regex]::Match($batContent, "(?m)^set COMMANDLINE_ARGS=[^\r\n]*--port\s+(\d+)")
if ($portMatch.Success -and $portMatch.Groups[1].Value -eq "$SdPort") {
  Write-Ok "--port $SdPort deja configure dans webui-user.bat."
} elseif ($portMatch.Success) {
  # Anchored to the COMMANDLINE_ARGS line specifically (like every other
  # replace in this file), not a bare "--port\s+\d+" -- confirmed as a real
  # gap by this review: an unanchored replace would also rewrite an
  # unrelated "--port 1234" if one ever appeared in this file's own rem
  # comments (AUTOMATIC1111's template documents several example args this
  # way), silently corrupting the wrong line.
  $batContent = $batContent -replace "(?m)(^set COMMANDLINE_ARGS=[^\r\n]*--port\s+)\d+", "`${1}$SdPort"
  Set-Content -Path $WebUiUserBat -Value $batContent -Encoding ASCII
  Write-Ok "--port mis a jour a $SdPort dans webui-user.bat."
} elseif ($batContent -match "(?m)^set COMMANDLINE_ARGS=([^\r\n]*)") {
  $existingArgs = $Matches[1].TrimEnd()
  $newArgs = "$existingArgs --port $SdPort"
  $batContent = $batContent -replace "(?m)^set COMMANDLINE_ARGS=[^\r\n]*", "set COMMANDLINE_ARGS=$newArgs"
  Set-Content -Path $WebUiUserBat -Value $batContent -Encoding ASCII
  Write-Ok "--port $SdPort ajoute a webui-user.bat."
}

if ($SkipLaunch) {
  Write-Step "Termine (-SkipLaunch)"
  Write-Host "    Tout est pret dans $ResolvedWebUiDir -- lancez webui-user.bat vous-meme quand vous voulez."
  exit 0
}

# ---------------------------------------------------------------------------
# 8. Launch and wait for the API to actually answer -- the first run
#    installs several GB of dependencies, so this is patient on purpose.
# ---------------------------------------------------------------------------

Write-Step "Lancement d'AUTOMATIC1111 (premier lancement = installation des dependances, soyez patient)"

# A previous run that hung (e.g. stuck on the "pause" prompt fixed above,
# from before this script redirected stdin) leaves its process alive on a
# re-run, still holding the log files open -- Remove-Item below would then
# fail with "used by another process" and abort the whole script, exactly
# as happened for real.
#
# Tracking a single PID (an earlier version of this fix) isn't enough:
# Start-Process -FilePath <webui-user.bat> returns cmd.exe's own PID, but
# cmd.exe runs python.exe as a child, and Stop-Process on a parent does NOT
# terminate its children on Windows -- the actual log-file handle is held
# by that orphaned python.exe, which would survive untouched. So instead of
# trusting one stored PID, this uses Get-A1111ProcessIds (command-line match
# AND a port-7860 listener lookup combined -- see that function's own
# comment: confirmed for real that Get-CimInstance's CommandLine can come
# back empty for a genuinely running process, which silently defeated the
# command-line-only version of this check before).
$leftoverPids = Get-A1111ProcessIds -Dir $ResolvedWebUiDir -Port $SdPort
if ($leftoverPids.Count -gt 0) {
  Write-Info "Processus d'une execution precedente encore actif -- arret avant de relancer."
  Stop-A1111ProcessIds -ProcessIds $leftoverPids | Out-Null
  Start-Sleep -Milliseconds 500
}

# Even after the process is confirmed gone, Windows can hold the file handle
# open for a brief moment longer (antivirus scan, delayed handle release) --
# retried a few times instead of failing on the very first attempt.
$logCleanupError = $null
for ($tryNum = 1; $tryNum -le 6; $tryNum++) {
  try {
    if (Test-Path $WebUiLogPath) { Remove-Item $WebUiLogPath -Force -ErrorAction Stop }
    if (Test-Path $WebUiErrLogPath) { Remove-Item $WebUiErrLogPath -Force -ErrorAction Stop }
    $logCleanupError = $null
    break
  } catch {
    $logCleanupError = $_
    Start-Sleep -Milliseconds 1000
  }
}
if ($logCleanupError) {
  # Not fatal: confirmed for real that no matching leftover process was even
  # found (nothing to wait out) yet the delete still failed both here and in
  # a completely separate run -- something other than a leftover
  # AUTOMATIC1111 process is holding these files (antivirus, a log viewer,
  # cloud-sync on this folder...), not something this script can identify or
  # force closed. The old content is only ever a convenience for reading
  # after a failure, never something the launch/readiness logic below
  # depends on -- so this only warns and moves on to the actual launch,
  # instead of blocking the whole run over stale log text.
  Write-Fail "Impossible de supprimer les anciens journaux ($($logCleanupError.Exception.Message)) -- poursuite quand meme (l'ancien contenu restera visible en tete de $WebUiLogPath / $WebUiErrLogPath si le lancement echoue plus bas)."
}

# Two separate log files, not one shared by both streams: Start-Process
# refuses -RedirectStandardOutput and -RedirectStandardError pointing at the
# same file (hit and fixed for cloudflared in setup-ollama-bridge.ps1 --
# applied here from the start instead of re-discovering it the hard way).
#
# Redirecting stdin from an empty file matters just as much: webui-user.bat's
# own wrapper calls `pause` when a step fails, to keep a normal double-clicked
# window open so a person can read the error before it closes. Launched
# hidden with no redirected stdin, that pause instead waits forever for a
# keypress on a console window nobody can see or reach -- confirmed for
# real: a run that hit the pkg_resources failure above sat "still running"
# for 15+ minutes with no further progress, not because anything was slow,
# but because it was silently stuck at that prompt the whole time.
#
# -RedirectStandardInput "NUL" (the usual cmd.exe trick for this) does NOT
# work here -- also confirmed for real: PowerShell's Start-Process resolves
# "NUL" as a literal relative filename ("<workdir>\NUL") instead of the
# special device, and fails outright ("FileNotFoundException"). An actual
# empty file gives the same immediate-EOF result pause needs, without
# depending on that device-name resolution quirk.
if (-not (Test-Path $WebUiStdinPath)) { New-Item -ItemType File -Path $WebUiStdinPath -Force | Out-Null }
try {
  $webuiProcess = Start-Process -FilePath $WebUiUserBat -WorkingDirectory $ResolvedWebUiDir `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $WebUiLogPath -RedirectStandardError $WebUiErrLogPath -RedirectStandardInput $WebUiStdinPath
} catch {
  Write-Fail "Impossible de demarrer AUTOMATIC1111 -- $($_.Exception.Message)"
  if ($_.Exception.Message -match "used by another process|being used") {
    Write-Info "Un processus tient encore $WebUiLogPath ou $WebUiErrLogPath ouvert -- fermez-le (Gestionnaire des taches :"
    Write-Info "cherchez un python.exe/cmd.exe lance depuis $ResolvedWebUiDir, mais aussi un editeur de texte,"
    Write-Info "un outil de sauvegarde/synchronisation, ou un antivirus qui l'inspecterait) puis relancez."
  }
  exit 1
}

Write-Info "Processus demarre (PID $($webuiProcess.Id)). Journal : $WebUiLogPath"
Write-Info "Cela peut prendre 10 a 15 minutes la toute premiere fois (telechargement de PyTorch et des dependances)."

$maxTries = 180  # 180 x 5s = 15 minutes
$tries = 0
$ready = $false
while ($tries -lt $maxTries) {
  Start-Sleep -Seconds 5
  $tries++
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$SdPort/sdapi/v1/sd-models" -TimeoutSec 3 | Out-Null
    $ready = $true
    break
  } catch {}
  if ($webuiProcess.HasExited) {
    Write-Fail "Le processus s'est arrete de lui-meme (code $($webuiProcess.ExitCode)). Regardez $WebUiErrLogPath pour le detail."
    exit 1
  }
  if ($tries % 12 -eq 0) {
    Write-Info "... toujours en attente ($($tries * 5)s ecoulees) -- consultez $WebUiLogPath si ca semble bloque"
  }
}

if (-not $ready) {
  Write-Fail "L'API ne repond toujours pas apres 15 minutes. Regardez $WebUiLogPath et $WebUiErrLogPath pour voir ou ca bloque -- le processus (PID $($webuiProcess.Id)) reste lance, il continuera peut-etre de son cote."
  exit 1
}

Write-Ok "AUTOMATIC1111 repond sur http://127.0.0.1:$SdPort avec --api actif."
Write-Host ""
Write-Host "    Prochaine etape : relancez setup-ollama-bridge.ps1 -- il detectera" -ForegroundColor Cyan
Write-Host "    ce serveur et poussera son adresse dans les reglages de Trame" -ForegroundColor Cyan
Write-Host "    (Images -> IA locale / Stable Diffusion)." -ForegroundColor Cyan
