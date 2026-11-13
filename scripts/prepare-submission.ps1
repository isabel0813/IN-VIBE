# Creates local submission archives only. Does not publish or register a host.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$output=Join-Path $root '.qa/submission'
$stage=Join-Path $output ('Mobonyong-Windows-MVP-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$ext=Join-Path $stage 'extension'
New-Item -ItemType Directory -Force -Path $ext,(Join-Path $ext 'scripts'),(Join-Path $ext 'native-host-runtime') | Out-Null
$setup=Join-Path $root 'frontend/src-tauri/target/release/bundle/nsis/뭐보뇽_0.2.0_x64-setup.exe'
$hostExe=Join-Path $root 'frontend/src-tauri/target/release/in-vibe-native-host.exe'
if (-not (Test-Path -LiteralPath $setup)) { throw 'Build the current Windows installer first.' }
Copy-Item -LiteralPath $setup -Destination (Join-Path $stage 'Mobonyong-setup.exe')
Copy-Item -LiteralPath $hostExe -Destination (Join-Path $ext 'native-host-runtime/in-vibe-native-host.exe')
foreach($name in @('manifest.json','worker.js','protocol.js','observer.js','content.js','popup.html','popup.css','popup.js','README.md')) {
  Copy-Item -LiteralPath (Join-Path $root "extension/$name") -Destination $ext
}
foreach($name in @('Configure-DownloadedHost.ps1','Register-NativeHost.ps1','Unregister-NativeHost.ps1')) {
  Copy-Item -LiteralPath (Join-Path $root "extension/scripts/$name") -Destination (Join-Path $ext 'scripts')
}
Copy-Item -LiteralPath (Join-Path $root 'frontend/public/install.html') -Destination (Join-Path $stage '설치안내.html')
Copy-Item -LiteralPath (Join-Path $root 'docs/submission-2026-11-14.md') -Destination (Join-Path $stage '검증범위.md')
Get-FileHash -LiteralPath (Join-Path $stage 'Mobonyong-setup.exe'),(Join-Path $ext 'native-host-runtime/in-vibe-native-host.exe') -Algorithm SHA256 | Format-List | Out-File (Join-Path $stage 'SHA256.txt') -Encoding utf8
$zip=Join-Path $output 'Mobonyong-Windows-MVP.zip'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Compress-Archive -Path (Join-Path $root 'frontend/dist/*') -DestinationPath (Join-Path $output 'Mobonyong-Web.zip') -Force
Get-Item -LiteralPath $zip,(Join-Path $output 'Mobonyong-Web.zip') | Select-Object FullName,Length
Get-FileHash -LiteralPath $zip -Algorithm SHA256
