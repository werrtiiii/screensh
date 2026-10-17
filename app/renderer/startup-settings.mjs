export function initStartupSettings(api, notify) {
  const autoConnect = document.querySelector('#autoConnectCheckbox');
  autoConnect.checked = localStorage.getItem('autoConnectLastServer') !== 'false';
  autoConnect.onchange = () => localStorage.setItem('autoConnectLastServer', String(autoConnect.checked));
  const login = document.querySelector('#loginStartupCheckbox');
  let saved = false;
  login.disabled = true;
  api.getLoginStartup().then(enabled => {
    saved = enabled === true; login.checked = saved; login.disabled = false;
  }).catch(() => { login.disabled = false; });
  login.onchange = async () => {
    const enabled = login.checked; login.disabled = true;
    try {
      const actual = await api.setLoginStartup(enabled);
      if (actual !== enabled) throw new Error('开机自启设置未生效，请重试');
      saved = actual;
    } catch (error) { login.checked = saved; notify(error.message, 'error'); }
    finally { login.disabled = false; }
  };
}
export function lastConnectedServer() {
  if (localStorage.getItem('autoConnectLastServer') === 'false') return null;
  try {
    const last = JSON.parse(localStorage.getItem('lastConnectedServer'));
    if (!last || typeof last.url !== 'string' || typeof last.userName !== 'string' || !last.userName.trim()) return null;
    const url = new URL(last.url);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === last.url ? last : null;
  } catch { return null; }
}
