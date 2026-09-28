<#
.SYNOPSIS
  Runs the ORIGINAL Chainmate capture tours (built into the game's autopilot) and stores the
  reference screenshots under _ref/<mode>. These PNGs are the visual oracle the JS port is compared to.

.DESCRIPTION
  The Godot build ships an autopilot that, with `-- --capture --out=<dir>`, plays a scripted tour and
  saves a PNG per milestone. Extra flags pick a narrower tour: --arena, --pieces, --relics, --menu.
  The window is parked off-screen and audio goes to the Dummy driver so the tour never disturbs the desktop.

  Repeatable by default: every frame advances exactly 1/FixedFps s (--fixed-fps, the port's capture
  clock) and the engine's global random stream starts from GlobalSeed instead of the clock (banner
  waves, candle flames, piece idle phases). Seeding needs the oracle build (_oracle/ChainmateOracle.exe,
  tools/oracle.mjs --rebuild) running _oracle/probe_tour.gd; the port takes the same seed as ?rngseed=.
  -FixedFps 0 -GlobalSeed 0 reproduces a plain real-time launch of the shipped exe.

  -Trace adds the probe's TRACE lines (piece idle phases, halos at every shot) to the stdout log;
  pair it with -RefRoot so the references stay untouched, then line both builds up with
  tools/trace-compare.mjs.

.EXAMPLE
  pwsh -File tools/capture-original.ps1 -Modes full,arena,pieces,relics,menu
  pwsh -File tools/capture-original.ps1 -Modes full -FixedFps 0 -GlobalSeed 0     # real time, clock seed
  pwsh -File tools/capture-original.ps1 -Modes pieces -Trace -RefRoot _ref/trace  # state trace, scratch shots
  pwsh -File tools/capture-original.ps1 -Modes full -Acts 1 -Trace -RefRoot _ref/trace
#>
param(
    [string[]] $Modes = @('arena', 'pieces', 'relics', 'menu'),
    [string]   $Exe = "$env:USERPROFILE\Downloads\Chainmate.exe",
    [int]      $FixedFps = 60,
    [int]      $GlobalSeed = 7,
    [int]      $TimeoutSeconds = 1200,
    [string]   $RefRoot = '',
    [switch]   $Trace,
    [int]      $Acts = 0
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$refRoot = if ($RefRoot) { [System.IO.Path]::GetFullPath((Join-Path $root $RefRoot)) } else { Join-Path $root '_ref' }
$logRoot = Join-Path $refRoot 'logs'
$oracleExe = Join-Path $root '_oracle\ChainmateOracle.exe'
$tourProbe = Join-Path $root '_oracle\probe_tour.gd'
New-Item -ItemType Directory -Force $logRoot | Out-Null

# One entry per tour: the autopilot flag and the folder the PNGs land in.
$TOUR_FLAGS = @{ full = @(); arena = @('--arena'); pieces = @('--pieces'); relics = @('--relics'); menu = @('--menu') }

# The engine flags every tour shares: off-screen window, silent audio, and the clock.
$engineArgs = @('--audio-driver', 'Dummy', '--position', '2600,60')
if ($FixedFps -gt 0) { $engineArgs += @('--fixed-fps', "$FixedFps") }
# A seeded global stream needs the oracle build and its tour probe; the plain exe otherwise.
$gameArgs = @()
if ($GlobalSeed -gt 0) {
    if (-not (Test-Path $oracleExe)) { throw "Seeding needs $oracleExe (node tools/oracle.mjs --rebuild)" }
    if (-not (Test-Path $tourProbe)) { throw "Seeding needs $tourProbe" }
    $Exe = $oracleExe
    $gameArgs += @('--oracle=' + ($tourProbe -replace '\\', '/'), "--rngseed=$GlobalSeed")
}
if ($Trace) {
    if ($GlobalSeed -le 0) { throw '-Trace runs inside the tour probe: it needs -GlobalSeed > 0' }
    $gameArgs += @('--trace')
}
if (-not (Test-Path $Exe)) { throw "No game build at $Exe" }

$summary = @()
# `pwsh -File script.ps1 -Modes a,b` hands the list over as ONE string: split it here.
$Modes = @($Modes | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($mode in $Modes) {
    if (-not $TOUR_FLAGS.ContainsKey($mode)) { throw "Unknown tour mode '$mode' (known: $($TOUR_FLAGS.Keys -join ', '))" }
    $out = Join-Path $refRoot $mode
    if ($mode -eq 'full') { $out = Join-Path $refRoot 'tour' }
    New-Item -ItemType Directory -Force $out | Out-Null
    $outArg = '--out=' + ($out -replace '\\', '/')
    $arguments = $engineArgs + @('--') + $gameArgs + @('--capture', $outArg) + $TOUR_FLAGS[$mode]
    # -Acts N: the full tour stops after N acts (autopilot.gd --acts=), like the port's `tour --acts N`.
    if ($Acts -gt 0) { $arguments += @("--acts=$Acts") }
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

$clock = if ($FixedFps -gt 0) { "fixed $FixedFps fps" } else { 'real time' }
$stream = if ($GlobalSeed -gt 0) { "global seed $GlobalSeed" } else { 'clock seed' }
Write-Host ''
Write-Host '  ╭─ original capture tours ───────────────────────────────────────────╮' -ForegroundColor DarkGray
foreach ($row in $summary) {
    Write-Host ('  │ {0,-8} {1,4} shots {2,5}s  {3}' -f $row.Tour, $row.Shots, $row.Seconds, $row.Result) -ForegroundColor Gray
}
Write-Host ('  │ {0}  ·  {1}' -f $clock, $stream) -ForegroundColor DarkGray
Write-Host '  ╰────────────────────────────────────────────────────────────────────╯' -ForegroundColor DarkGray
