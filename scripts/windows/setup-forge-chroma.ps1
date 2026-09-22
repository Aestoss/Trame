<#
.SYNOPSIS
  Installs and starts a SEPARATE, dedicated Forge instance running Chroma
  (the uncensored-at-training-level, Apache 2.0 Flux-schnell derivative) --
  the 5th image model, alongside the four on setup-forge.ps1's instance.

.DESCRIPTION
  Chroma is NOT just another checkpoint you can drop into setup-forge.ps1's
  instance: as of this writing, mainline lllyasviel/stable-diffusion-webui-
  forge has no native Chroma support (real, still-open feature requests --
  GitHub issues/discussions #2744, #2900, #2932 on that repo). Loading it
  needs a Chroma-patched fork, and Chroma itself needs THREE separate files
  (checkpoint + VAE + T5 text encoder) selected together, not one
  self-contained checkpoint like Flux Safe's all-in-one file.

  Rather than risk that patched fork's rougher edges affecting the four
  models that already work reliably, this runs Chroma on its own dedicated
  Forge-fork instance, its own port, its own Caddy route
  (/sdapi-chroma/*, see setup-ollama-bridge.ps1) -- if anything about this
  specific instance is flaky, it can't take the other four down with it,
  and vice versa.

  Because this instance only EVER serves Chroma, providers/imageProviders.js
  doesn't need to send it any override_settings/checkpoint-switching at
  all -- it just sends prompts to a fixed pre-configured backend, once you've
  done the one-time model selection described in .NOTES.

  What it does, in order:
    1. Python 3.10 + Git.
    2. Finds an existing chromaforge install or clones one fresh
       (maybleMyers/chromaforge -- a fork specifically maintained to run
       Chroma inside a Forge-style UI/API).
    3. Downloads the three required files if missing: the Chroma checkpoint
       itself (lodestones/Chroma1-HD, ungated), a T5-XXL text encoder in
       FP8 (smaller than FP16, matching this project's general VRAM-
       conscious quantization choices), and the Flux VAE (ae.safetensors,
       from an ungated community mirror -- Black Forest Labs' own upload
       requires a separate Hugging Face license click-through this script
       can't do for you).
    4. Same Blackwell/RTX 50xx PyTorch check and CLIP/setuptools pre-install
       as setup-forge.ps1 -- kept defensively; not specifically confirmed
       against this fork's own code, only against AUTOMATIC1111's.
    5. Enables --api, pins the port (7862 by default -- distinct from
       setup-forge.ps1's 7860).
    6. Launches, waits for a basic HTTP response, then ACTUALLY TESTS
       generation via /sdapi/v1/txt2img and tells you plainly whether it
       worked -- this fork's README documents zero API usage (unlike
       AUTOMATIC1111/Forge's own, which is extensively documented), so
       this script does not assume success just because the process started.

.NOTES
  - REAL, UNRESOLVED UNCERTAINTY, stated plainly rather than glossed over:
    chromaforge's own README never mentions /sdapi/v1/txt2img, --api, or
    any REST automation at all -- only its Gradio browser UI. This script
    still passes --api (inherited from Forge, and this fork's own repo does
    still contain modules/api/api.py and modules/api/models.py, the same
    files that implement AUTOMATIC1111/Forge's REST layer -- confirmed by
    listing that fork's file tree, not guessed), so there is real reason to
    expect it works, but this is the one piece of this whole project that
    could not be confirmed against either a live run or explicit
    documentation. Step 6's live txt2img test exists specifically to give
    you a clear, honest yes/no on this instead of a hopeful assumption --
    read that message before doing anything else with this model.
  - ONE MANUAL STEP THIS SCRIPT CANNOT DO FOR YOU: Chroma needs its
    checkpoint + VAE + text encoder selected TOGETHER, and chromaforge's
    own documentation only describes doing this from the browser UI (top
    left: select "chroma", then the checkpoint, then the text encoder and
    VAE in the fields that appear). This script tries to pre-seed that
    choice in Forge's own ui-config.json (the documented way Forge persists
    a default sd_model_checkpoint across restarts), but the VAE/text-
    encoder pairing specifically is NOT confirmed to persist the same way.
    The FIRST time you run this, open http://127.0.0.1:<port> in a browser,
    make that selection once, generate one test image to confirm it works,
    and it should then stay selected for every future headless run -- if it
    doesn't, this is the concrete gap to report back.
  - This script has not been run on a real Windows machine by the assistant
    that wrote it. Please report back anything that errors, especially
    around step 6.

.PARAMETER WebUiDir
  Skip auto-detection and use this exact chromaforge folder.

.PARAMETER ChromaPort
  Port this dedicated instance's API listens on. Defaults to 7862 -- keep
  this in sync with setup-ollama-bridge.ps1's -ChromaPort.

.PARAMETER T5Fp16
  Use the full FP16 T5-XXL text encoder (~9.8 Go) instead of the FP8
  default (~4.9 Go) -- higher fidelity, more disk/VRAM.

.PARAMETER SkipLaunch
  Set everything up but don't start the WebUI.
#>

[CmdletBinding()]
param(
  [string]$WebUiDir = "",
  [int]$ChromaPort = 7862,
  [switch]$T5Fp16,
  [switch]$SkipLaunch
)

$ErrorActionPreference = "Stop"

$WorkDir       = Join-Path $env:USERPROFILE "TrameOllamaBridge"
$ConfigPath    = Join-Path $WorkDir "forge-chroma-config.json"
$DefaultCloneParent = $env:USERPROFILE
$WebUiLogPath  = Join-Path $WorkDir "forge-chroma.log"
$WebUiErrLogPath = Join-Path $WorkDir "forge-chroma.err.log"
$WebUiStdinPath = Join-Path $WorkDir "forge-chroma-stdin.empty"

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

function Invoke-NativeQuiet {
  param([Parameter(Mandatory)][scriptblock]$ScriptBlock)
  $prevErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $ScriptBlock } finally { $ErrorActionPreference = $prevErrorActionPreference }
}

function Get-WebUiProcessIds {
  param([string]$Dir, [int]$Port)
  $pidsFound = New-Object System.Collections.Generic.HashSet[int]
  if ($Dir) {
    # BUG FOUND ON A REAL RUN: without excluding $PID, this can match the
    # CURRENT process's own command line when -WebUiDir is passed explicitly
    # (its literal text is part of this very process's CommandLine as seen
    # by WMI) -- Stop-WebUiProcessIds would then kill the script running
    # RIGHT NOW, silently (Stop-Process -Force gives no chance to log
    # anything after that point). Confirmed as the exact cause of a run that
    # died without any error message right after "Arret d'un processus
    # Forge-Chroma" -- see CHANGELOG.md.
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
      Write-Info "Arret d'un processus Forge-Chroma (PID $procId)..."
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

function Get-ChromaConfig {
  if (Test-Path $ConfigPath) {
    try { return Get-Content $ConfigPath -Raw | ConvertFrom-Json } catch {}
  }
  return [pscustomobject]@{ webuiDir = $null }
}
function Save-ChromaConfig($cfg) {
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
    Write-Fail "L'installation via winget a echoue. Relancez ce script depuis un PowerShell en mode Administrateur, ou installez Python 3.10 manuellement, puis relancez ce script."
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

$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
  Write-Fail "Git n'est pas installe -- lancez setup-forge.ps1 d'abord (il l'installe), ou installez-le depuis https://git-scm.com/download/win puis relancez ce script."
  exit 1
}
Write-Ok "Git est installe."

# ---------------------------------------------------------------------------
# 2. Find (or clone) chromaforge
# ---------------------------------------------------------------------------

Write-Step "Recherche d'une installation chromaforge existante"

$cfg = Get-ChromaConfig
$ResolvedWebUiDir = $null

if ($WebUiDir) {
  if (-not (Test-Path (Join-Path $WebUiDir "webui.bat"))) {
    Write-Fail "Le dossier indique avec -WebUiDir ($WebUiDir) ne contient pas de webui.bat -- verifiez le chemin."
    exit 1
  }
  $ResolvedWebUiDir = $WebUiDir
  Write-Ok "Utilisation du dossier indique : $ResolvedWebUiDir"
} elseif ($cfg.webuiDir -and (Test-Path (Join-Path $cfg.webuiDir "webui.bat"))) {
  $ResolvedWebUiDir = $cfg.webuiDir
  Write-Ok "Installation deja connue d'une execution precedente : $ResolvedWebUiDir"
} else {
  $cloneTarget = Join-Path $DefaultCloneParent "chromaforge"
  if (Test-Path $cloneTarget) {
    if (-not (Test-Path (Join-Path $cloneTarget "webui.bat"))) {
      Write-Fail "$cloneTarget existe deja mais ne contient pas de webui.bat valide -- renommez ou supprimez ce dossier, puis relancez ce script."
      exit 1
    }
    $ResolvedWebUiDir = $cloneTarget
    Write-Ok "Installation existante (non enregistree) trouvee : $ResolvedWebUiDir"
  } else {
    Write-Info "Aucune installation connue -- clonage d'une nouvelle copie de chromaforge."
    Invoke-NativeQuiet { & git clone --depth 1 https://github.com/maybleMyers/chromaforge.git $cloneTarget }
    if ($LASTEXITCODE -ne 0) {
      Write-Fail "Le clonage a echoue (voir le detail ci-dessus). Verifiez votre connexion internet et relancez ce script."
      exit 1
    }
    $ResolvedWebUiDir = $cloneTarget
    Write-Ok "Clone dans $ResolvedWebUiDir."
  }
}

$cfg.webuiDir = $ResolvedWebUiDir
Save-ChromaConfig $cfg

# BUG FOUND ON A REAL RUN (not caught before shipping): chromaforge's repo
# does not ship webui-user.bat -- only webui.bat, webui-user.sh,
# webui-macos-env.sh, webui.sh. This script launches webui-user.bat
# directly further down (Start-Process -FilePath $WebUiUserBat), and the
# GPU/--api/--port steps right after this all read/write that same file,
# so it must actually exist as a real file, not just be something
# webui.bat is free to source if present. Confirmed on a fresh clone of
# this exact fork by the assistant actually running this script on a real
# machine. Create it from the same template AUTOMATIC1111/Forge ship by
# default (which itself does nothing but forward into webui.bat) if it's
# missing, instead of letting the next Get-Content on it fail outright.
$WebUiUserBat = Join-Path $ResolvedWebUiDir "webui-user.bat"
if (-not (Test-Path $WebUiUserBat)) {
  $defaultWebUiUserBat = "@echo off`r`n`r`nset PYTHON=`r`nset GIT=`r`nset VENV_DIR=`r`nset COMMANDLINE_ARGS=`r`n`r`ncall webui.bat`r`n"
  Set-Content -Path $WebUiUserBat -Value $defaultWebUiUserBat -Encoding ASCII -NoNewline
  Write-Ok "webui-user.bat absent de ce fork -- cree avec le modele standard AUTOMATIC1111/Forge."
}

# ---------------------------------------------------------------------------
# 3. Download the three required files -- exact folder names quoted
#    verbatim from chromaforge's own README (models/text_encoder,
#    models/vae), not guessed; models/Stable-diffusion for the main
#    checkpoint follows every other Forge/A1111 convention in this project.
# ---------------------------------------------------------------------------

Write-Step "Verification des fichiers Chroma (checkpoint + VAE + encodeur texte)"

$CheckpointDir = Join-Path $ResolvedWebUiDir "models\Stable-diffusion"
$VaeDir = Join-Path $ResolvedWebUiDir "models\vae"
$TextEncoderDir = Join-Path $ResolvedWebUiDir "models\text_encoder"
New-Item -ItemType Directory -Force -Path $CheckpointDir | Out-Null
New-Item -ItemType Directory -Force -Path $VaeDir | Out-Null
New-Item -ItemType Directory -Force -Path $TextEncoderDir | Out-Null

$T5File = if ($T5Fp16) { "t5xxl_fp16.safetensors" } else { "t5xxl_fp8_e4m3fn.safetensors" }
$T5Url = if ($T5Fp16) {
  "https://huggingface.co/lllyasviel/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors"
} else {
  "https://huggingface.co/lllyasviel/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn.safetensors"
}

# All three ungated on Hugging Face -- no login/API token needed, unlike
# Fluxed Up in setup-forge.ps1.
$RequiredFiles = @(
  @{ Label = "checkpoint Chroma1-HD (~non censure a l'entrainement, ~17 Go)"; Dir = $CheckpointDir; File = "Chroma1-HD.safetensors"; Url = "https://huggingface.co/lodestones/Chroma1-HD/resolve/main/Chroma1-HD.safetensors"; MinSizeMB = 1000 },
  @{ Label = "encodeur texte T5-XXL ($(if ($T5Fp16) { 'FP16, ~9.8 Go' } else { 'FP8, ~4.9 Go' }))"; Dir = $TextEncoderDir; File = $T5File; Url = $T5Url; MinSizeMB = 1000 },
  @{ Label = "VAE Flux (ae.safetensors, ~335 Mo)"; Dir = $VaeDir; File = "ae.safetensors"; Url = "https://huggingface.co/ffxvs/vae-flux/resolve/main/ae.safetensors"; MinSizeMB = 100 }
)

foreach ($f in $RequiredFiles) {
  $finalDest = Join-Path $f.Dir $f.File
  if (Test-Path $finalDest) {
    Write-Ok "Deja present : $($f.File)"
    continue
  }
  Write-Info "Telechargement de $($f.Label)..."
  Write-Info "Cela peut prendre longtemps selon votre connexion."
  $tempDest = "$finalDest.part"
  if (Test-Path $tempDest) { Remove-Item $tempDest -Force -ErrorAction SilentlyContinue }
  $prevProgressPreference = $ProgressPreference
  $ProgressPreference = "SilentlyContinue"
  try {
    Invoke-WebRequest -Uri $f.Url -OutFile $tempDest -UseBasicParsing
    $downloadedSizeMB = [math]::Round((Get-Item $tempDest).Length / 1MB, 1)
    if ($downloadedSizeMB -lt $f.MinSizeMB) {
      throw "fichier telecharge anormalement petit ($downloadedSizeMB Mo, attendu au moins $($f.MinSizeMB) Mo) -- telechargement probablement interrompu ou incomplet."
    }
    Move-Item -Path $tempDest -Destination $finalDest -Force
    Write-Ok "Telecharge : $($f.File)"
  } catch {
    if (Test-Path $tempDest) { Remove-Item $tempDest -Force -ErrorAction SilentlyContinue }
    Write-Fail "Le telechargement de $($f.File) a echoue -- $($_.Exception.Message)."
    Write-Host "    Telechargez-le a la main depuis :"
    Write-Host "      $($f.Url)"
    Write-Host "    Placez-le dans $($f.Dir) puis relancez ce script."
    exit 1
  } finally {
    $ProgressPreference = $prevProgressPreference
  }
}

# ---------------------------------------------------------------------------
# 4. Same Blackwell/CLIP defensive checks as setup-forge.ps1 -- see that
#    script's identical steps for the full reasoning. Not confirmed
#    specifically against chromaforge's own code, only against
#    AUTOMATIC1111's -- kept because they're cheap and harmless if unneeded.
# ---------------------------------------------------------------------------

Write-Step "Correctif defensif : depot Stable Diffusion officiel indisponible"
$env:STABLE_DIFFUSION_REPO = "https://github.com/w-e-w/stablediffusion.git"
Write-Ok "STABLE_DIFFUSION_REPO redirige (sans effet si ce fork ne clone pas ce depot)."

Write-Step "Verification de la compatibilite GPU (RTX 50xx / Blackwell)"

function Test-BlackwellGpu {
  try {
    $names = Get-CimInstance Win32_VideoController -ErrorAction Stop | Select-Object -ExpandProperty Name
    return [bool]($names | Where-Object { $_ -match "RTX 50\d0" })
  } catch {
    return $false
  }
}

$batContent = Get-Content $WebUiUserBat -Raw

$IsBlackwellGpu = Test-BlackwellGpu
if ($IsBlackwellGpu) {
  Write-Info "GPU RTX 50xx (Blackwell) detecte."
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
} else {
  Write-Ok "Pas de GPU Blackwell (RTX 50xx) detecte -- aucun changement necessaire."
}

# ---------------------------------------------------------------------------
# 4b. CLIP/setuptools pre-install -- BUG FOUND ON A REAL RUN: the .NOTES/
#     synopsis above (and setup-forge.ps1's own comments) claimed this
#     script does "the same CLIP/setuptools defensive check as
#     setup-forge.ps1", but that step was never actually written here --
#     only the Blackwell/torch check above existed. Without it,
#     chromaforge's own dependency bootstrap tries to build CLIP with
#     whatever setuptools is already in the venv (a modern one that
#     dropped/deprecated pkg_resources by default), which fails outright.
#     Copied from setup-forge.ps1's identical step now that the gap is
#     confirmed for real -- see CHANGELOG.md.
# ---------------------------------------------------------------------------

Write-Step "Pre-installation de CLIP (contourne un bug reel de compatibilite setuptools -- copie depuis setup-forge.ps1 apres l'avoir trouve manquant ici sur un run reel)"

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

$ClipInstallLogPath = Join-Path $WorkDir "forge-chroma-clip-preinstall.log"
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
# 5. --api + port, idempotently. Also tries to pre-seed the default
#    checkpoint in ui-config.json (Forge's documented way to persist a
#    default sd_model_checkpoint across restarts) -- best-effort only: the
#    VAE/text-encoder pairing specifically is NOT confirmed to persist the
#    same way (chromaforge's README only describes selecting them from the
#    UI), so this never blocks the rest of the script either way.
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
if ($portMatch.Success -and $portMatch.Groups[1].Value -eq "$ChromaPort") {
  Write-Ok "--port $ChromaPort deja configure dans webui-user.bat."
} elseif ($portMatch.Success) {
  $batContent = $batContent -replace "(?m)(^set COMMANDLINE_ARGS=[^\r\n]*--port\s+)\d+", "`${1}$ChromaPort"
  Set-Content -Path $WebUiUserBat -Value $batContent -Encoding ASCII
  Write-Ok "--port mis a jour a $ChromaPort dans webui-user.bat."
} elseif ($batContent -match "(?m)^set COMMANDLINE_ARGS=([^\r\n]*)") {
  $existingArgs = $Matches[1].TrimEnd()
  $newArgs = "$existingArgs --port $ChromaPort"
  $batContent = $batContent -replace "(?m)^set COMMANDLINE_ARGS=[^\r\n]*", "set COMMANDLINE_ARGS=$newArgs"
  Set-Content -Path $WebUiUserBat -Value $batContent -Encoding ASCII
  Write-Ok "--port $ChromaPort ajoute a webui-user.bat."
}

$UiConfigPath = Join-Path $ResolvedWebUiDir "ui-config.json"
try {
  # ConvertFrom-Json -AsHashtable would be the natural way to do this, but
  # -AsHashtable is a PowerShell 6+ parameter -- Windows PowerShell 5.1 (the
  # default on a plain Windows install, and what every other script in this
  # project is written to run on) doesn't have it and would fail outright
  # here. Add-Member -Force works identically on both and covers "the key
  # doesn't exist yet" and "it exists, overwrite it" in one call.
  $uiConfig = if (Test-Path $UiConfigPath) { Get-Content $UiConfigPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
  $uiConfig | Add-Member -NotePropertyName "sd_model_checkpoint" -NotePropertyValue "Chroma1-HD.safetensors" -Force
  # BUG FOUND ON A REAL RUN: "Set-Content -Encoding UTF8" writes UTF-8 WITH
  # a BOM in Windows PowerShell 5.1 -- harmless for files only PowerShell
  # itself re-reads, but chromaforge's own Python side loads this file with
  # json.load(), which raises "Unexpected UTF-8 BOM" outright on it. That
  # failure was silent (chromaforge doesn't crash, it just never finishes
  # loading ui-config.json), so the VAE/text-encoder selection made in the
  # browser never actually persisted, surfacing later as "KeyError:
  # 'text_encoder_2'" / "AssertionError: You do not have VAE state dict!"
  # when generating. [System.IO.File]::WriteAllText with a BOM-less
  # UTF8Encoding writes real, BOM-free UTF-8 on both PS 5.1 and 7+. See
  # CHANGELOG.md.
  $uiConfigJson = $uiConfig | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($UiConfigPath, $uiConfigJson, (New-Object System.Text.UTF8Encoding $false))
  Write-Info "Checkpoint par defaut pre-configure dans ui-config.json (Chroma1-HD.safetensors, UTF-8 sans BOM) -- la selection du VAE/encodeur texte reste, elle, a faire une fois depuis le navigateur (voir .NOTES)."
} catch {
  Write-Info "Pre-configuration de ui-config.json non tentee/echouee ($($_.Exception.Message)) -- sans consequence, juste une commodite en moins pour le tout premier lancement."
}

if ($SkipLaunch) {
  Write-Step "Termine (-SkipLaunch)"
  Write-Host "    Tout est pret dans $ResolvedWebUiDir -- lancez webui-user.bat vous-meme quand vous voulez."
  exit 0
}

# ---------------------------------------------------------------------------
# 6. Launch, wait for a response, then ACTUALLY TEST generation -- this is
#    the step that turns "the process started" into a real yes/no on
#    whether this fork's API works at all, given its README never mentions
#    API automation. See .NOTES for the full reasoning.
# ---------------------------------------------------------------------------

Write-Step "Lancement de Forge-Chroma (premier lancement = installation des dependances, soyez patient)"

$leftoverPids = Get-WebUiProcessIds -Dir $ResolvedWebUiDir -Port $ChromaPort
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

# BUG FOUND ON A REAL RUN: this exact numpy/scikit-image ABI retry was
# written for setup-forge.ps1 after hitting it on the main instance, but
# never copied here -- Chroma's own bootstrap hit the identical crash
# ("numpy.dtype size changed, may indicate binary incompatibility" in
# skimage's compiled geometry.pyx) with no retry logic to catch it. Same
# fix as setup-forge.ps1: see that script's comment and
# lllyasviel/stable-diffusion-webui-forge issue #2969 for the full
# reasoning. One automatic retry, reported honestly if it doesn't clear.
$numpySkimageFixAttempted = $false

for ($launchAttempt = 1; $launchAttempt -le 2; $launchAttempt++) {
  try {
    $webuiProcess = Start-Process -FilePath $WebUiUserBat -WorkingDirectory $ResolvedWebUiDir `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $WebUiLogPath -RedirectStandardError $WebUiErrLogPath -RedirectStandardInput $WebUiStdinPath
  } catch {
    Write-Fail "Impossible de demarrer Forge-Chroma -- $($_.Exception.Message)"
    exit 1
  }

  Write-Info "Processus demarre (PID $($webuiProcess.Id)). Journal : $WebUiLogPath"
  Write-Info "Cela peut prendre 10 a 15 minutes la toute premiere fois."

  $maxTries = 180
  $tries = 0
  $ready = $false
  $processDiedEarly = $false
  while ($tries -lt $maxTries) {
    Start-Sleep -Seconds 5
    $tries++
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$ChromaPort/sdapi/v1/sd-models" -TimeoutSec 3 | Out-Null
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
    Write-Fail "L'API ne repond toujours pas apres 15 minutes. Regardez $WebUiLogPath et $WebUiErrLogPath."
  }
  exit 1
}

Write-Ok "Le serveur repond sur http://127.0.0.1:$ChromaPort."

Write-Step "Test reel de generation (/sdapi/v1/txt2img) -- l'API de ce fork n'est pas documentee, ceci le verifie plutot que de le supposer"

try {
  $testBody = @{ prompt = "a single red apple on a white background"; steps = 4; width = 512; height = 512 } | ConvertTo-Json
  $testResp = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ChromaPort/sdapi/v1/txt2img" `
    -ContentType "application/json" -Body $testBody -TimeoutSec 120
  if ($testResp.images -and $testResp.images.Count -gt 0) {
    Write-Ok "SUCCES : une image a bien ete generee via l'API. Cette instance Chroma est utilisable telle quelle par Trame."
  } else {
    Write-Fail "L'API a repondu sans erreur mais sans image -- probablement le VAE/encodeur texte pas encore selectionnes (voir .NOTES : ouvrez http://127.0.0.1:$ChromaPort dans un navigateur, selectionnez Chroma + VAE + encodeur texte une premiere fois, generez une image de test, puis relancez ce test)."
  }
} catch {
  Write-Fail "L'appel de test a echoue -- $($_.Exception.Message)"
  Write-Info "Le plus probable a ce stade : le modele/VAE/encodeur texte n'ont encore jamais ete selectionnes."
  Write-Info "Ouvrez http://127.0.0.1:$ChromaPort dans un navigateur, selectionnez 'chroma' en haut a gauche,"
  Write-Info "puis le checkpoint Chroma1-HD, puis le VAE (ae.safetensors) et l'encodeur texte ($T5File)"
  Write-Info "dans les champs qui apparaissent, generez une image pour confirmer, puis relancez ce script"
  Write-Info "(ou juste ce test) pour verifier que ca fonctionne desormais sans intervention."
}

Write-Host ""
Write-Host "    Prochaine etape : relancez setup-ollama-bridge.ps1 -- il ajoute la route" -ForegroundColor Cyan
Write-Host "    /sdapi-chroma/* pointant vers ce port ($ChromaPort)." -ForegroundColor Cyan
