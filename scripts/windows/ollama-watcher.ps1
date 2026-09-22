<#
.SYNOPSIS
  Local companion to setup-ollama-bridge.ps1: watches GPU load and shows a
  tray icon + a tiny status HTTP endpoint that Trame polls through the
  Caddy proxy (see the @authorizedStatus route in the generated Caddyfile).

.DESCRIPTION
  Not meant to be run by hand -- setup-ollama-bridge.ps1 starts this
  automatically. Runs two things at once in one process:

    - A background thread serving GET / on -Port with a small JSON body
      describing current GPU load (via nvidia-smi) and, best-effort, which
      Ollama models are currently loaded (via Ollama's native /api/ps).
    - A tray icon on the main thread (green = idle/available, orange = GPU
      busy enough that a game running at the same time might stutter),
      refreshed every -PollIntervalSeconds.

  "Busy" is a simple threshold on GPU utilization%, not something specific
  to Ollama -- this is deliberate: the whole point is to warn about
  contention with whatever else is using the GPU (another game), not just
  whether Ollama itself has a model loaded.

  If nvidia-smi isn't found (no NVIDIA GPU, or drivers not on PATH), GPU
  numbers stay at 0 and "busy" is only ever true while Ollama itself
  reports a loaded model -- degraded but not broken.

.NOTES
  Not executed on a real Windows machine by the assistant that wrote it --
  built from documented .NET/PowerShell APIs (HttpListener, runspaces with
  a synchronized hashtable for shared state, System.Windows.Forms for the
  tray icon), but please report back anything that errors.
#>

[CmdletBinding()]
param(
  [int]$Port = 8788,
  [int]$BusyThresholdPercent = 50,
  [int]$PollIntervalSeconds = 3
)

$ErrorActionPreference = "Continue" # a hiccup in one poll shouldn't kill the tray/watcher

$WorkDir = Join-Path $env:USERPROFILE "TrameOllamaBridge"
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$LogPath = Join-Path $WorkDir "watcher.log"
try { Start-Transcript -Path $LogPath -Append | Out-Null } catch {}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Shared between this (main/UI) thread and the HTTP listener thread below --
# a synchronized hashtable is the standard safe way to do that in PowerShell
# without a full message-passing setup.
$syncHash = [hashtable]::Synchronized(@{
  state = 'available'
  busy = $false
  gpuUtilizationPercent = 0
  vramUsedMb = 0
  vramTotalMb = 0
  modelsLoaded = @()
  updatedAt = (Get-Date).ToString('o')
})

function Get-GpuStats {
  try {
    $raw = & nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>$null
    if (-not $raw) { return $null }
    $line = @($raw)[0]
    $parts = ($line -split ',') | ForEach-Object { $_.Trim() }
    if ($parts.Count -lt 3) { return $null }
    return @{
      gpuUtilizationPercent = [int]$parts[0]
      vramUsedMb = [int]$parts[1]
      vramTotalMb = [int]$parts[2]
    }
  } catch {
    return $null
  }
}

function Get-LoadedOllamaModels {
  try {
    $resp = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/ps" -TimeoutSec 3
    return @($resp.models | ForEach-Object { $_.name })
  } catch {
    return @()
  }
}

function Update-WatcherState {
  $gpu = Get-GpuStats
  $models = Get-LoadedOllamaModels

  if ($gpu) {
    $syncHash.gpuUtilizationPercent = $gpu.gpuUtilizationPercent
    $syncHash.vramUsedMb = $gpu.vramUsedMb
    $syncHash.vramTotalMb = $gpu.vramTotalMb
    $isBusy = $gpu.gpuUtilizationPercent -gt $BusyThresholdPercent
  } else {
    # No nvidia-smi reading available -- fall back to "a model is loaded" as
    # the only busy signal we have left, rather than always reporting idle.
    $isBusy = $models.Count -gt 0
  }

  $syncHash.modelsLoaded = $models
  $syncHash.busy = $isBusy
  $syncHash.state = if ($isBusy) { 'busy' } else { 'available' }
  $syncHash.updatedAt = (Get-Date).ToString('o')
}

# ---------------------------------------------------------------------------
# HTTP status endpoint, on its own runspace so the tray icon's message loop
# (below, on the main thread) isn't blocked by HttpListener.GetContext().
# ---------------------------------------------------------------------------

$runspace = [runspacefactory]::CreateRunspace()
$runspace.Open()
$runspace.SessionStateProxy.SetVariable('syncHash', $syncHash)
$runspace.SessionStateProxy.SetVariable('Port', $Port)

$listenerPs = [powershell]::Create()
$listenerPs.Runspace = $runspace
$listenerPs.AddScript({
  try {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://127.0.0.1:$Port/")
    $listener.Start()
    while ($true) {
      $context = $listener.GetContext()
      try {
        $snapshot = @{
          state = $syncHash.state
          busy = $syncHash.busy
          gpuUtilizationPercent = $syncHash.gpuUtilizationPercent
          vramUsedMb = $syncHash.vramUsedMb
          vramTotalMb = $syncHash.vramTotalMb
          modelsLoaded = $syncHash.modelsLoaded
          updatedAt = $syncHash.updatedAt
        }
        $body = $snapshot | ConvertTo-Json -Compress
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($body)
        $context.Response.ContentType = 'application/json'
        $context.Response.ContentLength64 = $buffer.Length
        $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
      } catch {
      } finally {
        $context.Response.OutputStream.Close()
      }
    }
  } catch {
    # Most likely cause: $Port already in use (a previous instance still
    # running) -- setup-ollama-bridge.ps1's Stop-StaleBridge should prevent
    # this on a normal run, but this keeps the process alive to log it
    # instead of silently dying with no trace.
    Write-Error "ollama-watcher HTTP listener failed: $_"
  }
}) | Out-Null
$listenerHandle = $listenerPs.BeginInvoke()

# ---------------------------------------------------------------------------
# Tray icon, on the main thread
# ---------------------------------------------------------------------------

function New-DotIcon([System.Drawing.Color]$color) {
  $bmp = New-Object System.Drawing.Bitmap 16, 16
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush($color)
  $g.FillEllipse($brush, 1, 1, 14, 14)
  $g.Dispose()
  $brush.Dispose()
  $handle = $bmp.GetHicon()
  return [System.Drawing.Icon]::FromHandle($handle)
}

$trayIcon = $null
$timer = $null
try {
  $trayIcon = New-Object System.Windows.Forms.NotifyIcon
  $trayIcon.Icon = New-DotIcon ([System.Drawing.Color]::Gray)
  $trayIcon.Text = "Trame / Ollama : demarrage..."
  $trayIcon.Visible = $true

  $menu = New-Object System.Windows.Forms.ContextMenuStrip
  $statusItem = $menu.Items.Add("Statut : demarrage...")
  $statusItem.Enabled = $false
  $menu.Items.Add("-") | Out-Null
  $exitItem = $menu.Items.Add("Quitter le surveillant")
  $exitItem.add_Click({ [System.Windows.Forms.Application]::Exit() })
  $trayIcon.ContextMenuStrip = $menu

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = [Math]::Max(1000, $PollIntervalSeconds * 1000)
  $timer.add_Tick({
    Update-WatcherState
    # NotifyIcon.Text throws past 63 characters on some .NET versions --
    # keep these short rather than risk the timer tick crashing silently.
    if ($syncHash.busy) {
      $trayIcon.Icon = New-DotIcon ([System.Drawing.Color]::Orange)
      $trayIcon.Text = "Ollama : GPU sollicite ($($syncHash.gpuUtilizationPercent)%)"
      $statusItem.Text = "Indisponible -- GPU a $($syncHash.gpuUtilizationPercent)%"
    } else {
      $trayIcon.Icon = New-DotIcon ([System.Drawing.Color]::LimeGreen)
      $trayIcon.Text = "Ollama : disponible (GPU $($syncHash.gpuUtilizationPercent)%)"
      $statusItem.Text = "Disponible -- GPU a $($syncHash.gpuUtilizationPercent)%"
    }
  })
  $timer.Start()

  # First reading immediately rather than waiting a full interval.
  Update-WatcherState

  [System.Windows.Forms.Application]::Run()
} catch {
  Write-Error "ollama-watcher tray icon failed to start (no interactive desktop session?): $_"
  Write-Host "Le surveillant continue de tourner sans icone -- le point de statut HTTP reste actif."
  # No interactive desktop (e.g. a misconfigured scheduled task running
  # "whether user is logged on or not") -- keep the process alive anyway so
  # the HTTP status endpoint above still works, just without the tray icon.
  while ($true) {
    Update-WatcherState
    Start-Sleep -Seconds $PollIntervalSeconds
  }
} finally {
  if ($timer) { $timer.Stop() }
  if ($trayIcon) { $trayIcon.Visible = $false; $trayIcon.Dispose() }
  try { $listenerPs.Stop() } catch {}
  try { $runspace.Close() } catch {}
  try { Stop-Transcript | Out-Null } catch {}
}
