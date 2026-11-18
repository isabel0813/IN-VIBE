import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const scripts=fileURLToPath(new URL('../scripts/',import.meta.url));
const official='nndjojfhmpbolfifcfdcpalcloanppod',dev='ohajfkkemocajnjlbnogdmoominkejci';
function fixture(){const root=mkdtempSync(join(tmpdir(),'mobonyong-install-test-'));mkdirSync(join(root,'scripts'));mkdirSync(join(root,'native-host-runtime'));for(const file of ['Configure-DownloadedHost.ps1','Register-NativeHost.ps1'])copyFileSync(join(scripts,file),join(root,'scripts',file));const bytes=Buffer.from('not executed fixture');writeFileSync(join(root,'native-host-runtime/in-vibe-native-host.exe'),bytes);writeFileSync(join(root,'native-host-runtime/HOST-BUILD.json'),JSON.stringify({version:'0.3.2',source_commit:'a'.repeat(40),sha256:createHash('sha256').update(bytes).digest('hex')}));return root;}
function dispose(root){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));assert.ok(root.includes('mobonyong-install-test-'));rmSync(root,{recursive:true,force:true});}
function run(root,args=[]){return spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/Configure-DownloadedHost.ps1'),'-InstallRoot',join(root,'fixed'),...args],{encoding:'utf8'});}
const windows=process.platform==='win32';
test('preview chooses only the official origin and a fixed path without writing a manifest or registry',{skip:!windows},()=>{const root=fixture();try{const r=run(root);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,new RegExp(`chrome-extension://${official}/`));assert.match(r.stdout,/Preview only/);assert.equal(existsSync(join(root,'fixed')),false);assert.equal(existsSync(join(root,'native-host-runtime/io.invibe.annyong.youtube.json')),false);}finally{dispose(root);}});
test('development preview requires its explicit ID and does not include the official origin',{skip:!windows},()=>{const root=fixture();try{const r=run(root,['-ExtensionId',dev]);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,new RegExp(`chrome-extension://${dev}/`));assert.ok(!r.stdout.includes(`chrome-extension://${official}/`));assert.equal(existsSync(join(root,'fixed')),false);}finally{dispose(root);}});
test('invalid origin or modified Host bytes fail before any install writes',{skip:!windows},()=>{const root=fixture();try{assert.notEqual(run(root,['-ExtensionId','*']).status,0);writeFileSync(join(root,'native-host-runtime/in-vibe-native-host.exe'),'modified');assert.notEqual(run(root).status,0);assert.equal(existsSync(join(root,'fixed')),false);}finally{dispose(root);}});
test('registration copies to the fixed path, preserves old files and backs up using simulated registry only',{skip:!windows},()=>{const root=fixture();try{
writeFileSync(join(root,'old-manifest.json'),'{}');
writeFileSync(join(root,'test-register.ps1'),String.raw`
$ErrorActionPreference='Stop'
$global:HostTestRegistry=@{value=(Join-Path $PSScriptRoot 'old-manifest.json');exports=0}
function Get-Item { [CmdletBinding()]param([string]$LiteralPath) if($LiteralPath -like 'HKCU:*'){$item=[pscustomobject]@{Value=$global:HostTestRegistry.value};$item|Add-Member ScriptMethod GetValue {param($name) $global:HostTestRegistry.value};return $item}; Microsoft.PowerShell.Management\Get-Item @PSBoundParameters }
function Test-Path { [CmdletBinding()]param([string]$LiteralPath,[string]$PathType) if($LiteralPath -like 'HKCU:*'){return $true}; Microsoft.PowerShell.Management\Test-Path @PSBoundParameters }
function New-Item { [CmdletBinding()]param([string[]]$Path,[string]$ItemType,[switch]$Force) if($Path.Count -eq 1 -and $Path[0] -like 'HKCU:*'){return}; Microsoft.PowerShell.Management\New-Item @PSBoundParameters }
function Set-Item { [CmdletBinding()]param([string]$LiteralPath,[string]$Value) if($LiteralPath -notlike 'HKCU:*'){throw 'Unexpected write'};$global:HostTestRegistry.value=$Value }
function reg.exe { if($args[0] -ne 'export'){throw 'Unexpected reg command'};$global:HostTestRegistry.exports++;[IO.File]::WriteAllText($args[2],'simulated backup');$global:LASTEXITCODE=0 }
$install=Join-Path $PSScriptRoot 'fixed'
& (Join-Path $PSScriptRoot 'scripts/Configure-DownloadedHost.ps1') -InstallRoot $install -ExtensionId '${dev}' -Register
& (Join-Path $PSScriptRoot 'scripts/Configure-DownloadedHost.ps1') -InstallRoot $install -ExtensionId '${dev}' -Register
if($global:HostTestRegistry.exports -ne 2){throw 'Missing backups'}
$m=Get-Content -LiteralPath $global:HostTestRegistry.value -Raw|ConvertFrom-Json
if($m.allowed_origins.Count -ne 1 -or $m.allowed_origins[0] -ne 'chrome-extension://${dev}/'){throw 'Wrong origins'}
if(-not (Microsoft.PowerShell.Management\Test-Path (Join-Path $PSScriptRoot 'old-manifest.json'))){throw 'Old file removed'}
if(-not $m.path.StartsWith($install)){throw 'Host remains in download folder'}
# Refuse a changed existing manifest without rewriting it or its registration.
$m.allowed_origins=@('chrome-extension://${official}/');$m|ConvertTo-Json|Set-Content -LiteralPath $global:HostTestRegistry.value
$rejected=$false
try { & (Join-Path $PSScriptRoot 'scripts/Configure-DownloadedHost.ps1') -InstallRoot $install -ExtensionId '${dev}' -Register } catch { $rejected=$true }
if(-not $rejected -or $global:HostTestRegistry.exports -ne 2){throw 'Conflicting destination was accepted'}
'FIXED INSTALL MOCK REGISTRY CHECKS PASS'
`);
const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'test-register.ps1')],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/FIXED INSTALL MOCK REGISTRY CHECKS PASS/);assert.equal(readFileSync(join(root,'old-manifest.json'),'utf8'),'{}');
}finally{dispose(root);}});
