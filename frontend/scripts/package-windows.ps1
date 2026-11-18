[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$frontend=Split-Path $PSScriptRoot -Parent
$repo=Split-Path $frontend -Parent
$config=Get-Content (Join-Path $frontend 'src-tauri/tauri.conf.json') -Raw|ConvertFrom-Json
$version=$config.version
if($version -ne '0.3.2' -or $config.identifier -ne 'io.invibe.annyong'){throw 'Unexpected version or installation identity.'}
$source=(& git -C $repo rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $source -notmatch '^[0-9a-f]{40}$'){throw 'Cannot determine source commit.'}
if(& git -C $repo status --porcelain){throw 'Commit verified source changes before packaging.'}
$output=[IO.Path]::GetFullPath($OutputDirectory)
if(Test-Path -LiteralPath $output){throw 'Output exists; preserving previous package.'}
$target=Join-Path $frontend 'src-tauri/target/release'
$installer=Join-Path $target "bundle/nsis/뭐보뇽_${version}_x64-setup.exe"
$hostExe=Join-Path $target 'in-vibe-native-host.exe'
$app=Join-Path $target 'in-vibe.exe'
if((Get-Item -LiteralPath $app).VersionInfo.FileVersion -ne $version){throw 'App build version mismatch.'}
foreach($path in @($installer,$hostExe,(Join-Path $frontend 'docs/windows-release-validation.md'))){if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Required input missing: $path"}}
$stage=Join-Path $output 'package'
$extension=Join-Path $stage 'extension'
$scripts=Join-Path $extension 'scripts'
$runtime=Join-Path $extension 'native-host-runtime'
New-Item -ItemType Directory -Path $scripts,$runtime -Force|Out-Null
Copy-Item -LiteralPath $installer -Destination (Join-Path $stage "Mobonyong-Windows-$version-Setup.exe")
Copy-Item -LiteralPath $hostExe -Destination $runtime
foreach($file in @('manifest.json','worker.js','protocol.js','observer.js','content.js','popup.html','popup.js','popup.css','README.md')){Copy-Item -LiteralPath (Join-Path $repo "extension/$file") -Destination $extension}
foreach($file in @('Configure-DownloadedHost.ps1','Register-NativeHost.ps1','Unregister-NativeHost.ps1')){Copy-Item -LiteralPath (Join-Path $repo "extension/scripts/$file") -Destination $scripts}
Copy-Item -LiteralPath (Join-Path $frontend 'docs/windows-release.md') -Destination (Join-Path $stage 'README.md')
Copy-Item -LiteralPath (Join-Path $frontend 'docs/windows-release-validation.md') -Destination (Join-Path $stage 'VALIDATION.md')
$hostBuild=[ordered]@{version=$version;source_commit=$source;sha256=(Get-FileHash -LiteralPath $hostExe -Algorithm SHA256).Hash.ToLowerInvariant();protocol_version=1;snapshot_supported=$true}
[IO.File]::WriteAllText((Join-Path $runtime 'HOST-BUILD.json'),($hostBuild|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$metadata=[ordered]@{version=$version;tag='v0.3.2-test-20261118';source_commit=$source;source_dirty=$false;base_main='056ee78';identifier=$config.identifier;api='https://api.mobonyong.com';development_extension_id='ohajfkkemocajnjlbnogdmoominkejci';store_extension_id='nndjojfhmpbolfifcfdcpalcloanppod';host=$hostBuild;updates='Manual GitHub Releases download; no automatic updater';unsigned=$true}
[IO.File]::WriteAllText((Join-Path $stage 'SOURCE.json'),($metadata|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$lines=@(Get-ChildItem -LiteralPath $stage -File -Recurse|Sort-Object FullName|ForEach-Object {"$((Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant())  $($_.FullName.Substring($stage.Length+1).Replace('\','/'))"})
[IO.File]::WriteAllLines((Join-Path $stage 'SHA256SUMS.txt'),$lines,[Text.UTF8Encoding]::new($false))
$zip=Join-Path $output 'Mobonyong-Windows-v0.3.2-test-20261118.zip'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
$zipHash=(Get-FileHash -LiteralPath $zip).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS.txt'),"$zipHash  $([IO.Path]::GetFileName($zip))`n",[Text.UTF8Encoding]::new($false))
[pscustomobject]@{ZIP=$zip;Bytes=(Get-Item $zip).Length;SHA256=$zipHash;Source=$source;IncludedFiles=$lines.Count+1}
