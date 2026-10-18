const {app,BrowserWindow,desktopCapturer,screen}=require('electron');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {ObsEngine}=require('../../main/obs-engine');
const {listCaptureSources,attachCapturePreviews}=require('../../main/capture-sources');
const root=path.resolve(__dirname,"../.."),temporary=path.join(root,'.runtime-probe','preview-native-'+process.pid);
fs.mkdirSync(temporary,{recursive:true});app.setPath('userData',temporary);app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 let win;const engine=new ObsEngine(temporary);
 try{
  const title='ScreenSh preview fixture '+process.pid;
  win=new BrowserWindow({show:false,width:640,height:400,title,backgroundColor:'#2479b6'});
  await win.loadURL('data:text/html,'+encodeURIComponent(`<title>${title}</title><body style="background:#2479b6;color:white;font:28px sans-serif">ScreenSh 预览测试</body>`));win.show();win.hide();win.showInactive();
  await new Promise(resolve=>setTimeout(resolve,500));
  const previews=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:480,height:270},fetchWindowIcons:false});
  engine.init();const sources=listCaptureSources(engine.osn,screen.getAllDisplays());
  const results=attachCapturePreviews(sources,previews),source=results.find(s=>s.type==='window'&&s.name.includes(title));
  assert.ok(source,'test window must be in the OBS source list');
  // Chromium may omit this process's own window. Verify the real capturable windows it exposes instead.
  const windows=results.filter(s=>s.type==='window'&&s.thumbnail),monitors=results.filter(s=>s.type==='screen'&&s.thumbnail);
  assert.ok(windows.length>0,'At least one actual window must receive its Chromium thumbnail');assert.ok(monitors.length>0,'At least one monitor must receive its actual thumbnail');
  assert.deepEqual(results.map(s=>[s.type,s.id]),sources.map(s=>[s.type,s.id]),'previews must not replace capture identifiers');
  console.log('CAPTURE_PREVIEWS_OK',JSON.stringify({windowPreviews:windows.length,originalCaptureIds:true,monitorPreviews:monitors.length}));
 }catch(error){console.error(error.stack);process.exitCode=1;}finally{win?.destroy();engine.shutdown();app.exit(process.exitCode||0);}
});
