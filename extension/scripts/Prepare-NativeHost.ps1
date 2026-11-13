[CmdletBinding()]
param([ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
$ErrorActionPreference = 'Stop'
$extensionRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = Split-Path $extensionRoot -Parent
if (-not $ExtensionId) {
    $ExtensionId = (& node (Join-Path $PSScriptRoot 'extension-id.mjs')).Trim()
    if ($LASTEXITCODE -ne 0 -or $ExtensionId -notmatch '^[a-p]{32}$') { throw 'Cannot determine extension ID.' }
}
Push-Location (Join-Path $repoRoot 'frontend')
try {
    & node scripts/desktop.mjs host:build --release --offline
    if ($LASTEXITCODE -ne 0) { throw 'Native host build failed.' }
} finally { Pop-Location }
$outputDir = Join-Path $extensionRoot '.local/native-host'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$hostPath = Join-Path $outputDir 'in-vibe-native-host.exe'
Copy-Item -LiteralPath (Join-Path $repoRoot 'frontend/src-tauri/target/release/in-vibe-native-host.exe') -Destination $hostPath -Force
$manifestPath = Join-Path $outputDir 'io.invibe.annyong.youtube.json'
$manifest = [ordered]@{ name = 'io.invibe.annyong.youtube'; description = 'IN-VIBE local YouTube observer'; path = $hostPath; type = 'stdio'; allowed_origins = @("chrome-extension://$ExtensionId/") }
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-Output "Prepared only (registry unchanged): $manifestPath"
Write-Output "Allowed extension ID: $ExtensionId"
