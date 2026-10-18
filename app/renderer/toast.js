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
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const textNode = document.createElement('span');
  textNode.className = 'toast-msg';
  textNode.textContent = msg;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = '关闭';
  closeBtn.setAttribute('aria-label', '关闭提示');

  let dismissing = false;
  const dismiss = () => {
    if (dismissing) return;
    dismissing = true;
    clearTimeout(timer);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.remove(); return; }
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }).finished.then(() => el.remove(), () => el.remove());
  };

  closeBtn.onclick = (e) => {
    e.stopPropagation();
    dismiss();
  };

  el.appendChild(textNode);
  el.appendChild(closeBtn);
  container.appendChild(el);

  const timer = setTimeout(dismiss, 3500);
}
