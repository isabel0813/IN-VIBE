[CmdletBinding()]
param([ValidatePattern('^[a-p]{32}$')][string]$ExtensionId='ohajfkkemocajnjlbnogdmoominkejci', [switch]$Register)
$ErrorActionPreference='Stop'
$runtime=Join-Path (Split-Path $PSScriptRoot -Parent) 'native-host-runtime'
$exe=Join-Path $runtime 'in-vibe-native-host.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Extract the complete download package first. Native host executable is missing.' }
$exe=(Resolve-Path -LiteralPath $exe).Path
$manifestPath=Join-Path $runtime 'io.invibe.annyong.youtube.json'
$manifest=[ordered]@{name='io.invibe.annyong.youtube';description='Mobonyong YouTube observer';path=$exe;type='stdio';allowed_origins=@("chrome-extension://$ExtensionId/")}
[IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
if ($Register) { & (Join-Path $PSScriptRoot 'Register-NativeHost.ps1') -ManifestPath $manifestPath -Apply }
else { & (Join-Path $PSScriptRoot 'Register-NativeHost.ps1') -ManifestPath $manifestPath }
