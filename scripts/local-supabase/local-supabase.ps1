param(
  [Parameter(Position = 0)]
  [ValidateSet("start", "stop", "reset", "migrate", "seed", "health", "status")]
  [string]$Command = "health",

  [string]$Commit,
  [switch]$Seed,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$ctlPath = Join-Path $PSScriptRoot "ctl.cjs"

$argsList = @($ctlPath, $Command)
if ($Commit) { $argsList += @("--commit", $Commit) }
if ($Seed) { $argsList += "--seed" }
if ($Yes) { $argsList += "--yes" }

& node @argsList
exit $LASTEXITCODE
