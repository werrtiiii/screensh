import { addButtonIcon } from './ui-icons.mjs';

let activeMenu, activeAnchor;
export function closeContextMenu({ restoreFocus = false } = {}) {
  activeMenu?.remove(); activeMenu = null;
  activeAnchor?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) activeAnchor?.focus();
  activeAnchor = null;
}
export function showContextMenu(event, actions, { anchor } = {}) {
  event.preventDefault(); closeContextMenu();
  if (!actions.length) return;
  const menu = document.createElement('div'); menu.className = 'context-menu'; menu.setAttribute('role', 'menu');
  for (const action of actions) {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem');
    button.textContent = action.label; button.disabled = !!action.disabled;
    if (action.icon) addButtonIcon(button, action.icon);
    button.onclick = () => { closeContextMenu({ restoreFocus: true }); action.run(); }; menu.append(button);
  }
  document.body.append(menu); activeMenu = menu;
  activeAnchor = anchor; anchor?.setAttribute('aria-expanded', 'true');
  const box = menu.getBoundingClientRect();
  const rect = anchor?.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(rect ? rect.right - box.width : event.clientX, innerWidth - box.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(rect ? rect.bottom + 6 : event.clientY, innerHeight - box.height - 8)) + 'px';
  menu.onkeydown = event => {
    const items = [...menu.querySelectorAll('button:not(:disabled)')], index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeContextMenu({ restoreFocus: true }); }
    else if (event.key === 'Tab') closeContextMenu({ restoreFocus: true });
    else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  };
  menu.querySelector('button:not(:disabled)')?.focus();
}
document.addEventListener('pointerdown', e => { if (activeMenu && !activeMenu.contains(e.target) && !activeAnchor?.contains(e.target)) closeContextMenu(); });
window.addEventListener('blur', closeContextMenu);
