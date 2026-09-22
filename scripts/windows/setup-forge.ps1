<#
.SYNOPSIS
  Installs and starts Forge (stable-diffusion-webui-forge) for Trame's
  local image generation, with four checkpoints side by side: the two
  existing SDXL profiles (illustration/photorealistic) plus Flux.1 dev
  ("Safe") and a Flux dev NSFW fine-tune of your choice ("Fluxed Up" or
  similar).

.DESCRIPTION
  Supersedes setup-automatic1111.ps1: AUTOMATIC1111 has no Flux support at
  all, so this targets lllyasviel/stable-diffusion-webui-forge instead --
  same webui-user.bat/COMMANDLINE_ARGS conventions, same --api flag, same
  documented /sdapi/v1/* REST surface (confirmed: Forge was built from day
  one to stay a drop-in replacement for AUTOMATIC1111's API), so
  providers/imageProviders.js needs no changes for anything running on this
  instance -- override_settings.sd_model_checkpoint keeps switching between
  checkpoints exactly like it already does today.

  What it does, in order:
    1. Python 3.10 + Git (same as setup-automatic1111.ps1).
    2. Finds an existing Forge install or clones one fresh -- deliberately
       does NOT reuse an AUTOMATIC1111 folder even if one is auto-detected
       elsewhere on this PC: Forge is a separate codebase/venv, not a mode
       switch inside A1111.
    3. Finds or downloads FOUR checkpoints into the same models folder:
       NoobAI-XL and RealVisXL (identical to before -- copy them over from
       an existing AUTOMATIC1111 install with -CopyModelsFrom instead of
       re-downloading multiple GB you already have), Flux.1-dev FP8
       all-in-one ("Safe"), and -- if you pass -FluxedUpUrl -- an NSFW Flux
       dev fine-tune of your choice. That last one is NOT auto-downloaded:
       it lives behind a Civitai login/age-gate that can't be scripted, see
       .NOTES.
    4. Same Blackwell/RTX 50xx PyTorch check as setup-automatic1111.ps1 --
       confirmed via real, still-open GitHub issues on Forge's own tracker
       (#2601 "It doesn't work with the RTX5080", #2746 "Run with RTX50xx")
       that Forge ships an even older default PyTorch (2.3/2.4, cu121/cu124)
       than AUTOMATIC1111 did, so this is if anything MORE necessary here,
       not less.
    5. Same CLIP/setuptools pre-install as setup-automatic1111.ps1, kept as
       a defensive measure -- see .NOTES for the one honest caveat on this.
    6. Enables --api and pins the port, idempotently.
    7. Launches and waits for the API to actually answer.

.NOTES
  - Two fixes carried over verbatim from setup-automatic1111.ps1 (the
    Stability-AI mirror redirect, the CLIP/setuptools pin) were confirmed
    against AUTOMATIC1111's own launch_utils.py specifically, not Forge's --
    Forge is a real fork that diverged years ago and may already handle
    either issue differently (or not have it at all). Both are kept here
    anyway because they're cheap and harmless if unneeded (an unused env
    var, an already-satisfied pip pin) -- but if you hit a CLIP or
    Stable-Diffusion-repo error that looks unrelated to what's documented
    below, that's the first place assumptions could be wrong. Report it back.
  - This script has not been run on a real Windows machine by the assistant
    that wrote it -- built from Forge's documented behavior and real GitHub
    issues, not guessed. Please report back anything that errors.
  - Local image generation stays best-effort throughout Trame: a failure
    here never blocks anything else.
  - Chroma is NOT handled by this script at all -- it needs a different,
    Chroma-patched fork of Forge (mainline Forge has no native Chroma
    support as of this writing) and a 3-file model layout (checkpoint + VAE
    + text encoder) instead of a single checkpoint file. See
    setup-forge-chroma.ps1, a separate script for a separate, dedicated
    instance on its own port.
  - Fluxed Up (or whichever NSFW Flux fine-tune you pick) lives on Civitai,
    which requires a logged-in account to download ANY file from a model
    marked mature -- there is no way to script around that login itself,
    same reasoning as Tailscale's browser-based login elsewhere in this
    project. Get a download link two ways:
      a) Simplest: log into civitai.com in a browser, open the model page,
         right-click the "Download" button for the format you want (FP8
         recommended, to match Flux Safe's quantization) and copy the link
         address. Pass it as -FluxedUpUrl "<that link>".
      b) Scriptable next time: create an API key at
         https://civitai.com/user/account, then build a URL of the form
         https://civitai.com/api/download/models/<versionId>?token=<your key>
         (find <versionId> on the model version's page) and pass THAT as
         -FluxedUpUrl -- this one keeps working across re-runs without
         needing to copy a fresh link by hand each time.
    Either way, if the URL you pass turns out to require a login this
    script doesn't have, the existing "downloaded file suspiciously small"
    check (this script would otherwise save an HTML login page under a
    .safetensors name) catches it and tells you clearly instead of leaving
    a corrupt file behind.

.PARAMETER WebUiDir
  Skip auto-detection and use this exact Forge folder (must contain
  webui-user.bat).

.PARAMETER CopyModelsFrom
  Optional path to an existing AUTOMATIC1111 (or other webui) models folder
  to copy NoobAI-XL/RealVisXL/any other checkpoint from, instead of
  re-downloading multiple GB you already have on disk. Typically
  "<your A1111 folder>\models\Stable-diffusion".

.PARAMETER FluxedUpUrl
  Direct download URL for your chosen NSFW Flux fine-tune (e.g. Fluxed Up).
  Not auto-discovered -- see .NOTES for how to get one. Omit to skip this
  fourth model for now; the other three still install normally.

.PARAMETER FluxedUpLabel
  Optional short suffix appended to the downloaded NSFW Flux file's name,
  e.g. "hq-lent-fp16". Purely cosmetic -- Trame's model dropdown shows
  whatever filename sits on disk with no separate metadata field, so this
  is the only way to flag something about a specific choice (quality,
  speed, quantization) directly where it gets picked in the app. Example:
  a filename ending up as "msFluxSfwnsfwV3.safetensors" with
  -FluxedUpLabel "hq-lent-fp16" is saved as
  "msFluxSfwnsfwV3-hq-lent-fp16.safetensors".

.PARAMETER ModelUrl
  Optional direct download URL for one more checkpoint beyond the four
  above.

.PARAMETER SdPort
  Port this Forge instance's API listens on. Defaults to 7860, matching
  every other script/setting in this project that assumes the "main" local
  image instance lives there. Keep setup-ollama-bridge.ps1's -SdPort and
  Trame's Settings in sync with this if you ever change it.

.PARAMETER NoAutoModel
  Skip downloading Flux Safe (and NoobAI-XL/RealVisXL if not already
  present) -- only moves in whatever -CopyModelsFrom / Downloads / Desktop
  already provide. Fluxed Up is never "auto" regardless of this switch (see
  -FluxedUpUrl).

.PARAMETER SkipLaunch
  Set everything up but don't start the WebUI -- use this if you'd rather
  launch it yourself.
#>

[CmdletBinding()]
param(
  [string]$WebUiDir = "",
  [string]$CopyModelsFrom = "",
  [string]$FluxedUpUrl = "",
  [string]$FluxedUpLabel = "",
  [string]$ModelUrl = "",
  [int]$SdPort = 7860,
  [switch]$NoAutoModel,
  [switch]$SkipLaunch
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Setup / paths -- same shared work folder as the other scripts here.
# ---------------------------------------------------------------------------

$WorkDir       = Join-Path $env:USERPROFILE "TrameOllamaBridge"
$ConfigPath    = Join-Path $WorkDir "forge-config.json"
$DefaultCloneParent = $env:USERPROFILE
$WebUiLogPath  = Join-Path $WorkDir "forge.log"
$WebUiErrLogPath = Join-Path $WorkDir "forge.err.log"
$WebUiStdinPath = Join-Path $WorkDir "forge-stdin.empty"

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

# See setup-automatic1111.ps1's identical function for the full two-trap
# explanation (WinPS 5.1 stderr-capture-as-error, PS 7.3+ exit-code
# promotion) -- copied verbatim, the underlying PowerShell behavior this
# guards against has nothing to do with which webui is being scripted.
function Invoke-NativeQuiet {
  param([Parameter(Mandatory)][scriptblock]$ScriptBlock)
  $prevErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $ScriptBlock } finally { $ErrorActionPreference = $prevErrorActionPreference }
}

# Same two-signal approach as setup-automatic1111.ps1's Get-A1111ProcessIds
# (CommandLine match -- can silently come back empty across a privilege
# boundary, confirmed for real earlier in this project -- combined with a
# port-listener lookup that doesn't depend on reading any process's command
# line at all). Kept as its own copy rather than a shared module: these
# scripts are meant to be copied/read independently, not to depend on each
# other beyond what start-trame.ps1 already orchestrates.
function Get-WebUiProcessIds {
  param([string]$Dir, [int]$Port)
  $pidsFound = New-Object System.Collections.Generic.HashSet[int]
  if ($Dir) {
    # BUG FOUND ON A REAL RUN (setup-forge-chroma.ps1's identical copy of
    # this function): without excluding $PID, this can match the CURRENT
    # process's own command line when -WebUiDir is passed explicitly (its
    # literal text is part of this very process's CommandLine as seen by
    # WMI) -- Stop-WebUiProcessIds would then kill the script running RIGHT
    # NOW, silently. See CHANGELOG.md.
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine -like "*$Dir*") } |
      ForEach-Object { [void]$pidsFound.Add($_.ProcessId) }
  }
  try {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { [void]$pidsFound.Add([int]$_.OwningProcess) }
  } catch {}
  return @($pidsFound)
}

function Stop-WebUiProcessIds {
  param([int[]]$ProcessIds)
  if (-not $ProcessIds -or $ProcessIds.Count -eq 0) { return $false }
  foreach ($procId in $ProcessIds) {
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
      Write-Info "Arret d'un processus Forge (PID $procId)..."
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

function Get-ForgeConfig {
  if (Test-Path $ConfigPath) {
    try { return Get-Content $ConfigPath -Raw | ConvertFrom-Json } catch {}
  }
  return [pscustomobject]@{ webuiDir = $null }
}
function Save-ForgeConfig($cfg) {
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
# 2. Find (or clone) Forge
# ---------------------------------------------------------------------------

Write-Step "Recherche d'une installation Forge existante"

function Find-ExistingForge {
  $searchRoots = @(
    $env:USERPROFILE,
    (Join-Path $env:USERPROFILE "Desktop"),
    (Join-Path $env:USERPROFILE "Downloads"),
    (Join-Path $env:USERPROFILE "Documents")
  ) | Where-Object { Test-Path $_ } | Select-Object -Unique

  foreach ($root in $searchRoots) {
    # Forge's own repo folder is normally named "stable-diffusion-webui-forge"
    # -- filtered on that in addition to the bare webui-user.bat filename, so
    # this doesn't accidentally pick up an unrelated AUTOMATIC1111 install
    # that happens to sit in the same search tree.
    $found = Get-ChildItem -Path $root -Filter "webui-user.bat" -Recurse -Depth 3 -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Directory.FullName -match "forge" } | Select-Object -First 1
    if ($found) { return $found.Directory.FullName }
  }
  return $null
}

$cfg = Get-ForgeConfig
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
  $detected = Find-ExistingForge
  if ($detected) {
    $ResolvedWebUiDir = $detected
    Write-Ok "Installation existante trouvee : $ResolvedWebUiDir"
  } else {
    Write-Info "Aucune installation existante trouvee -- clonage d'une nouvelle copie."
    $cloneTarget = Join-Path $DefaultCloneParent "stable-diffusion-webui-forge"
    if (Test-Path $cloneTarget) {
      Write-Fail "$cloneTarget existe deja mais ne contient pas de webui-user.bat valide -- renommez ou supprimez ce dossier, puis relancez ce script."
      exit 1
    }
    Invoke-NativeQuiet { & git clone --depth 1 https://github.com/lllyasviel/stable-diffusion-webui-forge.git $cloneTarget }
    if ($LASTEXITCODE -ne 0) {
      Write-Fail "Le clonage a echoue (voir le detail ci-dessus). Verifiez votre connexion internet et relancez ce script."
      exit 1
    }
    $ResolvedWebUiDir = $cloneTarget
    Write-Ok "Clone dans $ResolvedWebUiDir."
  }
}

$cfg.webuiDir = $ResolvedWebUiDir
Save-ForgeConfig $cfg

$ModelsDir = Join-Path $ResolvedWebUiDir "models\Stable-diffusion"
New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

# ---------------------------------------------------------------------------
# 3. Find (or fetch) checkpoints -- four profiles side by side: the two
#    existing SDXL ones (illustration/photorealistic), Flux Safe, and
#    (opt-in only, see -FluxedUpUrl) a Flux NSFW fine-tune.
# ---------------------------------------------------------------------------

Write-Step "Verification des modeles Stable Diffusion / Flux"

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

if ($CopyModelsFrom) {
  if (-not (Test-Path $CopyModelsFrom)) {
    Write-Fail "-CopyModelsFrom ($CopyModelsFrom) est introuvable -- ignore."
  } else {
    Write-Info "Copie des modeles depuis $CopyModelsFrom..."
    Get-ChildItem -Path $CopyModelsFrom -Include "*.safetensors","*.ckpt" -File -ErrorAction SilentlyContinue | ForEach-Object {
      $dest = Join-Path $ModelsDir $_.Name
      if (-not (Test-Path $dest)) {
        Copy-Item -Path $_.FullName -Destination $dest
        Write-Ok "Copie : $($_.Name)"
      }
    }
  }
}

Write-Info "Recherche de modeles supplementaires dans Telechargements et Bureau..."
$candidateRoots = @(
  (Join-Path $env:USERPROFILE "Downloads"),
  (Join-Path $env:USERPROFILE "Desktop")
) | Where-Object { Test-Path $_ }
$candidates = @()
# BUG FOUND ON A REAL RUN: "-Recurse -Depth 1 -Include ..." silently
# IGNORES -Depth in Windows PowerShell 5.1 -- a real, documented cmdlet bug
# (Get-ChildItem's -Depth is only honored without -Include; workaround is
# -Filter, or as here, explicit wildcard path patterns with no -Recurse at
# all). This scanner ended up recursing arbitrarily deep instead of the
# intended "1 level under Downloads/Desktop", sweeping up
# chromaforge\models\vae\ae.safetensors (3 levels down) into this
# instance's own models folder. Explicit depth-0/depth-1 path patterns
# below give the actually-intended scope, with no -Recurse/-Depth to be
# silently ignored.
foreach ($root in $candidateRoots) {
  foreach ($pattern in @("*.safetensors", "*.ckpt")) {
    $candidates += Get-ChildItem -Path (Join-Path $root $pattern) -File -ErrorAction SilentlyContinue
    $candidates += Get-ChildItem -Path (Join-Path $root "*\$pattern") -File -ErrorAction SilentlyContinue
  }
}
foreach ($file in $candidates) {
  $dest = Join-Path $ModelsDir $file.Name
  if (-not (Test-Path $dest)) {
    Move-Item -Path $file.FullName -Destination $dest -Force
    Write-Ok "Deplace vers le dossier des modeles : $($file.Name)"
  }
}

$existingNames = Get-ExistingCheckpointNames $ModelsDir

# The two original SDXL profiles, unchanged from setup-automatic1111.ps1 --
# same files, same reasoning (illustration vs. photorealistic, both
# uncensored). Flux Safe added as a third always-on default; its exact
# filename matters the same way, since that's what gets typed/selected in
# Trame's "Image model" field.
$DefaultModels = @(
  @{ Label = "illustration (NoobAI-XL v1.1, anime/illustration, non censure, ~7.1 Go)"; File = "NoobAI-XL-v1.1.safetensors"; Url = "https://huggingface.co/Laxhar/noobai-XL-1.1/resolve/main/NoobAI-XL-v1.1.safetensors" },
  @{ Label = "photorealiste (RealVisXL V5.0, non censure, ~6.9 Go)"; File = "RealVisXL_V5.0_fp16.safetensors"; Url = "https://huggingface.co/SG161222/RealVisXL_V5.0/resolve/main/RealVisXL_V5.0_fp16.safetensors" },
  # camenduru's all-in-one FP8 repack: a single .safetensors bundling the
  # transformer + VAE + CLIP/T5 text encoders together, so it behaves
  # exactly like any normal SDXL checkpoint through Forge's API (no separate
  # VAE/text-encoder selection needed, unlike Chroma -- see
  # setup-forge-chroma.ps1). Ungated on Hugging Face, no login needed.
  @{ Label = "Flux Safe (Flux.1-dev FP8 all-in-one, ~17.2 Go)"; File = "flux1-dev-fp8-all-in-one.safetensors"; Url = "https://huggingface.co/camenduru/FLUX.1-dev/resolve/main/flux1-dev-fp8-all-in-one.safetensors" }
)

# Resolves the real filename a URL will download as, when the URL path
# itself doesn't already end in a recognizable model extension -- exactly
# what a Civitai download link looks like (an extensionless
# /api/download/models/<id>?token=... URL, the real name only ever
# revealed via a Content-Disposition response header). A plain HEAD request
# reads that same header without pulling the whole multi-GB body first.
#
# Confirmed necessary for real, caught during review rather than by a live
# run: an earlier version of this script only ever resolved that header
# AFTER already downloading the full file, inside the same loop that checks
# "is this already downloaded?" -- meaning that check could only ever
# compare against a guessed placeholder name, never the model's actual
# name. Since this script is meant to be re-run every session (see
# start-trame.ps1), that placeholder mismatch meant Civitai-style
# multi-GB downloads would look "missing" and get fetched again from
# scratch on every single re-run. Resolving the real name up front, before
# deciding what still needs fetching, is what makes the two consistent.
function Resolve-DownloadFileName($url, $fallbackName) {
  $pathName = Split-Path -Leaf ([Uri]$url).LocalPath
  if ($pathName -and $pathName -match "\.(safetensors|ckpt)$") { return $pathName }
  try {
    $headResponse = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -TimeoutSec 15
    $contentDisposition = $headResponse.Headers["Content-Disposition"]
    $nameMatch = if ($contentDisposition) { [regex]::Match($contentDisposition, 'filename\*?=(?:UTF-8[^A-Za-z0-9]*)?"?([^";]+)"?') } else { $null }
    if ($nameMatch -and $nameMatch.Success) { return [System.Uri]::UnescapeDataString($nameMatch.Groups[1].Value) }
  } catch {
    # HEAD isn't guaranteed supported by every host -- falls through to the
    # placeholder below, same as if Content-Disposition were simply absent.
  }
  return $fallbackName
}

# Appends an optional cosmetic suffix (-FluxedUpLabel) right before the
# extension, e.g. "msFluxSfwnsfwV3.safetensors" -> "msFluxSfwnsfwV3-hq-lent-
# fp16.safetensors" -- Trame's model dropdown shows whatever filename is
# on disk with no separate metadata field, so this is the only way to flag
# something about a specific choice (quality, speed, quantization) directly
# where it gets picked in the app.
function Add-FileNameSuffix($fileName, $suffix) {
  if (-not $suffix) { return $fileName }
  $extMatch = [regex]::Match($fileName, '\.(safetensors|ckpt)$')
  $baseName = if ($extMatch.Success) { $fileName.Substring(0, $extMatch.Index) } else { $fileName }
  $ext = if ($extMatch.Success) { $extMatch.Value } else { ".safetensors" }
  return "$baseName-$suffix$ext"
}

if ($NoAutoModel) {
  if ($existingNames.Count -eq 0) {
    Write-Fail "Aucun modele trouve, et -NoAutoModel est actif."
    Write-Host "    Placez au moins un checkpoint (.safetensors) dans :"
    Write-Host "      $ModelsDir"
    Write-Host "    puis relancez ce script -- il le detectera automatiquement."
    exit 1
  }
} else {
  $modelsToFetch = @($DefaultModels | Where-Object { $existingNames -notcontains $_.File })
  if ($FluxedUpUrl) {
    $fluxedUpName = Add-FileNameSuffix (Resolve-DownloadFileName $FluxedUpUrl "fluxed-up-nsfw.safetensors") $FluxedUpLabel
    if ($existingNames -notcontains $fluxedUpName) {
      $modelsToFetch = @($modelsToFetch) + @(@{ Label = "NSFW Flux (-FluxedUpUrl)"; File = $fluxedUpName; Url = $FluxedUpUrl })
    }
  } elseif ($existingNames -notmatch "(?i)flux.*up|nsfw") {
    Write-Info "Pas de -FluxedUpUrl fourni -- le 4e modele (NSFW) ne sera pas installe cette fois. Voir .NOTES de ce script pour obtenir un lien."
  }
  if ($ModelUrl) {
    $customName = Resolve-DownloadFileName $ModelUrl "model-personnalise.safetensors"
    if ($existingNames -notcontains $customName) {
      $modelsToFetch = @($modelsToFetch) + @(@{ Label = "modele personnalise (-ModelUrl)"; File = $customName; Url = $ModelUrl })
    }
  }

  if ($modelsToFetch.Count -eq 0) {
    Write-Ok "Tous les modeles demandes sont deja presents."
  }

  foreach ($m in $modelsToFetch) {
    Write-Info "Telechargement de $($m.Label)..."
    Write-Info "Cela peut prendre plusieurs minutes (voire plus d'une heure pour Flux, ~17 Go) selon votre connexion."
    # $m.File is already fully resolved (real Content-Disposition name and
    # -FluxedUpLabel suffix both applied up front, see Resolve-DownloadFileName/
    # Add-FileNameSuffix above) -- no rename needed here, unlike an earlier
    # version of this script that only discovered the real name after
    # downloading the whole file, which is also what broke the "already
    # downloaded?" check on every re-run (see that function's own comment).
    #
    # Temp-name-then-promote + size-sanity-check still apply, same reasoning
    # as setup-automatic1111.ps1: a connection drop mid-download leaves a
    # truncated .part file rather than a corrupt "real" one, and a login
    # page saved in place of a Civitai-gated file is nowhere near "> 100 MB"
    # so it gets caught and reported instead of silently breaking the model
    # folder.
    $finalDest = Join-Path $ModelsDir $m.File
    $tempDest = "$finalDest.part"
    if (Test-Path $tempDest) { Remove-Item $tempDest -Force -ErrorAction SilentlyContinue }
    $prevProgressPreference = $ProgressPreference
    $ProgressPreference = "SilentlyContinue"
    try {
      Invoke-WebRequest -Uri $m.Url -OutFile $tempDest -UseBasicParsing | Out-Null

      $downloadedSizeMB = [math]::Round((Get-Item $tempDest).Length / 1MB, 1)
      if ($downloadedSizeMB -lt 100) {
        throw "fichier telecharge anormalement petit ($downloadedSizeMB Mo) -- telechargement probablement interrompu, incomplet, ou l'URL a renvoye une page de connexion au lieu du fichier (Civitai)."
      }

      Move-Item -Path $tempDest -Destination $finalDest -Force
      Write-Ok "Modele telecharge : $($m.File)"
    } catch {
      if (Test-Path $tempDest) { Remove-Item $tempDest -Force -ErrorAction SilentlyContinue }
      Write-Fail "Le telechargement de $($m.File) a echoue -- $($_.Exception.Message)."
      Write-Host "    Si l'URL demande une connexion (Hugging Face ou Civitai, contenu mature),"
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
  Write-Fail "Aucun modele n'est present dans $ModelsDir (recherche/telechargement infructueux ci-dessus) -- Forge ne pourra rien generer sans au moins un checkpoint. Corrigez le probleme ci-dessus puis relancez ce script."
  exit 1
}

# ---------------------------------------------------------------------------
# 4. Stability-AI/stablediffusion mirror redirect -- see .NOTES at the top
#    of this script: verified against AUTOMATIC1111 specifically, kept here
#    defensively since Forge descends from the same launch_utils.py lineage
#    and setting an unused env var costs nothing if Forge doesn't need it.
# ---------------------------------------------------------------------------

Write-Step "Correctif defensif : depot Stable Diffusion officiel indisponible"

$env:STABLE_DIFFUSION_REPO = "https://github.com/w-e-w/stablediffusion.git"
Write-Ok "STABLE_DIFFUSION_REPO redirige vers un miroir fonctionnel (sans effet si Forge ne clone pas ce depot)."

# ---------------------------------------------------------------------------
# 5. RTX 50xx (Blackwell) PyTorch check -- confirmed still relevant on
#    Forge specifically via real, open issues on lllyasviel/stable-
#    diffusion-webui-forge (#2601, #2746, #2998) reporting the exact same
#    "no kernel image is available for execution on the device" as
#    AUTOMATIC1111 had. Same fix: override TORCH_COMMAND to cu128+ wheels.
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
  Write-Info "GPU RTX 50xx (Blackwell) detecte -- le PyTorch installe par defaut par Forge n'a pas de noyaux compiles pour cette architecture et plante a la premiere generation d'image."
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
# 6. CLIP/setuptools pre-install -- see .NOTES: verified against
#    AUTOMATIC1111 specifically, kept here defensively. Identical logic to
#    setup-automatic1111.ps1's own step, copied rather than shared (see
#    Get-WebUiProcessIds's own comment on why these scripts don't share code).
# ---------------------------------------------------------------------------

Write-Step "Pre-installation de CLIP (contourne un bug reel de compatibilite setuptools sur A1111 -- defensif ici)"

$VenvDir = Join-Path $ResolvedWebUiDir "venv"
$venvDirMatch = [regex]::Match($batContent, '(?m)^set VENV_DIR=([^\r\n]+)')
if ($venvDirMatch.Success -and $venvDirMatch.Groups[1].Value.Trim() -and $venvDirMatch.Groups[1].Value.Trim() -ne "-") {
  $customVenvDir = $venvDirMatch.Groups[1].Value.Trim()
  $VenvDir = if ([System.IO.Path]::IsPathRooted($customVenvDir)) { $customVenvDir } else { Join-Path $ResolvedWebUiDir $customVenvDir }
  Write-Info "VENV_DIR personnalise detecte dans webui-user.bat : $VenvDir"
}
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
  Write-Info "Pas encore de venv -- creation..."
  Invoke-NativeQuiet { if ($PythonLauncher -eq "py -3.10") { & py -3.10 -m venv $VenvDir } else { & python -m venv $VenvDir } }
  if ($LASTEXITCODE -ne 0) {
    Write-Info "La creation du venv a echoue (code $LASTEXITCODE) -- ce correctif sera tente par le webui lui-meme au lancement."
  }
}

$ClipInstallLogPath = Join-Path $WorkDir "forge-clip-preinstall.log"
function Write-ClipInstallLog($lines) {
  $lines | ForEach-Object { "$_" } | Set-Content -Path $ClipInstallLogPath -Encoding UTF8
}

if (Test-Path $VenvPython) {
  Invoke-NativeQuiet { & $VenvPython -c "import clip" 2>$null }
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "CLIP est deja installe dans le venv."
  } else {
    Write-Info "Fixation de setuptools a une version compatible (69.5.1) dans le venv..."
    $setuptoolsOutput = Invoke-NativeQuiet { & $VenvPython -m pip install "setuptools==69.5.1" wheel 2>&1 }
    if ($LASTEXITCODE -ne 0) {
      Write-Fail "Impossible de fixer setuptools==69.5.1/wheel -- la suite de cette etape va probablement aussi echouer. Detail :"
      Write-ClipInstallLog $setuptoolsOutput
      $setuptoolsOutput | Select-Object -Last 15 | ForEach-Object { Write-Host "    $_" }
      Write-Info "Journal complet : $ClipInstallLogPath"
    }

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
# 6b. Verify the ALREADY-INSTALLED torch actually has Blackwell kernels --
#     same reasoning and same real-vs-weak-check history as
#     setup-automatic1111.ps1's identical step (a torch.zeros(1)+1 check
#     passed on a partially-reinstalled venv there; a real half-precision
#     convolution didn't).
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
      Write-Fail "Confirme : le PyTorch deja installe dans ce venv n'a pas de noyaux compiles pour ce GPU."
    } else {
      Write-Fail "Le test PyTorch/CUDA a echoue pour une raison differente -- reinstallation quand meme tentee au cas ou. Detail :"
      $torchCheckOutput | Select-Object -Last 10 | ForEach-Object { Write-Host "    $_" }
    }

    $preReinstallPids = Get-WebUiProcessIds -Dir $ResolvedWebUiDir -Port $SdPort
    if ($preReinstallPids.Count -gt 0) {
      Write-Info "Forge tourne encore -- arret avant de toucher a son venv (sinon la reinstallation peut echouer partiellement en silence sur des fichiers verrouilles)."
      Stop-WebUiProcessIds -ProcessIds $preReinstallPids | Out-Null
      Start-Sleep -Milliseconds 500
    }

    Write-Info "Reinstallation de torch/torchvision/torchaudio depuis l'index cu128 (peut prendre plusieurs minutes, gros telechargement)..."
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
        Write-Fail "PyTorch reinstalle mais le test CUDA echoue encore -- signalez ceci."
        ($recheckOutput | Select-Object -Last 10) | ForEach-Object { Write-Host "    $_" }
      }
    }
  }
}

# ---------------------------------------------------------------------------
# 7. Make sure --api is enabled and the port matches -SdPort, idempotently.
# ---------------------------------------------------------------------------

Write-Step "Activation du flag --api"

if ($batContent -match "(?m)^set COMMANDLINE_ARGS=[^\r\n]*--api(?!\S)") {
  Write-Ok "--api est deja active dans webui-user.bat."
} elseif ($batContent -match "(?m)^set COMMANDLINE_ARGS=([^\r\n]*)") {
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

$portMatch = [regex]::Match($batContent, "(?m)^set COMMANDLINE_ARGS=[^\r\n]*--port\s+(\d+)")
if ($portMatch.Success -and $portMatch.Groups[1].Value -eq "$SdPort") {
  Write-Ok "--port $SdPort deja configure dans webui-user.bat."
} elseif ($portMatch.Success) {
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
# 8. Launch and wait for the API to actually answer.
# ---------------------------------------------------------------------------

Write-Step "Lancement de Forge (premier lancement = installation des dependances, soyez patient)"

$leftoverPids = Get-WebUiProcessIds -Dir $ResolvedWebUiDir -Port $SdPort
if ($leftoverPids.Count -gt 0) {
  Write-Info "Processus d'une execution precedente encore actif -- arret avant de relancer."
  Stop-WebUiProcessIds -ProcessIds $leftoverPids | Out-Null
  Start-Sleep -Milliseconds 500
}

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
  Write-Fail "Impossible de supprimer les anciens journaux ($($logCleanupError.Exception.Message)) -- poursuite quand meme."
}

if (-not (Test-Path $WebUiStdinPath)) { New-Item -ItemType File -Path $WebUiStdinPath -Force | Out-Null }

# BUG FOUND ON A REAL RUN: Forge's own dependency bootstrap (inside webui.py,
# on first launch) can end up with a numpy/scikit-image ABI mismatch --
# "numpy.dtype size changed, may indicate binary incompatibility" crashing
# in skimage's compiled geometry.pyx. Real, documented, still open upstream
# as of this writing (lllyasviel/stable-diffusion-webui-forge issue #2969 --
# no maintainer-confirmed fix in that thread). Not something this script's
# own CLIP/setuptools pre-install step touches, since scikit-image itself
# is installed later, by webui.py's own bootstrap, not by us. One automatic
# retry: force-reinstall scikit-image against whatever numpy ended up
# resolved, then relaunch once. If that doesn't clear it either, this is
# reported honestly as an unresolved upstream issue rather than retried
# forever.
$numpySkimageFixAttempted = $false

for ($launchAttempt = 1; $launchAttempt -le 2; $launchAttempt++) {
  try {
    $webuiProcess = Start-Process -FilePath $WebUiUserBat -WorkingDirectory $ResolvedWebUiDir `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $WebUiLogPath -RedirectStandardError $WebUiErrLogPath -RedirectStandardInput $WebUiStdinPath
  } catch {
    Write-Fail "Impossible de demarrer Forge -- $($_.Exception.Message)"
    if ($_.Exception.Message -match "used by another process|being used") {
      Write-Info "Un processus tient encore $WebUiLogPath ou $WebUiErrLogPath ouvert -- fermez-le puis relancez."
    }
    exit 1
  }

  Write-Info "Processus demarre (PID $($webuiProcess.Id)). Journal : $WebUiLogPath"
  Write-Info "Cela peut prendre 10 a 15 minutes la toute premiere fois (telechargement de PyTorch et des dependances)."

  $maxTries = 180  # 180 x 5s = 15 minutes
  $tries = 0
  $ready = $false
  $processDiedEarly = $false
  while ($tries -lt $maxTries) {
    Start-Sleep -Seconds 5
    $tries++
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$SdPort/sdapi/v1/sd-models" -TimeoutSec 3 | Out-Null
      $ready = $true
      break
    } catch {}
    if ($webuiProcess.HasExited) {
      $processDiedEarly = $true
      break
    }
    if ($tries % 12 -eq 0) {
      Write-Info "... toujours en attente ($($tries * 5)s ecoulees) -- consultez $WebUiLogPath si ca semble bloque"
    }
  }

  if ($ready) { break }

  $errLogText = if (Test-Path $WebUiErrLogPath) { Get-Content $WebUiErrLogPath -Raw } else { "" }
  $isNumpySkimageAbiError = $errLogText -match "numpy\.dtype size changed" -or $errLogText -match "may indicate binary incompatibility"

  if ($isNumpySkimageAbiError -and -not $numpySkimageFixAttempted -and (Test-Path $VenvPython)) {
    $numpySkimageFixAttempted = $true
    Write-Fail "Plantage numpy/scikit-image detecte (incompatibilite binaire connue, encore ouverte en amont -- voir https://github.com/lllyasviel/stable-diffusion-webui-forge/issues/2969)."
    Write-Info "Tentative de correctif automatique : reinstallation forcee de scikit-image contre le numpy actuellement resolu..."
    $skimageFixOutput = Invoke-NativeQuiet { & $VenvPython -m pip install --force-reinstall --no-cache-dir scikit-image 2>&1 }
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "scikit-image reinstalle -- nouvelle tentative de lancement."
    } else {
      Write-Fail "La reinstallation de scikit-image a echoue aussi -- nouvelle tentative de lancement quand meme, sans grand espoir. Detail :"
      $skimageFixOutput | Select-Object -Last 15 | ForEach-Object { Write-Host "    $_" }
    }
    if (-not $webuiProcess.HasExited) { Stop-Process -Id $webuiProcess.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
    continue
  }

  if ($processDiedEarly) {
    Write-Fail "Le processus s'est arrete de lui-meme (code $($webuiProcess.ExitCode)). Regardez $WebUiErrLogPath pour le detail."
  } else {
    Write-Fail "L'API ne repond toujours pas apres 15 minutes. Regardez $WebUiLogPath et $WebUiErrLogPath -- le processus (PID $($webuiProcess.Id)) reste lance, il continuera peut-etre de son cote."
  }
  exit 1
}

Write-Ok "Forge repond sur http://127.0.0.1:$SdPort avec --api actif."
$finalNames = Get-ExistingCheckpointNames $ModelsDir
Write-Host ""
Write-Host "    Modeles disponibles : $($finalNames -join ', ')" -ForegroundColor Cyan
Write-Host "    Prochaine etape : relancez setup-ollama-bridge.ps1 -- il detectera" -ForegroundColor Cyan
Write-Host "    ce serveur et poussera son adresse dans les reglages de Trame" -ForegroundColor Cyan
Write-Host "    (Images -> IA locale / Stable Diffusion)." -ForegroundColor Cyan
