import {state} from './shared.js';
import {socket} from './signaling.js';
import {toast} from './toast.js';
export function initRelaySettings(request){
  const owner=document.querySelector('#serverVideoRelayEnabled'),status=document.querySelector('#serverVideoRelayStatus');
  const sharing=document.querySelector('#useServerRelayCheckbox'),hint=document.querySelector('#shareRelayStatus');
  const form=document.querySelector('#serverNetworkForm'),name=document.querySelector('#serverNetworkName'),secret=document.querySelector('#serverNetworkSecret'),host=document.querySelector('#serverRelayHost'),port=document.querySelector('#serverRelayPort'),error=document.querySelector('#serverNetworkError'),save=document.querySelector('#btnSaveServerNetwork');
  const transport=document.querySelector('#serverRelayTransport'),url=document.querySelector('#serverRelayUrl');
  function paintMode(){const direct=transport.value==='direct';document.querySelector('#serverRelayNetworkFields').classList.toggle('hidden',direct);document.querySelector('#serverRelayDirectFields').classList.toggle('hidden',!direct);host.disabled=port.disabled=direct;port.required=!direct;url.disabled=!direct;url.required=direct;}
  transport.onchange=paintMode;
  let busy=false,loadedRoom=null,operation=0,lastRoom=null,lastSocket=null,lastSocketId=null;
  function beginOperation(){
    const id=++operation,room=state.roomId,connection=socket,connectionId=socket?.id;
    return ()=>id===operation&&room===state.roomId&&connection===socket&&connectionId===socket?.id;
  }
  state.useServerRelay=localStorage.getItem('useServerRelay')==='true';sharing.checked=state.useServerRelay;
  function paint(){
    // Initialization can run before signaling's socket binding is initialized.
    const connection=state.roomId?socket:null,connectionId=connection?.id||null;
    if(lastRoom!==state.roomId||lastSocket!==connection||lastSocketId!==connectionId){
      operation++;busy=false;loadedRoom=null;secret.value='';
      lastRoom=state.roomId;lastSocket=connection;lastSocketId=connectionId;
    }
    const relay=state.videoRelay,supported=relay?.version===2;
    if(relay?.enabled===false){
      state.useServerRelay=false;
      localStorage.setItem('useServerRelay','false');
    }
    sharing.disabled=!supported||relay?.enabled!==true;
    sharing.checked=state.useServerRelay&&!sharing.disabled;
    owner.disabled=busy||!supported;owner.checked=relay?.enabled===true;
    save.disabled=busy||!supported;
    status.dataset.state=relay?.enabled&&!relay?.configured?'error':'idle';
    status.textContent=!supported?'请更新服务端以配置外部组网与转发':!relay.enabled?'已关闭软件转发，外部服务保持运行':relay.message||'请配置转发节点';
    hint.textContent=state.useServerRelay?relay?.ready?relay.transport==='direct'?'直接连接服务器 MediaMTX，本机不启动 MediaMTX':'使用已配置节点的 MediaMTX，本机不启动 MediaMTX':relay?.message||'当前服务器转发不可用':'';
    paintMode();
    if(!state.roomId){secret.value='';loadedRoom=null;}
  }
  document.querySelector('#btnServerSettings').addEventListener('click',async()=>{
    if(busy||state.serverUsers.find(user=>user.socketId===socket?.id)?.role!=='host')return;
    const current=beginOperation();busy=true;loadedRoom=null;secret.value='';error.textContent='';paint();
    try{const result=await request('get-network-settings');if(!current())return;name.value=result.network.name;secret.value=result.network.secret;host.value=result.network.relayHost;port.value=result.network.relayPort;transport.value=result.network.relayTransport||'easytier';url.value=result.network.relayUrl||'';loadedRoom=state.roomId;}
    catch(failure){if(current())error.textContent=failure.message;}
    finally{if(current()){busy=false;paint();}}
  });
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||loadedRoom!==state.roomId)return;
    const current=beginOperation();busy=true;error.textContent='';paint();
    try{const result=await request('set-network-settings',{name:name.value,secret:secret.value,relayHost:host.value,relayPort:Number(port.value),relayTransport:transport.value||'easytier',relayUrl:url.value});if(!current())return;state.videoRelay=result.videoRelay;toast('已保存。组网名称和密码在下次进入服务器时生效。');}
    catch(failure){if(current())error.textContent=failure.message;}
    finally{if(current()){busy=false;paint();}}
  };
  sharing.onchange=()=>{state.useServerRelay=!sharing.disabled&&sharing.checked;localStorage.setItem('useServerRelay',String(state.useServerRelay));paint();};
  owner.onchange=async()=>{
    if(busy)return;const enabled=owner.checked,current=beginOperation();busy=true;paint();
    try{const result=await request('set-video-relay',{enabled});if(!current())return;state.videoRelay=result.videoRelay;}
    catch(failure){if(current())error.textContent=failure.message;}
    finally{if(current()){busy=false;paint();}}
  };
  document.addEventListener('video-relay-state',paint);paint();
}
