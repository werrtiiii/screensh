const { execFile } = require('child_process');
const path = require('path');
// The installed app requires elevation for EasyTier. Use an interactive logon
// task with the current user's highest token rather than a blocked Run entry.
function createLoginStartup({ exe, appPath, packaged, execute = execFile }) {
  function run(mode) {
    const script = `$ErrorActionPreference='Stop'
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent()
$taskName='ScreenSh-'+$identity.User.Value
$mode=$env:SCREENSH_STARTUP_MODE
if($mode -eq 'enable') {
  $action=New-ScheduledTaskAction -Execute $env:SCREENSH_STARTUP_EXE -Argument $env:SCREENSH_STARTUP_ARGS -WorkingDirectory $env:SCREENSH_STARTUP_DIR
  $trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
  $principal=New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Highest
  $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
} elseif($mode -eq 'disable') {
  $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if($task) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
}
$task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if($task -and $task.State -ne 'Disabled') { 'true' } else { 'false' }`;
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return new Promise((resolve, reject) => execute(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 15000,
      env: { ...process.env, SCREENSH_STARTUP_MODE: mode, SCREENSH_STARTUP_EXE: exe, SCREENSH_STARTUP_ARGS: packaged ? '--startup' : `"${appPath}" --startup`, SCREENSH_STARTUP_DIR: packaged ? path.dirname(exe) : appPath },
    }, (error, stdout) => {
      if (error) reject(new Error('无法设置或读取开机自启，请以管理员权限运行软件后重试'));
      else if (!['true', 'false'].includes(stdout.trim())) reject(new Error('开机自启状态读取失败'));
      else resolve(stdout.trim() === 'true');
    }));
  }
  return { get: () => run('get'), set: enabled => { if (typeof enabled !== 'boolean') throw new Error('无效的开机自启设置'); return run(enabled ? 'enable' : 'disable'); } };
}
module.exports = { createLoginStartup };
