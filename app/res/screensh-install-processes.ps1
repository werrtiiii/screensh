param([Parameter(Mandatory=$true)][string]$InstallRoot,[int]$InstallerPid,[switch]$Inspect)
$ErrorActionPreference='Stop'
try{
 $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')+'\'
 $data=[IO.Path]::Combine($root,'data').TrimEnd('\')+'\'
 $matches=@(Get-CimInstance Win32_Process|Where-Object{$_.ExecutablePath -and $_.ProcessId -ne $InstallerPid -and $_.ExecutablePath.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -and !$_.ExecutablePath.StartsWith($data,[StringComparison]::OrdinalIgnoreCase)})
 if($Inspect){$matches|Select-Object ProcessId,ExecutablePath|ConvertTo-Json -Compress;exit 0}
 foreach($entry in $matches){
  # Recheck the path before closing so a recycled PID cannot target another app.
  $p=Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
  if($p -and $p.Path -eq $entry.ExecutablePath){Stop-Process -Id $p.Id -ErrorAction Stop;[void]$p.WaitForExit(15000)}
 }
 exit 0
}catch{Write-Output '无法安全关闭旧版进程，请完全退出 ScreenSh 后重试。';exit 2}
