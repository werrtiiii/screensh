import { addButtonIcon } from './ui-icons.mjs';

export function initMemberSidebar() {
  const button = document.querySelector('#btnToggleMembers');
  const sidebar = document.querySelector('#serverMembersSidebar');
  function apply(collapsed) {
    sidebar.hidden = collapsed;
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = collapsed ? '展开成员列表' : '收起成员列表';
    button.setAttribute('aria-label', button.title);
  }
  apply(localStorage.getItem('membersSidebarCollapsed') === 'true');
  button.addEventListener('click', () => {
    apply(!sidebar.hidden);
    localStorage.setItem('membersSidebarCollapsed', String(sidebar.hidden));
  });
}

export function initGlassTransparency() {
  document.documentElement.classList.toggle('native-titlebar-glass', window.electronAPI?.nativeTitlebarGlass === true);
  window.electronAPI?.onWindowState?.(({ maximized, fullscreen }) => {
    document.documentElement.classList.toggle('window-expanded', maximized || fullscreen);
    const button = document.querySelector('#btnMaxWindow');
    button.title = maximized ? '还原' : '最大化';
    button.setAttribute('aria-label', button.title);
    button.classList.toggle('is-maximized', maximized);
  });
  const slider = document.querySelector('#glassTransparency');
  const output = document.querySelector('#glassTransparencyValue');
  const reset = document.querySelector('#btnResetGlassTransparency');
  const hint = document.querySelector('#glassTransparencyHint');
  const defaultValue = Number(slider.defaultValue);
  function apply(value, save = false) {
    const amount = Number.isFinite(value) && value >= Number(slider.min) && value <= Number(slider.max) ? Math.round(value) : defaultValue;
    slider.value = String(amount);
    slider.setAttribute('aria-valuetext', amount + '%');
    slider.style.setProperty('--range-progress', amount / Number(slider.max) * 100 + '%');
    output.value = amount + '%';
    document.documentElement.style.setProperty('--glass-transparency', amount + '%');
    if (save) localStorage.setItem('glassTransparency', String(amount));
  }
  apply(Number(localStorage.getItem('glassTransparency') ?? defaultValue));
  slider.addEventListener('input', () => apply(Number(slider.value), true));
  reset.addEventListener('click', () => apply(defaultValue, true));
  const solidSurface = matchMedia('(prefers-reduced-transparency: reduce), (forced-colors: active)');
  function updateAvailability() {
    slider.disabled = reset.disabled = solidSurface.matches;
    hint.textContent = solidSurface.matches
      ? '系统已开启减少透明度或高对比度，当前使用实底。'
      : '';
    hint.hidden = !solidSurface.matches;
  }
  solidSurface.addEventListener('change', updateAvailability);
  updateAvailability();
}

// Keep controls mounted so changing categories preserves unsaved values.
export function initSettingsNavigation() {
  for (const button of document.querySelectorAll('[data-source-tab]')) {
    addButtonIcon(button, button.dataset.sourceTab === 'settings' ? 'general' : button.dataset.sourceTab);
  }
  const modal = document.querySelector('#settingsModal');
  const navigation = modal.querySelector('.settings-navigation');
  const body = modal.querySelector('.modal-body');
  const categories = {
    system: [
      ['general', '常规', '.setting-theme,.setting-startup,.setting-hardware,.setting-update,.setting-sounds'],
      ['lolping', 'lolPing', '.setting-lolping'],
      ['network', 'EasyTier', '.setting-easytier'],
      ['chat', '聊天记录', '.setting-chat'],
      ['voice', '语音', '.setting-voice'],
      ['sharing', '屏幕共享', '.setting-sharing'],
      ['profile', '个人资料', '.setting-profile'],
    ],
    sharing: [
      ['picture', '画面', '#videoEncoderSelect,#resolutionSelect,#frameRateSelect,#bitrateInput,#autoPreviewCheckbox,#adaptiveResolutionCheckbox', '共享设置自动保存，下次确认共享时生效。外部 OBS 沿用 OBS 设置。'],
      ['audio', '声音', '#shareAudioCheckbox,#audioBitrateSelect'],
      ['capture', '采集', '#captureMethodSelect'],
      ['relay', '转发', '#useServerRelayCheckbox'],
    ],
  };
  for (const sections of Object.values(categories)) {
    for (const section of sections) {
      const [id, label, selector, description] = section;
      const controls = [...new Set([...body.querySelectorAll(selector)].map(node => node.closest('.form-group')))];
      const panel = document.createElement('section');
      panel.id = 'settings-panel-' + id;
      panel.className = 'settings-panel';
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', 'settings-tab-' + id);
      panel.hidden = true;
      const heading = document.createElement('h3');
      heading.className = 'settings-panel-title';
      heading.id = 'settings-heading-' + id;
      heading.textContent = label;
      if (description) {
        const help = document.createElement('button');
        help.type = 'button'; help.className = 'help-tip'; help.textContent = '?';
        help.setAttribute('aria-label', label + '设置说明');
        help.dataset.tooltip = description;
        heading.append(help);
      }
      panel.append(heading, ...controls);
      body.append(panel);
      section.push(panel);
    }
  }
  const sharingPanels = categories.sharing.map(section => section.at(-1));
  function mountSharing(target) {
    for (const panel of sharingPanels) {
      target.append(panel); panel.hidden = false; panel.setAttribute('role', 'region');
      panel.setAttribute('aria-labelledby', panel.querySelector('.settings-panel-title').id);
    }
  }
  function restoreSharing() {
    for (const panel of sharingPanels) {
      if (panel.parentElement !== body) {
        panel.hidden = true; panel.setAttribute('role','tabpanel');
        panel.setAttribute('aria-labelledby',panel.id.replace('settings-panel-','settings-tab-'));body.append(panel);
      }
    }
  }
  document.addEventListener('share-settings-visibility', event => {
    if (!event.detail.visible) { restoreSharing(); return; }
    const target = document.querySelector('#screenShareSettings');
    mountSharing(target);
    target.scrollTop = 0;
  });
  const picker = document.querySelector('#screenPicker');
  new MutationObserver(() => { if (picker.classList.contains('hidden')) restoreSharing(); }).observe(picker, { attributes: true, attributeFilter: ['class'] });
  navigation.setAttribute('role', 'tablist');
  navigation.setAttribute('aria-orientation', 'vertical');
  function placeSelection() {
    const selected = navigation.querySelector('[aria-selected="true"]');
    if (!selected?.offsetHeight) return;
    navigation.style.setProperty('--selection-offset', selected.offsetTop + 'px');
    navigation.style.setProperty('--selection-height', selected.offsetHeight + 'px');
  }
  new ResizeObserver(placeSelection).observe(navigation);
  function open(mode = 'system') {
    navigation.style.removeProperty('--selection-offset');
    navigation.style.removeProperty('--selection-height');
    for (const panel of body.querySelectorAll('.settings-panel')) panel.hidden = true;
    if (mode === 'system') mountSharing(document.querySelector('#settings-panel-sharing'));
    const sections = categories[mode];
    const select = index => {
      [...navigation.children].forEach((button, i) => {
        button.setAttribute('aria-selected', String(i === index));
        button.tabIndex = i === index ? 0 : -1;
        button.toggleAttribute('aria-current', i === index);
        sections[i].at(-1).hidden = i !== index;
      });
      if (mode === 'system') {
        for (const panel of sharingPanels) panel.hidden = sections[index][0] !== 'sharing';
      }
      body.scrollTop = 0;
      placeSelection();
    };
    navigation.replaceChildren(...sections.map(([id, label, ...rest], index) => {
      const panel = rest.at(-1);
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label;
      addButtonIcon(button, id);
      button.id = 'settings-tab-' + id;
      button.dataset.category = id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panel.id);
      button.onclick = () => select(index);
      button.onkeydown = event => {
        const keys = { ArrowDown: (index + 1) % sections.length, ArrowUp: (index + sections.length - 1) % sections.length, Home: 0, End: sections.length - 1 };
        if (!(event.key in keys)) return;
        event.preventDefault(); select(keys[event.key]); navigation.children[keys[event.key]].focus();
      };
      return button;
    }));
    modal.querySelector('#updateAccelerationDetails').open = false;
    select(0);
    // open() runs before the hidden modal is displayed; measure after layout too.
    requestAnimationFrame(placeSelection);
  }
  return { open, restoreSharing };
}
