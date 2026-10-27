[CmdletBinding()]
param(
    [string]$SourcePath = '',
    [string]$TargetPath = ''
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($SourcePath)) {
    $SourcePath = Join-Path $env:LOCALAPPDATA 'AugmentScale\augment-scale.db'
}

if ([string]::IsNullOrWhiteSpace($TargetPath)) {
    $TargetPath = Join-Path ([System.Environment]::GetFolderPath('Desktop')) 'augment-scale-plain-v2.db'
}

$scriptPath = Join-Path $PSScriptRoot 'export-plain-db.py'
py $scriptPath $SourcePath $TargetPath
