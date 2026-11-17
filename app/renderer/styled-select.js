// Preserve native values/change handlers; own the visible picker consistently.
export function initStyledSelects() {
  const controls = new Map();
  let opened = null, sequence = 0, search = '', searchedAt = 0;
  const unavailable = option => !option || option.disabled || option.parentElement?.disabled;
  function name(select) {
    if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
    const label = select.labels?.[0]?.cloneNode(true);
    label?.querySelectorAll('select,button,.help-tip').forEach(node => node.remove());
    return label?.textContent.trim() || '选择选项';
  }
  function close() {
    if (!opened) return;
    opened.button.setAttribute('aria-expanded', 'false');
    opened.button.removeAttribute('aria-activedescendant');
    opened.popup.remove(); opened = null; search = '';
  }
  function highlight(index) {
    if (!opened || index < 0 || unavailable(opened.select.options[index])) return;
    opened.index = index;
    [...opened.popup.children].forEach((item, i) => item.toggleAttribute('data-active', i === index));
    opened.button.setAttribute('aria-activedescendant', opened.popup.children[index].id);
    opened.popup.children[index].scrollIntoView({ block: 'nearest' });
  }
  function commit(index) {
    const { select, button } = opened;
    const option = select.options[index];
    if (!option || unavailable(option)) return;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index; close();
    controls.get(select).refresh();
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
    button.focus();
  }
  function open(select, button) {
    close();
    if (select.disabled || !select.options.length) return;
    const popup = document.createElement('div');
    popup.className = 'select-popup'; popup.id = button.id + '-options';
    popup.setAttribute('role', 'listbox'); popup.setAttribute('aria-label', name(select));
    [...select.options].forEach((option, index) => {
      const item = document.createElement('div');
      item.id = popup.id + '-' + index; item.className = 'select-option';
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(index === select.selectedIndex));
      item.setAttribute('aria-disabled', String(!!unavailable(option))); item.textContent = option.label;
      item.onpointermove = () => highlight(index);
      item.onclick = () => commit(index);
      popup.append(item);
    });
    popup.onpointerdown = event => event.preventDefault();
    document.body.append(popup);
    const rect = button.getBoundingClientRect();
    const below = innerHeight - rect.bottom - 12, above = rect.top - 46;
    const up = below < Math.min(popup.scrollHeight, 260) && above > below;
    popup.style.width = Math.min(rect.width, innerWidth - 24) + 'px';
    popup.style.maxHeight = Math.max(40, Math.min(280, up ? above - 6 : below - 6)) + 'px';
    popup.style.left = Math.max(12, Math.min(rect.left, innerWidth - popup.offsetWidth - 12)) + 'px';
    popup.style.top = (up ? rect.top - popup.offsetHeight - 6 : rect.bottom + 6) + 'px';
    opened = { select, button, popup, index: -1 };
    button.setAttribute('aria-controls', popup.id); button.setAttribute('aria-expanded', 'true');
    highlight(!unavailable(select.options[select.selectedIndex]) ? select.selectedIndex : [...select.options].findIndex(option => !unavailable(option)));
  }
  function enhance(select) {
    if (controls.has(select) || select.multiple || select.size > 1) return;
    if (!select.id) select.id = 'select-source-' + ++sequence;
    const wrapper = document.createElement('span'); wrapper.className = 'styled-select';
    const button = document.createElement('button'), text = document.createElement('span');
    button.type = 'button'; button.className = 'select-trigger'; button.id = select.id + '-control';
    button.dataset.selectFor = select.id; button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
    button.append(text);
    function refresh() {
      const label = select.selectedOptions[0]?.label || '暂无选项';
      if (text.textContent !== label) text.textContent = label;
      if (button.disabled !== select.disabled) button.disabled = select.disabled;
      button.setAttribute('aria-label', name(select));
      if (opened?.select === select && (select.disabled || !button.getClientRects().length)) close();
    }
    controls.set(select, { button, refresh });
    select.before(wrapper); wrapper.append(select, button);
    select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    select.addEventListener('change', () => { refresh(); if (opened?.select === select) close(); });
    for (const label of select.labels || []) label.addEventListener('click', event => {
      if (event.target.closest('.help-tip')) return;
      event.preventDefault(); button.focus();
    });
    new MutationObserver(() => { if (opened?.select === select) close(); refresh(); })
      .observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label'] });
    button.onclick = () => { button.focus(); if (opened?.select === select) close(); else open(select, button); };
    button.onkeydown = event => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Tab') { close(); return; }
      if (event.key === 'Escape') { if (opened) { event.preventDefault(); close(); } return; }
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const wasOpen = opened?.select === select;
        if (wasOpen && ['Enter', ' '].includes(event.key)) { if (opened.index >= 0) commit(opened.index); return; }
        if (!wasOpen) open(select, button);
        if (!opened) return;
        const enabled = [...select.options].map((option, i) => unavailable(option) ? -1 : i).filter(i => i >= 0);
        const current = enabled.indexOf(opened.index);
        if (event.key === 'Home') highlight(enabled[0]);
        else if (event.key === 'End') highlight(enabled.at(-1));
        else if (wasOpen && event.key.startsWith('Arrow')) highlight(enabled[Math.max(0, Math.min(enabled.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))]);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        if (!opened) open(select, button);
        if (!opened) return;
        search = Date.now() - searchedAt < 700 ? search + event.key : event.key; searchedAt = Date.now();
        const query = [...search].every(char => char === search[0]) ? search[0] : search;
        const options = [...select.options], start = opened.index + (query.length === 1 ? 1 : 0);
        for (let step = 0; step < options.length; step++) {
          const index = (start + step + options.length) % options.length;
          if (!unavailable(options[index]) && options[index].label.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())) { highlight(index); break; }
        }
      }
    };
    refresh();
  }
  function sync() {
    document.querySelectorAll('select').forEach(enhance);
    for (const [select, control] of controls) {
      if (!select.isConnected) { if (opened?.select === select) close(); controls.delete(select); }
      else control.refresh();
    }
  }
  document.addEventListener('pointerdown', event => { if (opened && !opened.popup.contains(event.target) && !opened.button.contains(event.target)) close(); }, true);
  document.addEventListener('focusin', event => { if (opened && event.target !== opened.button) close(); });
  document.addEventListener('scroll', event => { if (opened && !opened.popup.contains(event.target)) close(); }, true);
  window.addEventListener('resize', close); window.addEventListener('blur', close);
  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  sync();
}
