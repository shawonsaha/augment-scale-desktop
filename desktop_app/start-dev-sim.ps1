param(
    [int]$Port = 9876,
    [string]$DataDir = '',
    [switch]$UseProductionData,
    [switch]$BackupDatabase,
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$appExe = Join-Path $root 'AugmentScale\bin\Debug\net10.0-windows\win-x64\AugmentScale.exe'
$simExe = Join-Path $root 'AugmentScale.ScaleSimulator\bin\Debug\net10.0-windows\win-x64\AugmentScale.ScaleSimulator.exe'
$productionDataDir = Join-Path $env:LOCALAPPDATA 'AugmentScale'

if ($Port -lt 1 -or $Port -gt 65535) {
    throw "Port must be between 1 and 65535."
}

if (-not [string]::IsNullOrWhiteSpace($DataDir)) {
    $DataDir = [System.IO.Path]::GetFullPath($DataDir)
}
elseif ($UseProductionData) {
    $DataDir = [System.IO.Path]::GetFullPath($productionDataDir)
}
else {
    $DataDir = [System.IO.Path]::GetFullPath((Join-Path $env:TEMP 'augment-scale-dev'))
}

$productionPath = [System.IO.Path]::GetFullPath($productionDataDir)
$isProductionData = $DataDir.Equals($productionPath, [System.StringComparison]::OrdinalIgnoreCase)
$databasePath = Join-Path $DataDir 'augment-scale.db'
$modeLabel = if ($isProductionData) { 'LIVE DATABASE' } else { 'ISOLATED TEST DATA' }
$setupPath = Join-Path $DataDir 'setup.json'
$simSettingsPath = Join-Path $DataDir 'simulator.json'
$backupRoot = Join-Path $productionDataDir 'backups'

if (Get-Process -Name AugmentScale -ErrorAction SilentlyContinue) {
    throw 'Augment Scale is already running. Close it before starting the simulator launcher.'
}

if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $Port is already in use. Close the other simulator or choose a different -Port."
    }
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

New-Item -ItemType Directory -Path $DataDir -Force | Out-Null

Write-Host "Mode           : $modeLabel"
Write-Host "Data directory : $DataDir"
if (Test-Path -LiteralPath $databasePath) {
    $database = Get-Item -LiteralPath $databasePath
    Write-Host ("Database       : {0} ({1:N0} bytes, modified {2})" -f $database.FullName, $database.Length, $database.LastWriteTime)
}
else {
    Write-Host "Database       : $databasePath (will be created on first launch)"
}
if ($isProductionData) {
    Write-Warning 'This run writes to the live database: vehicles, tickets, audit events, and outbox events are real.'
}

$backupDir = $null
if ($BackupDatabase) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupDir = Join-Path $backupRoot $stamp
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

    foreach ($name in @('augment-scale.db', 'secrets.dat', 'setup.json', 'simulator.json')) {
        $source = Join-Path $DataDir $name
        if (Test-Path -LiteralPath $source) {
            Copy-Item -LiteralPath $source -Destination (Join-Path $backupDir $name)
        }
    }
    foreach ($suffix in @('-wal', '-shm')) {
        $source = Join-Path $DataDir ('augment-scale.db' + $suffix)
        if (Test-Path -LiteralPath $source) {
            Copy-Item -LiteralPath $source -Destination (Join-Path $backupDir ('augment-scale.db' + $suffix))
        }
    }

    if (-not (Test-Path -LiteralPath (Join-Path $backupDir 'augment-scale.db'))) {
        Write-Warning "No augment-scale.db was found in '$DataDir'; the application will create a new database."
    }
    Write-Host "Backup         : $backupDir"
}

if (-not (Test-Path -LiteralPath $setupPath)) {
    Copy-Item -LiteralPath (Join-Path $root 'AugmentScale\Resources\setup.json') -Destination $setupPath
}

$setup = Get-Content -LiteralPath $setupPath -Raw | ConvertFrom-Json
if ($null -eq $setup -or $null -eq $setup.scaleConnection) {
    throw "setup.json does not contain a scaleConnection section: $setupPath"
}

$originalPortName = [string]$setup.scaleConnection.portName
if ([string]::IsNullOrWhiteSpace($originalPortName)) {
    throw "setup.json does not contain a scaleConnection.portName value: $setupPath"
}

$restoreScaleConfig = $true
$setup.scaleConnection.portName = "TCP:127.0.0.1:$Port"
$setup | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $setupPath -Encoding UTF8
$sim = $null

try {
    $simSettings = [ordered]@{
        port     = $Port
        fps      = 15
        targetKg = 735
        scenario = 'Manual'
        motion   = $false
    }
    if (Test-Path -LiteralPath $simSettingsPath) {
        try {
            $existing = Get-Content -LiteralPath $simSettingsPath -Raw | ConvertFrom-Json
            foreach ($name in @('fps', 'targetKg', 'scenario', 'motion')) {
                if ($null -ne $existing.$name) { $simSettings[$name] = $existing.$name }
            }
        }
        catch {
            Write-Warning "simulator.json is invalid; using default simulator settings."
        }
    }
    $simSettings | ConvertTo-Json | Set-Content -LiteralPath $simSettingsPath -Encoding UTF8

    $env:AUGMENTSCALE_DATA_DIR = $DataDir

    Write-Host "Simulator      : 127.0.0.1:$Port"
    Write-Host "Scale config   : TCP until the app exits, then restore to '$originalPortName'"
    Write-Host 'Starting simulator...'
    $sim = Start-Process -FilePath $simExe -PassThru

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

    if ($restoreScaleConfig) {
        try {
            $restored = Get-Content -LiteralPath $setupPath -Raw | ConvertFrom-Json
            if ($null -eq $restored -or $null -eq $restored.scaleConnection) {
                throw 'setup.json no longer contains a scaleConnection section.'
            }
            $restored.scaleConnection.portName = $originalPortName
            $restored | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $setupPath -Encoding UTF8
            Write-Host "Restored scale port to '$originalPortName' in $setupPath"
        }
        catch {
            Write-Warning "Could not restore scaleConnection.portName to '$originalPortName' in $setupPath. $($_.Exception.Message)"
            if ($backupDir) {
                Write-Warning "A pre-run backup is available at $backupDir"
            }
            else {
                Write-Warning "Edit $setupPath manually and set scaleConnection.portName to '$originalPortName'."
            }
        }
    }

    if ($isProductionData) {
        Write-Host "Stopped. Live database retained at $databasePath"
    }
    else {
        Write-Host 'Stopped. Delete the test data directory to reset the test environment.'
    }
}
