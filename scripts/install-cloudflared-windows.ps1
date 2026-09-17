param(
  [Parameter(Mandatory = $true)]
  [string]$TunnelToken,

  [string]$CloudflaredPath = "cloudflared.exe"
)

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
  throw "Run this script from an elevated PowerShell session."
}

if ($TunnelToken.Length -lt 16) {
  throw "Tunnel token is unexpectedly short. Copy the full token from Cloudflare."
}

$version = & $CloudflaredPath --version
Write-Host "Using $version"
& $CloudflaredPath service install $TunnelToken
Write-Host "cloudflared Windows Service installed. Verify in Cloudflare Tunnels and with: sc.exe query cloudflared"
