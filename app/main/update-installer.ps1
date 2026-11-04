param([Parameter(Mandatory=$true)][string]$JobFile,[string]$PreviewFile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$job=Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8|ConvertFrom-Json
function Write-InstallLog($stage,$code){try{[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($job.log))|Out-Null;[IO.File]::AppendAllText($job.log,((@{time=[DateTime]::UtcNow.ToString('o');stage=$stage;version=$job.version;exitCode=$code}|ConvertTo-Json -Compress)+[Environment]::NewLine))}catch{}}
$form=New-Object Windows.Forms.Form
$form.Text='ScreenSh 更新';$form.ClientSize=New-Object Drawing.Size(500,300);$form.StartPosition='CenterScreen';$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false;$form.MinimizeBox=$false
$dark=$job.theme -eq 'dark';$bg=if($dark){'#2b2b2b'}else{'#fbfbfb'};$fg=if($dark){'#f2f2f2'}else{'#242424'}
$form.BackColor=[Drawing.ColorTranslator]::FromHtml($bg);$form.ForeColor=[Drawing.ColorTranslator]::FromHtml($fg);$form.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
$brand=New-Object Windows.Forms.Label;$brand.Text='ScreenSh';$brand.Location=New-Object Drawing.Point(30,22);$brand.AutoSize=$true;$brand.ForeColor=[Drawing.ColorTranslator]::FromHtml($(if($dark){'#479ef5'}else{'#0f6cbd'}));$form.Controls.Add($brand)
$heading=New-Object Windows.Forms.Label;$heading.Text='正在安装更新';$heading.Font=New-Object Drawing.Font('Microsoft YaHei UI',17);$heading.Location=New-Object Drawing.Point(28,62);$heading.Size=New-Object Drawing.Size(445,38);$form.Controls.Add($heading)
$detail=New-Object Windows.Forms.Label;$detail.Text='正在等待主程序安全退出…';$detail.Location=New-Object Drawing.Point(30,113);$detail.Size=New-Object Drawing.Size(440,55);$form.Controls.Add($detail)
$bar=New-Object Windows.Forms.Panel;$bar.Location=New-Object Drawing.Point(30,183);$bar.Size=New-Object Drawing.Size(440,5);$bar.BackColor=[Drawing.ColorTranslator]::FromHtml($(if($dark){'#454545'}else{'#ededed'}));$form.Controls.Add($bar)
$fill=New-Object Windows.Forms.Panel;$fill.Size=New-Object Drawing.Size(120,5);$fill.BackColor=[Drawing.ColorTranslator]::FromHtml('#0f6cbd');$bar.Controls.Add($fill)
$retry=New-Object Windows.Forms.Button;$retry.Text='重试安装';$retry.Location=New-Object Drawing.Point(358,230);$retry.Size=New-Object Drawing.Size(110,34);$retry.BackColor=[Drawing.ColorTranslator]::FromHtml('#0f6cbd');$retry.ForeColor=[Drawing.Color]::White;$retry.FlatStyle='Flat';$retry.Visible=$false;$form.Controls.Add($retry)
$open=New-Object Windows.Forms.Button;$open.Text='打开当前版本';$open.Location=New-Object Drawing.Point(218,230);$open.Size=New-Object Drawing.Size(130,34);$open.Visible=$false;$form.Controls.Add($open)
$script:installerProcess=$null;$script:phase='waiting';$script:started=[DateTime]::UtcNow;$script:stage=$null
function Clear-Stage {
 if(!$script:stage){return}
 $tempRoot=[IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Temp'))
 $target=[IO.Path]::GetFullPath($script:stage)
 if([IO.Path]::GetDirectoryName($target) -eq $tempRoot -and [IO.Path]::GetFileName($target) -match '^ScreenSh-install-[0-9a-f-]{36}$'){
  if(Test-Path -LiteralPath $target){$item=Get-Item -LiteralPath $target;if(!($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue}}
 }
 $script:stage=$null
}
function Fail-Install($message){$script:phase='failed';$heading.Text='更新安装未完成';$detail.Text=$message;$fill.Visible=$false;$retry.Visible=$true;$open.Visible=Test-Path -LiteralPath $job.exe;Write-InstallLog 'failed' $message}
function Open-App {if($script:phase -eq 'complete'){Start-Process -FilePath $job.exe -WorkingDirectory $job.root}else{Start-Process -FilePath $job.exe -ArgumentList '--update-recovery' -WorkingDirectory $job.root}; $form.Close()}
$open.Add_Click({try{Open-App}catch{Fail-Install $_.Exception.Message}})
$retry.Add_Click({$script:phase='waiting';$script:started=[DateTime]::UtcNow;$retry.Visible=$false;$open.Visible=$false;$heading.Text='正在安装更新';$fill.Visible=$true})
$timer=New-Object Windows.Forms.Timer;$timer.Interval=250
$timer.Add_Tick({
 if($script:phase -ne 'failed'){$fill.Left=($fill.Left+35)%440}
 try{
  if($script:phase -eq 'waiting'){
   $parent=Get-Process -Id $job.parentPid -ErrorAction SilentlyContinue
   if($parent){if(([DateTime]::UtcNow-$script:started).TotalSeconds -gt 90){Fail-Install '主程序尚未退出，请退出后重试。'};return}
   $script:phase='verifying';$detail.Text='正在校验安装包…';$form.Refresh()
   $installer=[IO.Path]::GetFullPath($job.installer);$pending=[IO.Path]::GetFullPath((Join-Path $job.root 'data\updates\pending'))
   if([IO.Path]::GetDirectoryName($installer) -ne $pending){throw '更新包路径无效'}
   $hash=[Security.Cryptography.SHA512]::Create();$stream=[IO.File]::OpenRead($installer);try{$actual=[Convert]::ToBase64String($hash.ComputeHash($stream))}finally{$stream.Dispose();$hash.Dispose()}
   if($actual -ne $job.sha512){throw '更新包校验失败，请重新下载。'}
   # Legacy uninstallers scan every executable under the install root. Both
   # setup.exe and NSIS temporary executables must run outside that directory.
   Clear-Stage
   $script:stage=Join-Path (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Temp') ('ScreenSh-install-'+[Guid]::NewGuid().ToString())
   [IO.Directory]::CreateDirectory($script:stage)|Out-Null
   $stagedSetup=Join-Path $script:stage 'setup.exe';[IO.File]::Copy($installer,$stagedSetup)
   $hash=[Security.Cryptography.SHA512]::Create();$stream=[IO.File]::OpenRead($stagedSetup);try{$copied=[Convert]::ToBase64String($hash.ComputeHash($stream))}finally{$stream.Dispose();$hash.Dispose()}
   if($copied -ne $job.sha512){throw '安装临时副本校验失败。'}
   $detail.Text='正在安装 '+$job.version+'，完成后自动启动软件。'
   $info=New-Object Diagnostics.ProcessStartInfo;$info.FileName=$stagedSetup;$info.Arguments='/S --updated /D='+$job.root;$info.UseShellExecute=$false;$info.WorkingDirectory=$script:stage
   $info.EnvironmentVariables['TEMP']=$script:stage;$info.EnvironmentVariables['TMP']=$script:stage
   $script:installerProcess=[Diagnostics.Process]::Start($info);$script:phase='installing';Write-InstallLog 'installer-started' $null
  }elseif($script:phase -eq 'installing' -and $script:installerProcess.HasExited){
   $code=$script:installerProcess.ExitCode;Write-InstallLog 'installer-exited' $code;Clear-Stage
   if($code -ne 0){throw ('安装器返回错误码 '+$code+'。')}
   if(!(Test-Path -LiteralPath $job.exe)){throw '安装后未找到主程序。'}
   $versionInfo=[Diagnostics.FileVersionInfo]::GetVersionInfo($job.exe)
   $installed='{0}.{1}.{2}' -f $versionInfo.ProductMajorPart,$versionInfo.ProductMinorPart,$versionInfo.ProductBuildPart
   if($installed -ne $job.version){throw '安装后版本未更新，请重试或手动覆盖安装。'}
   $script:phase='complete';$heading.Text='更新完成';Write-InstallLog 'installed' 0;Open-App
  }
 }catch{Fail-Install $_.Exception.Message}
})
$form.Add_FormClosing({param($sender,$event)if($script:phase -eq 'installing'){$event.Cancel=$true}})
$form.Add_Shown({
 if($PreviewFile){$bitmap=New-Object Drawing.Bitmap($form.Width,$form.Height);$form.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)));$bitmap.Save($PreviewFile);$bitmap.Dispose();$form.Close();return}
 [IO.File]::WriteAllText($job.ready,'ready');$timer.Start()
})
[void]$form.ShowDialog();$timer.Dispose();Clear-Stage
