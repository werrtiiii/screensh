param([Parameter(Mandatory=$true)][string]$JobFile,[string]$RecoverTransaction)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$job=Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8|ConvertFrom-Json
$root=[IO.Path]::GetFullPath($job.root).TrimEnd('\')
$script:transaction=$null;$script:journal=$null;$script:newProcess=$null;$script:canRollback=$false;$script:archiveStream=$null
$result=Join-Path ([IO.Path]::GetDirectoryName($JobFile)) 'portable-result.json'
$status=Join-Path ([IO.Path]::GetDirectoryName($JobFile)) 'portable-state.json'
function State($phase){@{phase=$phase}|ConvertTo-Json -Compress|Set-Content -LiteralPath $status -Encoding UTF8}
function Hash($file,$algorithm){$hash=[Security.Cryptography.HashAlgorithm]::Create($algorithm);$stream=[IO.File]::OpenRead($file);try{return [Convert]::ToBase64String($hash.ComputeHash($stream))}finally{$stream.Dispose();$hash.Dispose()}}
function HexHash($file){$hash=[Security.Cryptography.SHA256]::Create();$stream=[IO.File]::OpenRead($file);try{return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$hash.Dispose()}}
function Check-Relative($value){
 if(!$value -or $value -match '[\\:\x00-\x1f]' -or $value.StartsWith('/') -or $value.Length -gt 220){throw 'Unsafe update path'}
 foreach($part in $value.Split('/')){if(!$part -or $part -in @('.','..') -or $part -match '[. ]$' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)' -or $part -match '[<>"|?*]'){throw 'Unsafe update path'}}
 $first=$value.Split('/')[0]
 if($first -ieq 'data' -or $first -match '^(?i:uninstall)' -or $first -ieq 'update-manifest.json'){throw 'Protected update path'}
 return $value.Replace('/','\')
}
function Assert-NoLinks($directory){
 $item=Get-Item -LiteralPath $directory -Force -ErrorAction SilentlyContinue
 if(!$item){return}
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse points are not allowed in update paths'}
 if($item.PSIsContainer){foreach($child in Get-ChildItem -LiteralPath $directory -Force -Recurse -ErrorAction Stop){if($child.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse points are not allowed in update paths'}}}
}
function Save-Journal {
 $file=Join-Path $script:transaction 'journal.json'
 $json=$script:journal|ConvertTo-Json -Depth 8 -Compress
 [IO.File]::WriteAllText($file+'.tmp',$json,(New-Object Text.UTF8Encoding($false)))
 if([IO.File]::Exists($file)){[IO.File]::Replace($file+'.tmp',$file,[System.Management.Automation.Language.NullString]::Value)}else{[IO.File]::Move($file+'.tmp',$file)}
}
function Remove-AppItem($name){
 $relative=Check-Relative $name
 if($relative.Contains('\')){throw 'Only top-level application items can be replaced'}
 $target=Join-Path $root $relative
 Assert-NoLinks $target
 if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}
}
function Remove-TransactionItem($name){
 if($name -notin @('new','backup')){throw 'Invalid transaction cleanup'}
 $target=[IO.Path]::GetFullPath((Join-Path $script:transaction $name))
 if([IO.Path]::GetDirectoryName($target) -ne $script:transaction){throw 'Invalid transaction cleanup path'}
 Assert-NoLinks $target
 if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}
}
function Stop-NewProcess {
 if(!$script:newProcess){return}
 # Stop only the process tree launched by this transaction, never by image name.
 $all=@(Get-CimInstance Win32_Process -ErrorAction Stop)
 $owned=@([int]$script:newProcess.Id)
 do{$more=@($all|Where-Object {$_.ParentProcessId -in $owned -and $_.ProcessId -notin $owned}|ForEach-Object {[int]$_.ProcessId});$owned+=$more}while($more.Count)
 foreach($id in $owned){
  $process=$all|Where-Object ProcessId -eq $id|Select-Object -First 1
  if($process -and $process.ExecutablePath -and [IO.Path]::GetFullPath($process.ExecutablePath).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){
   Stop-Process -Id $id -Force -ErrorAction Stop
  }
 }
 Start-Sleep -Milliseconds 500
}
function Rollback {
 try{State 'rollback'}catch{}
 $script:journal.phase='rolling-back';try{Save-Journal}catch{}
 Stop-NewProcess
 foreach($item in @($script:journal.items)){
  $backup=Join-Path (Join-Path $script:transaction 'backup') $item.name
  if(Test-Path -LiteralPath $backup){
   Remove-AppItem $item.name
   Move-Item -LiteralPath $backup -Destination (Join-Path $root $item.name)
  }elseif(!$item.hadOld -and $item.hasNew -and !(Test-Path -LiteralPath (Join-Path (Join-Path $script:transaction 'new') $item.name))){Remove-AppItem $item.name}
 }
 $script:journal.phase='rolled-back';try{Save-Journal}catch{}
 Remove-TransactionItem 'new'
}
try{
 if([IO.Path]::GetPathRoot($root).TrimEnd('\') -eq $root -or [IO.Path]::GetFullPath($job.exe) -ne (Join-Path $root 'ScreenSh.exe')){throw 'Invalid application root'}
 # A junction in any ancestor could redirect replacement outside this install.
 $ancestor=$root
 while($ancestor){$entry=Get-Item -LiteralPath $ancestor -Force;if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Installation ancestors must not be reparse points'};$ancestor=[IO.Path]::GetDirectoryName($ancestor)}
 if($RecoverTransaction){
  $target=[IO.Path]::GetFullPath($RecoverTransaction).TrimEnd('\')
  if([IO.Path]::GetDirectoryName($target) -ne (Join-Path $root 'data\updates\transactions') -or [IO.Path]::GetFileName($target) -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid recovery transaction'}
  Assert-NoLinks $target
  $script:transaction=$target;$script:journal=Get-Content -LiteralPath (Join-Path $target 'journal.json') -Raw -Encoding UTF8|ConvertFrom-Json
  if($script:journal.root -ne $root -or $script:journal.phase -notin @('applying','applied','rolling-back')){throw 'Transaction does not require recovery'}
  foreach($item in $script:journal.items){$relative=Check-Relative $item.name;if($relative.Contains('\')){throw 'Invalid recovery item'}}
  if(@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)}).Count){throw 'Close the application before recovery'}
  $script:canRollback=$true;Rollback
  @{success=$true;restored=$true}|ConvertTo-Json -Compress|Set-Content -LiteralPath $result -Encoding UTF8
  exit 0
 }
 $pending=[IO.Path]::GetFullPath((Join-Path $root 'data\updates\pending'))
 $archive=[IO.Path]::GetFullPath($job.installer)
 if([IO.Path]::GetDirectoryName($archive) -ne $pending -or [IO.Path]::GetFileName($archive) -notin @(('ScreenSh-'+$job.version+'-Update.zip'),('ScreenSh-'+$job.version+'-Update.json')) -or $job.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid portable package'}
 foreach($part in @('data','data\updates','data\updates\pending','data\updates\incremental','data\updates\transactions')){
  $entry=Get-Item -LiteralPath (Join-Path $root $part) -Force -ErrorAction SilentlyContinue
  if($entry -and ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Update data paths must not be reparse points'}
 }
 Assert-NoLinks $archive
 # Hold one read-only handle from checksum through extraction, so the checked
 # archive cannot be replaced or modified between verification and ZIP reads.
 $script:archiveStream=[IO.File]::OpenRead($archive)
 $hash=[Security.Cryptography.SHA512]::Create();try{$actual=[Convert]::ToBase64String($hash.ComputeHash($script:archiveStream))}finally{$hash.Dispose()}
 if($actual -cne $job.sha512){throw 'Update archive checksum mismatch'}
 $script:archiveStream.Position=0
 State 'extracting'
 $transactions=Join-Path $root 'data\updates\transactions'
 [void][IO.Directory]::CreateDirectory($transactions)
 foreach($previous in Get-ChildItem -LiteralPath $transactions -Directory){
  $file=Join-Path $previous.FullName 'journal.json'
  if(Test-Path -LiteralPath $file){$receipt=Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json;if($receipt.phase -in @('applying','applied','rolling-back')){throw ('An interrupted update needs recovery: '+(Join-Path $previous.FullName 'recover.cmd'))}}
 }
 $script:transaction=Join-Path $transactions ([Guid]::NewGuid().ToString())
 $new=Join-Path $script:transaction 'new';$backup=Join-Path $script:transaction 'backup'
 [void][IO.Directory]::CreateDirectory($new);[void][IO.Directory]::CreateDirectory($backup)
 [IO.File]::Copy($PSCommandPath,(Join-Path $script:transaction 'update-files.ps1'))
 [IO.File]::Copy($JobFile,(Join-Path $script:transaction 'job.json'))
 $recovery='@echo off'+[Environment]::NewLine+'"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-files.ps1" -JobFile "%~dp0job.json" -RecoverTransaction "%~dp0."'+[Environment]::NewLine+'pause'
 [IO.File]::WriteAllText((Join-Path $script:transaction 'recover.cmd'),$recovery,[Text.Encoding]::ASCII)
 $incremental=[IO.Path]::GetExtension($archive) -eq '.json'
 $zip=$null
 if($incremental){
  if($script:archiveStream.Length -gt 8388608){throw 'Incremental manifest too large'}
  $hash=[Security.Cryptography.SHA256]::Create();try{$stageName=$job.version+'-'+([BitConverter]::ToString($hash.ComputeHash($script:archiveStream))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
  $script:archiveStream.Position=0
  $reader=New-Object IO.StreamReader($script:archiveStream);try{$manifest=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose();$script:archiveStream=$null}
  $stage=Join-Path (Join-Path $root 'data\updates\incremental') $stageName;Assert-NoLinks $stage
 }else{
  $zip=New-Object IO.Compression.ZipArchive($script:archiveStream,[IO.Compression.ZipArchiveMode]::Read,$false)
  if($zip.Entries.Count -gt 30000){throw 'Too many update files'}
  $manifestEntry=$zip.GetEntry('update-manifest.json')
  if(!$manifestEntry -or $manifestEntry.Length -gt 8388608){throw 'Missing update manifest'}
  $reader=New-Object IO.StreamReader($manifestEntry.Open());try{$manifest=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
 }
 try{
  $schema=if($incremental){2}else{1}
  if($manifest.schemaVersion -ne $schema -or $manifest.version -ne $job.version -or !@($manifest.files).Count -or @($manifest.files).Count -gt 30000){throw 'Invalid update manifest'}
  $files=@{};$total=0L
  foreach($file in $manifest.files){
   $relative=Check-Relative ([string]$file.path)
   if($files.ContainsKey($relative) -or $file.sha256 -notmatch '^[a-f0-9]{64}$' -or ($file.size -isnot [int] -and $file.size -isnot [long]) -or $file.size -lt 0 -or $file.size -gt 2147483648){throw 'Invalid manifest file'}
   $files[$relative]=$file;$total+=[long]$file.size
  }
  if(!$files.ContainsKey('ScreenSh.exe') -or !$files.ContainsKey('resources\app.asar') -or $total -gt 8589934592){throw 'Incomplete update payload'}
  $drive=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($root));if($drive.AvailableFreeSpace -lt $total+104857600){throw 'Insufficient free disk space for update'}
  if($incremental){
   foreach($relative in $files.Keys){
    $input=Join-Path $stage ($relative+'.payload')
    if(!(Test-Path -LiteralPath $input)){$input=Join-Path $root $relative}
    # Re-check every input after the main application has exited. Missing local
    # bases or changed staged files fail before any installed file is moved.
    $ancestor=[IO.Path]::GetDirectoryName($input)
    while($ancestor -and $ancestor.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){Assert-NoLinks $ancestor;$ancestor=[IO.Path]::GetDirectoryName($ancestor)}
    Assert-NoLinks $input
    $item=Get-Item -LiteralPath $input -Force
    if($item.PSIsContainer -or $item.Length -ne $files[$relative].size -or (HexHash $input) -cne $files[$relative].sha256){throw 'Incremental input checksum mismatch; download update again'}
    $target=Join-Path $new $relative;[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    [IO.File]::Copy($input,$target)
    if((HexHash $target) -cne $files[$relative].sha256){throw 'Incremental copy checksum mismatch'}
   }
  }else{
  $seen=@{}
  foreach($entry in $zip.Entries){
   if($entry.FullName -eq 'update-manifest.json'){if($seen.ContainsKey('manifest')){throw 'Duplicate manifest'};$seen['manifest']=$true;continue}
   $relative=Check-Relative $entry.FullName
   if($seen.ContainsKey($relative) -or !$files.ContainsKey($relative) -or $entry.Length -ne $files[$relative].size -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960 -or ($entry.ExternalAttributes -band 1024)){throw 'Unexpected or unsafe ZIP entry'}
   $target=Join-Path $new $relative;[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
   $input=$entry.Open();$output=[IO.File]::Create($target);try{$input.CopyTo($output)}finally{$input.Dispose();$output.Dispose()}
   if((HexHash $target) -cne $files[$relative].sha256){throw 'Extracted file checksum mismatch'}
   $seen[$relative]=$true
  }
  if($seen.Count -ne $files.Count+1){throw 'Missing payload files'}
  }
 }finally{if($zip){$zip.Dispose()}}
 State 'replacing'
 $names=@($files.Keys|ForEach-Object {($_ -split '\\')[0]}|Sort-Object -Unique)
 # Remove obsolete files only inside known application roots. Never sweep the
 # installation root, data, uninstallers, shortcuts or user-created top-level files.
 $managed=@('resources','locales','ScreenSh.exe','chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll','ffmpeg.dll','icudtl.dat','libEGL.dll','libGLESv2.dll','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','vk_swiftshader.dll','vk_swiftshader_icd.json','vulkan-1.dll','LICENSE.electron.txt','LICENSES.chromium.html')
 $installed=Join-Path $root 'data\updates\installed-files.json'
 if(Test-Path -LiteralPath $installed){
  $old=Get-Content -LiteralPath $installed -Raw -Encoding UTF8|ConvertFrom-Json
  foreach($name in $old.roots){$relative=Check-Relative $name;if($relative.Contains('\')){throw 'Invalid installed file inventory'};$managed+=$relative}
 }
 $items=@()
 foreach($name in @($names+$managed|Sort-Object -Unique)){
  [void](Check-Relative $name);Assert-NoLinks (Join-Path $root $name)
  $items+=[PSCustomObject]@{name=$name;hadOld=[bool](Test-Path -LiteralPath (Join-Path $root $name));hasNew=[bool]($name -in $names)}
 }
 $script:journal=[PSCustomObject]@{root=$root;version=$job.version;phase='applying';items=$items}
 Save-Journal
 $script:canRollback=$true
 foreach($item in $items){
  if($item.hadOld){Move-Item -LiteralPath (Join-Path $root $item.name) -Destination (Join-Path $backup $item.name)}
  if($item.hasNew){Move-Item -LiteralPath (Join-Path $new $item.name) -Destination (Join-Path $root $item.name)}
 }
 $script:journal.phase='applied';Save-Journal
 State 'starting'
 $script:newProcess=Start-Process -FilePath $job.exe -WorkingDirectory $root -ArgumentList '--portable-updated' -WindowStyle Normal -PassThru
 $deadline=[DateTime]::UtcNow.AddSeconds(60)
 while(!(Test-Path -LiteralPath (Join-Path $script:transaction 'confirmed'))){
  if($script:newProcess.HasExited){throw 'The new application exited before startup confirmation'}
  if([DateTime]::UtcNow -gt $deadline){throw 'The new application did not confirm successful startup'}
  Start-Sleep -Milliseconds 250
 }
 if(([IO.File]::ReadAllText((Join-Path $script:transaction 'confirmed'))) -ne $job.version){throw 'Invalid startup confirmation'}
 $script:journal.phase='confirmed';Save-Journal
 @{version=$job.version;roots=$names}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath ($installed+'.tmp') -Encoding UTF8
 if(Test-Path -LiteralPath $installed){[IO.File]::Replace($installed+'.tmp',$installed,[System.Management.Automation.Language.NullString]::Value)}else{[IO.File]::Move($installed+'.tmp',$installed)}
 # A cleanup failure after confirmation must not roll back a running good build.
 try{Remove-TransactionItem 'backup';Remove-TransactionItem 'new'}catch{}
 @{success=$true;version=$job.version}|ConvertTo-Json -Compress|Set-Content -LiteralPath $result -Encoding UTF8
 exit 0
}catch{
 $message=$_.Exception.Message;$restored=$false
 if($script:canRollback -and $script:journal -and $script:journal.phase -ne 'confirmed'){
  try{Rollback;$restored=$true}catch{$message+='; rollback failed: '+$_.Exception.Message}
 }elseif(!$script:journal -and $script:transaction){try{Remove-TransactionItem 'new'}catch{}}
 @{success=$false;restored=$restored;message=$message;transaction=$script:transaction}|ConvertTo-Json -Compress|Set-Content -LiteralPath $result -Encoding UTF8
 exit 1
}finally{if($script:archiveStream){$script:archiveStream.Dispose()}}
