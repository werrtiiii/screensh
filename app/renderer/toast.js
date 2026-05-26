// ============================================================
// ScreenSh — Toast 消息提示
// ============================================================

export function toast(msg, type = '') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  el.className = `toast ${type}`;

  const textNode = document.createElement('span');
  textNode.className = 'toast-msg';
  textNode.textContent = msg;

  const closeBtn = document.createElement('span');
  closeBtn.className = 'toast-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = '关闭';

  closeBtn.onclick = (e) => {
    e.stopPropagation();
    if (el.parentNode) el.remove();
  };

  el.appendChild(textNode);
  el.appendChild(closeBtn);
  container.appendChild(el);

  setTimeout(() => {
    if (el.parentNode) el.remove();
  }, 3500);
}
