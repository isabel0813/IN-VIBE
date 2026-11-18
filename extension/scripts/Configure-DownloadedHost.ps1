[CmdletBinding(SupportsShouldProcess=$true)]
param(
  [ValidatePattern('^[a-p]{32}$')][string]$ExtensionId='nndjojfhmpbolfifcfdcpalcloanppod',
  [string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'Mobonyong/NativeHost'),
  [switch]$Register
)
$ErrorActionPreference='Stop'
function Get-HostHash([string]$FilePath) {
  $stream=[IO.File]::OpenRead($FilePath);$sha=[Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose();$sha.Dispose() }
}
$runtime=Join-Path (Split-Path $PSScriptRoot -Parent) 'native-host-runtime'
$source=Join-Path $runtime 'in-vibe-native-host.exe'
$build=Get-Content -LiteralPath (Join-Path $runtime 'HOST-BUILD.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($build.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid Host package version.'}
if($build.source_commit -notmatch '^[0-9a-f]{40}$'){throw 'Missing Host source commit.'}
$hash=(Get-HostHash $source)
if($hash -ne $build.sha256){throw 'Host hash does not match HOST-BUILD.json. Extract the verified complete ZIP.'}
if(-not [IO.Path]::IsPathRooted($InstallRoot)){throw 'InstallRoot must be an absolute fixed path.'}
$destination=Join-Path ([IO.Path]::GetFullPath($InstallRoot)) "$($build.version)-$($hash.Substring(0,16))-$ExtensionId"
$hostPath=Join-Path $destination 'in-vibe-native-host.exe'
$manifestPath=Join-Path $destination 'io.invibe.annyong.youtube.json'
$registry='HKCU:\Software\Google\Chrome\NativeMessagingHosts\io.invibe.annyong.youtube'
$old=if(Test-Path -LiteralPath $registry){(Get-Item -LiteralPath $registry).GetValue('')}else{$null}
$manifest=[ordered]@{name='io.invibe.annyong.youtube';description='Mobonyong YouTube observer';path=$hostPath;type='stdio';allowed_origins=@("chrome-extension://$ExtensionId/")}
Write-Output "Existing registration: $old"
Write-Output "Fixed Host path: $hostPath"
Write-Output "New manifest: $manifestPath"
Write-Output "Exact allowed origin: $($manifest.allowed_origins[0])"
Write-Output "Source: $($build.source_commit) / SHA256: $hash"
if(-not $Register){Write-Output 'Preview only. No files or registry changed. Review, then explicitly pass -Register.';return}
if(-not $PSCmdlet.ShouldProcess($registry,'Install verified Host at a fixed path, back up old registration and register for current user')){return}
# Version/hash/origin-specific directories never replace running EXEs.
if(Test-Path -LiteralPath $destination){
  if(-not (Test-Path -LiteralPath $hostPath) -or -not (Test-Path -LiteralPath $manifestPath)){throw 'Incomplete destination; refusing to overwrite.'}
  if((Get-HostHash $hostPath) -ne $hash){throw 'Existing destination has different content.'}
  $existing=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
  if($existing.name -ne $manifest.name -or $existing.type -ne 'stdio' -or $existing.path -ne $hostPath -or $existing.allowed_origins.Count -ne 1 -or $existing.allowed_origins[0] -ne $manifest.allowed_origins[0]){throw 'Existing manifest differs; refusing to overwrite.'}
}
$backup=Join-Path ([IO.Path]::GetFullPath($InstallRoot)) ('backups/'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backup -Force|Out-Null
if($old){
  & reg.exe export 'HKCU\Software\Google\Chrome\NativeMessagingHosts\io.invibe.annyong.youtube' (Join-Path $backup 'registration.reg')|Out-Null
  if($LASTEXITCODE -ne 0){throw 'Registry backup failed; registration unchanged.'}
  if(Test-Path -LiteralPath $old -PathType Leaf){Copy-Item -LiteralPath $old -Destination (Join-Path $backup 'previous-manifest.json')}
}
[IO.File]::WriteAllText((Join-Path $backup 'previous-registration.json'),(@{previous_manifest=$old;new_manifest=$manifestPath}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
if(-not (Test-Path -LiteralPath $destination)){
  New-Item -ItemType Directory -Path $destination|Out-Null
  Copy-Item -LiteralPath $source -Destination $hostPath
  [IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
}
if((Get-HostHash $hostPath) -ne $hash){throw 'Copied Host verification failed; registration unchanged.'}
$current=if(Test-Path -LiteralPath $registry){(Get-Item -LiteralPath $registry).GetValue('')}else{$null}
if($current -ne $old){throw 'Registration changed during preparation; stop and review.'}
& (Join-Path $PSScriptRoot 'Register-NativeHost.ps1') -ManifestPath $manifestPath -Apply
if((Get-Item -LiteralPath $registry).GetValue('') -ne $manifestPath){throw 'Registration verification failed.'}
Write-Output "Backup: $backup"
Write-Output 'Registered. Old Host files and app data retained. Reload the extension to reconnect; no processes were stopped.'
