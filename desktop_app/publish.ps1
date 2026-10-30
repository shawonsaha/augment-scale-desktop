[CmdletBinding()]
param(
    [ValidateSet('Release', 'Debug')]
    [string]$Configuration = 'Release',

    [string]$Runtime = 'win-x64',

    [string]$OutputDir = '',

    [switch]$SelfContained,

    [switch]$NoZip,

    [string]$AppVersion = '1.0.0',

    [switch]$Pack,

    [switch]$CleanReleases,

    [string]$SupabaseUrl = 'https://fydikuezxmbjnkjyskwi.supabase.co',

    [Alias('SupabaseApiKey', 'SupabasePublishableKey')]
    [string]$SupabaseAnonKey = '',

    [string]$UpdateUrl = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# Auto-discover Supabase credentials from dashboard-web/.env.local if not provided
$envLocalPath = Join-Path $root '..\dashboard-web\.env.local'
if (Test-Path -LiteralPath $envLocalPath) {
    $envLines = Get-Content -LiteralPath $envLocalPath
    foreach ($line in $envLines) {
        if ($line -match '^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*(.+)$' -and [string]::IsNullOrWhiteSpace($SupabaseUrl)) {
            $SupabaseUrl = $matches[1].Trim().Trim('"').Trim("'")
        }
        if (($line -match '^\s*NEXT_PUBLIC_SUPABASE_ANON_KEY\s*=\s*(.+)$' -or $line -match '^\s*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\s*=\s*(.+)$') -and [string]::IsNullOrWhiteSpace($SupabaseAnonKey)) {
            $SupabaseAnonKey = $matches[1].Trim().Trim('"').Trim("'")
        }
    }
}

# Fallback project defaults if .env.local not found
if ([string]::IsNullOrWhiteSpace($SupabaseUrl)) {
    $SupabaseUrl = 'https://fydikuezxmbjnkjyskwi.supabase.co'
}
if ([string]::IsNullOrWhiteSpace($SupabaseAnonKey)) {
    $SupabaseAnonKey = 'sb_publishable_T3J6isINyJ88kgJEkmv2-Q_NeEZY25t'
}

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $root "publish\$Runtime"
}
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$zipPath = "$OutputDir.zip"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "AugmentScale Clean & Republish Pipeline" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Configuration  : $Configuration"
Write-Host "Runtime        : $Runtime"
Write-Host "Self-Contained : $SelfContained"
Write-Host "Output Dir     : $OutputDir"
Write-Host "Create Zip     : $(-not $NoZip)"
Write-Host ""

# Check and close running processes to avoid file lock errors
$running = Get-Process -Name AugmentScale, AugmentScale.ScaleSimulator -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "Detected running process(es): $(($running.Name | Select-Object -Unique) -join ', ') (PID: $(($running.Id) -join ', ')). Attempting to close..." -ForegroundColor Yellow
    try {
        $running | Stop-Process -Force -ErrorAction Stop
        Start-Sleep -Milliseconds 500
        Write-Host "      Processes terminated successfully." -ForegroundColor Green
    } catch {
        Write-Warning "Could not automatically terminate running processes ($($_.Exception.Message)). Please ensure they are closed if file lock errors occur."
    }
}

# 1. Clean existing publish directory
if (Test-Path -LiteralPath $OutputDir) {
    Write-Host "[1/4] Deleting existing publish directory: $OutputDir..." -ForegroundColor Yellow
    Remove-Item -LiteralPath $OutputDir -Recurse -Force
    Write-Host "      Cleaned successfully." -ForegroundColor Green
} else {
    Write-Host "[1/4] Publish directory does not exist yet (clean start)." -ForegroundColor Gray
}

# Clean existing zip if creating a new one
if (-not $NoZip -and (Test-Path -LiteralPath $zipPath)) {
    Write-Host "      Removing old zip archive: $zipPath..." -ForegroundColor Yellow
    Remove-Item -LiteralPath $zipPath -Force
}

# 2. Publish Main App (AugmentScale)
$appProject = Join-Path $root 'AugmentScale\AugmentScale.csproj'
if (-not (Test-Path -LiteralPath $appProject)) {
    throw "Project file not found: $appProject"
}

Write-Host "`n[2/4] Publishing AugmentScale..." -ForegroundColor Cyan
$selfContainedValue = if ($SelfContained) { 'true' } else { 'false' }
dotnet publish $appProject -c $Configuration -r $Runtime --self-contained $selfContainedValue -o $OutputDir
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish for AugmentScale failed with exit code $LASTEXITCODE"
}

# 3. Publish ScaleSimulator into Simulator/
$simProject = Join-Path $root 'AugmentScale.ScaleSimulator\AugmentScale.ScaleSimulator.csproj'
if (Test-Path -LiteralPath $simProject) {
    Write-Host "`n[3/4] Publishing ScaleSimulator..." -ForegroundColor Cyan
    $simOutputDir = Join-Path $OutputDir 'Simulator'
    dotnet publish $simProject -c $Configuration -r $Runtime --self-contained $selfContainedValue -o $simOutputDir
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish for AugmentScale.ScaleSimulator failed with exit code $LASTEXITCODE"
    }
} else {
    Write-Host "`n[3/4] ScaleSimulator project not found, skipping." -ForegroundColor Yellow
}

# Copy auxiliary launcher scripts into the published directory
$launcherPs1 = Join-Path $root 'Run-With-Simulator.ps1'
$launcherCmd = Join-Path $root 'Run-With-Simulator.cmd'
if (Test-Path -LiteralPath $launcherPs1) {
    Copy-Item -LiteralPath $launcherPs1 -Destination $OutputDir -Force
}
if (Test-Path -LiteralPath $launcherCmd) {
    Copy-Item -LiteralPath $launcherCmd -Destination $OutputDir -Force
}

# Provision Cloud Credentials in published Resources\setup.json
$publishedSetup = Join-Path $OutputDir 'Resources\setup.json'
if ((Test-Path -LiteralPath $publishedSetup) -and (-not [string]::IsNullOrWhiteSpace($SupabaseUrl))) {
    Write-Host "`n      Injecting cloud credentials into published package..." -ForegroundColor Cyan
    $setupContent = Get-Content -LiteralPath $publishedSetup -Raw | ConvertFrom-Json
    $setupContent.cloud.supabaseUrl = $SupabaseUrl
    $setupContent.cloud.supabaseAnonKey = $SupabaseAnonKey
    if (-not [string]::IsNullOrWhiteSpace($UpdateUrl)) {
        $setupContent.cloud.updateUrl = $UpdateUrl
    } else {
        $setupContent.cloud.updateUrl = "$($SupabaseUrl.TrimEnd('/'))/storage/v1/object/authenticated/releases"
    }
    $setupJsonStr = $setupContent | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($publishedSetup, $setupJsonStr, [System.Text.Encoding]::UTF8)
    Write-Host "      Cloud credentials provisioned successfully." -ForegroundColor Green
}

# 4. Create zip archive (unless -NoZip specified) with retry logic
if (-not $NoZip) {
    Write-Host "`n[4/4] Creating distribution archive: $zipPath..." -ForegroundColor Cyan
    $maxRetries = 5
    $delaySeconds = 1
    $archived = $false

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            if (Test-Path -LiteralPath $zipPath) {
                Remove-Item -LiteralPath $zipPath -Force
            }
            # Brief pause to allow background file scanners (e.g. Defender/indexer) to release newly written files
            Start-Sleep -Milliseconds 500
            Compress-Archive -Path $OutputDir -DestinationPath $zipPath -Force
            $archived = $true
            break
        } catch {
            if ($attempt -eq $maxRetries) {
                throw
            }
            Write-Warning "Archive creation temporarily blocked (attempt $attempt/$maxRetries): $($_.Exception.Message). Retrying in $delaySeconds s..."
            Start-Sleep -Seconds $delaySeconds
        }
    }

    if ($archived) {
        Write-Host "      Archive created successfully: $zipPath" -ForegroundColor Green
    }
} else {
    Write-Host "`n[4/4] Skipping zip archive creation (-NoZip)." -ForegroundColor Gray
}

# 5. Velopack Release & Installer Generation
if ($Pack) {
    Write-Host "`n[5/5] Packaging Velopack release & installer..." -ForegroundColor Cyan
    $releasesDir = Join-Path $root 'releases'
    if ($CleanReleases -and (Test-Path -LiteralPath $releasesDir)) {
        Write-Host "      Cleaning releases directory: $releasesDir..." -ForegroundColor Yellow
        Remove-Item -LiteralPath $releasesDir -Recurse -Force
    }
    if (-not (Test-Path -LiteralPath $releasesDir)) {
        New-Item -ItemType Directory -Path $releasesDir -Force | Out-Null
    }
    
    $iconPath = Join-Path $root 'AugmentScale\Resources\app.ico'
    $vpkArgs = @(
        'pack',
        '-u', 'AugmentScale',
        '-v', $AppVersion,
        '-p', $OutputDir,
        '-e', 'AugmentScale.exe',
        '-o', $releasesDir,
        '-r', $Runtime,
        '--packTitle', 'Augment Scale Workstation'
    )
    if (Test-Path -LiteralPath $iconPath) {
        $vpkArgs += @('-i', $iconPath)
    }

    Write-Host "Running: vpk $($vpkArgs -join ' ')" -ForegroundColor Gray
    & vpk @vpkArgs
    if ($LASTEXITCODE -ne 0) {
        throw "vpk pack failed with exit code $LASTEXITCODE"
    }
    Write-Host "      Velopack packages created in: $releasesDir" -ForegroundColor Green
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "Republish completed successfully!" -ForegroundColor Green
Write-Host "Output location: $OutputDir" -ForegroundColor Green
if (-not $NoZip) {
    Write-Host "Zip location   : $zipPath" -ForegroundColor Green
}
Write-Host "========================================" -ForegroundColor Green
