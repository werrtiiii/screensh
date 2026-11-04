const path=require('node:path');
function createUpdateWindow({BrowserWindow,ipcMain,updates,enter,install,quit}){
  let window,busy=false,manual=false;
  const authorized=event=>{if(!window||event.sender!==window.webContents)throw Error('无效的更新窗口');};
  function send(state){if(window&&!window.isDestroyed())window.webContents.send('update-state',state);}
  async function run(retry=false){
    if(busy)return;busy=true;
    try{
      const result=await updates.prepareUpdate({automatic:!manual,retry});
      if(result.enter){if(manual)send({...updates.get(),status:'current'});else enterMain();}
      else {send({...updates.get(),status:'installing'});await install(window);}
    }catch(error){updates.reportFailure(error);send(updates.get());}
    finally{busy=false;}
  }
  function enterMain(){const old=window;window=null;enter();old?.destroy();}
  ipcMain.handle('updater-state',event=>{authorized(event);return updates.get();});
  ipcMain.handle('updater-retry',event=>{authorized(event);return run(true);});
  ipcMain.handle('updater-enter',event=>{authorized(event);if(busy)throw Error('更新尚未完成');enterMain();});
  ipcMain.handle('updater-close',event=>{authorized(event);if(manual){window.destroy();window=null;}else quit();});
  return {send,show:()=>window?.show(),open(isManual=false){
    if(window&&!window.isDestroyed()){window.show();return;}
    manual=isManual;
    window=new BrowserWindow({width:520,height:380,resizable:false,frame:false,show:false,backgroundColor:'#f3f3f3',title:'ScreenSh 更新',icon:path.join(__dirname,'../assets/branding/icon.png'),webPreferences:{preload:path.join(__dirname,'update-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    window.on('closed',()=>{window=null;});
    window.webContents.once('did-finish-load',()=>{window.show();void run();});
    window.loadFile(path.join(__dirname,'../renderer/updater.html')).catch(error=>{send({status:'error',message:error.message});window?.show();});
  }};
}
module.exports={createUpdateWindow};
