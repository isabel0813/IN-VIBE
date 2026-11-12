[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$ManifestPath, [switch]$Apply)
$ErrorActionPreference = 'Stop'
if (-not $ManifestPath) { $ManifestPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.local/native-host/io.invibe.annyong.youtube.json' }
$manifestPath = (Resolve-Path -LiteralPath $ManifestPath).Path
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.name -ne 'io.invibe.annyong.youtube' -or $manifest.type -ne 'stdio' -or $manifest.allowed_origins.Count -ne 1 -or $manifest.allowed_origins[0] -notmatch '^chrome-extension://[a-p]{32}/$') { throw 'Invalid manifest or non-exclusive extension origin.' }
if (-not (Test-Path -LiteralPath $manifest.path -PathType Leaf)) { throw 'Build the host first.' }
if ([IO.Path]::GetDirectoryName($manifest.path) -ne [IO.Path]::GetDirectoryName($manifestPath)) { throw 'Host and manifest must share a directory.' }
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\io.invibe.annyong.youtube'
$old = if (Test-Path -LiteralPath $registryPath) { (Get-Item -LiteralPath $registryPath).GetValue('') } else { $null }
Write-Output "User registry key: $registryPath"
Write-Output "Existing value: $old"
Write-Output "New value: $manifestPath"
Write-Output "Exact allowed origin: $($manifest.allowed_origins[0])"
if (-not $Apply) { Write-Output 'Preview only. After user approval, pass -Apply to register/update.'; return }
if ($PSCmdlet.ShouldProcess($registryPath, 'Register IN-VIBE Chrome native host for current user')) {
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -LiteralPath $registryPath -Value $manifestPath
}
