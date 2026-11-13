[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$ManifestPath, [switch]$Apply)
$ErrorActionPreference = 'Stop'
if (-not $ManifestPath) { $ManifestPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.local/native-host/io.invibe.annyong.youtube.json' }
$expected = [IO.Path]::GetFullPath($ManifestPath)
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\io.invibe.annyong.youtube'
if (-not (Test-Path -LiteralPath $registryPath)) { Write-Output 'Already unregistered.'; return }
$item = Get-Item -LiteralPath $registryPath
if ($item.GetValue('') -ne $expected -or $item.SubKeyCount -ne 0) { throw 'Registration differs; refusing to remove another installation.' }
Write-Output "Remove only $registryPath -> $expected"
if ($Apply -and $PSCmdlet.ShouldProcess($registryPath, 'Unregister IN-VIBE native host')) { Remove-Item -LiteralPath $registryPath }
else { Write-Output 'Preview only. After user approval, pass -Apply to unregister.' }
