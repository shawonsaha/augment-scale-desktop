<#
.SYNOPSIS
    Augment Scale — Offline Desktop Database Restore Tool
.DESCRIPTION
    Restores an offline Augment Scale SQLite database from a backup downloaded
    from the Augment Scale Web Dashboard.
    Ensures safety by creating a pre-restore timestamped backup of the current database.
#>

[CmdletBinding()]
param(
    [string]$BackupFilePath = "",
    [string]$DataDir = ""
)

$ErrorActionPreference = "Stop"

# 1. Determine Augment Scale Data Directory
if ([string]::IsNullOrWhiteSpace($DataDir)) {
    $DataDir = if ($env:AUGMENTSCALE_DATA_DIR) { $env:AUGMENTSCALE_DATA_DIR } else { Join-Path $env:LOCALAPPDATA "AugmentScale" }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Augment Scale — Offline Database Restore Tool" -ForegroundColor Cyan
Write-Host "Data Directory: $DataDir" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

# 2. Check if desktop application is currently running
$running = Get-Process -Name "AugmentScale" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "ERROR: Augment Scale desktop application is currently RUNNING." -ForegroundColor Red
    Write-Host "Please close Augment Scale before restoring the database." -ForegroundColor Yellow
    exit 1
}

# 3. Locate downloaded backup file if not provided
if ([string]::IsNullOrWhiteSpace($BackupFilePath)) {
    $downloadsFolder = Join-Path $env:USERPROFILE "Downloads"
    $candidateFiles = Get-ChildItem -Path $downloadsFolder -Filter "augment-scale-cloud-backup-*.db" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending

    if ($candidateFiles -and $candidateFiles.Count -gt 0) {
        $BackupFilePath = $candidateFiles[0].FullName
    } else {
        # Check for plain .db or .json
        $genericDb = Join-Path $downloadsFolder "augment-scale-cloud-backup.db"
        if (Test-Path $genericDb) {
            $BackupFilePath = $genericDb
        }
    }
}

if (-not (Test-Path $BackupFilePath)) {
    Write-Host "ERROR: Backup file not found." -ForegroundColor Red
    Write-Host "Please download the backup from the Web Dashboard (Dashboard -> Backup & Restore -> Download .db File)." -ForegroundColor Yellow
    Write-Host "Or specify the path: .\Restore-FromWebBackup.ps1 -BackupFilePath 'C:\path\to\backup.db'" -ForegroundColor Yellow
    exit 1
}

Write-Host "Source Backup: $BackupFilePath" -ForegroundColor Green
$sourceSize = (Get-Item $BackupFilePath).Length
Write-Host "Backup Size:   $("{0:N0}" -f $sourceSize) bytes" -ForegroundColor Gray

# 4. Create pre-restore safety backup
$currentDb = Join-Path $DataDir "augment-scale.db"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$safetyBackupDir = Join-Path $DataDir "backups\pre-restore-$timestamp"

if (Test-Path $currentDb) {
    New-Item -ItemType Directory -Path $safetyBackupDir -Force | Out-Null
    Copy-Item -Path $currentDb -Destination $safetyBackupDir -Force
    Write-Host "Created safety snapshot of existing DB at:" -ForegroundColor DarkGray
    Write-Host "  $safetyBackupDir" -ForegroundColor DarkGray
}

# 5. Restore database file
Copy-Item -Path $BackupFilePath -Destination $currentDb -Force

Write-Host "`nSUCCESS: Database successfully restored!" -ForegroundColor Green
Write-Host "Destination: $currentDb" -ForegroundColor Green
Write-Host "You can now launch the Augment Scale desktop application." -ForegroundColor Cyan
