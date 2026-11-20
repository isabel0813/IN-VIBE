param([string]$Repo, [string]$Fixture, [string]$Scenario, [string]$Channel, [string]$Expected)
$ErrorActionPreference = 'Stop'
$script:NativeKey = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\io.invibe.annyong.youtube'
$hostName = 'io.invibe.annyong.youtube'
$official = 'nndjojfhmpbolfifcfdcpalcloanppod'
$development = 'ohajfkkemocajnjlbnogdmoominkejci'
$extensionId = if ($Channel -eq 'development') { $development } else { $official }
$env:LOCALAPPDATA = Join-Path $Fixture 'localappdata'
$installRoot = Join-Path $env:LOCALAPPDATA 'Mobonyong\NativeHost'
$scripts = Join-Path $Fixture 'scripts'
$runtime = Join-Path $Fixture 'native-host-runtime'
New-Item -ItemType Directory -Path $scripts,$runtime -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $Repo 'frontend/src-tauri/windows/Auto-Register-Host.ps1') -Destination $scripts
foreach ($name in @('Configure-DownloadedHost.ps1','Register-NativeHost.ps1')) {
  Copy-Item -LiteralPath (Join-Path $Repo "extension/scripts/$name") -Destination $scripts
}
$payload = Join-Path $runtime 'in-vibe-native-host.exe'
[IO.File]::WriteAllText($payload, 'synthetic Host bytes, never executed')
$digest = (Get-FileHash -LiteralPath $payload).Hash.ToLowerInvariant()
@{version='0.3.2';source_commit='1797eafb866b6c6b97b0a160e487de92de820b0e';sha256=$digest} |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'HOST-BUILD.json') -Encoding UTF8
$destination = Join-Path $installRoot "0.3.2-$($digest.Substring(0,16))-$extensionId"
$oldManifest = $null
$oldDigest = $null
if ($Scenario -notin @('fresh','tampered-payload')) {
  $oldRoot = switch ($Scenario) {
    'repair' { $destination }
    'tampered-host' { $destination }
    'source-repair' { Join-Path $Fixture 'checkout\extension\.local\native-host' }
    default { Join-Path $installRoot '0.3.1-d3547d0' }
  }
  New-Item -ItemType Directory -Path $oldRoot -Force | Out-Null
  $oldManifest = Join-Path $oldRoot "$hostName.json"
  $oldExe = Join-Path $oldRoot 'in-vibe-native-host.exe'
  $data = [ordered]@{
    name=$hostName; description='Mobonyong YouTube observer'; type='stdio'
    allowed_origins=@("chrome-extension://$extensionId/"); path=$oldExe
  }
  switch ($Scenario) {
    'source-repair' { $data.description = 'IN-VIBE local YouTube observer' }
    'unknown-origin' { $data.allowed_origins = @("chrome-extension://$('a'*32)/") }
    'multiple-origins' { $data.allowed_origins = @("chrome-extension://$official/","chrome-extension://$development/") }
    'tampered-manifest' { $data.name = 'unexpected.host' }
    'extra-key' { $data['unexpected'] = $true }
    'scalar-origin' { $data.allowed_origins = "chrome-extension://$extensionId/" }
    'relative-path' { $data.path = 'in-vibe-native-host.exe' }
    'foreign-path' { $data.path = Join-Path $Fixture 'in-vibe-native-host.exe' }
    'alternate-stream' { $data.path = $oldExe + ':unexpected' }
    'directory-host' { New-Item -ItemType Directory -Path $oldExe | Out-Null }
    'reparse-host' {
      $other = Join-Path $Fixture 'other'
      New-Item -ItemType Directory -Path $other | Out-Null
      New-Item -ItemType Junction -Path $oldExe -Target $other | Out-Null
    }
  }
  if ($Scenario -in @('upgrade','tampered-host')) { [IO.File]::WriteAllText($oldExe, 'synthetic old Host') }
  if ($Scenario -ne 'missing-manifest') {
    $json = $data | ConvertTo-Json
    if ($Scenario -eq 'duplicate-key') { $json = '{"name":"unexpected.host",' + $json.Substring(1) }
    [IO.File]::WriteAllText($oldManifest, $json)
    $oldDigest = (Get-FileHash -LiteralPath $oldManifest).Hash
  }
}
if ($Scenario -eq 'tampered-payload') { [IO.File]::AppendAllText($payload, 'tampered') }

# Replace all registry operations in the wrapper and its two helper scripts.
$global:MockNativeHost = @{ Key=$script:NativeKey; Value=$oldManifest; Writes=0; Exports=0 }
function Test-Path {
  [CmdletBinding()]param([string]$LiteralPath, [string]$PathType)
  if ($LiteralPath -like 'HK*:*') {
    if ($LiteralPath -ne $global:MockNativeHost.Key) { throw 'Unexpected registry read' }
    return $null -ne $global:MockNativeHost.Value
  }
  Microsoft.PowerShell.Management\Test-Path @PSBoundParameters
}
function Get-Item {
  [CmdletBinding()]param([string]$LiteralPath)
  if ($LiteralPath -like 'HK*:*') {
    if ($LiteralPath -ne $global:MockNativeHost.Key) { throw 'Unexpected registry read' }
    $item = [pscustomobject]@{}
    $item | Add-Member ScriptMethod GetValue { param($name) $global:MockNativeHost.Value }
    return $item
  }
  Microsoft.PowerShell.Management\Get-Item @PSBoundParameters
}
function New-Item {
  [CmdletBinding()]param([string[]]$Path, [string]$ItemType, [switch]$Force)
  if ($Path -like 'HK*:*') {
    if ($Path.Count -ne 1 -or $Path[0] -ne $global:MockNativeHost.Key) { throw 'Unexpected registry creation' }
    return
  }
  foreach ($item in $Path) {
    if (![IO.Path]::GetFullPath($item).StartsWith($Fixture + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected directory creation' }
  }
  Microsoft.PowerShell.Management\New-Item @PSBoundParameters
}
function Set-Item {
  [CmdletBinding()]param([string]$LiteralPath, [string]$Value)
  if ($LiteralPath -ne $global:MockNativeHost.Key) { throw 'Unexpected registry write' }
  $global:MockNativeHost.Value = $Value
  $global:MockNativeHost.Writes++
}
function reg.exe {
  if ($args[0] -ne 'export' -or $args[1] -ne $global:MockNativeHost.Key.Replace('HKCU:', 'HKCU') -or
      ![IO.Path]::GetFullPath($args[2]).StartsWith($Fixture + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Unexpected reg.exe call'
  }
  $global:MockNativeHost.Exports++
  [IO.File]::WriteAllText($args[2], 'simulated registry backup')
  $global:LASTEXITCODE = 0
}
$output = @(& (Join-Path $scripts 'Auto-Register-Host.ps1'))
$exitCode = $LASTEXITCODE
$logs = @(Get-ChildItem -LiteralPath (Join-Path $installRoot 'logs') -File -Filter 'installer-registration-*.log')
if ($logs.Count -ne 1) { throw "Expected one log: $output" }
$log = Get-Content -LiteralPath $logs[0].FullName -Raw -Encoding UTF8
if ($log.Contains($Fixture)) { throw 'Installation log must not include PC paths' }
if ($Expected -eq 'failed') {
  if ($exitCode -ne 1 -or $global:MockNativeHost.Writes -ne 0 -or $global:MockNativeHost.Exports -ne 0 -or
      $global:MockNativeHost.Value -ne $oldManifest -or $log -notmatch 'status=failed .*stage=') {
    throw "Invalid input was not refused safely: $output"
  }
} else {
  $newPath = Join-Path $destination "$hostName.json"
  $backupCount = if ($oldManifest) { 1 } else { 0 }
  if ($exitCode -ne 0 -or $global:MockNativeHost.Writes -ne 1 -or $global:MockNativeHost.Exports -ne $backupCount -or
      $global:MockNativeHost.Value -ne $newPath -or $log -notmatch "status=success mode=$Expected origin=$Channel stage=verify") {
    throw "Unexpected result: $output"
  }
  $result = Get-Content -LiteralPath $newPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($result.allowed_origins.Count -ne 1 -or $result.allowed_origins[0] -ne "chrome-extension://$extensionId/" -or
      (Get-FileHash -LiteralPath $result.path).Hash -ne $digest) { throw 'Wrong origin or Host payload' }
  if ($oldManifest) {
    $previous = Get-ChildItem -LiteralPath (Join-Path $installRoot 'backups') -Recurse -File -Filter 'previous-manifest.json'
    if ((Get-FileHash -LiteralPath $previous.FullName).Hash -ne $oldDigest) { throw 'Old manifest was not backed up' }
  }
}
if ($oldDigest -and (Get-FileHash -LiteralPath $oldManifest).Hash -ne $oldDigest) { throw 'Old manifest was overwritten' }
Write-Output "Verified $Scenario with simulated registry."
