param(
    [int]$Port = 9876,
    [string]$DataDir = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# Shipped package: exes sit next to this script. Repo checkout: under publish\win-x64.
$package = $root
if (-not (Test-Path -LiteralPath (Join-Path $package 'AugmentScale.exe'))) {
    $package = Join-Path $root 'publish\win-x64'
}

$appExe = Join-Path $package 'AugmentScale.exe'
$simExe = Join-Path $package 'Simulator\AugmentScale.ScaleSimulator.exe'
$setupTemplate = Join-Path $package 'Resources\setup.json'

if (-not (Test-Path -LiteralPath $appExe)) { throw "AugmentScale.exe not found in $package." }
if (-not (Test-Path -LiteralPath $simExe)) { throw "Simulator not found at $simExe. Publish the simulator into the Simulator subfolder." }
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be between 1 and 65535.' }

$DataDir = if ([string]::IsNullOrWhiteSpace($DataDir)) {
    Join-Path $env:LOCALAPPDATA 'AugmentScale'
}
else {
    [System.IO.Path]::GetFullPath($DataDir)
}

if (Get-Process -Name AugmentScale -ErrorAction SilentlyContinue) {
    throw 'Augment Scale is already running. Close it first.'
}
if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $Port is already in use. Close the other simulator or pass a different -Port."
    }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-Json {
    param([string]$Path, $Object)
    [System.IO.File]::WriteAllText($Path, ($Object | ConvertTo-Json -Depth 10), $utf8NoBom)
}

New-Item -ItemType Directory -Path $DataDir -Force | Out-Null

# The app copies Resources\setup.json into the data directory on first run; do it up front so the port can be set.
$setupPath = Join-Path $DataDir 'setup.json'
if (-not (Test-Path -LiteralPath $setupPath) -or (Get-Item -LiteralPath $setupPath).Length -eq 0) {
    Copy-Item -LiteralPath $setupTemplate -Destination $setupPath -Force
}

$setup = $null
try {
    $setup = Get-Content -LiteralPath $setupPath -Raw | ConvertFrom-Json
}
catch {
    Write-Warning "setup.json is not valid JSON. Replacing with template from Resources\setup.json: $setupPath"
    Copy-Item -LiteralPath $setupTemplate -Destination $setupPath -Force
    $setup = Get-Content -LiteralPath $setupPath -Raw | ConvertFrom-Json
}

if ($null -eq $setup -or $null -eq $setup.scaleConnection) {
    throw "setup.json has no scaleConnection section: $setupPath"
}

$originalPort = [string]$setup.scaleConnection.portName
if ($originalPort.StartsWith('TCP:', [System.StringComparison]::OrdinalIgnoreCase)) {
    # Already in simulator mode; nothing to restore to a real port.
    $originalPort = 'COM1'
}

$setup.scaleConnection.portName = "TCP:127.0.0.1:$Port"
Write-Json -Path $setupPath -Object $setup

# Keep the simulator on the same port: it reloads port/fps/target/scenario from simulator.json.
$simSettingsPath = Join-Path $DataDir 'simulator.json'
$simSettings = [ordered]@{ port = $Port; fps = 15; targetKg = 735; scenario = 'Manual'; motion = $false }
if (Test-Path -LiteralPath $simSettingsPath) {
    try {
        $existing = Get-Content -LiteralPath $simSettingsPath -Raw | ConvertFrom-Json
        foreach ($name in @('fps', 'targetKg', 'scenario', 'motion')) {
            if ($null -ne $existing.$name) { $simSettings[$name] = $existing.$name }
        }
    }
    catch {
        Write-Warning 'simulator.json is invalid; using default simulator settings.'
    }
}
Write-Json -Path $simSettingsPath -Object $simSettings

# Both exes read their config from AUGMENTSCALE_DATA_DIR when set; without it they ignore the edits above.
$env:AUGMENTSCALE_DATA_DIR = $DataDir

$sim = $null
try {
    Write-Host "Data directory : $DataDir"
    Write-Host "Simulator      : 127.0.0.1:$Port"
    Write-Host "Scale port     : TCP until the app exits, then restored to '$originalPort'"
    Write-Host 'Starting simulator...'
    $sim = Start-Process -FilePath $simExe -PassThru
    Start-Sleep -Seconds 2
    if ($sim.HasExited) {
        throw "The simulator exited before the app started. Check that port $Port is free."
    }

    Write-Host 'Starting Augment Scale...'
    $app = Start-Process -FilePath $appExe -PassThru
    $app.WaitForExit()
}
finally {
    if ($sim -and -not $sim.HasExited) {
        Stop-Process -Id $sim.Id -Force
    }

    try {
        $restored = Get-Content -LiteralPath $setupPath -Raw | ConvertFrom-Json
        $restored.scaleConnection.portName = $originalPort
        Write-Json -Path $setupPath -Object $restored
        Write-Host "Restored scale port to '$originalPort'."
    }
    catch {
        Write-Warning "Could not restore scale port to '$originalPort' in $setupPath. Set it manually."
    }
}
