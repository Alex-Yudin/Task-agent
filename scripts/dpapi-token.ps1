param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("protect", "unprotect")]
    [string]$Mode
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$Utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $Utf8
[Console]::OutputEncoding = $Utf8
$InputText = [Console]::In.ReadToEnd().Trim()

if ($Mode -eq "protect") {
    $PlainBytes = [System.Text.Encoding]::UTF8.GetBytes($InputText)
    $ProtectedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
        $PlainBytes,
        $null,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [Console]::Out.Write([Convert]::ToBase64String($ProtectedBytes))
    exit 0
}

$ProtectedBytes = [Convert]::FromBase64String($InputText)
$PlainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $ProtectedBytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($PlainBytes))
