const { execFile } = require('child_process');
const path = require('path');
// The installed app requires elevation for EasyTier. Use an interactive logon
// task with the current user's highest token rather than a blocked Run entry.
function createLoginStartup({ exe, appPath, packaged, execute = execFile }) {
  function run(mode) {
    return new Promise((resolve, reject) => execute(require('./windows-helper.cjs').windowsHelper(), ['login', mode, exe, packaged ? '--startup' : '"'+appPath+'" --startup', packaged ? path.dirname(exe) : appPath], {windowsHide:true,timeout:15000}, (error, stdout) => {
      if (error) reject(new Error('无法设置或读取开机自启，请以管理员权限运行软件后重试'));
      else if (!['true', 'false'].includes(stdout.trim())) reject(new Error('开机自启状态读取失败'));
      else resolve(stdout.trim() === 'true');
    }));
  }
  return { get: () => run('get'), set: enabled => { if (typeof enabled !== 'boolean') throw new Error('无效的开机自启设置'); return run(enabled ? 'enable' : 'disable'); } };
}
module.exports = { createLoginStartup };
