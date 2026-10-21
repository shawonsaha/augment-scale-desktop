[CmdletBinding()]
param(
    [string]$DataDir = '',
    [switch]$ShowKey
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($DataDir)) {
    $DataDir = if (-not [string]::IsNullOrWhiteSpace($env:AUGMENTSCALE_DATA_DIR)) {
        $env:AUGMENTSCALE_DATA_DIR
    } else {
        Join-Path $env:LOCALAPPDATA 'AugmentScale'
    }
}

$dataPath = [System.IO.Path]::GetFullPath($DataDir)
$dbPath = Join-Path $dataPath 'augment-scale.db'
$secretsPath = Join-Path $dataPath 'secrets.dat'

if (-not (Test-Path -LiteralPath $secretsPath)) {
    throw "secrets.dat was not found in '$dataPath'."
}

Add-Type -AssemblyName System.Security

$entropy = [System.Text.Encoding]::UTF8.GetBytes('AugmentScale.Secrets.v1')
$protectedBytes = [System.IO.File]::ReadAllBytes($secretsPath)
$plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $protectedBytes,
    $entropy,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)

try {
    $json = [System.Text.Encoding]::UTF8.GetString($plainBytes)
    $secrets = $json | ConvertFrom-Json
    $key = [string]$secrets.databaseKey

    if ([string]::IsNullOrWhiteSpace($key)) {
        throw 'secrets.dat does not contain a databaseKey value.'
    }

    $dbStatus = if (Test-Path -LiteralPath $dbPath) { '' } else { ' (not found)' }
    Write-Host "Data directory : $dataPath"
    Write-Host "Database       : $dbPath$dbStatus"
    Write-Host "Secrets        : $secretsPath"
    Write-Host "Key length     : $($key.Length) characters (Base64)"

    if ($ShowKey) {
        Write-Output $key
    }
    else {
        Set-Clipboard -Value $key
        Write-Host 'Database key copied to the clipboard.'
    }
}
finally {
    if ($plainBytes) {
        [System.Array]::Clear($plainBytes, 0, $plainBytes.Length)
    }
    $json = $null
    $secrets = $null
    $key = $null
}
