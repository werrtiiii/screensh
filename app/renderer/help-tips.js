// Shared help uses viewport placement so scrolling panels cannot clip it.
export function initHelpTips() {
  let anchor, tooltip;
  function prepare(button) {
    if (button.tagName !== 'BUTTON') { button.tabIndex = 0; button.setAttribute('role', 'button'); }
    if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', '查看说明');
  }
  function hide() {
    anchor?.removeAttribute('aria-describedby');
    tooltip?.remove(); anchor = tooltip = null;
  }
  function show(button) {
    if (!button?.dataset.tooltip) return;
    hide(); prepare(button); anchor = button;
    tooltip = document.createElement('div');
    tooltip.id = 'appHelpTooltip'; tooltip.className = 'app-help-tooltip';
    tooltip.setAttribute('role', 'tooltip'); tooltip.textContent = button.dataset.tooltip;
    button.setAttribute('aria-describedby', tooltip.id);
    document.body.append(tooltip);
    const rect = button.getBoundingClientRect(), box = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.max(12, Math.min(rect.left, innerWidth - box.width - 12)) + 'px';
    const top = rect.top - box.height - 8 >= 46 ? rect.top - box.height - 8 : rect.bottom + 8;
    tooltip.style.top = Math.max(46, Math.min(top, innerHeight - box.height - 12)) + 'px';
  }
  const help = target => target instanceof Element ? target.closest('.help-tip[data-tooltip]') : null;
  document.querySelectorAll('.help-tip[data-tooltip]').forEach(prepare);
  document.addEventListener('pointerover', event => { const button = help(event.target); if (button && button !== anchor) show(button); });
  document.addEventListener('pointerout', event => {
    if (anchor && !anchor.contains(event.relatedTarget) && help(event.target) === anchor && document.activeElement !== anchor) hide();
  });
  document.addEventListener('focusin', event => { const button = help(event.target); if (button) show(button); else hide(); });
  document.addEventListener('click', event => {
    const button = help(event.target);
    if (button) { event.preventDefault(); button.focus(); show(button); } else hide();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && tooltip) { event.preventDefault(); hide(); }
    else if (['Enter', ' '].includes(event.key) && help(event.target)) { event.preventDefault(); show(help(event.target)); }
  }, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
}
