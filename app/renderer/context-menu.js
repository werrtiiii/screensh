let activeMenu;
export function closeContextMenu() { activeMenu?.remove(); activeMenu = null; }
export function showContextMenu(event, actions) {
  event.preventDefault(); closeContextMenu();
  if (!actions.length) return;
  const menu = document.createElement('div'); menu.className = 'context-menu'; menu.setAttribute('role', 'menu');
  for (const action of actions) {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem');
    button.textContent = action.label; button.disabled = !!action.disabled;
    button.onclick = () => { closeContextMenu(); action.run(); }; menu.append(button);
  }
  document.body.append(menu); activeMenu = menu;
  const box = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - box.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(event.clientY, innerHeight - box.height - 8)) + 'px';
  menu.querySelector('button:not(:disabled)')?.focus();
}
document.addEventListener('pointerdown', e => { if (activeMenu && !activeMenu.contains(e.target)) closeContextMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeContextMenu(); });
window.addEventListener('blur', closeContextMenu);
