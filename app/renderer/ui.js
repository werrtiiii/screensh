// Scroll within the existing settings form; controls and their state stay mounted.
export function initSettingsNavigation() {
  const modal = document.querySelector('#settingsModal');
  const navigation = modal.querySelector('.settings-navigation');
  const body = modal.querySelector('.modal-body');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let targets = [];
  const visible = node => node && getComputedStyle(node).display !== 'none';
  function select(index) {
    [...navigation.children].forEach((button, i) => {
      if (i === index) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  }
  function refresh() {
    if (modal.classList.contains('hidden')) return;
    const sharing = visible(body.querySelector('.setting-room'));
    const sections = sharing
      ? [['画面', '#videoEncoderSelect'], ['采集', '#captureMethodSelect'], ['声音', '#shareAudioCheckbox'], ['码率', '#bitrateInput']]
      : [['常规', '#themeSelect'], ['音效', '#softwareSoundVolume'], ['lolPing', '#lolPingEnabled'], ['聊天', '#chatCacheEnabled'], ['语音', '#voiceMicrophone']];
    targets = sections.map(([label, selector]) => ({ label, node: body.querySelector(selector)?.closest('.form-group') })).filter(item => visible(item.node));
    navigation.replaceChildren(...targets.map(({ label, node }, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label;
      button.onclick = () => {
        body.scrollTo({ top: body.scrollTop + node.getBoundingClientRect().top - body.getBoundingClientRect().top, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
        select(index);
      };
      return button;
    }));
    select(0);
  }
  body.addEventListener('scroll', () => {
    const top = body.getBoundingClientRect().top;
    let active = 0;
    targets.forEach(({ node }, i) => { if (node.getBoundingClientRect().top <= top + 32) active = i; });
    if (body.scrollTop > 0 && body.scrollTop + body.clientHeight >= body.scrollHeight - 2) active = targets.length - 1;
    select(active);
  }, { passive: true });
  new MutationObserver(refresh).observe(modal, { attributes: true, attributeFilter: ['class'] });
  refresh();
}
