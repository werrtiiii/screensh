// One keyboard contract for static dialogs and dialogs created at runtime.
export function initDialogKeyboard() {
  const stack = [];
  const composing = new WeakSet();
  let lastFocus = document.activeElement;
  let opener = null;
  let contextTrigger = null;
  let syncing = false;
  const visible = node => node?.isConnected && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const controls = modal => [...modal.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex],video[controls]')]
    .filter(node => !node.disabled && node.tabIndex >= 0 && !node.closest('[inert]') && visible(node));
  function focusFirst(modal) {
    const target = modal.querySelector('[autofocus]');
    const fallback = modal.querySelector('.modal-content') || modal;
    if (!fallback.hasAttribute('tabindex')) fallback.tabIndex = -1;
    (visible(target) && !target.disabled ? target : controls(modal).find(node => !node.classList.contains('help-tip')) || fallback).focus();
  }
  function sync() {
    if (syncing) return;
    syncing = true;
    const previousTop = stack.at(-1);
    const removed = stack.filter(entry => !visible(entry.modal));
    for (const entry of removed) {
      stack.splice(stack.indexOf(entry), 1);
      entry.modal.style.zIndex = entry.zIndex;
    }
    for (const modal of document.querySelectorAll('.modal')) {
      if (!visible(modal) || stack.some(entry => entry.modal === modal)) continue;
      const returnFocus = visible(opener) ? opener : modal.contains(document.activeElement) ? lastFocus : document.activeElement;
      stack.push({ modal, returnFocus, zIndex: modal.style.zIndex, base: Number(getComputedStyle(modal).zIndex) || 1000 });
      for (const panel of modal.querySelectorAll('.modal-content,.modal-body')) panel.scrollTop = 0;
    }
    const base = Math.max(1000, ...stack.map(entry => entry.base));
    stack.forEach((entry, i) => { entry.modal.style.zIndex = String(base + i); });
    const top = stack.at(-1)?.modal;
    if (previousTop && removed.includes(previousTop) && visible(previousTop.returnFocus) && (!top || top.contains(previousTop.returnFocus))) previousTop.returnFocus.focus();
    if (top && !top.contains(document.activeElement)) focusFirst(top);
    syncing = false;
    opener = null;
  }
  document.addEventListener('contextmenu', event => {
    contextTrigger = event.target.closest('button,[role=button],[tabindex]') || document.activeElement;
  }, true);
  document.addEventListener('click', event => {
    const trigger = event.target.closest('.context-menu') ? contextTrigger : event.target.closest('button,[role=button],a[href]');
    opener = visible(trigger) ? trigger : document.activeElement;
    queueMicrotask(() => { sync(); opener = null; });
  }, true);
  document.addEventListener('focusin', () => { sync(); lastFocus = document.activeElement; }, true);
  document.addEventListener('compositionstart', event => composing.add(event.target), true);
  document.addEventListener('compositionend', event => composing.delete(event.target), true);
  const isComposing = event => event.isComposing || event.keyCode === 229 || composing.has(event.target);
  document.addEventListener('keydown', event => {
    // Suppress implicit form submission while an IME is committing text.
    if (event.key === 'Enter' && isComposing(event)) event.preventDefault();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || isComposing(event)) return;
    sync();
    const modal = stack.at(-1)?.modal;
    if (!modal) return;
    if (event.key === 'Escape') {
      const close = modal.querySelector('.btn-close,[data-cancel],.password-cancel,#btnCancelPicker,#btnCancelChannel,#btnCancelServerPeers,#btnCancelBookmarkEdit');
      if (close && !close.disabled) { event.preventDefault(); close.click(); }
    } else if (event.key === 'Tab') {
      const nodes = controls(modal);
      if (!nodes.length) { event.preventDefault(); focusFirst(modal); return; }
      const index = nodes.indexOf(document.activeElement);
      if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === nodes.length - 1) {
        event.preventDefault(); (event.shiftKey ? nodes.at(-1) : nodes[0]).focus();
      }
    }
  });
  new MutationObserver(sync).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
}
