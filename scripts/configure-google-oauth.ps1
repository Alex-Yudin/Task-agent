param(
    [string]$Source = ""
)

$ErrorActionPreference = "Stop"
$RootDirectory = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($Source)) {
    Add-Type -AssemblyName System.Windows.Forms
    $Dialog = New-Object System.Windows.Forms.OpenFileDialog
    $Dialog.Title = "Select Google OAuth Client JSON"
    $Dialog.Filter = "Google OAuth JSON (*.json)|*.json|All files (*.*)|*.*"
    $Dialog.Multiselect = $false
    if ($Dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        throw "OAuth Client JSON was not selected."
    }
    $Source = $Dialog.FileName
}

$Source = [IO.Path]::GetFullPath($Source)
if (-not [IO.File]::Exists($Source)) {
    throw "File not found: $Source"
}

$Raw = [IO.File]::ReadAllText($Source, [Text.Encoding]::UTF8)
$Json = $Raw | ConvertFrom-Json
$Client = if ($null -ne $Json.installed) { $Json.installed } elseif ($null -ne $Json.web) { $Json.web } else { $Json }

if ([string]::IsNullOrWhiteSpace([string]$Client.client_id)) {
    throw "The selected JSON does not contain client_id."
}
if ([string]::IsNullOrWhiteSpace([string]$Client.client_secret)) {
    throw "The selected JSON does not contain client_secret. Download the complete OAuth Client JSON from Google Cloud."
}

$PlainBytes = [Text.Encoding]::UTF8.GetBytes($Raw)
$ProtectedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
    $PlainBytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
$Destination = Join-Path $RootDirectory "data\google-oauth-client.dat"
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Destination)) | Out-Null
[IO.File]::WriteAllText($Destination, [Convert]::ToBase64String($ProtectedBytes), (New-Object Text.UTF8Encoding($false)))

Write-Host "Configured Client ID: $($Client.client_id)"
Write-Host "Credentials were encrypted with Windows DPAPI for the current user."
