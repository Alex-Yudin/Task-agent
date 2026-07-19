$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Url = (Read-Host "Paste the deployed Google Apps Script URL ending in /exec").Trim()
$Secret = (Read-Host "Paste the Orbita sync secret").Trim()

if ($Url -notmatch '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$') {
    throw "Invalid URL. Use the deployed Web app URL ending in /exec."
}
if ($Secret.Length -lt 24) {
    throw "The sync secret must contain at least 24 characters."
}

$DataDirectory = Join-Path $Root "data"
$ConfigPath = Join-Path $DataDirectory "google-sheets-sync.json"
New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
$Json = @{ webAppUrl = $Url; secret = $Secret } | ConvertTo-Json
[System.IO.File]::WriteAllText($ConfigPath, $Json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ""
Write-Host "Google Sheets sync is configured: $ConfigPath"
Write-Host "Restart start-windows.cmd, then create or update a task."
