import { state, $ } from './shared.js';
import { socket } from './signaling.js';

export function initMemberNetwork() {
  const dialog = $('#memberNetworkDialog'), body = $('#memberNetworkRows'), button = $('#btnMemberNetwork');
  let generation = 0, timer;
  const open = () => !dialog.classList.contains('hidden');
  function close() { generation++; clearTimeout(timer); dialog.classList.add('hidden'); button.setAttribute('aria-expanded', 'false'); }
  async function refresh(token) {
    if (!open() || token !== generation || !state.roomId) return close();
    const room = state.roomId;
    const members = state.serverUsers.filter(user => user.socketId !== socket?.id);
    body.replaceChildren();
    const jobs = members.map(user => {
      const row = document.createElement('tr'), name = document.createElement('td'), ip = document.createElement('td'), delay = document.createElement('td');
      name.textContent = user.name; ip.textContent = user.virtualIp || '—'; delay.textContent = '检测中…'; row.append(name, ip, delay); body.append(row);
      return { user, delay };
    });
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, async () => {
      while (index < jobs.length && open() && token === generation && room === state.roomId) {
        const { user, delay } = jobs[index++];
        try {
          const result = await window.electronAPI.pingMember(user.virtualIp);
          if (token !== generation || room !== state.roomId || !open()) return;
          if (!state.serverUsers.some(current => current.socketId === user.socketId && current.virtualIp === user.virtualIp)) { delay.textContent = '已离线'; continue; }
          delay.textContent = result.ip === user.virtualIp && Number.isFinite(result.rttMs) && result.rttMs >= 0 ? (result.rttMs < 1 ? '<1 ms' : `${Math.round(result.rttMs)} ms`) : '未响应';
          delay.title = delay.textContent === '未响应' ? '对方未响应 Ping，可能是网络不通或防火墙禁止 ICMP' : '到该成员虚拟 IP 的 Ping 往返时间';
        } catch { if (token === generation && open()) delay.textContent = '检测失败'; }
      }
    }));
    if (token === generation && open() && room === state.roomId) timer = setTimeout(() => void refresh(token), 3000);
  }
  button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'memberNetworkDialog');
  button.onclick = () => { if (!state.roomId) return; clearTimeout(timer); dialog.classList.remove('hidden'); button.setAttribute('aria-expanded', 'true'); void refresh(++generation); $('#btnCloseMemberNetwork').focus(); };
  $('#btnCloseMemberNetwork').onclick = close;
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  // Also close on leaving the server, without waiting for a pending Ping batch.
  new MutationObserver(() => { if (!$('#room').classList.contains('active')) close(); }).observe($('#room'), { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(() => { button.classList.toggle('hidden', $('#userCardsView').classList.contains('hidden')); }).observe($('#userCardsView'), { attributes: true, attributeFilter: ['class'] });
}
