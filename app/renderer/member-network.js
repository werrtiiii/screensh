import { state, $ } from './shared.js';
import { socket } from './signaling.js';
import { toast } from './toast.js';

export function initMemberNetwork() {
  const dialog = $('#memberNetworkDialog'), body = $('#memberNetworkRows'), button = $('#btnMemberNetwork');
  let generation = 0, timer;
  const rows = new Map();
  const open = () => !dialog.classList.contains('hidden');
  function close() { generation++; clearTimeout(timer); dialog.classList.add('hidden'); button.setAttribute('aria-expanded', 'false'); }
  async function refresh(token) {
    if (!open() || token !== generation || !state.roomId) return close();
    const room = state.roomId;
    const members = state.serverUsers.filter(user => user.socketId !== socket?.id);
    const present = new Set(members.map(user => user.socketId));
    for (const [id, item] of rows) if (!present.has(id)) { item.row.remove(); rows.delete(id); }
    const jobs = members.map((user, index) => {
      let item = rows.get(user.socketId);
      if (!item) {
        const row = document.createElement('tr'), name = document.createElement('td'), ipCell = document.createElement('td'), ip = document.createElement('span'), delay = document.createElement('td');
        ip.className = 'member-virtual-ip'; ipCell.append(ip); row.append(name, ipCell, delay);
        item = { row, name, ip, delay }; rows.set(user.socketId, item);
      }
      const { row, name, ip, delay } = item;
      if (name.textContent !== user.name) name.textContent = user.name;
      if (ip.textContent !== (user.virtualIp || '—')) ip.textContent = user.virtualIp || '—';
      ip.title = user.virtualIp ? '点击复制虚拟 IP，可拖动选取' : '';
      ip.onclick = user.virtualIp ? async () => {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && (ip.contains(selection.anchorNode) || ip.contains(selection.focusNode))) return;
        try { await navigator.clipboard.writeText(user.virtualIp); toast('IP 已复制', 'success'); }
        catch { toast('复制失败，请选中 IP 后手动复制', 'error'); }
      } : null;
      delay.textContent = '检测中…';
      // Keep unchanged IP text nodes intact so periodic Ping refreshes don't clear selection.
      if (body.children[index] !== row) body.insertBefore(row, body.children[index] || null);
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
