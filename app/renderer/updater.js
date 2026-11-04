const $=id=>document.getElementById(id);
document.documentElement.dataset.theme=localStorage.getItem('app-theme')==='dark'?'dark':'light';
function render(state){
  const titles={idle:'准备检查更新',checking:'正在检查更新',available:'发现新版本',downloading:'正在下载更新',ready:'更新已准备好',installing:'正在安装更新',current:'已是最新版本',error:'更新未完成'};
  $('title').textContent=titles[state.status]||'正在更新';
  $('version').textContent=`当前版本 ${state.currentVersion||''}`;
  $('detail').textContent=state.status==='error'?state.message:state.status==='current'?'当前已是最新版本，可以继续使用。':state.status==='installing'?'正在退出主程序，安装完成后将自动启动。':state.status==='downloading'?`正在下载 ${state.version||'新版本'}，完成后自动安装。`:'启动前检查最新版本，更新完成后进入软件。';
  if(state.status==='downloading')$('progress').value=Math.max(0,Math.min(100,state.percent||0));else $('progress').removeAttribute('value');
  $('amount').textContent=state.status==='downloading'&&state.total>0?`${(state.transferred/1048576).toFixed(1)} / ${(state.total/1048576).toFixed(1)} MB · ${Math.round(state.percent||0)}%`:'';
  $('enter').hidden=!['error','current'].includes(state.status);$('retry').hidden=state.status!=='error';
}
window.updater.onState(render);window.updater.state().then(render);
$('close').onclick=()=>window.updater.close();$('enter').onclick=()=>window.updater.enter();$('retry').onclick=()=>window.updater.retry();
