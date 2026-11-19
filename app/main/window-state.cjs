const fs=require('node:fs'),path=require('node:path');

const MIN_WINDOW_WIDTH = 960;
// Compact sidebar (201.25), two 192px cards, 16px gap, 24px inset and a 4px scrollbar.
const COMPACT_WINDOW_WIDTH = 630;
const MIN_WINDOW_HEIGHT = 640;

function setMemberSidebarCollapsed(win, screen, collapsed) {
  const minWidth = collapsed ? COMPACT_WINDOW_WIDTH : MIN_WINDOW_WIDTH;
  const bounds = win.isMaximized() || win.isFullScreen() || win.isMinimized() ? null : win.getBounds();
  win.setMinimumSize(minWidth, MIN_WINDOW_HEIGHT);
  if (!bounds || bounds.width >= minWidth) return;
  const area = screen.getDisplayMatching(bounds).workArea;
  const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - minWidth));
  win.setBounds({ ...bounds, x, width: minWidth });
}

function createWindowState({file,screen}){
  function read(){
    let saved;
    try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    const valid=!!saved?.bounds&&['x','y','width','height'].every(key=>Number.isInteger(saved.bounds[key])&&Math.abs(saved.bounds[key])<=2147483647)&&saved.bounds.width>=COMPACT_WINDOW_WIDTH&&saved.bounds.height>=MIN_WINDOW_HEIGHT;
    const bounds=valid?saved.bounds:{width:1200,height:800};
    const area=(valid?screen.getDisplayMatching(bounds):screen.getPrimaryDisplay()).workArea;
    const width=Math.max(COMPACT_WINDOW_WIDTH,Math.min(bounds.width,area.width)),height=Math.max(MIN_WINDOW_HEIGHT,Math.min(bounds.height,area.height));
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
module.exports={createWindowState,setMemberSidebarCollapsed,MIN_WINDOW_WIDTH,COMPACT_WINDOW_WIDTH,MIN_WINDOW_HEIGHT};
