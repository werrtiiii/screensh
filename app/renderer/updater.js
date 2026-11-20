const $=id=>document.getElementById(id);
document.documentElement.dataset.theme=localStorage.getItem('app-theme')==='dark'?'dark':'light';
function render(state){
  const titles={idle:'准备更新',checking:'正在检查更新',available:'发现更新',downloading:'正在下载',ready:'下载完成',installing:'正在安装',current:'已是最新版本',error:'更新未完成'};
  $('title').textContent=titles[state.status]||'正在更新';
  $('version').textContent=state.currentVersion?`当前版本 ${state.currentVersion}`:'';
  $('detail').textContent=state.status==='error'?(state.message||'请重试') : state.status==='available'?(state.version||'') : '';
  const downloading=state.status==='downloading',percent=Math.max(0,Math.min(100,state.percent||0));
  if(downloading)$('progress').value=percent;else $('progress').removeAttribute('value');
  $('amount').textContent=downloading?`${Math.round(percent)}%`:'';
  $('enter').hidden=!['error','current'].includes(state.status);$('retry').hidden=state.status!=='error';
}
window.updater.onState(render);window.updater.state().then(render);
$('close').onclick=()=>window.updater.close();$('enter').onclick=()=>window.updater.enter();$('retry').onclick=()=>window.updater.retry();
