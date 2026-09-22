<#
.SYNOPSIS
  Finds and (optionally) removes leftover AI-image-generation downloads that
  don't fit Trame's local image setup, to reclaim disk space.

.DESCRIPTION
  Trame's local image generation talks to AUTOMATIC1111's /sdapi/* API
  (see setup-automatic1111.ps1) and expects a single .safetensors/.ckpt
  checkpoint. Two kinds of leftovers don't fit that and are unlikely to ever
  be used as-is:

    1. Hugging Face "diffusers" format model caches (a multi-file Python
       pipeline folder -- unet/vae/text_encoder/model_index.json -- not a
       single checkpoint file a UI like AUTOMATIC1111 can load directly).
       Specifically looks for runwayml/stable-diffusion-v1-5 and
       stabilityai/sd-turbo under the Hugging Face hub cache
       (%USERPROFILE%\.cache\huggingface\hub) -- both old/base models that,
       even if converted to a checkpoint, would be lower quality and more
       heavily moderated than the anime/illustration checkpoint
       setup-automatic1111.ps1 downloads by default (NoobAI-XL), so
       converting them is not worth the effort.
    2. An unextracted ComfyUI portable archive (and its install script) --
       ComfyUI is a different UI with a different API than AUTOMATIC1111's,
       so using it would mean reworking Trame's image-provider code, not
       just running a script. Searches Downloads, Desktop and Documents for
       "ComfyUI*portable*.7z"/".zip" and "install_comfyui*.ps1".

  This script only REPORTS what it finds by default -- nothing is deleted
  unless you pass -Delete, and even then it asks for one final typed
  confirmation before removing anything (multi-GB downloads, not something
  to remove on a guess).

.NOTES
  - Run from a normal PowerShell window: if execution policy blocks the
    script, run instead:
      powershell -ExecutionPolicy Bypass -File .\cleanup-unused-image-tools.ps1
  - This script has not been run on a real Windows machine by the assistant
    that wrote it (no such access exists in that environment) -- it only
    reports by default, and even -Delete asks for a typed confirmation
    first, so a mistake here should be easy to back out of before anything
    is removed. Please report back anything that looks wrong.
  - Does not touch anything under an AUTOMATIC1111 install's own
    models\Stable-diffusion folder -- only the two specific leftover
    locations described above.

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

function Get-FolderSizeGB($path) {
  $bytes = (Get-ChildItem -Path $path -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  if (-not $bytes) { $bytes = 0 }
  return [math]::Round($bytes / 1GB, 2)
}

$foundItems = @()  # each: @{ Path = ...; Label = ...; SizeGB = ... }

# ---------------------------------------------------------------------------
# 1. Hugging Face diffusers-format caches (wrong format + wrong style/quality
#    for Trame's local image generation -- see .DESCRIPTION above).
# ---------------------------------------------------------------------------

Write-Step "Recherche des caches Hugging Face (format diffusers, non exploitables tels quels)"

$HfHubCache = Join-Path $env:USERPROFILE ".cache\huggingface\hub"
$targetHfDirs = @("models--runwayml--stable-diffusion-v1-5", "models--stabilityai--sd-turbo")

if (Test-Path $HfHubCache) {
  foreach ($dirName in $targetHfDirs) {
    $fullPath = Join-Path $HfHubCache $dirName
    if (Test-Path $fullPath) {
      $sizeGB = Get-FolderSizeGB $fullPath
      Write-Info "Trouve : $fullPath ($sizeGB Go)"
      $foundItems += @{ Path = $fullPath; Label = $dirName; SizeGB = $sizeGB }
    }
  }
} else {
  Write-Info "Pas de cache Hugging Face trouve dans $HfHubCache."
}

if ($foundItems.Count -eq 0) {
  Write-Ok "Aucun des deux caches (stable-diffusion-v1-5, sd-turbo) trouve."
}

# ---------------------------------------------------------------------------
# 2. Unextracted ComfyUI portable archive + its install script.
# ---------------------------------------------------------------------------

Write-Step "Recherche d'une archive ComfyUI non extraite"

$searchRoots = @(
  (Join-Path $env:USERPROFILE "Downloads"),
  (Join-Path $env:USERPROFILE "Desktop"),
  (Join-Path $env:USERPROFILE "Documents")
) | Where-Object { Test-Path $_ }

$comfyFiles = @()
foreach ($root in $searchRoots) {
  $comfyFiles += Get-ChildItem -Path $root -Recurse -Depth 3 -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "^ComfyUI.*portable.*\.(7z|zip)$" -or $_.Name -match "^install_comfyui.*\.ps1$" }
}

if ($comfyFiles.Count -gt 0) {
  foreach ($file in $comfyFiles) {
    $sizeGB = [math]::Round($file.Length / 1GB, 2)
    Write-Info "Trouve : $($file.FullName) ($sizeGB Go)"
    $foundItems += @{ Path = $file.FullName; Label = $file.Name; SizeGB = $sizeGB }
  }
} else {
  Write-Ok "Aucune archive ComfyUI non extraite trouvee."
}

# ---------------------------------------------------------------------------
# 3. Report, and delete only if -Delete was given and confirmed.
# ---------------------------------------------------------------------------

if ($foundItems.Count -eq 0) {
  Write-Step "Rien a nettoyer"
  Write-Host "    Aucun des elements recherches n'a ete trouve -- rien a faire."
  exit 0
}

$totalGB = [math]::Round((($foundItems | ForEach-Object { $_.SizeGB }) | Measure-Object -Sum).Sum, 2)

Write-Step "Resume"
Write-Host "    $($foundItems.Count) element(s) trouve(s), $totalGB Go au total :"
foreach ($item in $foundItems) {
  Write-Host "      - $($item.Path) ($($item.SizeGB) Go)"
}

if (-not $Delete) {
  Write-Host ""
  Write-Host "    Rien n'a ete supprime (mode rapport par defaut)." -ForegroundColor Yellow
  Write-Host "    Relancez avec -Delete pour proposer de les supprimer." -ForegroundColor Yellow
  exit 0
}

Write-Host ""
Write-Host "    Ceci va supprimer definitivement les $($foundItems.Count) element(s) ci-dessus ($totalGB Go)." -ForegroundColor Yellow
$confirmation = Read-Host "    Tapez OUI (en majuscules) pour confirmer la suppression"

if ($confirmation -cne "OUI") {
  Write-Host "    Annule -- rien n'a ete supprime."
  exit 0
}

Write-Step "Suppression"
foreach ($item in $foundItems) {
  try {
    Remove-Item -Path $item.Path -Recurse -Force -ErrorAction Stop
    Write-Ok "Supprime : $($item.Path)"
  } catch {
    Write-Host "    ECHEC pour $($item.Path) -- $($_.Exception.Message)" -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "    $totalGB Go liberes (sous reserve des echecs eventuels ci-dessus)." -ForegroundColor Cyan
