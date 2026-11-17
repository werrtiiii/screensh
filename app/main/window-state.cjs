const fs=require('node:fs'),path=require('node:path');

function createWindowState({file,screen}){
  function read(){
    let saved;
    try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    const valid=!!saved?.bounds&&['x','y','width','height'].every(key=>Number.isInteger(saved.bounds[key])&&Math.abs(saved.bounds[key])<=2147483647)&&saved.bounds.width>=960&&saved.bounds.height>=640;
    const bounds=valid?saved.bounds:{width:1200,height:800};
    const area=(valid?screen.getDisplayMatching(bounds):screen.getPrimaryDisplay()).workArea;
    const width=Math.max(960,Math.min(bounds.width,area.width)),height=Math.max(640,Math.min(bounds.height,area.height));
    const clamp=(value,start,extent,size)=>Math.max(start,Math.min(value,start+extent-size));
    const x=clamp(valid?bounds.x:Math.round(area.x+(area.width-width)/2),area.x,area.width,width);
    const y=clamp(valid?bounds.y:Math.round(area.y+(area.height-height)/2),area.y,area.height,height);
    return {bounds:{x,y,width,height},maximized:valid&&saved.maximized===true};
  }
  function track(win){
    let maximized=win.isMaximized();
    win.on('maximize',()=>{maximized=true;});
    win.on('unmaximize',()=>{maximized=false;});
    // Normal bounds retain the restore size even when maximized or minimized.
    win.on('close',()=>{
      const temporary=file+'.tmp';
      try{
        fs.mkdirSync(path.dirname(file),{recursive:true});
        fs.writeFileSync(temporary,JSON.stringify({bounds:win.getNormalBounds(),maximized}),{mode:0o600});
        fs.renameSync(temporary,file);
      }catch(error){
        try{fs.rmSync(temporary,{force:true});}catch{}
        console.warn('窗口状态保存失败:',error.message);
      }
    });
  }
  return {read,track};
}
module.exports={createWindowState};
