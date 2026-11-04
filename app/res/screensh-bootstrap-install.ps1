param([Parameter(Mandatory=$true)][string]$Stage,[Parameter(Mandatory=$true)][string]$InstallRoot,[int]$ParentPid,[switch]$Silent,[switch]$Updated,[switch]$ForceRun)
$ErrorActionPreference='Stop'
$runtimeTemp=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Temp'
[Environment]::CurrentDirectory=$runtimeTemp
Set-Location -LiteralPath $runtimeTemp
try{
 $parent=Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
 if($parent -and !$parent.WaitForExit(60000)){throw 'Original installer did not exit'}
 $setup=Join-Path $Stage 'setup.exe'
 $setupArguments='--screensh-staged'
 if($Silent){$setupArguments+=' /S'}
 if($Updated){$setupArguments+=' --updated'}
 if($ForceRun){$setupArguments+=' --force-run'}
 $setupArguments+=' /D='+$InstallRoot
 $start=New-Object Diagnostics.ProcessStartInfo
 $start.FileName=$setup;$start.Arguments=$setupArguments;$start.UseShellExecute=$false;$start.WorkingDirectory=$Stage
 $start.EnvironmentVariables['TEMP']=$runtimeTemp;$start.EnvironmentVariables['TMP']=$runtimeTemp
 $process=[Diagnostics.Process]::Start($start);$process.WaitForExit()
 $code=$process.ExitCode
}catch{$code=2}
try{
 $log=Join-Path $InstallRoot 'data\logs\update-install.log'
 [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($log))|Out-Null
 [IO.File]::AppendAllText($log,((@{time=[DateTime]::UtcNow.ToString('o');stage='legacy-bootstrap-exited';exitCode=$code}|ConvertTo-Json -Compress)+[Environment]::NewLine))
}catch{}
# Only remove this bootstrap's own direct child directory of LOCALAPPDATA\Temp.
$target=[IO.Path]::GetFullPath($Stage)
$temp=[IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Temp'))
if([IO.Path]::GetDirectoryName($target) -eq $temp -and [IO.Path]::GetFileName($target) -match '^ScreenSh-bootstrap-[0-9]+\.tmp$'){
 if(Test-Path -LiteralPath $target){$item=Get-Item -LiteralPath $target;if(!($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue}}
}
exit $code
