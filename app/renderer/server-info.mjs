const beijing = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});
export function formatBeijingTime(value) { return beijing.format(new Date(value)); }
export function formatServerDuration(milliseconds) {
  let seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  if (days) return `${days}天 ${hours}小时`;
  if (hours) return `${hours}小时 ${minutes}分`;
  return minutes ? `${minutes}分 ${seconds}秒` : `${seconds}秒`;
}
export function formatServerAge(createdAt, now) {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return '未知';
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000));
  for (const [unit, label] of [[31536000,'年'], [2592000,'个月'], [86400,'天'], [3600,'小时'], [60,'分钟']]) if (seconds >= unit) return `${Math.floor(seconds / unit)}${label}前`;
  return '刚刚';
}

export function initServerInfo() {
  const root = document.querySelector('#serverInfo'), room = document.querySelector('#room');
  if (!root || !room) return;
  let stats = null, receivedAt = 0, timer;
  const set = (id, value) => { const node = root.querySelector('#' + id); if (node.textContent !== value) node.textContent = value; };
  function render() {
    if (!stats) { for (const id of ['Users','Channels','Uptime','Created','Beijing']) set('serverInfo' + id, '—'); return; }
    const elapsed = Math.max(0, performance.now() - receivedAt);
    const now = stats.serverTime + elapsed;
    set('serverInfoUsers', `${stats.users} / ${stats.maxUsers}`);
    set('serverInfoChannels', String(stats.channels));
    set('serverInfoUptime', formatServerDuration(stats.uptimeMs + elapsed));
    set('serverInfoCreated', formatServerAge(stats.createdAt, now));
    const created = root.querySelector('#serverInfoCreated'); created.title = stats.createdAt ? formatBeijingTime(stats.createdAt) + '（北京时间）' : '服务器未记录创建时间';
    set('serverInfoBeijing', formatBeijingTime(now));
    root.querySelector('time').dateTime = new Date(now).toISOString();
  }
  function syncTimer() {
    clearInterval(timer); timer = null;
    if (!room.classList.contains('active')) { stats = null; render(); return; }
    render();
    if (stats && !document.hidden) timer = setInterval(render, 1000);
  }
  document.addEventListener('server-stats-updated', event => {
    const data = event.detail;
    stats = data && ['users','maxUsers','channels','uptimeMs','serverTime'].every(key => Number.isFinite(data[key]) && data[key] >= 0) ? data : null;
    receivedAt = performance.now(); syncTimer();
  });
  new MutationObserver(syncTimer).observe(room, {attributes:true, attributeFilter:['class']});
  document.addEventListener('visibilitychange', syncTimer);
}
