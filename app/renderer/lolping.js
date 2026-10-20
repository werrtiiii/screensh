import { state, $ } from './shared.js';
import { socket, requestServer } from './signaling.js';
import { toast } from './toast.js';
import { codeToVk, vkLabel, hotkeyLabel, eventMods, UNSAFE_TRIGGER_VKS, DEFAULT_WHEEL, DEFAULT_EMOTE_WHEEL } from '../lolping/dist/settings-tools.mjs';
const CONFIG_ID = '00000000-0000-0000-0000-000000000000';
let serverSupport = false, cached, syncingKey, generation = 0, closing = false;
const api = () => window.electronAPI;
const statusText = text => { if ($('#lolPingStatus')) $('#lolPingStatus').textContent = text; };
const currentContext = () => state.leaving || state.switchingChannel ? null : socket?.connected && state.roomId ?
  { serverId: state.roomId, channelId: serverSupport ? state.channelId || null : null, socketId: socket.id, name:state.serverUsers.find(u=>u.socketId===socket.id)?.name, virtualIp: state.virtualIp, connected: true,
    peers: state.serverUsers.filter(u => state.channelId && u.channelId === state.channelId && u.socketId !== socket.id && u.lolpingEndpoint)
      .map(u => ({ socketId: u.socketId, name: u.name, virtualIp: u.virtualIp, channelId: u.channelId, lolpingEndpoint: u.lolpingEndpoint })) } :
  { serverId: CONFIG_ID, channelId: null, socketId: 'local', name: state.userName || localStorage.getItem('userName') || '', virtualIp: null, peers: [], connected: true };
async function load() {
  if (!api()?.getLolPing) return null;
  if (cached) return cached;
  const result = await api().getLolPing(CONFIG_ID);
  cached = result;
  return result;
}
export function syncLolPing(supported) {
  if (closing) return;
  if (arguments.length) serverSupport = supported === 'easytier-udp-v1';
  const context = currentContext(), key = JSON.stringify([context, serverSupport, cached?.config]);
  if (key === syncingKey) return;
  syncingKey = key; const token = ++generation;
  void (async () => {
    const data = await load();
    if (token !== generation) return;
    const enabled = !!(data?.config.enabled && context);
    const endpoint = await api()?.syncLolPing?.(enabled ? context : null);
    if (token !== generation) return;
    if (socket?.connected && state.roomId && serverSupport) await requestServer('lolping-enable', { enabled: enabled && !!endpoint, channelId: context?.channelId, endpoint });
    if (token !== generation) return;
    $('#lolPingEnabled').checked = !!data?.config.enabled;
    statusText(enabled ? (context.channelId&&data.config.features.rooms?'已启用 · 与同频道成员共享':'已启用 · 仅自己可见') : '开启后可在本机使用，进入频道后与成员共享');
  })().catch(error => { if (token === generation) { statusText(error.message); syncingKey = null; } });
}
export function stopLolPing() {
  const token = ++generation; syncingKey = null;
  void Promise.resolve(api()?.syncLolPing?.(null)).then(() => {
    if (token === generation && !closing && !state.leaving && !state.switchingChannel) syncLolPing();
  }).catch(error => console.warn('[lolPing]', error));
}
window.addEventListener('beforeunload', () => { closing = true; stopLolPing(); });
api()?.onLolPingStatus?.(({ status, error }) => {
  if(status==='settings-changed'){void api().getLolPing(CONFIG_ID).then(data=>{cached=data;syncingKey=null;syncLolPing();}).catch(error=>statusText(error.message));return;}
  if(status==='kicked'){if(cached)cached.config.enabled=false;syncingKey=null;syncLolPing();toast(error||'已退出 lolPing 房间');return;}
  if (closing || !currentContext() || !cached?.config.enabled) return;
  statusText(error || ({ running: currentContext().channelId&&cached.config.features.rooms?'已启用 · EasyTier 频道房间':'已启用 · 仅自己可见', paused: `已暂停 · ${hotkeyLabel(cached.config.toggleHotkey)} 恢复`, starting: '正在启动 lolPing…', failed: 'lolPing 输入助手启动失败' })[status] || 'lolPing 已停止');
});
$('#btnSettings')?.addEventListener('click', () => {
  void load().then(data => { if (data && $('#lolPingEnabled')) $('#lolPingEnabled').checked = data.config.enabled; }).catch(error => statusText(error.message));
});
$('#lolPingEnabled')?.addEventListener('change', async event => {
  const button = event.target; button.disabled = true;
  try {
    const data = await api().saveLolPing(CONFIG_ID, { enabled: button.checked });
    cached = data; syncingKey = null; syncLolPing();
  } catch (error) { button.checked = !!cached?.config.enabled; toast(error.message, 'error'); }
  finally { button.disabled = false; }
});
const triggerOptions = [['alt','Alt'],['ctrl','Ctrl'],['shift','Shift'],['win','Win'],['capslock','Caps Lock'],['mouse4','鼠标侧键 4'],['mouse5','鼠标侧键 5'],['custom','其他按键…']];
const fields = [
  ['trigger','标记触发键','select',triggerOptions], ['emoteTrigger','表情触发键','select',[['off','关闭'],...triggerOptions]],
  ['volume','音效音量','range',0,100,1], ['pingSizePx','标记大小','range',60,220,1], ['pingDurationS','标记持续时间（秒）','range',1,8,0.1],
  ['wheelSizePx','轮盘大小','range',300,900,10], ['dragThresholdPx','拖动触发距离','range',2,40,1],
  ['emoteSizePx','表情大小','range',80,300,1], ['incomingPingLimit','每人每秒接收上限（0 为不限）','range',0,20,1],
  ['clickPing','触发键 + 单击放置标记','checkbox'], ['gameCheck','全屏应用中暂停','checkbox'], ['keepLastPing','保留自己的最后一个标记','checkbox'],
  ['tickSound','轮盘选择音效','checkbox'], ['muted','静音 lolPing 音效','checkbox'], ['emoteClick','表情触发键 + 单击放置表情','checkbox'], ['emoteSound','表情音效','checkbox'],
  ['roomMuted','静音房间内容','checkbox'], ['roomTextStyle','好友文字显示','select',[['spot','指示位置'],['danmaku','顶部弹幕']]],
];
let captureEnd;
function capture(button,key,kind) {
  const label=()=>button.textContent=kind==='hotkey'?hotkeyLabel(key.value):vkLabel(typeof key.value==='object'?key.value.vk:key.value);
  label();button.onclick=async()=>{
    captureEnd?.();await api().suspendLolPingInput?.(true);button.textContent='按下按键（Esc 取消）';
    let ended=false;const end=()=>{if(ended)return;ended=true;document.removeEventListener('keydown',listen,true);window.removeEventListener('blur',end);button.removeEventListener('blur',end);captureEnd=null;label();void api().suspendLolPingInput?.(false);};
    const listen=e=>{e.preventDefault();e.stopPropagation();if(e.code==='Escape'){end();return;}const vk=codeToVk(e.code);if(vk===null)return;
      if(kind==='trigger'&&UNSAFE_TRIGGER_VKS.includes(vk)){$('#lolPingError').textContent='请选择其他按键，回车、空格和导航键保留给正常输入';return;}
      const mods=eventMods(e);if(kind==='hotkey'&&!(mods&11)){$('#lolPingError').textContent='快捷键必须包含 Ctrl、Alt 或 Win';return;}
      key.value=kind==='hotkey'?{mods,vk}:kind==='trigger'?{vk}:vk;$('#lolPingError').textContent='';end();};
    captureEnd=end;document.addEventListener('keydown',listen,true);window.addEventListener('blur',end,{once:true});button.addEventListener('blur',end,{once:true});
  };
}
let keyValues={},featureInputs={};
new MutationObserver(()=>{if($('#lolPingDialog')?.classList.contains('hidden'))captureEnd?.();}).observe($('#lolPingDialog'),{attributes:true,attributeFilter:['class']});
function select(options, value) { const input = document.createElement('select'); for (const [id,name] of options) { const option = document.createElement('option'); option.value = id; option.textContent = name; input.append(option); } input.value = value; return input; }
function renderFields(data) {
  const container = $('#lolPingFields'); container.replaceChildren();
  const wheelCenters={};
  keyValues={};featureInputs={};
  for(const [key,title]of[['emotes','表情'],['rooms','频道房间同步'],['roomText','房间文字'],['roomVotes','投票'],['roomPanel','Tab 房间面板']]){const row=document.createElement('label');row.className='lolping-field';row.textContent=title;const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.checked=data.config.features[key];featureInputs[key]=input;row.append(input);container.append(row);input.onchange=()=>visibility();}
  for (const [key,label,type,...limits] of fields) {
    const row = document.createElement('label'); row.className = 'lolping-field'; row.textContent = label;
    const input = type === 'select' ? select(limits[0], typeof data.config[key]==='object'?'custom':data.config[key]) : document.createElement('input'); input.name = key;
    if (type !== 'select') { input.type = type; if (type === 'checkbox') { input.checked = data.config[key]; input.setAttribute('role','switch'); } else { [input.min,input.max,input.step] = limits; input.value = data.config[key]; const output = document.createElement('output'); output.value = input.value; input.oninput = () => output.value = input.value; row.append(output); } }
    row.append(input); container.append(row);
    row.dataset.setting=key;
    if(key==='trigger'||key==='emoteTrigger'){const value=keyValues[key]={value:typeof data.config[key]==='object'?data.config[key]:{vk:0x46}},button=document.createElement('button');button.type='button';capture(button,value,'trigger');row.append(button);button.hidden=input.value!=='custom';input.onchange=()=>{button.hidden=input.value!=='custom';};}
  }
  for(const [key,title,kind]of[['toggleHotkey','暂停 / 恢复快捷键','hotkey'],['textHotkey','文字输入快捷键','hotkey'],['panelKey','房间面板按键（按住显示）','panel']]){const row=document.createElement('div');row.className='lolping-field';row.dataset.setting=key;row.textContent=title;const button=document.createElement('button');button.type='button';keyValues[key]={value:data.config[key]};capture(button,keyValues[key],kind);row.append(button);container.append(row);}
  const names = { danger:'危险',push:'推进',omw:'正在路上',allin:'全力进攻',assist:'请求协助',needvision:'需要视野',missing:'敌人消失',enemyvision:'敌方视野',generic:'普通标记',bait:'诱饵',visioncleared:'视野已清除',missingflip:'倒置问号' };
  for (const [key,title,catalog] of [['wheel','标记轮盘（从顶部顺时针）',data.catalog.pings],['emoteWheel','表情轮盘（从顶部顺时针）',data.catalog.emotes]]) {
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = title; details.append(summary);
    details.dataset.setting=key;
    for (let i=0;i<8;i++) { const row = document.createElement('label'); row.className = 'lolping-field'; row.textContent = `位置 ${i+1}`; const input = select(catalog.map(p=>[p.id,names[p.id]||p.name]),data.config[key][i]); input.name = key+i; row.append(input); details.append(row); }
    container.append(details);
    const centerKey=key==='wheel'?'clickPingId':'clickEmoteId',kind=key==='wheel'?'ping':'emote';
    const editor=document.createElement('div');editor.className='lolping-wheel-editor';summary.after(editor);
    const wheel=document.createElement('div');wheel.className='lolping-wheel-layout';editor.append(wheel);
    const values=data.config[key].slice();let center=data.config[centerKey];
    const named=p=>names[p.id]||p.name;
    const decorate=(b,p)=>{b.textContent='';const image=document.createElement('img');image.src=kind==='ping'?`../lolping/dist/renderer/textures/${p.icon}.png`:`../lolping/dist/renderer/emotes/${p.id}.png`;image.alt='';image.draggable=false;b.append(image,document.createTextNode(named(p)));};
    const draw=()=>{wheel.replaceChildren();for(let i=0;i<9;i++){const item=catalog.find(p=>p.id===(i===8?center:values[i]));const b=document.createElement('button');b.type='button';decorate(b,item);b.title=i===8?'中心：单击信号':'点击预览，拖动可调整位置';b.draggable=true;if(i===8){b.style.left='50%';b.style.top='50%';}else{b.style.left=50+36*Math.sin(i*Math.PI/4)+'%';b.style.top=50-36*Math.cos(i*Math.PI/4)+'%';}b.onclick=()=>api().previewLolPing?.(kind,item.id).catch(error=>toast(error.message,'error'));b.ondragstart=e=>e.dataTransfer.setData('text/plain',JSON.stringify({key,id:item.id}));b.ondragover=e=>e.preventDefault();b.ondrop=e=>{e.preventDefault();try{const p=JSON.parse(e.dataTransfer.getData('text/plain'));if(p.key!==key||!catalog.some(c=>c.id===p.id))return;if(i===8)center=p.id;else{const old=values.indexOf(p.id);if(old>=0)values[old]=values[i];values[i]=p.id;}apply();}catch{}};wheel.append(b);}};
    const apply=()=>{for(let i=0;i<8;i++)details.querySelector(`[name="${key+i}"]`).value=values[i];const c=container.querySelector(`[name="${centerKey}"]`);if(c)c.value=center;draw();};
    wheelCenters[centerKey]=value=>{center=value;draw();};
    for(let i=0;i<8;i++)details.querySelector(`[name="${key+i}"]`).onchange=e=>{const old=values.indexOf(e.target.value);if(old>=0)values[old]=values[i];values[i]=e.target.value;apply();};
    const palette=document.createElement('div');palette.className='lolping-palette';for(const p of catalog){const b=document.createElement('button');b.type='button';decorate(b,p);b.draggable=true;b.ondragstart=e=>e.dataTransfer.setData('text/plain',JSON.stringify({key,id:p.id}));b.onclick=()=>api().previewLolPing?.(kind,p.id).catch(error=>toast(error.message,'error'));palette.append(b);}editor.append(palette);
    const reset=document.createElement('button');reset.type='button';reset.textContent='恢复默认布局';reset.onclick=()=>{values.splice(0,8,...(kind==='ping'?DEFAULT_WHEEL:DEFAULT_EMOTE_WHEEL));center=kind==='ping'?'generic':DEFAULT_EMOTE_WHEEL[0];apply();};editor.append(reset);draw();
  }
  for (const [key,label,list] of [['clickPingId','单击标记',data.catalog.pings],['clickEmoteId','单击表情',data.catalog.emotes]]) { const row=document.createElement('label');row.className='lolping-field';row.dataset.setting=key;row.textContent=label;const input=select(list.map(p=>[p.id,names[p.id]||p.name]),data.config[key]);input.name=key;input.onchange=()=>wheelCenters[key](input.value);row.append(input);container.append(row); }
  function visibility(){for(const row of container.querySelectorAll('[data-setting]')){const key=row.dataset.setting;row.hidden=(key.startsWith('emote')||key==='clickEmoteId')&&!featureInputs.emotes.checked||(['roomMuted','roomTextStyle','textHotkey','panelKey'].includes(key)&&!featureInputs.rooms.checked)||(['roomTextStyle','textHotkey'].includes(key)&&!featureInputs.roomText.checked)||(key==='panelKey'&&!featureInputs.roomPanel.checked);}for(const key of ['roomText','roomVotes','roomPanel'])featureInputs[key].closest('label').hidden=!featureInputs.rooms.checked;}
  visibility();
}
$('#btnLolPingConfig')?.addEventListener('click', async () => {
  try { const data = await load(); if (!data) return; renderFields(data); $('#lolPingError').textContent = ''; $('#lolPingDialog').classList.remove('hidden'); }
  catch (error) { toast(error.message, 'error'); }
});
$('#btnCloseLolPing')?.addEventListener('click', () => {captureEnd?.();$('#lolPingDialog').classList.add('hidden');});
$('#lolPingForm')?.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target, patch = {}; $('#btnSaveLolPing').disabled = true; $('#lolPingError').textContent = '';
  try {
    for (const [key,,type] of fields) { const input = form.elements.namedItem(key); patch[key] = type === 'checkbox' ? input.checked : type === 'range' ? Number(input.value) : input.value; }
    captureEnd?.();for(const key of ['trigger','emoteTrigger'])if(patch[key]==='custom')patch[key]=keyValues[key].value;
    for(const key of ['toggleHotkey','textHotkey','panelKey'])patch[key]=keyValues[key].value;
    patch.features=Object.fromEntries(Object.entries(featureInputs).map(([key,input])=>[key,input.checked]));
    for (const key of ['wheel','emoteWheel']) { patch[key] = Array.from({length:8},(_,i)=>form.elements.namedItem(key+i).value); if (new Set(patch[key]).size !== 8) throw Error('轮盘中的 8 个选项不能重复'); }
    if (JSON.stringify(patch.trigger) === JSON.stringify(patch.emoteTrigger)) throw Error('标记与表情不能使用相同触发键');
    for (const key of ['clickPingId','clickEmoteId']) patch[key] = form.elements.namedItem(key).value;
    const data = await api().saveLolPing(CONFIG_ID, patch);
    cached = data; syncingKey = null; syncLolPing(); $('#lolPingDialog').classList.add('hidden');
  } catch (error) { $('#lolPingError').textContent = error.message; }
  finally { $('#btnSaveLolPing').disabled = false; }
});
void load().then(() => syncLolPing()).catch(error => statusText(error.message));
