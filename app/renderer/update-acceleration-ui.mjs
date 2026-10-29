export async function initUpdateAcceleration({root=document,api=window.electronAPI,notify=()=>{}}={}) {
  const find=id=>root.querySelector('#'+id),panel=find('updateAcceleration');if(!panel)return;
  const enabled=find('updateAccelerationEnabled'),list=find('updateAccelerationSources'),custom=find('updateAccelerationCustom'),input=find('updateAccelerationCustomUrl'),save=find('btnSaveUpdateAcceleration'),test=find('btnTestUpdateAcceleration'),status=find('updateAccelerationStatus');
  let saved,saving=false,testing=false;
  const rows=new Map();
  function refresh(){
    enabled.disabled=saving;
    for(const row of rows.values())row.radio.disabled=saving||!enabled.checked;
    custom.classList.toggle('hidden',!rows.get('custom')?.radio.checked);
    input.disabled=save.disabled=saving||!enabled.checked;
    test.disabled=saving||testing||!enabled.checked;
  }
  function paint(value){enabled.checked=value.enabled;input.value=value.customUrl;rows.get(value.source).radio.checked=true;refresh();}
  function draft(){const source=[...rows].find(([,row])=>row.radio.checked)?.[0];return {enabled:enabled.checked,source,customUrl:source==='custom'&&enabled.checked?input.value.trim():saved.customUrl};}
  async function persist(){
    if(saving)return;saving=true;refresh();
    try{saved=await api.setUpdateAcceleration(draft());paint(saved);status.textContent='已保存，下次下载时生效';}
    catch(error){paint(saved);status.textContent=error.message||'加速设置保存失败';notify(status.textContent,'error');}
    finally{saving=false;refresh();}
  }
  try{saved=await api.getUpdateAcceleration();
    for(const source of [...saved.sources,'custom']){
      const label=document.createElement('label');label.className='update-acceleration-source';
      const radio=document.createElement('input');radio.type='radio';radio.name='updateAccelerationSource';radio.value=source;
      const name=document.createElement('span');name.className='update-acceleration-name';name.textContent=source==='custom'?'自定义':source;
      const result=document.createElement('span');result.className='update-acceleration-result';
      label.append(radio,name,result);list.append(label);rows.set(source,{radio,result});
      radio.addEventListener('change',()=>{refresh();if(source==='custom'&&!input.value.trim()){status.textContent='填写自定义地址后点击保存';input.focus();return;}void persist();});
    }
    paint(saved);
  }catch(error){status.textContent=error.message||'无法读取下载加速设置';notify(status.textContent,'error');return;}
  enabled.addEventListener('change',persist);save.addEventListener('click',persist);
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void persist();}});
  input.addEventListener('input',()=>{rows.get('custom').result.textContent='';status.textContent='修改地址后点击保存';});
  test.addEventListener('click',async()=>{
    if(testing)return;testing=true;refresh();test.textContent='测试中…';status.textContent='正在测试安装包下载连通性…';
    for(const row of rows.values()){row.result.textContent='';delete row.result.dataset.available;}
    const testedCustom=input.value.trim();
    try{
      const results=await api.testUpdateAcceleration(testedCustom);
      for(const result of results){
        const row=rows.get(result.source)||((input.value.trim()===testedCustom)?rows.get('custom'):null);if(!row)continue;
        row.result.textContent=result.available?`可用 · ${result.latency} ms`:'不可用';row.result.dataset.available=String(result.available);
        row.result.title=result.available&&!result.range?'连通正常，但未确认分段下载支持，可能使用完整下载':'';
      }
      status.textContent='测试完成；耗时为首包响应时间，不代表下载速度';
    }catch(error){status.textContent=error.message||'连通性测试失败';notify(status.textContent,'error');}
    finally{testing=false;test.textContent='测试连通性';refresh();}
  });
}
