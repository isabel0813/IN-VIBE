# Runs from the per-user NSIS POSTINSTALL hook.
$ErrorActionPreference = 'Stop'
$official = 'nndjojfhmpbolfifcfdcpalcloanppod'
$development = 'ohajfkkemocajnjlbnogdmoominkejci'
$hostName = 'io.invibe.annyong.youtube'
$hostFile = 'in-vibe-native-host.exe'
$registry = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
$installRoot = Join-Path $env:LOCALAPPDATA 'Mobonyong\NativeHost'
$logFile = $null
$mode = 'install'
$channel = 'store'
$stage = 'initialize-log'

function Assert-SafeLocalPath([string]$Path) {
  if ($Path -notmatch '^[A-Za-z]:\\' -or $Path.Substring(3) -match '[<>:"/|?*\x00-\x1f]' -or
      ![string]::Equals($Path, [IO.Path]::GetFullPath($Path), [StringComparison]::OrdinalIgnoreCase) -or
      @($Path.Substring(3).Split('\') | Where-Object { !$_ -or $_ -match '[ .]$' }).Count) {
    throw 'Unsafe local path.'
  }
  if ([IO.DriveInfo]::new($Path.Substring(0, 3)).DriveType -ne [IO.DriveType]::Fixed) {
    throw 'Native Host requires a fixed local drive.'
  }
  for ($part = $Path; $part; $part = [IO.Path]::GetDirectoryName($part)) {
    try { $attributes = [IO.File]::GetAttributes($part) }
    catch [IO.FileNotFoundException] { continue }
    catch [IO.DirectoryNotFoundException] { continue }
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -or
        ($part -ne $Path -and !($attributes -band [IO.FileAttributes]::Directory))) {
      throw 'Unsafe path component.'
    }
  }
}

function Write-Result([string]$Status) {
  # Keep paths and raw exception text out of the installer log.
  $line = "{0:o} status=$Status mode=$mode origin=$channel stage=$stage" -f [DateTime]::UtcNow
  if ($logFile) {
    try { [IO.File]::AppendAllText($logFile, $line + [Environment]::NewLine) }
    catch { Write-Output 'Mobonyong Native Host: installation log unavailable.' }
  }
  Write-Output "Mobonyong Native Host: status=$Status mode=$mode origin=$channel stage=$stage"
}

function Read-HostManifest([string]$Path) {
  $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  $manifest = ConvertFrom-Json -InputObject $raw
  # Count JSON property tokens as well as parsed fields so repeated keys are refused.
  $keys = [regex]::Matches($raw, '"(?:[^"\\]|\\.)*"\s*(:)?') | Where-Object { $_.Groups[1].Success }
  $fields = @($manifest.PSObject.Properties.Name)
  if (!$raw.TrimStart().StartsWith('{') -or @($keys).Count -ne 5 -or $fields.Count -ne 5 -or
      @($fields | Where-Object { $_ -cnotin @('name','description','type','allowed_origins','path') }).Count -or
      $manifest.name -isnot [string] -or $manifest.name -cne $hostName -or
      $manifest.type -isnot [string] -or $manifest.type -cne 'stdio' -or
      $manifest.description -isnot [string] -or $manifest.description -cnotin @('Mobonyong YouTube observer','IN-VIBE local YouTube observer') -or
      $manifest.allowed_origins -isnot [array] -or $manifest.allowed_origins.Count -ne 1 -or
      $manifest.allowed_origins[0] -isnot [string] -or $manifest.path -isnot [string]) {
    throw 'Invalid Native Host manifest.'
  }
  return $manifest
}

try {
  $logDir = Join-Path $installRoot 'logs'
  Assert-SafeLocalPath $logDir
  [void][IO.Directory]::CreateDirectory($logDir)
  $logFile = Join-Path $logDir ("installer-registration-" + [guid]::NewGuid().ToString('N') + '.log')
  $log = [IO.File]::Open($logFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
  $log.Dispose()

  $extensionId = $official
  $oldPath = ''
  $oldHash = ''
  if (Test-Path -LiteralPath $registry) {
    $mode = 'upgrade'
    $channel = 'unknown'
    $stage = 'existing-manifest-path'
    $oldPath = (Get-Item -LiteralPath $registry).GetValue('')
    if ($oldPath -isnot [string]) { throw 'Invalid registry value.' }
    Assert-SafeLocalPath $oldPath
    if ([IO.Path]::GetFileName($oldPath) -ne "$hostName.json" -or -not (Test-Path -LiteralPath $oldPath -PathType Leaf)) {
      throw 'Invalid existing manifest path.'
    }

    $stage = 'existing-manifest'
    $oldHash = (Get-FileHash -LiteralPath $oldPath -Algorithm SHA256).Hash
    $manifest = Read-HostManifest $oldPath

    $stage = 'existing-origin'
    switch -CaseSensitive ($manifest.allowed_origins[0]) {
      "chrome-extension://$official/" { $channel = 'store' }
      "chrome-extension://$development/" { $extensionId = $development; $channel = 'development' }
      default { throw 'Unknown extension origin in existing Host; not overwriting it.' }
    }

    $stage = 'existing-host-path'
    $oldDir = [IO.Path]::GetDirectoryName($oldPath)
    $expectedHost = Join-Path $oldDir $hostFile
    if ($manifest.path -ne $expectedHost) { throw 'Unexpected existing Host path.' }
    Assert-SafeLocalPath $manifest.path
    $oldHashPrefix = $null
    if ([IO.Path]::GetDirectoryName($oldDir) -eq $installRoot) {
      $folder = [IO.Path]::GetFileName($oldDir)
      if ($folder -cmatch ('^\d+\.\d+\.\d+-([0-9a-f]{16})-' + $extensionId + '$')) {
        $oldHashPrefix = $Matches[1]
      } elseif ($folder -cnotmatch '^\d+\.\d+\.\d+-[0-9a-f]{7,40}$') {
        throw 'Unrecognized managed Host directory.'
      }
    } elseif (!$oldDir.EndsWith('\extension\.local\native-host', [StringComparison]::OrdinalIgnoreCase) -or
              $manifest.description -cne 'IN-VIBE local YouTube observer') {
      throw 'Unrecognized Host directory.'
    }
    if (Test-Path -LiteralPath $manifest.path) {
      if (!(Test-Path -LiteralPath $manifest.path -PathType Leaf) -or
          ($oldHashPrefix -and !(Get-FileHash -LiteralPath $manifest.path -Algorithm SHA256).Hash.StartsWith($oldHashPrefix, [StringComparison]::OrdinalIgnoreCase))) {
        throw 'Invalid existing Host file.'
      }
    } else {
      $mode = 'recovery'
    }
    if ((Get-FileHash -LiteralPath $oldPath -Algorithm SHA256).Hash -ne $oldHash) { throw 'Existing manifest changed.' }
  }

  $stage = 'payload'
  $runtime = Join-Path (Split-Path $PSScriptRoot -Parent) 'native-host-runtime'
  $build = Get-Content -LiteralPath (Join-Path $runtime 'HOST-BUILD.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($build.version -notmatch '^\d+\.\d+\.\d+$' -or $build.sha256 -cnotmatch '^[a-f0-9]{64}$') {
    throw 'Invalid Native Host build metadata.'
  }
  $destination = Join-Path $installRoot "$($build.version)-$($build.sha256.Substring(0,16))-$extensionId"
  $expectedManifest = Join-Path $destination "$hostName.json"
  $expectedExe = Join-Path $destination $hostFile
  foreach ($path in @($expectedManifest, $expectedExe, (Join-Path $installRoot 'backups'))) { Assert-SafeLocalPath $path }
  if (Test-Path -LiteralPath $expectedManifest) {
    $installed = Read-HostManifest $expectedManifest
    if ($installed.path -ne $expectedExe -or $installed.allowed_origins[0] -cne "chrome-extension://$extensionId/") {
      throw 'Unexpected destination manifest.'
    }
  }

  $stage = 'configure'
  & (Join-Path $PSScriptRoot 'Configure-DownloadedHost.ps1') -InstallRoot $installRoot -ExtensionId $extensionId -Register `
    -ExpectedManifestPath $oldPath -ExpectedManifestSha256 $oldHash -RepairMissingHost:($mode -eq 'recovery') | Out-Null
  $stage = 'verify'
  $manifestPath = (Get-Item -LiteralPath $registry).GetValue('')
  if ($manifestPath -ne $expectedManifest) { throw 'Unexpected registered manifest path.' }
  $manifest = Read-HostManifest $manifestPath
  if ($manifest.allowed_origins[0] -cne "chrome-extension://$extensionId/" -or $manifest.path -ne $expectedExe -or
      (Get-FileHash -LiteralPath $expectedExe -Algorithm SHA256).Hash -ne $build.sha256) {
    throw 'Native Host registration verification failed.'
  }
  Write-Result 'success'
  exit 0
} catch {
  Write-Result 'failed'
  exit 1
}
