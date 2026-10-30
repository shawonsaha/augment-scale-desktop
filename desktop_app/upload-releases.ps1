param(
    [Parameter(Mandatory = $false)]
    [string]$ServiceRoleKey = "",
    [string]$SupabaseUrl = "https://fydikuezxmbjnkjyskwi.supabase.co",
    [string]$Bucket = "releases",
    [string]$ReleasesDir = ""
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($ReleasesDir)) {
    $ReleasesDir = Join-Path $root 'releases'
}

if (-not (Test-Path -LiteralPath $ReleasesDir)) {
    throw "Releases directory not found at $ReleasesDir. Run .\publish.ps1 -Pack first."
}

if ([string]::IsNullOrWhiteSpace($ServiceRoleKey)) {
    Write-Host @"
========================================================================
Supabase Releases Upload Helper
========================================================================
To automatically upload releases to Supabase Storage:
1. Open https://supabase.com/dashboard/project/fydikuezxmbjnkjyskwi/settings/api
2. Copy the 'service_role' secret (NOT the anon key).
3. Re-run this script:
   .\upload-releases.ps1 -ServiceRoleKey 'your-service-role-key-here'

OR, manually upload via Supabase Dashboard:
1. Go to https://supabase.com/dashboard/project/fydikuezxmbjnkjyskwi/storage/buckets
2. Create or verify a private bucket named 'releases' ('Public bucket' = OFF).
3. Drag and drop all files from '$ReleasesDir' into the 'releases' bucket.
========================================================================
"@ -ForegroundColor Yellow
    return
}

$headers = @{
    "apikey"        = $ServiceRoleKey
    "Authorization" = "Bearer $ServiceRoleKey"
}

# 1. Ensure bucket exists (Private for security)
Write-Host "`n[1/2] Checking private bucket '$Bucket' on $SupabaseUrl..." -ForegroundColor Cyan
$bucketUrl = "$($SupabaseUrl.TrimEnd('/'))/storage/v1/bucket"
try {
    $buckets = Invoke-RestMethod -Uri $bucketUrl -Method Get -Headers $headers
    $exists = $buckets | Where-Object { $_.name -eq $Bucket -or $_.id -eq $Bucket }
    if (-not $exists) {
        Write-Host "      Bucket '$Bucket' not found. Creating private bucket..." -ForegroundColor Yellow
        $createBody = @{
            id     = $Bucket
            name   = $Bucket
            public = $false # Kept private for workstation security
        } | ConvertTo-Json
        Invoke-RestMethod -Uri $bucketUrl -Method Post -Headers $headers -Body $createBody -ContentType "application/json" | Out-Null
        Write-Host "      Private bucket '$Bucket' created successfully." -ForegroundColor Green
    } else {
        Write-Host "      Bucket '$Bucket' already exists (Private: $(-not $exists.public))." -ForegroundColor Green
    }
} catch {
    Write-Warning "Could not verify/create bucket automatically: $($_.Exception.Message)"
}

# 2. Upload files in releases folder
$files = Get-ChildItem -LiteralPath $ReleasesDir -File | Where-Object {
    $_.Extension -in @('.json', '.nupkg', '.exe', '.zip') -or $_.Name -eq 'RELEASES'
}

Write-Host "`n[2/2] Uploading $($files.Count) release artifacts to bucket '$Bucket'..." -ForegroundColor Cyan

foreach ($file in $files) {
    $fileName = $file.Name
    $fileBytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $uploadUrl = "$($SupabaseUrl.TrimEnd('/'))/storage/v1/object/$Bucket/$fileName"

    $uploadHeaders = @{
        "apikey"        = $ServiceRoleKey
        "Authorization" = "Bearer $ServiceRoleKey"
        "x-upsert"      = "true"
        "Content-Type"  = "application/octet-stream"
    }

    Write-Host "      Uploading $fileName ($([math]::Round($file.Length / 1MB, 2)) MB)..." -NoNewline
    try {
        Invoke-RestMethod -Uri $uploadUrl -Method Post -Headers $uploadHeaders -Body $fileBytes | Out-Null
        Write-Host " OK" -ForegroundColor Green
    } catch {
        Write-Host " FAILED" -ForegroundColor Red
        Write-Warning "Failed to upload $fileName`: $($_.Exception.Message)"
    }
}

Write-Host "`nRelease upload complete! Authenticated private endpoint is ready:" -ForegroundColor Green
Write-Host "$($SupabaseUrl.TrimEnd('/'))/storage/v1/object/authenticated/$Bucket/releases.win.json`n" -ForegroundColor Cyan
