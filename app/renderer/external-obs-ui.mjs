export function createExternalObsPanel({onReady,onInvalid,api=window.electronAPI}){
  const panel=document.querySelector('#externalObsPanel'),form=panel.querySelector('form'),port=panel.querySelector('[name="obsPort"]'),password=panel.querySelector('[name="obsPassword"]'),status=panel.querySelector('[role="status"]'),preview=panel.querySelector('.external-obs-preview'),scene=panel.querySelector('.external-obs-scene'),submit=form.querySelector('[type="submit"]');
  let revision=0,clearPassword=false;
  const invalid=()=>{revision++;submit.disabled=false;onInvalid();status.textContent='连接设置已更改，请重新连接 OBS';};
  port.oninput=invalid;password.oninput=()=>{clearPassword=false;invalid();};
  panel.querySelector('.external-obs-clear').onclick=()=>{password.value='';password.placeholder='未设置密码';clearPassword=true;invalid();};
  async function connect(save=false){
    const token=++revision;onInvalid();submit.disabled=true;status.textContent='正在连接 OBS…';
    try{
      let result;
      if(save){const value={port:Number(port.value)};if(password.value||clearPassword)value.password=password.value;result=await api.connectExternalObs(value);}
      else result=await api.inspectExternalObs();
      if(token!==revision)return;
      password.value='';clearPassword=false;password.placeholder='留空保留已保存密码';
      scene.textContent=result.scene;preview.replaceChildren();
      if(result.thumbnail){const image=document.createElement('img');image.src=result.thumbnail;image.alt='OBS 当前输出预览';preview.append(image);}else preview.textContent='OBS';
      if(result.streaming){status.textContent='OBS 已在推流，请先在 OBS 中停止现有推流';return;}
      status.textContent=`已连接 OBS ${result.version||''} · ${result.scene}`;onReady();
    }catch(error){if(token===revision)status.textContent=error.message;}
    finally{if(token===revision)submit.disabled=false;}
  }
  form.onsubmit=event=>{event.preventDefault();void connect(true);};
  return {
    async open(){const token=++revision;onInvalid();submit.disabled=false;try{const saved=await api.getExternalObsSettings();if(token!==revision)return;port.value=saved.port;password.value='';password.placeholder=saved.hasPassword?'已保存密码，留空保持不变':'WebSocket 密码（未启用认证时留空）';clearPassword=false;await connect();}catch(error){if(token===revision)status.textContent=error.message;}},
    hide(){revision++;submit.disabled=false;},
    error(message){status.textContent=message;onInvalid();},
  };
}
