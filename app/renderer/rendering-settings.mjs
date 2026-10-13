// The main-process config is the single source of truth. GPU flags apply at startup.
export async function bindRenderingSettings(checkbox, api, notify) {
  let saved = false;
  checkbox.disabled = true;
  try {
    saved = await api.getHardwareAcceleration();
    if (typeof saved !== 'boolean') throw new Error('无法读取硬件加速配置');
    checkbox.checked = saved;
  } catch (error) {
    notify(error.message || '渲染设置读取失败', 'error');
    return;
  }
  checkbox.disabled = false;
  checkbox.addEventListener('change', async () => {
    const enabled = checkbox.checked;
    if (checkbox.disabled) { checkbox.checked = saved; return; }
    checkbox.disabled = true;
    try {
      const result = await api.setHardwareAcceleration(enabled);
      if (result !== enabled) throw new Error('硬件加速设置未保存，请重试');
      saved = result;
      notify(`${saved ? '硬件加速' : '软件渲染'}已设置，重启客户端后生效`, 'success');
    } catch (error) {
      notify(error.message || '渲染设置保存失败', 'error');
    } finally {
      checkbox.checked = saved;
      checkbox.disabled = false;
    }
  });
}
