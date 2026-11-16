const path=require('node:path');
function createUpdateWindow({BrowserWindow,ipcMain,updates,enter,install,quit,canQuit=()=>false}){
  let current,draining=Promise.resolve();
  const authorized=event=>{if(!current||event.sender!==current.window.webContents)throw Error('无效的更新窗口');return current;};
  const alive=context=>current===context&&!context.closed&&!context.window.isDestroyed();
  function send(state){if(current&&alive(current))current.window.webContents.send('update-state',state);}
  function stop(context){
    if(context.closed)return;
    context.closed=true;if(current===context)current=null;
    // Drain cancellation before a newly opened window starts another operation.
    draining=Promise.resolve(updates.cancel?.()).catch(()=>{});
  }
  async function run(context,retry=false){
    if(context.busy||!alive(context))return;context.busy=true;
    try{
      await draining;if(!alive(context))return;
      const result=await updates.prepareUpdate({automatic:!context.manual,retry});
      if(!alive(context))return;
      if(result.enter){if(context.manual)send({...updates.get(),status:'current'});else enterMain(context);}
      else {context.installing=true;send({...updates.get(),status:'installing'});await install(context.window);}
    }catch(error){if(alive(context)&&error?.name!=='CancellationError'){updates.reportFailure(error);send(updates.get());}}
    finally{context.busy=false;context.installing=false;}
  }
  function enterMain(context){context.closed=true;if(current===context)current=null;enter();context.window.destroy();}
  ipcMain.handle('updater-state',event=>{authorized(event);return updates.get();});
  ipcMain.handle('updater-retry',event=>run(authorized(event),true));
  ipcMain.handle('updater-enter',event=>{const context=authorized(event);if(context.busy)throw Error('更新尚未完成');enterMain(context);});
  ipcMain.handle('updater-close',event=>{
    const context=authorized(event);if(context.installing)return false;
    stop(context);if(context.manual)context.window.destroy();else quit();return true;
  });
  return {send,show:()=>current?.window.show(),open(isManual=false){
    if(current&&alive(current)){current.window.show();return;}
    const window=new BrowserWindow({width:520,height:380,resizable:false,frame:false,show:false,backgroundColor:'#f3f3f3',title:'ScreenSh 更新',icon:path.join(__dirname,'../assets/branding/icon.png'),webPreferences:{preload:path.join(__dirname,'update-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    const context=current={window,manual:isManual,closed:false,busy:false,installing:false};
    window.on('close',event=>{if(context.installing){if(!canQuit())event.preventDefault();}else stop(context);});
    window.on('closed',()=>{if(!context.installing)stop(context);if(current===context)current=null;});
    window.webContents.once('did-finish-load',()=>{if(alive(context)){window.show();void run(context);}});
    window.loadFile(path.join(__dirname,'../renderer/updater.html')).catch(error=>{if(alive(context)){send({status:'error',message:error.message});window.show();}});
  }};
}
module.exports={createUpdateWindow};
