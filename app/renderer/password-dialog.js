// Passwords remain in memory for this operation and are never stored locally.
export function requestPassword({ settings = false, enabled = true, connection } = {}) {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'modal password-modal';
    modal.innerHTML = `<form class="modal-content" role="dialog" aria-modal="true" aria-labelledby="passwordTitle">
      <div class="modal-header"><h2 id="passwordTitle">${settings ? '服务器密码' : '请输入服务器密码'}</h2><button type="button" class="btn-close" aria-label="取消">×</button></div>
      ${settings ? '<div class="form-group"><label class="password-toggle"><input id="passwordEnabled" type="checkbox"> 启用服务器密码</label></div>' : ''}
      <div class="form-group"><label for="serverPasswordInput">${settings ? '新密码' : '密码'}</label><input id="serverPasswordInput" type="password" maxlength="128" autocomplete="off" /></div>
      ${settings ? '<div class="form-group"><label for="passwordConfirm">确认新密码</label><input id="passwordConfirm" type="password" maxlength="128" autocomplete="off" /></div>' : ''}
      <p class="password-error" role="alert" style="color:var(--danger)"></p>
      <div class="dialog-actions"><button type="button" class="btn btn-outline password-cancel">取消</button><button type="submit" class="btn btn-primary">${settings ? '保存' : '连接'}</button></div>
    </form>`;
    const previous = document.activeElement;
    const input = modal.querySelector('#serverPasswordInput'), toggle = modal.querySelector('#passwordEnabled'), confirm = modal.querySelector('#passwordConfirm');
    let finished = false;
    const finish = value => {
      if (finished) return; finished = true;
      connection?.off('disconnect', cancel); input.value = ''; if (confirm) confirm.value = '';
      modal.remove(); previous?.focus(); resolve(value);
    };
    const cancel = () => finish(null);
    if (toggle) {
      toggle.checked = enabled;
      toggle.onchange = () => { input.disabled = confirm.disabled = !toggle.checked; };
      toggle.onchange();
    }
    modal.querySelector('.btn-close').onclick = cancel;
    modal.querySelector('.password-cancel').onclick = cancel;
    modal.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
      if (event.key === 'Tab') {
        const nodes = [...modal.querySelectorAll('button,input')].filter(n => !n.disabled);
        if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
      }
    });
    modal.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const active = toggle ? toggle.checked : true;
      if (active && !input.value.trim()) { modal.querySelector('.password-error').textContent = '请输入密码'; return; }
      if (active && confirm && input.value !== confirm.value) { modal.querySelector('.password-error').textContent = '两次输入的密码不一致'; return; }
      finish({ enabled: active, password: active ? input.value : '' });
    };
    document.body.append(modal); (input.disabled ? toggle : input).focus();
    connection?.once('disconnect', cancel);
    if (connection && !connection.connected) cancel();
  });
}
