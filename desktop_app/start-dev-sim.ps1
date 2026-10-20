param(
    [int]$Port = 9876,
    [string]$DataDir = (Join-Path $env:TEMP 'augment-scale-dev'),
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$appExe = Join-Path $root 'AugmentScale\bin\Debug\net10.0-windows\win-x64\AugmentScale.exe'
$simExe = Join-Path $root 'AugmentScale.ScaleSimulator\bin\Debug\net10.0-windows\win-x64\AugmentScale.ScaleSimulator.exe'

if ($Port -lt 1 -or $Port -gt 65535) {
    throw "Port must be between 1 and 65535."
}

if (-not $NoBuild) {
    Write-Host 'Building the solution...'
    & dotnet build (Join-Path $root 'AugmentScale.slnx') -c Debug
    if ($LASTEXITCODE -ne 0) {
        throw 'Build failed. Close Augment Scale if it is running, then retry.'
    }
}

if (-not (Test-Path -LiteralPath $appExe)) { throw "App not found: $appExe. Run without -NoBuild." }
if (-not (Test-Path -LiteralPath $simExe)) { throw "Simulator not found: $simExe. Run without -NoBuild." }

$DataDir = [System.IO.Path]::GetFullPath($DataDir)
New-Item -ItemType Directory -Path $DataDir -Force | Out-Null

if (Get-Process -Name AugmentScale -ErrorAction SilentlyContinue) {
    throw 'Augment Scale is already running. Close it before starting the simulator launcher.'
}

if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $Port is already in use. Close the other simulator or choose a different -Port."
    }
}

$setupPath = Join-Path $DataDir 'setup.json'
if (-not (Test-Path -LiteralPath $setupPath)) {
    Copy-Item -LiteralPath (Join-Path $root 'AugmentScale\Resources\setup.json') -Destination $setupPath
}

$setup = Get-Content -LiteralPath $setupPath -Raw | ConvertFrom-Json
$setup.scaleConnection.portName = "TCP:127.0.0.1:$Port"
$setup | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $setupPath -Encoding UTF8

$simSettingsPath = Join-Path $DataDir 'simulator.json'
$simSettings = [ordered]@{
    port     = $Port
    fps      = 15
    targetKg = 735
    scenario = 'Manual'
    motion   = $false
}
if (Test-Path -LiteralPath $simSettingsPath) {
    $existing = Get-Content -LiteralPath $simSettingsPath -Raw | ConvertFrom-Json
    foreach ($name in @('fps', 'targetKg', 'scenario', 'motion')) {
        if ($null -ne $existing.$name) { $simSettings[$name] = $existing.$name }
    }
}
$simSettings | ConvertTo-Json | Set-Content -LiteralPath $simSettingsPath -Encoding UTF8

$env:AUGMENTSCALE_DATA_DIR = $DataDir

Write-Host "Test data directory: $DataDir"
Write-Host "Simulator listening on 127.0.0.1:$Port"
Write-Host 'Starting simulator...'
$sim = Start-Process -FilePath $simExe -PassThru

try {
    Start-Sleep -Seconds 2
    if ($sim.HasExited) {
        throw "The simulator exited before the app started. Check that port $Port is free."
    }

    Write-Host 'Starting Augment Scale with the simulator transport...'
    $app = Start-Process -FilePath $appExe -PassThru
    $app.WaitForExit()
}
finally {
    if ($sim -and -not $sim.HasExited) {
        Stop-Process -Id $sim.Id -Force
    }
    Write-Host 'Stopped. Delete the test data directory to reset the test environment.'
}
