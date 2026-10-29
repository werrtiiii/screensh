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
    const members = [...state.serverUsers].sort((a,b)=>Number(b.socketId===socket?.id)-Number(a.socketId===socket?.id));
    const present = new Set(members.map(user => user.socketId));
    for (const [id, item] of rows) if (!present.has(id)) { item.row.remove(); rows.delete(id); }
    const jobs = members.map((user, index) => {
      let item = rows.get(user.socketId);
      if (!item) {
        const row = document.createElement('tr'), name = document.createElement('td'), ipCell = document.createElement('td'), ip = document.createElement('span'), delay = document.createElement('td');
        const route=document.createElement('td'),protocol=document.createElement('td');
        ip.className = 'member-virtual-ip'; ipCell.append(ip); row.append(name, ipCell, delay,route,protocol);
        route.textContent=protocol.textContent='—';
        item = { row, name, ip, delay,route,protocol }; rows.set(user.socketId, item);
      }
      const { row, name, ip, delay } = item;
      if (name.textContent !== user.name) name.textContent = user.name;
      name.title=user.name;
      if (ip.textContent !== (user.virtualIp || '—')) ip.textContent = user.virtualIp || '—';
      ip.title = user.virtualIp ? '点击复制虚拟 IP，可拖动选取' : '';
      ip.onclick = user.virtualIp ? async () => {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && (ip.contains(selection.anchorNode) || ip.contains(selection.focusNode))) return;
        try { await navigator.clipboard.writeText(user.virtualIp); toast('IP 已复制', 'success'); }
        catch { toast('复制失败，请选中 IP 后手动复制', 'error'); }
      } : null;
      const self=user.socketId===socket?.id;
      delay.textContent = self?'—':'检测中…';
      delay.title=self?'本机':'';
      if(self){item.route.textContent='本机';item.protocol.textContent='—';}
      // Keep unchanged IP text nodes intact so periodic Ping refreshes don't clear selection.
      if (body.children[index] !== row) body.insertBefore(row, body.children[index] || null);
      return { user, delay,self };
    });
    const routesJob=Promise.resolve().then(()=>window.electronAPI.getMemberRoutes()).catch(()=>({available:false,rows:[]})).then(result=>{
      if(token!==generation||room!==state.roomId||!open())return;
      const routeByIp=new Map((result?.available?result.rows:[]).map(row=>[row.ip,row]));
      for(const user of members){
        if(user.socketId===socket?.id)continue;
        const item=rows.get(user.socketId);
        if(!item||!state.serverUsers.some(current=>current.socketId===user.socketId&&current.virtualIp===user.virtualIp))continue;
        const info=routeByIp.get(user.virtualIp);
        item.route.textContent=info?.route||'—';item.protocol.textContent=info?.protocol||'—';
        item.route.title=info?'本机到该成员的 EasyTier 路由':'暂未获取到该成员的 EasyTier 路由';
        item.protocol.title=info?info.protocol+' · EasyTier 隧道协议；6 后缀表示 IPv6 传输':'暂未获取到该成员的隧道协议';
      }
    });
    let index = 0;
    await Promise.all([routesJob,...Array.from({ length: Math.min(6, jobs.length) }, async () => {
      while (index < jobs.length && open() && token === generation && room === state.roomId) {
        const { user, delay,self } = jobs[index++];
        if(self)continue;
        try {
          const result = await window.electronAPI.pingMember(user.virtualIp);
          if (token !== generation || room !== state.roomId || !open()) return;
          if (!state.serverUsers.some(current => current.socketId === user.socketId && current.virtualIp === user.virtualIp)) { delay.textContent = '已离线'; continue; }
          const measured=result.ip === user.virtualIp && Number.isFinite(result.rttMs) && result.rttMs >= 0;
          delay.textContent = measured ? (result.rttMs < 1 ? '<1 ms' : `${Math.round(result.rttMs)} ms`) : '未响应';
          delay.title = !measured?'未取得延迟：可能是对方版本不支持 UDP 探测、探测被拦截或网络暂时不可达；不代表媒体连接一定中断':result.source==='probe'?'经过 EasyTier 路由到该成员的 UDP 探测往返时间（包含中继）':result.source==='tunnel'?'EasyTier 直连隧道 RTT（探测未响应时的参考值，不是端到端 UDP 实测）':'到该成员虚拟 IP 的 ICMP Ping 往返时间';
        } catch { if (token === generation && open()) delay.textContent = '检测失败'; }
      }
    })]);
    if (token === generation && open() && room === state.roomId) timer = setTimeout(() => void refresh(token), 3000);
  }
  button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'memberNetworkDialog');
  button.onclick = () => { if (!state.roomId) return; clearTimeout(timer); dialog.classList.remove('hidden'); button.setAttribute('aria-expanded', 'true'); void refresh(++generation); $('#btnCloseMemberNetwork').focus(); };
  $('#btnCloseMemberNetwork').onclick = close;
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  // Also close on leaving the server, without waiting for a pending Ping batch.
  new MutationObserver(() => { if (!$('#room').classList.contains('active')) close(); }).observe($('#room'), { attributes: true, attributeFilter: ['class'] });
}
