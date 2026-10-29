import {normalizePeers} from './easytier-peers.mjs';

export function initServerPeerTests(api) {
  const dialog=document.querySelector('#serverPeersDialog'),input=document.querySelector('#serverPeersInput');
  const button=document.querySelector('#btnTestServerPeers'),results=document.querySelector('#serverPeerTestResults');
  let revision=0,busy=false;
  const active=token=>token===revision&&!dialog.classList.contains('hidden');
  function reset(){revision++;results.replaceChildren();results.classList.add('hidden');}
  input.addEventListener('input',reset);
  new MutationObserver(()=>{if(dialog.classList.contains('hidden'))reset();}).observe(dialog,{attributes:true,attributeFilter:['class']});
  button.onclick=async()=>{
    if(busy)return;
    const token=++revision;
    results.replaceChildren();results.classList.remove('hidden');
    let peers;
    try {peers=normalizePeers(input.value);}
    catch(error){results.textContent=error.message;return;}
    const rows=peers.map(peer=>{
      const row=document.createElement('div'),name=document.createElement('strong'),status=document.createElement('span');
      row.className='server-peer-test-row';name.textContent=peer;status.textContent='等待测试';row.append(name,status);results.append(row);
      return {peer,row,status};
    });
    busy=true;button.disabled=true;button.textContent='测试中…';
    try {
      for(const {peer,row,status} of rows){
        if(!active(token))break;
        row.dataset.state='pending';status.textContent='正在连接与握手…';
        try {
          const result=await api.testEasyTierPeer(peer);
          if(!active(token))break;
          if(result?.peer!==peer||!Number.isFinite(result.elapsedMs)||result.elapsedMs<0)throw Error('节点返回的测试结果无效');
          row.dataset.state='success';status.textContent=`握手成功 · ${Math.round(result.elapsedMs)} ms`;
        } catch(error){if(!active(token))break;row.dataset.state='error';status.textContent=(error.message||'节点连接失败').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');}
      }
    } finally {busy=false;button.disabled=false;button.textContent='重新测试';}
  };
  return {reset};
}
