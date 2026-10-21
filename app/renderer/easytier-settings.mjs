import {EASYTIER_OPTIONS,normalizeEasyTierSettings} from './easytier-options.mjs';
export function initEasyTierSettings(api) {
  const ipv6Button=document.querySelector('#btnTryIpv6'),ipv6Result=document.querySelector('#ipv6Result');
  ipv6Button.onclick=async()=>{
    if(ipv6Button.disabled)return;ipv6Button.disabled=true;ipv6Button.textContent='检测中…';ipv6Result.classList.remove('hidden');ipv6Result.dataset.state='pending';ipv6Result.textContent='正在尝试启用 IPv6 并检测网络，请稍候…';
    try{const result=await api.tryEnableIpv6();ipv6Result.dataset.state=result.code==='reachable'?'success':'notice';ipv6Result.textContent=[result.message,...(result.adapters?.length?['网卡：'+result.adapters.map(adapter=>adapter.name).join('、')]:[]),...(result.warnings||[])].join('\n');}
    catch(error){ipv6Result.dataset.state='error';ipv6Result.textContent=error.message||'IPv6 检测失败，请重试';}
    finally{ipv6Button.disabled=false;ipv6Button.textContent='重新尝试';}
  };
  const $=selector=>document.querySelector(selector),modal=$('#easyTierSettingsDialog'),form=$('#easyTierSettingsForm'),grid=$('#easyTierOptions'),error=$('#easyTierSettingsError');
  let ready=false,busy=false,revision=0,tip=null,tipAnchor=null;
  function hideTip(){tip?.remove();tip=null;tipAnchor=null;}
  function placeTip(){if(!tip||!tipAnchor)return;const anchor=tipAnchor.getBoundingClientRect(),bounds=tip.getBoundingClientRect(),body=$('.easytier-settings-body').getBoundingClientRect();
    if(anchor.bottom<body.top||anchor.top>body.bottom){hideTip();return;}
    tip.style.left=Math.max(12,Math.min(anchor.left,innerWidth-bounds.width-12))+'px';tip.style.top=(anchor.top-bounds.height>=54?anchor.top-bounds.height-8:Math.max(46,Math.min(innerHeight-bounds.height-12,anchor.bottom+8)))+'px';
  }
  function showTip(button,help){
    hideTip();tip=document.createElement('div');tip.id='easyTierHelpTooltip';tip.className='easytier-help-tooltip';tip.role='tooltip';tip.textContent=help;document.body.append(tip);
    tipAnchor=button;placeTip();
  }
  for(const option of EASYTIER_OPTIONS){
    const row=document.createElement('div');row.className='easytier-option'+(option.unavailable?' unavailable':'');
    const label=document.createElement('label');label.htmlFor='easyTier-'+option.key;label.textContent=option.label;
    const input=document.createElement('input');input.id=label.htmlFor;input.type='checkbox';input.role='switch';input.dataset.easytierOption=option.key;input.disabled=true;input.checked=option.defaultValue;
    const help=document.createElement('button');help.type='button';help.className='help-tip';help.textContent='?';help.setAttribute('aria-label',option.label+'说明');help.setAttribute('aria-describedby','easyTierHelpTooltip');
    help.onpointerenter=help.onfocus=()=>showTip(help,option.help);help.onpointerleave=()=>{if(document.activeElement!==help)hideTip();};help.onblur=hideTip;
    row.append(label,input,help);grid.append(row);
  }
  function controls(){for(const option of EASYTIER_OPTIONS)$('#easyTier-'+option.key).disabled=busy||!ready||option.unavailable;$('#easyTierSave').disabled=busy||!ready;$('#easyTierReset').disabled=busy||!ready;$('#btnCloseEasyTierSettings').disabled=busy;}
  function paint(config){for(const option of EASYTIER_OPTIONS)$('#easyTier-'+option.key).checked=config[option.key];}
  async function open(){const token=++revision;ready=false;busy=false;error.textContent='';modal.classList.remove('hidden');controls();
    try{const config=normalizeEasyTierSettings(await api.getEasyTierSettings());if(token!==revision)return;paint(config);ready=true;}
    catch(e){if(token===revision)error.textContent=e.message||'高级设置读取失败';}
    finally{if(token===revision)controls();}
  }
  function close(){if(busy)return;revision++;hideTip();modal.classList.add('hidden');}
  $('#btnEasyTierAdvanced').onclick=()=>void open();$('#btnCloseEasyTierSettings').onclick=close;modal.onclick=event=>{if(event.target===modal)close();};
  $('#easyTierReset').onclick=()=>{paint(normalizeEasyTierSettings());error.textContent='';};
  form.onsubmit=async event=>{event.preventDefault();if(!ready||busy)return;busy=true;error.textContent='';hideTip();controls();
    try{const config=Object.fromEntries(EASYTIER_OPTIONS.map(option=>[option.key,$('#easyTier-'+option.key).checked]));paint(normalizeEasyTierSettings(await api.setEasyTierSettings(config)));busy=false;close();}
    catch(e){error.textContent=e.message||'高级设置保存失败';}
    finally{busy=false;controls();}
  };
  document.addEventListener('scroll',placeTip,true);window.addEventListener('resize',hideTip);window.addEventListener('blur',hideTip);
  new MutationObserver(()=>{if(modal.classList.contains('hidden'))hideTip();}).observe(modal,{attributes:true,attributeFilter:['class']});
  $('#easyTierOfficialDocs').onclick=()=>void api.openWebLink('https://easytier.cn/guide/network/configurations.html').catch(e=>{error.textContent=e.message;});
}
