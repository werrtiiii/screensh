# Optional elevated test of the built application, in a new workspace fixture.
param([switch]$Incremental,[string]$Node='node')
$ErrorActionPreference='Stop'
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$version=(Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw|ConvertFrom-Json).version
$root=Join-Path $appRoot ('.runtime-probe\packaged-portable-'+[Guid]::NewGuid().ToString())
if(!$root.StartsWith($appRoot+'\.runtime-probe\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid test root'}
$pending=Join-Path $root 'data\updates\pending';[void][IO.Directory]::CreateDirectory($pending)
[void][IO.Directory]::CreateDirectory((Join-Path $root 'data\user-data'))
[void][IO.Directory]::CreateDirectory((Join-Path $root 'resources'))
[IO.File]::WriteAllText((Join-Path $root 'ScreenSh.exe'),'old-fixture')
[IO.File]::WriteAllText((Join-Path $root 'resources\old-fixture.txt'),'old-resource')
[IO.File]::WriteAllText((Join-Path $root 'data\user-data\auto-update.json'),'{"enabled":false}')
[IO.File]::WriteAllText((Join-Path $root 'data\keep-profile.txt'),'preserved')
if($Incremental){
 & $Node (Join-Path $PSScriptRoot 'prepare-packaged-incremental.cjs') $root (Join-Path $appRoot 'dist')
 if($LASTEXITCODE -ne 0){throw 'Cannot prepare incremental test'}
 $archive=Join-Path $pending ('ScreenSh-'+$version+'-Update.json')
}else{
 $archive=Join-Path $pending ('ScreenSh-'+$version+'-Update.zip')
 [IO.File]::Copy((Join-Path $appRoot ('dist\ScreenSh-'+$version+'-Update.zip')),$archive)
}
$hash=[Security.Cryptography.SHA512]::Create();$stream=[IO.File]::OpenRead($archive);try{$sha=[Convert]::ToBase64String($hash.ComputeHash($stream))}finally{$stream.Dispose();$hash.Dispose()}
$job=Join-Path $root 'data\job.json'
@{root=$root;exe=(Join-Path $root 'ScreenSh.exe');installer=$archive;sha512=$sha;version=$version}|ConvertTo-Json|Set-Content -LiteralPath $job -Encoding UTF8
try{
 $native=Start-Process -FilePath (Join-Path $appRoot 'res\screensh-updater.exe') -ArgumentList ('--worker "'+$job+'"') -WindowStyle Hidden -PassThru
 $native.WaitForExit()
 $global:LASTEXITCODE=$native.ExitCode
 if($Incremental -and $LASTEXITCODE -eq 0){
  $deadline=[DateTime]::UtcNow.AddSeconds(10)
  while((Test-Path -LiteralPath $archive) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
  $stage=[IO.File]::ReadAllText((Join-Path $root 'data\expected-stage.txt'))
  while((Test-Path -LiteralPath $stage) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
 }
}finally{
 # Only fixture processes under this freshly-created absolute root are owned.
 Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)}|ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
}
 $receipt=Get-Content -LiteralPath (Join-Path $root 'data\portable-result.json') -Raw -Encoding UTF8|ConvertFrom-Json
 if(!$receipt.success -or [IO.File]::ReadAllText((Join-Path $root 'data\keep-profile.txt')) -ne 'preserved' -or (Test-Path -LiteralPath (Join-Path $root 'resources\old-fixture.txt'))){throw 'Packaged portable verification failed'}
 if($Incremental){
  $stage=[IO.File]::ReadAllText((Join-Path $root 'data\expected-stage.txt'))
  if((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $archive) -or (Test-Path -LiteralPath (Join-Path $root 'data\updates\installer.exe')) -or (Test-Path -LiteralPath (Join-Path $root 'data\updates\portable.zip'))){throw 'Healthy startup did not clean update caches'}
  Write-Output 'PACKAGED_INCREMENTAL_STARTUP_AND_CACHE_CLEANUP_OK'
 }
 Write-Output 'PACKAGED_PORTABLE_STARTUP_CONFIRMED_AND_DATA_PRESERVED'
