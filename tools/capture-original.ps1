<#
.SYNOPSIS
  Runs the ORIGINAL Chainmate.exe capture tours (built into the game's autopilot) and stores the
  reference screenshots under _ref/<mode>. These PNGs are the visual oracle the JS port is compared to.

.DESCRIPTION
  The Godot build ships an autopilot that, with `-- --capture --out=<dir>`, plays a scripted tour and
  saves a PNG per milestone. Extra flags pick a narrower tour: --arena, --pieces, --relics, --menu.
  The window is parked off-screen and audio goes to the Dummy driver so the tour never disturbs the desktop.

.EXAMPLE
  pwsh -File tools/capture-original.ps1 -Modes arena,pieces,relics,menu
#>
param(
    [string[]] $Modes = @('arena', 'pieces', 'relics', 'menu'),
    [string]   $Exe = "$env:USERPROFILE\Downloads\Chainmate.exe",
    [int]      $TimeoutSeconds = 600
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$refRoot = Join-Path $root '_ref'
$logRoot = Join-Path $refRoot 'logs'
New-Item -ItemType Directory -Force $logRoot | Out-Null

# One entry per tour: the autopilot flag and the folder the PNGs land in.
$TOUR_FLAGS = @{ full = @(); arena = @('--arena'); pieces = @('--pieces'); relics = @('--relics'); menu = @('--menu') }

$summary = @()
# `pwsh -File script.ps1 -Modes a,b` hands the list over as ONE string: split it here.
$Modes = @($Modes | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($mode in $Modes) {
    if (-not $TOUR_FLAGS.ContainsKey($mode)) { throw "Unknown tour mode '$mode' (known: $($TOUR_FLAGS.Keys -join ', '))" }
    $out = Join-Path $refRoot $mode
    if ($mode -eq 'full') { $out = Join-Path $refRoot 'tour' }
    New-Item -ItemType Directory -Force $out | Out-Null
    $outArg = '--out=' + ($out -replace '\\', '/')
    $arguments = @('--audio-driver', 'Dummy', '--position', '2600,60', '--', '--capture', $outArg) + $TOUR_FLAGS[$mode]
    $stdout = Join-Path $logRoot "$mode.out.txt"
    $stderr = Join-Path $logRoot "$mode.err.txt"
    Write-Host ("  ▸ tour {0,-7} → {1}" -f $mode, $out) -ForegroundColor Cyan
    $started = Get-Date
    $process = Start-Process -FilePath $Exe -ArgumentList $arguments -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    # WaitForExit instead of -Wait: pwsh's -Wait also waits on grandchildren (lesson from build-apk.ps1).
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill()
        Write-Host "    ✗ timed out after $TimeoutSeconds s" -ForegroundColor Red
    }
    $elapsed = [int]((Get-Date) - $started).TotalSeconds
    $shots = (Get-ChildItem $out -Filter *.png -ErrorAction SilentlyContinue | Measure-Object).Count
    $done = Select-String -Path $stdout -Pattern 'TOUR DONE.*' -ErrorAction SilentlyContinue | Select-Object -Last 1
    $summary += [pscustomobject]@{ Tour = $mode; Shots = $shots; Seconds = $elapsed; Result = if ($done) { $done.Matches[0].Value } else { 'no TOUR DONE line' } }
}

Write-Host ''
Write-Host '  ╭─ original capture tours ───────────────────────────────────────────╮' -ForegroundColor DarkGray
foreach ($row in $summary) {
    Write-Host ('  │ {0,-8} {1,4} shots {2,5}s  {3}' -f $row.Tour, $row.Shots, $row.Seconds, $row.Result) -ForegroundColor Gray
}
Write-Host '  ╰────────────────────────────────────────────────────────────────────╯' -ForegroundColor DarkGray
