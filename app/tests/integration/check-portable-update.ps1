# Isolated fixture applications only. Never installs or closes the real client.
param([switch]$Hotfix)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$fixtureRoot=Join-Path $appRoot ('.runtime-probe\portable update '+[Guid]::NewGuid().ToString())
[void][IO.Directory]::CreateDirectory($fixtureRoot)
$powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$target=if($Hotfix){'9.0.0-b2'}else{'9.0.0'}
function Assert($condition,$message){if(!$condition){throw $message}}
function Digest($file,$algorithm,$hex=$false){$h=[Security.Cryptography.HashAlgorithm]::Create($algorithm);$stream=[IO.File]::OpenRead($file);try{$bytes=$h.ComputeHash($stream);if($hex){return ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()};return [Convert]::ToBase64String($bytes)}finally{$stream.Dispose();$h.Dispose()}}
foreach($scenario in @('success','startup-failure','bad-checksum','bad-file-hash','zip-slip','data-overwrite')){
 $root=Join-Path $fixtureRoot $scenario;$source=Join-Path $fixtureRoot ($scenario+'-payload');$pending=Join-Path $root 'data\updates\pending'
 [void][IO.Directory]::CreateDirectory($pending);[void][IO.Directory]::CreateDirectory((Join-Path $root 'resources'));[void][IO.Directory]::CreateDirectory((Join-Path $source 'resources'))
 [IO.File]::WriteAllText((Join-Path $root 'ScreenSh.exe'),'old-executable')
 [IO.File]::WriteAllText((Join-Path $root 'resources\obsolete.txt'),'old-resource')
 [IO.File]::WriteAllText((Join-Path $root 'Uninstall ScreenSh.exe'),'keep-uninstaller')
 [IO.File]::WriteAllText((Join-Path $root 'custom.txt'),'keep-custom-file')
 [IO.File]::WriteAllText((Join-Path $root 'data\profile.json'),'keep-profile')
 $type='Fixture'+[Guid]::NewGuid().ToString('N')
 $confirm=if($scenario -eq 'startup-failure') {''} else {'foreach(var dir in Directory.GetDirectories(Path.Combine(root,"data","updates","transactions"))){if(File.ReadAllText(Path.Combine(dir,"journal.json")).Contains("\"phase\":\"applied\""))File.WriteAllText(Path.Combine(dir,"confirmed"),"'+$target+'");}'}
 $code='using System;using System.IO;public class '+$type+' { public static void Main(){var root=AppDomain.CurrentDomain.BaseDirectory;'+$confirm+'} }'
 Add-Type -TypeDefinition $code -OutputAssembly (Join-Path $source 'ScreenSh.exe') -OutputType WindowsApplication
 [IO.File]::WriteAllText((Join-Path $source 'resources\app.asar'),'new-resource')
 $files=@(Get-ChildItem -LiteralPath $source -File -Recurse|ForEach-Object {[PSCustomObject]@{path=$_.FullName.Substring($source.Length+1).Replace('\','/');size=$_.Length;sha256=(Digest $_.FullName 'SHA256' $true)}})
 if($scenario -eq 'bad-file-hash'){$files[0].sha256='0'*64}
 $manifest=@{schemaVersion=1;version=$target;files=$files}
 if($scenario -eq 'data-overwrite'){$manifest.files+=@{path='data/profile.json';size=1;sha256='0'*64}}
 $archive=Join-Path $pending "ScreenSh-$target-Update.zip";$zip=[IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Create)
 try{
  foreach($file in $files){[void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $source $file.path),$file.path)}
  $entry=$zip.CreateEntry('update-manifest.json');$w=New-Object IO.StreamWriter($entry.Open());try{$w.Write(($manifest|ConvertTo-Json -Depth 5 -Compress))}finally{$w.Dispose()}
  if($scenario -eq 'zip-slip'){[void]$zip.CreateEntry('../escaped.txt')}
 }finally{$zip.Dispose()}
 $job=Join-Path $fixtureRoot ($scenario+'-job.json');$sha=Digest $archive 'SHA512';if($scenario -eq 'bad-checksum'){$sha='A'*86+'=='}
 @{root=$root;exe=(Join-Path $root 'ScreenSh.exe');installer=$archive;sha512=$sha;version=$target}|ConvertTo-Json -Compress|Set-Content -LiteralPath $job -Encoding UTF8
 $native=Start-Process -FilePath (Join-Path $appRoot 'res\screensh-updater.exe') -ArgumentList ('--worker "'+$job+'"') -WindowStyle Hidden -PassThru
 $native.WaitForExit()
 $exit=$native.ExitCode
 $receipt=Get-Content -LiteralPath (Join-Path $fixtureRoot 'portable-result.json') -Raw -Encoding UTF8|ConvertFrom-Json
 Assert (([IO.File]::ReadAllText((Join-Path $root 'data\profile.json'))) -eq 'keep-profile') 'User data changed'
 Assert (([IO.File]::ReadAllText((Join-Path $root 'Uninstall ScreenSh.exe'))) -eq 'keep-uninstaller') 'Uninstaller changed'
 Assert (([IO.File]::ReadAllText((Join-Path $root 'custom.txt'))) -eq 'keep-custom-file') 'Unmanaged file changed'
 Assert (!(Test-Path -LiteralPath (Join-Path $root 'data\updates\transactions\escaped.txt'))) 'ZIP escaped staging'
 if($scenario -eq 'success'){
  Assert ($exit -eq 0 -and $receipt.success) ('Update did not succeed: '+($receipt|ConvertTo-Json -Compress))
  Assert (([IO.File]::ReadAllText((Join-Path $root 'resources\app.asar'))) -eq 'new-resource') 'New resources missing'
  Assert (!(Test-Path -LiteralPath (Join-Path $root 'resources\obsolete.txt'))) 'Obsolete resources retained'
 }else{
  Assert ($exit -ne 0 -and !$receipt.success) 'Invalid update succeeded'
  Assert (([IO.File]::ReadAllText((Join-Path $root 'ScreenSh.exe'))) -eq 'old-executable') ('Old executable not restored: '+$receipt.message)
  Assert (([IO.File]::ReadAllText((Join-Path $root 'resources\obsolete.txt'))) -eq 'old-resource') 'Old resources not restored'
  if($scenario -eq 'startup-failure'){Assert $receipt.restored ('Rollback failed: '+$receipt.message)}
 }
 Write-Output ('PORTABLE_TRANSACTION_OK '+$scenario)
}
